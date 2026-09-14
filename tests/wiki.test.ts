import { EvidenceService } from "../src/evidence.ts";
import type {
  WikiModel,
  WikiPhase,
  WikiPack,
  TopicExtraction,
  TopicDescriptor,
} from "../src/wiki-types.ts";
import type { EmbeddingAdapter } from "../src/embeddings.ts";
import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { IdentityService } from "../src/identity.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { WikiService } from "../src/wiki.ts";
import { ScriptedWikiModel } from "../src/development/wiki-model.ts";
import type { Draft, Review } from "../src/answer-validation.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");

test("Wiki repairs a claim whose declared citations exceed its reviewed support", async () => {
  let generations = 0,
    reviews = 0,
    repaired = false;
  class RepairModel extends ScriptedWikiModel {
    override async request(...args: Parameters<ScriptedWikiModel["request"]>) {
      const [phase, input] = args;
      if (phase === "generation") {
        generations++;
        repaired ||= Boolean(input.feedback);
      }
      const result = await super.request(...args);
      if (phase === "review") reviews++;
      if (phase === "review" && !repaired) {
        const review = result as Review;
        const draft = input.draft as Draft;
        const claim = draft.claims.find(
          (c) => c.role === "fact" && c.handles.length,
        )!;
        review.claims.find((c) => c.id === claim.id)!.spans = [];
      }
      return result;
    }
  }
  const f = await fixture(new RepairModel());
  try {
    const operation = await f.source(
      "logs.md",
      "生产环境的应用日志保留 30 天。",
    );
    await f.wiki.workOne(f.token);
    expect((await f.wiki.inspect(f.token, operation.id)).status).toBe("ready");
    expect(repaired).toBe(true);
    expect(generations).toBe(2);
    expect(reviews).toBe(2);
  } finally {
    await f.close();
  }
}, 10000);
async function fixture(
  model: WikiModel = new ScriptedWikiModel(),
  embeddings: EmbeddingAdapter = new ControlledEmbeddings(),
) {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `wiki-${crypto.randomUUID()}`,
    username: "admin",
    password: "wiki-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const sources = new SourceService(url!, access, embeddings),
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
    token,
    access,
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
    model,
    async source(filename: string, text: string, projectId?: string) {
      const operation = await sources.submit(token, {
        key: crypto.randomUUID(),
        filename,
        ...(projectId ? { projectId } : {}),
        bytes: new TextEncoder().encode(text),
      });
      await sources.workOne();
      return operation;
    },
    async close() {
      await wiki.close();
      await identities.close();
      await sources.close();
      await access.close();
    },
  };
}
test("overlapping originals publish one reviewed topic with stable identity and citations to both documents", async () => {
  const f = await fixture();
  try {
    const first = await f.source(
        "production.md",
        "生产环境的应用日志保留 30 天。",
      ),
      second = await f.source("testing.md", "测试环境不保留应用日志。");
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    const page = await f.wiki.page(f.token, pages.items[0]!.id);
    expect(page.text).toContain("30 天");
    expect(page.text).toContain("不保留");
    expect(page.fresh).toBe(true);
    expect(new Set(page.sources.map((source) => source.version))).toEqual(
      new Set([first.versionId, second.versionId]),
    );
    expect(page.certificates.length).toBeGreaterThan(0);
    expect(
      page.certificates.every((certificate) =>
        certificate.review.claims.every(
          (claim) => claim.verdict === "supported",
        ),
      ),
    ).toBe(true);
    for (const source of page.sources)
      expect(
        (await f.sources.resolve(f.token, source.version, source.passageId))
          .text,
      ).not.toBe("");
  } finally {
    await f.close();
  }
}, 30000);

