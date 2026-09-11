import { MaintenanceService } from "../src/maintenance.ts";
import { commitAckLoss } from "./fixtures/commit-ack-loss.ts";
import type {
  WikiModel,
  WikiPhase,
  WikiPack,
  TopicExtraction,
} from "../src/wiki-types.ts";
import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { IdentityService } from "../src/identity.ts";
import { WikiService } from "../src/wiki.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { ScriptedWikiModel } from "../src/development/wiki-model.ts";
import { EvidenceService } from "../src/evidence.ts";
import type { TopicDescriptor } from "../src/wiki-types.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
async function fixture(model: WikiModel = new ScriptedWikiModel()) {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `wiki-refresh-${crypto.randomUUID()}`,
    username: "admin",
    password: "refresh-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const embeddings = new ControlledEmbeddings(),
    sources = new SourceService(url!, access, embeddings),
    identities = new IdentityService(url!, access, sources);
  let wiki = new WikiService(
    url!,
    access,
    sources,
    identities,
    embeddings,
    model,
  );
  return {
    access,
    token,
    sources,
    identities,
    get wiki() {
      return wiki;
    },
    async restartWiki() {
      await wiki.close();
      wiki = new WikiService(
        url!,
        access,
        sources,
        identities,
        embeddings,
        model,
      );
    },
    async close() {
      await wiki.close();
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
        filename: "rules.md",
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

test("a failed support review stays stale and an attributable repair retains the original failed outcome", async () => {
  class Failing extends ScriptedWikiModel {
    blocked = false;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (this.blocked && phase === "support")
        throw new Error("provider_unavailable");
      return super.request(phase, input, signal);
    }
  }
  const model = new Failing(),
    f = await fixture(model);
  try {
    const first = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const initial = (await f.wiki.list(f.token)).items[0]!;
    model.blocked = true;
    const update = await f.source("无", first);
    while (await f.wiki.workOne(f.token)) {}
    const failed = await f.wiki.inspect(f.token, update.id);
    expect(failed.status).toBe("failed");
    expect((await f.sources.inspect(f.token, update.id)).wiki).toBe("failed");
    expect((await f.wiki.page(f.token, initial.id)).lifecycle).toBe("active");
    expect((await f.wiki.page(f.token, initial.id)).fresh).toBe(false);
    const jobs = failed.jobs.map((job) => ({
      id: job.id,
      state: job.state,
      deadline: job.deadline,
    }));
    expect(await f.wiki.workOne(f.token)).toBe(false);
    expect(
      (await f.wiki.inspect(f.token, update.id)).jobs.map((job) => ({
        id: job.id,
        state: job.state,
        deadline: job.deadline,
      })),
    ).toEqual(jobs);
    model.blocked = false;
    const input = {
      key: crypto.randomUUID(),
      operationId: update.id,
      guidance: "请完整检查当前来源，允许移除已经没有来源支持的内容。",
    };
    const repair = await f.wiki.repair(f.token, input);
    expect(await f.wiki.repair(f.token, input)).toBe(repair);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, repair)).status).toBe("ready");
    expect((await f.wiki.page(f.token, initial.id)).lifecycle).toBe("retired");
    expect((await f.wiki.inspect(f.token, update.id)).status).toBe("failed");
    expect((await f.wiki.guidance(f.token))[0]!.priorOperationId).toBe(
      update.id,
    );
  } finally {
    await f.close();
  }
}, 30000);

