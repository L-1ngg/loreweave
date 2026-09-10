import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { EvidenceService } from "../src/evidence.ts";
import { PostgresConversations } from "../src/conversations.ts";
import { KnowledgeHost } from "../src/host.ts";
import { FixtureSources } from "../src/development/sources.ts";
import {
  startScriptedProvider,
  type ScriptedOptions,
} from "../src/development/provider.ts";
import { createApp } from "../src/http.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
async function fixture(options: ScriptedOptions = {}) {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `updates-${crypto.randomUUID()}`,
    username: "admin",
    password: "updates-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const sources = new SourceService(url!, access, new ControlledEmbeddings()),
    conversations = new PostgresConversations(url!),
    provider = startScriptedProvider(options);
  const host = new KnowledgeHost({
    access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    imports: sources,
    evidence: new EvidenceService(sources),
  });
  return {
    access,
    token,
    sources,
    host,
    provider,
    app: createApp(host, new FixtureSources(), { access, imports: sources }),
    async close() {
      await host.close();
      provider.stop();
      await sources.close();
      await conversations.close();
      await access.close();
    },
  };
}

test("selected-document HTTP updates preserve identity and prior evidence until preparation commits", async () => {
  const f = await fixture();
  try {
    const original = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "ops.md",
      bytes: new TextEncoder().encode("生产日志保留 30 天。"),
    });
    await f.sources.workOne();
    const old = await f.sources.version(f.token, original.versionId);
    const attachment = await f.sources.upload(f.token, {
      filename: "ops-updated.md",
      bytes: new TextEncoder().encode("生产日志保留 60 天。"),
    });
    const input = {
      key: crypto.randomUUID(),
      attachmentId: attachment.id,
      documentId: original.documentId,
      expectedPrior: original.versionId,
    };
    const headers = {
      cookie: `loreweave_session=${f.token}`,
      "content-type": "application/json",
    };
    const accepted = await f.app.request("/api/imports", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(accepted.status).toBe(202);
    const operation = (await accepted.json()) as {
      id: string;
      documentId: string;
      versionId: string;
    };
    expect(operation.documentId).toBe(original.documentId);
    expect(await f.sources.current(f.token, original.versionId)).toBe(true);
    await f.sources.workOne();
    expect(
      (await f.sources.inspect(f.token, operation.id)).maintenance
        .map((job) => job.kind)
        .sort(),
    ).toEqual([
      "graph.refresh",
      "identity.revalidate",
      "wiki.dependencies",
      "wiki.refresh",
    ]);
    expect(await f.sources.current(f.token, operation.versionId)).toBe(true);
    expect(await f.sources.current(f.token, original.versionId)).toBe(false);
    expect(
      await f.sources.resolve(f.token, original.versionId, old.passages[0]!.id),
    ).toEqual(old.passages[0]!);
    const retry = await f.app.request("/api/imports", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(((await retry.json()) as { id: string }).id).toBe(operation.id);
    const stale = await f.app.request("/api/imports", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, key: crypto.randomUUID() }),
    });
    expect(stale.status).toBe(409);
  } finally {
    await f.close();
  }
});

