import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import type { EmbeddingAdapter } from "../src/embeddings.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
/** Known semantic coordinates isolate real pgvector retrieval from model quality. */
const embeddings: EmbeddingAdapter = {
  profile: "retrieval-fixture-v1",
  dimensions: 4,
  async embed(texts, signal) {
    signal.throwIfAborted();
    return texts.map((text) => [
      /日志|记录|保留|保存/.test(text) ? 1 : 0,
      /SKU-004|库存/.test(text) ? 1 : 0,
      /离职|账户|注销/.test(text) ? 1 : 0,
      0.01,
    ]);
  },
};
async function fixture() {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `evidence-${crypto.randomUUID()}`,
    username: "admin",
    password: "evidence-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const sources = new SourceService(url!, access, embeddings);
  async function importText(
    filename: string,
    text: string,
    projectId?: string,
  ) {
    const operation = await sources.submit(token, {
      key: crypto.randomUUID(),
      filename,
      bytes: new TextEncoder().encode(text),
      ...(projectId ? { projectId } : {}),
    });
    await sources.workOne();
    return operation;
  }
  return {
    access,
    token,
    sources,
    importText,
    async close() {
      await sources.close();
      await access.close();
    },
  };
}
test("hybrid original retrieval fuses lexical/vector ranks, preserves Chinese identifiers and resolves paraphrases under scope", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    const a = await f.access.createProject(f.token, "A"),
      b = await f.access.createProject(f.token, "B");
    const log = await f.importText(
      "logs.md",
      "生产环境的应用日志保留 30 天；测试环境不保留。",
      a.id,
    );
    const sku = await f.importText(
      "inventory.md",
      "SKU-004 使用 PostgreSQL 存储库存，通过 HTTP/2 查询。",
    );
    await f.importText("foreign-project.md", "项目 B 日志保留 90 天。", b.id);
    const service = new EvidenceService(f.sources);
    const pack = await service.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "系统记录要保存多长时间？",
      projectId: a.id,
      signal: AbortSignal.timeout(5000),
    });
    expect(pack.items[0]!.version).toBe(log.versionId);
    expect(pack.items[0]!.text).toContain("测试环境不保留");
    expect(
      pack.items.every((item) => item.text !== "项目 B 日志保留 90 天。"),
    ).toBe(true);
    expect(
      new Set(pack.items.map((item) => `${item.version}:${item.passageId}`))
        .size,
    ).toBe(pack.items.length);
    expect(pack.diagnostics.vectorCandidates).toBeGreaterThan(0);
    const technical = await service.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "SKU-004 HTTP/2 PostgreSQL",
      projectId: a.id,
      signal: AbortSignal.timeout(5000),
    });
    expect(technical.items[0]!.version).toBe(sku.versionId);
    expect(technical.diagnostics.lexicalCandidates).toBeGreaterThan(0);
    const source = await f.sources.resolve(
      f.token,
      pack.items[0]!.version,
      pack.items[0]!.passageId,
    );
    expect(source.text).toBe(pack.items[0]!.text);
  } finally {
    await f.close();
  }
});

