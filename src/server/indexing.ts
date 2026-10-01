import { and, eq } from "drizzle-orm";
import { database } from "./database";
import {
  indexingAttempts,
  indexOperations,
  type StageManifest,
  sourceVersions,
} from "./schema";
import { extractPdf, extractorRevision, PdfFailure } from "./pdf-engine";
import {
  originalPath,
  storeExtraction,
  artifactDigest,
  activateIndex,
  loadExtraction,
  hashData,
} from "./library";
import { buildFlash } from "./trees";
import { indexModel } from "./index-model";
import { buildStandard, standardRevision } from "./standard";
import {
  mergeSmallNodes,
  subdivideTree,
  summarizeTree,
  refinementRevision,
  refinementDefaults,
} from "./refinement";

const queue: string[] = [];
let working = false;
export function dispatchIndex(attemptId: string) {
  queue.push(attemptId);
  queueMicrotask(() => {
    void drain();
  });
}
async function drain() {
  if (working) return;
  working = true;
  try {
    while (queue.length) await executeAttempt(queue.shift()!);
  } finally {
    working = false;
  }
}
export async function progress(
  attemptId: string,
  status: "processing" | "ready" | "failed" | "unsupported" | "interrupted",
  stage: string,
  reason: string | null = null,
) {
  await database().db.transaction(async (tx) => {
    const [attempt] = await tx
      .update(indexingAttempts)
      .set({
        status,
        stage,
        reason,
        ...(["ready", "failed", "unsupported", "interrupted"].includes(status)
          ? { finishedAt: new Date() }
          : {}),
      })
      .where(eq(indexingAttempts.id, attemptId))
      .returning();
    if (attempt)
      await tx
        .update(indexOperations)
        .set({ status, stage, reason, updatedAt: new Date() })
        .where(
          and(
            eq(indexOperations.id, attempt.operationId),
            eq(indexOperations.latestAttempt, attemptId),
          ),
        );
  });
}
async function executeAttempt(attemptId: string) {
  const [attempt] = await database()
    .db.select()
    .from(indexingAttempts)
    .where(eq(indexingAttempts.id, attemptId));
  if (!attempt || attempt.status !== "queued") return;
  const [operation] = await database()
    .db.select()
    .from(indexOperations)
    .where(eq(indexOperations.id, attempt.operationId));
  const controller = new AbortController();
  const model = indexModel(attemptId, attempt.modelConfig, controller);
  const manifests: Record<string, StageManifest> = {};
  const manifest = async (
    stage: string,
    artifact: unknown,
    compatibility: string,
  ) => {
    manifests[stage] = {
      valid: true,
      sourceVersion: operation.versionId,
      extractorRevision,
      digest: artifactDigest(artifact),
      compatibility,
    };
    await database()
      .db.update(indexingAttempts)
      .set({ manifests })
      .where(eq(indexingAttempts.id, attemptId));
  };
  const timer = setTimeout(
    () => controller.abort(new Error("elapsed_budget_exceeded")),
    attempt.modelConfig.budgets.elapsedMs,
  );
  try {
    await progress(attemptId, "processing", "extraction");
    const bytes = new Uint8Array(
      await Bun.file(originalPath(operation.versionId)).arrayBuffer(),
    );
    const [source] = await database()
      .db.select()
      .from(sourceVersions)
      .where(eq(sourceVersions.id, operation.versionId));
    if (hashData(bytes) !== source.contentHash)
      throw new Error("original_integrity_failed");
    const reused =
      attempt.manifests.extraction?.valid &&
      attempt.manifests.extraction.sourceVersion === operation.versionId &&
      attempt.manifests.extraction.compatibility === extractorRevision
        ? await loadExtraction(operation.versionId)
        : null;
    if (
      reused &&
      (reused.extractorRevision !== extractorRevision ||
        artifactDigest(reused) !== attempt.manifests.extraction.digest)
    )
      throw new Error("reused_extraction_manifest_invalid");
    const extraction =
      reused ??
      (await extractPdf(bytes, {
        maxPages: attempt.modelConfig.budgets.pages,
        signal: controller.signal,
      }));
    if (extraction.pageCount > attempt.modelConfig.budgets.pages)
      throw new Error("page_budget_exceeded");
    await storeExtraction(operation.versionId, extraction);
    await manifest("extraction", extraction, extractorRevision);
    await progress(attemptId, "processing", "construction");
    const standard =
      attempt.mode === "standard"
        ? await buildStandard(extraction, model)
        : null;
    let tree = standard?.tree ?? buildFlash(extraction);
    await manifest(
      "construction",
      tree,
      `${attempt.mode}:${standardRevision}:${extractorRevision}`,
    );
    await database()
      .db.update(indexingAttempts)
      .set({ draftTree: tree })
      .where(eq(indexingAttempts.id, attemptId));
    await progress(attemptId, "processing", "optimization");
    tree = await subdivideTree(
      mergeSmallNodes(tree, extraction),
      extraction,
      model,
      attempt.modelConfig.budgets.contextChars,
    );
    await manifest(
      "optimization",
      tree,
      `${attempt.mode}:${refinementRevision}:${attempt.modelConfig.revisionId}:${attempt.modelConfig.model}`,
    );
    await progress(attemptId, "processing", "summaries");
    tree = await summarizeTree(
      tree,
      extraction,
      model,
      attempt.modelConfig.budgets.contextChars,
    );
    await manifest(
      "summaries",
      tree,
      `${refinementRevision}:${attempt.modelConfig.revisionId}:${attempt.modelConfig.model}`,
    );
    await progress(attemptId, "processing", "validation");
    model.check();
    await activateIndex(attemptId, tree, {
      mode: attempt.mode,
      reusedExtraction: !!reused,
      standard: standard
        ? {
            path: standard.path,
            repairs: standard.repairs,
            revision: standardRevision,
          }
        : null,
      extractorRevision,
      refinementRevision,
      defaults: refinementDefaults,
      model: {
        revisionId: attempt.modelConfig.revisionId,
        model: attempt.modelConfig.model,
      },
      manifests,
      usage: model.usage,
    });
  } catch (error) {
    const reason =
      error instanceof PdfFailure
        ? error.code
        : error instanceof Error
          ? error.message
          : "indexing_failed";
    const [failedAttempt] = await database()
      .db.select({ stage: indexingAttempts.stage })
      .from(indexingAttempts)
      .where(eq(indexingAttempts.id, attemptId));
    await progress(
      attemptId,
      error instanceof PdfFailure && error.unsupported
        ? "unsupported"
        : "failed",
      failedAttempt?.stage ?? "extraction",
      reason,
    );
  } finally {
    clearTimeout(timer);
  }
}
