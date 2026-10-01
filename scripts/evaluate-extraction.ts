import { extractPdf, PdfFailure } from "../src/server/pdf-engine";
import { hashData } from "../src/server/library";
const reference = await Bun.file(
  "docs/evaluation/pageindex-reference.json",
).json();
const records = [];
const characters = (text: string) =>
  Array.from(text.normalize("NFKC").replace(/\s/g, "")).sort().join("");
for (const fixture of reference.fixtures) {
  const bytes = new Uint8Array(
    await Bun.file(`tests/fixtures/pdf/${fixture.file}`).arrayBuffer(),
  );
  if (hashData(bytes) !== fixture.sha256)
    throw new Error("comparison_fixture_mismatch");
  try {
    const result = await extractPdf(bytes);
    const refText = (fixture.pages ?? []).join("");
    const text = result.pages.map((p) => p.text).join("");
    records.push({
      file: fixture.file,
      sha256: fixture.sha256,
      ts: "extracted",
      pageCount: result.pageCount,
      referencePageCount: fixture.pageCount ?? null,
      sameCharacterContent: characters(refText) === characters(text),
      sameOrder: refText.replace(/\s/g, "") === text.replace(/\s/g, ""),
      diagnostics: result.diagnostics,
    });
  } catch (e) {
    records.push({
      file: fixture.file,
      sha256: fixture.sha256,
      ts: e instanceof PdfFailure ? e.code : "failed",
      reference:
        fixture.extractionError ??
        (fixture.pages?.every((p: string) => !p.trim())
          ? "empty_text"
          : "extracted"),
    });
  }
}
const report = {
  date: new Date().toISOString(),
  reference: reference.reference,
  fixtures: records.length,
  extracted: records.filter((r) => r.ts === "extracted").length,
  rejected: records.filter((r) => r.ts !== "extracted").length,
  records,
  tolerances:
    "Physical page count and non-whitespace character preservation are exact. Known two-column order is checked against fixture-authored source order; PyPDF2 content-stream order is recorded as a difference. No tree-shape or model-quality threshold is inferred from this extraction comparison.",
};
await Bun.write(
  "docs/evaluation/pageindex-extraction.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