test("answer admission binds exact claim spans and review to originals, returning resolvable citations", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  const calls: string[] = [];
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const input = (await request.json()) as {
        phase: string;
        draft?: { hash: string };
        pack: { hash: string; items: Array<{ handle: string; text: string }> };
      };
      calls.push(input.phase);
      if (input.phase === "generation")
        return Response.json({
          text: "生产日志保留 30 天。",
          claims: [
            {
              id: "c1",
              start: 0,
              end: 12,
              role: "fact",
              handles: [input.pack.items[0]!.handle],
              subject: "应用日志",
              scope: "生产环境",
              conditions: [],
              attribution: "source",
              premises: [],
            },
          ],
        });
      return Response.json({
        draftHash: input.draft!.hash,
        evidenceHash: input.pack.hash,
        unlistedClaims: [],
        claims: [
          {
            id: "c1",
            verdict: "supported",
            reason: "原文明确规定",
            spans: [
              {
                handle: input.pack.items[0]!.handle,
                start: 0,
                end: input.pack.items[0]!.text.length,
              },
            ],
          },
        ],
      });
    },
  });
  try {
    await f.importText("logs.md", "生产环境的应用日志保留 30 天。");
    const service = new EvidenceService(f.sources),
      pack = await service.retrieve(f.token, {
        runId: crypto.randomUUID(),
        question: "生产日志保留多久",
        signal: AbortSignal.timeout(5000),
      });
    const remaining = { generation: 2, review: 2 };
    const answer = await service.finalize(f.token, pack, {
      signal: AbortSignal.timeout(5000),
      model: "scripted-fixture-v1",
      remaining: (phase) => remaining[phase],
      async request(phase, input) {
        remaining[phase]--;
        return (
          await fetch(provider.url, {
            method: "POST",
            body: JSON.stringify({ phase, ...input }),
          })
        ).json();
      },
    });
    expect(answer.status).toBe("answered");
    expect(answer.text).toBe("生产日志保留 30 天。");
    expect(calls).toEqual(["generation", "review"]);
    expect(answer.citations).toHaveLength(1);
    expect(answer.certificate?.draftHash).toHaveLength(64);
    expect(answer.certificate?.evidenceHash).toBe(pack.hash);
    const citation = answer.citations[0]!;
    expect(
      (await f.sources.resolve(f.token, citation.version, citation.passageId))
        .text,
    ).toContain("30 天");
  } finally {
    provider.stop(true);
    await f.close();
  }
});

test("a contradicted real-citation draft is repaired and the changed draft is independently reviewed", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    await f.importText(
      "logs.md",
      "生产环境的应用日志保留 30 天。测试环境不保留。",
    );
    const service = new EvidenceService(f.sources),
      pack = await service.retrieve(f.token, {
        runId: crypto.randomUUID(),
        question: "生产日志多久",
        signal: AbortSignal.timeout(5000),
      });
    const remaining = { generation: 2, review: 2 },
      calls: string[] = [],
      draftHashes: string[] = [];
    const answer = await service.finalize(f.token, pack, {
      signal: AbortSignal.timeout(5000),
      model: "scripted-review-v1",
      remaining: (phase) => remaining[phase],
      async request(phase, input) {
        remaining[phase]--;
        calls.push(phase);
        if (phase === "generation") {
          const text =
            remaining.generation === 1
              ? "生产日志保留 90 天。"
              : "生产日志保留 30 天。";
          return {
            text,
            claims: [
              {
                id: "c1",
                start: 0,
                end: 12,
                role: "fact",
                handles: [pack.items[0]!.handle],
                subject: "日志",
                scope: "生产",
                conditions: [],
                attribution: "source",
                premises: [],
              },
            ],
          };
        }
        const draft = input.draft as { hash: string; text: string };
        draftHashes.push(draft.hash);
        return {
          draftHash: draft.hash,
          evidenceHash: pack.hash,
          unlistedClaims: [],
          claims: [
            {
              id: "c1",
              verdict: draft.text.includes("90") ? "contradicted" : "supported",
              reason: "核对原文数字",
              spans: [
                {
                  handle: pack.items[0]!.handle,
                  start: 0,
                  end: pack.items[0]!.text.length,
                },
              ],
            },
          ],
        };
      },
    });
    expect(answer.text).not.toContain("90");
    expect(answer.text).toContain("30");
    expect(calls).toEqual(["generation", "review", "generation", "review"]);
    expect(new Set(draftHashes).size).toBe(2);
  } finally {
    await f.close();
  }
});

