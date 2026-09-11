import { test, expect } from "bun:test";
import { evaluationFixture } from "../src/evaluation/fixture.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
test("evaluation inventories every active document beyond the recent-import page", async () => {
  const f = await evaluationFixture(url!);
  try {
    for (let index = 0; index < 100; index++) {
      await f.sources.submit(f.token, {
        key: `inventory-${index}`,
        filename: `original-${index}.md`,
        bytes: new TextEncoder().encode(`独立原文 ${index}。`),
      });
      await f.sources.workOne();
    }
    const inventory = await f.client.inventory(AbortSignal.timeout(10000));
    expect(inventory.operations).toHaveLength(101);
    expect(
      new Set(inventory.operations.map((item) => item.versionId)).size,
    ).toBe(101);
  } finally {
    await f.close();
  }
}, 120000);

test("capacity fixtures keep five requests unfinished, count failures, and capture an overlapping update", async () => {
  const { capacityFixture } =
    await import("../src/evaluation/capacity-fixture.ts");
  const reports = await capacityFixture(url!);
  const idle = reports.idle;
  expect(idle.plan.total).toBe(20);
  expect(idle.maxUnfinished).toBe(5);
  expect(idle.rows).toHaveLength(20);
  expect(idle.summary.ordinary.total).toBe(16);
  expect(idle.summary.complex.total).toBe(4);
  expect(idle.summary.ordinary.withinTarget).toBe(16);
  expect(idle.eligibleForAcceptance).toBe(false);
  expect(reports.interference.update.status).toBe("available");
  expect(reports.interference.maintenanceOverlap).toBe(true);
  expect(reports.interference.maintenanceDiagnostics).toHaveLength(7);
  const failed = await capacityFixture(url!, true);
  expect(failed.idle.summary.ordinary.withinTarget).toBe(0);
  expect(failed.idle.summary.ordinary.total).toBe(16);
}, 120000);

test("acceptance preparation records missing resources and rejects a small controlled dataset", async () => {
  const { prepareAcceptance } =
    await import("../src/evaluation/preparation.ts");
  const missing = prepareAcceptance({});
  expect(missing.inputStatus).toBe("blocked");
  expect(missing.releaseStatus).toBe("not-assessed");
  expect(
    missing.checks.find((check) => check.id === "acceptance")!.status,
  ).toBe("missing");
  const f = await evaluationFixture(url!);
  try {
    const report = prepareAcceptance({
      manifest: f.manifest,
      development: f.dataset,
    });
    expect(
      report.checks.find((check) => check.id === "development")!.status,
    ).toBe("invalid");
    expect(report.qualityComparison.status).toBe("unavailable");
  } finally {
    await f.close();
  }
});

test("independent grade comparison exposes ordinary regressions and never certifies a release", async () => {
  const { prepareAcceptance } =
    await import("../src/evaluation/preparation.ts");
  const { evaluate } = await import("../src/evaluation/runner.ts");
  const { digest, profiles, acceptanceSchema } =
    await import("../src/evaluation/schema.ts");
  const f = await evaluationFixture(url!);
  try {
    // Synthetic report-consumer input only; these annotations are never emitted
    // as human/real-provider acceptance evidence by the integration commands.
    const review = {
      kind: "human" as const,
      reviewer: "report-consumer test",
      reviewedAt: new Date().toISOString(),
    };
    const base = f.dataset.cases[0]!;
    const development = {
      ...f.dataset,
      mode: "human" as const,
      cases: Array.from({ length: 50 }, (_, i) => ({
        ...base,
        id: `dev-${i}`,
        question: `development ${i}`,
        paraphraseGroup: `dev-${i}`,
        complexity: i < 40 ? ("ordinary" as const) : ("complex" as const),
        review,
      })),
    };
    const acceptance = acceptanceSchema.parse({
      schemaVersion: 1 as const,
      version: "consumer-test",
      split: "acceptance" as const,
      mode: "human" as const,
      manifestSha256: f.dataset.manifestSha256,
      developmentSha256: digest(JSON.stringify(development)),
      frozenAt: review.reviewedAt,
      cases: Array.from({ length: 200 }, (_, i) => ({
        ...base,
        id: `accept-${i}`,
        question: `acceptance ${i}`,
        paraphraseGroup: `accept-${i}`,
        complexity: i < 160 ? ("ordinary" as const) : ("complex" as const),
        category:
          i < 120 || (i >= 160 && i < 184)
            ? ("sufficient" as const)
            : i < 144 || (i >= 184 && i < 192)
              ? ("missing" as const)
              : ("conflicting" as const),
        review,
      })),
    });
    const captured = await evaluate({
      manifest: f.manifest,
      dataset: f.dataset,
      clients: { source: f.client },
    });
    const actual = captured.cases.find((item) => item.profile === "source")!;
    const config = captured.configurations.source!;
    if (config.status !== "available")
      throw new Error("fixture_configuration_missing");
    const report = {
      ...captured,
      dataset: acceptance,
      datasetSha256: digest(JSON.stringify(acceptance)),
      provenance: "human-review-required" as const,
      configurations: Object.fromEntries(
        profiles.map((profile) => [
          profile,
          {
            status: "available",
            value: {
              ...config.value,
              profile,
              wiki: true,
              graph: true,
              answeringModel: "report-consumer-test-model",
            },
          },
        ]),
      ),
      cases: profiles.flatMap((profile) =>
        acceptance.cases.map((item) => ({
          ...actual,
          id: item.id,
          profile,
          complexity: item.complexity,
          category: item.category,
          outcome: "pending_human" as const,
        })),
      ),
    };
    const grades = {
      schemaVersion: 1,
      reportSha256: digest(JSON.stringify(report)),
      reviews: report.cases.map((item) => ({
        id: item.id,
        profile: item.profile,
        reviewer: review.reviewer,
        reviewedAt: review.reviewedAt,
        correctness: !(
          item.profile === "wiki" && Number(item.id.split("-")[1]) < 20
        ),
        completeness: true,
        citationsSupported: true,
        gaps: true,
        notes: "synthetic consumer-test judgment",
      })),
    };
    const result = prepareAcceptance({
      manifest: f.manifest,
      development,
      acceptance,
      report,
      grades,
    });
    expect(result.checks.filter((check) => check.status !== "ready")).toEqual(
      [],
    );
    expect(result.inputStatus).toBe("ready");
    expect(result.releaseStatus).toBe("not-assessed");
    expect(result.qualityMarkdown).toContain(
      "wiki | ordinary | 140 / 160 | false",
    );
    expect(result.qualityMarkdown).toContain("wiki | 0 | 20 | 200");
    const incomplete = prepareAcceptance({
      manifest: f.manifest,
      development,
      acceptance,
      report,
      grades: { ...grades, reviews: grades.reviews.slice(1) },
    });
    expect(incomplete.qualityComparison.status).toBe("unavailable");
  } finally {
    await f.close();
  }
});

