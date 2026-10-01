import {
  and,
  eq,
  gt,
  ilike,
  isNull,
  or,
  asc,
  desc,
  inArray,
} from "drizzle-orm";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Actor } from "./access";
import { requireManagement } from "./access";
import { configuration } from "./config";
import { database } from "./database";
import {
  documents,
  sourceVersions,
  documentPages,
  indexOperations,
  indexingAttempts,
  indexRevisions,
  owners,
  indexRetrySubmissions,
} from "./schema";
import { captureModel } from "./models";
import { fail } from "./errors";
import {
  libraryInput,
  type IndexMode,
  type Extraction,
  type TreeNode,
} from "../contracts/documents";
import { validateTree } from "./trees";
import { extractorRevision } from "./pdf-engine";

export const hashData = (value: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
export const artifactDigest = (value: unknown): string => {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, canonical(v[key])]),
          )
        : v;
  return hashData(JSON.stringify(canonical(value)));
};
export const originalPath = (versionId: string) =>
  join(configuration().artifactDirectory, `${versionId}.pdf`);
export async function acceptOriginal(
  actor: Actor,
  input: {
    submissionId: string;
    filename: string;
    bytes: Uint8Array;
    mode: IndexMode;
    targetId?: string;
    expectedRevision?: number;
  },
) {
  requireManagement(actor);
  if (!input.bytes.length || input.bytes.length > 50 * 1024 * 1024)
    fail("pdf_size_invalid", 413);
  const contentHash = hashData(input.bytes);
  const fingerprint = hashData(
    JSON.stringify({
      contentHash,
      filename: input.filename,
      mode: input.mode,
      target: input.targetId ?? null,
      expectedRevision: input.expectedRevision ?? null,
    }),
  );
  const existing = await database()
    .db.select()
    .from(indexOperations)
    .where(
      and(
        eq(indexOperations.ownerId, actor.ownerId),
        eq(indexOperations.submissionId, input.submissionId),
      ),
    );
  if (existing[0]) {
    if (existing[0].fingerprint !== fingerprint)
      fail("submission_payload_changed", 409);
    return { operation: existing[0], created: false };
  }
  const captured = await captureModel(actor, "index");
  const documentId = input.targetId ?? crypto.randomUUID(),
    versionId = crypto.randomUUID(),
    operationId = crypto.randomUUID(),
    attemptId = crypto.randomUUID();
  await mkdir(configuration().artifactDirectory, {
    recursive: true,
    mode: 0o700,
  });
  const file = await open(originalPath(versionId), "wx", 0o600);
  try {
    await file.writeFile(input.bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(configuration().artifactDirectory, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  try {
    const result = await database().db.transaction(async (tx) => {
      await tx
        .select()
        .from(owners)
        .where(eq(owners.id, actor.ownerId))
        .for("update");
      const [duplicate] = await tx
        .select()
        .from(indexOperations)
        .where(
          and(
            eq(indexOperations.ownerId, actor.ownerId),
            eq(indexOperations.submissionId, input.submissionId),
          ),
        );
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint)
          fail("submission_payload_changed", 409);
        return { operation: duplicate, created: false };
      }
      if (input.targetId) {
        const [target] = await tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.ownerId, actor.ownerId),
            ),
          )
          .for("update");
        if (!target || target.retiredAt) fail("document_unavailable", 404);
        if (target.libraryRevision !== input.expectedRevision)
          fail("document_changed", 409);
        await tx
          .update(documents)
          .set({ latestVersion: versionId, latestOperation: operationId })
          .where(eq(documents.id, documentId));
      } else
        await tx.insert(documents).values({
          id: documentId,
          ownerId: actor.ownerId,
          name: input.filename.replace(/\.pdf$/i, ""),
          latestVersion: versionId,
          latestOperation: operationId,
        });
      await tx.insert(sourceVersions).values({
        id: versionId,
        documentId,
        contentHash,
        filename: input.filename,
        byteLength: input.bytes.length,
      });
      const [operation] = await tx
        .insert(indexOperations)
        .values({
          id: operationId,
          ownerId: actor.ownerId,
          documentId,
          versionId,
          submissionId: input.submissionId,
          fingerprint,
          action: input.targetId ? "update" : "upload",
          expectedRevision: input.expectedRevision ?? 0,
          latestAttempt: attemptId,
          status: "queued",
          stage: "accepted",
        })
        .returning();
      await tx.insert(indexingAttempts).values({
        id: attemptId,
        operationId,
        mode: input.mode,
        modelConfig: captured,
        status: "queued",
        stage: "accepted",
        manifests: {},
        usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
      });
      return { operation, created: true };
    });
    if (!result.created) await unlink(originalPath(versionId));
    return result;
  } catch (error) {
    await unlink(originalPath(versionId));
    throw error;
  }
}
export async function listLibrary(
  actor: Actor,
  input: unknown = { limit: 20 },
  allowedDocumentIds?: string[],
) {
  const value = libraryInput.parse(input);
  const rows = await database()
    .db.select({
      id: documents.id,
      name: documents.name,
      description: documents.description,
      revision: documents.libraryRevision,
      versionId: documents.effectiveVersion,
      indexId: documents.effectiveIndex,
      latestVersion: documents.latestVersion,
      operationId: documents.latestOperation,
      status: indexOperations.status,
      stage: indexOperations.stage,
      reason: indexOperations.reason,
      pageCount: sourceVersions.pageCount,
      mode: indexingAttempts.mode,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .innerJoin(
      indexOperations,
      eq(documents.latestOperation, indexOperations.id),
    )
    .innerJoin(
      indexingAttempts,
      eq(indexOperations.latestAttempt, indexingAttempts.id),
    )
    .innerJoin(sourceVersions, eq(documents.latestVersion, sourceVersions.id))
    .where(
      and(
        eq(documents.ownerId, actor.ownerId),
        isNull(documents.retiredAt),
        allowedDocumentIds
          ? inArray(documents.id, allowedDocumentIds)
          : undefined,
        value.cursor ? gt(documents.id, value.cursor) : undefined,
        value.filter
          ? or(
              ilike(documents.name, `%${value.filter}%`),
              ilike(documents.description, `%${value.filter}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(documents.id))
    .limit(value.limit + 1);
  const hasMore = rows.length > value.limit;
  const items = rows
    .slice(0, value.limit)
    .map((row) => ({ ...row, ready: !!row.versionId && !!row.indexId }));
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
}
export async function ownedDocument(actor: Actor, id: string) {
  const [document] = await database()
    .db.select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, actor.ownerId)));
  if (!document) fail("document_not_found", 404);
  return document;
}
export async function retireDocument(actor: Actor, id: string) {
  requireManagement(actor);
  return database().db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.ownerId, actor.ownerId)))
      .for("update");
    if (!doc) fail("document_not_found", 404);
    if (!doc.retiredAt)
      await tx
        .update(documents)
        .set({
          retiredAt: new Date(),
          libraryRevision: doc.libraryRevision + 1,
        })
        .where(eq(documents.id, id));
    return { ok: true };
  });
}
export async function resolveVersion(
  actor: Actor,
  versionId: string,
  purpose: "inspection" | "qa" = "inspection",
) {
  const [version] = await database()
    .db.select()
    .from(sourceVersions)
    .where(eq(sourceVersions.id, versionId));
  if (!version) fail("source_not_found", 404);
  const document = await ownedDocument(actor, version.documentId);
  if (purpose === "qa" && (document.retiredAt || !document.effectiveVersion))
    fail("document_unavailable", 409);
  return { document, version };
}
export async function inspectDocument(actor: Actor, id: string) {
  const document = await ownedDocument(actor, id);
  const versions = await database()
    .db.select({
      id: sourceVersions.id,
      filename: sourceVersions.filename,
      pageCount: sourceVersions.pageCount,
      contentHash: sourceVersions.contentHash,
      createdAt: sourceVersions.createdAt,
      diagnostics: sourceVersions.extractionMeta,
    })
    .from(sourceVersions)
    .where(eq(sourceVersions.documentId, id))
    .orderBy(desc(sourceVersions.createdAt));
  const operation = await inspectOperation(actor, document.latestOperation);
  const [index] = document.effectiveIndex
    ? await database()
        .db.select()
        .from(indexRevisions)
        .where(eq(indexRevisions.id, document.effectiveIndex))
    : [];
  return {
    id: document.id,
    name: document.name,
    description: document.description,
    revision: document.libraryRevision,
    retired: !!document.retiredAt,
    versionId: document.effectiveVersion,
    indexId: document.effectiveIndex,
    versions: versions.map((v) => ({
      ...v,
      diagnostics: v.diagnostics?.diagnostics ?? [],
    })),
    operation,
    tree: index?.tree ?? operation.attempts[0]?.draftTree ?? [],
    ready: !!index,
  };
}
export async function inspectOperation(actor: Actor, id: string) {
  const [operation] = await database()
    .db.select()
    .from(indexOperations)
    .where(
      and(
        eq(indexOperations.id, id),
        eq(indexOperations.ownerId, actor.ownerId),
      ),
    );
  if (!operation) fail("operation_not_found", 404);
  const attempts = await database()
    .db.select({
      id: indexingAttempts.id,
      mode: indexingAttempts.mode,
      status: indexingAttempts.status,
      stage: indexingAttempts.stage,
      reason: indexingAttempts.reason,
      manifests: indexingAttempts.manifests,
      draftTree: indexingAttempts.draftTree,
      usage: indexingAttempts.usage,
      createdAt: indexingAttempts.createdAt,
      finishedAt: indexingAttempts.finishedAt,
    })
    .from(indexingAttempts)
    .where(eq(indexingAttempts.operationId, id))
    .orderBy(desc(indexingAttempts.createdAt));
  return {
    id: operation.id,
    documentId: operation.documentId,
    versionId: operation.versionId,
    status: operation.status,
    stage: operation.stage,
    reason: operation.reason,
    attempts,
  };
}
export async function readStoredPage(
  actor: Actor,
  versionId: string,
  page: number,
) {
  const resolved = await resolveVersion(actor, versionId);
  if (!resolved.version.pageCount) fail("pages_not_ready", 409);
  if (page < 1 || page > resolved.version.pageCount)
    fail("page_out_of_bounds", 400);
  const [record] = await database()
    .db.select()
    .from(documentPages)
    .where(
      and(
        eq(documentPages.versionId, versionId),
        eq(documentPages.physicalPage, page),
      ),
    );
  if (!record) fail("page_unavailable", 404);
  return {
    documentId: resolved.document.id,
    documentName: resolved.document.name,
    versionId,
    page: record.artifact,
  };
}
export async function storeExtraction(
  versionId: string,
  extraction: Extraction,
) {
  if (
    extraction.pageCount !== extraction.pages.length ||
    extraction.pages.some((p, i) => p.number !== i + 1)
  )
    fail("extraction_validation_failed");
  const { pages, ...meta } = extraction;
  await database().db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(sourceVersions)
      .where(eq(sourceVersions.id, versionId))
      .for("update");
    if (!version) fail("source_not_found", 404);
    if (version.extractionMeta) return;
    for (let offset = 0; offset < pages.length; offset += 50)
      await tx.insert(documentPages).values(
        pages.slice(offset, offset + 50).map((artifact) => ({
          versionId,
          physicalPage: artifact.number,
          artifact,
        })),
      );
    await tx
      .update(sourceVersions)
      .set({ pageCount: pages.length, extractionMeta: meta })
      .where(eq(sourceVersions.id, versionId));
  });
}
export async function loadExtraction(
  versionId: string,
): Promise<Extraction | null> {
  const [version] = await database()
    .db.select()
    .from(sourceVersions)
    .where(eq(sourceVersions.id, versionId));
  if (!version?.extractionMeta) return null;
  const rows = await database()
    .db.select()
    .from(documentPages)
    .where(eq(documentPages.versionId, versionId))
    .orderBy(asc(documentPages.physicalPage));
  if (rows.length !== version.pageCount) fail("extraction_manifest_invalid");
  return { ...version.extractionMeta, pages: rows.map((r) => r.artifact) };
}
export async function retryIndex(
  actor: Actor,
  input: { operationId: string; mode: IndexMode; submissionId: string },
) {
  requireManagement(actor);
  const fingerprint = artifactDigest({
    operationId: input.operationId,
    mode: input.mode,
  });
  const captured = await captureModel(actor, "index");
  return database().db.transaction(async (tx) => {
    await tx
      .select()
      .from(owners)
      .where(eq(owners.id, actor.ownerId))
      .for("update");
    const [duplicate] = await tx
      .select()
      .from(indexRetrySubmissions)
      .where(
        and(
          eq(indexRetrySubmissions.ownerId, actor.ownerId),
          eq(indexRetrySubmissions.submissionId, input.submissionId),
        ),
      );
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint)
        fail("submission_payload_changed", 409);
      return {
        attemptId: duplicate.attemptId,
        operationId: input.operationId,
        created: false,
      };
    }
    const [op] = await tx
      .select()
      .from(indexOperations)
      .where(
        and(
          eq(indexOperations.id, input.operationId),
          eq(indexOperations.ownerId, actor.ownerId),
        ),
      )
      .for("update");
    if (!op) fail("operation_not_found", 404);
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, op.documentId))
      .for("update");
    if (
      doc.retiredAt ||
      doc.latestOperation !== op.id ||
      doc.libraryRevision !== op.expectedRevision
    )
      fail("retry_obsolete", 409);
    if (!["failed", "interrupted"].includes(op.status))
      fail("retry_not_available", 409);
    const [prior] = await tx
      .select()
      .from(indexingAttempts)
      .where(eq(indexingAttempts.id, op.latestAttempt));
    const extraction = await loadExtraction(op.versionId);
    const m = prior.manifests.extraction;
    const reuse =
      extraction &&
      m?.valid &&
      m.sourceVersion === op.versionId &&
      m.compatibility === extractorRevision &&
      artifactDigest(extraction) === m.digest;
    const id = crypto.randomUUID();
    await tx.insert(indexingAttempts).values({
      id,
      operationId: op.id,
      mode: input.mode,
      modelConfig: captured,
      status: "queued",
      stage: reuse ? "accepted_reuse_extraction" : "accepted",
      manifests: reuse ? { extraction: m } : {},
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
    await tx.insert(indexRetrySubmissions).values({
      ownerId: actor.ownerId,
      submissionId: input.submissionId,
      fingerprint,
      attemptId: id,
    });
    await tx
      .update(indexOperations)
      .set({
        latestAttempt: id,
        status: "queued",
        stage: "accepted",
        reason: null,
        updatedAt: new Date(),
      })
      .where(eq(indexOperations.id, op.id));
    return { attemptId: id, operationId: op.id, created: true };
  });
}
export async function activateIndex(
  attemptId: string,
  tree: TreeNode[],
  provenance: Record<string, unknown>,
) {
  const [attempt] = await database()
    .db.select()
    .from(indexingAttempts)
    .where(eq(indexingAttempts.id, attemptId));
  if (!attempt) fail("attempt_missing", 404);
  const [operation] = await database()
    .db.select()
    .from(indexOperations)
    .where(eq(indexOperations.id, attempt.operationId));
  const extraction = await loadExtraction(operation.versionId);
  if (!extraction) fail("extraction_missing", 409);
  validateTree(tree, extraction, { summaries: true });
  const [source] = await database()
    .db.select()
    .from(sourceVersions)
    .where(eq(sourceVersions.id, operation.versionId));
  const original = new Uint8Array(
    await Bun.file(originalPath(operation.versionId)).arrayBuffer(),
  );
  if (hashData(original) !== source.contentHash)
    fail("original_integrity_failed", 409);
  for (const stage of [
    "extraction",
    "construction",
    "optimization",
    "summaries",
  ]) {
    const manifest = attempt.manifests[stage];
    if (!manifest?.valid || manifest.sourceVersion !== operation.versionId)
      fail(`required_stage_missing:${stage}`, 409);
  }
  if (
    attempt.manifests.extraction.digest !== artifactDigest(extraction) ||
    attempt.manifests.summaries.digest !== artifactDigest(tree)
  )
    fail("artifact_manifest_mismatch", 409);
  const revisionId = attemptId;
  await database().db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, operation.documentId))
      .for("update");
    const [current] = await tx
      .select()
      .from(indexOperations)
      .where(eq(indexOperations.id, operation.id))
      .for("update");
    const [currentAttempt] = await tx
      .select()
      .from(indexingAttempts)
      .where(eq(indexingAttempts.id, attemptId))
      .for("update");
    if (
      document.retiredAt ||
      document.libraryRevision !== operation.expectedRevision ||
      document.latestOperation !== operation.id ||
      current.latestAttempt !== attemptId ||
      currentAttempt.status !== "processing"
    )
      fail("publication_conflict", 409);
    if (!currentAttempt.manifests.extraction?.valid)
      fail("extraction_manifest_invalid", 409);
    await tx.insert(indexRevisions).values({
      id: revisionId,
      versionId: operation.versionId,
      attemptId,
      mode: attempt.mode,
      tree,
      provenance,
    });
    const description = (tree.find((n) => n.summary)?.summary ?? "").slice(
      0,
      500,
    );
    await tx
      .update(documents)
      .set({
        effectiveVersion: operation.versionId,
        effectiveIndex: revisionId,
        libraryRevision: document.libraryRevision + 1,
        description,
      })
      .where(eq(documents.id, document.id));
    await tx
      .update(indexingAttempts)
      .set({ status: "ready", stage: "published", finishedAt: new Date() })
      .where(eq(indexingAttempts.id, attemptId));
    await tx
      .update(indexOperations)
      .set({
        status: "ready",
        stage: "published",
        reason: null,
        updatedAt: new Date(),
      })
      .where(eq(indexOperations.id, operation.id));
  });
  return revisionId;
}
