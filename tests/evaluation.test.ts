import { grade } from "../src/evaluation/grading.ts";
import { test, expect } from "bun:test";
import { evaluationFixture } from "../src/evaluation/fixture.ts";
import { evaluate } from "../src/evaluation/runner.ts";
import {
  validateDataset,
  digest,
  acceptanceSchema,
  unavailableDiagnostics,
  diagnosticSchema,
} from "../src/evaluation/schema.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
for (const corrupt of [false, true]) {
  test(`public answer evaluation reports ${corrupt ? "rejected wrong answers" : "valid answers"}, actual citations and unavailable controls`, async () => {
    const f = await evaluationFixture(url!, corrupt);
    try {
      const before = await f.sources.list(f.token);
      const report = await evaluate({
        manifest: f.manifest,
        dataset: f.dataset,
        clients: { source: f.client },
      });
      expect(report.cases).toHaveLength(4);
      const source = report.cases.find((item) => item.profile === "source")!;
      expect(source.outcome).toBe(corrupt ? "fail" : "pass");
      expect(
        report.categories.find((item) => item.profile === "source")?.total,
      ).toBe(1);
      expect(
        report.cases.filter((item) => item.outcome === "unavailable"),
      ).toHaveLength(3);
      expect(source.tokens.status).toBe("unavailable");
      expect(source.monetaryCost.status).toBe("unavailable");
      expect(source.requests.status).toBe("available");
      expect(source.elapsedMs).toBeGreaterThan(0);
      if (!corrupt) {
        expect(source.citationChecks).toHaveLength(1);
        expect(source.citationChecks[0]!.valid).toBe(true);
        expect(source.run?.diagnostics?.retrieved?.[0]?.text).toContain(
          "30 天",
        );
        expect(source.referenceRecall).toEqual({
          numerator: 1,
          denominator: 1,
        });
      }
      expect((await f.sources.list(f.token)).length).toBe(before.length);
      const requests = JSON.stringify(f.provider.calls);
      expect(requests).not.toContain("literal-log-retention-v1");
      expect(requests).not.toContain("paraphraseGroup");
      expect(requests).not.toContain("requiredPoints");
      for (const call of f.provider.calls)
        if (call.phase === "generation" || call.phase === "review")
          expect(JSON.stringify(call.body)).not.toContain('"retrieved":');
    } finally {
      await f.close();
    }
  }, 30000);
}
test("acceptance references require human review, frozen development identity and separate paraphrase groups", async () => {
  const f = await evaluationFixture(url!);
  try {
    const frozen = acceptanceSchema.parse({
      schemaVersion: 1,
      version: "acceptance-v1",
      split: "acceptance",
      mode: "human",
      manifestSha256: f.dataset.manifestSha256,
      frozenAt: new Date().toISOString(),
      developmentSha256: digest(JSON.stringify(f.dataset)),
      cases: f.dataset.cases,
    });
    expect(() => validateDataset(f.manifest, frozen, f.dataset)).toThrow(
      "unreviewed_reference",
    );
    frozen.cases[0]!.review = {
      kind: "human",
      reviewer: "independent-fixture-reviewer",
      reviewedAt: new Date().toISOString(),
    };
    expect(() => validateDataset(f.manifest, frozen, f.dataset)).toThrow(
      "holdout_overlap",
    );
    frozen.cases[0]!.question = "数据库端口是多少？";
    frozen.cases[0]!.paraphraseGroup = "database-port";
    expect(() => validateDataset(f.manifest, frozen, f.dataset)).not.toThrow();
    expect(() => validateDataset(f.manifest, frozen)).toThrow(
      "development_manifest_required",
    );
    for (const record of unavailableDiagnostics(crypto.randomUUID())) {
      expect(diagnosticSchema.parse(record).status).toBe("unavailable");
      expect(Object.keys(record.metrics)).toHaveLength(0);
    }
  } finally {
    await f.close();
  }
}, 30000);
test("corpus mutation invalidates evaluation configuration instead of silently comparing snapshots", async () => {
  const f = await evaluationFixture(url!);
  try {
    await f.sources.submit(f.token, {
      key: "new-source",
      filename: "additional.md",
      bytes: new TextEncoder().encode("新来源"),
    });
    await f.sources.workOne();
    const report = await evaluate({
      manifest: f.manifest,
      dataset: f.dataset,
      clients: { source: f.client },
    });
    expect(report.cases.find((item) => item.profile === "source")!.reason).toBe(
      "corpus_inventory_mismatch",
    );
    expect(
      report.cases.find((item) => item.profile === "source")!.outcome,
    ).toBe("unavailable");
  } finally {
    await f.close();
  }
}, 30000);

