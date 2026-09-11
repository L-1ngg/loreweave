import { expect, test } from "bun:test";
import { OpenAIEmbeddings } from "../src/providers/embeddings.ts";
import { OpenAIKnowledgeModel } from "../src/providers/chat.ts";
import {
  hash,
  validateDraft,
  validateReview,
} from "../src/answer-validation.ts";
import type { EvidencePack } from "../src/evidence.ts";
import { providerConfig } from "../src/providers/config.ts";

test("explicit real configuration rejects missing credentials, unknown models and credential-bearing URLs", () => {
  const env = {
    RAG_CHAT_BASE_URL: "https://example.invalid/v1",
    RAG_CHAT_API_KEY: "test",
    RAG_CHAT_MODEL: "deepseek-ai/DeepSeek-V4-Flash",
    RAG_EMBEDDING_BASE_URL: "https://example.invalid/v1",
    RAG_EMBEDDING_API_KEY: "test",
    RAG_EMBEDDING_MODEL: "BAAI/bge-m3",
  };
  expect(providerConfig(env).embedding.dimensions).toBe(1024);
  expect(() => providerConfig({ ...env, RAG_CHAT_API_KEY: "" })).toThrow(
    "missing_config:RAG_CHAT_API_KEY",
  );
  expect(() =>
    providerConfig({ ...env, RAG_CHAT_MODEL: "unknown-private-model" }),
  ).toThrow("unsupported_chat_catalog_model");
  expect(() =>
    providerConfig({
      ...env,
      RAG_CHAT_BASE_URL: "https://user:secret@example.invalid/v1",
    }),
  ).toThrow("invalid_config:RAG_CHAT_BASE_URL");
});

