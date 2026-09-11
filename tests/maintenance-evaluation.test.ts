import { test, expect } from "bun:test";
import { maintenanceFixture } from "../src/evaluation/maintenance-fixture.ts";
import { diagnosticSchema } from "../src/evaluation/schema.ts";
import { record } from "../src/answer-validation.ts";
import { evaluationFixture } from "../src/evaluation/fixture.ts";
import { MaintenanceDiagnostics } from "../src/evaluation/maintenance.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
test("maintenance integration captures actual lifecycle, proof invalidation, graph replacement and finite continuation", async () => {
  const report = await maintenanceFixture(url!);
  const get = (scenario: string, kind: string) =>
    report.captures
      .find((capture) => capture.scenario === scenario)!
      .diagnostics.find((diagnostic) => diagnostic.kind === kind)!;
  for (const capture of report.captures)
    for (const diagnostic of capture.diagnostics)
      expect(diagnosticSchema.parse(diagnostic).status).toBe("available");
  expect(get("retired", "lifecycle").metrics.retired!.numerator).toBe(1);
  expect(get("reactivated", "lifecycle").metrics.reactivated!.numerator).toBe(
    1,
  );
  expect(get("reactivated", "routing").metrics.recall8).toEqual({
    numerator: 1,
    denominator: 1,
  });
  expect(get("reactivated", "routing").metrics.missedReuse!.numerator).toBe(0);
  expect(
    get("immediate-proof-invalidation", "identity").metrics.validBindings,
  ).toEqual({ numerator: 0, denominator: 1 });
  expect(
    get("identity-reconciled", "identity").metrics.unresolvedRevisions!
      .numerator,
  ).toBeGreaterThan(0);
  const neighborhoods = (scenario: string) =>
    get(scenario, "graph").details.neighborhoods as Array<{
      claims: Array<{ support: unknown[] }>;
    }>;
  expect(
    neighborhoods("alternate-support")[0]!.claims[0]!.support,
  ).toHaveLength(2);
  expect(
    neighborhoods("empty-replacement")[0]!.claims[0]!.support,
  ).toHaveLength(1);
  expect(neighborhoods("immediate-proof-invalidation")[0]!.claims).toHaveLength(
    0,
  );
  const partial = get("partial-generation-failed", "graph");
  expect(partial.metrics.activeGenerations!.numerator).toBe(0);
  expect(partial.metrics.reviewedPackets!.numerator).toBeGreaterThan(0);
  const inspection = get("finite-inspection", "inspection");
  const ledgers = inspection.details.ledgers as Array<{
    windows?: unknown[];
    remaining?: unknown[];
  }>;
  expect(
    ledgers.some(
      (ledger) =>
        ledger.windows?.length === 6 && Boolean(ledger.remaining?.length),
    ),
  ).toBe(true);
  expect(inspection.metrics.terminalJobs!.numerator).toBe(
    inspection.metrics.terminalJobs!.denominator,
  );
  const work = get("reactivated", "work");
  expect(
    record(work.details.wikiReadyMs) && work.details.wikiReadyMs.status,
  ).toBe("available");
  expect(record(work.details.tokens) && work.details.tokens.status).toBe(
    "unavailable",
  );
  expect(work.metrics.dispatchIntents!.numerator).toBeGreaterThan(0);
  expect(Object.values(work.versions)).toContain("scripted-wiki-v1");
  const notStarted = get("before-maintenance", "inspection");
  expect(notStarted.metrics.mandatoryWalks!.numerator).toBe(0);
  expect(notStarted.metrics.mandatoryWalks!.denominator).toBeGreaterThan(0);
  const partialSource = get("partial-source-extraction", "inspection");
  expect(partialSource.metrics.discoveryCoverage!.numerator).toBeGreaterThan(0);
  expect(partialSource.metrics.discoveryCoverage!.numerator).toBeLessThan(
    partialSource.metrics.discoveryCoverage!.denominator,
  );
  expect((partialSource.details.remaining as unknown[]).length).toBeGreaterThan(
    0,
  );
  const finiteWork = get("finite-inspection", "work");
  expect(finiteWork.metrics.retries!.numerator).toBe(0);
  expect(
    record(finiteWork.details.wikiReadyMs) &&
      finiteWork.details.wikiReadyMs.status,
  ).toBe("unavailable");
  const partialWork = get("partial-generation-failed", "work");
  expect(
    record(partialWork.details.graphReadyMs) &&
      partialWork.details.graphReadyMs.status,
  ).toBe("unavailable");
}, 120000);
test("missing public diagnostic routes stay unavailable with no numeric passes", async () => {
  const f = await evaluationFixture(url!);
  try {
    const operation = (await f.sources.list(f.token))[0]!;
    const diagnostics = await new MaintenanceDiagnostics(
      f.client,
      "controlled-provider",
    ).capture(operation.id);
    expect(diagnostics).toHaveLength(7);
    for (const diagnostic of diagnostics.filter(
      (item) => !["review", "work"].includes(item.kind),
    )) {
      expect(diagnostic.status).toBe("unavailable");
      expect(diagnostic.metrics).toEqual({});
      expect(diagnostic.reason).toBeTruthy();
    }
  } finally {
    await f.close();
  }
});
