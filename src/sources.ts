import { sourceChanges } from "./source-changes.ts";
import { SearchIndexes } from "./search-indexes.ts";
import {
  PreparedEmbeddings,
  preparedEmbeddingProfile,
} from "./prepared-embeddings.ts";
import { retrievalChunks } from "./retrieval-chunks.ts";
import { controlledInputCounter } from "./embedding-tokenizer.ts";
import { hash } from "./answer-validation.ts";
import { currentModelWork, withModelWork } from "./model-admission.ts";
import { graphReadiness } from "./graph-readiness.ts";
import type { Transaction } from "./operations.ts";
import { wikiReadiness } from "./wiki-readiness.ts";
import { createHash } from "node:crypto";
import { AccessService, type TrustedContext } from "./access.ts";
import { Operations } from "./operations.ts";
import {
  parseMarkdown,
  parserProfile,
  type ParsedPassage,
} from "./markdown.ts";
import { lexicalText } from "./indexing.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "./embeddings.ts";
export interface SourceCandidate {
  contextHash?: string;
  documentId: string;
  version: string;
  passageId: string;
  title: string;
  text: string;
  headingPath: string[];
  start: number;
  end: number;
}
export interface ImportInput {
  key: string;
  filename: string;
  bytes: Uint8Array;
  projectId?: string;
  documentId?: string;
  expectedPrior?: string;
}
export interface SourceOperation {
  graph: ReturnType<typeof graphReadiness>;
  wiki: ReturnType<typeof wikiReadiness>;
  id: string;
  documentId: string;
  versionId: string;
  source: "processing" | "searchable" | "failed" | "superseded";
  reason?: string;
  maintenance: Array<{
    id: string;
    kind: string;
    state: string;
    reason?: string;
  }>;
}
export interface SourceVersion {
  parserProfile: string;
  embeddingProfile: string;
  attribution?: { actorId: string; projectId?: string; pageId?: string };
  projectId?: string;
  currentVersionId: string;
  id: string;
  version: string;
  title: string;
  text: string;
  state: string;
  passages: Array<ParsedPassage & { id: string }>;
}
export interface ImportLimits {
  organizationBytes: number;
  projectBytes: number;
  organizationJobs: number;
  projectJobs: number;
  organizationWork: number;
  projectWork: number;
}
export const defaultImportLimits: ImportLimits = {
  organizationBytes: 256 * 1024 * 1024,
  projectBytes: 128 * 1024 * 1024,
  organizationJobs: 2000,
  projectJobs: 1000,
  organizationWork: 524288,
  projectWork: 262144,
};
export const defaultPreparationDeadlineMs = 30 * 60 * 1000;
export const maxPreparationDeadlineMs = 24 * 60 * 60 * 1000;
export class SourceService {
  readonly indexes: SearchIndexes;
  private readonly operations: Operations;
  constructor(
    url: string,
    private readonly access: AccessService,
    private readonly embeddings: EmbeddingAdapter,
    private readonly limits: ImportLimits = defaultImportLimits,
    private readonly preparationDeadlineMs = defaultPreparationDeadlineMs,
  ) {
    if (
      Object.values(limits).some(
        (limit) => !Number.isSafeInteger(limit) || limit < 1,
      )
    )
      throw new Error("invalid_import_limits");
    if (
      !Number.isSafeInteger(preparationDeadlineMs) ||
      preparationDeadlineMs < 1 ||
      preparationDeadlineMs > maxPreparationDeadlineMs
    )
      throw new Error("invalid_preparation_deadline");
    this.operations = new Operations(url);
    this.indexes = new SearchIndexes(url, access, embeddings);
  }
  async submitBatch(
    token: string,
    input: {
      key: string;
      entries: Array<{ attachmentId: string; projectId?: string }>;
    },
  ) {
    const context = await this.access.authorize(token, "import");
    if (
      !input.key ||
      input.key.length > 200 ||
      !input.entries.length ||
      input.entries.length > 20
    )
      throw new Error("invalid_input");
    const inputHash = hash(input.entries);
    const id = await this.operations.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`import-batch:${context.organizationId}:${context.actorId}:${input.key}`},0))`;
      const [existing] =
        await tx`SELECT id,input_hash FROM import_manifests WHERE organization_id=${context.organizationId} AND actor_id=${context.actorId} AND manifest_key=${input.key}`;
      if (existing) {
        if (existing.input_hash !== inputHash)
          throw new Error("version_conflict");
        return String(existing.id);
      }
      const id = crypto.randomUUID();
      await tx`INSERT INTO import_manifests(id,organization_id,actor_id,manifest_key,input_hash,entries) VALUES(${id},${context.organizationId},${context.actorId},${input.key},${inputHash},${tx.json(input.entries)})`;
      return id;
    });
    // Each source has its own transaction/receipt. A crash can be retried by this manifest key.
    for (const [index, entry] of input.entries.entries()) {
      try {
        await this.importAttachment(
          token,
          entry.attachmentId,
          `batch:${id}:${index}`,
          entry.projectId,
        );
        await this.operations
          .sql`UPDATE import_manifests SET errors=errors-${String(index)} WHERE id=${id}`;
      } catch (error) {
        const reason =
          error instanceof Error &&
          [
            "invalid_input",
            "not_found",
            "unauthorized",
            "version_conflict",
            "import_overloaded",
          ].includes(error.message)
            ? error.message
            : "unavailable";
        await this.operations
          .sql`UPDATE import_manifests SET errors=jsonb_set(errors,ARRAY[${String(index)}],${this.operations.sql.json({ reason, retryable: ["import_overloaded", "unavailable"].includes(reason) })}::jsonb) WHERE id=${id}`;
      }
    }
    return this.batch(token, id);
  }
  async batch(token: string, id: string) {
    const context = await this.access.authorize(token, "read");
    const [manifest] = await this.operations
      .sql`SELECT * FROM import_manifests WHERE id=${id} AND organization_id=${context.organizationId} AND actor_id=${context.actorId}`;
    if (!manifest) throw new Error("not_found");
    const entries = [];
    for (const [index, entry] of (
      manifest.entries as Array<{ attachmentId: string; projectId?: string }>
    ).entries()) {
      const receipt = await this.operationByKey(token, `batch:${id}:${index}`);
      entries.push({
        ...entry,
        index,
        ...(receipt
          ? { operation: await this.inspect(token, receipt.id) }
          : {
              status: manifest.errors[String(index)]
                ? "rejected"
                : "unsubmitted",
              error: manifest.errors[String(index)] ?? null,
            }),
      });
    }
    return {
      id,
      createdAt: new Date(manifest.created_at).toISOString(),
      entries,
    };
  }

  async upload(
    token: string,
    input: { filename: string; bytes: Uint8Array; projectId?: string },
  ): Promise<{ id: string; filename: string }> {
    const context = await this.access.authorize(
      token,
      "import",
      input.projectId,
    );
    if (
      !/\.md$/i.test(input.filename) ||
      input.filename.length > 255 ||
      !input.bytes.length ||
      input.bytes.length > 1024 * 1024
    )
      throw new Error("invalid_input");
    const id = crypto.randomUUID();
    await this.operations
      .sql`INSERT INTO source_attachments(id,organization_id,actor_id,project_id,filename,original) VALUES(${id},${context.organizationId},${context.actorId},${input.projectId ?? null},${input.filename},${Buffer.from(input.bytes)})`;
    return { id, filename: input.filename };
  }
  async attachment(token: string, id: string, projectId?: string) {
    const context = await this.access.authorize(token, "import", projectId);
    const [row] = await this.operations
      .sql`SELECT filename,original FROM source_attachments WHERE id=${id} AND organization_id=${context.organizationId} AND actor_id=${context.actorId} AND project_id IS NOT DISTINCT FROM ${projectId ?? null}::uuid`;
    if (!row) throw new Error("not_found");
    return {
      id,
      filename: String(row.filename),
      bytes: new Uint8Array(row.original),
    };
  }
  async importAttachment(
    token: string,
    id: string,
    key: string,
    projectId?: string,
    target?: { documentId: string; expectedPrior: string },
  ) {
    const attachment = await this.attachment(token, id, projectId);
    return this.submit(token, {
      ...attachment,
      ...target,
      key,
      ...(projectId ? { projectId } : {}),
    });
  }
  /** The host resolves target scope from a selected database document, not model authority. */
  async updateAttachment(
    token: string,
    input: {
      attachmentId: string;
      attachmentProjectId?: string | undefined;
      projectId?: string | undefined;
      documentId: string;
      expectedPrior: string;
      key: string;
    },
  ) {
    const attachment = await this.attachment(
      token,
      input.attachmentId,
      input.attachmentProjectId,
    );
    return this.submit(token, {
      ...attachment,
      key: input.key,
      documentId: input.documentId,
      expectedPrior: input.expectedPrior,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
  }
  async submit(token: string, input: ImportInput): Promise<SourceOperation> {
    const context = await this.access.authorize(
      token,
      "import",
      input.projectId,
    );
    if (
      !/\.md$/i.test(input.filename) ||
      input.filename.length > 255 ||
      !input.bytes.length ||
      input.bytes.length > 1024 * 1024 ||
      Boolean(input.documentId) !== Boolean(input.expectedPrior)
    )
      throw new Error("invalid_input");
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          input.filename,
          input.projectId ?? null,
          input.documentId ?? null,
          input.expectedPrior ?? null,
        ]),
      )
      .update(input.bytes)
      .digest("hex");
    const id = await this.operations.accept(
      context,
      input.key,
      hash,
      (tx, operationId) => this.stageVersion(tx, context, operationId, input),
    );
    return this.inspect(token, id);
  }
  /** M05's attributed note joins its accepted intent and preparation job in one transaction. */
  async stageNote(
    tx: Transaction,
    context: TrustedContext,
    operationId: string,
    input: { text: string; pageId?: string; projectId?: string },
  ) {
    if (
      !input.text.trim() ||
      new TextEncoder().encode(input.text).length > 4000
    )
      throw new Error("invalid_input");
    await this.stageVersion(
      tx,
      context,
      operationId,
      {
        key: operationId,
        filename: "成员补充.md",
        bytes: new TextEncoder().encode(input.text),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      input.pageId ? { pageId: input.pageId } : {},
    );
  }
  private async stageVersion(
    tx: Transaction,
    context: TrustedContext,
    operationId: string,
    input: ImportInput,
    note?: { pageId?: string },
  ) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`loreweave:import:${context.organizationId}`},0))`;
    const [backlog] =
      await tx`SELECT count(*)::int AS jobs,coalesce(sum(octet_length(v.original)),0)::bigint AS bytes,
      coalesce(sum(ceil(octet_length(v.original)/512.0)),0)::bigint AS work,
      count(*) FILTER(WHERE d.project_id IS NOT DISTINCT FROM ${input.projectId ?? null}::uuid)::int AS project_jobs,
      coalesce(sum(octet_length(v.original)) FILTER(WHERE d.project_id IS NOT DISTINCT FROM ${input.projectId ?? null}::uuid),0)::bigint AS project_bytes,
      coalesce(sum(ceil(octet_length(v.original)/512.0)) FILTER(WHERE d.project_id IS NOT DISTINCT FROM ${input.projectId ?? null}::uuid),0)::bigint AS project_work
      FROM source_versions v JOIN source_documents d ON d.id=v.document_id WHERE d.organization_id=${context.organizationId} AND v.state='preparing'`;
    if (
      Number(backlog!.jobs) + 1 > this.limits.organizationJobs ||
      Number(backlog!.project_jobs) + 1 > this.limits.projectJobs ||
      Number(backlog!.bytes) + input.bytes.length >
        this.limits.organizationBytes ||
      Number(backlog!.project_bytes) + input.bytes.length >
        this.limits.projectBytes ||
      Number(backlog!.work) + Math.ceil(input.bytes.length / 512) >
        this.limits.organizationWork ||
      Number(backlog!.project_work) + Math.ceil(input.bytes.length / 512) >
        this.limits.projectWork
    )
      throw new Error("import_overloaded");
    const documentId = input.documentId ?? crypto.randomUUID(),
      versionId = crypto.randomUUID();
    if (input.documentId) {
      const [document] =
        await tx`SELECT active_version_id FROM source_documents WHERE id=${documentId} AND organization_id=${context.organizationId} AND project_id IS NOT DISTINCT FROM ${input.projectId ?? null}::uuid FOR UPDATE`;
      if (!document) throw new Error("not_found");
      if (document.active_version_id !== input.expectedPrior)
        throw new Error("version_conflict");
    } else
      await tx`INSERT INTO source_documents(id,organization_id,project_id) VALUES(${documentId},${context.organizationId},${input.projectId ?? null})`;
    await tx`INSERT INTO source_versions(id,document_id,operation_id,expected_prior,filename,original,preparation_deadline) VALUES(${versionId},${documentId},${operationId},${input.expectedPrior ?? null},${input.filename},${Buffer.from(input.bytes)},clock_timestamp()+${this.preparationDeadlineMs}*interval '1 millisecond')`;
    if (note) {
      if (note.pageId) {
        const [page] =
          await tx`SELECT id FROM wiki_pages WHERE id=${note.pageId} AND organization_id=${context.organizationId} AND project_id IS NOT DISTINCT FROM ${input.projectId ?? null}::uuid FOR SHARE`;
        if (!page) throw new Error("not_found");
      }
      await tx`INSERT INTO source_notes(version_id,actor_id,project_id,page_id) VALUES(${versionId},${context.actorId},${input.projectId ?? null},${note.pageId ?? null})`;
    }
    await this.operations.enqueue(tx, operationId, "source.prepare", {
      versionId,
    });
  }
  async operationByKey(token: string, key: string) {
    const context = await this.access.authorize(token, "read");
    const [row] = await this.operations
      .sql`SELECT id FROM knowledge_operations WHERE organization_id=${context.organizationId} AND actor_id=${context.actorId} AND operation_key=${key}`;
    return row ? { id: String(row.id) } : undefined;
  }
  async targets(
    token: string,
    input: {
      projectId?: string | undefined;
      title?: string | undefined;
      version?: string | undefined;
    },
  ) {
    const context = await this.access.authorize(token, "read", input.projectId);
    const rows = await this.operations
      .sql`SELECT d.id,d.active_version_id,d.project_id,v.filename,p.name AS project FROM source_documents d JOIN source_versions v ON v.id=d.active_version_id LEFT JOIN projects p ON p.id=d.project_id WHERE d.organization_id=${context.organizationId} AND (${input.projectId ?? null}::uuid IS NULL OR d.project_id=${input.projectId ?? null}) AND (${input.title ?? null}::text IS NULL OR v.filename=${input.title ?? null}) AND (${input.version ?? null}::uuid IS NULL OR d.id IN (SELECT document_id FROM source_versions WHERE id=${input.version ?? null})) ORDER BY d.id LIMIT 21`;
    return rows.map((row) => ({
      documentId: String(row.id),
      versionId: String(row.active_version_id),
      title: String(row.filename),
      projectId: row.project_id as string | null,
      project: row.project ? String(row.project) : "组织共享",
    }));
  }
  async inspect(token: string, id: string): Promise<SourceOperation> {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT v.id,v.operation_id,v.document_id,v.state,v.reason FROM source_versions v JOIN knowledge_operations o ON o.id=v.operation_id WHERE o.id=${id} AND o.organization_id=${context.organizationId}`;
    if (!rows.length) throw new Error("not_found");
    return (await this.outcomes(rows))[0]!;
  }
  async list(token: string, projectId?: string): Promise<SourceOperation[]> {
    const context = await this.access.authorize(token, "read", projectId);
    const rows = await this.operations
      .sql`SELECT v.id,v.operation_id,v.document_id,v.state,v.reason FROM source_versions v JOIN source_documents d ON d.id=v.document_id WHERE d.organization_id=${context.organizationId} AND (${projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${projectId ?? null}) ORDER BY v.created_at DESC LIMIT 100`;
    return this.outcomes(rows);
  }
  async inventory(token: string, after = "") {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT d.id,d.active_version_id FROM source_documents d WHERE d.organization_id=${context.organizationId} AND d.active_version_id IS NOT NULL AND d.id::text>${after} ORDER BY d.id LIMIT 101`;
    const page = rows.slice(0, 100);
    return {
      operations: page.map((row) => ({
        documentId: String(row.id),
        versionId: String(row.active_version_id),
        source: "searchable" as const,
      })),
      next: rows.length > 100 ? String(page.at(-1)!.id) : null,
    };
  }
  private async outcomes(
    rows: Record<string, unknown>[],
  ): Promise<SourceOperation[]> {
    if (!rows.length) return [];
    const jobs = await this.operations
      .sql`SELECT id,operation_id,kind,state,reason FROM knowledge_jobs WHERE operation_id IN ${this.operations.sql(rows.map((row) => String(row.operation_id)))} AND kind<>'source.prepare' ORDER BY kind`;
    return rows.map((row) => ({
      graph: graphReadiness(
        jobs
          .filter((job) => job.operation_id === row.operation_id)
          .map((job) => ({ kind: String(job.kind), state: String(job.state) })),
      ),
      wiki: wikiReadiness(
        jobs
          .filter((job) => job.operation_id === row.operation_id)
          .map((job) => ({ kind: String(job.kind), state: String(job.state) })),
      ),
      id: String(row.operation_id),
      documentId: String(row.document_id),
      versionId: String(row.id),
      source:
        row.state === "active"
          ? "searchable"
          : row.state === "failed"
            ? "failed"
            : row.state === "superseded"
              ? "superseded"
              : "processing",
      ...(row.reason ? { reason: String(row.reason) } : {}),
      maintenance: jobs
        .filter((job) => job.operation_id === row.operation_id)
        .map((job) => ({
          id: String(job.id),
          kind: String(job.kind),
          state: String(job.state),
          ...(job.reason ? { reason: String(job.reason) } : {}),
        })),
    }));
  }
  async preparation(token: string, operationId: string) {
    const context = await this.access.authorize(token, "read");
    const [row] = await this.operations
      .sql`SELECT v.state,v.preparation_deadline,p.profile,jsonb_array_length(p.manifest->'records') AS chunks,
      (SELECT count(*)::int FROM source_embedding_batches b WHERE b.version_id=v.id) AS completed_batches
      FROM source_versions v JOIN source_documents d ON d.id=v.document_id LEFT JOIN source_preparations p ON p.version_id=v.id
      WHERE v.operation_id=${operationId} AND d.organization_id=${context.organizationId}`;
    if (!row) throw new Error("not_found");
    const [changes] = await this.operations
      .sql`SELECT c.delta FROM source_changes c JOIN source_versions v ON v.id=c.version_id WHERE v.operation_id=${operationId}`;
    return {
      changes: changes?.delta ?? null,
      state: String(row.state),
      deadline: new Date(row.preparation_deadline).toISOString(),
      profile: row.profile ?? null,
      chunks: row.chunks === null ? null : Number(row.chunks),
      completedBatches: Number(row.completed_batches),
    };
  }
  async workOne(
    options: {
      leaseMs?: number;
      organizationId?: string;
      batchQuantum?: number;
    } = {},
  ): Promise<boolean> {
    return this.operations.execute(
      { kinds: ["source.prepare"], ...options },
      async (job) => {
        let preparedBatches = 0;
        const [version] = await this.operations
          .sql`SELECT * FROM source_versions WHERE id=${String(job.payload.versionId)}`;
        if (!version) throw new Error("not_found");
        const deadline = new Date(version.preparation_deadline).getTime();
        if (Date.now() >= deadline) throw new Error("preparation_deadline");
        const parsed = parseMarkdown(version.original);
        const [documentScope] = await this.operations
          .sql`SELECT organization_id,project_id FROM source_documents WHERE id=${String(version.document_id)}`;
        const partition = hash({
          organization: documentScope!.organization_id,
          project: documentScope!.project_id,
          role: "document",
        });
        const preparation = new PreparedEmbeddings(
          this.operations,
          this.embeddings,
        );
        const counter = this.embeddings.inputCounter ?? controlledInputCounter;
        const records = retrievalChunks(parsed, counter);
        const profile = preparedEmbeddingProfile(this.embeddings);
        const [priorManifest] = await this.operations
          .sql`SELECT manifest FROM source_preparations WHERE version_id=${String(version.id)}`;
        const batchSize = Number(
          priorManifest?.manifest.batchSize ?? this.embeddings.batchSize ?? 32,
        );
        if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 32)
          throw new Error("preparation_profile_changed");
        const inputHash = hash(records);
        await this.operations.checkpoint(job, async (tx) => {
          const [existing] =
            await tx`SELECT profile,input_hash FROM source_preparations WHERE version_id=${String(version.id)}`;
          if (
            existing &&
            (existing.profile !== profile || existing.input_hash !== inputHash)
          )
            throw new Error("preparation_profile_changed");
          await tx`INSERT INTO source_preparations(version_id,profile,manifest,input_hash) VALUES(${String(version.id)},${profile},${tx.json(JSON.parse(JSON.stringify({ parsed, records, batchSize })))},${inputHash}) ON CONFLICT DO NOTHING`;
        });
        const signal = this.operations.signal(
          job,
          AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        );
        for (let index = 0; index < records.length; index += batchSize) {
          signal.throwIfAborted();
          const batch = records.slice(index, index + batchSize);
          const batchHash = hash(batch.map((record) => record.text));
          const [completed] = await this.operations
            .sql`SELECT vectors,input_hash FROM source_embedding_batches WHERE version_id=${String(version.id)} AND profile=${profile} AND ordinal=${index}`;
          if (completed) {
            if (completed.input_hash !== batchHash)
              throw new Error("preparation_profile_changed");
            validateEmbeddings(
              completed.vectors,
              batch.length,
              this.embeddings.dimensions,
            );
            continue;
          }
          const embedded = await preparation.batch(
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
          validateEmbeddings(
            embedded,
            batch.length,
            this.embeddings.dimensions,
          );
          await this.operations.checkpoint(job, async (tx) => {
            await tx`INSERT INTO source_embedding_batches(version_id,profile,ordinal,input_hash,vectors) VALUES(${String(version.id)},${profile},${index},${batchHash},${tx.json(embedded)}) ON CONFLICT DO NOTHING`;
          });
          if (
            ++preparedBatches >= (options.batchQuantum ?? Infinity) &&
            index + batchSize < records.length
          ) {
            await this.operations.commit(job, async () => "queued");
            return;
          }
        }
        signal.throwIfAborted();
        await this.operations.commit(job, async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-index:${documentScope!.organization_id}`},0))`;
          await tx`INSERT INTO source_search_heads(organization_id,embedding_profile,dimensions) VALUES(${documentScope!.organization_id},${this.embeddings.profile},${this.embeddings.dimensions}) ON CONFLICT DO NOTHING`;
          const [document] =
            await tx`SELECT active_version_id FROM source_documents WHERE id=${String(version.document_id)} FOR UPDATE`;
          if (
            !document ||
            document.active_version_id !== version.expected_prior
          )
            throw new Error("version_conflict");
          const passageIds = new Map<number, string>();
          for (const passage of parsed.passages) {
            const id = crypto.randomUUID();
            passageIds.set(passage.ordinal, id);
            await tx`INSERT INTO source_passages(id,version_id,ordinal,kind,heading_path,start_offset,end_offset,original_text) VALUES(${id},${String(version.id)},${passage.ordinal},${passage.kind},${tx.json(passage.headingPath)},${passage.start},${passage.end},${passage.text})`;
          }
          const previousRows = version.expected_prior
            ? await tx`SELECT * FROM source_passages WHERE version_id=${version.expected_prior} ORDER BY ordinal`
            : [];
          const delta = sourceChanges(
            previousRows.map((row) => ({
              id: String(row.id),
              ordinal: Number(row.ordinal),
              kind: row.kind,
              headingPath: row.heading_path,
              text: String(row.original_text),
              start: Number(row.start_offset),
              end: Number(row.end_offset),
            })),
            parsed.passages.map((passage) => ({
              ...passage,
              id: passageIds.get(passage.ordinal)!,
            })),
          );
          await tx`INSERT INTO source_changes(version_id,previous_version_id,delta) VALUES(${String(version.id)},${version.expected_prior},${tx.json(delta)})`;
          for (const [index, record] of records.entries())
            for (const span of record.spans)
              await tx`INSERT INTO source_search_records(id,passage_id,ordinal,chunk_text,lexical_text,embedding,original_text,start_offset,end_offset) VALUES(${crypto.randomUUID()},${passageIds.get(span.passage.ordinal)!},${index},${record.text},${lexicalText(record.text)},(SELECT (b.vectors->${index % batchSize}::int)::text::vector FROM source_embedding_batches b WHERE b.version_id=${String(version.id)} AND b.profile=${profile} AND b.ordinal=${Math.floor(index / batchSize) * batchSize}),${span.text},${span.start},${span.end})`;
          await tx`UPDATE source_versions SET state='superseded' WHERE id=${version.expected_prior}`;
          await tx`UPDATE source_versions SET decoded=${parsed.decoded},parser_profile=${parserProfile},embedding_profile=${this.embeddings.profile},dimensions=${this.embeddings.dimensions},state='active' WHERE id=${String(version.id)}`;
          await tx`UPDATE source_documents SET active_version_id=${String(version.id)} WHERE id=${String(version.document_id)}`;
          const [indexHead] =
            await tx`SELECT h.generation_id,g.embedding_profile,g.chunk_profile FROM source_search_heads h JOIN source_search_generations g ON g.id=h.generation_id WHERE h.organization_id=${documentScope!.organization_id}`;
          if (indexHead)
            await this.operations.enqueue(tx, job.operationId, "source.index", {
              generationId: String(indexHead.generation_id),
              organizationId: String(documentScope!.organization_id),
              profile: String(indexHead.embedding_profile),
              chunk: String(indexHead.chunk_profile),
              deadline: new Date(version.preparation_deadline).getTime(),
            });
          if (version.expected_prior)
            await this.operations.enqueue(
              tx,
              job.operationId,
              "wiki.dependencies",
              {
                documentId: String(version.document_id),
                versionId: String(version.id),
              },
            );
          const [note] =
            await tx`SELECT page_id FROM source_notes WHERE version_id=${String(version.id)}`;
          if (note?.page_id)
            await this.operations.enqueue(
              tx,
              job.operationId,
              "wiki.revalidate",
              {
                documentId: String(version.document_id),
                versionId: String(version.id),
                pageId: String(note.page_id),
              },
              String(note.page_id),
            );
          for (const kind of [
            "identity.revalidate",
            "wiki.refresh",
            "graph.refresh",
          ])
            await this.operations.enqueue(tx, job.operationId, kind, {
              documentId: String(version.document_id),
              versionId: String(version.id),
              previousVersionId: version.expected_prior ?? null,
            });
        });
      },
      async (tx, job, error) => {
        const reason = error instanceof Error ? error.message : "unavailable";
        const safe = [
          "invalid_encoding",
          "invalid_markdown",
          "invalid_embedding",
          "version_conflict",
          "preparation_attempts_exhausted",
          "preparation_deadline",
          "preparation_profile_changed",
        ].includes(reason)
          ? reason
          : "unavailable";
        await tx`UPDATE source_versions SET state='failed',reason=${safe} WHERE id=${String(job.payload.versionId)} AND state='preparing'`;
        await tx`UPDATE knowledge_jobs SET reason=${safe} WHERE id=${job.id}`;
        return "failed";
      },
    );
  }
  async version(token: string, id: string): Promise<SourceVersion> {
    const context = await this.access.authorize(token, "read");
    return this.versionInOrganization(context.organizationId, id);
  }
  /** Internal worker entry: the durable operation fixes organization authority. */
  async maintenanceVersion(
    operationId: string,
    id: string,
  ): Promise<SourceVersion> {
    const [operation] = await this.operations
      .sql`SELECT organization_id FROM knowledge_operations WHERE id=${operationId}`;
    if (!operation) throw new Error("not_found");
    return this.versionInOrganization(String(operation.organization_id), id);
  }
  private async versionInOrganization(
    organizationId: string,
    id: string,
  ): Promise<SourceVersion> {
    const [row] = await this.operations
      .sql`SELECT v.*,d.project_id,d.active_version_id,n.actor_id,n.page_id AS note_page_id FROM source_versions v JOIN source_documents d ON d.id=v.document_id LEFT JOIN source_notes n ON n.version_id=v.id WHERE v.id=${id} AND d.organization_id=${organizationId} AND v.state IN ('active','superseded')`;
    if (!row) throw new Error("not_found");
    const passages = await this.operations
      .sql`SELECT * FROM source_passages WHERE version_id=${id} ORDER BY ordinal`;
    return {
      parserProfile: String(row.parser_profile),
      embeddingProfile: String(row.embedding_profile),
      id: String(row.document_id),
      currentVersionId: String(row.active_version_id),
      ...(row.actor_id
        ? {
            attribution: {
              actorId: String(row.actor_id),
              ...(row.project_id ? { projectId: String(row.project_id) } : {}),
              ...(row.note_page_id ? { pageId: String(row.note_page_id) } : {}),
            },
          }
        : {}),
      ...(row.project_id ? { projectId: String(row.project_id) } : {}),
      version: id,
      title: String(row.filename),
      text: String(row.decoded),
      state: String(row.state),
      passages: passages.map((p) => ({
        id: String(p.id),
        ordinal: Number(p.ordinal),
        kind: p.kind as ParsedPassage["kind"],
        headingPath: p.heading_path,
        start: Number(p.start_offset),
        end: Number(p.end_offset),
        text: String(p.original_text),
      })),
    };
  }
  async assertCurrentForPublication(
    tx: Transaction,
    organizationId: string,
    items: SourceCandidate[],
  ): Promise<void> {
    if (!items.length) throw new Error("insufficient_evidence");
    const refs = tx.json(
      items.map((item) => ({ version: item.version, passage: item.passageId })),
    );
    const rows =
      await tx`SELECT p.id,p.version_id,p.original_text,d.id AS document_id,v.filename,p.start_offset,p.end_offset,p.heading_path FROM jsonb_to_recordset(${refs}::jsonb) ref(version uuid,passage uuid) JOIN source_passages p ON p.id=ref.passage AND p.version_id=ref.version JOIN source_versions v ON v.id=p.version_id JOIN source_documents d ON d.active_version_id=v.id WHERE d.organization_id=${organizationId} FOR SHARE OF d`;
    if (
      items.some(
        (item) =>
          !rows.some(
            (row) =>
              row.id === item.passageId &&
              row.version_id === item.version &&
              row.document_id === item.documentId &&
              row.filename === item.title &&
              Number.isSafeInteger(item.start) &&
              Number.isSafeInteger(item.end) &&
              item.start >= Number(row.start_offset) &&
              item.end <= Number(row.end_offset) &&
              item.end > item.start &&
              String(row.original_text).slice(
                item.start - Number(row.start_offset),
                item.end - Number(row.start_offset),
              ) === item.text &&
              JSON.stringify(row.heading_path) ===
                JSON.stringify(item.headingPath),
          ),
      )
    )
      throw new Error("source_changed");
  }
  async original(token: string, id: string): Promise<Uint8Array> {
    await this.version(token, id);
    const [row] = await this.operations
      .sql`SELECT original FROM source_versions WHERE id=${id}`;
    return new Uint8Array(row!.original);
  }
  async resolveCurrent(
    token: string,
    input: {
      references: Array<{ version: string; passageId: string }>;
      signal: AbortSignal;
      projectId?: string;
    },
  ): Promise<SourceCandidate[]> {
    const context = await this.access.authorize(token, "read", input.projectId);
    if (input.references.length > 50) throw new Error("invalid_input");
    if (!input.references.length) return [];
    const sql = this.operations.sql;
    const refs = sql.json(
      input.references.map((ref, index) => ({
        version: ref.version,
        passage: ref.passageId,
        rank: index,
      })),
    );
    const query = sql`SELECT p.id,p.version_id,p.original_text,p.heading_path,p.start_offset,p.end_offset,d.id AS document_id,v.filename FROM jsonb_to_recordset(${refs}::jsonb) ref(version uuid,passage uuid,rank integer) JOIN source_passages p ON p.id=ref.passage AND p.version_id=ref.version JOIN source_documents d ON d.active_version_id=p.version_id JOIN source_versions v ON v.id=p.version_id WHERE d.organization_id=${context.organizationId} AND (${input.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${input.projectId ?? null}) ORDER BY ref.rank`;
    const cancel = () => query.cancel();
    input.signal.addEventListener("abort", cancel, { once: true });
    try {
      input.signal.throwIfAborted();
      const rows = await query;
      input.signal.throwIfAborted();
      return rows.map((row) => ({
        documentId: String(row.document_id),
        version: String(row.version_id),
        passageId: String(row.id),
        title: String(row.filename),
        text: String(row.original_text),
        headingPath: row.heading_path as string[],
        start: Number(row.start_offset),
        end: Number(row.end_offset),
      }));
    } finally {
      input.signal.removeEventListener("abort", cancel);
    }
  }
  async resolve(token: string, version: string, passageId: string) {
    const source = await this.version(token, version),
      passage = source.passages.find((p) => p.id === passageId);
    if (!passage) throw new Error("not_found");
    return passage;
  }
  async resolveMany(
    token: string,
    refs: Array<{ version: string; passageId: string }>,
    signal?: AbortSignal,
  ) {
    const context = await this.access.authorize(token, "read");
    if (!refs.length)
      return new Map<string, SourceCandidate & { id: string }>();
    const query = this.operations.sql`
      SELECT p.id,p.version_id,p.kind,p.heading_path,p.start_offset,p.end_offset,p.original_text,d.id AS document_id,v.filename
      FROM source_passages p JOIN source_versions v ON v.id=p.version_id
      JOIN source_documents d ON d.id=v.document_id
      JOIN jsonb_to_recordset(${this.operations.sql.json(refs.map((ref) => ({ version: ref.version, passage_id: ref.passageId })))}::jsonb) ref(version uuid, passage_id uuid)
        ON ref.version=p.version_id AND ref.passage_id=p.id
      WHERE d.organization_id=${context.organizationId}`;
    const cancel = () => query.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const rows = await query;
      signal?.throwIfAborted();
      return new Map(
        rows.map((row) => [
          `${row.version_id}:${row.id}`,
          {
            id: String(row.id),
            documentId: String(row.document_id),
            version: String(row.version_id),
            passageId: String(row.id),
            title: String(row.filename),
            kind: row.kind,
            headingPath: row.heading_path as string[],
            start: Number(row.start_offset),
            end: Number(row.end_offset),
            text: String(row.original_text),
          },
        ]),
      );
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  async current(token: string, versionId: string): Promise<boolean> {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT id FROM source_documents WHERE active_version_id=${versionId} AND organization_id=${context.organizationId}`;
    return rows.length > 0;
  }
  async searchRecords(token: string, projectId?: string) {
    const context = await this.access.authorize(token, "read", projectId);
    return this.operations
      .sql`SELECT r.id,r.passage_id,r.chunk_text,r.lexical_text,r.embedding::text,v.id AS version_id,d.id AS document_id FROM source_search_records r JOIN source_passages p ON p.id=r.passage_id JOIN source_versions v ON v.id=p.version_id JOIN source_documents d ON d.active_version_id=v.id WHERE d.organization_id=${context.organizationId} AND (${projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${projectId ?? null})`;
  }
  async surroundings(
    token: string,
    items: SourceCandidate[],
    signal: AbortSignal,
  ): Promise<Map<string, SourceCandidate[]>> {
    const context = await this.access.authorize(token, "read"),
      result = new Map<string, SourceCandidate[]>();
    if (!items.length) return result;
    const refs = this.operations.sql.json(
      items.map((item) => ({ version: item.version, passage: item.passageId })),
    );
    const query = this.operations
      .sql`SELECT focus.id AS focus_id,d.id AS document_id,v.id AS version,p.id AS passage_id,v.filename,p.original_text,p.heading_path,p.start_offset,p.end_offset
      FROM jsonb_to_recordset(${refs}::jsonb) AS ref(version uuid,passage uuid)
      JOIN source_passages focus ON focus.id=ref.passage AND focus.version_id=ref.version
      JOIN source_passages p ON p.version_id=focus.version_id AND (p.ordinal<3 OR p.ordinal BETWEEN focus.ordinal-1 AND focus.ordinal+1)
      JOIN source_versions v ON v.id=p.version_id JOIN source_documents d ON d.active_version_id=v.id
      WHERE d.organization_id=${context.organizationId} ORDER BY focus.id,p.ordinal`;
    const cancel = () => query.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const rows = await query;
      signal.throwIfAborted();
      for (const row of rows) {
        const id = String(row.focus_id);
        const group = result.get(id) ?? [];
        group.push(sourceCandidate(row));
        result.set(id, group);
      }
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  async validateReferences(
    token: string,
    items: SourceCandidate[],
    signal?: AbortSignal,
  ): Promise<{
    valid: boolean;
    current: boolean;
    currentPassages: string[];
    checkedAt: string;
  }> {
    const context = await this.access.authorize(token, "read");
    if (!items.length)
      return {
        valid: true,
        current: true,
        currentPassages: [],
        checkedAt: new Date().toISOString(),
      };
    const references = this.operations.sql.json(
      items.map((item) => ({ version: item.version, passage: item.passageId })),
    );
    const query = this.operations
      .sql`SELECT p.id,p.version_id,p.original_text,p.heading_path,p.start_offset,p.end_offset,v.document_id,v.filename,d.active_version_id,statement_timestamp() AS checked_at
      FROM jsonb_to_recordset(${references}::jsonb) AS ref(version uuid,passage uuid)
      JOIN source_passages p ON p.id=ref.passage AND p.version_id=ref.version
      JOIN source_versions v ON v.id=p.version_id JOIN source_documents d ON d.id=v.document_id
      WHERE d.organization_id=${context.organizationId}`;
    const cancel = () => query.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    let rows;
    try {
      signal?.throwIfAborted();
      rows = await query;
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
    const valid =
      rows.length === items.length &&
      items.every((item) =>
        rows.some(
          (row) =>
            row.id === item.passageId &&
            row.version_id === item.version &&
            row.document_id === item.documentId &&
            row.filename === item.title &&
            Number.isSafeInteger(item.start) &&
            Number.isSafeInteger(item.end) &&
            item.start >= Number(row.start_offset) &&
            item.end <= Number(row.end_offset) &&
            item.end > item.start &&
            String(row.original_text).slice(
              item.start - Number(row.start_offset),
              item.end - Number(row.start_offset),
            ) === item.text &&
            JSON.stringify(row.heading_path) ===
              JSON.stringify(item.headingPath),
        ),
      );
    return {
      valid,
      currentPassages: valid
        ? rows
            .filter((row) => row.active_version_id === row.version_id)
            .map((row) => String(row.id))
        : [],
      current:
        valid && rows.every((row) => row.active_version_id === row.version_id),
      checkedAt:
        rows[0]?.checked_at instanceof Date
          ? rows[0].checked_at.toISOString()
          : new Date().toISOString(),
    };
  }
  async retrievalSnapshot(token: string, projectId?: string): Promise<string> {
    const context = await this.access.authorize(token, "read", projectId);
    const sql = this.operations.sql;
    const [row] = await sql`SELECT
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text,'')) FROM source_documents d WHERE d.organization_id=${context.organizationId}) AS sources,
      (SELECT md5(coalesce(jsonb_agg(jsonb_build_array(m.id,m.current_revision_id) ORDER BY m.id)::text,'')) FROM identity_mentions m WHERE m.organization_id=${context.organizationId}) AS identities,
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'')) FROM wiki_pages p WHERE p.organization_id=${context.organizationId}) AS wiki,
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id)::text,'')) FROM graph_generations g WHERE g.organization_id=${context.organizationId}) AS graph,
      (SELECT to_jsonb(h) FROM source_search_heads h WHERE h.organization_id=${context.organizationId}) AS search`;
    return JSON.stringify({
      actor: context.actorId,
      organization: context.organizationId,
      scope: context.scope,
      profile: this.embeddings.profile,
      dimensions: this.embeddings.dimensions,
      ...row,
    });
  }

  async candidates(
    token: string,
    input: {
      question: string;
      projectId?: string;
      signal: AbortSignal;
      beforeEmbedding?: () => Promise<void>;
    },
  ): Promise<{
    lexical: SourceCandidate[];
    vector: SourceCandidate[];
    degradation?: string;
  }> {
    const context = await this.access.authorize(token, "read", input.projectId);
    input.signal.throwIfAborted();
    const counter = this.embeddings.inputCounter ?? controlledInputCounter;
    if (counter.count(input.question) > counter.maxInput)
      throw new Error("embedding_input_limit");
    const [head] = await this.operations
      .sql`SELECT * FROM source_search_heads WHERE organization_id=${context.organizationId}`;
    const [coverage] = await this.operations
      .sql`SELECT count(*)::int AS missing FROM source_documents d JOIN source_versions v ON v.id=d.active_version_id WHERE d.organization_id=${context.organizationId} AND (${input.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${input.projectId ?? null}) AND NOT EXISTS(SELECT 1 FROM source_search_coverage c WHERE c.generation_id=${head?.generation_id ?? null} AND c.version_id=v.id) AND (v.embedding_profile IS DISTINCT FROM ${head?.embedding_profile ?? this.embeddings.profile} OR v.dimensions IS DISTINCT FROM ${head?.dimensions ?? this.embeddings.dimensions})`;
    const compatible =
      !head ||
      (head.embedding_profile === this.embeddings.profile &&
        Number(head.dimensions) === this.embeddings.dimensions);
    if (compatible) await input.beforeEmbedding?.();
    input.signal.throwIfAborted();
    const vectors = compatible
      ? await withModelWork(
          currentModelWork() ?? {
            operationId: `query:${crypto.randomUUID()}`,
            priority: "interactive",
            deadline: Date.now() + 30000,
          },
          () => this.embeddings.embed([input.question], input.signal),
        )
      : [];
    if (compatible) validateEmbeddings(vectors, 1, this.embeddings.dimensions);
    input.signal.throwIfAborted();
    const query = lexicalText(input.question)
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `'${term.replaceAll("'", "''")}'`)
      .join(" | ");
    const base = this.operations
      .sql`SELECT d.id AS document_id,v.id AS version,p.id AS passage_id,v.filename,r.original_text,p.heading_path,r.start_offset,r.end_offset,
      r.lexical @@ to_tsquery('simple',${query}) AS lexical_match,
      ts_rank_cd(r.lexical,to_tsquery('simple',${query})) AS lexical_score,
      CASE WHEN h.embedding_profile=${this.embeddings.profile} AND h.dimensions=${this.embeddings.dimensions} AND vector_dims(r.embedding)=${this.embeddings.dimensions} AND (r.generation_id=h.generation_id OR (r.generation_id IS NULL AND v.embedding_profile=h.embedding_profile AND v.dimensions=h.dimensions)) THEN r.embedding <=> ${vectors[0] ? JSON.stringify(vectors[0]) : null}::vector ELSE NULL END AS distance
      FROM source_search_records r JOIN source_passages p ON p.id=r.passage_id JOIN source_versions v ON v.id=p.version_id JOIN source_documents d ON d.active_version_id=v.id JOIN source_search_heads h ON h.organization_id=d.organization_id
      WHERE r.generation_id IS NOT DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM source_search_coverage c WHERE c.generation_id=h.generation_id AND c.version_id=v.id) THEN h.generation_id ELSE NULL END) AND d.organization_id=${context.organizationId} AND (${input.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${input.projectId ?? null})`;
    const lexicalQuery = this.operations
      .sql`WITH candidates AS (${base}), passages AS (SELECT DISTINCT ON(passage_id,start_offset,end_offset) * FROM candidates WHERE lexical_match ORDER BY passage_id,start_offset,end_offset,lexical_score DESC) SELECT * FROM passages ORDER BY lexical_score DESC,passage_id LIMIT 50`;
    const vectorQuery = this.operations
      .sql`WITH candidates AS (${base}), passages AS (SELECT DISTINCT ON(passage_id,start_offset,end_offset) * FROM candidates WHERE distance IS NOT NULL ORDER BY passage_id,start_offset,end_offset,distance) SELECT * FROM passages ORDER BY distance,passage_id LIMIT 50`;
    const cancel = () => {
      lexicalQuery.cancel();
      vectorQuery.cancel();
    };
    input.signal.addEventListener("abort", cancel, { once: true });
    try {
      input.signal.throwIfAborted();
      const results = await Promise.allSettled([lexicalQuery, vectorQuery]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      const lexical = results[0].status === "fulfilled" ? results[0].value : [],
        vector = results[1].status === "fulfilled" ? results[1].value : [];
      input.signal.throwIfAborted();

      return {
        lexical: lexical.map(sourceCandidate),
        vector: vector.map(sourceCandidate),
        ...(!compatible
          ? { degradation: "lexical_only:profile_unavailable" }
          : Number(coverage!.missing)
            ? { degradation: "partial_lexical_only:index_pending" }
            : {}),
      };
    } finally {
      input.signal.removeEventListener("abort", cancel);
    }
  }
  async close() {
    await this.indexes.close();
    await this.operations.close();
  }
}

const sourceCandidate = (row: Record<string, unknown>): SourceCandidate => ({
  documentId: String(row.document_id),
  version: String(row.version),
  passageId: String(row.passage_id),
  title: String(row.filename),
  text: String(row.original_text),
  headingPath: row.heading_path as string[],
  start: Number(row.start_offset),
  end: Number(row.end_offset),
});