test("semantic no-change still publishes current dependencies through one coalesced page refresh", async () => {
  class NoChange extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (
        phase === "planning" &&
        typeof result === "object" &&
        result &&
        "action" in result &&
        result.action === "update"
      )
        return { ...result, action: "no_change" };
      return result;
    }
  }
  const f = await fixture(new NoChange());
  try {
    const first = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const update = await f.source("生产日志保留 30 天。\n", first);
    while (await f.wiki.workOne(f.token)) {}
    const outcome = await f.wiki.inspect(f.token, update.id);
    expect(outcome.status).toBe("ready");
    expect(outcome.pages).toHaveLength(1);
    expect(
      outcome.jobs.filter((job) => job.kind === "wiki.revalidate"),
    ).toHaveLength(1);
    const refreshed = await f.wiki.page(f.token, page.id);
    expect(refreshed.fresh).toBe(true);
    expect(refreshed.sources[0]!.version).toBe(update.versionId);
    expect(refreshed.version).not.toBe(page.version);
  } finally {
    await f.close();
  }
}, 30000);
test("dependency enumeration includes the topic supported only by a removed source passage", async () => {
  const f = await fixture();
  try {
    const first = await f.source(
      "生产日志保留 30 天。\n\n数据库备份保留 7 天。",
    );
    while (await f.wiki.workOne(f.token)) {}
    const pages = (await f.wiki.list(f.token)).items;
    expect(pages).toHaveLength(2);
    const changed = await f.source("数据库备份保留 7 天。", first);
    expect(
      (await f.wiki.list(f.token)).items.every((page) => !page.fresh),
    ).toBe(true);
    while (await f.wiki.workOne(f.token)) {}
    const receipt = await f.wiki.inspect(f.token, changed.id);
    expect(new Set(receipt.walks.flatMap((walk) => walk.pageIds))).toEqual(
      new Set(pages.map((page) => page.id)),
    );
    expect(receipt.walks.every((walk) => walk.complete)).toBe(true);
    const removed = await f.wiki.page(
      f.token,
      pages.find((page) => page.title === "日志保留")!.id,
    );
    const remaining = await f.wiki.page(
      f.token,
      pages.find((page) => page.title === "备份规则")!.id,
    );
    expect(removed.lifecycle).toBe("retired");
    expect(removed.fresh).toBe(false);
    expect(remaining.fresh).toBe(true);
    expect(remaining.text).not.toContain("日志");
  } finally {
    await f.close();
  }
}, 30000);

test("member corrections retain attributed originals and scope while preferences remain guidance", async () => {
  const f = await fixture();
  try {
    await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const correction = {
      key: crypto.randomUUID(),
      kind: "fact" as const,
      target: page.title,
      text: "生产日志保留 90 天。",
    };
    const accepted = await f.wiki.contribute(f.token, correction);
    expect(accepted.status).toBe("accepted");
    expect(await f.wiki.contribute(f.token, correction)).toEqual(accepted);
    await f.sources.workOne();
    expect((await f.wiki.page(f.token, page.id)).fresh).toBe(false);
    while (await f.wiki.workOne(f.token)) {}
    const receipt = await f.sources.inspect(f.token, accepted.operationId!);
    const original = await f.sources.version(f.token, receipt.versionId);
    expect(original.attribution?.actorId).toBeTruthy();
    expect(original.attribution?.pageId).toBe(page.id);
    const updated = await f.wiki.page(f.token, page.id);
    expect(updated.fresh).toBe(true);
    expect(updated.text).toContain("30 天");
    expect(updated.text).toContain("90 天");
    expect(updated.sources).toHaveLength(2);
    await f.wiki.contribute(f.token, {
      key: crypto.randomUUID(),
      kind: "guidance",
      text: "优先按操作步骤整理，不要新增无关主题。",
    });
    expect((await f.wiki.guidance(f.token))[0]!.text).toContain("按操作步骤");
    expect(await f.sources.list(f.token)).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30000);

test("forty-five historical dependents are enumerated in durable 20/20/5 batches", async () => {
  class Rules extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase !== "extraction") return result;
      const pack = input.pack as WikiPack,
        base = (result as TopicExtraction).topics[0]!;
      return {
        topics: pack.items.slice(0, 4).map((item) => ({
          ...base,
          title: `日志规则 ${item.text.match(/规则 (\d+)/)![1]}`,
          subjectKey: `rule:${item.text.match(/规则 (\d+)/)![1]}`,
          handles: [item.handle],
        })),
        coverage: pack.items.map((item, index) => ({
          handle: item.handle,
          topicIndexes: index < 4 ? [index] : [],
          outcome: index < 4 ? "assigned" : "unresolved",
        })),
      };
    }
  }
  const f = await fixture(new Rules());
  try {
    const text = Array.from(
      { length: 45 },
      (_, i) => `规则 ${i + 1}：日志保留 ${i + 1} 天。`,
    ).join("\n\n");
    const first = await f.source(text);
    while (await f.wiki.workOne(f.token)) {}
    const ids: string[] = [];
    let after = "";
    do {
      const page = await f.wiki.list(f.token, undefined, after);
      ids.push(...page.items.map((item) => item.id));
      after = page.next ?? "";
    } while (after);
    expect(ids).toHaveLength(45);
    const update = await f.source(text + "\n", first);
    let previousBatches = 0;
    while (await f.wiki.workOne(f.token)) {
      const walk = (await f.wiki.inspect(f.token, update.id)).walks[0];
      if (walk && walk.batchSizes.length > previousBatches) {
        previousBatches = walk.batchSizes.length;
        await f.restartWiki();
      }
    }
    const result = await f.wiki.inspect(f.token, update.id);
    expect(result.walks[0]!.batchSizes).toEqual([20, 20, 5]);
    expect(new Set(result.walks[0]!.pageIds)).toEqual(new Set(ids));
    expect(result.walks[0]!.complete).toBe(true);
    expect(
      result.jobs.filter((job) => job.kind === "wiki.revalidate"),
    ).toHaveLength(45);
    expect(
      result.jobs
        .filter((job) => job.state !== "succeeded")
        .map((job) => ({ kind: job.kind, reason: job.reason })),
    ).toEqual([]);
    for (const id of ids)
      expect((await f.wiki.page(f.token, id)).fresh).toBe(true);
  } finally {
    await f.close();
  }
}, 120000);

