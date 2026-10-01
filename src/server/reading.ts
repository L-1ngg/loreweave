import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { Actor } from "./access";
import type { Pin, Scope } from "../contracts/knowledge";
import { database } from "./database";
import {
  indexRevisions,
  sourceVersions,
  documents,
  sourceReferences,
  knowledgeRuns,
} from "./schema";
import {
  listLibrary,
  ownedDocument,
  resolveVersion,
  readStoredPage,
  hashData,
  originalPath,
} from "./library";
import { libraryInput } from "../contracts/documents";
import { AppError, fail } from "./errors";

export const documentReadInput = z
  .object({
    documentId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
  })
  .strict();
export const structureInput = documentReadInput
  .extend({
    indexId: z.string().uuid().optional(),
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const pagesReadInput = documentReadInput
  .extend({
    pages: z.array(z.number().int().min(1)).min(1).max(8),
    offset: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .default(0)
      .describe(
        "Character offset in the first requested page; later pages start at zero.",
      ),
  })
  .strict();
export type ReadingContext = {
  actor: Actor;
  scope?: Scope;
  pins?: Record<string, Pin>;
  structureRead?: Set<string>;
  check?: () => void | Promise<void>;
  onPin?: (documentId: string, pin: Pin) => Promise<void>;
  onPage?: (
    documentId: string,
    versionId: string,
    page: number,
    start: number,
    end: number,
    text: string,
  ) => Promise<string>;
};
export async function bindDocument(
  ctx: ReadingContext,
  input: z.infer<typeof documentReadInput>,
) {
  await ctx.check?.();
  if (
    ctx.scope?.mode === "selected" &&
    !ctx.scope.documentIds.includes(input.documentId)
  )
    fail("document_out_of_scope", 403);
  const document = await ownedDocument(ctx.actor, input.documentId);
  if (
    ctx.scope &&
    (document.retiredAt ||
      !document.effectiveVersion ||
      !document.effectiveIndex)
  )
    fail("document_unavailable", 409);
  let pin = ctx.pins?.[input.documentId];
  if (pin && input.versionId && input.versionId !== pin.versionId)
    fail("run_version_mismatch", 409);
  const versionId =
    pin?.versionId ?? input.versionId ?? document.effectiveVersion;
  if (!versionId) fail("document_not_ready", 409);
  if (
    ctx.scope &&
    input.versionId &&
    !pin &&
    input.versionId !== document.effectiveVersion
  )
    fail("historical_version_not_eligible", 409);
  const resolved = await resolveVersion(ctx.actor, versionId);
  if (resolved.document.id !== input.documentId)
    fail("document_version_mismatch", 404);
  const [index] = await database()
    .db.select()
    .from(indexRevisions)
    .where(
      and(
        eq(indexRevisions.versionId, versionId),
        pin
          ? eq(indexRevisions.id, pin.indexId)
          : versionId === document.effectiveVersion
            ? eq(indexRevisions.id, document.effectiveIndex!)
            : undefined,
      ),
    )
    .orderBy(desc(indexRevisions.createdAt))
    .limit(1);
  if (!index || !resolved.version.pageCount) fail("document_not_ready", 409);
  pin ??= {
    versionId,
    indexId: index.id,
    pageCount: resolved.version.pageCount,
  };
  if (ctx.pins && !ctx.pins[input.documentId]) {
    ctx.pins[input.documentId] = pin;
    await ctx.onPin?.(input.documentId, pin);
  }
  return { document, version: resolved.version, index, pin };
}
export async function browseDocuments(ctx: ReadingContext, input: unknown) {
  await ctx.check?.();
  return listLibrary(
    ctx.actor,
    input,
    ctx.scope?.mode === "selected" ? ctx.scope.documentIds : undefined,
  );
}
export async function getDocument(ctx: ReadingContext, input: unknown) {
  const value = documentReadInput.parse(input);
  const { document, version, index } = await bindDocument(ctx, value);
  return {
    documentId: document.id,
    name: document.name,
    description: document.description,
    versionId: version.id,
    indexId: index.id,
    pageCount: version.pageCount!,
    mode: index.mode,
    retired: !!document.retiredAt,
    provenance: index.provenance,
  };
}
export async function getStructure(ctx: ReadingContext, input: unknown) {
  const value = structureInput.parse(input);
  const { document, pin, index } = await bindDocument(ctx, value);
  if (value.indexId && value.indexId !== index.id)
    fail("index_version_mismatch", 404);
  const offset = Number(value.cursor ?? 0);
  if (offset > index.tree.length) fail("cursor_invalid");
  const nodes: typeof index.tree = [];
  let chars = 0;
  for (const n of index.tree.slice(offset, offset + value.limit)) {
    const len = JSON.stringify(n).length;
    if (chars + len > 12000) break;
    nodes.push(n);
    chars += len;
  }
  ctx.structureRead?.add(document.id);
  return {
    documentId: document.id,
    ...pin,
    nodes,
    nextCursor:
      offset + nodes.length < index.tree.length
        ? String(offset + nodes.length)
        : null,
    complete: offset + nodes.length >= index.tree.length,
    totalNodes: index.tree.length,
  };
}
export async function getPages(ctx: ReadingContext, input: unknown) {
  const value = pagesReadInput.parse(input);
  const { document, pin } = await bindDocument(ctx, value);
  if (ctx.scope && pin.pageCount > 20 && !ctx.structureRead?.has(document.id))
    fail("structure_required_for_long_document", 409);
  const pages: Array<{
    page: number;
    label: string | null;
    text: string;
    referenceId: string | null;
    offset: number;
    complete: boolean;
  }> = [];
  let remaining = 18000,
    next: { pages: number[]; offset: number } | null = null;
  for (let i = 0; i < value.pages.length; i++) {
    await ctx.check?.();
    const page = value.pages[i];
    const stored = await readStoredPage(ctx.actor, pin.versionId, page);
    const start = i === 0 ? value.offset : 0;
    if (start > stored.page.text.length) fail("page_offset_out_of_bounds");
    const text = stored.page.text.slice(start, start + remaining);
    const end = start + text.length;
    const id =
      (await ctx.onPage?.(
        document.id,
        pin.versionId,
        page,
        start,
        end,
        text,
      )) ?? null;
    pages.push({
      page,
      label: stored.page.label,
      text,
      referenceId: id,
      offset: start,
      complete: end === stored.page.text.length,
    });
    remaining -= text.length;
    if (end < stored.page.text.length) {
      next = { pages: value.pages.slice(i), offset: end };
      break;
    }
    if (remaining <= 0 && i < value.pages.length - 1) {
      next = { pages: value.pages.slice(i + 1), offset: 0 };
      break;
    }
  }
  return {
    documentId: document.id,
    name: document.name,
    ...pin,
    pages,
    complete: !next,
    next,
  };
}
export const readingDefinitions = {
  browse: toolDefinition({
    name: "browse_documents",
    metadata: { annotations: { readOnlyHint: true, destructiveHint: false } },
    description:
      "Discover current authorized library metadata. Paginate with nextCursor; metadata is navigation, not fact evidence.",
    inputSchema: libraryInput,
  }),
  document: toolDefinition({
    name: "get_document",
    metadata: { annotations: { readOnlyHint: true, destructiveHint: false } },
    description:
      "Bind an eligible document and inspect immutable version, page count and index provenance. Inspect this before reading pages.",
    inputSchema: documentReadInput,
  }),
  structure: toolDefinition({
    name: "get_document_structure",
    metadata: { annotations: { readOnlyHint: true, destructiveHint: false } },
    description:
      "Read a bounded tree/summary page for navigation. For documents over 20 physical pages, inspect the tree before original pages. Summaries are not factual evidence.",
    inputSchema: structureInput,
  }),
  pages: toolDefinition({
    name: "get_page_content",
    metadata: { annotations: { readOnlyHint: true, destructiveHint: false } },
    description:
      "Read stored ORIGINAL physical pages (1-based), at most 8 per call. Each actual read returns a referenceId; cite it as [Document name · pN](cite:referenceId). If complete is false, pass next.pages and next.offset to continue all unfinished pages; offset applies only to the first requested page. Preserve qualifications. These originals, not summaries/history, support claims.",
    inputSchema: pagesReadInput,
  }),
};
export function readingTools(ctx: ReadingContext) {
  return [
    readingDefinitions.browse.server((input) => browseDocuments(ctx, input)),
    readingDefinitions.document.server((input) => getDocument(ctx, input)),
    readingDefinitions.structure.server((input) => getStructure(ctx, input)),
    readingDefinitions.pages.server((input) => getPages(ctx, input)),
  ];
}
export async function resolveReference(actor: Actor, id: string) {
  const [r] = await database()
    .db.select()
    .from(sourceReferences)
    .where(eq(sourceReferences.id, id));
  if (!r) fail("reference_not_found", 404);
  const [run] = await database()
    .db.select()
    .from(knowledgeRuns)
    .where(
      and(
        eq(knowledgeRuns.id, r.runId),
        eq(knowledgeRuns.ownerId, actor.ownerId),
      ),
    );
  if (!run) fail("reference_not_found", 404);
  const { document, version } = await resolveVersion(actor, r.versionId);
  const pin = run.pins[r.documentId];
  if (
    document.id !== r.documentId ||
    !pin ||
    pin.versionId !== version.id ||
    r.physicalPage < 1 ||
    r.physicalPage > (version.pageCount ?? 0) ||
    (run.scope.mode === "selected" &&
      !run.scope.documentIds.includes(document.id))
  )
    fail("reference_binding_invalid", 409);
  const content = await readStoredPage(actor, version.id, r.physicalPage);
  const original = Bun.file(originalPath(version.id));
  if (!(await original.exists()) || original.size !== version.byteLength)
    fail("reference_original_unavailable", 409);
  if (
    hashData(content.page.text.slice(r.startOffset, r.endOffset)) !==
    r.contentDigest
  )
    fail("reference_content_unavailable", 409);
  return {
    id: r.id,
    runId: run.id,
    documentId: document.id,
    documentName: document.name,
    versionId: version.id,
    page: r.physicalPage,
    label: content.page.label,
  };
}

export async function inspectReferences(actor: Actor, ids: string[]) {
  const references: Awaited<ReturnType<typeof resolveReference>>[] = [];
  const referenceIssues: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      references.push(await resolveReference(actor, id));
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        ![
          "reference_original_unavailable",
          "reference_content_unavailable",
          "page_unavailable",
        ].includes(error.code)
      )
        throw error;
      referenceIssues.push({ id, reason: error.code });
    }
  }
  return { references, referenceIssues };
}
