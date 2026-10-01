import { test, expect } from "bun:test";
import { extractPdf } from "../src/server/pdf-engine";
import { buildFlash, validateTree } from "../src/server/trees";
test("chapter candidates verify original anchors and same-page range boundaries", async () => {
  const extraction = await extractPdf(
    new Uint8Array(
      await Bun.file("tests/fixtures/pdf/bookmarks.pdf").arrayBuffer(),
    ),
  );
  const tree = buildFlash(extraction);
  validateTree(tree, extraction);
  expect(tree.some((n) => n.title === "1 Overview" && n.start === 2)).toBe(
    true,
  );
  expect(tree.some((n) => n.title === "1.1 Scope" && n.start === 2)).toBe(true);
  expect(tree.some((n) => n.title === "Nonexistent claims")).toBe(false);
  expect(() =>
    validateTree(
      tree.map((n, i) => (i ? n : { ...n, start: 0 })),
      extraction,
    ),
  ).toThrow("tree_range_invalid");
  expect(() =>
    validateTree(
      tree.map((n, i) => (i ? n : { ...n, title: "Invented chapter" })),
      extraction,
    ),
  ).toThrow("tree_location_unverified");
});
test("long unstructured prose cannot become a page-only successful index", async () => {
  const extraction = await extractPdf(
    new Uint8Array(
      await Bun.file("tests/fixtures/pdf/inadequate.pdf").arrayBuffer(),
    ),
  );
  expect(() => buildFlash(extraction)).toThrow(
    "structural_extraction_inadequate",
  );
});
