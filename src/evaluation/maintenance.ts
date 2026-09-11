import type { WikiService } from "../wiki.ts";
import type { IdentityService } from "../identity.ts";
import type { GraphService } from "../graph.ts";
import type { MaintenanceService } from "../maintenance.ts";
import { PublicAnswers } from "./client.ts";
import {
  diagnosticSchema,
  routingTargetsSchema,
  maintenanceKinds,
  measured,
  unavailable,
  type DiagnosticAdapter,
  type MaintenanceDiagnostic,
} from "./schema.ts";
import { record } from "../answer-validation.ts";
import type { z } from "zod";
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const object = (value: unknown): Record<string, unknown> =>
  record(value) ? value : {};
const strings = (value: unknown): string[] =>
  array(value).filter((value): value is string => typeof value === "string");
type Targets = z.infer<typeof routingTargetsSchema>;
/** Capture authenticated public diagnostics. No SQL, model invocation or ingestion. */
export class MaintenanceDiagnostics implements DiagnosticAdapter {
  constructor(
    private readonly client: PublicAnswers,
    private readonly provenance: "controlled-provider" | "real-provider",
    private readonly targets?: Targets,
    private readonly subjects: {
      mentionIds?: string[];
      entityIds?: string[];
    } = {},
  ) {}
  async capture(operationId: string): Promise<MaintenanceDiagnostic[]> {
    const base = (
      kind: MaintenanceDiagnostic["kind"],
    ): MaintenanceDiagnostic => ({
      schemaVersion: 1,
      kind,
      operationId,
      capturedAt: new Date().toISOString(),
      provenance: this.provenance,
      versions: {},
      status: "available",
      metrics: {},
      details: {},
    });
    const records = new Map(maintenanceKinds.map((kind) => [kind, base(kind)]));
    const read = async <T>(
      path: string,
      kinds: MaintenanceDiagnostic["kind"][],
    ): Promise<T | undefined> => {
      try {
        return await this.client.read<T>(path, AbortSignal.timeout(10000));
      } catch (error) {
        for (const kind of kinds)
          Object.assign(records.get(kind)!, {
            status: "unavailable",
            reason:
              error instanceof Error ? error.message : "diagnostic_unavailable",
          });
      }
    };
    const results = await Promise.allSettled([
      read<Awaited<ReturnType<WikiService["inspect"]>>>(
        `/api/wiki-operations/${operationId}`,
        ["routing", "inspection", "lifecycle"],
      ),
      read<Awaited<ReturnType<IdentityService["inspectOperation"]>>>(
        `/api/identity-operations/${operationId}`,
        ["identity"],
      ),
      read<Awaited<ReturnType<GraphService["inspect"]>>>(
        `/api/graph/operations/${operationId}`,
        ["graph"],
      ),
      read<Awaited<ReturnType<MaintenanceService["inspect"]>>>(
        `/api/operations/${operationId}`,
        ["review", "work"],
      ),
    ]);
    const [wikiResult, identityResult, graphResult, operationResult] = results;
    const wiki =
      wikiResult!.status === "fulfilled" ? wikiResult!.value : undefined;
    const identity =
      identityResult!.status === "fulfilled"
        ? identityResult!.value
        : undefined;
    const graph =
      graphResult!.status === "fulfilled" ? graphResult!.value : undefined;
    const operation =
      operationResult!.status === "fulfilled"
        ? operationResult!.value
        : undefined;
    if (wiki) {
      const routing = records.get("routing")!,
        inspection = records.get("inspection")!,
        lifecycle = records.get("lifecycle")!;
      const decisions: Array<
        { jobId: string; key: string } & Record<string, unknown>
      > = wiki.jobs.flatMap((job) =>
        Object.entries(object(job.ledger))
          .filter(([key]) => /^topic:/.test(key))
          .map(([key, value]) => ({ jobId: job.id, key, ...object(value) })),
      );
      routing.details = {
        decisions,
        targets: this.targets ?? null,
        deferReasons: wiki.jobs
          .filter((job) => job.reason)
          .map((job) => ({ jobId: job.id, reason: job.reason })),
      };
      const expected =
        this.targets?.examples.filter(
          (example) => example.operationId === operationId,
        ) ?? [];
      if (
        expected.some(
          (example) =>
            example.review.kind === "pending" ||
            (this.provenance === "real-provider" &&
              example.review.kind !== "human"),
        )
      )
        throw new Error("unreviewed_routing_targets");
      let hits8 = 0,
        hits16 = 0,
        referenceCount = 0,
        falseCreate = 0,
        missedReuse = 0,
        matched = 0,
        reuseTargets = 0;
      for (const target of expected) {
        const matching = decisions.filter(
          (entry) =>
            `${entry.jobId}:${entry.key}` === target.topicKey ||
            entry.key === target.topicKey,
        );
        const decision = matching.length === 1 ? matching[0] : undefined;
        referenceCount += target.referencePages.length;
        if (!decision) continue;
        matched++;
        if (target.expectedDecision === "reuse") reuseTargets++;
        const pool = strings(decision.pool);
        hits8 += target.referencePages.filter((id) =>
          pool.slice(0, 8).includes(id),
        ).length;
        hits16 += target.referencePages.filter((id) =>
          pool.slice(0, 16).includes(id),
        ).length;
        const action = object(decision.decision);
        if (target.expectedDecision !== "create" && action.action === "create")
          falseCreate++;
        if (
          target.expectedDecision === "reuse" &&
          (!target.referencePages.includes(String(action.pageId)) ||
            ["create", "defer"].includes(String(action.action)))
        )
          missedReuse++;
      }
      if (expected.length)
        routing.metrics = {
          targetCoverage: { numerator: matched, denominator: expected.length },
          recall8: { numerator: hits8, denominator: referenceCount },
          recall16: { numerator: hits16, denominator: referenceCount },
          falseCreation: {
            numerator: falseCreate,
            denominator: matched,
          },
          missedReuse: { numerator: missedReuse, denominator: reuseTargets },
        };
      else
        routing.details.quality = unavailable(
          "reviewed routing targets not provided",
        );
      for (const decision of decisions)
        for (const [key, value] of Object.entries({
          model: decision.modelProfile,
          index: decision.indexProfile,
          policy: decision.policyProfile,
        }))
          if (typeof value === "string")
            routing.versions[`${decision.jobId}:${decision.key}:${key}`] =
              value;
      const ledgers: Array<
        { jobId: string; key: string } & Record<string, unknown>
      > = wiki.jobs.flatMap((job) =>
        Object.entries(object(job.ledger))
          .filter(([key]) => /^inspection:|^packet:/.test(key))
          .map(([key, value]) => ({ jobId: job.id, key, ...object(value) })),
      );
      const inspectionLedgers = ledgers.filter((ledger) =>
        ledger.key.startsWith("inspection:"),
      );
      let completedRanges = 0,
        requiredRanges = 0;
      for (const ledger of inspectionLedgers) {
        const key = (range: unknown) => {
          const r = object(range);
          return JSON.stringify([
            r.pageId,
            r.version,
            r.kind,
            r.passageId,
            r.start,
            r.end,
            r.hash,
          ]);
        };
        const completed = new Set(
          array(ledger.windows)
            .filter((window) => {
              const outcome = object(object(window).outcome);
              return (
                outcome.complete === true &&
                array(outcome.remaining).length === 0
              );
            })
            .flatMap((window) => array(object(window).ranges))
            .map(key),
        );
        completedRanges += completed.size;
        requiredRanges += new Set([
          ...completed,
          ...array(ledger.remaining).map(key),
        ]).size;
      }
      const discoveryJobs = wiki.jobs.filter(
        (job) => job.kind === "wiki.refresh",
      );
      const rootLedgers = discoveryJobs.map((job) => ({
        jobId: job.id,
        ...object(job.ledger),
      }));
      const covered = rootLedgers.flatMap((ledger) =>
        array(object(ledger).coverage),
      );
      const remaining = rootLedgers.flatMap((ledger) =>
        array(object(ledger).remaining),
      );
      const discoveryRecorded = rootLedgers.every(
        (ledger) =>
          Array.isArray(object(ledger).coverage) &&
          Array.isArray(object(ledger).remaining),
      );
      inspection.details = {
        ledgers,
        walks: wiki.walks,
        discovery: covered,
        remaining,
        rootLedgers,
        dependencyJobs: wiki.dependencyJobs,
        discoveryCoverage: discoveryRecorded
          ? measured("root source obligations recorded")
          : unavailable("source obligation manifest not yet recorded"),
        jobs: wiki.jobs.map((job) => ({
          id: job.id,
          state: job.state,
          reason: job.reason,
          deadline: job.deadline,
        })),
        proposals: wiki.proposals,
      };
      inspection.metrics = {
        mandatoryWalks: {
          numerator: wiki.dependencyJobs.filter(
            (job) =>
              job.state === "succeeded" &&
              wiki.walks.some((walk) => walk.jobId === job.id && walk.complete),
          ).length,
          denominator: wiki.dependencyJobs.length,
        },
        ...(discoveryRecorded
          ? {
              discoveryCoverage: {
                numerator: covered.filter(
                  (item) => object(item).outcome !== "unresolved",
                ).length,
                denominator: covered.length + remaining.length,
              },
            }
          : {}),
        inspectedRanges: {
          numerator: completedRanges,
          denominator: requiredRanges,
        },
        terminalJobs: {
          numerator: wiki.jobs.filter((job) =>
            ["succeeded", "failed", "superseded"].includes(job.state),
          ).length,
          denominator: wiki.jobs.length,
        },
      };
      inspection.versions.policy = "wiki-topic-maintenance-P01-P08-v1";
      lifecycle.details = {
        status: wiki.status,
        pages: wiki.pages,
        events: wiki.lifecycleEvents,
      };
      lifecycle.metrics = {
        retired: {
          numerator: wiki.lifecycleEvents.filter(
            (event) => event.to === "retired",
          ).length,
          denominator: wiki.lifecycleEvents.length,
        },
        reactivated: {
          numerator: wiki.lifecycleEvents.filter(
            (event) => event.from === "retired" && event.to === "active",
          ).length,
          denominator: wiki.lifecycleEvents.length,
        },
        failedRefresh: {
          numerator: wiki.jobs.filter((job) => job.state === "failed").length,
          denominator: wiki.jobs.length,
        },
      };
      lifecycle.versions.events = "wiki-lifecycle-events-v1";
    }
    if (identity) {
      const diagnostic = records.get("identity")!;
      const bindings = [];
      for (const id of this.subjects.mentionIds ?? []) {
        const binding = await read<
          Awaited<ReturnType<IdentityService["inspect"]>>
        >(`/api/identities/${id}`, ["identity"]);
        if (binding) bindings.push(binding);
      }
      diagnostic.details = { ...identity, bindings };
      diagnostic.versions.policy = identity.policy;
      diagnostic.metrics = {
        validBindings: {
          numerator: bindings.filter((binding) => binding.valid).length,
          denominator: bindings.length,
        },
        invalidRevisions: {
          numerator: identity.revisions.filter((revision) => !revision.valid)
            .length,
          denominator: identity.revisions.length,
        },
        unresolvedRevisions: {
          numerator: identity.revisions.filter(
            (revision) => revision.outcome === "unresolved",
          ).length,
          denominator: identity.revisions.length,
        },
        completedBatches: {
          numerator: identity.batches.filter(
            (batch) => batch.state === "complete",
          ).length,
          denominator: identity.batches.length,
        },
      };
    }
    if (graph) {
      const diagnostic = records.get("graph")!;
      const neighborhoods = [];
      for (const id of this.subjects.entityIds ?? []) {
        const neighborhood = await read<
          Awaited<ReturnType<GraphService["neighborhood"]>>
        >(`/api/graph/neighborhood?entityId=${id}`, ["graph"]);
        if (neighborhood) neighborhoods.push({ entityId: id, ...neighborhood });
      }
      diagnostic.details = { ...graph, neighborhoods };
      for (const generation of graph.generations)
        diagnostic.versions[generation.id] = generation.profile;
      const packets = graph.generations.flatMap(
        (generation) => generation.details,
      );
      diagnostic.metrics = {
        reviewedPackets: {
          numerator: packets.filter((packet) => packet.state === "reviewed")
            .length,
          denominator: packets.length,
        },
        activeGenerations: {
          numerator: graph.generations.filter(
            (generation) => generation.state === "active",
          ).length,
          denominator: graph.generations.length,
        },
        excludedPackets: {
          numerator: packets.filter((packet) => packet.exclusions.length)
            .length,
          denominator: packets.length,
        },
      };
    }
    if (operation) {
      const work = records.get("work")!,
        review = records.get("review")!;
      const requests = operation.modelRequests;
      const dispatched = requests.filter((request) => request.dispatchedAt);
      const completed = dispatched.filter(
        (request) => request.state === "completed",
      );
      const seen = new Set<string>();
      const retries = dispatched.filter((request) => {
        const key = JSON.stringify([
          request.jobId,
          request.unit,
          request.phase,
          request.inputHash,
        ]);
        const repeated = seen.has(key);
        seen.add(key);
        return repeated;
      });
      const recorded = requests.every(
        (request) => request.model !== "unrecorded",
      );
      work.metrics = {
        dispatchCoverage: {
          numerator: requests.filter(
            (request) => request.model !== "unrecorded",
          ).length,
          denominator: requests.length,
        },
        dispatchIntents: {
          numerator: requests.filter((request) => request.dispatchedAt).length,
          denominator: requests.length,
        },
        retries: {
          numerator: retries.length,
          denominator: dispatched.length,
        },
      };
      const timing = (prefix: string) => {
        const jobs = operation.jobs.filter((job) =>
          job.kind.startsWith(prefix),
        );
        if (
          !jobs.length ||
          jobs.some(
            (job) =>
              job.state !== "succeeded" || job.receipt?.outcome !== "succeeded",
          )
        )
          return unavailable("required work incomplete or receipt unavailable");
        return measured(
          Math.max(
            ...jobs.map((job) => new Date(job.receipt.committedAt).getTime()),
          ) - new Date(operation.createdAt).getTime(),
        );
      };
      work.details = {
        operation,
        providerRequests:
          recorded && completed.length === dispatched.length
            ? measured(completed.length)
            : unavailable("unrecorded telemetry or uncertain dispatch outcome"),
        recordedRequestBounds: {
          lower: completed.length,
          upper: dispatched.length,
        },
        sourceSearchableMs: timing("source."),
        wikiReadyMs: timing("wiki."),
        graphReadyMs: timing("graph."),
        tokens: unavailable("provider token telemetry unavailable"),
        monetaryCost: unavailable("provider usage/pricing unavailable"),
      };
      const reviews = requests.filter((request) =>
        [
          "review",
          "graph_review",
          "structure_review",
          "support",
          "conflicts",
        ].includes(request.phase),
      );
      review.details = { requests: reviews };
      review.metrics = {
        completedReviews: {
          numerator: reviews.filter((request) => request.state === "completed")
            .length,
          denominator: reviews.length,
        },
        failedReviews: {
          numerator: reviews.filter((request) => request.state === "failed")
            .length,
          denominator: reviews.length,
        },
      };
      for (const request of requests) {
        work.versions[
          `${request.jobId}:${request.unit}:${request.phase}:model`
        ] = request.model;
        work.versions[
          `${request.jobId}:${request.unit}:${request.phase}:prompt`
        ] = request.prompt;
      }
      review.versions = { ...work.versions };
    }
    return [...records.values()].map((diagnostic) =>
      diagnosticSchema.parse(diagnostic),
    );
  }
}
