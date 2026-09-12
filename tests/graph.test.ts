import { Operations } from "../src/operations.ts";
import { MaintenanceService } from "../src/maintenance.ts";
import { commitAckLoss } from "./fixtures/commit-ack-loss.ts";
import type { GraphRelation } from "../src/graph-types.ts";
import postgres from "postgres";
import { EvidenceService } from "../src/evidence.ts";
import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { IdentityService } from "../src/identity.ts";
import { GraphService } from "../src/graph.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { ScriptedWikiModel } from "../src/development/wiki-model.ts";
import { record, hash } from "../src/answer-validation.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");

for (const swapped of [false, true])
  test(`graph review validates mention bindings (swapped=${swapped})`, async () => {
    class MentionModel extends ScriptedWikiModel {
      override async request(
        ...args: Parameters<ScriptedWikiModel["request"]>
      ): Promise<unknown> {
        const [phase, input] = args;
        if (phase !== "graph_extraction" && phase !== "graph_review")
          return super.request(...args);
        const mentions = Array.isArray(input.mentions) ? input.mentions : [];
        const a = mentions.find(
          (item) => record(item) && item.text === "Alpha",
        );
        const b = mentions.find((item) => record(item) && item.text === "Beta");
        if (!record(a) || !record(b))
          return { relations: [], exclusions: [], complete: true };
        if (phase === "graph_review") {
          const packet = input.packet;
          const relations =
            record(packet) && Array.isArray(packet.relations)
              ? packet.relations
              : [];
          return {
            evidenceHash: hash(relations),
            complete: true,
            relations: relations.map((relation) => ({
              verdict:
                record(relation) &&
                relation.subjectMention === a.id &&
                relation.objectMention === b.id
                  ? "supported"
                  : "contradicted",
              qualifiersChecked: true,
            })),
          };
        }
        return {
          relations: [
            {
              subjectMention: swapped ? b.id : a.id,
              objectMention: swapped ? a.id : b.id,
              predicate: "dependency",
              direction: "forward",
              relationText: "Alpha 依赖 Beta。",
              scope: "source",
              qualifiers: {},
              locators: [a.passageId],
            },
          ],
          exclusions: [],
          complete: true,
        };
      }
    }
    const f = await fixture(new MentionModel());
    try {
      const operation = await f.source("Alpha 依赖 Beta。");
      const source = await f.sources.version(f.token, operation.versionId);
      const passage = source.passages[0]!;
      const a = await f.identities.record(f.token, {
        version: source.version,
        passageId: passage.id,
        label: "Alpha",
      });
      await f.identities.record(f.token, {
        version: source.version,
        passageId: passage.id,
        label: "Beta",
      });
      while (await f.graph.workOne(f.token)) {}
      const result = await f.graph.neighborhood(f.token, {
        entityId: a.canonicalId,
      });
      expect(result.claims).toHaveLength(swapped ? 0 : 1);
      if (!swapped)
        expect(result.claims[0]?.support).toEqual([
          { version: source.version, passageId: passage.id },
        ]);
      else
        expect(
          (await f.graph.inspect(f.token, operation.id)).generations[0]?.state,
        ).toBe("failed");
    } finally {
      await f.close();
    }
  }, 30000);