test("retirement preserves historical entry points and later support revives the same topic", async () => {
  const f = await fixture();
  try {
    const first = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {
      await f.restartWiki();
    }
    const initial = (await f.wiki.list(f.token)).items[0]!;
    const removed = await f.source("无", first);
    while (await f.wiki.workOne(f.token)) {
      await f.restartWiki();
    }
    expect((await f.wiki.page(f.token, initial.id)).retirement?.reason).toBe(
      "no_current_support",
    );
    expect(
      (await f.wiki.page(f.token, initial.id, initial.version)).text,
    ).toContain("30 天");
    expect(
      (
        await f.wiki.search(f.token, {
          question: "日志",
          signal: AbortSignal.timeout(1000),
        })
      ).pages,
    ).toBe(0);
    await f.source("生产日志保留 90 天。", removed);
    while (await f.wiki.workOne(f.token)) {
      await f.restartWiki();
    }
    const current = await f.wiki.page(f.token, initial.id);
    expect(current.lifecycle).toBe("active");
    expect(current.fresh).toBe(true);
    expect(current.text).toContain("90 天");
    expect(current.retirement).toBeUndefined();
    expect((await f.wiki.list(f.token)).items).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);

test("a new section is discovered and partial support publishes a reduced page", async () => {
  const f = await fixture();
  try {
    const first = await f.source(
      "生产日志保留 30 天。\n\n审计日志保留 90 天。",
    );
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const changed = await f.source(
      "审计日志保留 90 天。\n\n数据库备份保留 7 天。",
      first,
    );
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, changed.id)).status).toBe("ready");
    const current = await f.wiki.page(f.token, page.id);
    expect(current.lifecycle).toBe("active");
    expect(current.fresh).toBe(true);
    expect(current.text).not.toContain("30 天");
    expect(current.text).toContain("90 天");
    expect(current.text).not.toContain("备份");
    expect(
      (await f.wiki.list(f.token)).items.map((item) => item.title).sort(),
    ).toEqual(["备份规则", "日志保留"]);
  } finally {
    await f.close();
  }
}, 30000);

