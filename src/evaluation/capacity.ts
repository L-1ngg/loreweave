import { z } from "zod";
import type { RunSnapshot } from "../host.ts";
import type { MaintenanceService } from "../maintenance.ts";
import { PublicAnswers } from "./client.ts";
import { MaintenanceDiagnostics } from "./maintenance.ts";
import { assertAcceptanceDistribution } from "./preparation.ts";
import { verifySnapshot, expectedGap } from "./runner.ts";
import {
  datasetSchema,
  sourceManifestSchema,
  validateDataset,
  digest,
  profiles,
  measured,
  unavailable,
  type Dataset,
  type Measurement,
} from "./schema.ts";
export const capacityPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    mode: z.enum(["fixture", "acceptance"]),
    scenario: z.enum(["idle", "update-interference"]),
    profile: z.enum(profiles),
    seed: z.number().int().min(1).max(0xffffffff),
    total: z
      .number()
      .int()
      .min(5)
      .max(1000)
      .refine((n) => n % 5 === 0),
    concurrency: z.literal(5),
    environment: z.strictObject({
      hardware: z.string().min(1),
      providerQuotas: z.string().min(1),
      warmup: z.string().min(1),
      answerCache: z.literal("disabled"),
    }),
  })
  .refine(
    (plan) => plan.mode !== "acceptance" || plan.total === 1000,
    "acceptance requires 1000 requests",
  );
