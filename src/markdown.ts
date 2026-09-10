import MarkdownIt from "markdown-it";

export interface ParsedPassage {
  ordinal: number;
  kind:
    | "reference"
    | "metadata"
    | "heading"
    | "paragraph"
    | "list"
    | "table"
    | "code"
    | "quote"
    | "rule";
  headingPath: string[];
  /** UTF-16 offsets into the exact, unnormalized UTF-8 decoded representation. */
  start: number;
  end: number;
  text: string;
}
export interface ParsedMarkdown {
  decoded: string;
  passages: ParsedPassage[];
}
export const parserProfile = "markdown-it-15.0.1-tables-v1";
const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export function parseMarkdown(bytes: Uint8Array): ParsedMarkdown {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error("invalid_encoding");
  }
  if (!decoded.trim() || decoded.includes("\0"))
    throw new Error("invalid_markdown");
  const starts = [0];
  for (const newline of decoded.matchAll(/\r\n|\r|\n/g))
    starts.push(newline.index + newline[0].length);
  const lines = decoded.split(/\r\n|\r|\n/);
  const passages: ParsedPassage[] = [];
  const headings: string[] = [];
  function add(
    kind: ParsedPassage["kind"],
    first: number,
    after: number,
  ): void {
    const start = starts[first]!,
      end = starts[after] ?? decoded.length;
    passages.push({
      ordinal: passages.length,
      kind,
      headingPath: headings.filter(Boolean),
      start,
      end,
      text: decoded.slice(start, end),
    });
  }
  let bodyLine = 0;
  if (lines[0]?.replace(/^\uFEFF/, "") === "---") {
    const closing = lines.findIndex(
      (line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line),
    );
    if (closing > 0) {
      bodyLine = closing + 1;
      add("metadata", 0, bodyLine);
    }
  }
  const tokens = parser.parse(
    decoded.slice(starts[bodyLine] ?? decoded.length),
    {},
  );
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (
      token.level !== 0 ||
      !token.map ||
      token.type === "inline" ||
      token.nesting === -1
    )
      continue;
    let kind: ParsedPassage["kind"];
    switch (token.type) {
      case "heading_open": {
        kind = "heading";
        const level = Number(token.tag.slice(1));
        headings.length = level;
        headings[level - 1] = tokens[index + 1]?.content ?? "";
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open":
        kind = "list";
        break;
      case "table_open":
        kind = "table";
        break;
      case "fence":
      case "code_block":
        kind = "code";
        break;
      case "blockquote_open":
        kind = "quote";
        break;
      case "hr":
        kind = "rule";
        break;
      default:
        kind = "paragraph";
    }
    add(kind, bodyLine + token.map[0], bodyLine + token.map[1]);
  }
  // Markdown-it consumes link definitions without emitting block tokens. Preserve
  // every uncovered non-whitespace span so definition evidence remains addressable.
  const visible = [...passages];
  let cursor = 0;
  let path: string[] = [];
  for (const passage of [
    ...visible,
    { start: decoded.length, end: decoded.length, headingPath: path },
  ]) {
    const text = decoded.slice(cursor, passage.start);
    if (text.trim())
      passages.push({
        ordinal: 0,
        kind: "reference",
        headingPath: [...path],
        start: cursor,
        end: passage.start,
        text,
      });
    cursor = passage.end;
    path = passage.headingPath;
  }
  passages.sort((a, b) => a.start - b.start);
  passages.forEach((passage, ordinal) => {
    passage.ordinal = ordinal;
  });
  if (!passages.length) throw new Error("invalid_markdown");
  return { decoded, passages };
}