test("independent human annotations bind to exact report and cannot turn a rejected answer into a pass", async () => {
  const f = await evaluationFixture(url!);
  try {
    const dataset = {
      ...f.dataset,
      mode: "human",
      cases: f.dataset.cases.map((item) => ({
        ...item,
        review: {
          kind: "human",
          reviewer: "reference reviewer",
          reviewedAt: new Date().toISOString(),
        },
      })),
    };
    const report = await evaluate({
      manifest: f.manifest,
      dataset,
      clients: { source: f.client },
    });
    expect(report.cases[0]!.outcome).toBe("pending_human");
    const reviews = {
      schemaVersion: 1,
      reportSha256: digest(JSON.stringify(report)),
      reviews: [
        {
          id: "logs",
          profile: "source",
          reviewer: "answer reviewer",
          reviewedAt: new Date().toISOString(),
          correctness: true,
          completeness: true,
          citationsSupported: true,
          gaps: true,
          notes: "checked the original",
        },
      ],
    };
    expect(grade(report, reviews).cases[0]!.outcome).toBe("pass");
    expect(report.cases[0]!.outcome).toBe("pending_human");
    expect(() =>
      grade(report, { ...reviews, reportSha256: "0".repeat(64) }),
    ).toThrow("report_hash_mismatch");
    expect(
      grade(report, {
        ...reviews,
        reviews: [{ ...reviews.reviews[0], profile: "wiki" }],
      }).cases[1]!.outcome,
    ).toBe("unavailable");
  } finally {
    await f.close();
  }
}, 30000);

for (const profile of ["source", "wiki", "graph", "combined"] as const) {
  test(`experimental ${profile} control selects its requested routes through public answers`, async () => {
    const f = await evaluationFixture(url!, false, profile, true);
    try {
      const report = await evaluate({
        manifest: f.manifest,
        dataset: f.dataset,
        clients: { [profile]: f.client },
      });
      const result = report.cases.find((item) => item.profile === profile)!;
      expect(result.outcome).toBe("pass");
      expect(result.run?.diagnostics?.requestedRoutes).toEqual([
        "source",
        ...(["wiki", "combined"].includes(profile) ? ["wiki"] : []),
        ...(["graph", "combined"].includes(profile) ? ["graph"] : []),
      ]);
    } finally {
      await f.close();
    }
  }, 30000);
}

test("a reviewed gap-only answer reaches human scoring while missing responses remain failures", async () => {
  const f = await evaluationFixture(url!);
  try {
    const existing = (await f.sources.list(f.token))[0]!;
    const changed = await f.sources.submit(f.token, {
      key: "gap-source",
      filename: "letter.md",
      bytes: new TextEncoder().encode("A"),
      documentId: existing.documentId,
      expectedPrior: existing.versionId,
    });
    await f.sources.workOne();
    const original = await f.sources.version(f.token, changed.versionId);
    const manifest = {
      ...f.manifest,
      sources: [
        {
          version: original.version,
          sha256: digest(original.text),
          projectId: null,
          parser: original.parserProfile,
          embedding: original.embeddingProfile,
        },
      ],
    };
    const dataset = {
      ...f.dataset,
      mode: "human",
      manifestSha256: digest(JSON.stringify(manifest)),
      cases: [
        {
          ...f.dataset.cases[0],
          question: "A",
          category: "missing",
          requiredPoints: [],
          references: [],
          expectedGaps: ["incomplete_support"],
          review: {
            kind: "human",
            reviewer: "gap reference reviewer",
            reviewedAt: new Date().toISOString(),
          },
        },
      ],
    };
    const report = await evaluate({
      manifest,
      dataset,
      clients: { source: f.client },
    });
    const result = report.cases[0]!;
    expect(result.run?.status).toBe("partial");
    expect(result.citationChecks).toHaveLength(0);
    expect(result.run?.answer?.text).toContain("无法确定");
    expect(result.outcome).toBe("pending_human");
  } finally {
    await f.close();
  }
}, 30000);
test("a failed provider response cannot pass a missing-evidence case on its error code alone", async () => {
  const f = await evaluationFixture(url!, true);
  try {
    const dataset = {
      ...f.dataset,
      cases: [
        {
          ...f.dataset.cases[0],
          category: "missing",
          references: [],
          requiredPoints: [],
          expectedGaps: ["insufficient_evidence"],
        },
      ],
    };
    const report = await evaluate({
      manifest: f.manifest,
      dataset,
      clients: { source: f.client },
    });
    expect(report.cases[0]!.run?.status).toBe("failed");
    expect(report.cases[0]!.outcome).toBe("fail");
  } finally {
    await f.close();
  }
}, 30000);
