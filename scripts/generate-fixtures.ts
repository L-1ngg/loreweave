import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFNumber,
  PDFString,
  degrees,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { mkdir } from "node:fs/promises";
import { hashData } from "../src/server/library";

const directory = "tests/fixtures/pdf";
const fontPath = process.env.LOREWEAVE_FIXTURE_FONT?.trim();
if (!fontPath)
  throw new Error(
    "Set LOREWEAVE_FIXTURE_FONT to the pinned Noto Sans SC font file; see docs/development/testing.md#regenerating-fixtures.",
  );
const fontBytes = new Uint8Array(await Bun.file(fontPath).arrayBuffer());
if (
  hashData(fontBytes) !==
  "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"
)
  throw new Error("fixture_font_hash_changed");
await mkdir(directory, { recursive: true });
const manifest: Array<Record<string, unknown>> = [];
async function create(name: string, pages: number, kind: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(name);
  pdf.setAuthor("LoreWeave acceptance fixtures");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.registerFontkit(fontkit);
  const chinese =
    kind === "cjk" ? await pdf.embedFont(fontBytes, { subset: true }) : regular;
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([612, 792]);
    const draw = (
      text: string,
      x: number,
      y: number,
      size = 11,
      heading = false,
    ) =>
      page.drawText(text, {
        x,
        y,
        size,
        font: kind === "cjk" ? chinese : heading ? bold : regular,
      });
    if (kind === "scanned") {
      page.drawRectangle({
        x: 70,
        y: 100,
        width: 450,
        height: 600,
        color: rgb(0.8, 0.8, 0.8),
      });
      continue;
    }
    if (kind === "rotated") {
      page.setRotation(degrees(90));
      page.drawText("1 Rotated source", {
        x: 510,
        y: 70,
        size: 22,
        font: bold,
        rotate: degrees(90),
      });
      page.drawText(
        "Physical rotation does not change the revenue: 120 million.",
        { x: 475, y: 70, size: 12, font: regular, rotate: degrees(90) },
      );
      continue;
    }
    draw(
      kind === "cjk" ? "上海公司 年度报告" : "LOREWEAVE FIXED EVIDENCE",
      50,
      772,
      9,
    );
    draw(
      kind === "cjk" ? `物理页 ${i + 1}` : `Physical page ${i + 1}`,
      50,
      20,
      9,
    );
    if (kind === "columns") {
      draw(`${i + 1} Two-column Analysis`, 50, 724, 22, true);
      for (let row = 0; row < 8; row++) {
        draw(`Left step ${row + 1}. Qualified source.`, 50, 676 - row * 26, 11);
        draw(`Right step ${row + 1}. Other source.`, 330, 676 - row * 26, 11);
      }
      draw("Only audited totals apply.", 50, 38, 10);
      continue;
    }
    if (kind === "cjk") {
      draw(`${i + 1} 营业结果`, 50, 725, 22, true);
      draw("上海公司2026年收入为120万元，仅指境内业务。", 50, 670, 12);
      draw("2025年收入为100万元；不同币种不得合并。", 50, 644, 12);
      continue;
    }
    if (kind === "toc") {
      if (i === 0) {
        draw("Annual Report 2026", 50, 725, 24, true);
        draw("Front matter and qualifications are retained.", 50, 670);
        continue;
      }
      if (i === 1) {
        draw("Contents", 50, 725, 22, true);
        draw("1 Overview ....................................... 1", 50, 666);
        draw("2 Results ......................................... 3", 50, 638);
        draw("Appendix .......................................... 5", 50, 610);
        continue;
      }
      if (i === 2) draw("1 Overview", 50, 725, 22, true);
      if (i === 4) draw("2 Results", 50, 725, 22, true);
      if (i === 6) draw("Appendix", 50, 725, 22, true);
    } else if (kind === "large") {
      if (i === 0) draw("1 Operating Results", 50, 725, 22, true);
      if (i === 10) draw("Regional Operating Details", 50, 690, 11);
    } else if (kind === "flat") {
      draw("Continuous narrative about a supported text layer.", 50, 690, 11);
    } else if (i === 0) draw("Annual Report 2026", 50, 725, 24, true);
    else if (i === 1 || (kind === "no-toc" && i === 0))
      draw("1 Overview", 50, 725, 22, true);
    else if (i === Math.floor(pages / 2)) draw("2 Results", 50, 725, 22, true);
    else if (i === pages - 1) draw("Appendix", 50, 725, 22, true);
    const facts =
      i < Math.floor(pages / 2)
        ? [
            "Acme 2026 revenue was 120 million USD.",
            "It covers domestic operations only, not subsidiaries.",
            "Acme 2026 net profit was 12 million USD.",
          ]
        : [
            "Acme 2025 revenue was 100 million USD.",
            "Acme 2025 net profit was 9 million USD.",
            "These are audited domestic-only totals.",
          ];
    for (let row = 0; row < (kind === "large" ? 22 : 9); row++)
      draw(facts[row % facts.length], 50, 650 - row * 24, 11);
    if (kind === "bookmarks" && i === 1) draw("1.1 Scope", 50, 696, 16, true);
  }
  if (kind === "toc")
    pdf.catalog.set(
      PDFName.of("PageLabels"),
      pdf.context.obj({
        Nums: [
          0,
          { S: PDFName.of("r"), St: PDFNumber.of(1) },
          2,
          { S: PDFName.of("D"), St: PDFNumber.of(1) },
        ],
      }),
    );
  if (kind === "bookmarks") {
    const root = pdf.context.obj({ Type: PDFName.of("Outlines") });
    const rootRef = pdf.context.register(root);
    const first = pdf.context.obj({
      Title: PDFString.of("1 Overview"),
      Parent: rootRef,
      Dest: [pdf.getPages()[1].ref, PDFName.of("Fit")],
    });
    const firstRef = pdf.context.register(first);
    const second = pdf.context.obj({
      Title: PDFString.of("Nonexistent claims"),
      Parent: rootRef,
      Dest: [pdf.getPages()[2].ref, PDFName.of("Fit")],
      Prev: firstRef,
    });
    const secondRef = pdf.context.register(second);
    first.set(PDFName.of("Next"), secondRef);
    root.set(PDFName.of("First"), firstRef);
    root.set(PDFName.of("Last"), secondRef);
    root.set(PDFName.of("Count"), PDFNumber.of(2));
    pdf.catalog.set(PDFName.of("Outlines"), rootRef);
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  await Bun.write(`${directory}/${name}.pdf`, bytes);
  manifest.push({
    file: `${name}.pdf`,
    sha256: hashData(bytes),
    pages,
    kind,
    origin:
      "Generated from scripts/generate-fixtures.ts; fixed original facts and layout",
    expected:
      kind === "scanned"
        ? "unsupported"
        : kind === "flat"
          ? "Flash structural failure"
          : "shared extraction",
  });
}
for (const [name, pages, kind] of [
  ["single-column", 6, "single"],
  ["multi-column", 4, "columns"],
  ["mixed-cjk", 3, "cjk"],
  ["rotated", 1, "rotated"],
  ["bookmarks", 6, "bookmarks"],
  ["toc-offset", 8, "toc"],
  ["no-toc", 21, "no-toc"],
  ["large-section", 24, "large"],
  ["inadequate", 25, "flat"],
  ["scanned", 2, "scanned"],
] as const)
  await create(name, pages, kind);
const encrypted = new Uint8Array(
  await Bun.file(`${directory}/encrypted.pdf`).arrayBuffer(),
);
manifest.push({
  file: "encrypted.pdf",
  sha256: hashData(encrypted),
  pages: 6,
  kind: "encrypted",
  expected: "unsupported",
  origin:
    "qpdf 12.2.0 --encrypt fixture-password fixture-owner 256 -- single-column.pdf encrypted.pdf; fixed committed bytes",
});
const malformed = new TextEncoder().encode(
  "This is a frozen malformed PDF, not valid source evidence.\n",
);
await Bun.write(`${directory}/malformed.pdf`, malformed);
manifest.push({
  file: "malformed.pdf",
  sha256: hashData(malformed),
  pages: 0,
  kind: "malformed",
  expected: "failed",
});
await Bun.write(
  `${directory}/manifest.json`,
  JSON.stringify(
    {
      revision: "2026-10-01-v1",
      font: {
        name: "NotoSansSC[wght].ttf",
        sha256: hashData(fontBytes),
        license: "SIL Open Font License 1.1",
        url: "https://github.com/google/fonts/tree/main/ofl/notosanssc",
      },
      fixtures: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Frozen ${manifest.length} fixtures with SHA-256 provenance.`);
