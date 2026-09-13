import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { ModelAdmission, withModelWork } from "../src/model-admission.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");

test("AC06/07: actual streamed requests share eight slots, background six, until bodies settle", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  await access.close();
  const admission = new ModelAdmission(url!);
  const waiting = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();
  let active = 0,
    peak = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      active++;
      peak = Math.max(peak, active);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            waiting.set(new URL(request.url).pathname, controller);
            controller.enqueue(new TextEncoder().encode("hello"));
          },
        }),
      );
    },
  });
  const requests: Promise<string>[] = [];
  const start = (id: string, priority: "background" | "interactive") => {
    const task = withModelWork(
      { operationId: id, priority, deadline: Date.now() + 10000 },
      async () => {
        const response = await admission.fetch(new URL(id, server.url));
        return response.text();
      },
    );
    requests.push(task);
    return task;
  };
  const until = async (predicate: () => boolean) => {
    for (let i = 0; !predicate() && i < 500; i++) await Bun.sleep(5);
    expect(predicate()).toBe(true);
  };
  const finish = (id: string) => {
    waiting.get("/" + id)!.close();
    waiting.delete("/" + id);
    active--;
  };
  try {
    for (let i = 0; i < 7; i++) start(`b${i}`, "background");
    await until(() => waiting.size === 6);
    start("i0", "interactive");
    start("i1", "interactive");
    await until(() => waiting.size === 8);
    expect(waiting.has("/b6")).toBe(false);
    start("i2", "interactive");
    await Bun.sleep(100);
    finish("b0");
    await until(() => waiting.has("/i2"));
    expect(waiting.has("/b6")).toBe(false);
    finish("i0");
    await until(() => waiting.has("/b6"));
    for (const id of [...waiting.keys()]) finish(id.slice(1));
    await Promise.all(requests);
    expect(peak).toBe(8);
    const status = await admission.status();
    expect(status.active).toBe(0);
  } finally {
    for (const controller of waiting.values()) controller.close();
    await Promise.allSettled(requests);
    server.stop(true);
    await admission.close();
  }
});

test("consumer cancellation drains the provider before releasing HTTP capacity", async () => {
  const admission = new ModelAdmission(url!);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            controller = stream;
            stream.enqueue(new Uint8Array([1]));
          },
        }),
      );
    },
  });
  const operationId = crypto.randomUUID();
  try {
    const response = await withModelWork(
      { operationId, priority: "background", deadline: Date.now() + 10000 },
      () => admission.fetch(server.url),
    );
    await response.body!.cancel();
    const status = await admission.status();
    const attempt = status.requests.find(
      (row) => row.operation_id === operationId,
    )!;
    expect(attempt.state).toBe("dispatched");
    expect(status.active).toBe(1);
    controller.close();
    await admission.settled(operationId);
    expect((await admission.status()).active).toBe(0);
  } finally {
    server.stop(true);
    await admission.close();
  }
});

test("AC06: the Forge SDK uses the admitted HTTP transport through streamed completion", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const provider = startScriptedProvider({ noRetrieval: true });
  const admission = new ModelAdmission(url!);
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    modelFetch: admission.fetch,
    settleModelWork: admission.settled.bind(admission),
  });
  try {
    const run = await host.start({ question: "水的沸点" });
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("answered");
    const requests = (await admission.status()).requests.filter(
      (row) => row.operation_id === run.id,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.state).toBe("settled");
  } finally {
    await host.close();
    provider.stop();
    await admission.close();
  }
});