test("real handles cannot admit wrong numbers, dropped negation/scope, unsupported inference, or unlisted assertions", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    await f.importText(
      "rules.md",
      "生产环境日志保留 30 天。测试环境不保留日志。A 依赖 B；B 依赖 C，这不表示 A 拥有 C。",
    );
    for (const [text, verdict, unlisted] of [
      ["生产环境日志保留 90 天。", "contradicted", false],
      ["测试环境保留日志。", "contradicted", false],
      ["所有环境日志均保留 30 天。", "insufficient", false],
      ["A 拥有 C。", "insufficient", false],
      ["系统完全符合所有法规。", "supported", true],
    ] as const) {
      const service = new EvidenceService(f.sources),
        pack = await service.retrieve(f.token, {
          runId: crypto.randomUUID(),
          question: "日志规则和依赖关系",
          signal: AbortSignal.timeout(5000),
        });
      const remaining = { generation: 2, review: 2 },
        calls: string[] = [];
      await expect(
        service.finalize(f.token, pack, {
          signal: AbortSignal.timeout(5000),
          model: "scripted-fixture-v1",
          remaining: (phase) => remaining[phase],
          async request(phase, input) {
            remaining[phase]--;
            calls.push(phase);
            if (phase === "generation")
              return {
                text,
                claims: [
                  {
                    id: "c1",
                    start: 0,
                    end: text.length,
                    role: unlisted ? "gap" : "fact",
                    handles: [pack.items[0]!.handle],
                    subject: "日志",
                    scope: "生产",
                    conditions: [],
                    attribution: "source",
                    premises: [],
                  },
                ],
              };
            return {
              draftHash: (input.draft as { hash: string }).hash,
              evidenceHash: pack.hash,
              unlistedClaims: unlisted ? [text] : [],
              claims: [
                {
                  id: "c1",
                  verdict,
                  reason: "与原文条件逐项对照",
                  spans: [
                    {
                      handle: pack.items[0]!.handle,
                      start: 0,
                      end: pack.items[0]!.text.length,
                    },
                  ],
                },
              ],
            };
          },
        }),
      ).rejects.toThrow(unlisted ? "invalid_review" : "insufficient_evidence");
      expect(calls.filter((phase) => phase === "review")).toHaveLength(2);
      expect(calls.length).toBeLessThanOrEqual(4);
    }
  } finally {
    await f.close();
  }
});

test("fabricated handles, mismatched certificates, invalid original spans and reviewer outages fail closed", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    await f.importText("rules.md", "日志保留 30 天。");
    for (const scenario of ["handle", "hash", "span", "outage"]) {
      const service = new EvidenceService(f.sources),
        pack = await service.retrieve(f.token, {
          runId: crypto.randomUUID(),
          question: "日志保留",
          signal: AbortSignal.timeout(5000),
        });
      const remaining = { generation: 2, review: 2 },
        calls: string[] = [];
      await expect(
        service.finalize(f.token, pack, {
          signal: AbortSignal.timeout(5000),
          model: "scripted-fixture-v1",
          remaining: (phase) => remaining[phase],
          async request(phase, input) {
            remaining[phase]--;
            calls.push(phase);
            const text = "日志保留 30 天。";
            if (phase === "generation")
              return {
                text,
                claims: [
                  {
                    id: "c1",
                    start: 0,
                    end: text.length,
                    role: "fact",
                    handles: [
                      scenario === "handle" ? "e999" : pack.items[0]!.handle,
                    ],
                    subject: "日志",
                    scope: "原文",
                    conditions: [],
                    attribution: "source",
                    premises: [],
                  },
                ],
              };
            if (scenario === "outage") throw new Error("provider_unavailable");
            return {
              draftHash:
                scenario === "hash"
                  ? "forged"
                  : (input.draft as { hash: string }).hash,
              evidenceHash: pack.hash,
              unlistedClaims: [],
              claims: [
                {
                  id: "c1",
                  verdict: "supported",
                  reason: "原文明确",
                  spans: [
                    {
                      handle: pack.items[0]!.handle,
                      start: 0,
                      end:
                        scenario === "span"
                          ? 99999
                          : pack.items[0]!.text.length,
                    },
                  ],
                },
              ],
            };
          },
        }),
      ).rejects.toThrow(
        scenario === "handle"
          ? "invalid_citation"
          : scenario === "outage"
            ? "provider_unavailable"
            : "invalid_review",
      );
      expect(calls.filter((phase) => phase === "review")).toHaveLength(
        scenario === "handle" ? 0 : 2,
      );
      expect(calls.filter((phase) => phase === "generation")).toHaveLength(
        scenario === "handle" ? 2 : 1,
      );
    }
  } finally {
    await f.close();
  }
});