test("an exhausted large-page inspection retains exact unresolved ranges and original retrieval", async () => {
  const f = await fixture();
  try {
    const original = Array.from(
      { length: 75 },
      () => `生产日志保留 30 天。${"仅用于生产服务。".repeat(12)}`,
    ).join("\n\n");
    const first = await f.source(original);
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    expect(page).toBeDefined();
    const changed = await f.source("生产日志保留 60 天。", first);
    while (await f.wiki.workOne(f.token)) {}
    const result = await f.wiki.inspect(f.token, changed.id);
    expect(result.status).toBe("failed");
    const mandatory = result.jobs.find(
      (job) => job.reason === "needs_attention:detail_window_limit",
    )!;
    expect(mandatory.reason).toBe("needs_attention:detail_window_limit");
    expect(mandatory.ledger["inspection:0"].remaining.length).toBeGreaterThan(
      0,
    );
    expect(mandatory.ledger["inspection:0"].windows).toHaveLength(6);
    expect((await f.wiki.page(f.token, page.id)).lifecycle).toBe("active");
    expect((await f.wiki.page(f.token, page.id)).fresh).toBe(false);
    const pack = await new EvidenceService(f.sources, f.wiki).retrieve(
      f.token,
      {
        runId: crypto.randomUUID(),
        question: "生产日志保留多久",
        complex: false,
        signal: AbortSignal.timeout(5000),
      },
    );
    expect(pack.items.some((item) => item.text.includes("60 天"))).toBe(true);
    expect(pack.items.some((item) => item.text.includes("30 天"))).toBe(false);
  } finally {
    await f.close();
  }
}, 60000);

test("a changed source supersedes a running plan and only the latest revision can publish", async () => {
  class Changing extends ScriptedWikiModel {
    change: (() => Promise<void>) | undefined;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "support" && this.change) {
        const change = this.change;
        this.change = undefined;
        await change();
      }
      return result;
    }
  }
  const model = new Changing(),
    f = await fixture(model);
  try {
    const first = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const second = await f.source("生产日志保留 60 天。", first);
    model.change = async () => {
      await f.source("生产日志保留 90 天。", second);
    };
    while (await f.wiki.workOne(f.token)) {}
    const old = await f.wiki.inspect(f.token, second.id);
    expect(
      old.jobs.some(
        (job) => job.kind === "wiki.refresh" && job.state === "superseded",
      ),
    ).toBe(true);
    const current = await f.wiki.page(f.token, page.id);
    expect(current.fresh).toBe(true);
    expect(current.text).toContain("90 天");
    expect(current.text).not.toContain("60 天");
  } finally {
    await f.close();
  }
}, 30000);

