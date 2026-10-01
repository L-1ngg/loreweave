import type { Actor } from "./access";
import { resolveVersion, originalPath } from "./library";

export async function originalResponse(
  actor: Actor,
  versionId: string,
  request: Request,
) {
  const { version } = await resolveVersion(actor, versionId);
  const file = Bun.file(originalPath(versionId));
  if (!(await file.exists())) return new Response(null, { status: 404 });
  const size = version.byteLength;
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    ETag: `"${version.contentHash}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  const range = request.headers.get("range");
  if (
    range &&
    (!request.headers.get("if-range") ||
      request.headers.get("if-range") === headers.get("etag"))
  ) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0,
      end = size - 1;
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), size - 1);
    } else if (match?.[2]) start = Math.max(0, size - Number(match[2]));
    else start = size;
    if (
      !match ||
      start > end ||
      start >= size ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end)
    )
      return new Response(null, {
        status: 416,
        headers: {
          ...Object.fromEntries(headers),
          "Content-Range": `bytes */${size}`,
        },
      });
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(
      request.method === "HEAD"
        ? null
        : await file.slice(start, end + 1).arrayBuffer(),
      { status: 206, headers },
    );
  }
  headers.set("Content-Length", String(size));
  return new Response(request.method === "HEAD" ? null : file, { headers });
}
