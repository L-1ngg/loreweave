import { parserProfile } from "./markdown.ts";
import { chunkerProfile } from "./retrieval-chunks.ts";
import { controlledInputCounter } from "./embedding-tokenizer.ts";
import { setTimeout as pause } from "node:timers/promises";
import { hash } from "./answer-validation.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "./embeddings.ts";
import { Operations, type Job } from "./operations.ts";
import { withModelWork, reapModelOwners } from "./model-admission.ts";

/** Keep the existing preparation namespace so durable completed work remains reusable. */
export function preparedEmbeddingProfile(embeddings: EmbeddingAdapter) {
  return `${parserProfile}:${embeddings.profile}:${embeddings.dimensions}:${chunkerProfile}:${(embeddings.inputCounter ?? controlledInputCounter).profile}`;
}

/** Durable ownership deduplicates exact compatible inputs independently of source bindings. */
export class PreparedEmbeddings {
  constructor(
    private readonly operations: Operations,
    private readonly embeddings: EmbeddingAdapter,
  ) {}
  async batch(
    job: Job,
    partition: string,
    profile: string,
    inputs: Array<{ text: string; contextHash: string }>,
    deadline: number,
    signal: AbortSignal,
  ) {
    const keyed = inputs.map((input) => ({ ...input, key: hash(input) }));
    const unique = [
      ...new Map(keyed.map((input) => [input.key, input])).values(),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const requestOperation = `embedding:${partition}:${hash({ profile, keys: unique.map((input) => input.key) })}`;
    const vectors = new Map<string, number[]>();
    const pending: Array<(typeof unique)[number] & { cacheProfile: string }> =
      [];
    const legacyIndexProfile = `${this.embeddings.profile}:${chunkerProfile}:${(this.embeddings.inputCounter ?? controlledInputCounter).profile}`;
    const compatibleProfiles =
      profile === preparedEmbeddingProfile(this.embeddings)
        ? [profile, legacyIndexProfile]
        : [profile];
    for (const input of unique) {
      for (;;) {
        signal.throwIfAborted();
        const row = await this.operations.checkpoint(job, async (tx) => {
          // Retain both completed vectors and reservation ownership from the older
          // index namespace. In particular, an uncertain legacy attempt must not
          // become eligible for a second request merely because its key changed.
          const [legacy] =
            await tx`SELECT profile FROM embedding_cache WHERE partition=${partition} AND profile IN ${tx(compatibleProfiles)} AND input_hash=${input.key} ORDER BY (state='completed') DESC,(profile=${profile}) DESC LIMIT 1 FOR UPDATE`;
          const cacheProfile = String(legacy?.profile ?? profile);
          await tx`INSERT INTO embedding_cache(partition,profile,input_hash,state,owner_job,owner_fence,request_operation) VALUES(${partition},${cacheProfile},${input.key},'reserved',${job.id},${job.fence},${requestOperation}) ON CONFLICT DO NOTHING`;
          const [row] =
            await tx`SELECT * FROM embedding_cache WHERE partition=${partition} AND profile=${cacheProfile} AND input_hash=${input.key} FOR UPDATE`;
          if (row!.state === "completed") {
            await tx`INSERT INTO maintenance_artifact_reuse(job_id,kind,input_hash) VALUES(${job.id},'embedding',${input.key}) ON CONFLICT DO NOTHING`;
            return { vector: row!.vector as number[] };
          }
          if (
            row!.owner_job === job.id &&
            Number(row!.owner_fence) === job.fence
          )
            return { owned: true as const, cacheProfile };
          const [owner] =
            await tx`SELECT id FROM knowledge_jobs WHERE id=${String(row!.owner_job)} AND fence=${Number(row!.owner_fence)} AND state='running' AND lease_until>clock_timestamp()`;
          if (owner) return { owned: false as const };
          await tx`SELECT pg_advisory_xact_lock(hashtextextended('loreweave:model-admission:v1',0))`;
          await reapModelOwners(tx);
          const [uncertain] =
            await tx`SELECT id FROM model_requests WHERE operation_id=${String(row!.request_operation)} AND state IN ('reserved','dispatched','uncertain') LIMIT 1`;
          if (uncertain) throw new Error("provider_uncertain");
          await tx`UPDATE embedding_cache SET owner_job=${job.id},owner_fence=${job.fence},request_operation=${requestOperation} WHERE partition=${partition} AND profile=${cacheProfile} AND input_hash=${input.key}`;
          return { owned: true as const, cacheProfile };
        });
        if ("vector" in row) {
          validateEmbeddings([row.vector], 1, this.embeddings.dimensions);
          vectors.set(input.key, row.vector);
          break;
        }
        if (row.owned) {
          pending.push({ ...input, cacheProfile: row.cacheProfile });
          break;
        }
        await pause(25, undefined, { signal });
      }
    }
    if (pending.length) {
      const checkpoint = async (indices: number[], result: number[][]) => {
        validateEmbeddings(result, indices.length, this.embeddings.dimensions);
        await this.operations.checkpoint(job, async (tx) => {
          for (const [ordinal, index] of indices.entries()) {
            const input = pending[index];
            if (!input) throw new Error("invalid_embedding");
            const [row] =
              await tx`UPDATE embedding_cache SET state='completed',vector=${tx.json(result[ordinal]!)},completed_at=clock_timestamp() WHERE partition=${partition} AND profile=${input.cacheProfile} AND input_hash=${input.key} AND owner_job=${job.id} AND owner_fence=${job.fence} AND state IN ('reserved','completed') RETURNING input_hash`;
            if (!row) throw new Error("stale_worker");
            vectors.set(input.key, result[ordinal]!);
          }
        });
      };
      const result = await withModelWork(
        {
          operationId: requestOperation,
          parentOperationId: job.operationId,
          priority: "background",
          deadline,
        },
        () =>
          this.embeddings.embed(
            pending.map((input) => input.text),
            signal,
            checkpoint,
          ),
      );
      validateEmbeddings(result, pending.length, this.embeddings.dimensions);
      // Controlled adapters may not expose physical batches; their completed result still checkpoints.
      const unsaved = pending
        .map((_, index) => index)
        .filter((index) => !vectors.has(pending[index]!.key));
      if (unsaved.length)
        await checkpoint(
          unsaved,
          unsaved.map((index) => result[index]!),
        );
    }
    return keyed.map((input) => vectors.get(input.key)!);
  }
}
