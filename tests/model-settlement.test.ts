import { expect, test, spyOn } from "bun:test";
import { AccessService } from "../src/access.ts";
import { ModelAdmission, withModelWork } from "../src/model-admission.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");

test("a caller deadline followed by a completed provider response must not permanently consume admission", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  await access.close();
  const admission = new ModelAdmission(url!);
  let completed = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      await Bun.sleep(150);
      completed = true;
      return Response.json({ done: true });
    },
  });
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("caller_deadline")),
    75,
  );
  try {
    await withModelWork(
      {
        operationId: crypto.randomUUID(),
        priority: "interactive",
        deadline: Date.now() + 10000,
      },
      async () => {
        try {
          await (
            await admission.fetch(server.url, { signal: controller.signal })
          ).text();
        } catch {}
      },
    );
    for (let i = 0; i < 100 && !completed; i++) await Bun.sleep(5);
    expect(completed).toBe(true);
    await Bun.sleep(50);
    expect((await admission.status()).active).toBe(0);
  } finally {
    clearTimeout(timer);
    server.stop(true);
    await admission.close();
  }
}, 5000);

async function until(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error("settlement_wait_timeout");
}
const invoke = (
  admission: ModelAdmission,
  endpoint: URL,
  operationId: string,
  signal?: AbortSignal,
) =>
  withModelWork(
    { operationId, priority: "interactive", deadline: Date.now() + 5000 },
    async () =>
      (await admission.fetch(endpoint, signal ? { signal } : undefined)).text(),
  );

test("eight canceled consumers retain eight open transports, then a ninth request proceeds", async () => {
  const admission = new ModelAdmission(url!);
  const held: ReadableStreamDefaultController<Uint8Array>[] = [];
  const cancel = new AbortController();
  let calls = 0,
    active = 0,
    peak = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      active++;
      peak = Math.max(peak, active);
      if (calls > 8) {
        active--;
        return new Response("next");
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            held.push(c);
            c.enqueue(new Uint8Array([1]));
          },
        }),
      );
    },
  });
  const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
  const requests = ids.map((id) =>
    invoke(admission, server.url, id, cancel.signal).catch(() => "canceled"),
  );
  try {
    await until(() => held.length === 8);
    cancel.abort();
    await Promise.all(requests);
    expect((await admission.status()).active).toBe(8);
    const ninth = invoke(admission, server.url, crypto.randomUUID());
    await Bun.sleep(50);
    expect(calls).toBe(8);
    active--;
    held.shift()!.close();
    expect(await ninth).toBe("next");
    for (const c of held.splice(0)) {
      active--;
      c.close();
    }
    await Promise.all(ids.map((id) => admission.settled(id)));
    expect((await admission.status()).active).toBe(0);
    expect(peak).toBe(8);
  } finally {
    cancel.abort();
    for (const c of held) {
      try {
        c.close();
      } catch {}
    }
    server.stop(true);
    await admission.close();
  }
});

test("SSE DONE and SiliconFlow trace survive caller cancellation before headers", async () => {
  const admission = new ModelAdmission(url!);
  const cancel = new AbortController();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const started = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      started.resolve();
      await Bun.sleep(50);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            c.enqueue(
              new TextEncoder().encode('data: {"text":"not [DONE]"}\n\n'),
            );
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "x-siliconcloud-trace-id": "silicon-trace-fixture",
          },
        },
      );
    },
  });
  const id = crypto.randomUUID();
  const request = invoke(admission, server.url, id, cancel.signal).catch(
    () => "canceled",
  );
  try {
    await started.promise;
    cancel.abort();
    expect(await request).toBe("canceled");
    await until(() => Boolean(controller));
    controller.enqueue(new TextEncoder().encode("data: [DO"));
    controller.enqueue(new TextEncoder().encode("NE]\n\n"));
    await admission.settled(id);
    const row = (await admission.status()).requests.find(
      (r) => r.operation_id === id,
    )!;
    expect(row.state).toBe("settled");
    expect(row.outcome).toBe("provider_stream_done");
    expect(row.provider_request_id).toBe("silicon-trace-fixture");
    expect(row.consumer_ended_at).toBeTruthy();
    expect((await admission.status()).active).toBe(0);
  } finally {
    server.stop(true);
    await admission.close();
  }
});