test("a compatible ninth card expands inspection to sixteen before creating a competing topic", async () => {
  class Topics extends ScriptedWikiModel {
    target = "";
    readonly planningSizes: number[] = [];
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (phase === "planning" && this.target)
        this.planningSizes.push((input.candidates as unknown[]).length);
      const result = await super.request(phase, input, signal);
      if (phase !== "extraction") return result;
      const extracted = result as TopicExtraction,
        pack = input.pack as WikiPack,
        topic = extracted.topics[0]!;
      topic.title = this.target
        ? "通用日志规则"
        : pack.items[0]!.title.replace(".md", "");
      topic.subjectKey = this.target || topic.title;
      topic.question = "生产日志有哪些保留要求？";
      return extracted;
    }
  }
  const model = new Topics(),
    embeddings: EmbeddingAdapter = {
      profile: "constant-ranking-fixture",
      dimensions: 8,
      async embed(texts, signal) {
        signal.throwIfAborted();
        return texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0]);
      },
    };
  const f = await fixture(model, embeddings);
  try {
    for (let i = 0; i < 17; i++) {
      await f.source(
        `主题${i}日志.md`,
        `主题${i}日志：生产日志保留 ${i + 1} 天。`,
      );
      while (await f.wiki.workOne(f.token)) {}
    }
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(17);
    const target = [...pages.items].sort((a, b) =>
      a.id.localeCompare(b.id),
    )[8]!;
    model.target = target.title;
    await f.source("new.md", `${target.title}：生产日志保留 99 天。`);
    while (await f.wiki.workOne(f.token)) {}
    expect(model.planningSizes).toEqual([8, 16, 16]);
    expect((await f.wiki.list(f.token)).items).toHaveLength(17);
    expect((await f.wiki.page(f.token, target.id)).text).toContain("99 天");
  } finally {
    await f.close();
  }
}, 30000);

test("optional vector failure permits supported distinct topic creation after catalogue collision checks", async () => {
  const controlled = new ControlledEmbeddings();
  let offline = false;
  const embeddings: EmbeddingAdapter = {
    profile: controlled.profile,
    dimensions: controlled.dimensions,
    async embed(texts, signal) {
      if (offline) throw new Error("embedding_offline");
      return controlled.embed(texts, signal);
    },
  };
  const f = await fixture(new ScriptedWikiModel(), embeddings);
  try {
    await f.source("first.md", "生产日志保留 30 天。");
    offline = true;
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    offline = false;
    await f.source("second.md", "测试日志保留 7 天。");
    offline = true;
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, pages.items[0]!.id)).text).toContain(
      "7 天",
    );
    offline = false;
    const operation = await f.source("backup.md", "数据库备份保留 90 天。");
    offline = true;
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(2);
    expect(
      JSON.stringify(await f.wiki.inspect(f.token, operation.id)),
    ).not.toContain("catalogue_unavailable");
  } finally {
    await f.close();
  }
}, 30000);

test("concurrent equivalent creations replan against the published reservation and retain both contributions", async () => {
  class Race extends ScriptedWikiModel {
    creates = 0;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (
        phase === "planning" &&
        (result as { action: string }).action === "create"
      )
        this.creates++;
      return result;
    }
  }
  const f = await fixture(new Race());
  try {
    const first = await f.source("a.md", "生产日志保留 30 天。"),
      second = await f.source("b.md", "测试日志保留 7 天。");
    await Promise.all([f.wiki.workOne(f.token), f.wiki.workOne(f.token)]);
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    const page = await f.wiki.page(f.token, pages.items[0]!.id);
    expect(page.text).toContain("30 天");
    expect(page.text).toContain("7 天");
    for (const operation of [first, second])
      expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
        "succeeded",
      );
  } finally {
    await f.close();
  }
}, 30000);

test("same-title project topics stay separate and project facts never widen shared source scope", async () => {
  const f = await fixture();
  try {
    const a = await f.access.createProject(f.token, "A"),
      b = await f.access.createProject(f.token, "B");
    await f.source("a.md", "项目 A 日志保留 30 天。", a.id);
    while (await f.wiki.workOne(f.token)) {}
    await f.source("b.md", "项目 B 日志保留 7 天。", b.id);
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(2);
    await f.source("shared.md", "所有项目日志必须归档。");
    while (await f.wiki.workOne(f.token)) {}
    const all = await f.wiki.list(f.token);
    expect(all.items).toHaveLength(3);
    const c = await f.access.createProject(f.token, "C");
    await f.source("c.md", "项目 C 日志保留 1 天。", c.id);
    while (await f.wiki.workOne(f.token)) {}
    const project = await f.wiki.list(f.token, c.id);
    expect(project.items).toHaveLength(2);
    const pages = await Promise.all(
      project.items.map((item) => f.wiki.page(f.token, item.id)),
    );
    const sharedPage = pages.find((page) => page.text.includes("所有项目"))!;
    expect(sharedPage.text).not.toContain("1 天");
    expect(
      pages.find((page) => page.text.includes("1 天"))!.sources,
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);

test("candidate reuse cannot publish when detailed original inspection is incomplete", async () => {
  class Incomplete extends ScriptedWikiModel {
    blocked = false;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (phase === "inspection" && this.blocked)
        return {
          windowHash: input.windowHash,
          complete: false,
          reason: "required qualifier is unresolved",
          remaining: ["qualifier"],
        };
      return super.request(phase, input, signal);
    }
  }
  const model = new Incomplete(),
    f = await fixture(model);
  try {
    await f.source("a.md", "生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const prior = (await f.wiki.list(f.token)).items[0]!;
    model.blocked = true;
    const operation = await f.source("b.md", "测试日志保留 7 天。");
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, prior.id)).version).toBe(prior.version);
    const outcome = await f.wiki.inspect(f.token, operation.id);
    expect(outcome.jobs[0]!.state).toBe("failed");
    expect(JSON.stringify(outcome)).toContain("qualifier");
  } finally {
    await f.close();
  }
}, 30000);