test("aborting an in-flight model request settles without an answer or retry", async () => {
  let started!: () => void;
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      calls++;
      started();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  try {
    const model = new OpenAIKnowledgeModel({
      baseUrl: server.url.toString(),
      apiKey: "test",
      model: "test",
      timeoutMs: 1000,
    });
    const controller = new AbortController();
    const pending = model.request("extraction", {}, controller.signal);
    const assertion = expect(pending).rejects.toThrow();
    await received;
    controller.abort();
    await assertion;
    expect(calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("provider failures do not expose response bodies or retry; cancellation stops the request", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      calls++;
      return Response.json(
        { error: "secret-and-source-text" },
        { status: 429 },
      );
    },
  });
  const model = new OpenAIKnowledgeModel({
    baseUrl: server.url.toString(),
    apiKey: "secret",
    model: "test",
    timeoutMs: 1000,
  });
  try {
    await expect(
      model.request("extraction", {}, new AbortController().signal),
    ).rejects.toThrow("provider_http_429");
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.request("extraction", {}, controller.signal),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("malformed, truncated and fabricated quote responses cannot pass the adapter", async () => {
  let content = "not JSON",
    finish = "stop";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return Response.json({
        choices: [{ finish_reason: finish, message: { content } }],
      });
    },
  });
  const model = new OpenAIKnowledgeModel({
    baseUrl: server.url.toString(),
    apiKey: "test",
    model: "test",
    timeoutMs: 1000,
  });
  try {
    await expect(
      model.request("extraction", {}, new AbortController().signal),
    ).rejects.toThrow("invalid_model_json");
    content = "{}";
    finish = "length";
    await expect(
      model.request("extraction", {}, new AbortController().signal),
    ).rejects.toThrow("invalid_model_response");
    finish = "stop";
    content = JSON.stringify({
      claims: [{ spans: [{ handle: "e1", quote: "90 天" }] }],
    });
    await expect(
      model.request(
        "review",
        { pack: { items: [{ handle: "e1", text: "30 天" }] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid_model_review");
  } finally {
    server.stop(true);
  }
});

test("real chat adapter binds exact generated text and independently reviewed original quotes", async () => {
  const pack = {
    hash: "pack-hash",
    items: [{ handle: "e1", text: "日志保留 30 天。" }],
  } as EvidencePack;
  let calls = 0;
  let draftHash = "";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.tools).toBeUndefined();
      calls++;
      const output =
        calls === 1
          ? {
              segments: [
                {
                  id: "c1",
                  text: "日志保留 30 天。",
                  role: "fact",
                  handles: ["e1"],
                  subject: "日志",
                  scope: "此来源",
                  conditions: [],
                  attribution: "source",
                  premises: [],
                },
              ],
            }
          : {
              draftHash,
              evidenceHash: pack.hash,
              unlistedClaims: [],
              claims: [
                {
                  id: "c1",
                  verdict: "supported",
                  standalone: true,
                  reason: "原文明示",
                  spans: [{ handle: "e1", quote: "日志保留 30 天。" }],
                },
              ],
            };
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(output) },
          },
        ],
      });
    },
  });
  try {
    const model = new OpenAIKnowledgeModel({
      baseUrl: server.url.toString(),
      apiKey: "test",
      model: "test",
      timeoutMs: 1000,
    });
    const draft = validateDraft(
      await model.request("generation", { pack }, new AbortController().signal),
      pack,
    );
    draftHash = draft.hash;
    expect(draft.text).toBe("日志保留 30 天。");
    expect(draft.hash).toBe(hash({ text: draft.text, claims: draft.claims }));
    const review = validateReview(
      await model.request(
        "review",
        { pack, draft },
        new AbortController().signal,
      ),
      draft,
      pack,
    );
    expect(review.claims[0]?.spans).toEqual([
      { handle: "e1", start: 0, end: 10 },
    ]);
    expect(calls).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("embedding batches restore indexed order and reject invalid vectors", async () => {
  let bad = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer test-key");
      const body = (await request.json()) as { input: string[] };
      return Response.json({
        data: body.input
          .map((_, index) => ({
            index,
            embedding: bad ? [0, 0] : [index + 1, 2],
          }))
          .reverse(),
      });
    },
  });
  try {
    const model = new OpenAIEmbeddings({
      baseUrl: server.url.toString(),
      apiKey: "test-key",
      model: "test",
      dimensions: 2,
      batchSize: 2,
      sendDimensions: true,
      timeoutMs: 1000,
    });
    expect(
      await model.embed(["a", "b", "c"], new AbortController().signal),
    ).toEqual([
      [1, 2],
      [2, 2],
      [1, 2],
    ]);
    bad = true;
    await expect(
      model.embed(["a"], new AbortController().signal),
    ).rejects.toThrow("invalid_embedding");
  } finally {
    server.stop(true);
  }
});

test("Wiki's fixed heading enters the claim manifest and cannot bypass semantic review", async () => {
  const pack = {
    hash: "pack",
    items: [{ handle: "e1", text: "日志保留30天。" }],
  } as EvidencePack;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                segments: [
                  {
                    id: "body",
                    text: "日志保留30天。",
                    role: "fact",
                    handles: ["e1"],
                    subject: "日志",
                    scope: "此来源",
                    conditions: [],
                    attribution: "source",
                    premises: [],
                  },
                ],
              }),
            },
          },
        ],
      });
    },
  });
  try {
    const model = new OpenAIKnowledgeModel({
      baseUrl: server.url.toString(),
      apiKey: "test",
      model: "test",
      timeoutMs: 1000,
    });
    const draft = validateDraft(
      await model.request(
        "generation",
        { pack, topic: { title: "日志规则", subjectKey: "日志" } },
        new AbortController().signal,
      ),
      pack,
    );
    expect(draft.text).toBe("# 日志规则\n日志保留30天。");
    expect(draft.claims[0]).toMatchObject({
      id: "wiki-heading",
      role: "fact",
      handles: ["e1"],
      start: 0,
      end: 6,
    });
    expect(() =>
      validateReview(
        {
          draftHash: draft.hash,
          evidenceHash: pack.hash,
          unlistedClaims: [],
          claims: [
            {
              id: "body",
              verdict: "supported",
              reason: "original",
              spans: [{ handle: "e1", start: 0, end: 8 }],
            },
          ],
        },
        draft,
        pack,
      ),
    ).toThrow("invalid_review");
  } finally {
    server.stop(true);
  }
});