for (const phase of ["generation", "review"] as const) {
  test(`activation during ${phase} settles obsolete work and refreshes once in the original allowance`, async () => {
    let trigger!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      trigger = resolve;
    });
    const f = await fixture({
      delays: { [phase]: 1200 },
      onRequest: (p) => {
        if (p === phase) trigger();
      },
    });
    try {
      const original = await f.sources.submit(f.token, {
        key: crypto.randomUUID(),
        filename: "ops.md",
        bytes: new TextEncoder().encode("生产日志保留 30 天。"),
      });
      await f.sources.workOne();
      const run = await f.host.start({
        credential: f.token,
        question: "生产日志保留多久？",
      });
      await dispatched;
      const update = await f.sources.submit(f.token, {
        key: crypto.randomUUID(),
        filename: "ops.md",
        bytes: new TextEncoder().encode("生产日志保留 60 天。"),
        documentId: original.documentId,
        expectedPrior: original.versionId,
      });
      await f.sources.workOne();
      await f.host.settled(run.id);
      const result = await f.host.get(run.id, f.token);
      expect(result.status).toBe("answered");
      expect(result.refreshUsed).toBe(true);
      expect(result.counts.retrieval).toBe(2);
      expect(result.counts.generation).toBe(2);
      expect(result.counts.review).toBe(phase === "generation" ? 1 : 2);
      expect(result.supersededDraftIds).toHaveLength(1);
      expect(result.answer?.text).toContain("60 天");
      expect(
        result.answer?.citations.every(
          (item) => item.version === update.versionId,
        ),
      ).toBe(true);
      expect(
        f.provider.calls.filter((call) => call.phase === "generation"),
      ).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
}

test("a second activation during refreshed generation stops without a third retrieval or unreviewed answer", async () => {
  const waits = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  let generations = 0;
  const f = await fixture({
    delays: { generation: 1000 },
    onRequest: (phase) => {
      if (phase === "generation") waits[generations++]?.resolve();
    },
  });
  try {
    let current = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "ops.md",
      bytes: new TextEncoder().encode("生产日志保留 30 天。"),
    });
    await f.sources.workOne();
    const run = await f.host.start({
      credential: f.token,
      question: "生产日志保留多久？",
    });
    for (const [index, days] of [60, 90].entries()) {
      await waits[index]!.promise;
      current = await f.sources.submit(f.token, {
        key: crypto.randomUUID(),
        filename: "ops.md",
        bytes: new TextEncoder().encode(`生产日志保留 ${days} 天。`),
        documentId: current.documentId,
        expectedPrior: current.versionId,
      });
      await f.sources.workOne();
    }
    await f.host.settled(run.id);
    const result = await f.host.get(run.id, f.token);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("source_changed");
    expect(result.answer).toBeUndefined();
    expect(result.counts.retrieval).toBe(2);
    expect(result.counts.generation).toBe(2);
    expect(result.counts.review).toBe(0);
    expect(result.supersededDraftIds).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("source monitoring aborts and awaits the old provider promise before reporting a refreshable change", async () => {
  const f = await fixture();
  const evidence = new EvidenceService(f.sources);
  const started = Promise.withResolvers<void>(),
    settled = Promise.withResolvers<void>();
  let sawAbort = false;
  try {
    const old = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "ops.md",
      bytes: new TextEncoder().encode("生产日志保留 30 天。"),
    });
    await f.sources.workOne();
    const pack = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "日志",
      signal: AbortSignal.timeout(5000),
    });
    const answer = evidence.finalize(f.token, pack, {
      signal: AbortSignal.timeout(5000),
      remaining: () => 2,
      model: "gated-test",
      request: async (_phase, _input, signal) => {
        started.resolve();
        await new Promise<void>((resolve) =>
          signal!.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true },
          ),
        );
        await settled.promise;
        signal!.throwIfAborted();
        return {};
      },
    });
    let finished = false;
    const outcome = answer.then(
      () => {
        finished = true;
        return "answered";
      },
      (error: Error) => {
        finished = true;
        return error.message;
      },
    );
    await started.promise;
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "ops.md",
      bytes: new TextEncoder().encode("生产日志保留 60 天。"),
      documentId: old.documentId,
      expectedPrior: old.versionId,
    });
    await f.sources.workOne();
    for (let i = 0; i < 100 && !sawAbort; i++) await Bun.sleep(10);
    expect(sawAbort).toBe(true);
    expect(finished).toBe(false);
    settled.resolve();
    expect(await outcome).toBe("source_changed");
    evidence.release(pack.runId);
  } finally {
    settled.resolve();
    await f.close();
  }
});