test("a failed second topic review leaves the entire source edit set unpublished", async () => {
  class RejectBackup extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (
        phase === "review" &&
        (input.topic as TopicDescriptor).title === "备份规则"
      )
        return {
          ...(result as object),
          claims: (
            result as { claims: Array<Record<string, unknown>> }
          ).claims.map((claim) => ({ ...claim, verdict: "insufficient" })),
        };
      return result;
    }
  }
  const f = await fixture(new RejectBackup());
  try {
    const operation = await f.source(
      "rules.md",
      "生产日志保留 30 天。\n\n数据库备份保留 7 天。",
    );
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(0);
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "failed",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("large source coverage produces bounded separately reviewed blocks without losing final passages", async () => {
  const f = await fixture();
  try {
    const text = Array.from(
      { length: 30 },
      (_, i) =>
        `环境 ${i + 1} 的日志保留 ${i + 1} 天，归档后由该环境负责人审核。`,
    ).join("\n\n");
    const operation = await f.source("large.md", text);
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    const page = await f.wiki.page(f.token, pages.items[0]!.id);
    expect(page.text).toContain("环境 30");
    expect(page.certificates.length).toBeGreaterThan(1);
    expect(page.sources).toHaveLength(30);
    const calls = (f.model as ScriptedWikiModel).calls;
    expect(
      calls.filter((call) => call.phase === "extraction").length,
    ).toBeGreaterThan(1);
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "succeeded",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("one oversized original passage retains contiguous locators through bounded source packets", async () => {
  const f = await fixture();
  try {
    const text =
      "日志归档须保留环境信息。".repeat(160) + "最后的日志保留规则是 99 天。";
    const operation = await f.source("long.md", text);
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    const page = await f.wiki.page(f.token, pages.items[0]!.id);
    expect(page.text).toContain("99 天");
    expect(page.sources.map((ref) => ref.text).join("")).toBe(text);
    expect(new Set(page.sources.map((ref) => ref.passageId)).size).toBe(1);
  } finally {
    await f.close();
  }
}, 30000);

test("provider and malformed-output retries consume the original durable extraction allowance", async () => {
  class Retry extends ScriptedWikiModel {
    attempts = 0;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (phase === "extraction" && ++this.attempts === 1)
        throw new Error("temporary_provider_failure");
      return super.request(phase, input, signal);
    }
  }
  const model = new Retry(),
    f = await fixture(model);
  try {
    const operation = await f.source("a.md", "生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(1);
    expect(model.attempts).toBe(2);
    const receipt = await f.wiki.inspect(f.token, operation.id);
    expect(receipt.jobs[0]!.state).toBe("succeeded");
  } finally {
    await f.close();
  }
}, 30000);

test("confirmed subject proofs are published as dependencies and invalidate Wiki independently of its rule source", async () => {
  class Subject extends ScriptedWikiModel {
    dependencies: TopicDescriptor["identities"] = [];
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "extraction")
        for (const topic of (result as TopicExtraction).topics) {
          topic.identities = this.dependencies;
          topic.identityRequired = true;
        }
      return result;
    }
  }
  const model = new Subject(),
    f = await fixture(model);
  try {
    const original = await f.source("identity.md", "Atlas 提供服务。");
    const version = await f.sources.version(f.token, original.versionId);
    const binding = await f.identities.record(f.token, {
      version: version.version,
      passageId: version.passages[0]!.id,
      label: "Atlas",
    });
    model.dependencies = [
      {
        mentionId: binding.id,
        revisionId: binding.revisionId,
        proofId: binding.proofs[0]!.id,
      },
    ];
    await f.source("rule.md", "Atlas 日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    expect(pages.items[0]!.fresh).toBe(true);
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "identity.md",
      documentId: original.documentId,
      expectedPrior: original.versionId,
      bytes: new TextEncoder().encode("Atlas 已更名。"),
    });
    await f.sources.workOne();
    expect((await f.wiki.page(f.token, pages.items[0]!.id)).fresh).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);

test("overflow beyond four packet topics advances a bounded child over the remaining passage", async () => {
  class Five extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (phase !== "extraction") return super.request(phase, input, signal);
      const pack = input.pack as WikiPack,
        base = (await super.request(phase, input, signal)) as TopicExtraction;
      const topics = pack.items.slice(0, 4).map((item) => ({
        ...base.topics[0]!,
        title: item.text.trim(),
        subjectKey: item.text.trim(),
        handles: [item.handle],
      }));
      return {
        topics,
        coverage: pack.items.map((item, index) => ({
          handle: item.handle,
          topicIndexes: index < 4 ? [index] : [],
          outcome: index < 4 ? "assigned" : "unresolved",
        })),
      };
    }
  }
  const f = await fixture(new Five());
  try {
    const operation = await f.source(
      "five.md",
      Array.from(
        { length: 5 },
        (_, i) => `环境 ${i} 日志保留 ${i + 1} 天。`,
      ).join("\n\n"),
    );
    while (await f.wiki.workOne(f.token)) {
      await f.restartWiki();
    }
    expect((await f.wiki.list(f.token)).items).toHaveLength(5);
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "succeeded",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("a source-supported shared link creates a project navigation entry without copying the shared page", async () => {
  class Linking extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (
        phase === "planning" &&
        input.scope !== "shared" &&
        (input.candidates as unknown[]).length
      )
        return {
          ...(result as object),
          action: "link",
          pageId: (input.candidates as Array<{ id: string }>)[0]!.id,
        };
      return result;
    }
  }
  const f = await fixture(new Linking());
  try {
    await f.source("shared.md", "所有项目日志必须归档。");
    while (await f.wiki.workOne(f.token)) {}
    const prior = (await f.wiki.list(f.token)).items[0]!;
    const project = await f.access.createProject(f.token, "Project");
    const operation = await f.source(
      "project.md",
      "本项目日志必须归档，遵循共享规则。",
      project.id,
    );
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(1);
    expect((await f.wiki.page(f.token, prior.id)).version).toBe(prior.version);
    expect(
      (await f.wiki.navigation(f.token, project.id)).items.map(
        (item) => item.pageId,
      ),
    ).toEqual([prior.id]);
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "succeeded",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("Wiki-assisted retrieval returns current original evidence once and excludes stale Wiki prose", async () => {
  const f = await fixture();
  try {
    const operation = await f.source("rule.md", "生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const evidence = new EvidenceService(f.sources, f.wiki);
    const pack = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "日志保留",
      routes: ["source", "wiki"],
      signal: AbortSignal.timeout(5000),
    });
    expect(pack.diagnostics.wikiCandidates).toBe(1);
    expect(
      new Set(pack.items.map((item) => `${item.version}:${item.passageId}`))
        .size,
    ).toBe(pack.items.length);
    expect(pack.items[0]!.text).toContain("30 天");
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "rule.md",
      documentId: operation.documentId,
      expectedPrior: operation.versionId,
      bytes: new TextEncoder().encode("生产日志保留 7 天。"),
    });
    await f.sources.workOne();
    const changed = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "日志保留",
      routes: ["source", "wiki"],
      signal: AbortSignal.timeout(5000),
    });
    expect(changed.diagnostics.wikiCandidates).toBe(0);
    expect(changed.items.every((item) => !item.text.includes("30 天"))).toBe(
      true,
    );
    evidence.release(pack.runId);
    evidence.release(changed.runId);
  } finally {
    await f.close();
  }
}, 30000);

