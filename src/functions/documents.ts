import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireWeb } from "../server/access";
import {
  listLibrary,
  inspectDocument,
  inspectOperation,
  readStoredPage,
  resolveVersion,
  retryIndex,
  retireDocument,
} from "../server/library";
import { libraryInput, pageInput } from "../contracts/documents";
import { indexMode } from "../contracts/documents";
import { dispatchIndex } from "../server/indexing";
export const retireSource = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => retireDocument(await requireWeb(), data.id));
import {
  browseDocuments,
  getDocument as readDocument,
  getStructure,
  getPages,
  documentReadInput,
  structureInput,
  pagesReadInput,
} from "../server/reading";
export const browseReading = createServerFn({ method: "GET" })
  .validator(libraryInput)
  .handler(async ({ data }) =>
    browseDocuments({ actor: await requireWeb() }, data),
  );
export const readMetadata = createServerFn({ method: "GET" })
  .validator(documentReadInput)
  .handler(async ({ data }) => {
    const value = await readDocument({ actor: await requireWeb() }, data);
    return { ...value, provenance: JSON.stringify(value.provenance) };
  });
export const readStructure = createServerFn({ method: "GET" })
  .validator(structureInput)
  .handler(async ({ data }) =>
    getStructure({ actor: await requireWeb() }, data),
  );
export const readOriginalPages = createServerFn({ method: "GET" })
  .validator(pagesReadInput)
  .handler(async ({ data }) => getPages({ actor: await requireWeb() }, data));
export const retryOperation = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        operationId: z.string().uuid(),
        submissionId: z.string().uuid(),
        mode: indexMode,
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const result = await retryIndex(await requireWeb(), data);
    if (result.created) dispatchIndex(result.attemptId);
    return result;
  });
export const getLibrary = createServerFn({ method: "GET" })
  .validator(libraryInput)
  .handler(async ({ data }) => listLibrary(await requireWeb(), data));
export const getDocument = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => inspectDocument(await requireWeb(), data.id));
export const getOperation = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => inspectOperation(await requireWeb(), data.id));
export const getPage = createServerFn({ method: "GET" })
  .validator(pageInput)
  .handler(async ({ data }) =>
    readStoredPage(await requireWeb(), data.versionId, data.page),
  );
export const getSourceMetadata = createServerFn({ method: "GET" })
  .validator(z.object({ versionId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { document, version } = await resolveVersion(
      await requireWeb(),
      data.versionId,
    );
    return {
      documentId: document.id,
      name: document.name,
      versionId: version.id,
      pageCount: version.pageCount,
      filename: version.filename,
      contentHash: version.contentHash,
    };
  });