test("truncated SSE keeps uncertainty and replay protection but releases the ended connection", async () => {
  const admission = new ModelAdmission(url!);
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      return new Response('data: {"delta":"partial"}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const id = crypto.randomUUID();
  try {
    await invoke(admission, server.url, id);
    await admission.settled(id);
    const status = await admission.status();
    const row = status.requests.find((r) => r.operation_id === id)!;
    expect(row.state).toBe("uncertain");
    expect(row.outcome).toBe("stream_missing_done");
    expect(row.capacity_released_at).toBeTruthy();
    expect(status.active).toBe(0);
    await expect(invoke(admission, server.url, id)).rejects.toThrow(
      "provider_uncertain",
    );
    expect(calls).toBe(1);
    await invoke(admission, server.url, crypto.randomUUID());
    expect(calls).toBe(2);
  } finally {
    server.stop(true);
    await admission.close();
  }
});

test("bounded transport cleanup breaks backpressure even when a consumer never reads", async () => {
  const admission = new ModelAdmission(url!, 30000, 150);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
        }),
      );
    },
  });
  const id = crypto.randomUUID();
  try {
    const response = await withModelWork(
      { operationId: id, priority: "interactive", deadline: Date.now() + 5000 },
      () => admission.fetch(server.url),
    );
    await admission.settled(id);
    await expect(response.text()).rejects.toThrow();
    const row = (await admission.status()).requests.find(
      (r) => r.operation_id === id,
    )!;
    expect(row.state).toBe("uncertain");
    expect(row.capacity_released_at).toBeTruthy();
    expect((await admission.status()).active).toBe(0);
  } finally {
    server.stop(true);
    await admission.close();
  }
});

test("close during pre-dispatch accounting prevents HTTP and waits for admission to finish", async () => {
  const admission = new ModelAdmission(url!);
  let calls = 0;
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      return new Response("unexpected");
    },
  });
  const request = withModelWork(
    {
      operationId: crypto.randomUUID(),
      priority: "interactive",
      deadline: Date.now() + 5000,
      onDispatch: async () => {
        entered.resolve();
        await release.promise;
      },
    },
    () => admission.fetch(server.url),
  ).catch(() => "closed");
  try {
    await entered.promise;
    let closed = false;
    const closing = admission.close().then(() => {
      closed = true;
    });
    await Bun.sleep(30);
    expect(closed).toBe(false);
    release.resolve();
    expect(await request).toBe("closed");
    await closing;
    expect(calls).toBe(0);
  } finally {
    release.resolve();
    server.stop(true);
    await admission.close();
  }
});

test("lost owners remain blocked until audited client termination, without falsifying remote outcomes", async () => {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url!);
  const admission = new ModelAdmission(url!);
  const owner = crypto.randomUUID();
  const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("recovered");
    },
  });
  try {
    await sql`INSERT INTO model_owners(id,lease_until) VALUES(${owner},clock_timestamp()+interval '1 minute')`;
    for (const id of ids)
      await sql`INSERT INTO model_requests(id,operation_id,input_hash,owner,priority,state,deadline) VALUES(${id},${id},'fixture',${owner},'interactive','dispatched',clock_timestamp()+interval '1 minute')`;
    await expect(
      admission.releaseTerminatedClient(ids[0]!, "fixture termination"),
    ).rejects.toThrow("client_not_reconcilable");
    await sql`UPDATE model_owners SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${owner}`;
    await expect(
      invoke(admission, server.url, crypto.randomUUID()),
    ).rejects.toThrow("model_capacity_blocked");
    expect((await admission.status()).blocked).toBe(8);
    for (const id of ids)
      await admission.releaseTerminatedClient(
        id,
        "controlled fixture: owner has no process or connection",
      );
    const status = await admission.status();
    expect(status.active).toBe(0);
    expect(status.blocked).toBe(0);
    for (const row of status.requests.filter((r) => ids.includes(r.id))) {
      expect(row.state).toBe("uncertain");
      expect(row.settled_at).toBeNull();
      expect(row.capacity_release.kind).toBe("client-process-terminated");
    }
    expect(await invoke(admission, server.url, crypto.randomUUID())).toBe(
      "recovered",
    );
  } finally {
    for (const id of ids)
      await admission
        .releaseTerminatedClient(id, "fixture cleanup")
        .catch(() => {});
    server.stop(true);
    await admission.close();
    await sql.end();
  }
});

