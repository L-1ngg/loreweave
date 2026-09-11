import { hash } from "./answer-validation.ts";
import type { SourceCandidate, SourceVersion } from "./sources.ts";
export interface GraphOriginal extends SourceCandidate {
  handle: string;
  context: string;
}
export interface GraphPacket {
  key: string;
  kind: "primary" | "bridge";
  items: GraphOriginal[];
}
const bytes = (value: string) => new TextEncoder().encode(value).length;
function prefix(value: string, cap: number) {
  let used = 0,
    result = "";
  for (const point of value) {
    const cost = bytes(point);
    if (used + cost > cap) break;
    result += point;
    used += cost;
  }
  return result;
}
/** UTF-8 byte bounds are conservative token ceilings and preserve UTF-16 source offsets. */
export function graphOriginals(source: SourceVersion): GraphOriginal[] {
  return source.passages.flatMap((passage, index) => {
    const chunks: GraphOriginal[] = [];
    const context = prefix(
      [
        passage.headingPath.join(" > "),
        // Retain Markdown table headers on every continuation span.
        ...(passage.text.split("\n")[1]?.match(/^\s*\|?\s*:?-+/)
          ? passage.text.split("\n").slice(0, 2)
          : []),
        source.passages[index - 1]?.text.slice(-150) ?? "",
        source.passages[index + 1]?.text.slice(0, 150) ?? "",
      ].join("\n"),
      900,
    );
    for (let start = 0; start < passage.text.length;) {
      const text = prefix(passage.text.slice(start), 1800);
      chunks.push({
        documentId: source.id,
        version: source.version,
        passageId: passage.id,
        title: source.title,
        text,
        headingPath: passage.headingPath,
        start: passage.start + start,
        end: passage.start + start + text.length,
        handle: `g${index}:${start}`,
        context,
      });
      start += text.length;
    }
    return chunks;
  });
}
export function graphPackets(items: GraphOriginal[]): GraphPacket[] {
  const primary: GraphPacket[] = [];
  let current: GraphOriginal[] = [],
    originalBytes = 0,
    contextBytes = 0;
  for (const item of items) {
    const size = bytes(item.text),
      context = bytes(item.context);
    if (
      current.length &&
      (originalBytes + size > 3000 ||
        contextBytes + context > 1000 ||
        bytes(JSON.stringify([...current, item])) > 12000)
    ) {
      primary.push({
        key: `packet:${primary.length}`,
        kind: "primary",
        items: current,
      });
      current = [];
      originalBytes = 0;
      contextBytes = 0;
    }
    if (size > 3000 || context > 1000)
      throw new Error("needs_attention:graph_packet_overflow");
    current.push(item);
    originalBytes += size;
    contextBytes += context;
  }
  if (current.length || !primary.length)
    primary.push({
      key: `packet:${primary.length}`,
      kind: "primary",
      items: current,
    });
  const packets: GraphPacket[] = [];
  const bridges = new Set<string>();
  const slug = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, "")
      .replace(/\s/g, "-");
  const headings = new Map<string, GraphOriginal[]>();
  for (const item of items) {
    const title = item.headingPath.at(-1);
    if (title)
      headings.set(slug(title), [...(headings.get(slug(title)) ?? []), item]);
  }
  for (const [index, packet] of primary.entries()) {
    packets.push(packet);
    let requested = 0;
    const bridge = (relevant: GraphOriginal[]) => {
      const spans = [
        ...new Map(relevant.map((item) => [item.handle, item])).values(),
      ].sort((a, b) => a.start - b.start);
      const key = `bridge:${hash(spans.map((item) => [item.passageId, item.start, item.end]))}`;
      if (bridges.has(key)) return;
      if (++requested > 2)
        throw new Error("needs_attention:graph_bridge_limit");
      if (spans.reduce((size, item) => size + bytes(item.text), 0) > 4000)
        throw new Error("needs_attention:graph_bridge_overflow");
      bridges.add(key);
      packets.push({
        key,
        kind: "bridge",
        items: spans.map((item) => ({ ...item, context: "" })),
      });
    };
    if (index + 1 < primary.length)
      bridge([packet.items.at(-1)!, primary[index + 1]!.items[0]!]);
    for (const item of packet.items) {
      for (const match of item.text.matchAll(/\[[^\]]*\]\(#([^\s)]+)\)/g)) {
        let anchor: string;
        try {
          anchor = decodeURIComponent(match[1]!);
        } catch {
          throw new Error("needs_attention:graph_bridge_context");
        }
        const referenced = headings.get(anchor.toLowerCase());
        if (!referenced?.length)
          throw new Error("needs_attention:graph_bridge_context");
        if (referenced.every((span) => packet.items.includes(span))) continue;
        bridge([item, ...referenced]);
      }
    }
  }
  return packets;
}