test("exhausted repair returns only independently reviewed unchanged claims with their qualifiers", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    await f.importText(
      "rules.md",
      "仅生产环境日志保留 30 天。测试环境不保留日志。",
    );
    const service = new EvidenceService(f.sources),
      pack = await service.retrieve(f.token, {
        runId: crypto.randomUUID(),
        question: "生产和测试日志",
        signal: AbortSignal.timeout(5000),
      });
    const text = "仅生产环境日志保留 30 天。\n测试环境日志保留 90 天。",
      first = "仅生产环境日志保留 30 天。";
    const remaining = { generation: 1, review: 1 };
    const result = await service.finalize(f.token, pack, {
      signal: AbortSignal.timeout(5000),
      model: "scripted-fixture-v1",
      remaining: (phase) => remaining[phase],
      async request(phase, input) {
        remaining[phase]--;
        if (phase === "generation")
          return {
            text,
            claims: [
              {
                id: "c1",
                start: 0,
                end: first.length,
                role: "fact",
                handles: [pack.items[0]!.handle],
                subject: "日志",
                scope: "仅生产环境",
                conditions: [],
                attribution: "source",
                premises: [],
              },
              {
                id: "c2",
                start: first.length + 1,
                end: text.length,
                role: "fact",
                handles: [pack.items[0]!.handle],
                subject: "日志",
                scope: "测试环境",
                conditions: [],
                attribution: "source",
                premises: [],
              },
            ],
          };
        return {
          draftHash: (input.draft as { hash: string }).hash,
          evidenceHash: pack.hash,
          unlistedClaims: [],
          claims: [
            {
              id: "c1",
              verdict: "supported",
              standalone: true,
              reason: "生产条件与数字有原文支持",
              spans: [
                { handle: pack.items[0]!.handle, start: 0, end: first.length },
              ],
            },
            {
              id: "c2",
              verdict: "contradicted",
              standalone: true,
              reason: "测试环境不保留",
              spans: [
                {
                  handle: pack.items[0]!.handle,
                  start: first.length,
                  end: pack.items[0]!.text.length,
                },
              ],
            },
          ],
        };
      },
    });
    expect(result.status).toBe("partial");
    expect(result.text).toContain(first);
    expect(result.text).not.toContain("90");
    expect(result.certificate).toBeUndefined();
    expect(result.subset?.retainedClaimIds).toEqual(["c1"]);
    expect(result.reason).toBe("incomplete_support");
  } finally {
    await f.close();
  }
});

test("Forge conversation answers from imported originals and records shared-budget evidence diagnostics", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const { KnowledgeHost } = await import("../src/host.ts");
  const { PostgresConversations } = await import("../src/conversations.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const f = await fixture(),
    conversations = new PostgresConversations(url!),
    provider = startScriptedProvider();
  const host = new KnowledgeHost({
    access: f.access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    evidence: new EvidenceService(f.sources),
  });
  try {
    const operation = await f.importText(
      "production.md",
      "生产环境的应用日志保留 60 天。测试环境不保留。",
    );
    const accepted = await host.start({
      credential: f.token,
      question: "生产环境日志保留多久？",
    });
    await host.settled(accepted.id);
    const answer = await host.get(accepted.id, f.token);
    expect(answer.status).toBe("answered");
    expect(answer.answer?.text).toContain("60 天");
    expect(answer.answer?.citations[0]!.version).toBe(operation.versionId);
    expect(answer.answer?.certificate?.draftHash).toHaveLength(64);
    expect(answer.counts.generation).toBe(1);
    expect(answer.counts.review).toBe(1);
    expect(answer.diagnostics?.embeddingRequests).toBe(1);
    expect(answer.diagnostics?.retrievalMs).toBeGreaterThanOrEqual(0);
    expect(
      provider.calls.filter((call) => call.phase === "generation"),
    ).toHaveLength(1);
    expect(
      provider.calls.filter((call) => call.phase === "review"),
    ).toHaveLength(1);
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await f.close();
  }
});