test("identity rebindings refresh current proof dependencies and unresolved proof loss cannot retire a page", async () => {
  class Subject extends ScriptedWikiModel {
    identities: TopicDescriptor["identities"] = [];
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "extraction")
        for (const topic of (result as TopicExtraction).topics) {
          topic.identities = this.identities;
          topic.identityRequired = true;
        }
      return result;
    }
  }
  const model = new Subject(),
    f = await fixture(model);
  try {
    const a = await f.source("甲提供服务。"),
      b = await f.source("乙提供服务。"),
      witness = await f.source("“乙”与“甲”指同一实体。");
    const mentions = [];
    for (const [operation, label] of [
      [a, "甲"],
      [b, "乙"],
    ] as const) {
      const source = await f.sources.version(f.token, operation.versionId);
      mentions.push(
        await f.identities.record(f.token, {
          version: source.version,
          passageId: source.passages[0]!.id,
          label,
        }),
      );
    }
    const from = mentions[1]!;
    model.identities = [
      {
        mentionId: from.id,
        revisionId: from.revisionId,
        proofId: from.proofs[0]!.id,
      },
    ];
    await f.source("乙的生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const proof = await f.sources.version(f.token, witness.versionId);
    const bound = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: from.id,
      targetId: mentions[0]!.id,
      expectedRevision: from.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            { version: proof.version, passageId: proof.passages[0]!.id },
          ],
        },
      ],
    });
    expect((await f.wiki.page(f.token, page.id)).fresh).toBe(false);
    while (await f.identities.workOne(f.token)) {}
    while (await f.wiki.workOne(f.token)) {}
    const revised = await f.wiki.page(f.token, page.id);
    expect(revised.fresh).toBe(true);
    expect(revised.descriptor.identities[0]!.revisionId).toBe(bound.revisionId);
    const lost = await f.source("原身份说明已撤回。", witness);
    while (await f.identities.workOne(f.token)) {}
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, page.id)).fresh).toBe(false);
    expect((await f.wiki.page(f.token, page.id)).lifecycle).toBe("active");
    expect(
      (await f.wiki.inspect(f.token, lost.id)).jobs.some(
        (job) =>
          job.kind === "wiki.revalidate" &&
          job.reason === "needs_attention:unresolved_identity",
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

test("source proposal non-progress stays unresolved even if unrelated mandatory work succeeds", async () => {
  class NoProgress extends ScriptedWikiModel {
    blocked = false;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (this.blocked && phase === "extraction")
        return {
          topics: [],
          coverage: (input.pack as WikiPack).items.map((item) => ({
            handle: item.handle,
            topicIndexes: [],
            outcome: "unresolved",
          })),
        };
      return super.request(phase, input, signal);
    }
  }
  const model = new NoProgress(),
    f = await fixture(model);
  try {
    const first = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    model.blocked = true;
    const changed = await f.source("生产日志保留 60 天。", first);
    while (await f.wiki.workOne(f.token)) {}
    const result = await f.wiki.inspect(f.token, changed.id);
    expect(result.status).toBe("failed");
    expect(result.jobs.find((job) => job.kind === "wiki.refresh")?.reason).toBe(
      "needs_attention:source_coverage",
    );
    expect(
      result.jobs.find((job) => job.kind === "wiki.refresh")?.ledger["packet:0"]
        .remaining,
    ).toHaveLength(1);
    expect(
      result.jobs.find((job) => job.kind === "wiki.revalidate")?.state,
    ).toBe("succeeded");
    expect(await f.wiki.workOne(f.token)).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);

test("a retained claim supported by a paraphrase blocks retirement even when topic classification returns context", async () => {
  class Paraphrase extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (
        phase === "support" &&
        (input.pack as WikiPack).items.some((item) =>
          item.text.includes("三十日"),
        )
      )
        return {
          ...(result as object),
          claimId: (input.claim as { id: string }).id,
          claimVerdict: "supported",
          claimHandles: (input.pack as WikiPack).items.map(
            (item) => item.handle,
          ),
          qualifiersChecked: true,
          claimReason:
            "The old production retention claim is still supported by the paraphrased current statement",
          coverage: (input.pack as WikiPack).items.map((item) => ({
            handle: item.handle,
            outcome: "context",
            reason: "Topic classifier omitted the paraphrased wording",
          })),
        };
      return result;
    }
  }
  const f = await fixture(new Paraphrase());
  try {
    const first = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const change = await f.source("生产日志的保存期限为三十日。", first);
    while (await f.wiki.workOne(f.token)) {}
    const current = await f.wiki.page(f.token, page.id);
    expect(current.lifecycle).toBe("active");
    expect(current.fresh).toBe(true);
    expect(current.text).toContain("三十日");
    expect((await f.wiki.inspect(f.token, change.id)).status).toBe("ready");
  } finally {
    await f.close();
  }
}, 30000);

test("conflicting originals in different draft blocks publish a reviewed conflict with both sources", async () => {
  const f = await fixture();
  try {
    await f.source(
      "生产日志保留 30 天。" + "本规则适用于生产环境。".repeat(20),
    );
    while (await f.wiki.workOne(f.token)) {}
    const second = await f.source(
      "生产日志保留 90 天。" + "本规则适用于生产环境。".repeat(20),
    );
    while (await f.wiki.workOne(f.token)) {}
    const page = await f.wiki.page(
      f.token,
      (await f.wiki.list(f.token)).items[0]!.id,
    );
    expect(page.fresh).toBe(true);
    expect(page.text).toContain("来源分歧尚未解决");
    const conflict = page.certificates.find((certificate) =>
      certificate.draft.text.includes("来源分歧尚未解决"),
    )!;
    expect(new Set(conflict.evidence.map((ref) => ref.version)).size).toBe(2);
    expect(
      conflict.review.claims.every((claim) => claim.verdict === "supported"),
    ).toBe(true);
    expect((await f.wiki.inspect(f.token, second.id)).status).toBe("ready");
  } finally {
    await f.close();
  }
}, 30000);

test("a failed member of a related update set cannot publish its successful peer", async () => {
  class RejectBackup extends ScriptedWikiModel {
    blocked = false;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (
        this.blocked &&
        phase === "review" &&
        (input.topic as TopicDescriptor).title === "备份规则"
      )
        throw new Error("provider_unavailable");
      return super.request(phase, input, signal);
    }
  }
  const model = new RejectBackup(),
    f = await fixture(model);
  try {
    const first = await f.source(
      "生产日志保留 30 天。\n\n数据库备份保留 7 天。",
    );
    while (await f.wiki.workOne(f.token)) {}
    const before = (await f.wiki.list(f.token)).items;
    model.blocked = true;
    const changed = await f.source(
      "生产日志保留 90 天。\n\n数据库备份保留 14 天。",
      first,
    );
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, changed.id)).status).toBe("failed");
    for (const page of before) {
      const current = await f.wiki.page(f.token, page.id);
      expect(current.version).toBe(page.version);
      expect(current.fresh).toBe(false);
    }
  } finally {
    await f.close();
  }
}, 30000);