test("a high-ranked creation proposal without substantive support cannot publish a bare entity page", async () => {
  class Unsupported extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "planning")
        return {
          ...(result as object),
          contribution: {
            handles: ["e1"],
            claim: "日志服务",
            question: "这个名字是什么？",
            substantive: false,
          },
        };
      return result;
    }
  }
  const f = await fixture(new Unsupported());
  try {
    const operation = await f.source("entity.md", "日志服务");
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(0);
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "failed",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("independent controlled maintenance jobs can overlap; actual HTTP limits are tested at transport", async () => {
  class Busy extends ScriptedWikiModel {
    active = 0;
    peak = 0;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return await super.request(phase, input, signal);
      } finally {
        this.active--;
      }
    }
  }
  const model = new Busy(),
    f = await fixture(model);
  try {
    await f.source("a.md", "日志保留 30 天。");
    await f.source("b.md", "备份保留 7 天。");
    await Promise.all([f.wiki.workOne(f.token), f.wiki.workOne(f.token)]);
    expect(model.peak).toBe(2);
    expect((await f.wiki.list(f.token)).items).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30000);

test("optional catalogue projection recovery does not delay a supported novelty decision", async () => {
  const controlled = new ControlledEmbeddings();
  let offline = false;
  const embeddings: EmbeddingAdapter = {
    profile: controlled.profile,
    dimensions: controlled.dimensions,
    async embed(texts, signal) {
      if (offline) throw new Error("offline");
      return controlled.embed(texts, signal);
    },
  };
  const f = await fixture(new ScriptedWikiModel(), embeddings);
  try {
    await f.source("a.md", "日志保留 30 天。");
    offline = true;
    while (await f.wiki.workOne(f.token)) {}
    const existing = (await f.wiki.list(f.token)).items[0]!;
    offline = false;
    const operation = await f.source("b.md", "备份保留 7 天。");
    offline = true;
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "succeeded",
    );
    offline = false;
    await f.wiki.retryProjection(f.token, existing.id, crypto.randomUUID());
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "succeeded",
    );
    expect((await f.wiki.list(f.token)).items).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30000);

test("no-content-change keeps the stable effective version and records the checked contribution", async () => {
  class Unchanged extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      return phase === "planning" &&
        (result as { action: string }).action === "update"
        ? { ...(result as object), action: "no_change" }
        : result;
    }
  }
  const f = await fixture(new Unchanged());
  try {
    await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const operation = await f.source("b.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.page(f.token, page.id)).version).toBe(page.version);
    const receipt = await f.wiki.inspect(f.token, operation.id);
    expect(receipt.jobs[0]!.state).toBe("succeeded");
    expect(JSON.stringify(receipt)).toContain("no_change");
  } finally {
    await f.close();
  }
}, 30000);

