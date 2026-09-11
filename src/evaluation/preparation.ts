import {
  acceptanceSchema,
  developmentSchema,
  sourceManifestSchema,
  validateDataset,
  digest,
  profiles,
  measured,
  unavailable,
  type Dataset,
  type Measurement,
} from "./schema.ts";
import { grade } from "./grading.ts";
import { categories, type EvaluationReport } from "./runner.ts";
export function assertAcceptanceDistribution(dataset: Dataset) {
  if (dataset.split !== "acceptance")
    throw new Error("frozen_acceptance_required");
  const expected = {
    ordinary: { sufficient: 120, missing: 24, conflicting: 16 },
    complex: { sufficient: 24, missing: 8, conflicting: 8 },
  };
  for (const complexity of ["ordinary", "complex"] as const)
    for (const category of ["sufficient", "missing", "conflicting"] as const)
      if (
        dataset.cases.filter(
          (item) =>
            item.complexity === complexity && item.category === category,
        ).length !== expected[complexity][category]
      )
        throw new Error("acceptance_distribution_mismatch");
}
function interval(passes: number, total: number) {
  if (!total) return unavailable("no independent quality samples");
  const z = 1.959963984540054,
    p = passes / total,
    scale = 1 + (z * z) / total;
  const middle = (p + (z * z) / (2 * total)) / scale;
  const half =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    scale;
  return measured({
    lower: Math.max(0, middle - half),
    upper: Math.min(1, middle + half),
    method: "Wilson 95%",
  });
}
export const acceptanceObligations = [
  {
    id: "providers",
    required:
      "Authorized real-provider runtime for all four profiles; fixed models, budgets, parsing and base retrieval; documented quotas/hardware/pricing",
  },
  {
    id: "capacity-idle",
    required:
      "1000 active Markdown originals, <=20 million Unicode characters; 5 unfinished requests; seeded 800 ordinary/200 complex; maintenance idle; answer cache disabled",
  },
  {
    id: "capacity-update",
    required:
      "Separate identical load with one original Markdown replacement and observed maintenance overlap; report all errors, 15-second ordinary target, 30/60-second hard limits, p50/p95 and source/Wiki/graph readiness",
  },
  {
    id: "wiki",
    required:
      "20 representative pages with independently checked correctness, source support, qualifiers and conflicts; >=18 pass; all checked original/internal links resolve; retained page/version IDs and reviewer notes",
  },
  {
    id: "lifecycle",
    required:
      "12 real-provider cases: 3 source updates, 3 conflicting additions, 3 cross-project same-name cases, 3 Wiki restorations; all assertions pass with original-version citations",
  },
  {
    id: "closure",
    required:
      "Evidence support/rejection and finalization freshness; transitive identity-proof expiry; Wiki retirement/revival; finite continuation/restart; graph overflow, qualifiers, empty/partial replacement and alternate support, using #20 public diagnostics",
  },
  {
    id: "routing",
    required:
      "Held-out human-reviewed routing targets and defer judgments: paraphrases, singleton topics, scope ambiguity, unavailable indexes, new/removed sections and concurrent creation; coverage and request/cost denominators",
  },
] as const;
/** Validate preparation and compare independent QA grades; this is not release certification. */
export function prepareAcceptance(input: {
  manifest?: unknown;
  development?: unknown;
  acceptance?: unknown;
  report?: unknown;
  grades?: unknown;
}) {
  const checks: Array<{
    id: string;
    status: "ready" | "missing" | "invalid";
    reason: string;
  }> = [];
  const read = <T>(
    id: string,
    value: unknown,
    validate: () => T,
  ): T | undefined => {
    if (value === undefined) {
      checks.push({
        id,
        status: "missing",
        reason: `${id} artifact not supplied`,
      });
      return;
    }
    try {
      const result = validate();
      checks.push({
        id,
        status: "ready",
        reason: "artifact validation passed",
      });
      return result;
    } catch (error) {
      checks.push({
        id,
        status: "invalid",
        reason: error instanceof Error ? error.message : "invalid artifact",
      });
    }
  };
  const manifest = read("manifest", input.manifest, () =>
    sourceManifestSchema.parse(input.manifest),
  );
  const development = read("development", input.development, () => {
    const dataset = developmentSchema.parse(input.development);
    if (!manifest) throw new Error("valid_manifest_required");
    validateDataset(manifest, dataset);
    if (
      dataset.mode !== "human" ||
      dataset.cases.length !== 50 ||
      dataset.cases.filter((item) => item.complexity === "ordinary").length !==
        40
    )
      throw new Error("50_reviewed_development_questions_required");
    return dataset;
  });
  const acceptance = read("acceptance", input.acceptance, () => {
    const dataset = acceptanceSchema.parse(input.acceptance);
    if (!manifest || !development)
      throw new Error("valid_manifest_and_development_required");
    validateDataset(manifest, dataset, development);
    assertAcceptanceDistribution(dataset);
    return dataset;
  });
  let qualityMarkdown =
    "Quality comparison is unavailable until frozen inputs and independent grades are supplied.";
  let qualityComparison: Measurement<unknown> = unavailable(
    "frozen inputs, public-answer report and independent grades required",
  );
  read("quality", input.report, () => {
    if (!manifest || !acceptance)
      throw new Error("valid_frozen_inputs_required");
    const report = input.report as EvaluationReport;
    if (
      report.kind !== "evaluation" ||
      report.provenance !== "human-review-required" ||
      digest(JSON.stringify(report.manifest)) !==
        digest(JSON.stringify(manifest)) ||
      digest(JSON.stringify(report.dataset)) !==
        digest(JSON.stringify(acceptance)) ||
      report.datasetSha256 !== digest(JSON.stringify(acceptance))
    )
      throw new Error("comparison_input_mismatch");
    if (!Array.isArray(report.cases) || report.cases.length !== 800)
      throw new Error("800_profile_case_results_required");
    const caseKeys = new Set<string>();
    for (const item of report.cases) {
      const reference = acceptance.cases.find(
        (candidate) => candidate.id === item.id,
      );
      const key = `${item.profile}:${item.id}`;
      if (
        !reference ||
        !profiles.includes(item.profile) ||
        caseKeys.has(key) ||
        item.category !== reference.category ||
        item.complexity !== reference.complexity
      )
        throw new Error("comparison_case_mismatch");
      caseKeys.add(key);
    }
    let common: string | undefined;
    for (const profile of profiles) {
      const config = report.configurations[profile];
      if (
        config?.status !== "available" ||
        config.value.profile !== profile ||
        (["wiki", "combined"].includes(profile) && !config.value.wiki) ||
        (["graph", "combined"].includes(profile) && !config.value.graph) ||
        /scripted|controlled/i.test(config.value.answeringModel)
      )
        throw new Error("four_real_provider_profiles_required");
      const fixed = JSON.stringify([
        config.value.answeringModel,
        config.value.policy,
        config.value.retrieval,
        config.value.context,
        config.value.budgets,
        config.value.deadlines,
      ]);
      if (common && fixed !== common)
        throw new Error("comparison_configuration_mismatch");
      common = fixed;
    }
    const reviewed = grade(report, input.grades);
    if (reviewed.humanGrades.reviews.length !== 800)
      throw new Error("independent_review_of_every_answer_required");
    const slices = profiles.flatMap((profile) =>
      ["ordinary", "complex"].map((complexity) => {
        const rows = reviewed.cases.filter(
          (item) => item.profile === profile && item.complexity === complexity,
        );
        const passes = rows.filter((item) => item.outcome === "pass").length;
        return {
          profile,
          complexity,
          passes,
          total: rows.length,
          target: complexity === "ordinary" ? 0.9 : 0.8,
          targetMet:
            passes / rows.length >= (complexity === "ordinary" ? 0.9 : 0.8),
          uncertainty: interval(passes, rows.length),
        };
      }),
    );
    const paired = profiles
      .filter((profile) => profile !== "source")
      .map((profile) => {
        const changes = acceptance.cases.map((item) => {
          const before = reviewed.cases.find(
            (row) => row.profile === "source" && row.id === item.id,
          )!;
          const after = reviewed.cases.find(
            (row) => row.profile === profile && row.id === item.id,
          )!;
          return {
            id: item.id,
            complexity: item.complexity,
            category: item.category,
            baseline: before.outcome,
            candidate: after.outcome,
            gain: before.outcome !== "pass" && after.outcome === "pass",
            regression: before.outcome === "pass" && after.outcome !== "pass",
          };
        });
        return {
          profile,
          gains: changes.filter((item) => item.gain).length,
          regressions: changes.filter((item) => item.regression).length,
          total: changes.length,
          changes,
        };
      });
    qualityMarkdown = `| Profile | Class | Passes / total | Target met |\n| --- | --- | --- | --- |\n${slices.map((slice) => `| ${slice.profile} | ${slice.complexity} | ${slice.passes} / ${slice.total} | ${slice.targetMet} |`).join("\n")}\n\n| Addition | Gains | Regressions | Paired questions |\n| --- | --- | --- | --- |\n${paired.map((pair) => `| ${pair.profile} | ${pair.gains} | ${pair.regressions} | ${pair.total} |`).join("\n")}`;
    qualityComparison = measured({
      slices,
      categories: categories(reviewed.cases),
      paired,
      humanGrades: reviewed.humanGrades,
    });
    return reviewed;
  });
  return {
    schemaVersion: 1,
    kind: "acceptance-preparation",
    createdAt: new Date().toISOString(),
    releaseStatus: "not-assessed",
    inputStatus: checks.every((check) => check.status === "ready")
      ? "ready"
      : "blocked",
    checks,
    qualityComparison,
    qualityMarkdown,
    pendingExecution: acceptanceObligations.map((item) => ({
      ...item,
      status: "not-assessed",
    })),
    limits: [
      "Preparation validates supplied artifacts; it cannot establish corpus access or whether a human actually performed a review",
      "Wilson intervals are descriptive for selected questions, not guarantees over future traffic",
      "Controlled fixtures and repeated load questions do not establish real-model quality",
      "Full release assessment additionally requires the separately retained capacity, Wiki, lifecycle and held-out routing evidence",
    ],
  };
}
export function preparationMarkdown(
  report: ReturnType<typeof prepareAcceptance>,
) {
  return `# Acceptance preparation\n\nGenerated: ${report.createdAt}\n\nRelease: **${report.releaseStatus}**. Input preparation: **${report.inputStatus}**.\n\n| Artifact | Status | Detail |\n| --- | --- | --- |\n${report.checks.map((check) => `| ${check.id} | ${check.status} | ${check.reason.replaceAll("|", "\\|").replaceAll("\n", " ")} |`).join("\n")}\n\n## Question quality comparison\n\n${report.qualityMarkdown}\n\n## Pending execution\n\n${report.pendingExecution.map((item) => `- **${item.id}** (${item.status}): ${item.required}`).join("\n")}\n\n## Limits\n\n${report.limits.map((limit) => `- ${limit}`).join("\n")}\n`;
}
