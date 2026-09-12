import { measured, unavailable, profiles, type Profile } from "./schema.ts";

/** Report-consumer seam: omitted observations never become zero measurements. */
interface Observation {
  profile: Profile;
  complexity: string;
  outcome: string;
  elapsedMs: number;
  run?: {
    status: string;
    diagnostics?: {
      queueMs?: number;
      retrievalMs?: number;
      generationMs?: number;
      reviewMs?: number;
    };
  };
  referenceRecall?: { numerator: number; denominator: number };
  citationChecks?: Array<{ valid: boolean }>;
  requests?: {
    status: string;
    value?: { model: number; embedding: number | null };
  };
}
function percentiles(values: Array<number | undefined>) {
  const sorted = values
    .filter(
      (value): value is number =>
        value !== undefined && Number.isFinite(value) && value >= 0,
    )
    .sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length
      ? measured(sorted[Math.ceil(sorted.length * p) - 1]!)
      : unavailable("no observed requests");
  return {
    samples: sorted.length,
    missing: values.length - sorted.length,
    p50: at(0.5),
    p95: at(0.95),
  };
}
export function summarizeRoutes(cases: Observation[]) {
  return profiles.flatMap((profile) =>
    ["ordinary", "complex"].map((complexity) => {
      const rows = cases.filter(
        (row) => row.profile === profile && row.complexity === complexity,
      );
      const attempted = rows.filter((row) => row.outcome !== "unavailable");
      const checks = rows.flatMap((row) => row.citationChecks ?? []);
      return {
        profile,
        complexity,
        total: rows.length,
        passed: rows.filter((row) => row.outcome === "pass").length,
        failed: rows.filter((row) => row.outcome === "fail").length,
        pendingReview: rows.filter((row) =>
          ["pending_human", "pending_agent"].includes(row.outcome),
        ).length,
        unavailable: rows.length - attempted.length,
        answered: rows.filter((row) => row.run?.status === "answered").length,
        partial: rows.filter((row) => row.run?.status === "partial").length,
        timeouts: rows.filter((row) => row.run?.status === "timed_out").length,
        evidenceRecall: {
          numerator: rows.reduce(
            (n, row) => n + (row.referenceRecall?.numerator ?? 0),
            0,
          ),
          denominator: rows.reduce(
            (n, row) => n + (row.referenceRecall?.denominator ?? 0),
            0,
          ),
        },
        citationLocators: {
          numerator: checks.filter((check) => check.valid).length,
          denominator: checks.length,
        },
        latency: {
          delivery: percentiles(attempted.map((row) => row.elapsedMs)),
          queue: percentiles(
            attempted.map((row) => row.run?.diagnostics?.queueMs),
          ),
          retrieval: percentiles(
            attempted.map((row) => row.run?.diagnostics?.retrievalMs),
          ),
          generation: percentiles(
            attempted.map((row) => row.run?.diagnostics?.generationMs),
          ),
          review: percentiles(
            attempted.map((row) => row.run?.diagnostics?.reviewMs),
          ),
        },
        requests: {
          model: percentiles(
            attempted.map((row) =>
              row.requests?.status === "available"
                ? row.requests.value?.model
                : undefined,
            ),
          ),
          embedding: percentiles(
            attempted.map((row) =>
              row.requests?.status === "available"
                ? (row.requests.value?.embedding ?? undefined)
                : undefined,
            ),
          ),
        },
        cost: unavailable(
          "provider token usage and pricing unavailable; request counts are not currency cost",
        ),
      };
    }),
  );
}