test("AC09/16: a dead queued process is fenced without blocking live admission until its logical deadline", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  await access.close();
  const admission = new ModelAdmission(url!, 300);
  const holds = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            holds.set(new URL(request.url).pathname, controller);
            controller.enqueue(new Uint8Array([1]));
          },
        }),
      );
    },
  });
  const started: Promise<string>[] = [];
  const start = (id: string) => {
    const task = withModelWork(
      {
        operationId: id,
        priority: "interactive",
        deadline: Date.now() + 10000,
      },
      async () => (await admission.fetch(new URL(id, server.url))).text(),
    );
    started.push(task);
    return task;
  };
  const until = async (predicate: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await predicate()) return;
      await Bun.sleep(10);
    }
    throw new Error("admission_wait_timeout");
  };
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const deadId = crypto.randomUUID();
  try {
    for (let i = 0; i < 8; i++) start(`hold-${i}`);
    await until(async () => holds.size === 8);
    child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "-e",
        `import {ModelAdmission,withModelWork} from './src/model-admission.ts';const a=new ModelAdmission(process.env.TEST_DATABASE_URL,300);await withModelWork({operationId:process.env.DEAD_OPERATION,priority:'interactive',deadline:Date.now()+30000},async()=>{await(await a.fetch(process.env.PROVIDER_URL)).text()});await a.close();`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DEAD_OPERATION: deadId,
          PROVIDER_URL: server.url.toString(),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await until(async () =>
      (await admission.status()).requests.some(
        (row) => row.operation_id === deadId && row.state === "queued",
      ),
    );
    start("survivor");
    child.kill("SIGKILL");
    await child.exited;
    await Bun.sleep(400);
    holds.get("/hold-0")!.close();
    holds.delete("/hold-0");
    await until(async () => holds.has("/survivor"));
    expect(
      (await admission.status()).requests.find(
        (row) => row.operation_id === deadId,
      )?.outcome,
    ).toBe("owner_fenced_before_dispatch");
    for (const controller of holds.values()) controller.close();
    holds.clear();
    await Promise.all(started);
  } finally {
    child?.kill();
    if (child) await child.exited;
    for (const controller of holds.values()) controller.close();
    await Promise.allSettled(started);
    server.stop(true);
    await admission.close();
  }
}, 15000);

test("AC09: a lone dead undispatched reservation is fenced before replay eligibility is checked", async () => {
  const postgres = (await import("postgres")).default;
  const { hash } = await import("../src/answer-validation.ts");
  const sql = postgres(url!);
  const admission = new ModelAdmission(url!);
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      return new Response("done");
    },
  });
  const operationId = crypto.randomUUID(),
    owner = crypto.randomUUID(),
    id = crypto.randomUUID();
  try {
    await sql`INSERT INTO model_owners(id,lease_until) VALUES(${owner},clock_timestamp()-interval '1 second')`;
    await sql`INSERT INTO model_requests(id,operation_id,input_hash,owner,priority,state,deadline,provider_key) VALUES(${id},${operationId},${hash({ url: server.url.toString(), method: "GET", body: "" })},${owner},'background','reserved',clock_timestamp()+interval '1 minute',${server.url.origin})`;
    const result = await withModelWork(
      { operationId, priority: "background", deadline: Date.now() + 1000 },
      async () => (await admission.fetch(server.url)).text(),
    );
    expect(result).toBe("done");
    expect(calls).toBe(1);
    expect(
      (await admission.status()).requests.find((row) => row.id === id)?.state,
    ).toBe("expired");
  } finally {
    await sql`UPDATE model_owners SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${owner}`;
    server.stop(true);
    await admission.close();
    await sql.end();
  }
});

