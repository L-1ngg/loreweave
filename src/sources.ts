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
export class SourceService {
  private readonly operations: Operations;
  constructor(
    url: string,
    private readonly access: AccessService,
    private readonly embeddings: EmbeddingAdapter,
  ) {
    this.operations = new Operations(url);
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
    await tx`INSERT INTO source_versions(id,document_id,operation_id,expected_prior,filename,original) VALUES(${versionId},${documentId},${operationId},${input.expectedPrior ?? null},${input.filename},${Buffer.from(input.bytes)})`;
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
  private async outcomes(
    rows: Record<string, unknown>[],
  ): Promise<SourceOperation[]> {
    if (!rows.length) return [];
    const jobs = await this.operations
      .sql`SELECT id,operation_id,kind,state,reason FROM knowledge_jobs WHERE operation_id IN ${this.operations.sql(rows.map((row) => String(row.operation_id)))} AND kind<>'source.prepare' ORDER BY kind`;
    return rows.map((row) => ({
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
  async workOne(): Promise<boolean> {
    const job = await this.operations.claim(["source.prepare"]);
    if (!job) return false;
    try {
      if (job.attempt > 3) throw new Error("preparation_attempts_exhausted");
      const [version] = await this.operations
        .sql`SELECT * FROM source_versions WHERE id=${String(job.payload.versionId)}`;
      if (!version) throw new Error("not_found");
      const parsed = parseMarkdown(version.original);
      const records = parsed.passages.flatMap((passage) => {
        // Chunk the derived index only; stable original block locators remain whole.
        const points = Array.from(passage.text),
          chunks = [];
        for (let offset = 0; offset < points.length; offset += 2000)
          chunks.push({
            passage,
            ordinal: chunks.length,
            text: points.slice(offset, offset + 2000).join(""),
          });
        return chunks;
      });
      const signal = AbortSignal.timeout(45000);
      const vectors: number[][] = [];
      for (let index = 0; index < records.length; index += 32) {
        const batch = records.slice(index, index + 32);
        const embedded = await this.embeddings.embed(
          batch.map((record) => record.text),
          signal,
        );
        validateEmbeddings(embedded, batch.length, this.embeddings.dimensions);
        vectors.push(...embedded);
      }
      signal.throwIfAborted();
      await this.operations.commit(job, async (tx) => {
        const [document] =
          await tx`SELECT active_version_id FROM source_documents WHERE id=${String(version.document_id)} FOR UPDATE`;
        if (!document || document.active_version_id !== version.expected_prior)
          throw new Error("version_conflict");
        const passageIds = new Map<number, string>();
        for (const passage of parsed.passages) {
          const id = crypto.randomUUID();
          passageIds.set(passage.ordinal, id);
          await tx`INSERT INTO source_passages(id,version_id,ordinal,kind,heading_path,start_offset,end_offset,original_text) VALUES(${id},${String(version.id)},${passage.ordinal},${passage.kind},${tx.json(passage.headingPath)},${passage.start},${passage.end},${passage.text})`;
        }
        for (const [index, record] of records.entries())
          await tx`INSERT INTO source_search_records(id,passage_id,ordinal,chunk_text,lexical_text,embedding) VALUES(${crypto.randomUUID()},${passageIds.get(record.passage.ordinal)!},${record.ordinal},${record.text},${lexicalText(record.text)},${JSON.stringify(vectors[index])}::vector)`;
        await tx`UPDATE source_versions SET state='superseded' WHERE id=${version.expected_prior}`;
        await tx`UPDATE source_versions SET decoded=${parsed.decoded},parser_profile=${parserProfile},embedding_profile=${this.embeddings.profile},dimensions=${this.embeddings.dimensions},state='active' WHERE id=${String(version.id)}`;
        await tx`UPDATE source_documents SET active_version_id=${String(version.id)} WHERE id=${String(version.document_id)}`;
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
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unavailable";
      if (reason === "stale_worker") return true;
      const safe = [
        "invalid_encoding",
        "invalid_markdown",
        "invalid_embedding",
        "version_conflict",
        "preparation_attempts_exhausted",
      ].includes(reason)
        ? reason
        : "unavailable";
      await this.operations.commit(
        job,
        async (tx) => {
          await tx`UPDATE source_versions SET state='failed',reason=${safe} WHERE id=${String(job.payload.versionId)} AND state='preparing'`;
          await tx`UPDATE knowledge_jobs SET reason=${safe} WHERE id=${job.id}`;
        },
        "failed",
      );
    }
    return true;
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
    if (!refs.length) return new Map<string, ParsedPassage & { id: string }>();
    const query = this.operations.sql`
      SELECT p.id,p.version_id,p.kind,p.heading_path,p.start_offset,p.end_offset,p.original_text
      FROM source_passages p JOIN source_versions v ON v.id=p.version_id
      JOIN source_documents d ON d.id=v.document_id
      JOIN jsonb_to_recordset(${this.operations.sql.json(refs)}::jsonb) ref(version uuid, passage_id uuid)
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
            row.original_text === item.text &&
            Number(row.start_offset) === item.start &&
            Number(row.end_offset) === item.end &&
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
  async candidates(
    token: string,
    input: {
      question: string;
      projectId?: string;
      signal: AbortSignal;
      beforeEmbedding?: () => Promise<void>;
    },
  ): Promise<{ lexical: SourceCandidate[]; vector: SourceCandidate[] }> {
    const context = await this.access.authorize(token, "read", input.projectId);
    input.signal.throwIfAborted();
    await input.beforeEmbedding?.();
    input.signal.throwIfAborted();
    const vectors = await this.embeddings.embed([input.question], input.signal);
    validateEmbeddings(vectors, 1, this.embeddings.dimensions);
    input.signal.throwIfAborted();
    const query = lexicalText(input.question)
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `'${term.replaceAll("'", "''")}'`)
      .join(" | ");
    const base = this.operations
      .sql`SELECT d.id AS document_id,v.id AS version,p.id AS passage_id,v.filename,p.original_text,p.heading_path,p.start_offset,p.end_offset,
      r.lexical @@ to_tsquery('simple',${query}) AS lexical_match,
      ts_rank_cd(r.lexical,to_tsquery('simple',${query})) AS lexical_score,
      CASE WHEN v.embedding_profile=${this.embeddings.profile} AND v.dimensions=${this.embeddings.dimensions} THEN r.embedding <=> ${JSON.stringify(vectors[0])}::vector ELSE NULL END AS distance
      FROM source_search_records r JOIN source_passages p ON p.id=r.passage_id JOIN source_versions v ON v.id=p.version_id JOIN source_documents d ON d.active_version_id=v.id
      WHERE d.organization_id=${context.organizationId} AND (${input.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${input.projectId ?? null})`;
    const lexicalQuery = this.operations
      .sql`WITH candidates AS (${base}), passages AS (SELECT DISTINCT ON(passage_id) * FROM candidates WHERE lexical_match ORDER BY passage_id,lexical_score DESC) SELECT * FROM passages ORDER BY lexical_score DESC,passage_id LIMIT 50`;
    const vectorQuery = this.operations
      .sql`WITH candidates AS (${base}), passages AS (SELECT DISTINCT ON(passage_id) * FROM candidates WHERE distance IS NOT NULL ORDER BY passage_id,distance) SELECT * FROM passages ORDER BY distance,passage_id LIMIT 50`;
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
      };
    } finally {
      input.signal.removeEventListener("abort", cancel);
    }
  }
  async close() {
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
