import { expect, test } from "bun:test";
import { summarizeRoutes } from "../src/evaluation/comparison.ts";
import { resolveRouteReferences } from "../src/evaluation/route-fixture.ts";
import {
  developmentSchema,
  digest,
  validateDataset,
  type SourceManifest,
} from "../src/evaluation/schema.ts";

test("reviewed original quotes resolve uniquely to the new snapshot rather than old locators", () => {
  const originals = [
    {
      file: "policy.md",
      source: {
        version: "new-version",
        passages: [{ id: "new-passage", text: "Logs expire after 30 days." }],
      },
    },
  ];
  expect(
    resolveRouteReferences(
      [{ filename: "policy.md", quote: "30 days" }],
      originals,
    ),
  ).toEqual([{ version: "new-version", passageId: "new-passage" }]);
  expect(() =>
    resolveRouteReferences(
      [{ filename: "missing.md", quote: "30 days" }],
      originals,
    ),
  ).toThrow("reference_quote_not_unique");
  expect(() =>
    resolveRouteReferences(
      [{ filename: "policy.md", quote: "99 days" }],
      originals,
    ),
  ).toThrow("reference_quote_not_unique");
  originals[0]!.source.passages.push({ id: "ambiguous", text: "Also 30 days" });
  expect(() =>
    resolveRouteReferences(
      [{ filename: "policy.md", quote: "30 days" }],
      originals,
    ),
  ).toThrow("reference_quote_not_unique");
});

test("route percentiles retain failed requests but exclude unattempted routes and missing stage observations", () => {
  const result = summarizeRoutes([
    {
      profile: "source",
      complexity: "ordinary",
      outcome: "fail",
      elapsedMs: 30000,
      run: { status: "timed_out", diagnostics: { queueMs: 20 } },
    },
    {
      profile: "source",
      complexity: "ordinary",
      outcome: "pass",
      elapsedMs: 100,
      run: { status: "answered", diagnostics: { queueMs: 10, reviewMs: 40 } },
    },
    {
      profile: "source",
      complexity: "ordinary",
      outcome: "pending_agent",
      elapsedMs: 200,
      run: { status: "partial" },
    },
    {
      profile: "wiki",
      complexity: "ordinary",
      outcome: "unavailable",
      elapsedMs: 0,
    },
  ]);
  const source = result.find(
    (row) => row.profile === "source" && row.complexity === "ordinary",
  )!;
  expect(source.total).toBe(3);
  expect(source.latency.delivery).toEqual({
    samples: 3,
    missing: 0,
    p50: { status: "available", value: 200 },
    p95: { status: "available", value: 30000 },
  });
  expect(source.latency.review.samples).toBe(1);
  expect(source.latency.review.missing).toBe(2);
  expect(source.timeouts).toBe(1);
  expect(source.partial).toBe(1);
  expect(source.pendingReview).toBe(1);
  const wiki = result.find(
    (row) => row.profile === "wiki" && row.complexity === "ordinary",
  )!;
  expect(wiki.latency.delivery.samples).toBe(0);
  expect(wiki.latency.delivery.p50.status).toBe("unavailable");
  expect(wiki.unavailable).toBe(1);
  expect(source.cost.status).toBe("unavailable");
});

test("independent agent reviewed development data is explicit and cannot impersonate human acceptance", () => {
  const manifest: SourceManifest = {
    schemaVersion: 1,
    corpus: "test",
    snapshot: "v1",
    sources: [
      {
        version: "00000000-0000-4000-8000-000000000001",
        sha256: digest("original"),
        projectId: null,
        parser: "test",
        embedding: "test",
      },
    ],
  };
  const dataset = developmentSchema.parse({
    schemaVersion: 1,
    version: "agent-v1",
    split: "development",
    mode: "agent",
    manifestSha256: digest(JSON.stringify(manifest)),
    cases: [
      {
        id: "missing",
        question: "Unknown?",
        paraphraseGroup: "missing",
        complexity: "ordinary",
        category: "missing",
        projectId: null,
        tags: [],
        references: [],
        requiredPoints: [],
        expectedGaps: [],
        review: {
          kind: "agent",
          reviewer: "independent-agent",
          reviewedAt: "2026-09-12T00:00:00.000Z",
        },
      },
    ],
  });
  expect(() => validateDataset(manifest, dataset)).not.toThrow();
  expect(() =>
    validateDataset(manifest, { ...dataset, mode: "human" }),
  ).toThrow("unreviewed_reference");
});