test("reviewed subset keeps unchanged standalone premises and excludes changed support after repair consumes all slots", async () => {
  const { scriptedDraft, scriptedReview } =
    await import("../src/development/evidence-model.ts");
  const f = await fixture(),
    evidence = new EvidenceService(f.sources);
  try {
    const stable = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "stable.md",
      bytes: new TextEncoder().encode("生产日志保留 30 天。"),
    });
    await f.sources.workOne();
    const changed = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "changed.md",
      bytes: new TextEncoder().encode("测试日志保留 10 天。"),
    });
    await f.sources.workOne();
    const pack = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "日志保留",
      signal: AbortSignal.timeout(5000),
    });
    const remaining = { generation: 2, review: 2 };
    await expect(
      evidence.finalize(f.token, pack, {
        signal: AbortSignal.timeout(5000),
        remaining: (phase) => remaining[phase],
        model: "scripted-extractive-v1",
        request: async (phase, input) => {
          remaining[phase]--;
          if (phase === "generation") return scriptedDraft(pack);
          const review = scriptedReview(
            pack,
            input.draft as import("../src/answer-validation.ts").Draft,
          );
          if (remaining.review === 1)
            review.claims[0]!.verdict = "insufficient";
          else {
            await f.sources.submit(f.token, {
              key: crypto.randomUUID(),
              filename: "changed.md",
              bytes: new TextEncoder().encode("测试日志保留 20 天。"),
              documentId: changed.documentId,
              expectedPrior: changed.versionId,
            });
            await f.sources.workOne();
          }
          return review;
        },
      }),
    ).rejects.toThrow("source_changed");
    const subset = await evidence.supportedSubset(
      f.token,
      pack.runId,
      AbortSignal.timeout(5000),
    );
    expect(remaining).toEqual({ generation: 0, review: 0 });
    expect(subset?.status).toBe("partial");
    expect(subset?.text).toContain("30 天");
    expect(subset?.text).not.toContain("10 天");
    expect(
      subset?.citations.every((item) => item.version === stable.versionId),
    ).toBe(true);
    expect(subset?.certificate).toBeUndefined();
    expect(subset?.subset?.retainedClaimIds).toHaveLength(1);
    evidence.release(pack.runId);
    expect(
      await evidence.supportedSubset(
        f.token,
        pack.runId,
        AbortSignal.timeout(5000),
      ),
    ).toBeUndefined();
  } finally {
    await f.close();
  }
});

test("a reviewed claim also depends on extra original spans used by its reviewer", async () => {
  const f = await fixture(),
    evidence = new EvidenceService(f.sources);
  try {
    const a = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "a.md",
      bytes: new TextEncoder().encode("生产日志保留 30 天。"),
    });
    await f.sources.workOne();
    const b = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "b.md",
      bytes: new TextEncoder().encode("日志规定仅适用于生产环境。"),
    });
    await f.sources.workOne();
    const pack = await evidence.retrieve(f.token, {
      runId: crypto.randomUUID(),
      question: "生产日志",
      signal: AbortSignal.timeout(5000),
    });
    const main = pack.items.find((item) => item.version === a.versionId)!;
    const remaining = { generation: 1, review: 1 };
    const text = "生产日志保留 30 天。";
    await evidence.finalize(f.token, pack, {
      signal: AbortSignal.timeout(5000),
      remaining: (phase) => remaining[phase],
      model: "review-dependency-test",
      request: async (phase, input) => {
        remaining[phase]--;
        if (phase === "generation")
          return {
            text,
            claims: [
              {
                id: "c1",
                start: 0,
                end: text.length,
                role: "fact",
                handles: [main.handle],
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
          unlistedClaims: [],
          claims: [
            {
              id: "c1",
              verdict: "supported",
              standalone: true,
              reason: "A is qualified by B",
              spans: pack.items.map((item) => ({
                handle: item.handle,
                start: 0,
                end: item.text.length,
              })),
            },
          ],
        };
      },
    });
    const before = await evidence.supportedSubset(
      f.token,
      pack.runId,
      AbortSignal.timeout(5000),
    );
    expect(before?.citations).toHaveLength(2);
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "b.md",
      bytes: new TextEncoder().encode("原日志规定已撤销。"),
      documentId: b.documentId,
      expectedPrior: b.versionId,
    });
    await f.sources.workOne();
    expect(
      await evidence.supportedSubset(
        f.token,
        pack.runId,
        AbortSignal.timeout(5000),
      ),
    ).toBeUndefined();
    evidence.release(pack.runId);
  } finally {
    await f.close();
  }
});