test("a source revision activated during review invalidates the entire delivery certificate", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    const old = await f.importText("logs.md", "日志保留 30 天。");
    const service = new EvidenceService(f.sources),
      pack = await service.retrieve(f.token, {
        runId: crypto.randomUUID(),
        question: "日志保留",
        signal: AbortSignal.timeout(5000),
      });
    const remaining = { generation: 2, review: 2 };
    await expect(
      service.finalize(f.token, pack, {
        signal: AbortSignal.timeout(5000),
        model: "scripted-fixture-v1",
        remaining: (phase) => remaining[phase],
        async request(phase, input) {
          remaining[phase]--;
          const text = "日志保留 30 天。";
          if (phase === "generation")
            return {
              text,
              claims: [
                {
                  id: "c1",
                  start: 0,
                  end: text.length,
                  role: "fact",
                  handles: [pack.items[0]!.handle],
                  subject: "日志",
                  scope: "原文",
                  conditions: [],
                  attribution: "source",
                  premises: [],
                },
              ],
            };
          await f.sources.submit(f.token, {
            key: crypto.randomUUID(),
            filename: "logs.md",
            bytes: new TextEncoder().encode("日志保留 90 天。"),
            documentId: old.documentId,
            expectedPrior: old.versionId,
          });
          await f.sources.workOne();
          return {
            draftHash: (input.draft as { hash: string }).hash,
            evidenceHash: pack.hash,
            unlistedClaims: [],
            claims: [
              {
                id: "c1",
                verdict: "supported",
                reason: "旧原文支持",
                spans: [
                  {
                    handle: pack.items[0]!.handle,
                    start: 0,
                    end: pack.items[0]!.text.length,
                  },
                ],
              },
            ],
          };
        },
      }),
    ).rejects.toThrow("source_changed");
    expect(remaining).toEqual({ generation: 1, review: 1 });
  } finally {
    await f.close();
  }
});

test("online review timeout obeys the host deadline and never publishes an unreviewed draft", async () => {
  const { EvidenceService } = await import("../src/evidence.ts"),
    { KnowledgeHost } = await import("../src/host.ts"),
    { PostgresConversations } = await import("../src/conversations.ts"),
    { FixtureSources } = await import("../src/development/sources.ts"),
    { startScriptedProvider } = await import("../src/development/provider.ts");
  const f = await fixture(),
    conversations = new PostgresConversations(url!),
    provider = startScriptedProvider({ delays: { review: 1500 } });
  const host = new KnowledgeHost({
    access: f.access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    evidence: new EvidenceService(f.sources),
    timing: { ordinaryMs: 600, ordinaryReserveMs: 400 },
  });
  try {
    await f.importText("logs.md", "日志保留 30 天。");
    const accepted = await host.start({
      credential: f.token,
      question: "日志保留多久？",
    });
    await host.settled(accepted.id);
    const result = await host.get(accepted.id, f.token);
    expect(result.status).toBe("timed_out");
    expect(result.answer).toBeUndefined();
    expect(result.counts.review).toBe(1);
    expect(
      provider.calls.filter((call) => call.phase === "review"),
    ).toHaveLength(1);
    expect(result.diagnostics!.elapsedMs!).toBeLessThan(1200);
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await f.close();
  }
});

test("retrieval retains document preconditions even when they do not match lexical or vector query terms", async () => {
  const { EvidenceService } = await import("../src/evidence.ts");
  const f = await fixture();
  try {
    await f.importText(
      "trial.md",
      [
        "以下规定仅适用于试运行环境。",
        ...Array.from(
          { length: 55 },
          (_, index) => `组件 ${index + 1} 的日志保留 30 天。`,
        ),
      ].join("\n\n"),
    );
    const service = new EvidenceService(f.sources),
      pack = await service.retrieve(f.token, {
        runId: crypto.randomUUID(),
        question: "日志保留多久",
        signal: AbortSignal.timeout(5000),
      });
    expect(
      pack.items.some((item) =>
        item.text.includes("以下规定仅适用于试运行环境"),
      ),
    ).toBe(true);
    expect(pack.diagnostics.gaps).toContain("context_limit");
  } finally {
    await f.close();
  }
});

