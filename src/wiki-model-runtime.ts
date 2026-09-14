import { setTimeout as pause } from "node:timers/promises";
import { withModelWork } from "./model-admission.ts";
import { hash } from "./answer-validation.ts";
import { ModelValidationError } from "./model-validation.ts";
import { Operations, type Job } from "./operations.ts";
import type { WikiModel, WikiPhase } from "./wiki-types.ts";
/** Every actual maintenance request is charged durably before provider dispatch. */
export class WikiModelRuntime {
  constructor(
    private readonly operations: Operations,
    private readonly model: WikiModel,
  ) {}
  async request<T>(
    job: Job,
    unitKey: string,
    phase: WikiPhase,
    cap: number,
    input: Record<string, unknown>,
    validate: (raw: unknown) => T,
  ): Promise<T> {
    if (phase === "planning" || phase === "extraction" || phase === "support") {
      const rows = await this.operations
        .sql`SELECT g.id,g.body FROM wiki_guidance g JOIN knowledge_operations o ON o.id=${job.operationId} AND o.organization_id=g.organization_id WHERE g.operation_id=o.id OR (g.prior_operation_id IS NULL AND (g.page_id IS NULL OR g.page_id::text=${String(job.payload.pageId ?? "")}) AND (g.project_id IS NULL OR g.project_id::text=${String(input.scope ?? "")})) ORDER BY g.created_at,g.id`;
      // Guidance is routing context; it never enters evidence packs or claim manifests.
      if (rows.length)
        input = {
          ...input,
          guidance: rows.map((row) => ({
            id: String(row.id),
            text: String(row.body),
          })),
        };
    }
    if (new TextEncoder().encode(JSON.stringify(input)).length > 15500)
      throw new Error("needs_attention:model_input_limit");
    const inputHash = hash(input);
    const admitted = await this.operations.checkpoint(job, async (tx) => {
      await tx`INSERT INTO wiki_work(job_id) VALUES(${job.id}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO wiki_work_units(job_id,unit_key) VALUES(${job.id},${unitKey}) ON CONFLICT DO NOTHING`;
      const [work] =
        await tx`SELECT least(w.deadline,u.deadline) AS deadline FROM wiki_work w JOIN wiki_work_units u ON u.job_id=w.job_id WHERE w.job_id=${job.id} AND u.unit_key=${unitKey}`;
      const deadline = new Date(work!.deadline).getTime();
      if (Date.now() >= deadline) throw new Error("maintenance_deadline");
      const attempts =
        await tx`SELECT a.*,r.state AS transport_state FROM wiki_model_attempts a LEFT JOIN model_requests r ON r.id=a.model_request_id WHERE job_id=${job.id} AND unit_key=${unitKey} AND phase=${phase} ORDER BY attempt`;
      const executions = attempts.filter(
        (attempt) =>
          (attempt.dispatched_at && attempt.transport_state !== "expired") ||
          attempt.state === "completed",
      );
      const cached = attempts.findLast(
        (attempt) =>
          attempt.input_hash === inputHash &&
          attempt.model_profile === this.model.profile &&
          (attempt.state === "completed" || attempt.state === "received"),
      );
      if (cached)
        return {
          cached: cached.response,
          deadline,
          attempt: Number(cached.attempt),
          executions: executions.filter((a) => a.attempt !== cached.attempt)
            .length,
          feedback: undefined,
        };
      if (
        executions.length >= cap ||
        (phase === "inspection" &&
          executions.filter((attempt) => attempt.state === "failed").length > 1)
      )
        throw new Error("maintenance_budget_exhausted");
      if (phase === "generation") {
        const [reviews] =
          await tx`SELECT count(*) AS count FROM wiki_model_attempts a LEFT JOIN model_requests r ON r.id=a.model_request_id WHERE job_id=${job.id} AND unit_key=${unitKey} AND phase='review' AND a.dispatched_at IS NOT NULL AND r.state IS DISTINCT FROM 'expired'`;
        if (Number(reviews!.count) >= 3)
          throw new Error("maintenance_review_budget_exhausted");
      }
      const attempt = attempts.length + 1;
      await tx`INSERT INTO wiki_model_attempts(job_id,unit_key,phase,attempt,input_hash,model_profile,prompt_profile) VALUES(${job.id},${unitKey},${phase},${attempt},${inputHash},${this.model.profile},'wiki-request-v2')`;
      const previous = attempts.findLast(
        (a) => a.input_hash === inputHash && a.state === "failed",
      );
      return {
        deadline,
        attempt,
        executions: executions.length,
        feedback: previous?.validation_issues,
      };
    });
    const signal = this.operations.signal(
      job,
      AbortSignal.timeout(Math.max(1, admitted.deadline - Date.now())),
    );
    const assertLive = () => {
      if (
        Date.now() >= admitted.deadline ||
        signal.reason?.name === "TimeoutError"
      )
        throw new Error("maintenance_deadline");
      signal.throwIfAborted();
    };
    try {
      assertLive();
      const requestInput = admitted.feedback?.length
        ? { ...input, validationFeedback: admitted.feedback }
        : input;
      if (new TextEncoder().encode(JSON.stringify(requestInput)).length > 15500)
        throw new Error("needs_attention:model_input_limit");
      const onDispatch = async (requestId?: string) => {
        assertLive();
        await this.operations.checkpoint(job, async (tx) => {
          await tx`UPDATE wiki_model_attempts SET dispatched_at=clock_timestamp(),model_request_id=${requestId ?? null} WHERE job_id=${job.id} AND unit_key=${unitKey} AND phase=${phase} AND attempt=${admitted.attempt}`;
        });
      };
      if (!("cached" in admitted) && !this.model.admittedTransport)
        await onDispatch();
      const raw =
        "cached" in admitted
          ? structuredClone(admitted.cached)
          : await withModelWork(
              {
                operationId: `${job.id}:${unitKey}:${phase}`,
                parentOperationId: job.operationId,
                priority: "background",
                deadline: admitted.deadline,
                waitForCompletion: true,
                onDispatch,
              },
              () => this.model.request(phase, requestInput, signal),
            );
      assertLive();
      const maxBytes =
        phase === "generation" || phase === "review"
          ? 16000
          : phase === "planning"
            ? 2000
            : 8000;
      if (new TextEncoder().encode(JSON.stringify(raw)).length > maxBytes)
        throw new Error("model_output_limit");
      // A rejected result is still evidence needed to diagnose or repair this attempt.
      if (!("cached" in admitted))
        await this.operations.checkpoint(job, async (tx) => {
          await tx`UPDATE wiki_model_attempts SET state='received',response=${tx.json(JSON.parse(JSON.stringify(raw)))} WHERE job_id=${job.id} AND unit_key=${unitKey} AND phase=${phase} AND attempt=${admitted.attempt}`;
        });
      assertLive();
      const result = validate(structuredClone(raw));
      await this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE wiki_model_attempts SET state='completed',completed_at=clock_timestamp(),response=${tx.json(JSON.parse(JSON.stringify(raw)))} WHERE job_id=${job.id} AND unit_key=${unitKey} AND phase=${phase} AND attempt=${admitted.attempt}`;
      });
      return result;
    } catch (error) {
      if (
        Date.now() >= admitted.deadline ||
        (signal.aborted && signal.reason?.name === "TimeoutError")
      )
        error = new Error("maintenance_deadline");
      // Ownership loss must not record failure or retry under a replacement owner.
      await this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE wiki_model_attempts SET state='failed',completed_at=clock_timestamp(),error=${error instanceof Error ? error.message : "model_failure"},validation_issues=${tx.json(error instanceof ModelValidationError ? error.issues : [])} WHERE job_id=${job.id} AND unit_key=${unitKey} AND phase=${phase} AND attempt=${admitted.attempt}`;
      });
      if (error instanceof ModelValidationError && error.repair === "content")
        throw error;
      if (error instanceof Error && error.message === "stale_worker")
        throw error;
      if (
        error instanceof Error &&
        [
          "provider_http_400",
          "provider_http_401",
          "provider_http_403",
          "provider_uncertain",
          "invalid_embedding",
          "model_authority_lost",
          "maintenance_deadline",
          "needs_attention:model_input_limit",
        ].includes(error.message)
      )
        throw error;
      assertLive();
      const [attempt] = await this.operations
        .sql`SELECT a.dispatched_at,r.state AS transport_state FROM wiki_model_attempts a LEFT JOIN model_requests r ON r.id=a.model_request_id WHERE a.job_id=${job.id} AND a.unit_key=${unitKey} AND a.phase=${phase} AND a.attempt=${admitted.attempt}`;
      const dispatched = Boolean(
        attempt?.dispatched_at && attempt.transport_state !== "expired",
      );
      if (
        admitted.executions + Number(dispatched) >= cap ||
        admitted.attempt >= cap + 3
      )
        throw error;
      if (
        error instanceof Error &&
        /^provider_(http_(429|5\d\d)|unavailable)$/.test(error.message)
      )
        await pause(
          Math.min(5000, 250 * 2 ** (admitted.attempt - 1)) +
            Math.floor(Math.random() * 100),
          undefined,
          { signal },
        ).catch((error) => {
          if (
            Date.now() >= admitted.deadline ||
            signal.reason?.name === "TimeoutError"
          )
            throw new Error("maintenance_deadline");
          throw error;
        });
      return this.request(job, unitKey, phase, cap, input, validate);
    }
  }
}
