import { MaintenanceService } from "../src/maintenance.ts";
import { maintenanceRoutes } from "../src/maintenance-http.ts";
import { accessError } from "../src/access-http.ts";
import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { Operations } from "../src/operations.ts";
import postgres from "postgres";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");

test("healthy execution retains ownership beyond its initial lease and settles one outcome", async () => {
  const f = await fixture();
  let completed;
  try {
    expect(
      await f.operations.execute(
        {
          kinds: ["fixture.effect"],
          organizationId: f.context.organizationId,
          leaseMs: 300,
        },
        async (job) => {
          await Bun.sleep(750);
          expect(
            await f.operations.claim(
              ["fixture.effect"],
              300,
              f.context.organizationId,
            ),
          ).toBeUndefined();
          expect(job.attempt).toBe(1);
          await f.operations.commit(job, async () => {});
          completed = job;
        },
      ),
    ).toBe(true);
    await Bun.sleep(400);
    expect((await f.operations.committed(completed!))?.outcome).toBe(
      "succeeded",
    );
    expect(
      await f.operations.claim(
        ["fixture.effect"],
        300,
        f.context.organizationId,
      ),
    ).toBeUndefined();
  } finally {
    await f.close();
  }
}, 30000);
test("a renewal blocked past expiry cancels execution and cannot resurrect its lease", async () => {
  const f = await fixture();
  const locker = postgres(url!, { max: 1, onnotice: () => {} });
  const locked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let lock: Promise<unknown> | undefined;
  let original;
  try {
    await f.operations.execute(
      {
        kinds: ["fixture.effect"],
        organizationId: f.context.organizationId,
        leaseMs: 300,
      },
      async (job) => {
        original = job;
        const signal = f.operations.signal(job, AbortSignal.timeout(5000));
        lock = locker.begin(async (tx) => {
          await tx`SELECT id FROM knowledge_jobs WHERE id=${job.id} FOR UPDATE`;
          locked.resolve();
          await release.promise;
        });
        await locked.promise;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        expect(signal.reason.message).toBe("stale_worker");
        await expect(
          f.operations.checkpoint(job, async () => {}),
        ).rejects.toThrow("stale_worker");
        // Ensure the database lease also expires before unblocking the pending renewal.
        await Bun.sleep(100);
        release.resolve();
        await lock;
        throw signal.reason;
      },
    );
    const replacement = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    expect(replacement?.id).toBe(original!.id);
    expect(replacement?.attempt).toBe(2);
    await f.operations.commit(replacement, async () => {});
  } finally {
    release.resolve();
    await lock;
    await locker.end();
    await f.close();
  }
}, 10000);

test("settled execution without a committed outcome stops retaining the job", async () => {
  const f = await fixture();
  let original;
  try {
    await f.operations.execute(
      {
        kinds: ["fixture.effect"],
        organizationId: f.context.organizationId,
        leaseMs: 300,
      },
      async (job) => {
        original = job;
        await Bun.sleep(450);
      },
    );
    await Bun.sleep(400);
    const replacement = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    expect(replacement?.id).toBe(original!.id);
    expect(replacement?.attempt).toBe(2);
    expect(await f.operations.committed(original!)).toBeUndefined();
    await f.operations.commit(replacement, async () => {});
  } finally {
    await f.close();
  }
}, 10000);
async function fixture() {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `ops-${crypto.randomUUID()}`,
    username: "admin",
    password: "operation-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "import");
  const operations = new Operations(url!);
  const id = await operations.accept(
    context,
    "once",
    "fixture",
    async (tx, operationId) => {
      await operations.enqueue(tx, operationId, "fixture.effect", { value: 0 });
    },
  );
  return {
    operations,
    context,
    access,
    token,
    id,
    async close() {
      await operations.close();
      await access.close();
    },
  };
}
test("a committed effect receipt is inspected before an uncertain result can dispatch the effect twice", async () => {
  const f = await fixture();
  try {
    const job = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    let calls = 0;
    await f.operations.commit(job, async () => {
      calls++;
    });
    expect((await f.operations.committed(job))?.outcome).toBe("succeeded");
    await f.operations.commit(job, async () => {
      calls++;
    });
    expect(calls).toBe(1);
    // Simulate a controller that recorded uncertainty after losing acknowledgement.
    await f.operations
      .sql`UPDATE knowledge_jobs SET state='outcome_unknown' WHERE id=${job.id}`;
    expect(
      await f.operations.reconcile(job.id, f.context.organizationId),
    ).toEqual({ state: "succeeded", recovered: true });
    expect(
      await f.operations.claim(
        ["fixture.effect"],
        60000,
        f.context.organizationId,
      ),
    ).toBeUndefined();
  } finally {
    await f.close();
  }
}, 30000);
test("expired workers cannot commit and rollback without a receipt preserves the next worker's ownership", async () => {
  const f = await fixture();
  try {
    const old = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    await f.operations
      .sql`UPDATE knowledge_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${old.id}`;
    const replacement = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    await expect(
      f.operations.commit(old, async () => {
        throw new Error("must not dispatch");
      }),
    ).rejects.toThrow("stale_worker");
    await expect(
      f.operations.commit(replacement, async () => {
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await f.operations.committed(replacement)).toBeUndefined();
    await f.operations
      .sql`UPDATE knowledge_jobs SET state='outcome_unknown' WHERE id=${replacement.id}`;
    expect(
      await f.operations.reconcile(replacement.id, f.context.organizationId),
    ).toEqual({ state: "queued", recovered: false });
    const recovered = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    expect(recovered.attempt).toBe(3);
    await f.operations.commit(recovered, async () => {});
  } finally {
    await f.close();
  }
}, 30000);

test("authenticated operation status reconciles a known outcome and rejects a reader mutation", async () => {
  const f = await fixture();
  const maintenance = new MaintenanceService(url!, f.access);
  const app = maintenanceRoutes(maintenance);
  app.onError((error, context) => accessError(context, error));
  try {
    const job = (await f.operations.claim(
      ["fixture.effect"],
      60000,
      f.context.organizationId,
    ))!;
    await f.operations.commit(job, async () => {});
    await f.operations
      .sql`UPDATE knowledge_jobs SET state='outcome_unknown' WHERE id=${job.id}`;
    const response = await app.request(`/operations/${f.id}`, {
      headers: { cookie: `loreweave_session=${f.token}` },
    });
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { jobs: Array<{ state: string }> }).jobs[0]!
        .state,
    ).toBe("outcome_unknown");
    const key = await f.access.issueCredential(f.token, {
      name: "reader",
      grants: ["read"],
    });
    expect(
      (
        await app.request(`/operations/${f.id}/reconcile`, {
          method: "POST",
          headers: { cookie: `loreweave_session=${key.token}` },
        })
      ).status,
    ).toBe(401);
    const repaired = await app.request(`/operations/${f.id}/reconcile`, {
      method: "POST",
      headers: { cookie: `loreweave_session=${f.token}` },
    });
    expect(
      ((await repaired.json()) as { jobs: Array<{ state: string }> }).jobs[0]!
        .state,
    ).toBe("succeeded");
  } finally {
    await maintenance.close();
    await f.close();
  }
}, 30000);
