import { evaluationFixture } from "./fixture.ts";
import { MaintenanceDiagnostics } from "./maintenance.ts";
import { ScriptedWikiModel } from "../development/wiki-model.ts";
import { routingTargetsSchema, type MaintenanceDiagnostic } from "./schema.ts";
import type { GraphRelation } from "../graph-types.ts";
import type { WikiPhase } from "../wiki-types.ts";
class FixtureWiki extends ScriptedWikiModel {
  failAfterFirst = new Set<string>();
  first = new Map<string, string>();
  override async request(
    phase: WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const pack = input.pack as
      { hash: string; items: Array<{ version: string }> } | undefined;
    const version = pack?.items[0]?.version;
    if (phase === "extraction" && version && this.failAfterFirst.has(version)) {
      if (!this.first.has(version)) this.first.set(version, pack!.hash);
      else if (this.first.get(version) !== pack!.hash)
        throw new Error("fixture_extraction_failure");
    }
    return super.request(phase, input, signal);
  }
}
class FixtureGraph extends ScriptedWikiModel {
  rows = new Map<string, GraphRelation[]>();
  incomplete = new Set<string>();
  seen = new Map<string, Set<string>>();
  override async request(
    phase: WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (phase !== "graph_extraction")
      return super.request(phase, input, signal);
    const pack = input.pack as {
      hash: string;
      items: Array<{ version: string; passageId: string }>;
    };
    const version = pack.items[0]?.version ?? "";
    const seen = this.seen.get(version) ?? new Set<string>();
    seen.add(pack.hash);
    this.seen.set(version, seen);
    const locators = new Set(pack.items.map((item) => item.passageId));
    return {
      complete: !(this.incomplete.has(version) && seen.size > 1),
      relations: (this.rows.get(version) ?? []).filter((relation) =>
        relation.locators.some((locator) => locators.has(locator)),
      ),
      exclusions: [],
    };
  }
}
/** Bounded, executable integration. Diagnostics always come from the public API. */
export async function maintenanceFixture(database: string) {
  const model = new FixtureGraph();
  const wikiModel = new FixtureWiki();
  const f = await evaluationFixture(database, false, "combined", true, {
    graph: model,
    wiki: wikiModel,
  });
  const captures: Array<{
    scenario: string;
    operationId: string;
    diagnostics: MaintenanceDiagnostic[];
  }> = [];
  const inputs: Array<{ operationId: string; version: string; text: string }> =
    [];
  const wiki = f.wiki!,
    identities = f.identities!,
    graph = f.graph!;
  async function drain() {
    for (let step = 0; step < 250; step++) {
      const identity = await identities.workOne(f.token);
      const page = await wiki.workOne(f.token);
      const relation = await graph.workOne(f.token);
      if (!identity && !page && !relation) return;
    }
    throw new Error("fixture_worker_limit");
  }
  async function source(
    text: string,
    prior?: { documentId: string; versionId: string },
  ) {
    const operation = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "maintenance-fixture.md",
      bytes: new TextEncoder().encode(text),
      ...(prior
        ? { documentId: prior.documentId, expectedPrior: prior.versionId }
        : {}),
    });
    await f.sources.workOne();
    inputs.push({
      operationId: operation.id,
      version: operation.versionId,
      text,
    });
    return operation;
  }
  async function capture(
    scenario: string,
    operationId: string,
    subjects: { mentionIds?: string[]; entityIds?: string[] } = {},
    referencePages: string[] = [],
  ) {
    const target = routingTargetsSchema.parse({
      schemaVersion: 1,
      version: "controlled-routing-v1",
      split: "development",
      examples: referencePages.length
        ? [
            {
              operationId,
              topicKey: "topic:0",
              referencePages,
              expectedDecision: "reuse",
              references: [],
              review: { kind: "fixture", oracle: "same-log-topic-v1" },
            },
          ]
        : [],
    });
    const diagnostics = await new MaintenanceDiagnostics(
      f.client,
      "controlled-provider",
      target,
      subjects,
    ).capture(operationId);
    captures.push({ scenario, operationId, diagnostics });
  }
  try {
    const first = (await f.sources.list(f.token))[0]!;
    inputs.push({
      operationId: first.id,
      version: first.versionId,
      text: "生产日志保留 30 天。",
    });
    await drain();
    await capture("initial", first.id);
    const page = (await wiki.list(f.token)).items[0]!;
    const retired = await source("无", first);
    await capture("before-maintenance", retired.id);
    await drain();
    await capture("retired", retired.id);
    const revived = await source("生产日志保留 90 天。", retired);
    await drain();
    await capture("reactivated", revived.id, {}, [page.id]);

    const identitySource = await source(
      "“系统甲”与“系统别名”指同一实体。\n\n系统乙独立存在。",
    );
    const originals = await f.sources.version(
      f.token,
      identitySource.versionId,
    );
    const a = await identities.record(f.token, {
      version: identitySource.versionId,
      passageId: originals.passages[0]!.id,
      label: "系统甲",
    });
    const alias = await identities.record(f.token, {
      version: identitySource.versionId,
      passageId: originals.passages[0]!.id,
      label: "系统别名",
    });
    const b = await identities.record(f.token, {
      version: identitySource.versionId,
      passageId: originals.passages[1]!.id,
      label: "系统乙",
    });
    await identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: alias.id,
      targetId: a.id,
      expectedRevision: alias.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            {
              version: identitySource.versionId,
              passageId: originals.passages[0]!.id,
            },
          ],
        },
      ],
    });
    const related = [];
    for (let count = 0; count < 2; count++) {
      const op = await source("系统别名依赖系统乙。");
      related.push(op);
      const passage = (await f.sources.version(f.token, op.versionId))
        .passages[0]!;
      model.rows.set(op.versionId, [
        {
          subjectMention: alias.id,
          objectMention: b.id,
          predicate: "dependency",
          direction: "forward",
          relationText: passage.text,
          scope: "source",
          qualifiers: {},
          locators: [passage.id],
        },
      ]);
    }
    await drain();
    const subjects = { mentionIds: [alias.id], entityIds: [a.canonicalId] };
    await capture("alternate-support", related[0]!.id, subjects);
    const empty = await source("关系已经移除。", related[0]);
    await drain();
    await capture("empty-replacement", empty.id, subjects);
    await capture("historical-membership", related[0]!.id, subjects);
    const invalidated = await source("系统身份定义已移除。", identitySource);
    await capture("immediate-proof-invalidation", invalidated.id, subjects);
    await drain();
    await capture("identity-reconciled", invalidated.id, subjects);

    const partial = await source("待审核关系。\n\n" + "长篇说明。".repeat(700));
    model.incomplete.add(partial.versionId);
    await drain();
    await capture("partial-generation-failed", partial.id);
    const extractionFailure = await source("日志保留 90 天。".repeat(700));
    wikiModel.failAfterFirst.add(extractionFailure.versionId);
    await drain();
    await capture("partial-source-extraction", extractionFailure.id);

    const large = await source(
      Array.from(
        { length: 75 },
        () => `生产日志保留 90 天。${"仅用于生产服务。".repeat(12)}`,
      ).join("\n\n"),
    );
    await drain();
    const changed = await source("生产日志保留 60 天。", large);
    await drain();
    await capture("finite-inspection", changed.id);
    return {
      schemaVersion: 1,
      kind: "maintenance-integration",
      provenance: "controlled-provider",
      createdAt: new Date().toISOString(),
      inputs,
      captures,
    };
  } finally {
    await f.close();
  }
}
