import { z } from "zod";
import type { Extraction, TreeNode, PdfPage } from "../contracts/documents";
import type { IndexModel } from "./index-model";
import { validateTree } from "./trees";
import { normalizedTitle } from "./pdf-engine";
import { fail } from "./errors";

export const refinementRevision = "refinement-3";
export const refinementDefaults = {
  smallChars: 500,
  smallMergedChars: 5000,
  maxLeafPages: 12,
  maxLeafChars: 18000,
  windowPages: 8,
  maxDepth: 4,
  summaryChars: 1600,
  shortLeafChars: 1200,
};
const nodePages = (n: TreeNode, e: Extraction) =>
  e.pages.slice(n.start - 1, n.end);
const size = (n: TreeNode, e: Extraction) =>
  nodePages(n, e).reduce((a, p) => a + p.text.length, 0);
const leaf = (n: TreeNode, tree: TreeNode[]) =>
  !tree.some((c) => c.parentId === n.id);
export function mergeSmallNodes(initial: TreeNode[], extraction: Extraction) {
  const tree = structuredClone(initial);
  for (let i = tree.length - 1; i > 0; i--) {
    const node = tree[i],
      previous = tree[i - 1];
    if (
      leaf(node, tree) &&
      leaf(previous, tree) &&
      node.parentId === previous.parentId &&
      node.depth === previous.depth &&
      size(node, extraction) < refinementDefaults.smallChars &&
      size(node, extraction) + size(previous, extraction) <=
        refinementDefaults.smallMergedChars &&
      node.start <= previous.end + 1
    ) {
      previous.end = Math.max(previous.end, node.end);
      previous.mergedTitles.push(node.title, ...node.mergedTitles);
      tree.splice(i, 1);
    }
  }
  validateTree(tree, extraction);
  return tree;
}
export const modelHeading = z
  .object({
    title: z.string().min(1).max(200),
    anchor: z
      .string()
      .min(1)
      .max(180)
      .describe(
        "An exact contiguous phrase copied from this physical page's supplied original body text.",
      ),
    page: z.number().int().min(1),
    depth: z.number().int().min(0).max(4),
  })
  .strict();
export const headingsSchema = z
  .object({ headings: z.array(modelHeading).min(1).max(100) })
  .strict();
export function verifyHeading(
  h: z.infer<typeof modelHeading>,
  pages: PdfPage[],
) {
  const p = pages.find((p) => p.number === h.page);
  if (
    !p ||
    !normalizedTitle(p.navigationText).includes(normalizedTitle(h.anchor))
  )
    fail("model_heading_unverified", 422);
}
// Every window is original content with visible physical identity. Refuse a
// page which cannot fit; silently clipping it could erase its qualifications.
export function pageWindows(pages: PdfPage[], contextChars: number) {
  const windows: PdfPage[][] = [];
  let group: PdfPage[] = [];
  for (const page of pages) {
    if (
      JSON.stringify({ pages: [pageEvidence(page)] }).length >
      contextChars - 2000
    )
      fail("page_context_too_large", 422);
    if (
      group.length >= refinementDefaults.windowPages ||
      JSON.stringify(group.map(pageEvidence).concat(pageEvidence(page)))
        .length >
        contextChars - 4000
    ) {
      windows.push(group);
      group = [];
    }
    group.push(page);
  }
  if (group.length) windows.push(group);
  return windows;
}
export const pageEvidence = (p: PdfPage) => ({
  page: p.number,
  label: p.label,
  text: p.text,
});
export const headingEvidence = (p: PdfPage) => ({
  ...pageEvidence(p),
  text: p.navigationText,
});
export async function subdivideTree(
  initial: TreeNode[],
  extraction: Extraction,
  model: IndexModel,
  contextChars: number,
) {
  const tree = structuredClone(initial);
  for (let i = 0; i < tree.length; i++) {
    const parent = tree[i];
    if (
      !leaf(parent, tree) ||
      (parent.end - parent.start + 1 <= refinementDefaults.maxLeafPages &&
        size(parent, extraction) <= refinementDefaults.maxLeafChars)
    )
      continue;
    if (parent.depth >= refinementDefaults.maxDepth)
      fail("subdivision_depth_exceeded", 422);
    const headings: z.infer<typeof modelHeading>[] = [];
    for (const pages of pageWindows(
      nodePages(parent, extraction),
      contextChars,
    )) {
      const result = await model.ask(
        "subdivide",
        {
          parent: { title: parent.title, start: parent.start, end: parent.end },
          pages: pages.map(headingEvidence),
          instructions:
            "Find meaningful subsections or content-backed group boundaries. Return a short descriptive title, an anchor copied as an exact contiguous substring of that physical page's text, its physical page, and relative depth 0. Do not take anchors from parent metadata, paraphrase text or create a node per page. Include a boundary for the start of this window. Group similar adjacent pages together using their actual original phrases as anchors.",
        },
        headingsSchema,
      );
      for (const h of result.headings) {
        verifyHeading(h, pages);
        headings.push(h);
      }
    }
    const ordered = headings
      .sort((a, b) => a.page - b.page)
      .filter((h, j, all) => !all.slice(0, j).some((p) => p.page === h.page));
    if (
      ordered.length < 2 ||
      ordered[0].page !== parent.start ||
      ordered.length >= parent.end - parent.start + 1
    )
      fail("subdivision_inadequate", 422);
    const children: TreeNode[] = ordered.map((h, j) => ({
      id: crypto.randomUUID(),
      title: h.title,
      anchor: h.anchor,
      start: h.page,
      end: ordered[j + 1]?.page ?? parent.end,
      parentId: parent.id,
      depth: parent.depth + 1,
      mergedTitles: [],
      origin: "model",
    }));
    if (children.some((c) => c.end - c.start >= parent.end - parent.start))
      fail("subdivision_no_progress", 422);
    tree.splice(i + 1, 0, ...children);
    validateTree(tree, extraction);
  }
  return tree;
}
const summarySchema = z
  .object({ summary: z.string().min(1).max(1600) })
  .strict();
