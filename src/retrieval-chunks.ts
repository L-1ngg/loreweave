import type { ParsedMarkdown, ParsedPassage } from "./markdown.ts";
import type { InputCounter } from "./embedding-tokenizer.ts";
import { hash } from "./answer-validation.ts";
export const chunkerProfile = "structural-512-768-no-overlap-v1";
export interface ChunkSpan {
  passage: ParsedPassage;
  start: number;
  end: number;
  text: string;
}
export interface RetrievalChunk {
  text: string;
  contextHash: string;
  spans: ChunkSpan[];
}

/** Search projections retain exact original spans; prefixes are never citation text. */
export function retrievalChunks(
  parsed: ParsedMarkdown,
  counter: InputCounter,
): RetrievalChunk[] {
  const target = Math.min(512, counter.maxInput),
    maximum = Math.min(768, counter.maxInput);
  const chunks: RetrievalChunk[] = [];
  let current: ChunkSpan[] = [],
    prefix = "",
    contextHash = "";
  const input = (spans: ChunkSpan[]) =>
    prefix + spans.map((span) => span.text).join("\n");
  const flush = () => {
    if (current.length)
      chunks.push({ text: input(current), contextHash, spans: current });
    current = [];
  };
  const fit = (text: string, prefix: string, limit: number) => {
    const points = Array.from(text);
    let low = 0,
      high = points.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (counter.count(prefix + points.slice(0, mid).join("")) <= limit)
        low = mid;
      else high = mid - 1;
    }
    if (!low) throw new Error("chunk_input_limit");
    return points.slice(0, low).join("");
  };
  for (const passage of parsed.passages) {
    const governing = passage.headingPath.join(" > ");
    const structural =
      passage.kind === "code"
        ? (passage.text.match(/^(?:`{3,}|~{3,})[^\r\n]*/)?.[0] ?? "")
        : passage.kind === "table"
          ? passage.text
              .split(/\r\n|\r|\n/)
              .slice(0, 2)
              .join("\n")
          : "";
    const fullPrefix = [governing, structural].filter(Boolean).join("\n");
    const nextHash = hash({
      heading: passage.headingPath,
      structural,
      counter: counter.profile,
      chunker: chunkerProfile,
    });
    if (nextHash !== contextHash) {
      flush();
      contextHash = nextHash;
      prefix = fullPrefix
        ? fit(fullPrefix, "", Math.min(128, target / 2)) + "\n"
        : "";
    }
    const units =
      counter.count(prefix + passage.text) <= maximum
        ? [passage.text]
        : passage.kind === "paragraph" || passage.kind === "quote"
          ? [
              ...new Intl.Segmenter("zh", { granularity: "sentence" }).segment(
                passage.text,
              ),
            ].map((segment) => segment.segment)
          : (passage.text
              .match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)
              ?.filter(Boolean) ?? [passage.text]);
    let offset = passage.start;
    for (const unit of units) {
      let rest = unit;
      while (rest.length) {
        const text =
          counter.count(prefix + rest) <= maximum
            ? rest
            : fit(rest, prefix, target);
        const span: ChunkSpan = {
          passage,
          start: offset,
          end: offset + text.length,
          text,
        };
        if (current.length && counter.count(input([...current, span])) > target)
          flush();
        const previous = current.at(-1);
        if (
          previous &&
          previous.passage.ordinal === passage.ordinal &&
          previous.end === span.start
        ) {
          previous.end = span.end;
          previous.text += span.text;
        } else current.push(span);
        offset += text.length;
        rest = rest.slice(text.length);
        if (rest.length) flush();
      }
    }
  }
  flush();
  if (chunks.some((chunk) => counter.count(chunk.text) > maximum))
    throw new Error("chunk_input_limit");
  return chunks;
}
