import { expect, test, spyOn } from "bun:test";
import { GraphService } from "../src/graph.ts";
import { SourceService } from "../src/sources.ts";
import { AccessService } from "../src/access.ts";
import { connect } from "node:net";
import { KnowledgeHost } from "../src/host.ts";
import { evaluationFixture } from "../src/evaluation/fixture.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");

test("failed fixture construction releases its database before returning an error", async () => {
  const failure = new Error("fixture_setup_failed");
  let acquired: AccessService | undefined;
  const migrate = AccessService.prototype.migrate;
  const fault = spyOn(AccessService.prototype, "migrate").mockImplementation(
    async function (this: AccessService) {
      acquired = this;
      await migrate.call(this);
      throw failure;
    },
  );
  try {
    await expect(evaluationFixture(url!)).rejects.toBe(failure);
    expect(acquired).toBeDefined();
    await expect(acquired!.organization("missing")).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
  } finally {
    fault.mockRestore();
    await acquired?.close();
  }
}, 30000);

function listening(endpoint: string): Promise<boolean> {
  const target = new URL(endpoint);
  return new Promise((resolve) => {
    const socket = connect(Number(target.port), target.hostname);
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Narrow fault injection at construction/release boundaries. Outcomes use real
// database queries and loopback sockets, not constructor or private-order assertions.
test("fixture listener setup failure closes acquired listeners and hosts despite a release failure", async () => {
  const setupFailure = new Error("listener_setup_failed");
  const cleanupFailure = new Error("access_release_failed");
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const hosts: KnowledgeHost[] = [];
  const serve = Bun.serve;
  const hostClose = KnowledgeHost.prototype.close;
  const accessClose = AccessService.prototype.close;
  let acquired: AccessService | undefined;
  const listenerFault = spyOn(Bun, "serve").mockImplementation((options) => {
    // Provider, corruption proxy and the first public listener are already live.
    if (servers.length === 3) throw setupFailure;
    const server = serve(options);
    servers.push(server);
    return server;
  });
  const hostObservation = spyOn(
    KnowledgeHost.prototype,
    "close",
  ).mockImplementation(async function (this: KnowledgeHost) {
    hosts.push(this);
    await hostClose.call(this);
  });
  const releaseFault = spyOn(
    AccessService.prototype,
    "close",
  ).mockImplementation(async function (this: AccessService) {
    acquired = this;
    await accessClose.call(this);
    throw cleanupFailure;
  });
  try {
    await expect(
      evaluationFixture(url!, true, "combined", true),
    ).rejects.toMatchObject({
      errors: [setupFailure, { errors: [cleanupFailure] }],
    });
    expect(servers).toHaveLength(3);
    for (const server of servers)
      expect(await listening(String(server.url))).toBe(false);
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts)
      await expect(
        host.start({ question: "生产日志保留多久？" }),
      ).rejects.toThrow("unavailable");
    await expect(acquired!.organization("missing")).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
  } finally {
    listenerFault.mockRestore();
    hostObservation.mockRestore();
    releaseFault.mockRestore();
    for (const server of servers) await server.stop(true);
    for (const host of hosts) await hostClose.call(host);
    await acquired?.close();
  }
}, 30000);

test("fixture close shares completion and releases other dependencies after one release fails", async () => {
  const f = await evaluationFixture(url!, true, "combined", true);
  const failure = new Error("wiki_release_failed");
  const closeWiki = f.wiki!.close.bind(f.wiki);
  let releases = 0;
  const fault = spyOn(f.wiki!, "close").mockImplementation(async () => {
    releases++;
    await closeWiki();
    throw failure;
  });
  try {
    const first = f.close();
    expect(f.close()).toBe(first);
    await expect(first).rejects.toMatchObject({ errors: [failure] });
    await expect(f.close()).rejects.toMatchObject({ errors: [failure] });
    expect(releases).toBe(1);
    for (const client of Object.values(f.clients))
      await expect(
        client.configuration(AbortSignal.timeout(1000)),
      ).rejects.toThrow();
    expect(await listening(f.provider.url)).toBe(false);
    await expect(f.sources.list(f.token)).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
    await expect(f.access.organization("missing")).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
  } finally {
    fault.mockRestore();
    await f.close().catch(() => {});
  }
}, 30000);

test("fixture shutdown stops every profile ingress and retains dependencies until Knowledge run settlement", async () => {
  const f = await evaluationFixture(url!);
  const entered = gate(),
    aborted = gate(),
    finish = gate();
  const candidates = f.sources.candidates.bind(f.sources);
  const work = spyOn(f.sources, "candidates").mockImplementation(
    async (token, input) => {
      input.signal.addEventListener("abort", aborted.resolve, { once: true });
      entered.resolve();
      await finish.promise;
      return candidates(token, input);
    },
  );
  let closed = false;
  try {
    const run = await f.host.start({
      credential: f.token,
      question: "生产日志保留多久？",
    });
    await entered.promise;
    const first = f.close();
    expect(f.close()).toBe(first);
    void first.then(() => {
      closed = true;
    });
    await aborted.promise;
    expect(closed).toBe(false);
    for (const client of Object.values(f.clients))
      await expect(
        client.configuration(AbortSignal.timeout(1000)),
      ).rejects.toThrow();
    expect(await listening(f.provider.url)).toBe(true);
    expect(await f.sources.list(f.token)).toHaveLength(1);
    finish.resolve();
    await first;
    await f.host.settled(run.id);
    expect(closed).toBe(true);
    expect(await listening(f.provider.url)).toBe(false);
    await expect(f.sources.list(f.token)).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
  } finally {
    finish.resolve();
    work.mockRestore();
    await f.close();
  }
}, 30000);

test("provider smoke preserves pre-dispatch failure and cleanup diagnostics while releasing its database", async () => {
  const { runProviderSmoke } =
    await import("../src/evaluation/provider-smoke.ts");
  const failure = new Error("smoke_setup_failed");
  const cleanupFailure = new Error("smoke_cleanup_failed");
  let acquired: AccessService | undefined;
  const migrate = AccessService.prototype.migrate;
  const graphClose = GraphService.prototype.close;
  let acquiredSources: SourceService | undefined;
  let token: string | undefined;
  const setupFault = spyOn(
    AccessService.prototype,
    "migrate",
  ).mockImplementation(async function (this: AccessService) {
    acquired = this;
    await migrate.call(this);
  });
  const sourceFault = spyOn(
    SourceService.prototype,
    "submit",
  ).mockImplementation(async function (this: SourceService, credential) {
    acquiredSources = this;
    token = credential;
    await this.list(credential);
    throw failure;
  });
  const releaseFault = spyOn(
    GraphService.prototype,
    "close",
  ).mockImplementation(async function (this: GraphService) {
    await graphClose.call(this);
    throw cleanupFailure;
  });
  let requests = 0;
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++;
      return new Response(null, { status: 500 });
    },
  });
  const baseUrl = String(provider.url);
  try {
    await expect(
      runProviderSmoke(url!, {
        chat: { baseUrl, apiKey: "local", model: "local", timeoutMs: 1000 },
        embedding: {
          baseUrl,
          apiKey: "local",
          model: "local",
          timeoutMs: 1000,
          dimensions: 1024,
          batchSize: 16,
          sendDimensions: false,
        },
        exploration: {
          baseUrl,
          apiKey: "local",
          model: "local",
          provider: "huggingface",
        },
      }),
    ).rejects.toMatchObject({
      errors: [failure, { errors: [cleanupFailure] }],
    });
    expect(requests).toBe(0);
    await expect(acquiredSources!.list(token!)).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
    expect(await listening(baseUrl)).toBe(true); // The caller owns this provider.
    await expect(acquired!.organization("missing")).rejects.toMatchObject({
      cause: { code: "CONNECTION_ENDED" },
    });
  } finally {
    setupFault.mockRestore();
    sourceFault.mockRestore();
    releaseFault.mockRestore();
    await acquiredSources?.close();
    await acquired?.close();
    await provider.stop(true);
  }
}, 30000);