test("Host deadline and SDK dispose failure still wait for provider cleanup before settlement", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const provider = startScriptedProvider({ noRetrieval: true, delayMs: 1500 });
  const admission = new ModelAdmission(url!);
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    modelFetch: admission.fetch,
    settleModelWork: admission.settled.bind(admission),
    timing: { ordinaryMs: 800 },
  });
  try {
    const run = await host.start({ question: "水的沸点" });
    await until(() => Boolean(Reflect.get(host, "runs").get(run.id).agent));
    const agent = Reflect.get(host, "runs").get(run.id).agent;
    const dispose = agent.dispose.bind(agent);
    spyOn(agent, "dispose").mockImplementation(async () => {
      await dispose();
      throw new Error("sdk_dispose_failure");
    });
    await until(async () => Boolean((await host.get(run.id)).reason));
    expect((await host.get(run.id)).settledAt).toBeUndefined();
    expect((await admission.status()).active).toBe(1);
    await host.settled(run.id);
    expect((await host.get(run.id)).status).not.toBe("answered");
    expect((await admission.status()).active).toBe(0);
  } finally {
    await host.close();
    provider.stop();
    await admission.close();
  }
});

test("close detaches consumers while draining already dispatched responses", async () => {
  const admission = new ModelAdmission(url!);
  const received = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      received.resolve();
      await finish.promise;
      return new Response("late");
    },
  });
  const id = crypto.randomUUID();
  const request = invoke(admission, server.url, id).catch(() => "closed");
  try {
    await received.promise;
    let closed = false;
    const closing = admission.close().then(() => {
      closed = true;
    });
    expect(await request).toBe("closed");
    await Bun.sleep(30);
    expect(closed).toBe(false);
    finish.resolve();
    await closing;
    const observer = new ModelAdmission(url!);
    try {
      expect(
        (await observer.status()).requests.find((r) => r.operation_id === id)
          ?.state,
      ).toBe("settled");
    } finally {
      await observer.close();
    }
  } finally {
    finish.resolve();
    server.stop(true);
    await admission.close();
  }
});

test("provider execution timeout starts after queue admission", async () => {
  const { providerJSON } = await import("../src/providers/http.ts");
  const admission = new ModelAdmission(url!);
  const held: ReadableStreamDefaultController<Uint8Array>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(r) {
      if (new URL(r.url).pathname === "/json")
        return Response.json({ ok: true });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            held.push(c);
            c.enqueue(new Uint8Array([1]));
          },
        }),
      );
    },
  });
  const holding = Array.from({ length: 8 }, () =>
    invoke(admission, server.url, crypto.randomUUID()),
  );
  try {
    await until(() => held.length === 8);
    const queued = withModelWork(
      {
        operationId: crypto.randomUUID(),
        priority: "interactive",
        deadline: Date.now() + 5000,
      },
      () =>
        providerJSON(
          {
            fetch: admission.fetch,
            baseUrl: server.url.toString(),
            apiKey: "fixture",
            model: "fixture",
            timeoutMs: 100,
          },
          "json",
          {},
          new AbortController().signal,
        ),
    );
    void queued.catch(() => {});
    await Bun.sleep(200);
    for (const c of held.splice(0)) c.close();
    expect(await queued).toEqual({ ok: true });
    await Promise.all(holding);
  } finally {
    for (const c of held) {
      try {
        c.close();
      } catch {}
    }
    server.stop(true);
    await admission.close();
  }
});

