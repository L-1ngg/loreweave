import { PublicAnswers } from "./client.ts";
import {
  datasetSchema,
  sourceManifestSchema,
  validateDataset,
  digest,
  measured,
  unavailable,
  profiles,
  type Dataset,
  type EvaluationCase,
  type Profile,
  type SourceManifest,
  type Measurement,
} from "./schema.ts";
import type { RunSnapshot } from "../host.ts";
export interface CaseResult {
  id: string;
  profile: Profile;
  complexity: EvaluationCase["complexity"];
  category: EvaluationCase["category"];
  outcome: "pass" | "fail" | "pending_human" | "pending_agent" | "unavailable";
  reason?: string;
  run?: RunSnapshot;
  elapsedMs: number;
  citationChecks: Array<{
    version: string;
    passageId: string | null;
    valid: boolean;
    reason?: string;
  }>;
  referenceRecall: { numerator: number; denominator: number };
  quality: Measurement<{
    correctness: boolean;
    completeness: boolean;
    gaps: boolean;
  }>;
  requests: Measurement<{ model: number; embedding: number | null }>;
  tokens: Measurement<number>;
  monetaryCost: Measurement<{ currency: string; amount: number }>;
}
export interface EvaluationReport {
  schemaVersion: 1;
  kind: "evaluation";
  createdAt: string;
  dataset: Dataset;
  manifest: SourceManifest;
  datasetSha256: string;
  provenance:
    | "controlled-provider"
    | "human-review-required"
    | "independent-agent-review-required";
  configurations: Partial<
    Record<
      Profile,
      Measurement<Awaited<ReturnType<PublicAnswers["configuration"]>>>
    >
  >;
  cases: CaseResult[];
  categories: Array<{
    profile: Profile;
    complexity: string;
    category: string;
    passed: number;
    failed: number;
    pendingHuman: number;
    pendingAgent: number;
    unavailable: number;
    total: number;
    completed: number;
    citations: { numerator: number; denominator: number };
  }>;
  maintenance: { status: "unavailable"; reason: string };
}
function empty(
  item: EvaluationCase,
  profile: Profile,
  reason: string,
  outcome: CaseResult["outcome"],
): CaseResult {
  return {
    id: item.id,
    profile,
    complexity: item.complexity,
    category: item.category,
    outcome,
    reason,
    elapsedMs: 0,
    citationChecks: [],
    referenceRecall: { numerator: 0, denominator: item.references.length },
    quality: unavailable(reason),
    requests: unavailable(reason),
    tokens: unavailable("provider usage unavailable"),
    monetaryCost: unavailable("provider usage and pricing unavailable"),
  };
}
export async function verifySnapshot(
  client: PublicAnswers,
  manifest: SourceManifest,
  dataset: Dataset,
  signal: AbortSignal,
) {
  const inventory = await client.inventory(signal);
  const current = new Set(
    inventory.operations
      .filter((operation) => operation.source === "searchable")
      .map((operation) => operation.versionId),
  );
  if (
    current.size !== manifest.sources.length ||
    manifest.sources.some((source) => !current.has(source.version))
  )
    throw new Error("corpus_inventory_mismatch");
  for (const source of manifest.sources) {
    const actual = await client.source(source.version, signal);
    if (
      actual.currentVersionId !== source.version ||
      actual.state !== "active" ||
      digest(actual.text) !== source.sha256 ||
      (actual.projectId ?? null) !== source.projectId ||
      actual.parserProfile !== source.parser ||
      actual.embeddingProfile !== source.embedding
    )
      throw new Error("source_snapshot_mismatch");
    for (const ref of dataset.cases
      .flatMap((item) => item.references)
      .filter((ref) => ref.version === source.version))
      if (!actual.passages.some((passage) => passage.id === ref.passageId))
        throw new Error("reference_passage_missing");
  }
}
/** Shared QA/capacity contract: an expected gap must actually be delivered. */
export function expectedGap(run: RunSnapshot, item: EvaluationCase) {
  return (
    item.category === "missing" &&
    run.status === "partial" &&
    item.expectedGaps.length > 0 &&
    item.expectedGaps.every(
      (gap) => run.diagnostics?.gaps.includes(gap) || run.reason === gap,
    )
  );
}
export async function evaluateCase(
  client: PublicAnswers,
  item: EvaluationCase,
  profile: Profile,
  manifest: SourceManifest,
  fixture: boolean,
): Promise<CaseResult> {
  const result = empty(item, profile, "request_not_completed", "fail");
  const started = performance.now();
  try {
    const run = await client.answer(
      item,
      AbortSignal.timeout(item.complexity === "complex" ? 62000 : 32000),
    );
    // Delivery timing excludes the evaluator's subsequent citation and grading I/O.
    result.elapsedMs = performance.now() - started;
    result.run = run;
    result.requests = measured({
      model: run.counts.exploration + run.counts.generation + run.counts.review,
      embedding: run.diagnostics?.embeddingRequests ?? null,
    });
    for (const citation of run.answer?.citations ?? []) {
      let valid = false,
        reason = "unknown_original";
      try {
        const original = await client.source(
          citation.version,
          AbortSignal.timeout(5000),
        );
        const snapshot = manifest.sources.find(
          (source) => source.version === citation.version,
        );
        const passage = original.passages.find(
          (passage) => passage.id === citation.passageId,
        );
        valid = Boolean(
          snapshot &&
          digest(original.text) === snapshot.sha256 &&
          original.currentVersionId === citation.version &&
          original.state === "active" &&
          passage &&
          citation.text.trim() &&
          passage.text.includes(citation.text) &&
          (!original.projectId ||
            !item.projectId ||
            original.projectId === item.projectId),
        );
        reason = "locator_text_snapshot_or_scope_mismatch";
      } catch {
        /* Preserve this citation in the failed denominator. */
      }
      result.citationChecks.push({
        version: citation.version,
        passageId: citation.passageId ?? null,
        valid,
        ...(!valid ? { reason } : {}),
      });
    }
    const refs = new Set(
      (run.diagnostics?.retrieved ?? []).map(
        (item) => `${item.version}:${item.passageId}`,
      ),
    );
    result.referenceRecall.numerator = item.references.filter((ref) =>
      refs.has(`${ref.version}:${ref.passageId}`),
    ).length;
    const validCitations = result.citationChecks.every((check) => check.valid);
    const delivered = ["answered", "partial"].includes(run.status);
    const genuineGap = expectedGap(run, item);
    if (
      !delivered ||
      !run.answer?.text.trim() ||
      !validCitations ||
      (delivered &&
        !result.citationChecks.length &&
        !(genuineGap && run.answer?.certificate))
    ) {
      result.reason = run.reason ?? "invalid_or_missing_citations";
      return result;
    }
    if (!fixture) {
      result.outcome = "pending_human";
      result.reason = "independent_human_review_required";
      return result;
    }
    const text = run.answer?.text ?? "";
    const correctness = item.requiredPoints.every((point) =>
      text.includes(point),
    );
    const completeness =
      item.category === "missing"
        ? genuineGap || run.status === "partial"
        : run.status === "answered" && correctness;
    const gaps = item.expectedGaps.every(
      (gap) =>
        run.diagnostics?.gaps.includes(gap) ||
        run.reason === gap ||
        text.includes(gap),
    );
    result.quality = measured({ correctness, completeness, gaps });
    result.outcome = correctness && completeness && gaps ? "pass" : "fail";
    result.reason =
      result.outcome === "pass"
        ? "controlled_fixture_oracle"
        : "fixture_rubric_failed";
    return result;
  } catch (error) {
    result.elapsedMs = performance.now() - started;
    result.reason =
      error instanceof Error ? error.message : "evaluation_request_failed";
    return result;
  }
}
export function categories(
  cases: CaseResult[],
): EvaluationReport["categories"] {
  const groups = new Map<string, CaseResult[]>();
  for (const item of cases) {
    const key = `${item.profile}:${item.complexity}:${item.category}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((items) => ({
    profile: items[0]!.profile,
    complexity: items[0]!.complexity,
    category: items[0]!.category,
    passed: items.filter((item) => item.outcome === "pass").length,
    failed: items.filter((item) => item.outcome === "fail").length,
    pendingHuman: items.filter((item) => item.outcome === "pending_human")
      .length,
    pendingAgent: items.filter((item) => item.outcome === "pending_agent")
      .length,
    unavailable: items.filter((item) => item.outcome === "unavailable").length,
    total: items.length,
    completed: items.filter((item) => item.run?.status === "answered").length,
    citations: {
      numerator: items
        .flatMap((item) => item.citationChecks)
        .filter((check) => check.valid).length,
      denominator: items.flatMap((item) => item.citationChecks).length,
    },
  }));
}
export async function evaluate(input: {
  manifest: unknown;
  dataset: unknown;
  development?: unknown;
  clients: Partial<Record<Profile, PublicAnswers>>;
  onCase?: (report: EvaluationReport) => Promise<void>;
}): Promise<EvaluationReport> {
  const manifest = sourceManifestSchema.parse(input.manifest),
    dataset = datasetSchema.parse(input.dataset);
  validateDataset(
    manifest,
    dataset,
    input.development ? datasetSchema.parse(input.development) : undefined,
  );
  const report: EvaluationReport = {
    schemaVersion: 1,
    kind: "evaluation",
    createdAt: new Date().toISOString(),
    dataset,
    manifest,
    datasetSha256: digest(JSON.stringify(dataset)),
    provenance:
      dataset.mode === "fixture"
        ? "controlled-provider"
        : dataset.mode === "agent"
          ? "independent-agent-review-required"
          : "human-review-required",
    configurations: {},
    cases: [],
    categories: [],
    maintenance: {
      status: "unavailable",
      reason: "maintenance capture requires a separately installed adapter",
    },
  };
  let common: string | undefined;
  for (const profile of profiles) {
    const client = input.clients[profile];
    let reason: string | undefined;
    if (!client) reason = "profile_not_configured";
    else {
      try {
        const config = await client.configuration(AbortSignal.timeout(5000));
        if (config.profile !== profile) throw new Error("profile_mismatch");
        if (
          (["wiki", "combined"].includes(profile) && !config.wiki) ||
          (["graph", "combined"].includes(profile) && !config.graph)
        )
          throw new Error("route_unavailable");
        const fixed = JSON.stringify([
          config.answeringModel,
          config.policy,
          config.retrieval,
          config.context,
          config.budgets,
          config.deadlines,
        ]);
        if (common && common !== fixed)
          throw new Error("comparison_configuration_mismatch");
        common = fixed;
        await verifySnapshot(
          client,
          manifest,
          dataset,
          AbortSignal.timeout(30000),
        );
        report.configurations[profile] = measured(config);
      } catch (error) {
        reason = error instanceof Error ? error.message : "profile_unavailable";
      }
    }
    if (reason || !client) {
      report.configurations[profile] = unavailable(
        reason ?? "profile_not_configured",
      );
      report.cases.push(
        ...dataset.cases.map((item) =>
          empty(item, profile, reason!, "unavailable"),
        ),
      );
      continue;
    }
    for (const item of dataset.cases) {
      report.cases.push(
        await evaluateCase(
          client,
          item,
          profile,
          manifest,
          dataset.mode === "fixture",
        ),
      );
      const latest = report.cases.at(-1)!;
      if (dataset.mode === "agent" && latest.outcome === "pending_human") {
        latest.outcome = "pending_agent";
        latest.reason = "independent_agent_review_required";
      }
      report.categories = categories(report.cases);
      await input.onCase?.(structuredClone(report));
    }
    // A concurrent corpus change invalidates this comparison even if citations used
    // an unaffected source. Capacity interference uses its separate protocol.
    try {
      await verifySnapshot(
        client,
        manifest,
        dataset,
        AbortSignal.timeout(30000),
      );
    } catch {
      for (const result of report.cases.filter(
        (item) => item.profile === profile,
      )) {
        result.outcome = "fail";
        result.reason = "corpus_changed_during_run";
      }
    }
  }
  report.categories = categories(report.cases);
  await input.onCase?.(structuredClone(report));
  return report;
}
