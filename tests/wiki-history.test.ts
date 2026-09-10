import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { IdentityService } from "../src/identity.ts";
import { WikiService } from "../src/wiki.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { ScriptedWikiModel } from "../src/development/wiki-model.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
async function fixture(model = new ScriptedWikiModel()) {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `wiki-history-${crypto.randomUUID()}`,
    username: "admin",
    password: "history-fixture-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const embeddings = new ControlledEmbeddings(),
    sources = new SourceService(url!, access, embeddings),
    identities = new IdentityService(url!, access, sources),
    wiki = new WikiService(
      url!,
      access,
      sources,
      identities,
      embeddings,
      model,
    );
  return {
    access,
    account,
    identities,
    token,
    sources,
    wiki,
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
        filename: "运维规则.md",
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
test("restoring historical content creates a new pending version without rolling back current originals", async () => {
  const f = await fixture();
  try {
    const original = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const first = (await f.wiki.list(f.token)).items[0]!;
    const changed = await f.source("生产日志保留 90 天。", original);
    while (await f.wiki.workOne(f.token)) {}
    const current = await f.wiki.page(f.token, first.id);
    const input = {
      key: crypto.randomUUID(),
      pageId: first.id,
      versionId: first.version,
      expectedVersion: current.version,
      reason: "保留早期简洁说明的组织方式，事实仍以最新原文为准。",
    };
    const accepted = await f.wiki.restore(f.token, input);
    expect(accepted.status).toBe("accepted");
    expect(await f.wiki.restore(f.token, input)).toEqual(accepted);
    await f.wiki.workOne(f.token);
    const restored = await f.wiki.page(f.token, first.id);
    expect(restored.version).not.toBe(first.version);
    expect(restored.version).not.toBe(current.version);
    expect(restored.text).toContain("30 天");
    expect(restored.fresh).toBe(false);
    expect(await f.sources.current(f.token, changed.versionId)).toBe(true);
    const history = await f.wiki.history(f.token, first.id);
    expect(
      history.items.some(
        (version) =>
          version.version === restored.version &&
          version.reason === input.reason,
      ),
    ).toBe(true);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, first.id)).text).toContain("90 天");
    expect((await f.wiki.page(f.token, first.id)).fresh).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

class BroadTopicModel extends ScriptedWikiModel {
  override async request(
    phase: import("../src/wiki-types.ts").WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const result = await super.request(phase, input, signal);
    if (phase !== "extraction") return result;
    const extracted = result as import("../src/wiki-types.ts").TopicExtraction;
    if (extracted.topics.length < 2) return result;
    return {
      topics: [
        {
          ...extracted.topics[0],
          title: "运维规则",
          subjectKey: "运维规则",
          question: "日常运维有哪些规则？",
          handles: extracted.topics.flatMap((topic) => topic.handles),
        },
      ],
      coverage: extracted.coverage.map((entry) => ({
        ...entry,
        topicIndexes: entry.outcome === "assigned" ? [0] : [],
      })),
    };
  }
}
class SynonymModel extends ScriptedWikiModel {
  synonyms = true;
  private readonly names = new Map<string, string>();
  override async request(
    phase: import("../src/wiki-types.ts").WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const result = await super.request(phase, input, signal);
    if (phase !== "extraction" || !this.synonyms) return result;
    const pack = input.pack as import("../src/wiki-types.ts").WikiPack;
    const title =
      this.names.get(pack.runId) ??
      (this.names.size === 0 ? "日志留存期限" : "日志保存时长");
    this.names.set(pack.runId, title);
    const extracted = result as import("../src/wiki-types.ts").TopicExtraction;
    return {
      ...extracted,
      topics: extracted.topics.map((topic) => ({
        ...topic,
        title,
        subjectKey: title,
        question: `${title}是什么？`,
      })),
    };
  }
}
class PausedStructureModel extends BroadTopicModel {
  readonly entered = Promise.withResolvers<void>();
  readonly release = Promise.withResolvers<void>();
  override async request(
    phase: import("../src/wiki-types.ts").WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const response = await super.request(phase, input, signal);
    if (phase === "structure_review") {
      this.entered.resolve();
      await this.release.promise;
    }
    return response;
  }
}
test("a correction activated during structural review prevents the entire stale edit set from publishing", async () => {
  const model = new PausedStructureModel(),
    f = await fixture(model);
  try {
    await f.source("生产日志保留 30 天。\n\n数据库备份每天执行一次。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const accepted = await f.wiki.restructure(f.token, {
      key: crypto.randomUUID(),
      kind: "split",
      pages: [{ pageId: page.id, version: page.version }],
      reason: "按日志和备份整理。",
    });
    const work = f.wiki.workOne(f.token);
    await model.entered.promise;
    const note = await f.wiki.contribute(f.token, {
      key: crypto.randomUUID(),
      kind: "fact",
      target: page.title,
      text: "生产日志保留 90 天。",
    });
    expect(note.status).toBe("accepted");
    await f.sources.workOne();
    model.release.resolve();
    await work;
    expect((await f.wiki.page(f.token, page.id)).version).toBe(page.version);
    expect((await f.wiki.list(f.token)).items).toHaveLength(1);
    expect((await f.wiki.inspect(f.token, accepted.operationId!)).status).toBe(
      "superseded",
    );
  } finally {
    model.release.resolve();
    await f.close();
  }
}, 30000);
test("merging overlapping same-scope claims retains the earliest page, aliases and subsequent source routing", async () => {
  const model = new SynonymModel(),
    f = await fixture(model);
  try {
    const initialSource = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const first = (await f.wiki.list(f.token)).items[0]!;
    const redirectedSource = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const pages = (await f.wiki.list(f.token)).items;
    expect(pages).toHaveLength(2);
    model.synonyms = false;
    const accepted = await f.wiki.restructure(f.token, {
      key: crypto.randomUUID(),
      kind: "merge",
      pages: pages.map((page) => ({ pageId: page.id, version: page.version })),
      reason: "两份同范围文档说明的是同一个日志期限。",
    });
    expect(accepted.status).toBe("accepted");
    while (await f.wiki.workOne(f.token)) {}
    const canonical = await f.wiki.page(f.token, first.id);
    expect(canonical.lifecycle).toBe("active");
    expect(canonical.sources).toHaveLength(2);
    const old = pages.find((page) => page.id !== first.id)!;
    const redirect = await f.wiki.page(f.token, old.id);
    expect(redirect.lifecycle).toBe("redirect");
    expect(redirect.successors?.map((item) => item.pageId)).toEqual([first.id]);
    const contribution = await f.wiki.contribute(f.token, {
      key: crypto.randomUUID(),
      kind: "guidance",
      text: "沿用合并后的主题入口。",
      target: old.title,
    });
    expect(contribution.status).toBe("accepted");
    await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    expect(
      (await f.wiki.list(f.token)).items.filter(
        (page) => page.lifecycle === "active",
      ),
    ).toHaveLength(1);
    expect((await f.wiki.page(f.token, first.id)).sources).toHaveLength(3);
    const changed = await f.source("生产日志保留 90 天。", redirectedSource);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, changed.id)).status).toBe("ready");
    expect((await f.wiki.page(f.token, first.id)).text).toContain("90 天");
  } finally {
    await f.close();
  }
}, 30000);
test("restoring a split creates a new edit set, preserves later unrelated changes and retains successor links", async () => {
  const f = await fixture(new BroadTopicModel());
  try {
    await f.source("生产日志保留 30 天。\n\n数据库备份每天执行一次。");
    while (await f.wiki.workOne(f.token)) {}
    const parent = (await f.wiki.list(f.token)).items[0]!;
    await f.wiki.restructure(f.token, {
      key: crypto.randomUUID(),
      kind: "split",
      pages: [{ pageId: parent.id, version: parent.version }],
      reason: "分别整理日志与备份。",
    });
    while (await f.wiki.workOne(f.token)) {}
    const entry = await f.wiki.page(f.token, parent.id);
    await f.source("生产部署必须经过人工审批。");
    while (await f.wiki.workOne(f.token)) {}
    const unrelated = (await f.wiki.list(f.token)).items.find(
      (item) => item.title === "发布安排",
    )!;
    const input = {
      key: crypto.randomUUID(),
      editSetId: entry.editSetId!,
      reason: "恢复统一入口，便于按每日运维流程查阅。",
    };
    const accepted = await f.wiki.restoreEditSet(f.token, input);
    expect(accepted.status).toBe("accepted");
    expect(await f.wiki.restoreEditSet(f.token, input)).toEqual(accepted);
    while (await f.wiki.workOne(f.token)) {}
    const restored = await f.wiki.page(f.token, parent.id);
    expect(restored.lifecycle).toBe("active");
    expect(restored.fresh).toBe(true);
    expect(restored.version).not.toBe(parent.version);
    expect(restored.editSetId).not.toBe(entry.editSetId);
    expect((await f.wiki.page(f.token, unrelated.id)).version).toBe(
      unrelated.version,
    );
    for (const successor of entry.successors!) {
      const child = await f.wiki.page(f.token, successor.pageId);
      expect(child.lifecycle).toBe("redirect");
      expect(child.successors?.map((item) => item.pageId)).toEqual([parent.id]);
    }
    expect(
      (await f.wiki.guidance(f.token)).some(
        (item) => item.text === input.reason,
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);
test("splitting useful reader questions publishes successors together and keeps the old entry and citations", async () => {
  const f = await fixture(new BroadTopicModel());
  try {
    await f.source("生产日志保留 30 天。\n\n数据库备份每天执行一次。");
    while (await f.wiki.workOne(f.token)) {}
    const original = (await f.wiki.list(f.token)).items[0]!;
    const before = await f.wiki.page(f.token, original.id);
    const accepted = await f.wiki.restructure(f.token, {
      key: crypto.randomUUID(),
      kind: "split",
      pages: [{ pageId: original.id, version: original.version }],
      reason: "把日志期限和备份频率分别整理成能独立阅读的主题。",
    });

    expect(accepted.status).toBe("accepted");
    while (await f.wiki.workOne(f.token)) {}
    const entry = await f.wiki.page(f.token, original.id);
    expect(entry.lifecycle).toBe("split_entry");
    expect(entry.fresh).toBe(false);
    expect(entry.successors).toHaveLength(2);
    const children = await Promise.all(
      entry.successors!.map((child) => f.wiki.page(f.token, child.pageId)),
    );
    expect(children.every((child) => child.fresh)).toBe(true);
    expect(children.map((child) => child.title).sort()).toEqual([
      "备份规则",
      "日志保留",
    ]);
    expect((await f.wiki.page(f.token, original.id, before.version)).text).toBe(
      before.text,
    );
    expect(
      children
        .flatMap((child) => child.sources)
        .map((ref) => ref.passageId)
        .sort(),
    ).toEqual(before.sources.map((ref) => ref.passageId).sort());
  } finally {
    await f.close();
  }
}, 30000);

test("restoration clarifies intervening related edits and never replaces the newer page", async () => {
  const f = await fixture(new BroadTopicModel());
  try {
    const source = await f.source(
      "生产日志保留 30 天。\n\n数据库备份每天执行一次。",
    );
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    await f.wiki.restructure(f.token, {
      key: crypto.randomUUID(),
      kind: "split",
      pages: [{ pageId: page.id, version: page.version }],
      reason: "按独立问题拆分。",
    });
    while (await f.wiki.workOne(f.token)) {}
    const entry = await f.wiki.page(f.token, page.id);
    const child = entry.successors![0]!;
    const historical = await f.wiki.page(f.token, child.pageId);
    await f.wiki.restore(f.token, {
      key: crypto.randomUUID(),
      pageId: child.pageId,
      versionId: historical.version,
      expectedVersion: historical.version,
      reason: "保留这份独立说明。",
    });
    while (await f.wiki.workOne(f.token)) {}
    const newer = await f.wiki.page(f.token, child.pageId);
    const result = await f.wiki.restoreEditSet(f.token, {
      key: crypto.randomUUID(),
      editSetId: entry.editSetId!,
      reason: "撤回整组拆分。",
    });
    expect(result.status).toBe("clarification");
    expect(result.reason).toBe("related_pages_changed");
    expect((await f.wiki.page(f.token, child.pageId)).version).toBe(
      newer.version,
    );
    expect((await f.wiki.page(f.token, page.id)).lifecycle).toBe("split_entry");
    expect(await f.sources.current(f.token, source.versionId)).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

class AutomaticSplitModel extends BroadTopicModel {
  override async request(
    phase: import("../src/wiki-types.ts").WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const result = await super.request(phase, input, signal);
    if (phase !== "planning") return result;
    const candidates =
      input.candidates as import("../src/wiki-types.ts").WikiCandidate[];
    const broad = candidates.find(
      (candidate) => candidate.descriptor.subjectKey === "运维规则",
    );
    return broad
      ? {
          ...(result as object),
          proposals: [
            {
              kind: "split",
              pageIds: [broad.id],
              reason: "将日志期限与备份频率独立组织。",
            },
          ],
        }
      : result;
  }
}
test("recorded automatic proposals execute and an unchanged user-reversed proposal is suppressed", async () => {
  const f = await fixture(new AutomaticSplitModel());
  try {
    await f.source("生产日志保留 30 天。\n\n数据库备份每天执行一次。");
    while (await f.wiki.workOne(f.token)) {}
    const parent = (await f.wiki.list(f.token)).items[0]!;
    const trigger = await f.source("生产部署必须人工批准。");
    while (await f.wiki.workOne(f.token)) {}
    const outcome = await f.wiki.inspect(f.token, trigger.id);
    expect(outcome.proposals.map((item) => item.status)).toEqual(["applied"]);
    const entry = await f.wiki.page(f.token, parent.id);
    expect(entry.lifecycle).toBe("split_entry");
    await f.wiki.restoreEditSet(f.token, {
      key: crypto.randomUUID(),
      editSetId: entry.editSetId!,
      reason: "保留统一的每日运维入口。",
    });
    while (await f.wiki.workOne(f.token)) {}
    const restored = await f.wiki.page(f.token, parent.id);
    const second = await f.source("生产部署必须人工批准。");
    while (await f.wiki.workOne(f.token)) {}
    expect(
      (await f.wiki.inspect(f.token, second.id)).proposals.some(
        (item) => item.status === "suppressed",
      ),
    ).toBe(true);
    expect((await f.wiki.page(f.token, parent.id)).version).toBe(
      restored.version,
    );
  } finally {
    await f.close();
  }
}, 30000);

test("a long single topic is not split and rejected unchanged proposals do not publish pages", async () => {
  const f = await fixture();
  try {
    await f.source(
      Array.from(
        { length: 12 },
        (_, i) => `区域 ${i} 的生产日志保留 30 天。`,
      ).join("\n\n"),
    );
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const input = {
      key: crypto.randomUUID(),
      kind: "split" as const,
      pages: [{ pageId: page.id, version: page.version }],
      reason: "这页很长，请拆分。",
    };
    const accepted = await f.wiki.restructure(f.token, input);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, accepted.operationId!)).status).toBe(
      "failed",
    );
    expect((await f.wiki.page(f.token, page.id)).version).toBe(page.version);
    expect(await f.wiki.restructure(f.token, input)).toEqual(accepted);
    expect(await f.wiki.workOne(f.token)).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);

test("restoring retired history cannot make unsupported content eligible again", async () => {
  const f = await fixture();
  try {
    const source = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const first = (await f.wiki.list(f.token)).items[0]!;
    await f.source("不再说明。", source);
    while (await f.wiki.workOne(f.token)) {}
    const retired = await f.wiki.page(f.token, first.id);
    expect(retired.lifecycle).toBe("retired");
    await f.wiki.restore(f.token, {
      key: crypto.randomUUID(),
      pageId: first.id,
      versionId: first.version,
      expectedVersion: retired.version,
      reason: "保留过去的规则说明。",
    });
    await f.wiki.workOne(f.token);
    const restored = await f.wiki.page(f.token, first.id);
    expect(restored.lifecycle).toBe("retired");
    expect(restored.fresh).toBe(false);
    expect(
      (
        await f.wiki.search(f.token, {
          question: "日志保留",
          signal: AbortSignal.timeout(10000),
        })
      ).pages,
    ).toBe(0);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, first.id)).lifecycle).toBe("retired");
  } finally {
    await f.close();
  }
}, 30000);

test("historical identity bindings remain pending when a restored version depends on a superseded proof", async () => {
  class Subject extends ScriptedWikiModel {
    identities: import("../src/wiki-types.ts").TopicDescriptor["identities"] =
      [];
    override async request(
      phase: import("../src/wiki-types.ts").WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "extraction")
        for (const topic of (
          result as import("../src/wiki-types.ts").TopicExtraction
        ).topics) {
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
    await f.identities.bind(f.token, {
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
    while (await f.identities.workOne(f.token)) {}
    while (await f.wiki.workOne(f.token)) {}
    const current = await f.wiki.page(f.token, page.id);
    await f.wiki.restore(f.token, {
      key: crypto.randomUUID(),
      pageId: page.id,
      versionId: page.version,
      expectedVersion: current.version,
      reason: "保留旧版说明的安排。",
    });
    await f.wiki.workOne(f.token);
    expect((await f.wiki.page(f.token, page.id)).fresh).toBe(false);
    expect(
      (
        await f.wiki.search(f.token, {
          question: "日志保留",
          signal: AbortSignal.timeout(10000),
        })
      ).pages,
    ).toBe(0);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, page.id)).fresh).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

test("restoration uses the restore grant and keeps page history inside the authenticated organization", async () => {
  const f = await fixture(),
    foreign = await fixture();
  try {
    await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    await f.access.createMember(f.token, {
      username: "editor",
      password: "editor-test-password",
      grants: ["read", "correct"],
    });
    await f.access.createMember(f.token, {
      username: "restorer",
      password: "restore-test-password",
      grants: ["read", "restore"],
    });
    const editor = await f.access.login({
      organization: f.account.organization,
      username: "editor",
      password: "editor-test-password",
    });
    const restorer = await f.access.login({
      organization: f.account.organization,
      username: "restorer",
      password: "restore-test-password",
    });
    const input = {
      key: crypto.randomUUID(),
      pageId: page.id,
      versionId: page.version,
      expectedVersion: page.version,
      reason: "保留这份历史说明。",
    };
    await expect(f.wiki.restore(editor.token, input)).rejects.toThrow(
      "unauthorized",
    );
    await expect(f.wiki.history(foreign.token, page.id)).rejects.toThrow(
      "not_found",
    );
    await expect(f.wiki.restore(foreign.token, input)).rejects.toThrow(
      "not_found",
    );
    expect((await f.wiki.restore(restorer.token, input)).status).toBe(
      "accepted",
    );
    while (await f.wiki.workOne(f.token)) {}
  } finally {
    await f.close();
    await foreign.close();
  }
}, 30000);

test("conflicting durations without overlapping supported claims cannot justify a merge", async () => {
  const model = new SynonymModel(),
    f = await fixture(model);
  try {
    await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    await f.source("生产日志保留 90 天。");
    while (await f.wiki.workOne(f.token)) {}
    const pages = (await f.wiki.list(f.token)).items;
    expect(pages).toHaveLength(2);
    model.synonyms = false;
    const request = await f.wiki.restructure(f.token, {
      key: crypto.randomUUID(),
      kind: "merge",
      pages: pages.map((page) => ({ pageId: page.id, version: page.version })),
      reason: "这两页标题接近，请合并。",
    });
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, request.operationId!)).status).toBe(
      "failed",
    );
    for (const page of pages) {
      const current = await f.wiki.page(f.token, page.id);
      expect(current.version).toBe(page.version);
      expect(current.lifecycle).toBe("active");
    }
  } finally {
    await f.close();
  }
}, 30000);