test("pending source work without running derived maintenance cannot establish update interference", async () => {
  const { capacityFixture } =
    await import("../src/evaluation/capacity-fixture.ts");
  const reports = await capacityFixture(url!, false, {
    runUpdateMaintenance: false,
  });
  expect(reports.interference.update.status).toBe("available");
  expect(reports.interference.sourceChanges.added).toHaveLength(1);
  expect(reports.interference.maintenanceOverlap).toBe(false);
  expect(reports.interference.limitations).toContain(
    "update_interference_not_established",
  );
}, 30000);

test("reviewed gap-only delivery counts toward capacity when its expected reason is delivered", async () => {
  const { measureCapacity } = await import("../src/evaluation/capacity.ts");
  const { digest } = await import("../src/evaluation/schema.ts");
  const f = await evaluationFixture(url!, false, "combined", true);
  try {
    const old = (await f.sources.list(f.token))[0]!;
    const change = await f.sources.submit(f.token, {
      key: "capacity-gap",
      filename: "letter.md",
      bytes: new TextEncoder().encode("A"),
      documentId: old.documentId,
      expectedPrior: old.versionId,
    });
    await f.sources.workOne();
    for (let round = 0; round < 100; round++) {
      const a = await f.identities!.workOne(f.token),
        b = await f.wiki!.workOne(f.token),
        c = await f.graph!.workOne(f.token);
      if (!a && !b && !c) break;
    }
    const source = await f.sources.version(f.token, change.versionId);
    const manifest = {
      ...f.manifest,
      sources: [
        {
          version: source.version,
          sha256: digest(source.text),
          projectId: null,
          parser: source.parserProfile,
          embedding: source.embeddingProfile,
        },
      ],
    };
    const dataset = {
      ...f.dataset,
      manifestSha256: digest(JSON.stringify(manifest)),
      cases: ["ordinary", "complex"].map((complexity) => ({
        ...f.dataset.cases[0]!,
        id: complexity,
        complexity,
        question: "A",
        category: "missing",
        references: [],
        requiredPoints: [],
        expectedGaps: ["incomplete_support"],
      })),
    };
    const report = await measureCapacity({
      client: f.client,
      manifest,
      dataset,
      plan: {
        schemaVersion: 1,
        mode: "fixture",
        scenario: "idle",
        profile: "combined",
        seed: 18,
        total: 5,
        concurrency: 5,
        environment: {
          hardware: "fixture",
          providerQuotas: "fixture",
          warmup: "built",
          answerCache: "disabled",
        },
      },
    });
    expect(
      report.rows.every((row) => row.run?.reason === "incomplete_support"),
    ).toBe(true);
    expect(report.summary.ordinary.withinTarget).toBe(4);
    expect(report.summary.complex.withinTarget).toBe(1);
  } finally {
    await f.close();
  }
}, 30000);