test("Wiki retirement and reactivation recover lost COMMIT acknowledgements without duplicate publication", async () => {
  const model = new ScriptedWikiModel(),
    f = await fixture(model);
  const maintenance = new MaintenanceService(url!, f.access);
  async function interruptPublication(domain: RegExp) {
    const proxy = await commitAckLoss(url!, domain);
    const worker = new WikiService(
      proxy.url,
      f.access,
      f.sources,
      f.identities,
      new ControlledEmbeddings(),
      model,
    );
    try {
      for (let step = 0; step < 20 && !proxy.dropped; step++) {
        if (!(await worker.workOne(f.token))) break;
      }
      expect(proxy.dropped).toBe(true);
    } finally {
      await worker.close();
      await proxy.close();
    }
  }
  try {
    const source = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const initial = (await f.wiki.list(f.token)).items[0]!;
    const removed = await f.source("无", source);
    await interruptPublication(/UPDATE wiki_pages SET lifecycle='retired'/);
    const retired = await f.wiki.page(f.token, initial.id);
    expect(retired.lifecycle).toBe("retired");
    expect(retired.retirement?.operationId).toBe(removed.id);
    const status = await maintenance.inspect(f.token, removed.id);
    expect(
      status.jobs.some(
        (job) =>
          job.kind === "wiki.revalidate" &&
          job.state === "succeeded" &&
          job.receipt.outcome === "succeeded",
      ),
    ).toBe(true);
    await f.restartWiki();
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, initial.id)).version).toBe(
      retired.version,
    );
    expect(
      (
        await f.wiki.search(f.token, {
          question: "日志",
          signal: AbortSignal.timeout(1000),
        })
      ).pages,
    ).toBe(0);
    const revived = await f.source("生产日志保留 90 天。", removed);
    await interruptPublication(/UPDATE wiki_pages SET current_version_id=/);
    const published = await f.wiki.page(f.token, initial.id);
    expect(published.lifecycle).toBe("active");
    expect(published.text).toContain("90 天");
    const before = await f.wiki.history(f.token, initial.id);
    await f.restartWiki();
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, initial.id)).version).toBe(
      published.version,
    );
    expect(await f.wiki.history(f.token, initial.id)).toEqual(before);
    const ready = await f.sources.inspect(f.token, revived.id);
    expect(ready.wiki).toBe("ready");
    const evidence = new EvidenceService(f.sources, f.wiki);
    const pack = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "生产日志保留多久",
      signal: AbortSignal.timeout(2000),
    });
    expect(pack.items.some((item) => item.text.includes("90 天"))).toBe(true);
    expect(pack.items.some((item) => item.text.includes("30 天"))).toBe(false);
    evidence.release(pack.runId);
  } finally {
    await maintenance.close();
    await f.close();
  }
}, 30000);
