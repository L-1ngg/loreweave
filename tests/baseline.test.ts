import { expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdf } from "../src/server/pdf-engine";

test("the Bun PDF engine preserves source text and physical pages", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of [
    "Chapter 1. Applies only during 2026.",
    "Chapter 2. Another physical page.",
  ])
    pdf.addPage().drawText(text, { x: 60, y: 700, font });
  const extracted = await extractPdf(await pdf.save());
  expect(extracted.pageCount).toBe(2);
  expect(extracted.pages.map((p) => p.number)).toEqual([1, 2]);
  expect(extracted.pages[0].text).toContain("only during 2026");
});

test("the PDF engine rejects malformed bytes", async () => {
  await expect(
    extractPdf(new TextEncoder().encode("not a PDF")),
  ).rejects.toThrow();
});
