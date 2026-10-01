import { z } from "zod";
import type { Extraction } from "../contracts/documents";
import type { IndexModel } from "./index-model";
import { headingsToTree, type Heading } from "./trees";
import {
  pageEvidence,
  headingEvidence,
  pageWindows,
  headingsSchema,
  verifyHeading,
} from "./refinement";
import { normalizedTitle } from "./pdf-engine";
import { fail } from "./errors";

export const standardRevision = "standard-2";
const tocSchema = z
  .object({
    usable: z.boolean(),
    entries: z
      .array(
        z
          .object({
            title: z.string().min(1).max(180),
            label: z.string().min(1).max(30),
            depth: z.number().int().min(0).max(8),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export function printedTocPages(extraction: Extraction) {
  return extraction.pages
    .slice(0, 20)
    .filter(
      (p) =>
        /(?:contents|table of contents|目录)/i.test(p.navigationText) ||
        p.lines.filter((l) => /\.{3,}\s*(?:\d+|[ivxlcdm]+)$/i.test(l.text))
          .length >= 2,
    );
}
export function mapToc(
  entries: z.infer<typeof tocSchema>["entries"],
  extraction: Extraction,
  excluded: number[],
) {
  const headings: Heading[] = [];
  const repairs: Array<{
    title: string;
    label: string;
    physical: number;
    reason: string;
  }> = [];
  for (const entry of entries) {
    const title = normalizedTitle(entry.title);
    const matching = extraction.pages.filter(
      (p) =>
        !excluded.includes(p.number) &&
        p.lines.some(
          (l) => !l.margin && normalizedTitle(l.text).includes(title),
        ),
    );
    const labeled = matching.filter(
      (p) => p.label?.toLowerCase() === entry.label.toLowerCase(),
    );
    // Printed labels are hints; original text is the final location check.
    // A bounded unique original match repairs an offset or missing label.
    const selected =
      labeled.length === 1
        ? labeled[0]
        : matching.length === 1
          ? matching[0]
          : undefined;
    if (!selected)
      fail(
        matching.length ? "toc_mapping_ambiguous" : "toc_heading_unverified",
        422,
      );
    if (!labeled.length) {
      const numeric = /^\d+$/.test(entry.label)
        ? Number(entry.label)
        : selected.number;
      if (Math.abs(selected.number - numeric) > 32)
        fail("toc_repair_bound_exceeded", 422);
      repairs.push({
        title: entry.title,
        label: entry.label,
        physical: selected.number,
        reason: "unique_original_heading",
      });
    }
    headings.push({
      title: entry.title,
      page: selected.number,
      depth: entry.depth,
      origin: "model",
      order: selected.lines.findIndex((l) =>
        normalizedTitle(l.text).includes(title),
      ),
    });
  }
  if (!headings.length) fail("toc_structure_empty", 422);
  if (headings.some((h, i) => i > 0 && h.page < headings[i - 1].page))
    fail("toc_order_invalid", 422);
  return { tree: headingsToTree(headings, extraction), repairs };
}
export async function buildStandard(extraction: Extraction, model: IndexModel) {
  const tocPages = printedTocPages(extraction);
  if (!tocPages.length) return buildWithoutToc(extraction, model);
  const result = await model.ask(
    "printed_toc",
    {
      pages: tocPages.map(pageEvidence),
      instructions:
        "Extract the printed table of contents: title, exact printed page label (Arabic or Roman) and zero-based hierarchy depth. Do not return physical pages. Mark usable false if this is not a usable TOC.",
    },
    tocSchema,
  );
  if (!result.usable) return buildWithoutToc(extraction, model);
  return {
    ...mapToc(
      result.entries,
      extraction,
      tocPages.map((p) => p.number),
    ),
    path: "printed-toc",
  };
}
async function buildWithoutToc(extraction: Extraction, model: IndexModel) {
  const headings: Heading[] = [];
  for (const pages of pageWindows(extraction.pages, model.contextChars)) {
    const result = await model.ask(
      "no_toc",
      {
        pages: pages.map(headingEvidence),
        instructions:
          "Construct chapter/section navigation from the supplied original body text, which omits repeated margins. Return meaningful titles, anchors copied as exact contiguous substrings of that physical page's supplied text, one-based physical pages and zero-based hierarchy depth (root=0). Retain same-page headings and window-start content where needed. Do not invent missing report titles from metadata, use page numbers as headings, or create a node per page.",
      },
      headingsSchema,
    );
    for (const h of result.headings) {
      verifyHeading(h, pages);
      const page = pages.find((p) => p.number === h.page)!;
      headings.push({
        ...h,
        origin: "model",
        order: page.lines.findIndex((l) =>
          normalizedTitle(l.text).includes(normalizedTitle(h.anchor)),
        ),
      });
    }
  }
  return {
    tree: headingsToTree(headings, extraction),
    path: "no-toc",
    repairs: [],
  };
}
