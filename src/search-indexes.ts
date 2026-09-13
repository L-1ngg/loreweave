import { AccessService } from "./access.ts";
import { hash } from "./answer-validation.ts";
import { controlledInputCounter } from "./embedding-tokenizer.ts";
import type { EmbeddingAdapter } from "./embeddings.ts";
import { lexicalText } from "./indexing.ts";
import type { ParsedPassage } from "./markdown.ts";
import { Operations } from "./operations.ts";
import {
  PreparedEmbeddings,
  preparedEmbeddingProfile,
} from "./prepared-embeddings.ts";
import { chunkerProfile, retrievalChunks } from "./retrieval-chunks.ts";

/** Search-only generations never mutate original passages or enqueue knowledge derivation. */
export class SearchIndexes {
  private readonly operations: Operations;
  constructor(
    url: string,
    private readonly access: AccessService,
    private readonly embeddings: EmbeddingAdapter,
  ) {
    this.operations = new Operations(url);
  }
  private get profile() {
    return `${chunkerProfile}:${(this.embeddings.inputCounter ?? controlledInputCounter).profile}`;
  }
  async rebuild(token: string, key: string) {
    const context = await this.access.authorize(token, "admin");
    const id = await this.operations.accept(
      context,
      key,
      hash({
        kind: "source.reindex",
        embedding: this.embeddings.profile,
        dimensions: this.embeddings.dimensions,
        chunk: this.profile,
      }),
      async (tx, id) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-index:${context.organizationId}`},0))`;
        await tx`INSERT INTO source_search_heads(organization_id,embedding_profile,dimensions) VALUES(${context.organizationId},${this.embeddings.profile},${this.embeddings.dimensions}) ON CONFLICT DO NOTHING`;
        const [head] =
          await tx`SELECT * FROM source_search_heads WHERE organization_id=${context.organizationId}`;
        await tx`INSERT INTO source_search_generations(id,organization_id,embedding_profile,dimensions,chunk_profile,prior_generation,prior_profile,prior_dimensions) VALUES(${id},${context.organizationId},${this.embeddings.profile},${this.embeddings.dimensions},${this.profile},${head?.generation_id ?? null},${head?.embedding_profile ?? null},${head?.dimensions ?? null})`;
        await this.operations.enqueue(tx, id, "source.reindex", {
          organizationId: context.organizationId,
          profile: this.embeddings.profile,
          chunk: this.profile,
        });
      },
    );
    return this.inspect(token, id);
  }
  async inspect(token: string, id: string) {
    const context = await this.access.authorize(token, "read");
    const [row] = await this.operations
      .sql`SELECT g.*,(SELECT count(*) FROM source_search_coverage c WHERE c.generation_id=g.id) AS completed_versions FROM source_search_generations g WHERE g.id=${id} AND g.organization_id=${context.organizationId}`;
    if (!row) throw new Error("not_found");
    return {
      id: String(row.id),
      state: String(row.state),
      profile: String(row.embedding_profile),
      chunkProfile: String(row.chunk_profile),
      deadline: new Date(row.deadline).toISOString(),
      completedVersions: Number(row.completed_versions),
      reason: row.reason as string | null,
    };
  }
  async rollback(token: string, id: string) {
    const context = await this.access.authorize(token, "admin");
    await this.operations.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-index:${context.organizationId}`},0))`;
      const [g] =
        await tx`SELECT g.* FROM source_search_generations g JOIN source_search_heads h ON h.generation_id=g.id WHERE g.id=${id} AND g.organization_id=${context.organizationId} FOR UPDATE OF g,h`;
      if (!g || !g.prior_profile) throw new Error("version_conflict");
      await tx`UPDATE source_search_heads SET generation_id=${g.prior_generation},embedding_profile=${g.prior_profile},dimensions=${g.prior_dimensions} WHERE organization_id=${context.organizationId}`;
      await tx`UPDATE source_search_generations SET state='rolled_back' WHERE id=${id}`;
      if (g.prior_generation)
        await tx`UPDATE source_search_generations SET state='active' WHERE id=${g.prior_generation}`;
    });
    return this.inspect(token, id);
  }
  async workOne(options: { organizationId?: string; leaseMs?: number } = {}) {
    const sql = this.operations.sql;
    const eligible =
      await sql`SELECT id FROM knowledge_jobs WHERE kind IN ('source.reindex','source.index') AND payload->>'profile'=${this.embeddings.profile} AND payload->>'chunk'=${this.profile}`;
    return this.operations.execute(
      {
        kinds: ["source.reindex", "source.index"],
        eligibleIds: eligible.map((row) => String(row.id)),
        ...options,
      },
      async (job) => {
        const generationId = String(
          job.payload.generationId ?? job.operationId,
        );
        const [generation] =
          await sql`SELECT * FROM source_search_generations WHERE id=${generationId}`;
        if (!generation || job.attempt > 3)
          throw new Error("index_attempts_exhausted");
        const organization = String(generation.organization_id),
          deadline =
            job.kind === "source.index"
              ? Number(job.payload.deadline)
              : new Date(generation.deadline).getTime();
        if (deadline <= Date.now()) throw new Error("index_deadline");
        const signal = this.operations.signal(
          job,
          AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        );
        const prepared = new PreparedEmbeddings(
          this.operations,
          this.embeddings,
        );
        for (;;) {
          signal.throwIfAborted();
          // One source manifest at a time. Known vectors survive a crash in the exact-input cache.
          const [version] =
            await sql`SELECT v.*,d.project_id FROM source_documents d JOIN source_versions v ON v.id=d.active_version_id WHERE d.organization_id=${organization} AND NOT EXISTS(SELECT 1 FROM source_search_coverage c WHERE c.generation_id=${generationId} AND c.version_id=v.id) ORDER BY d.id LIMIT 1`;
          if (version) {
            const rows =
              await sql`SELECT * FROM source_passages WHERE version_id=${version.id} ORDER BY ordinal`;
            const passages: ParsedPassage[] = rows.map((row) => ({
              ordinal: Number(row.ordinal),
              kind: row.kind,
              headingPath: row.heading_path,
              start: Number(row.start_offset),
              end: Number(row.end_offset),
              text: String(row.original_text),
            }));
            const records = retrievalChunks(
              { decoded: String(version.decoded), passages },
              this.embeddings.inputCounter ?? controlledInputCounter,
            );
            const partition = hash({
              organization,
              project: version.project_id,
              role: "document",
            });
            const profile = preparedEmbeddingProfile(this.embeddings);
            const size = Math.min(32, this.embeddings.batchSize ?? 32);
            for (let offset = 0; offset < records.length; offset += size) {
              signal.throwIfAborted();
              const batch = records.slice(offset, offset + size);
              const vectors = await prepared.batch(
                job,
                partition,
                profile,
                batch.map((record) => ({
                  text: record.text,
                  contextHash: record.contextHash,
                })),
                deadline,
                signal,
              );
              await this.operations.checkpoint(job, async (tx) => {
                for (const [index, record] of batch.entries())
                  for (const span of record.spans) {
                    const passage = rows.find(
                      (row) => Number(row.ordinal) === span.passage.ordinal,
                    )!;
                    await tx`INSERT INTO source_search_records(id,generation_id,passage_id,ordinal,chunk_text,lexical_text,embedding,original_text,start_offset,end_offset) VALUES(${crypto.randomUUID()},${generationId},${String(passage.id)},${offset + index},${record.text},${lexicalText(record.text)},${JSON.stringify(vectors[index])}::vector,${span.text},${span.start},${span.end}) ON CONFLICT DO NOTHING`;
                  }
              });
            }
            await this.operations.checkpoint(job, async (tx) => {
              await tx`INSERT INTO source_search_coverage(generation_id,version_id,manifest_hash) VALUES(${generationId},${version.id},${hash(records)}) ON CONFLICT DO NOTHING`;
            });
            continue;
          }
          if (job.kind === "source.index") {
            await this.operations.commit(job, async () => {});
            return;
          }
          // Activation uses this same organization lock: no source can escape catch-up.
          const caughtUp = await this.operations.checkpoint(job, async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-index:${organization}`},0))`;
            const [missing] =
              await tx`SELECT d.id FROM source_documents d WHERE d.organization_id=${organization} AND d.active_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_search_coverage c WHERE c.generation_id=${generationId} AND c.version_id=d.active_version_id) LIMIT 1`;
            return !missing;
          });
          if (!caughtUp) continue;
          try {
            await this.operations.commit(job, async (tx) => {
              await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-index:${organization}`},0))`;
              const [missing] =
                await tx`SELECT d.id FROM source_documents d WHERE d.organization_id=${organization} AND d.active_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_search_coverage c WHERE c.generation_id=${generationId} AND c.version_id=d.active_version_id) LIMIT 1`;
              if (missing) throw new Error("index_catchup");
              const [head] =
                await tx`SELECT * FROM source_search_heads WHERE organization_id=${organization} FOR UPDATE`;
              if (
                (head?.generation_id ?? null) !== generation.prior_generation ||
                (head?.embedding_profile ?? null) !== generation.prior_profile
              )
                throw new Error("version_conflict");
              await tx`INSERT INTO source_search_heads(organization_id,generation_id,embedding_profile,dimensions) VALUES(${organization},${generationId},${this.embeddings.profile},${this.embeddings.dimensions}) ON CONFLICT(organization_id) DO UPDATE SET generation_id=excluded.generation_id,embedding_profile=excluded.embedding_profile,dimensions=excluded.dimensions`;
              if (generation.prior_generation)
                await tx`UPDATE source_search_generations SET state='superseded' WHERE id=${generation.prior_generation}`;
              await tx`UPDATE source_search_generations SET state='active' WHERE id=${generationId}`;
            });
            return;
          } catch (error) {
            if (!(error instanceof Error && error.message === "index_catchup"))
              throw error;
          }
        }
      },
      async (tx, job, error) => {
        const reason = error instanceof Error ? error.message : "index_failed";
        if (job.kind === "source.reindex")
          await tx`UPDATE source_search_generations SET state='failed',reason=${reason} WHERE id=${job.operationId}`;
        await tx`UPDATE knowledge_jobs SET reason=${reason} WHERE id=${job.id}`;
        return "failed";
      },
    );
  }
  async close() {
    await this.operations.close();
  }
}