test("provider reconciliation cannot free a still-owned HTTP connection", async () => {
  const admission = new ModelAdmission(url!);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            c.enqueue(new TextEncoder().encode("data: {}\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const id = crypto.randomUUID();
  const request = invoke(admission, server.url, id);
  try {
    await until(() => Boolean(controller));
    const row = (await admission.status()).requests.find(
      (r) => r.operation_id === id,
    )!;
    await expect(
      admission.reconcile(row.id, {
        kind: "provider-completed",
        reference: "provider log fixture",
      }),
    ).rejects.toThrow("not_reconcilable");
    expect((await admission.status()).active).toBe(1);
    controller.close();
    await request;
    await admission.settled(id);
    await admission.reconcile(row.id, {
      kind: "provider-completed",
      reference: "provider log fixture",
    });
    expect(
      (await admission.status()).requests.find((r) => r.id === row.id)?.state,
    ).toBe("settled");
  } finally {
    server.stop(true);
    await admission.close();
  }
});

test("owner retirement failure still closes its database pool", async () => {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url!);
  const admission = new ModelAdmission(url!);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  try {
    await invoke(admission, server.url, crypto.randomUUID());
    const end = spyOn(Reflect.get(admission, "sql"), "end");
    await sql`CREATE FUNCTION reject_test_owner_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'injected_owner_retirement_failure'; END IF; RETURN NEW; END $$`;
    await sql`CREATE TRIGGER reject_test_owner_retirement BEFORE UPDATE ON model_owners FOR EACH ROW EXECUTE FUNCTION reject_test_owner_retirement()`;
    await expect(admission.close()).rejects.toThrow(
      "injected_owner_retirement_failure",
    );
    expect(end).toHaveBeenCalledTimes(1);
    end.mockRestore();
  } finally {
    await sql`DROP TRIGGER IF EXISTS reject_test_owner_retirement ON model_owners`;
    await sql`DROP FUNCTION IF EXISTS reject_test_owner_retirement()`;
    server.stop(true);
    await admission.close().catch(() => {});
    await sql.end();
  }
});

test("an unrecorded completed transport remains a settlement error even after its consumer returns", async () => {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url!);
  const admission = new ModelAdmission(url!);
  const id = crypto.randomUUID();
  const cancel = new AbortController();
  const started = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      started.resolve();
      await finish.promise;
      return new Response("complete");
    },
  });
  const request = invoke(admission, server.url, id, cancel.signal).catch(
    () => {},
  );
  try {
    await started.promise;
    cancel.abort();
    await request;
    await sql`CREATE FUNCTION reject_test_transport_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.capacity_released_at IS NOT NULL THEN RAISE EXCEPTION 'injected_settlement_failure'; END IF; RETURN NEW; END $$`;
    await sql`CREATE TRIGGER reject_test_transport_settlement BEFORE UPDATE ON model_requests FOR EACH ROW EXECUTE FUNCTION reject_test_transport_settlement()`;
    finish.resolve();
    await Bun.sleep(100);
    await expect(admission.settled(id)).rejects.toThrow(
      "injected_settlement_failure",
    );
    await expect(admission.close()).rejects.toThrow(
      "injected_settlement_failure",
    );
  } finally {
    finish.resolve();
    await admission.close().catch(() => {});
    await sql`DROP TRIGGER IF EXISTS reject_test_transport_settlement ON model_requests`;
    await sql`DROP FUNCTION IF EXISTS reject_test_transport_settlement()`;
    const observer = new ModelAdmission(url!);
    try {
      const row = (await observer.status()).requests.find(
        (r) => r.operation_id === id,
      );
      if (row)
        await observer.releaseTerminatedClient(
          row.id,
          "fixture admission closed all transports and database",
        );
    } finally {
      await observer.close();
    }
    server.stop(true);
    await sql.end();
  }
});
