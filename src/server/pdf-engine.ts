import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  PdfItem,
  PdfLine,
  PdfPage,
  PdfOutline,
  Extraction,
} from "../contracts/documents";

export const extractorRevision = "pdfjs6-layout-1";
export class PdfFailure extends Error {
  constructor(
    public code: string,
    public unsupported = true,
  ) {
    super(code);
  }
}
export const normalizedTitle = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
function median(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
function joinText(items: PdfItem[]) {
  let text = "";
  let previous: PdfItem | undefined;
  for (const item of items) {
    const gap = previous ? item.x - previous.x - previous.width : 0;
    const latin =
      previous &&
      /[A-Za-z0-9)]$/.test(previous.text) &&
      /^[A-Za-z0-9(]/.test(item.text);
    if (
      text &&
      !/\s$/.test(text) &&
      !/^\s/.test(item.text) &&
      latin &&
      gap > item.height * 0.12
    )
      text += " ";
    text += item.text;
    previous = item;
  }
  return text.trim();
}
function readingLines(
  items: PdfItem[],
  pageWidth: number,
  pageHeight: number,
): { lines: PdfLine[]; columns: number } {
  const rows: PdfItem[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (
      row &&
      Math.abs(row[0].y - item.y) <=
        Math.max(2, Math.min(row[0].height, item.height) * 0.25)
    )
      row.push(item);
    else rows.push([item]);
  }
  const segments: PdfLine[] = [];
  for (const row of rows) {
    const chunks: PdfItem[][] = [];
    for (const item of row.sort((a, b) => a.x - b.x)) {
      const chunk = chunks.at(-1);
      const last = chunk?.at(-1);
      if (
        last &&
        item.x - last.x - last.width <
          Math.max(item.height * 2.3, pageWidth * 0.06)
      )
        chunk!.push(item);
      else chunks.push([item]);
    }
    for (const chunk of chunks) {
      const first = chunk[0];
      const last = chunk.at(-1)!;
      segments.push({
        text: joinText(chunk),
        x: first.x,
        y: Math.min(...chunk.map((i) => i.y)),
        width: last.x + last.width - first.x,
        height: Math.max(...chunk.map((i) => i.height)),
        font: first.font,
        margin: false,
      });
    }
  }
  const left = segments.filter(
    (l) => l.x + l.width <= pageWidth * 0.53 && l.x < pageWidth * 0.35,
  );
  const right = segments.filter(
    (l) => l.x >= pageWidth * 0.45 && l.width < pageWidth * 0.5,
  );
  const gutter =
    (Math.max(...left.map((l) => l.x + l.width), 0) +
      Math.min(...right.map((l) => l.x), pageWidth)) /
    2;
  const columns =
    left.length >= 3 &&
    right.length >= 3 &&
    Math.min(...right.map((l) => l.x)) -
      median(left.map((l) => l.x + l.width)) >
      pageWidth * 0.035
      ? 2
      : 1;
  if (columns === 1)
    return { lines: segments.sort((a, b) => a.y - b.y || a.x - b.x), columns };
  // Full-width lines delimit bands; read each band's left column before its right.
  const spanning = segments
    .filter(
      (l) =>
        (l.x < gutter && l.x + l.width > gutter) ||
        l.y < pageHeight * 0.065 ||
        l.y > pageHeight * 0.92,
    )
    .sort((a, b) => a.y - b.y);
  const ordered: PdfLine[] = [];
  let lower = -Infinity;
  for (const separator of [...spanning, { y: Infinity }]) {
    const band = segments.filter(
      (l) => !spanning.includes(l) && l.y >= lower && l.y < separator.y,
    );
    ordered.push(
      ...band.filter((l) => l.x < gutter).sort((a, b) => a.y - b.y),
      ...band.filter((l) => l.x >= gutter).sort((a, b) => a.y - b.y),
    );
    if ("text" in separator) ordered.push(separator as PdfLine);
    lower = separator.y;
  }
  return { lines: ordered, columns };
}
export async function extractPdf(
  bytes: Uint8Array,
  options: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<Extraction> {
  const assets = dirname(
    fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
  );
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    cMapUrl: pathToFileURL(join(assets, "cmaps") + "/").href,
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(join(assets, "standard_fonts") + "/")
      .href,
  });
  const abort = () => {
    void task.destroy();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > (options.maxPages ?? 2000))
      throw new PdfFailure("page_budget_exceeded", false);
    const labels = await pdf.getPageLabels();
    const pages: PdfPage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfItem[] = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        const transform = Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(transform[2], transform[3]);
        return [
          {
            text: item.str,
            font: content.styles[item.fontName]?.fontFamily ?? item.fontName,
            height,
            width: item.width,
            x: transform[4],
            y: transform[5] - height,
            transform: [...item.transform],
            hasEOL: item.hasEOL,
          },
        ];
      });
      const { lines, columns } = readingLines(
        items,
        viewport.width,
        viewport.height,
      );
      pages.push({
        number,
        label: labels?.[number - 1] ?? null,
        text: lines.map((l) => l.text).join("\n"),
        navigationText: lines.map((l) => l.text).join("\n"),
        width: viewport.width,
        height: viewport.height,
        rotation: page.rotate,
        columns,
        items,
        lines,
      });
      page.cleanup();
    }
    const allText = pages.map((p) => p.text).join("");
    if ((allText.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 12)
      throw new PdfFailure("text_layer_required");
    if ((allText.match(/\uFFFD/g)?.length ?? 0) > allText.length * 0.1)
      throw new PdfFailure("unreadable_text_layer");
    const margins = new Map<string, Set<number>>();
    const signature = (line: PdfLine) =>
      normalizedTitle(line.text).replace(/\d+/g, "#");
    for (const page of pages)
      for (const line of page.lines)
        if (line.y < page.height * 0.065 || line.y > page.height * 0.92) {
          const sig = signature(line);
          const entries = margins.get(sig) ?? new Set<number>();
          entries.add(page.number);
          margins.set(sig, entries);
        }
    for (const page of pages) {
      const bodyHeight = median(
        page.lines.filter((l) => l.text.length > 20).map((l) => l.height),
      );
      for (const line of page.lines)
        line.margin =
          line.height <= bodyHeight * 1.1 &&
          (line.y < page.height * 0.065 || line.y > page.height * 0.92) &&
          (margins.get(signature(line))?.size ?? 0) >=
            Math.max(2, Math.ceil(pages.length * 0.6));
      page.navigationText = page.lines
        .filter((l) => !l.margin)
        .map((l) => l.text)
        .join("\n");
    }
    const outlines: PdfOutline[] = [];
    type Outline = NonNullable<
      Awaited<ReturnType<typeof pdf.getOutline>>
    >[number];
    async function walk(entries: Outline[], depth: number) {
      for (const entry of entries) {
        let physical: number | null = null;
        try {
          const dest =
            typeof entry.dest === "string"
              ? await pdf.getDestination(entry.dest)
              : entry.dest;
          if (dest?.length)
            physical =
              typeof dest[0] === "number"
                ? dest[0] + 1
                : (await pdf.getPageIndex(dest[0])) + 1;
        } catch {}
        const title = normalizedTitle(entry.title);
        const verified =
          physical !== null &&
          physical >= 1 &&
          physical <= pages.length &&
          !!title &&
          normalizedTitle(pages[physical - 1].navigationText).includes(title);
        outlines.push({ title: entry.title, page: physical, depth, verified });
        if (entry.items?.length) await walk(entry.items, depth + 1);
      }
    }
    await walk((await pdf.getOutline()) ?? [], 0);
    const metadata = await pdf.getMetadata();
    const info = metadata.info as { Title?: string };
    return {
      extractorRevision,
      pageCount: pages.length,
      pages,
      outlines,
      title: info.Title || null,
      diagnostics: [
        ...new Set(
          pages
            .filter((p) => p.columns > 1)
            .map(() => "multi_column_reading_order"),
        ),
        ...(outlines.some((o) => !o.verified)
          ? ["unverified_bookmark_candidates"]
          : []),
      ],
    };
  } catch (error) {
    if (error instanceof PdfFailure) throw error;
    if (options.signal?.aborted) throw options.signal.reason;
    if (error instanceof Error && error.name === "PasswordException")
      throw new PdfFailure("encrypted_pdf_unsupported");
    throw new PdfFailure("malformed_or_unreadable_pdf", false);
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