test("applicable conflicting sources stay separately attributed instead of last-upload-wins", async () => {
  const { EvidenceService } = await import("../src/evidence.ts"),
    { KnowledgeHost } = await import("../src/host.ts"),
    { PostgresConversations } = await import("../src/conversations.ts"),
    { FixtureSources } = await import("../src/development/sources.ts"),
    { startScriptedProvider } = await import("../src/development/provider.ts");
  const f = await fixture(),
    conversations = new PostgresConversations(url!),
    provider = startScriptedProvider();
  const host = new KnowledgeHost({
    access: f.access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    evidence: new EvidenceService(f.sources),
  });
  try {
    const a = await f.importText("A.md", "生产环境日志保留 30 天。"),
      b = await f.importText("B.md", "生产环境日志保留 60 天。");
    const run = await host.start({
      credential: f.token,
      question: "生产环境日志保留多久？",
    });
    await host.settled(run.id);
    const result = await host.get(run.id, f.token);
    expect(result.status).toBe("answered");
    expect(result.answer!.text).toContain(
      "《A.md》记载：生产环境日志保留 30 天。",
    );
    expect(result.answer!.text).toContain(
      "《B.md》记载：生产环境日志保留 60 天。",
    );
    expect(result.answer!.citations.map((c) => c.version).sort()).toEqual(
      [a.versionId, b.versionId].sort(),
    );
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await f.close();
  }
});

test("failed query embedding remains an unavailable retrieval outcome with its attempted request counted", async () => {
  const { EvidenceService } = await import("../src/evidence.ts"),
    { KnowledgeHost } = await import("../src/host.ts"),
    { PostgresConversations } = await import("../src/conversations.ts"),
    { FixtureSources } = await import("../src/development/sources.ts"),
    { startScriptedProvider } = await import("../src/development/provider.ts");
  const f = await fixture(),
    conversations = new PostgresConversations(url!),
    provider = startScriptedProvider();
  const failed = new SourceService(url!, f.access, {
    ...embeddings,
    async embed() {
      throw new Error("embedding_service_down");
    },
  });
  const host = new KnowledgeHost({
    access: f.access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    evidence: new EvidenceService(failed),
  });
  try {
    await f.importText("logs.md", "日志保留 30 天。");
    const run = await host.start({
      credential: f.token,
      question: "日志保留多久？",
    });
    await host.settled(run.id);
    const result = await host.get(run.id, f.token);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("retrieval_unavailable");
    expect(result.answer).toBeUndefined();
    expect(result.diagnostics!.embeddingRequests).toBe(1);
    expect(result.counts.generation).toBe(0);
    expect(result.counts.review).toBe(0);
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await failed.close();
    await f.close();
  }
});

test("exploration retrieval aborts at its own cutoff and preserves finalization reserve", async () => {
  const { EvidenceService } = await import("../src/evidence.ts"),
    { KnowledgeHost } = await import("../src/host.ts"),
    { PostgresConversations } = await import("../src/conversations.ts"),
    { FixtureSources } = await import("../src/development/sources.ts"),
    { startScriptedProvider } = await import("../src/development/provider.ts");
  const f = await fixture(),
    conversations = new PostgresConversations(url!),
    provider = startScriptedProvider();
  let embeddingStarted = 0,
    embeddingStopped = 0;
  const gated = new SourceService(url!, f.access, {
    ...embeddings,
    async embed(_texts, signal) {
      embeddingStarted++;
      signal.throwIfAborted();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            embeddingStopped++;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
      throw new Error("unreachable");
    },
  });
  const host = new KnowledgeHost({
    access: f.access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    evidence: new EvidenceService(gated),
    timing: { ordinaryMs: 3000, ordinaryReserveMs: 2000 },
  });
  try {
    await f.importText("logs.md", "日志保留 30 天。");
    const run = await host.start({
      credential: f.token,
      question: "日志保留多久？",
    });
    await host.settled(run.id);
    const result = await host.get(run.id, f.token);
    expect(embeddingStarted).toBe(1);
    expect(embeddingStopped).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("budget_exhausted");
    expect(result.diagnostics!.elapsedMs!).toBeLessThan(1800);
    expect(result.counts.generation).toBe(0);
    expect(result.counts.review).toBe(0);
    expect(result.diagnostics!.lexicalCandidates).toBe(0);
    expect(result.diagnostics!.vectorCandidates).toBe(0);
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await gated.close();
    await f.close();
  }
});