test("a candidate's original changing after detailed inspection invalidates the creation plan", async () => {
  class Change extends ScriptedWikiModel {
    change: (() => Promise<void>) | undefined;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "planning" && input.inspection && this.change) {
        const change = this.change;
        this.change = undefined;
        await change();
      }
      return result;
    }
  }
  const model = new Change(),
    f = await fixture(model);
  try {
    const old = await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    model.change = async () => {
      await f.sources.submit(f.token, {
        key: crypto.randomUUID(),
        filename: "a.md",
        documentId: old.documentId,
        expectedPrior: old.versionId,
        bytes: new TextEncoder().encode("日志保留 7 天。"),
      });
      await f.sources.workOne();
    };
    const operation = await f.source("b.md", "备份保留 90 天。");
    await f.wiki.workOne(f.token);
    const receipt = await f.wiki.inspect(f.token, operation.id);
    expect(receipt.jobs[0]!.state).toBe("failed");
    expect((await f.wiki.list(f.token)).items).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);

test("large topic planning uses bounded original context while all assigned passages reach reviewed publication", async () => {
  const f = await fixture();
  try {
    const text = Array.from(
      { length: 100 },
      (_, i) => `区域 ${i + 1} 日志保留 ${i + 1} 天。`,
    ).join("\n\n");
    const operation = await f.source("hundred.md", text);
    while (await f.wiki.workOne(f.token)) {}
    const pages = await f.wiki.list(f.token);
    expect(pages.items).toHaveLength(1);
    const page = await f.wiki.page(f.token, pages.items[0]!.id);
    expect(page.text).toContain("区域 100");
    expect(page.text).not.toContain("来源分歧尚未解决");
    expect(page.sources).toHaveLength(100);
    expect((await f.wiki.inspect(f.token, operation.id)).jobs[0]!.state).toBe(
      "succeeded",
    );
  } finally {
    await f.close();
  }
}, 30000);

