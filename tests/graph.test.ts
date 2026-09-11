import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { IdentityService } from "../src/identity.ts";
import { GraphService } from "../src/graph.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { ScriptedWikiModel } from "../src/development/wiki-model.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
async function fixture(model = new ScriptedWikiModel()) {
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
    graph = new GraphService(url!, access, sources, identities, model);
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
    ).toBe("staged");
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
    expect(result.claims[0]!.support[0]!.passageId).toBe(passage.id);
    expect(result.pending).toBe(false);
    expect(operation.documentId).toBe(listed[0]!.documentId);
  } finally {
    await f.close();
  }
}, 30000);