test("AC08: cancellation after the dispatch ledger callback but before HTTP does not consume maintenance execution allowance", async () => {
  const { Operations } = await import("../src/operations.ts");
  const { WikiModelRuntime } = await import("../src/wiki-model-runtime.ts");
  const { currentModelWork } = await import("../src/model-admission.ts");
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `no-dispatch-${crypto.randomUUID()}`,
    username: "admin",
    password: "no-dispatch-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const operations = new Operations(url!),
    admission = new ModelAdmission(url!);
  let calls = 0,
    invocations = 0,
    result: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      return Response.json({ ok: true });
    },
  });
  const runtime = new WikiModelRuntime(operations, {
    profile: "no-dispatch-test",
    admittedTransport: true,
    async request() {
      invocations++;
      const work = currentModelWork()!;
      const cancel = new AbortController();
      return withModelWork(
        {
          ...work,
          onDispatch: async (id) => {
            await work.onDispatch?.(id);
            if (invocations === 1)
              cancel.abort(new Error("pre_dispatch_cancel"));
          },
        },
        async () =>
          (await admission.fetch(server.url, { signal: cancel.signal })).json(),
      );
    },
  });
  try {
    const id = await operations.accept(
      context,
      crypto.randomUUID(),
      "test",
      async (tx, id) => {
        await operations.enqueue(tx, id, "test.no-dispatch", {});
      },
    );
    await operations.execute(
      { kinds: ["test.no-dispatch"], organizationId: context.organizationId },
      async (job) => {
        result = await runtime.request(
          job,
          "packet",
          "graph_extraction",
          1,
          {},
          (raw) => raw,
        );
        await operations.commit(job, async () => {});
      },
    );
    expect(result).toEqual({ ok: true });
    expect(invocations).toBe(2);
    expect(calls).toBe(1);
    const rows =
      await operations.sql`SELECT r.state FROM wiki_model_attempts a JOIN knowledge_jobs j ON j.id=a.job_id JOIN model_requests r ON r.id=a.model_request_id WHERE j.operation_id=${id} ORDER BY a.attempt`;
    expect(rows.map((row) => row.state)).toEqual(["expired", "settled"]);
  } finally {
    server.stop(true);
    await admission.close();
    await operations.close();
    await access.close();
  }
});

test("AC09: duplicate queued logical inputs cannot replay, and canceled queue owners allow retry", async () => {
  const admission = new ModelAdmission(url!);
  const held = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const calls: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            held.set(path, controller);
            controller.enqueue(new Uint8Array([1]));
          },
        }),
      );
    },
  });
  const requests: Promise<unknown>[] = [];
  const queued = new AbortController();
  const operationId = crypto.randomUUID();
  const invoke = (id: string, signal?: AbortSignal, timeout = 10000) =>
    withModelWork(
      {
        operationId: id,
        priority: "background",
        deadline: Date.now() + timeout,
      },
      async () =>
        (
          await admission.fetch(
            new URL(id, server.url),
            signal ? { signal } : undefined,
          )
        ).text(),
    );
  const until = async (predicate: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await predicate()) return;
      await Bun.sleep(5);
    }
    throw new Error("admission_wait_timeout");
  };
  try {
    for (let i = 0; i < 6; i++)
      requests.push(invoke(`queued-duplicate-hold-${i}`));
    await until(async () => held.size === 6);
    const first = invoke(operationId, queued.signal).catch((error) => error);
    requests.push(first);
    await until(async () =>
      (await admission.status()).requests.some(
        (row) => row.operation_id === operationId && row.state === "queued",
      ),
    );
    await expect(invoke(operationId, undefined, 1000)).rejects.toThrow(
      "provider_uncertain",
    );
    expect(calls).toHaveLength(6);
    queued.abort();
    await first;
    const retry = invoke(operationId);
    requests.push(retry);
    held.get("/queued-duplicate-hold-0")!.close();
    held.delete("/queued-duplicate-hold-0");
    await until(async () => held.has(`/${operationId}`));
    for (const controller of held.values()) controller.close();
    held.clear();
    await Promise.all(requests);
    expect(calls.filter((path) => path === `/${operationId}`)).toHaveLength(1);
    expect(
      (await admission.status()).requests
        .filter((row) => row.operation_id === operationId)
        .map((row) => row.state),
    ).toEqual(["expired", "settled"]);
  } finally {
    queued.abort();
    for (const controller of held.values()) {
      try {
        controller.close();
      } catch {}
    }
    await Promise.allSettled(requests);
    server.stop(true);
    for (const request of (await admission.status()).requests)
      if (
        (request.operation_id === operationId ||
          String(request.operation_id).startsWith("queued-duplicate-hold-")) &&
        ["uncertain", "dispatched"].includes(request.state)
      )
        await admission.reconcile(request.id, {
          kind: "provider-terminated",
          reference: "controlled provider stopped after regression cleanup",
        });
    await admission.close();
  }
}, 10000);