test("a factual catalogue title cannot publish when the reviewed draft omits it", async () => {
  class BodyOnly extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (phase === "generation") {
        const draft = result as {
          text: string;
          claims: Array<{
            start: number;
            end: number;
            id: string;
            premises: string[];
          }>;
        };
        const offset = draft.text.indexOf("\n\n") + 2;
        return {
          text: draft.text.slice(offset),
          claims: draft.claims.slice(1).map((claim) => ({
            ...claim,
            start: claim.start - offset,
            end: claim.end - offset,
          })),
        };
      }
      if (phase === "review")
        return {
          ...(result as object),
          claims: (
            result as { claims: Array<Record<string, unknown>> }
          ).claims.map((claim) => ({
            ...claim,
            verdict: "supported",
            standalone: true,
          })),
        };
      return result;
    }
  }
  const f = await fixture(new BodyOnly());
  try {
    await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    expect((await f.wiki.list(f.token)).items).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);

test("spent review retries prevent dispatch of another uncertifiable draft", async () => {
  class Spent extends ScriptedWikiModel {
    reviews = 0;
    generations = 0;
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (phase === "generation") this.generations++;
      if (phase === "review" && ++this.reviews <= 2)
        throw new Error("temporary_review_transport");
      const result = await super.request(phase, input, signal);
      if (phase === "review")
        return {
          ...(result as object),
          claims: (
            result as { claims: Array<Record<string, unknown>> }
          ).claims.map((claim) => ({ ...claim, verdict: "insufficient" })),
        };
      return result;
    }
  }
  const model = new Spent(),
    f = await fixture(model);
  try {
    await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    expect(model.reviews).toBe(3);
    expect(model.generations).toBe(1);
    expect((await f.wiki.list(f.token)).items).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);

test("an assigned passage without a topic cannot masquerade as completed coverage", async () => {
  const model: WikiModel = {
    profile: "invalid-coverage-fixture",
    async request(phase, input, signal) {
      signal.throwIfAborted();
      const pack = input.pack as WikiPack;
      return {
        topics: [],
        coverage: pack.items.map((item) => ({
          handle: item.handle,
          topicIndexes: [],
          outcome: "assigned",
        })),
      };
    },
  };
  const f = await fixture(model);
  try {
    const operation = await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const receipt = await f.wiki.inspect(f.token, operation.id);
    expect(receipt.jobs[0]!.state).toBe("failed");
    expect(JSON.stringify(receipt)).toContain("invalid_source_coverage");
  } finally {
    await f.close();
  }
}, 30000);

test("only the final inspected restructuring proposal is retained for later execution", async () => {
  class Proposal extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      if (
        phase === "planning" &&
        (input.candidates as Array<{ id: string }>).length
      )
        return {
          ...(result as object),
          proposals: [
            {
              kind: "split",
              pageIds: [(input.candidates as Array<{ id: string }>)[0]!.id],
              reason: input.inspection
                ? "final inspected proposal"
                : "preliminary proposal",
            },
          ],
        };
      return result;
    }
  }
  const f = await fixture(new Proposal());
  try {
    await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const operation = await f.source("b.md", "测试日志保留 7 天。");
    while (await f.wiki.workOne(f.token)) {}
    const result = await f.wiki.inspect(f.token, operation.id);
    expect(result.proposals.map((proposal) => proposal.reason)).toEqual([
      "final inspected proposal",
    ]);
  } finally {
    await f.close();
  }
}, 30000);

test("no-change cannot silently skip a new rule at the end of a long contribution", async () => {
  class NoChange extends ScriptedWikiModel {
    override async request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const result = await super.request(phase, input, signal);
      return phase === "planning" &&
        (result as { action: string }).action === "update"
        ? { ...(result as object), action: "no_change" }
        : result;
    }
  }
  const f = await fixture(new NoChange());
  try {
    await f.source("a.md", "日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const prior = (await f.wiki.list(f.token)).items[0]!;
    const operation = await f.source(
      "long.md",
      Array.from({ length: 100 }, () => "日志保留 30 天。").join("\n\n") +
        "\n\n监管日志须保留 999 天。",
    );
    while (await f.wiki.workOne(f.token)) {}
    const receipt = await f.wiki.inspect(f.token, operation.id);
    expect(receipt.jobs[0]!.state).toBe("failed");
    expect(JSON.stringify(receipt)).toContain("uninspected_contribution");
    expect((await f.wiki.page(f.token, prior.id)).version).toBe(prior.version);
  } finally {
    await f.close();
  }
}, 30000);

