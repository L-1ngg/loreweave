import { hash } from "./answer-validation.ts";
import type { SourceVersion } from "./sources.ts";
import type { WikiPack } from "./wiki-types.ts";
export function makePack(
  runId: string,
  question: string,
  sources: SourceVersion[],
): WikiPack {
  const items = sources
    .flatMap((source) =>
      source.passages.map((passage) => ({
        documentId: source.id,
        version: source.version,
        passageId: passage.id,
        title: source.title,
        text: passage.text,
        headingPath: passage.headingPath,
        start: passage.start,
        end: passage.end,
        handle: "",
      })),
    )
    .flatMap((item) => {
      const slices: (typeof item)[] = [];
      let text = "",
        bytes = 0,
        start = item.start;
      for (const point of item.text) {
        const size = new TextEncoder().encode(point).length;
        if (bytes + size > 1000) {
          slices.push({ ...item, text, start, end: start + text.length });
          start += text.length;
          text = "";
          bytes = 0;
        }
        text += point;
        bytes += size;
      }
      if (text) slices.push({ ...item, text, start, end: start + text.length });
      return slices;
    })
    .map((item, index) => ({ ...item, handle: `e${index + 1}` }));
  return {
    runId,
    question,
    items,
    hash: hash(items),
    diagnostics: {
      lexicalCandidates: 0,
      vectorCandidates: 0,
      retrievalMs: 0,
      embeddingRequests: 0,
      gaps: [],
    },
  };
}

export function packetPacks(pack: WikiPack, maxBytes: number): WikiPack[] {
  const packets: WikiPack[] = [];
  let items: WikiPack["items"] = [],
    bytes = 0;
  for (const item of pack.items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).length;
    if (size > maxBytes)
      throw new Error("needs_attention:oversized_source_range");
    if (items.length && bytes + size > maxBytes) {
      packets.push({ ...pack, items, hash: hash(items) });
      items = [];
      bytes = 0;
    }
    items.push(item);
    bytes += size;
  }
  if (items.length) packets.push({ ...pack, items, hash: hash(items) });
  return packets;
}