async function fixture(model = new ScriptedWikiModel(), leaseMs = 120000) {
  const access = new AccessService(url!),
    embeddings = new ControlledEmbeddings();
  await access.migrate();
  const account = {
    organization: `graph-${crypto.randomUUID()}`,
    username: "admin",
    password: "graph-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const sources = new SourceService(url!, access, embeddings),
    identities = new IdentityService(url!, access, sources),
    graph = new GraphService(url!, access, sources, identities, model, {
      leaseMs,
    });
  return {
    access,
    token,
    sources,
    identities,
    graph,
    async close() {
      await graph.close();
      await identities.close();
      await sources.close();
      await access.close();
    },
    async source(
      text: string,
      prior?: { documentId: string; versionId: string },
    ) {
      const operation = await sources.submit(token, {
        key: crypto.randomUUID(),
        filename: "关系.md",
        bytes: new TextEncoder().encode(text),
        ...(prior
          ? { documentId: prior.documentId, expectedPrior: prior.versionId }
          : {}),
      });
      await sources.workOne();
      return operation;
    },
  };
}
test("healthy Graph work crosses its original lease, keeps its generation and publishes reviewed coverage", async () => {
  const model = new ScriptedWikiModel();
  const request = model.request.bind(model);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  model.request = async (phase, input, signal) => {
    if (phase === "graph_extraction") {
      entered.resolve();
      await release.promise;
    }
    return request(phase, input, signal);
  };
  const f = await fixture(model, 300);
  const operations = new Operations(url!);
  let work: Promise<boolean> | undefined;
  try {
    const operation = await f.source("No relationships are stated.");
    const context = await f.access.authorize(f.token, "import");
    work = f.graph.workOne(f.token);
    await entered.promise;
    const before = await f.graph.inspect(f.token, operation.id);
    await Bun.sleep(750);
    expect(
      await operations.claim(["graph.refresh"], 300, context.organizationId),
    ).toBeUndefined();
    release.resolve();
    expect(await work).toBe(true);
    const after = await f.graph.inspect(f.token, operation.id);
    expect(after.generations[0]?.id).toBe(before.generations[0]?.id);
    expect(after.generations[0]?.deadlines).toEqual(
      before.generations[0]?.deadlines,
    );
    expect(after.generations[0]?.state).toBe("active");
    expect(after.generations[0]?.reviewed).toBe(after.generations[0]?.packets);
    const maintenance = new MaintenanceService(url!, f.access);
    try {
      const status = await maintenance.inspect(f.token, operation.id);
      expect(
        status.jobs.find((job) => job.kind === "graph.refresh")?.attempts,
      ).toBe(1);
    } finally {
      await maintenance.close();
    }
  } finally {
    release.resolve();
    await work;
    await operations.close();
    await f.close();
  }
}, 10000);

test("lost Graph ownership cancels started work and waits for its termination before settling", async () => {
  const model = new ScriptedWikiModel();
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let dispatches = 0;
  model.request = async (_phase, _input, signal) => {
    dispatches++;
    signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    entered.resolve();
    await finish.promise;
    throw new Error("provider_stopped");
  };
  const f = await fixture(model, 300);
  const operations = new Operations(url!);
  let work: Promise<boolean> | undefined;
  try {
    const operation = await f.source("A depends on B.");
    const context = await f.access.authorize(f.token, "import");
    let settled = false;
    work = f.graph.workOne(f.token).finally(() => {
      settled = true;
    });
    await entered.promise;
    await operations.sql`UPDATE knowledge_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=${operation.id} AND kind='graph.refresh'`;
    const replacement = (await operations.claim(
      ["graph.refresh"],
      60000,
      context.organizationId,
    ))!;
    await aborted.promise;
    expect(settled).toBe(false);
    expect(dispatches).toBe(1);
    await operations.commit(replacement, async () => {});
    finish.resolve();
    expect(await work).toBe(true);
    expect((await operations.committed(replacement))?.outcome).toBe(
      "succeeded",
    );
    expect(
      (await f.graph.inspect(f.token, operation.id)).generations[0]?.state,
    ).toBe("staged");
    expect(dispatches).toBe(1);
  } finally {
    finish.resolve();
    await work;
    await operations.close();
    await f.close();
  }
}, 10000);

for (const waiting of [true, false])
  test(`renewal failure stops Graph admission and preserves recovery budgets (waiting=${waiting})`, async () => {
    const model = new ScriptedWikiModel();
    const request = model.request.bind(model);
    const entered = Promise.withResolvers<void>();
    const f = await fixture(model, 900);
    const maintenance = new MaintenanceService(url!, f.access);
    const sql = postgres(url!, { max: 1, onnotice: () => {} });
    const faultName = `renewal_failure_${crypto.randomUUID().replaceAll("-", "")}`;
    let fail = true;
    let dispatches = 0;
    let work: Promise<boolean> | undefined;
    model.request = async (phase, input, signal) => {
      dispatches++;
      entered.resolve();
      if (fail) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        signal.throwIfAborted();
      }
      return request(phase, input, signal);
    };
    try {
      const operation = await f.source("No relationships are stated.");
      if (waiting)
        await sql`SELECT pg_advisory_lock(hashtextextended('loreweave:background-model',0))`;
      // A real database error on this operation's renewal, without breaking claim,
      // inspection, checkpoints or a replacement worker's fence increment.
      await sql.unsafe(
        `CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'renewal unavailable'; END $$`,
      );
      await sql.unsafe(
        `CREATE TRIGGER ${faultName} BEFORE UPDATE ON knowledge_jobs FOR EACH ROW WHEN (OLD.operation_id='${operation.id}'::uuid AND NEW.fence=OLD.fence AND NEW.lease_until IS DISTINCT FROM OLD.lease_until AND NEW.lease_until IS NOT NULL) EXECUTE FUNCTION ${faultName}()`,
      );
      work = f.graph.workOne(f.token);
      let before = await maintenance.inspect(f.token, operation.id);
      // Inspection reads jobs and requests separately. Wait for both the admitted
      // request and its durable deadline before freezing the recovery baseline.
      for (
        let i = 0;
        i < 100 &&
        (before.modelRequests.length === 0 ||
          !before.jobs.find((job) => job.kind === "graph.refresh")?.deadline);
        i++
      ) {
        await Bun.sleep(5);
        before = await maintenance.inspect(f.token, operation.id);
      }
      expect(before.modelRequests).toHaveLength(1);
      expect(
        before.jobs.find((job) => job.kind === "graph.refresh")?.deadline,
      ).toBeTruthy();
      if (!waiting) await entered.promise;
      const generation = (await f.graph.inspect(f.token, operation.id))
        .generations[0]!;
      expect(await work).toBe(true);
      await sql`SELECT pg_advisory_unlock_all()`;
      expect(dispatches).toBe(waiting ? 0 : 1);
      const failed = await maintenance.inspect(f.token, operation.id);
      expect(failed.modelRequests).toHaveLength(1);
      expect(failed.modelRequests[0]?.completedAt).toBeNull();
      expect(
        failed.jobs.find((job) => job.kind === "graph.refresh")?.receipt,
      ).toBeNull();
      await sql.unsafe(`DROP TRIGGER ${faultName} ON knowledge_jobs`);
      fail = false;
      // Expiry after settlement permits recovery; no abandoned heartbeat retains it.
      await Bun.sleep(1000);
      expect(await f.graph.workOne(f.token)).toBe(true);
      const recovered = await f.graph.inspect(f.token, operation.id);
      expect(recovered.generations[0]?.id).toBe(generation.id);
      expect(recovered.generations[0]?.deadlines).toEqual(generation.deadlines);
      expect(recovered.generations[0]?.state).toBe("active");
      const after = await maintenance.inspect(f.token, operation.id);
      expect(after.modelRequests).toHaveLength(3);
      expect(
        after.jobs.find((job) => job.kind === "graph.refresh")?.attempts,
      ).toBe(2);
      expect(
        after.jobs.find((job) => job.kind === "graph.refresh")?.deadline,
      ).toBe(before.jobs.find((job) => job.kind === "graph.refresh")?.deadline);
    } finally {
      await sql`SELECT pg_advisory_unlock_all()`;
      await work;
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${faultName} ON knowledge_jobs`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS ${faultName}()`);
      await sql.end();
      await maintenance.close();
      await f.close();
    }
  }, 10000);