test("AC22: legacy page fallback ranks original references before the fifty-reference cap", async () => {
  const f = await fixture();
  const { default: postgres } = await import("postgres");
  const sql = postgres(url!);
  try {
    await f.source(
      "logs.md",
      Array.from(
        { length: 61 },
        (_, index) =>
          `生产日志保留 30 天。${index === 60 ? "needle-last-reference" : `ordinary-reference-${index}`}。`,
      ).join("\n\n"),
    );
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const historical = await f.wiki.page(f.token, page.id);
    expect(historical.sources).toHaveLength(61);
    // A historical generation predating claim/section associations retains only page refs.
    await sql`UPDATE wiki_versions SET certificates='[]'::jsonb WHERE id=${page.version}`;
    const result = await f.wiki.search(f.token, {
      question: "needle-last-reference",
      signal: AbortSignal.timeout(5000),
    });
    expect(result.originals.length).toBeLessThanOrEqual(50);
    expect(result.originals[0]?.text).toContain("needle-last-reference");
    expect(result).toMatchObject({ truncated: true, pageLevelMapping: true });
    const pack = await new EvidenceService(f.sources, f.wiki).retrieve(
      f.token,
      {
        runId: crypto.randomUUID(),
        question: "needle-last-reference",
        routes: ["wiki"],
        signal: AbortSignal.timeout(5000),
      },
    );
    expect(pack.diagnostics.gaps).toContain("wiki_page_level_mapping");
  } finally {
    await sql.end();
    await f.close();
  }
}, 15000);

test("AC22/24: scoped Wiki readiness distinguishes unfinished maintenance from empty knowledge", async () => {
  class Unavailable extends ScriptedWikiModel {
    failed = false;
    override request(
      phase: WikiPhase,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      if (this.failed) throw new Error("provider_http_401");
      return super.request(phase, input, signal);
    }
  }
  const model = new Unavailable(),
    f = await fixture(model);
  try {
    const project = await f.access.createProject(f.token, "active-import"),
      other = await f.access.createProject(f.token, "other-project");
    const first = await f.source("logs.md", "生产日志保留 30 天。", project.id);
    const service = new EvidenceService(f.sources, f.wiki);
    const retrieve = (projectId: string) =>
      service.retrieve(f.token, {
        runId: crypto.randomUUID(),
        question: "日志保留",
        projectId,
        routes: ["source", "wiki"],
        signal: AbortSignal.timeout(5000),
      });
    const pending = await retrieve(project.id);
    expect(pending.diagnostics.routeOutcomes?.wiki?.status).toBe("pending");
    expect(pending.items.some((item) => item.version === first.versionId)).toBe(
      true,
    );
    const answer = await service.finalizeDirect(
      f.token,
      pending.runId,
      {
        basis: "source",
        text: "日志保留30天 [" + pending.items[0]!.handle + "]",
        citations: [pending.items[0]!.handle],
        gaps: [],
        conflicts: [],
      },
      AbortSignal.timeout(5000),
    );
    expect(answer.status).toBe("answered");
    expect(
      (await retrieve(other.id)).diagnostics.routeOutcomes?.wiki?.status,
    ).toBe("empty");
    while (await f.wiki.workOne(f.token)) {}
    expect(
      (await retrieve(project.id)).diagnostics.routeOutcomes?.wiki?.status,
    ).toBe("success");
    const changed = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "logs.md",
      projectId: project.id,
      documentId: first.documentId,
      expectedPrior: first.versionId,
      bytes: new TextEncoder().encode("生产日志保留 90 天。"),
    });
    const context = await f.access.authorize(f.token, "read");
    await f.sources.workOne({ organizationId: context.organizationId });
    const stale = await retrieve(project.id);
    expect(stale.diagnostics.routeOutcomes?.wiki?.status).toBe("pending");
    expect(stale.items.some((item) => item.version === first.versionId)).toBe(
      false,
    );
    expect(stale.items.some((item) => item.version === changed.versionId)).toBe(
      true,
    );
    model.failed = true;
    while (await f.wiki.workOne(f.token)) {}
    const unavailable = await retrieve(project.id);
    expect(unavailable.diagnostics.routeOutcomes?.wiki?.status).toBe(
      "unavailable",
    );
    expect(unavailable.diagnostics.gaps).toContain("wiki_incomplete");
  } finally {
    await f.close();
  }
}, 15000);
