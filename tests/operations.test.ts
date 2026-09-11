import { MaintenanceService } from "../src/maintenance.ts";
import { maintenanceRoutes } from "../src/maintenance-http.ts";
import { accessError } from "../src/access-http.ts";
import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { Operations } from "../src/operations.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
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