export type CapacityPlan = z.infer<typeof capacityPlanSchema>;
export interface LoadRow {
  index: number;
  caseId: string;
  complexity: "ordinary" | "complex";
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  reviewedDelivery: boolean;
  run?: RunSnapshot;
  error?: string;
}
export function loadSchedule(dataset: Dataset, total: number, seed: number) {
  const ordinary = dataset.cases.filter(
    (item) => item.complexity === "ordinary",
  );
  const complex = dataset.cases.filter((item) => item.complexity === "complex");
  if (!ordinary.length || !complex.length)
    throw new Error("both_question_classes_required");
  const items = Array.from({ length: total }, (_, i) =>
    i < total * 0.8
      ? ordinary[i % ordinary.length]!
      : complex[(i - total * 0.8) % complex.length]!,
  );
  let state = seed >>> 0;
  for (let i = items.length - 1; i > 0; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = (state >>> 0) % (i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
function summarize(rows: LoadRow[], complexity: LoadRow["complexity"]) {
  const selected = rows.filter((row) => row.complexity === complexity);
  const sorted = selected.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const hard = complexity === "ordinary" ? 30000 : 60000;
  const target = complexity === "ordinary" ? 15000 : 60000;
  return {
    total: selected.length,
    withinTarget: selected.filter(
      (row) => row.reviewedDelivery && row.elapsedMs <= target,
    ).length,
    reviewedDeliveries: selected.filter((row) => row.reviewedDelivery).length,
    failedOrUnreviewed: selected.filter((row) => !row.reviewedDelivery).length,
    timeouts: selected.filter(
      (row) =>
        row.run?.status === "timed_out" || row.error?.includes("Timeout"),
    ).length,
    hardDeadlineBreaches: selected.filter((row) => row.elapsedMs > hard).length,
    p50Ms: sorted.length
      ? measured(sorted[Math.ceil(sorted.length * 0.5) - 1]!)
      : unavailable("no requests"),
    p95Ms: sorted.length
      ? measured(sorted[Math.ceil(sorted.length * 0.95) - 1]!)
      : unavailable("no requests"),
  };
}
/** Five public requests remain unfinished; grading/benchmark labels are never submitted. */
export async function measureCapacity(input: {
  plan: unknown;
  manifest: unknown;
  dataset: unknown;
  development?: unknown;
  client: PublicAnswers;
  update?: () => Promise<{ operationId: string }>;
}) {
  const plan = capacityPlanSchema.parse(input.plan);
  const manifest = sourceManifestSchema.parse(input.manifest);
  const dataset = datasetSchema.parse(input.dataset);
  validateDataset(
    manifest,
    dataset,
    input.development ? datasetSchema.parse(input.development) : undefined,
  );
  if ((plan.scenario === "update-interference") !== Boolean(input.update))
    throw new Error("update_scenario_mismatch");
  if (plan.mode === "acceptance") assertAcceptanceDistribution(dataset);
  const configuration = await input.client.configuration(
    AbortSignal.timeout(5000),
  );
  if (
    configuration.profile !== plan.profile ||
    (["wiki", "combined"].includes(plan.profile) && !configuration.wiki) ||
    (["graph", "combined"].includes(plan.profile) && !configuration.graph)
  )
    throw new Error("profile_unavailable");
  if (
    plan.mode === "acceptance" &&
    (dataset.split !== "acceptance" ||
      /scripted|controlled/i.test(configuration.answeringModel))
  )
    throw new Error("frozen_acceptance_and_real_provider_required");
  if (
    configuration.deadlines.ordinaryMs !== 30000 ||
    configuration.deadlines.complexMs !== 60000
  )
    throw new Error("deadline_profile_mismatch");
  await verifySnapshot(
    input.client,
    manifest,
    dataset,
    AbortSignal.timeout(60000),
  );
  let characters = 0;
  for (const entry of manifest.sources) {
    const source = await input.client.source(
      entry.version,
      AbortSignal.timeout(10000),
    );
    for (const _point of source.text) characters++;
  }
  if (
    plan.mode === "acceptance" &&
    (manifest.sources.length !== 1000 || characters > 20000000)
  )
    throw new Error("capacity_corpus_baseline_mismatch");
  const schedule = loadSchedule(dataset, plan.total, plan.seed);
  const observations: Array<{
    at: string;
    unfinished: number;
    activity: Measurement<Awaited<ReturnType<MaintenanceService["activity"]>>>;
    updateOperationId?: string;
    updateJobs: Measurement<Array<{ id: string; kind: string; state: string }>>;
  }> = [];
  let unfinished = 0,
    maxUnfinished = 0,
    next = 0,
    done = false;
  let trackedOperationId: string | undefined;
  const sample = async () => {
    const at = new Date().toISOString(),
      active = unfinished;
    let updateJobs: Measurement<
      Array<{ id: string; kind: string; state: string }>
    > = unavailable("update not accepted");
    try {
      const activity = await input.client.read<
        Awaited<ReturnType<MaintenanceService["activity"]>>
      >("/api/maintenance/activity", AbortSignal.timeout(5000));
      if (trackedOperationId) {
        try {
          const operation = await input.client.read<
            Awaited<ReturnType<MaintenanceService["inspect"]>>
          >(`/api/operations/${trackedOperationId}`, AbortSignal.timeout(5000));
          updateJobs = measured(
            operation.jobs.map((job) => ({
              id: job.id,
              kind: job.kind,
              state: job.state,
            })),
          );
        } catch {
          updateJobs = unavailable("update operation observation failed");
        }
      }
      observations.push({
        at,
        unfinished: Math.min(active, unfinished),
        activity: measured(activity),
        ...(trackedOperationId
          ? { updateOperationId: trackedOperationId }
          : {}),
        updateJobs,
      });
    } catch (error) {
      observations.push({
        at,
        unfinished: Math.min(active, unfinished),
        ...(trackedOperationId
          ? { updateOperationId: trackedOperationId }
          : {}),
        updateJobs,
        activity: unavailable(
          error instanceof Error ? error.message : "activity_unavailable",
        ),
      });
    }
  };
  await sample();
  if (
    observations[0]!.activity.status !== "available" ||
    observations[0]!.activity.value.pending > 0
  )
    throw new Error("maintenance_must_be_idle_at_start");
  const rows: LoadRow[] = [];
  let update: Measurement<{
    operationId: string;
    startedAt: string;
    acceptedAt: string;
  }> = unavailable("idle scenario");
  let updatePromise: Promise<void> | undefined;
  const startedAt = new Date().toISOString();
  const monitor = (async () => {
    while (!done) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (!done) await sample();
    }
  })();
  try {
    await Promise.all(
      Array.from({ length: plan.concurrency }, async () => {
        while (next < schedule.length) {
          const index = next++,
            item = schedule[index]!;
          const start = performance.now();
          const row: LoadRow = {
            index,
            caseId: item.id,
            complexity: item.complexity,
            startedAt: new Date().toISOString(),
            finishedAt: "",
            elapsedMs: 0,
            reviewedDelivery: false,
          };
          unfinished++;
          maxUnfinished = Math.max(maxUnfinished, unfinished);
          // Start the fifth question before invoking the separately authorized update.
          const answer = input.client.answer(
            item,
            AbortSignal.timeout(item.complexity === "ordinary" ? 32000 : 62000),
          );
          if (index === plan.concurrency - 1 && input.update) {
            const updateStart = new Date().toISOString();
            updatePromise = Promise.resolve()
              .then(input.update)
              .then(
                async (result) => {
                  trackedOperationId = result.operationId;
                  update = measured({
                    ...result,
                    startedAt: updateStart,
                    acceptedAt: new Date().toISOString(),
                  });
                  await sample();
                },
                (error) => {
                  update = unavailable(
                    error instanceof Error ? error.message : "update_failed",
                  );
                },
              );
          }
          try {
            row.run = await answer;
            row.reviewedDelivery =
              (row.run.status === "answered" || expectedGap(row.run, item)) &&
              Boolean(
                row.run.answer?.text.trim() &&
                row.run.answer.certificate &&
                (row.run.answer.citations.length > 0 ||
                  row.run.status === "partial") &&
                row.run.counts.review > 0,
              );
          } catch (error) {
            row.error =
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : "request_failed";
          }
          row.elapsedMs = performance.now() - start;
          row.finishedAt = new Date().toISOString();
          unfinished--;
          rows.push(row);
        }
      }),
    );
    await updatePromise;
  } finally {
    done = true;
    await monitor;
  }
  const finishedAt = new Date().toISOString();
  await sample();
  const reasons: string[] = [];
  const changed: string[] = [],
    removed: string[] = [];
  try {
    const after = await input.client.inventory(AbortSignal.timeout(10000));
    const beforeIds = new Set(manifest.sources.map((entry) => entry.version));
    for (const entry of after.operations)
      if (!beforeIds.has(entry.versionId)) changed.push(entry.versionId);
    const currentIds = new Set(
      after.operations.map((entry) => entry.versionId),
    );
    removed.push(
      ...manifest.sources
        .filter((entry) => !currentIds.has(entry.version))
        .map((entry) => entry.version),
    );
    if (update.status === "available") {
      const operation = await input.client.read<{
        versionId: string;
        documentId: string;
      }>(`/api/imports/${update.value.operationId}`, AbortSignal.timeout(5000));
      const prior =
        removed.length === 1
          ? await input.client.source(removed[0]!, AbortSignal.timeout(5000))
          : undefined;
      if (
        !changed.includes(operation.versionId) ||
        prior?.id !== operation.documentId
      )
        reasons.push("observed_change_not_attributed_to_update");
    }
  } catch {
    reasons.push("post_run_inventory_unavailable");
  }
  const organizationOverlap = observations.some(
    (entry) =>
      entry.unfinished > 0 &&
      entry.activity.status === "available" &&
      entry.activity.value.pending > 0,
  );
  const overlap = (prefix: string) =>
    observations.some(
      (entry) =>
        entry.unfinished > 0 &&
        entry.updateOperationId === trackedOperationId &&
        entry.updateJobs.status === "available" &&
        entry.updateJobs.value.some(
          (job) => job.kind.startsWith(prefix) && job.state === "running",
        ),
    );
  const sourcePreparationOverlap = overlap("source.");
  const derivedStagesObserved = {
    wiki: overlap("wiki."),
    graph: overlap("graph."),
  };
  const requiredStages = [
    ...(configuration.wiki ? [derivedStagesObserved.wiki] : []),
    ...(configuration.graph ? [derivedStagesObserved.graph] : []),
  ];
  const maintenanceOverlap = requiredStages.some(Boolean);
  if (
    observations.some(
      (entry) =>
        entry.updateOperationId && entry.updateJobs.status === "unavailable",
    )
  )
    reasons.push("update_operation_observation_gap");
  if (observations.some((entry) => entry.activity.status === "unavailable"))
    reasons.push("maintenance_observation_gap");
  if (
    plan.scenario === "idle" &&
    (organizationOverlap || changed.length || removed.length)
  )
    reasons.push("idle_run_interference");
  const firstActivity = observations[0]!.activity,
    lastActivity = observations.at(-1)!.activity;
  if (
    plan.scenario === "idle" &&
    firstActivity.status === "available" &&
    lastActivity.status === "available" &&
    firstActivity.value.acceptedOperations !==
      lastActivity.value.acceptedOperations
  )
    reasons.push("idle_run_accepted_knowledge_changes");
  if (
    plan.scenario === "update-interference" &&
    (update.status !== "available" ||
      !maintenanceOverlap ||
      changed.length !== 1 ||
      removed.length !== 1)
  )
    reasons.push("update_interference_not_established");
  let maintenanceDiagnostics = [] as Awaited<
    ReturnType<MaintenanceDiagnostics["capture"]>
  >;
  if (update.status === "available")
    try {
      maintenanceDiagnostics = await new MaintenanceDiagnostics(
        input.client,
        plan.mode === "fixture" ? "controlled-provider" : "real-provider",
      ).capture(update.value.operationId);
    } catch {
      reasons.push("maintenance_diagnostics_unavailable");
    }
  const observedRuns = rows.filter((row) => row.run);
  const phaseRequests = Object.fromEntries(
    (["exploration", "generation", "review", "retrieval"] as const).map(
      (phase) => [
        phase,
        observedRuns.reduce((sum, row) => sum + row.run!.counts[phase], 0),
      ],
    ),
  );
  return {
    schemaVersion: 1,
    kind: "capacity",
    plan,
    startedAt,
    finishedAt,
    datasetSha256: digest(JSON.stringify(dataset)),
    manifest,
    configuration,
    corpus: {
      activeDocuments: manifest.sources.length,
      unicodeCharacters: characters,
    },
    eligibleForAcceptance: plan.mode === "acceptance" && !reasons.length,
    limitations: [
      "Load repeats are not independent quality samples",
      "Maintenance polling may miss activity shorter than 100 ms",
      "Independent answer quality grading is separate",
      ...reasons,
    ],
    maxUnfinished,
    rows: rows.sort((a, b) => a.index - b.index),
    summary: {
      ordinary: summarize(rows, "ordinary"),
      complex: summarize(rows, "complex"),
    },
    update,
    observations,
    maintenanceOverlap,
    sourcePreparationOverlap,
    derivedStagesObserved,
    sourceChanges: { added: changed, removed },
    maintenanceDiagnostics,
    requestUse: {
      observedRuns: observedRuns.length,
      totalRuns: rows.length,
      phaseRequests,
    },
    answerLengths: rows.map((row) => ({
      index: row.index,
      unicodeCharacters: [...(row.run?.answer?.text ?? "")].length,
    })),
    tokens: unavailable("provider token telemetry unavailable"),
    monetaryCost: unavailable("provider usage/pricing unavailable"),
  };
}
