import { z } from "zod";
import { requireWeb } from "./access";
import { fail, httpBoundary } from "./errors";
import { acceptOriginal } from "./library";
import { dispatchIndex } from "./indexing";
import { indexMode } from "../contracts/documents";
export function uploadOriginal(request: Request, targetId?: string) {
  return httpBoundary(async () => {
    const actor = await requireWeb(request);
    if (Number(request.headers.get("content-length") ?? 0) > 51 * 1024 * 1024)
      fail("pdf_size_invalid", 413);
    const form = await request.formData();
    const allowed = targetId
      ? ["file", "mode", "submissionId", "expectedRevision"]
      : ["file", "mode", "submissionId"];
    if ([...form.keys()].some((key) => !allowed.includes(key)))
      fail("invalid_input");
    const file = form.get("file");
    if (!(file instanceof File)) fail("pdf_file_required");
    const result = await acceptOriginal(actor, {
      submissionId: z.string().uuid().parse(form.get("submissionId")),
      mode: indexMode.parse(form.get("mode") ?? "flash"),
      filename: z.string().trim().min(1).max(255).parse(file.name),
      bytes: new Uint8Array(await file.arrayBuffer()),
      ...(targetId
        ? {
            targetId: z.string().uuid().parse(targetId),
            expectedRevision: Number(
              z
                .string()
                .regex(/^\d{1,9}$/)
                .parse(form.get("expectedRevision")),
            ),
          }
        : {}),
    });
    if (result.created) dispatchIndex(result.operation.latestAttempt);
    return Response.json(
      {
        operationId: result.operation.id,
        documentId: result.operation.documentId,
        versionId: result.operation.versionId,
        attemptId: result.operation.latestAttempt,
        created: result.created,
      },
      {
        status: result.created ? 202 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  });
}