test("Graph takeover preserves reviewed packets instead of dispatching them again", async () => {
  const model = new ScriptedWikiModel();
  const request = model.request.bind(model);
  const second = Promise.withResolvers<void>();
  const dispatches = new Map<string, number>();
  let interrupt = true;
  model.request = async (phase, input, signal) => {
    if (phase === "graph_extraction") {
      const key = hash(input);
      dispatches.set(key, (dispatches.get(key) ?? 0) + 1);
      if (interrupt && dispatches.size === 2) {
        second.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        signal.throwIfAborted();
      }
    }
    return request(phase, input, signal);
  };
  const f = await fixture(model, 300);
  const operations = new Operations(url!);
  let work: Promise<boolean> | undefined;
  try {
    const operation = await f.source(
      Array.from(
        { length: 6 },
        (_, index) =>
          `Section ${index}: ${"Ordinary source text. ".repeat(200)}`,
      ).join("\n\n"),
    );
    work = f.graph.workOne(f.token);
    await second.promise;
    const before = (await f.graph.inspect(f.token, operation.id))
      .generations[0]!;
    expect(before.reviewed).toBe(1);
    await operations.sql`UPDATE knowledge_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=${operation.id} AND kind='graph.refresh'`;
    await work;
    interrupt = false;
    expect(await f.graph.workOne(f.token)).toBe(true);
    const after = (await f.graph.inspect(f.token, operation.id))
      .generations[0]!;
    expect(after.id).toBe(before.id);
    expect(after.state).toBe("active");
    expect(after.reviewed).toBe(after.packets);
    expect([...dispatches.values()][0]).toBe(1);
    expect([...dispatches.values()][1]).toBe(2);
    for (const deadline of before.deadlines)
      expect(after.deadlines).toContainEqual(deadline);
  } finally {
    await work;
    await operations.close();
    await f.close();
  }
}, 10000);
test("graph extraction publishes a complete empty generation without inventing edges", async () => {
  const f = await fixture();
  try {
    const source = await f.source("系统说明：没有关系声明。");
    while (await f.graph.workOne(f.token)) {}
    const result = await f.graph.inspect(f.token, source.id);
    expect(result.generations).toHaveLength(1);
    expect(result.generations[0]!.state).toBe("active");
    expect(result.generations[0]!.packets).toBe(1);
    expect(result.generations[0]!.reviewed).toBe(1);
    expect(
      (await f.graph.neighborhood(f.token, { entityId: crypto.randomUUID() }))
        .claims,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);
test("changed sources supersede the previous graph generation and stale supports are not traversable", async () => {
  const f = await fixture();
  try {
    const first = await f.source("系统 A 依赖系统 B。");
    while (await f.graph.workOne(f.token)) {}
    const before = await f.graph.inspect(f.token, first.id);
    expect(before.generations[0]!.state).toBe("active");
    expect(
      before.generations[0]!.details.some((packet) =>
        packet.exclusions.some(
          (exclusion) => exclusion.kind === "unresolved_identity",
        ),
      ),
    ).toBe(true);
    const changed = await f.source("系统 A 不再依赖系统 B。", first);
    while (await f.graph.workOne(f.token)) {}
    const after = await f.graph.inspect(f.token, changed.id);
    expect(after.generations[0]!.state).toBe("active");
    expect(
      (await f.graph.neighborhood(f.token, { entityId: crypto.randomUUID() }))
        .pending,
    ).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);
test("packet extraction overflow leaves the staged generation unpublished", async () => {
  const model = new ScriptedWikiModel();
  const original = model.request.bind(model);
  model.request = async (phase, input, signal) => {
    if (phase === "graph_extraction")
      return {
        relations: Array.from({ length: 21 }, () => ({
          subjectMention: "a",
          objectMention: "b",
          predicate: "dependency",
          direction: "forward",
          relationText: "x",
          scope: "source",
          qualifiers: {},
          locators: [
            (input.pack as { items: [{ passageId: string }] }).items[0]!
              .passageId,
          ],
        })),
        exclusions: [],
        complete: true,
      };
    return original(phase, input, signal);
  };
  const f = await fixture(model);
  try {
    const source = await f.source("系统 A 依赖系统 B。");
    while (await f.graph.workOne(f.token)) {}
    expect(
      (await f.graph.inspect(f.token, source.id)).generations[0]!.state,
    ).toBe("failed");
  } finally {
    await f.close();
  }
}, 30000);

test("identity-backed supported relation is published and traversable with original locator", async () => {
  const model = new ScriptedWikiModel();
  let subjectMention = "";
  let objectMention = "";
  const original = model.request.bind(model);
  model.request = async (phase, input, signal) => {
    if (phase === "graph_extraction") {
      const item = (input.pack as { items: [{ passageId: string }] }).items[0]!;
      return {
        relations: [
          {
            subjectMention,
            objectMention,
            predicate: "dependency",
            direction: "forward",
            relationText: "系统 A 依赖系统 B。",
            scope: "source",
            qualifiers: { status: "current" },
            locators: [item.passageId],
          },
        ],
        exclusions: [],
        complete: true,
      };
    }
    return original(phase, input, signal);
  };
  const f = await fixture(model);
  try {
    const operation = await f.source("系统 A 依赖系统 B。");
    const listed = await f.sources.list(f.token);
    const version = await f.sources.version(f.token, listed[0]!.versionId);
    const passage = version.passages[0]!;
    subjectMention = (
      await f.identities.record(f.token, {
        version: version.version,
        passageId: passage.id,
        label: "系统 A",
      })
    ).id;
    objectMention = (
      await f.identities.record(f.token, {
        version: version.version,
        passageId: passage.id,
        label: "系统 B",
      })
    ).id;
    while (await f.graph.workOne(f.token)) {}
    const subject = await f.identities.inspect(f.token, subjectMention);
    const result = await f.graph.neighborhood(f.token, {
      entityId: subject.canonicalId,
      hops: 1,
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.predicate).toBe("dependency");
    expect(
      (await f.graph.search(f.token, "系统 A 使用什么？")).claims,
    ).toHaveLength(1);
    expect(result.claims[0]!.support[0]!.passageId).toBe(passage.id);
    const originals = await f.sources.resolveMany(
      f.token,
      result.claims[0]!.support,
    );
    expect(originals.get(`${version.version}:${passage.id}`)?.text).toBe(
      passage.text,
    );
    const evidence = new EvidenceService(f.sources, undefined, f.graph);
    const pack = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "系统 A 依赖系统 B。",
      signal: new AbortController().signal,
    });
    expect(pack.diagnostics.gaps).not.toContain("graph_support_unavailable");
    expect(pack.diagnostics.gaps).not.toContain("graph_unavailable");
    expect(
      pack.items.some(
        (item) =>
          item.passageId === passage.id &&
          item.documentId === operation.documentId &&
          item.title === version.title,
      ),
    ).toBe(true);
    evidence.release(pack.runId);
    expect(result.pending).toBe(false);
    expect(operation.documentId).toBe(listed[0]!.documentId);
  } finally {
    await f.close();
  }
}, 30000);

test("worker process replacement resumes the same graph generation and charged packet requests", async () => {
  const f = await fixture();
  const sql = postgres(url!, { onnotice: () => {} });
  try {
    const operation = await f.source("系统说明：没有关系声明。");
    const child = Bun.spawn(
      ["bun", "--no-env-file", "tests/fixtures/graph-crash-worker.ts"],
      {
        env: { ...process.env, GRAPH_TEST_TOKEN: f.token },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    expect(await child.exited).toBe(89);
    const before = await f.graph.inspect(f.token, operation.id);
    expect(before.generations).toHaveLength(1);
    expect(before.generations[0]!.state).toBe("staged");
    // Advance only this dead worker's lease at the real database failure boundary.
    await sql`UPDATE knowledge_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=${operation.id} AND kind='graph.refresh' AND state='running'`;
    await f.graph.workOne(f.token);
    const after = await f.graph.inspect(f.token, operation.id);
    expect(after.generations).toHaveLength(1);
    expect(after.generations[0]!.id).toBe(before.generations[0]!.id);
    expect(after.generations[0]!.state).toBe("active");
    expect(after.generations[0]!.deadlines).toEqual(
      before.generations[0]!.deadlines,
    );
    expect(
      after.generations[0]!.requests.filter(
        (request) => request.phase === "graph_extraction",
      ),
    ).toHaveLength(1);
    expect(
      after.generations[0]!.requests.filter(
        (request) => request.phase === "graph_review",
      ),
    ).toHaveLength(2);
    expect(await f.graph.workOne(f.token)).toBe(false);
  } finally {
    await sql.end();
    await f.close();
  }
}, 30000);

class Relations extends ScriptedWikiModel {
  rows = new Map<string, GraphRelation[]>();
  override async request(
    phase: import("../src/wiki-types.ts").WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (phase !== "graph_extraction")
      return super.request(phase, input, signal);
    const pack = input.pack as {
      items: Array<{ version: string; passageId: string }>;
    };
    const locators = new Set(pack.items.map((item) => item.passageId));
    return {
      relations: (this.rows.get(pack.items[0]?.version ?? "") ?? []).filter(
        (relation) => relation.locators.some((id) => locators.has(id)),
      ),
      exclusions: [],
      complete: true,
    };
  }
}
function relation(
  subject: string,
  object: string,
  passage: string,
): GraphRelation {
  return {
    subjectMention: subject,
    objectMention: object,
    predicate: "dependency",
    direction: "forward",
    relationText: "依赖",
    scope: "source",
    qualifiers: {},
    locators: [passage],
  };
}
test("neighborhood stops at the requested hop and retains unknown qualifiers", async () => {
  const model = new Relations(),
    f = await fixture(model);
  try {
    const op = await f.source(
      "系统甲依赖系统乙，系统乙依赖系统丙，系统丙依赖系统丁。",
    );
    const source = await f.sources.version(f.token, op.versionId),
      passage = source.passages[0]!;
    const mentions = [];
    for (const label of ["系统甲", "系统乙", "系统丙", "系统丁"])
      mentions.push(
        await f.identities.record(f.token, {
          version: op.versionId,
          passageId: passage.id,
          label,
        }),
      );
    model.rows.set(op.versionId, [
      relation(mentions[0]!.id, mentions[1]!.id, passage.id),
      relation(mentions[1]!.id, mentions[2]!.id, passage.id),
      relation(mentions[2]!.id, mentions[3]!.id, passage.id),
    ]);
    while (await f.graph.workOne(f.token)) {}
    const entity = (await f.identities.inspect(f.token, mentions[0]!.id))
      .canonicalId;
    const one = await f.graph.neighborhood(f.token, {
      entityId: entity,
      hops: 1,
    });
    expect(one.claims).toHaveLength(1);
    expect(one.claims[0]!.qualifiers.status).toBeUndefined();
    expect(
      (await f.graph.neighborhood(f.token, { entityId: entity, hops: 2 }))
        .claims,
    ).toHaveLength(2);
    expect(
      (await f.graph.search(f.token, "系统甲依赖什么？")).claims,
    ).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30000);

test("empty replacement retires only its source membership and preserves alternate support and history", async () => {
  const model = new Relations(),
    f = await fixture(model);
  try {
    const identitySource = await f.source("系统甲和系统乙是两个独立系统。");
    const identityPassage = (
      await f.sources.version(f.token, identitySource.versionId)
    ).passages[0]!;
    const a = await f.identities.record(f.token, {
      version: identitySource.versionId,
      passageId: identityPassage.id,
      label: "系统甲",
    });
    const b = await f.identities.record(f.token, {
      version: identitySource.versionId,
      passageId: identityPassage.id,
      label: "系统乙",
    });
    const first = await f.source("系统甲依赖系统乙。");
    const second = await f.source("系统甲依赖系统乙。");
    for (const op of [first, second]) {
      const passage = (await f.sources.version(f.token, op.versionId))
        .passages[0]!;
      model.rows.set(op.versionId, [relation(a.id, b.id, passage.id)]);
    }
    while (await f.graph.workOne(f.token)) {}
    const entityId = (await f.identities.inspect(f.token, a.id)).canonicalId;
    expect(
      (await f.graph.neighborhood(f.token, { entityId })).claims[0]!.support,
    ).toHaveLength(2);
    const changed = await f.source("关系已经移除。", first);
    expect(
      (
        await f.graph.neighborhood(f.token, { entityId })
      ).claims[0]!.support.map((ref) => ref.version),
    ).toEqual([second.versionId]);
    while (await f.graph.workOne(f.token)) {}
    expect(
      (await f.graph.inspect(f.token, changed.id)).generations[0]!.state,
    ).toBe("active");
    expect(
      (await f.graph.neighborhood(f.token, { entityId })).claims[0]!.support,
    ).toHaveLength(1);
    expect(
      (await f.graph.inspect(f.token, first.id)).generations[0]!.state,
    ).toBe("superseded");
    expect(
      (await f.graph.inspect(f.token, first.id)).generations[0]!.memberships,
    ).toBe(1);
    await f.source("两个系统的身份定义已删除。", identitySource);
    expect(
      (await f.graph.neighborhood(f.token, { entityId })).claims,
    ).toHaveLength(0);
    expect(
      (await f.graph.search(f.token, "系统甲依赖什么？")).claims,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);

test("long Chinese and non-BMP originals retain packet coverage and exact source offsets", async () => {
  const model = new ScriptedWikiModel();
  const original = model.request.bind(model);
  const observed: Array<{
    text: string;
    start: number;
    end: number;
    context: string;
  }> = [];
  model.request = async (phase, input, signal) => {
    if (phase === "graph_extraction")
      observed.push(...(input.pack as { items: typeof observed }).items);
    return original(phase, input, signal);
  };
  const f = await fixture(model);
  try {
    const text = "系统😀说明。".repeat(1600);
    const op = await f.source(text);
    while (await f.graph.workOne(f.token)) {}
    expect((await f.graph.inspect(f.token, op.id)).generations[0]!.state).toBe(
      "active",
    );
    expect(observed.length).toBeGreaterThan(1);
    for (const item of observed)
      expect(text.slice(item.start, item.end)).toBe(item.text);
    const spans = [
      ...new Map(observed.map((item) => [item.start, item])).values(),
    ].sort((a, b) => a.start - b.start);
    expect(spans.map((item) => item.text).join("")).toBe(text);
  } finally {
    await f.close();
  }
}, 30000);

test("dense neighborhoods expose truncation without exceeding fifty entities or one hundred claims", async () => {
  const model = new Relations(),
    f = await fixture(model);
  try {
    const texts = Array.from(
      { length: 6 },
      (_, group) =>
        Array.from(
          { length: 10 },
          (_, offset) =>
            `Node00 依赖 Node${String(group * 10 + offset + 1).padStart(2, "0")}。`,
        ).join(" ") + "补充说明。".repeat(130),
    );
    const op = await f.source(texts.join("\n\n"));
    const source = await f.sources.version(f.token, op.versionId);
    const root = await f.identities.record(f.token, {
      version: op.versionId,
      passageId: source.passages[0]!.id,
      label: "Node00",
    });
    const rows = [];
    for (let index = 1; index <= 60; index++) {
      const passage = source.passages[Math.floor((index - 1) / 10)]!;
      const mention = await f.identities.record(f.token, {
        version: op.versionId,
        passageId: passage.id,
        label: `Node${String(index).padStart(2, "0")}`,
      });
      rows.push(relation(root.id, mention.id, passage.id));
    }
    model.rows.set(op.versionId, rows);
    while (await f.graph.workOne(f.token)) {}
    expect((await f.graph.inspect(f.token, op.id)).generations[0]!.state).toBe(
      "active",
    );
    const result = await f.graph.neighborhood(f.token, {
      entityId: root.canonicalId,
    });
    expect(result.entities).toHaveLength(50);
    expect(result.claims).toHaveLength(49);
    expect(result.truncated).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

test("repeated crashed reviews keep the generation and exhaust the original review allowance", async () => {
  const f = await fixture();
  const sql = postgres(url!, { onnotice: () => {} });
  try {
    const op = await f.source("没有关系声明。");
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = Bun.spawn(
        ["bun", "--no-env-file", "tests/fixtures/graph-crash-worker.ts"],
        {
          env: { ...process.env, GRAPH_TEST_TOKEN: f.token },
          stdout: "ignore",
          stderr: "pipe",
        },
      );
      expect(await child.exited).toBe(89);
      await sql`UPDATE knowledge_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=${op.id} AND kind='graph.refresh' AND state='running'`;
    }
    await f.graph.workOne(f.token);
    const result = await f.graph.inspect(f.token, op.id);
    expect(result.generations).toHaveLength(1);
    expect(result.generations[0]!.state).toBe("failed");
    expect(
      result.generations[0]!.requests.filter(
        (request) => request.phase === "graph_review",
      ),
    ).toHaveLength(2);
    expect((await f.sources.inspect(f.token, op.id)).graph).toBe("failed");
    expect(await f.graph.workOne(f.token)).toBe(false);
  } finally {
    await sql.end();
    await f.close();
  }
}, 30000);

for (const table of ["identity_mentions", "graph_generations"]) {
  test(`graph search cancels PostgreSQL lock waits in ${table}`, async () => {
    const f = await fixture();
    const sql = postgres(url!, { max: 1, onnotice: () => {} });
    const observer = postgres(url!, { onnotice: () => {} });
    try {
      await sql`BEGIN`;
      await sql.unsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      const controller = new AbortController();
      const search = f.graph.search(
        f.token,
        "unknown seed",
        undefined,
        controller.signal,
      );
      const outcome = search.then(
        () => undefined,
        (error: unknown) => error,
      );
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [row] =
          await observer`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE ${`%${table}%`}) AS waiting`;
        waiting = row?.waiting === true;
        if (!waiting) await Bun.sleep(10);
      }
      expect(waiting).toBe(true);
      const start = performance.now();
      controller.abort();
      expect(await outcome).toBeInstanceOf(Error);
      expect(performance.now() - start).toBeLessThan(1000);
    } finally {
      await sql`ROLLBACK`;
      await sql.end();
      await observer.end();
      await f.close();
    }
  }, 10000);
}

test("resolved endpoint exclusions replace the dependent source generation across source boundaries", async () => {
  const model = new Relations(),
    f = await fixture(model);
  try {
    const identitySource = await f.source(
      "“系统甲”与“系统别名”指同一实体。\n\n系统乙独立存在。",
    );
    const p = (await f.sources.version(f.token, identitySource.versionId))
      .passages[0]!;
    const a = await f.identities.record(f.token, {
      version: identitySource.versionId,
      passageId: p.id,
      label: "系统甲",
    });
    const alias = await f.identities.record(f.token, {
      version: identitySource.versionId,
      passageId: p.id,
      label: "系统别名",
    });
    const b = await f.identities.record(f.token, {
      version: identitySource.versionId,
      passageId: (await f.sources.version(f.token, identitySource.versionId))
        .passages[1]!.id,
      label: "系统乙",
    });
    const dependent = await f.source("系统别名依赖系统乙。");
    const passage = (await f.sources.version(f.token, dependent.versionId))
      .passages[0]!;
    model.rows.set(dependent.versionId, [relation(alias.id, b.id, passage.id)]);
    // An extraction-declared unresolved endpoint is durable even without a support.
    const request = model.request.bind(model);
    let unresolved = true;
    model.request = async (phase, input, signal) => {
      const result = await request(phase, input, signal);
      if (
        unresolved &&
        phase === "graph_extraction" &&
        (input.pack as { items: Array<{ version: string }> }).items[0]
          ?.version === dependent.versionId
      )
        return {
          relations: [],
          exclusions: [
            {
              kind: "unresolved_identity",
              mention: alias.id,
              reason: "identity decision pending",
            },
          ],
          complete: true,
        };
      return result;
    };
    while (await f.graph.workOne(f.token)) {}
    expect((await f.graph.search(f.token, "系统别名依赖什么")).gaps).toContain(
      "graph_exclusions",
    );
    expect(
      (await f.graph.inspect(f.token, dependent.id)).generations[0]!
        .memberships,
    ).toBe(0);
    unresolved = false;
    const bound = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: alias.id,
      targetId: a.id,
      expectedRevision: alias.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [{ version: identitySource.versionId, passageId: p.id }],
        },
      ],
    });
    while (await f.graph.workOne(f.token)) {}
    const result = await f.graph.neighborhood(f.token, {
      entityId: bound.canonicalId,
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.support[0]!.version).toBe(dependent.versionId);
    expect(result.gaps).not.toContain("graph_exclusions");
    expect(
      (await f.graph.inspect(f.token, dependent.id)).generations[0]!.state,
    ).toBe("superseded");
  } finally {
    await f.close();
  }
}, 30000);

test("successful retry clears historical coverage failure and unrelated project jobs stay out of scope", async () => {
  const model = new ScriptedWikiModel(),
    f = await fixture(model);
  const operations = new Operations(url!);
  try {
    const request = model.request.bind(model);
    let failing = true;
    model.request = async (phase, input, signal) => {
      if (failing && phase === "graph_extraction")
        throw new Error("provider unavailable");
      return request(phase, input, signal);
    };
    const source = await f.source("没有关系声明。");
    while (await f.graph.workOne(f.token)) {}
    expect((await f.graph.search(f.token, "unknown")).gaps).toContain(
      "graph_incomplete",
    );
    failing = false;
    const context = await f.access.authorize(f.token, "import");
    await operations.accept(
      context,
      crypto.randomUUID(),
      "reprocess",
      async (tx, id) => {
        await operations.enqueue(tx, id, "graph.refresh", {
          versionId: source.versionId,
        });
      },
    );
    while (await f.graph.workOne(f.token)) {}
    expect((await f.graph.search(f.token, "unknown")).gaps).not.toContain(
      "graph_incomplete",
    );
    const first = await f.access.createProject(f.token, "first");
    const second = await f.access.createProject(f.token, "second");
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "private.md",
      bytes: new TextEncoder().encode("没有关系声明。"),
      projectId: second.id,
    });
    await f.sources.workOne();
    expect((await f.graph.search(f.token, "unknown", second.id)).pending).toBe(
      true,
    );
    expect((await f.graph.search(f.token, "unknown", first.id)).pending).toBe(
      false,
    );
  } finally {
    await operations.close();
    await f.close();
  }
}, 30000);

test("graph publication survives lost PostgreSQL COMMIT acknowledgement without duplicate memberships", async () => {
  const model = new Relations(),
    f = await fixture(model);
  const proxy = await commitAckLoss(
    url!,
    /UPDATE graph_generations SET state='active'/,
  );
  const worker = new GraphService(
    proxy.url,
    f.access,
    f.sources,
    f.identities,
    model,
  );
  const maintenance = new MaintenanceService(url!, f.access);
  try {
    const source = await f.source("系统甲依赖系统乙。");
    const passage = (await f.sources.version(f.token, source.versionId))
      .passages[0]!;
    const a = await f.identities.record(f.token, {
      version: source.versionId,
      passageId: passage.id,
      label: "系统甲",
    });
    const b = await f.identities.record(f.token, {
      version: source.versionId,
      passageId: passage.id,
      label: "系统乙",
    });
    model.rows.set(source.versionId, [relation(a.id, b.id, passage.id)]);
    await worker.workOne(f.token);
    expect(proxy.dropped).toBe(true);
    const status = await maintenance.inspect(f.token, source.id);
    const job = status.jobs.find((job) => job.kind === "graph.refresh")!;
    expect(job.state).toBe("succeeded");
    expect(job.receipt.outcome).toBe("succeeded");
    await worker.close();
    expect(await f.graph.workOne(f.token)).toBe(false);
    const inspected = await f.graph.inspect(f.token, source.id);
    expect(inspected.generations).toHaveLength(1);
    expect(inspected.generations[0]!.memberships).toBe(1);
    expect(
      (await f.graph.neighborhood(f.token, { entityId: a.canonicalId })).claims,
    ).toHaveLength(1);
  } finally {
    await worker.close();
    await proxy.close();
    await maintenance.close();
    await f.close();
  }
}, 30000);

test("distant Markdown anchors bridge actual originals and missing references leave visible incomplete coverage", async () => {
  const model = new ScriptedWikiModel(),
    f = await fixture(model);
  const request = model.request.bind(model);
  let bridged = false;
  model.request = async (phase, input, signal) => {
    if (phase === "graph_extraction") {
      const items = (input.pack as { items: Array<{ text: string }> }).items;
      if (
        items.some((item) => item.text.includes("[依赖详情]")) &&
        items.some((item) => item.text.includes("最终系统"))
      )
        bridged = true;
    }
    return request(phase, input, signal);
  };
  try {
    const source = await f.source(
      "# 概述\n系统关系见[依赖详情](#详情)。\n\n# 中间\n" +
        "无关说明。".repeat(900) +
        "\n\n# 详情\n最终系统负责存储。\n",
    );
    while (await f.graph.workOne(f.token)) {}
    expect(bridged).toBe(true);
    expect(
      (await f.graph.inspect(f.token, source.id)).generations[0]!.state,
    ).toBe("active");
    const missing = await f.source("关系见[详情](#不存在)。");
    while (await f.graph.workOne(f.token)) {}
    const result = (await f.graph.inspect(f.token, missing.id)).generations[0]!;
    expect(result.state).toBe("failed");
    expect(result.coverage.failure).toBe(
      "needs_attention:graph_bridge_context",
    );
    expect((await f.graph.search(f.token, "关系")).gaps).toContain(
      "graph_incomplete",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("an identity event consumed during extraction cannot strand a later registered exclusion", async () => {
  const model = new Relations(),
    f = await fixture(model);
  const other = new GraphService(
    url!,
    f.access,
    f.sources,
    f.identities,
    model,
  );
  try {
    const source = await f.source(
      "“系统甲”与“系统别名”指同一实体。\n\n系统乙独立存在。",
    );
    const passages = (await f.sources.version(f.token, source.versionId))
      .passages;
    const a = await f.identities.record(f.token, {
      version: source.versionId,
      passageId: passages[0]!.id,
      label: "系统甲",
    });
    const alias = await f.identities.record(f.token, {
      version: source.versionId,
      passageId: passages[0]!.id,
      label: "系统别名",
    });
    const b = await f.identities.record(f.token, {
      version: source.versionId,
      passageId: passages[1]!.id,
      label: "系统乙",
    });
    while (await f.graph.workOne(f.token)) {}
    const dependent = await f.source("系统别名依赖系统乙。");
    const p = (await f.sources.version(f.token, dependent.versionId))
      .passages[0]!;
    model.rows.set(dependent.versionId, [relation(alias.id, b.id, p.id)]);
    const request = model.request.bind(model);
    let interrupted = false;
    model.request = async (phase, input, signal) => {
      if (
        !interrupted &&
        phase === "graph_extraction" &&
        (input.pack as { items: Array<{ version: string }> }).items[0]
          ?.version === dependent.versionId
      ) {
        interrupted = true;
        await f.identities.bind(f.token, {
          key: crypto.randomUUID(),
          mentionId: alias.id,
          targetId: a.id,
          expectedRevision: alias.revisionId,
          witnesses: [
            {
              kind: "equivalence",
              sources: [
                { version: source.versionId, passageId: passages[0]!.id },
              ],
            },
          ],
        });
        expect(await other.workOne(f.token)).toBe(true);
        return {
          relations: [],
          exclusions: [
            {
              kind: "unresolved_identity",
              mention: alias.id,
              reason: "pre-correction extraction",
            },
          ],
          complete: true,
        };
      }
      return request(phase, input, signal);
    };
    while (await f.graph.workOne(f.token)) {}
    expect(interrupted).toBe(true);
    const result = await f.graph.inspect(f.token, dependent.id);
    expect(result.generations).toHaveLength(2);
    expect(
      result.generations.filter(
        (generation) => generation.state === "superseded",
      ),
    ).toHaveLength(1);
    expect(
      result.generations.filter((generation) => generation.state === "active"),
    ).toHaveLength(1);
    expect(
      (await f.graph.neighborhood(f.token, { entityId: a.canonicalId })).claims,
    ).toHaveLength(1);
  } finally {
    await other.close();
    await f.close();
  }
}, 30000);
