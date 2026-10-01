import type { Extraction, TreeNode } from "../contracts/documents";
import { normalizedTitle } from "./pdf-engine";
import { fail } from "./errors";

export type Heading = {
  title: string;
  page: number;
  depth: number;
  origin: TreeNode["origin"];
  anchor?: string;
  order?: number;
};
export const treeRevision = "tree-ranges-1";
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 11;
export function buildFlash(extraction: Extraction): TreeNode[] {
  const body = median(
    extraction.pages.flatMap((page) =>
      page.lines
        .filter((line) => !line.margin && line.text.length > 20)
        .map((line) => line.height),
    ),
  );
  const lines = extraction.pages.flatMap((page) =>
    page.lines.map((line, order) => ({ ...line, page: page.number, order })),
  );
  const candidates = lines.filter((line) => {
    if (
      line.margin ||
      line.text.length < 3 ||
      line.text.length > 180 ||
      /\.{3,}\s*(?:\d+|[ivxlcdm]+)$/i.test(line.text)
    )
      return false;
    const prominent = line.height >= body * 1.23;
    const named =
      /^(?:chapter|section|appendix|abstract|references|conclusion|introduction|第[一二三四五六七八九十百\d]+[章节]|目录|参考文献|附录)/i.test(
        line.text,
      );
    return prominent || (named && line.height >= body * 1.04);
  });
  const fonts = [
    ...new Set(candidates.map((line) => Math.round(line.height * 2) / 2)),
  ].sort((a, b) => b - a);
  const headings: Heading[] = candidates.map((line) => {
    const numbered = /^(\d+(?:\.\d+)*)(?:[.)]|\s)\s*\S/.exec(line.text);
    const base = fonts.findIndex((size) => Math.abs(size - line.height) < 0.6);
    return {
      title: line.text,
      page: line.page,
      depth: numbered
        ? Math.max(base, numbered[1].split(".").length - 1)
        : base,
      origin: "layout",
      order: line.order,
    };
  });
  for (const outline of extraction.outlines.filter(
    (o) => o.verified && o.page,
  )) {
    const found = headings.find(
      (h) =>
        h.page === outline.page &&
        normalizedTitle(h.title) === normalizedTitle(outline.title),
    );
    if (found) found.origin = "outline";
    else
      headings.push({
        title: outline.title,
        page: outline.page!,
        depth: outline.depth,
        origin: "outline",
        order:
          lines.find(
            (l) =>
              l.page === outline.page &&
              normalizedTitle(l.text).includes(normalizedTitle(outline.title)),
          )?.order ?? 0,
      });
  }
  if (!headings.length) fail("structural_extraction_inadequate", 422);
  return headingsToTree(headings, extraction);
}
export function headingsToTree(
  headings: Heading[],
  extraction: Extraction,
): TreeNode[] {
  const ordered = headings
    .filter((h) => h.title.trim())
    .sort((a, b) => a.page - b.page || (a.order ?? 0) - (b.order ?? 0));
  const unique = ordered.filter(
    (h, i) =>
      !ordered
        .slice(0, i)
        .some(
          (p) =>
            p.page === h.page &&
            normalizedTitle(p.title) === normalizedTitle(h.title),
        ),
  );
  if (!unique.length) fail("structural_extraction_inadequate", 422);
  if (unique[0].page > 1)
    unique.unshift({
      title: "Front matter",
      page: 1,
      depth: 0,
      origin: "coverage",
    });
  const tree: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const heading of unique) {
    const depth = Math.min(Math.max(0, heading.depth), stack.length, 8);
    while (stack.length > depth) stack.pop();
    const node: TreeNode = {
      id: crypto.randomUUID(),
      title: heading.title.trim(),
      start: heading.page,
      end: extraction.pageCount,
      depth,
      parentId: stack.at(-1)?.id ?? null,
      mergedTitles: [],
      origin: heading.origin,
      ...(heading.anchor ? { anchor: heading.anchor } : {}),
    };
    tree.push(node);
    stack.push(node);
  }
  for (let i = 0; i < tree.length; i++) {
    const next = tree.slice(i + 1).find((node) => node.depth <= tree[i].depth);
    tree[i].end = next
      ? Math.max(tree[i].start, next.start)
      : extraction.pageCount;
  }
  validateTree(tree, extraction);
  return tree;
}
export function validateTree(
  tree: TreeNode[],
  extraction: Extraction,
  { summaries = false }: { summaries?: boolean } = {},
) {
  if (!tree.length || tree.length > 5000) fail("tree_size_invalid", 422);
  const ids = new Set<string>();
  const covered = new Set<number>();
  const stack: TreeNode[] = [];
  for (const node of tree) {
    if (
      ids.has(node.id) ||
      !node.id ||
      !node.title.trim() ||
      node.title.length > 250
    )
      fail("tree_identity_invalid", 422);
    ids.add(node.id);
    if (
      !Number.isInteger(node.start) ||
      !Number.isInteger(node.end) ||
      node.start < 1 ||
      node.end < node.start ||
      node.end > extraction.pageCount
    )
      fail("tree_range_invalid", 422);
    if (
      !Number.isInteger(node.depth) ||
      node.depth < 0 ||
      node.depth > 8 ||
      node.depth > stack.length
    )
      fail("tree_hierarchy_invalid", 422);
    while (stack.length > node.depth) stack.pop();
    const parent = stack.at(-1);
    if (
      node.parentId !== (parent?.id ?? null) ||
      (parent && (node.start < parent.start || node.end > parent.end))
    )
      fail("tree_parent_invalid", 422);
    const anchor = normalizedTitle(node.anchor ?? node.title);
    if (
      node.origin !== "coverage" &&
      (!anchor ||
        !normalizedTitle(
          extraction.pages[node.start - 1].navigationText,
        ).includes(anchor))
    )
      fail("tree_location_unverified", 422);
    if (summaries && (!node.summary?.trim() || node.summary.length > 2000))
      fail("summary_missing_or_invalid", 422);
    for (let page = node.start; page <= node.end; page++) covered.add(page);
    stack.push(node);
  }
  if (covered.size !== extraction.pageCount)
    fail("tree_page_coverage_incomplete", 422);
}