export async function summarizeTree(
  initial: TreeNode[],
  extraction: Extraction,
  model: IndexModel,
  contextChars: number,
) {
  const tree = structuredClone(initial);
  for (const node of [...tree].reverse()) {
    model.check();
    const children = tree.filter((n) => n.parentId === node.id);
    const pages = nodePages(node, extraction).filter(
      (p) => !children.some((c) => p.number >= c.start && p.number <= c.end),
    );
    const text = pages.map((p) => p.text).join("\n");
    if (!children.length && text.length <= refinementDefaults.shortLeafChars) {
      node.summary = text.trim();
      continue;
    }
    const fragments: { start: number; end: number; summary: string }[] = [];
    for (const group of pageWindows(pages, contextChars)) {
      const result = await model.ask(
        "summarize_leaf",
        {
          title: node.title,
          pages: group.map(pageEvidence),
          instructions:
            "Summarize this original section for navigation in at most 1600 characters. Keep qualifications, dates and units. This summary is not answer evidence.",
        },
        summarySchema,
      );
      fragments.push({
        start: group[0].number,
        end: group.at(-1)!.number,
        summary: result.summary,
      });
    }
    const childSummaries = children.map((c) => ({
      title: c.title,
      start: c.start,
      end: c.end,
      summary: c.summary!,
    }));
    if (!children.length && fragments.length === 1) {
      node.summary = fragments[0].summary;
      continue;
    }
    if (!fragments.length && childSummaries.length === 1) {
      const text = `${childSummaries[0].title}: ${childSummaries[0].summary}`;
      if (text.length <= refinementDefaults.summaryChars) {
        node.summary = text;
        continue;
      }
    }
    // Reduce in bounded batches; no unbounded fanout in parent prompts.
    let parts = [
      ...childSummaries.map((c) => JSON.stringify(c)),
      ...fragments.map((f) => JSON.stringify(f)),
    ];
    if (!parts.length) fail("summary_evidence_missing", 422);
    while (
      parts.length > 1 ||
      parts[0].length > refinementDefaults.summaryChars
    ) {
      const next: string[] = [];
      for (let offset = 0; offset < parts.length;) {
        const batch: string[] = [];
        let chars = 0;
        do {
          const part = parts[offset++];
          batch.push(part);
          chars += part.length;
        } while (
          offset < parts.length &&
          chars + parts[offset].length < contextChars - 4000 &&
          batch.length < 12
        );
        const result = await model.ask(
          "summarize_parent",
          {
            title: node.title,
            summaries: batch,
            instructions:
              "Produce a navigation summary, preserving source qualifications, in at most 1600 characters. The supplied start/end bounds describe navigation coverage, not proof that each fact occurs on every page in that range. Adjacent sections can share a boundary page. Preserve explicitly stated per-page/year distinctions from the summaries; never infer that facts from both sections coexist on their shared boundary page. Do not invent page-specific factual locations or correct printed labels by guessing.",
          },
          summarySchema,
        );
        next.push(result.summary);
      }
      if (next.length >= parts.length && next.length > 1)
        fail("summary_context_too_small", 422);
      parts = next;
    }
    node.summary = parts[0];
  }
  validateTree(tree, extraction, { summaries: true });
  return tree;
}
