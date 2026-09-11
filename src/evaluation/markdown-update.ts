import type { SourceOperation } from "../sources.ts";
/** Separate write credential; only explicitly supplied Markdown originals enter knowledge. */
export class MarkdownUpdate {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}
  async submit(input: {
    filename: string;
    bytes: Uint8Array;
    documentId: string;
    expectedPrior: string;
    projectId?: string;
    key: string;
  }) {
    const headers = { cookie: `loreweave_session=${this.token}` };
    const form = new FormData();
    form.set("file", new File([Uint8Array.from(input.bytes)], input.filename));
    if (input.projectId) form.set("projectId", input.projectId);
    const uploaded = await fetch(new URL("/api/attachments", this.endpoint), {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(10000),
    });
    if (!uploaded.ok) throw new Error(`upload_http_${uploaded.status}`);
    const attachment = (await uploaded.json()) as { id: string };
    const accepted = await fetch(new URL("/api/imports", this.endpoint), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        attachmentId: attachment.id,
        key: input.key,
        documentId: input.documentId,
        expectedPrior: input.expectedPrior,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      }),
    });
    if (!accepted.ok) throw new Error(`import_http_${accepted.status}`);
    const operation = (await accepted.json()) as SourceOperation;
    return { operationId: operation.id };
  }
}
