import { test, expect } from "bun:test";
import { extractPdf } from "../src/server/pdf-engine";
import { hashData } from "../src/server/library";

test("frozen PDF bytes preserve columns, CJK, labels, margins and trustworthy outlines", async () => {
  const manifest = await Bun.file("tests/fixtures/pdf/manifest.json").json();
  for (const fixture of manifest.fixtures) {
    const bytes = new Uint8Array(
      await Bun.file(`tests/fixtures/pdf/${fixture.file}`).arrayBuffer(),
    );
    expect(hashData(bytes)).toBe(fixture.sha256);
    if (["scanned", "malformed", "encrypted"].includes(fixture.kind)) {
      await expect(extractPdf(bytes)).rejects.toThrow();
      continue;
    }
    const result = await extractPdf(bytes);
    expect(result.pageCount).toBe(fixture.pages);
    if (fixture.kind === "columns") {
      expect(result.pages[0].columns).toBe(2);
      expect(result.pages[0].text.indexOf("Left step 8")).toBeLessThan(
        result.pages[0].text.indexOf("Right step 1"),
      );
      expect(result.pages[0].text).toContain("Only audited totals apply.");
      expect(
        result.pages[0].text.indexOf("Only audited totals apply."),
      ).toBeGreaterThan(result.pages[0].text.indexOf("Right step 8"));
      expect(result.pages[0].text).toContain("LOREWEAVE FIXED EVIDENCE");
      expect(result.pages[0].navigationText).not.toContain(
        "LOREWEAVE FIXED EVIDENCE",
      );
    }
    if (fixture.kind === "cjk")
      expect(result.pages[0].text).toContain(
        "上海公司2026年收入为120万元，仅指境内业务。",
      );
    if (fixture.kind === "toc")
      expect(result.pages.map((p) => p.label)).toEqual([
        "i",
        "ii",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
      ]);
    if (fixture.kind === "rotated") {
      expect(result.pages[0].rotation).toBe(90);
      expect(result.pages[0].text).toContain("120 million");
    }
    if (fixture.kind === "bookmarks")
      expect(result.outlines.map((o) => o.verified)).toEqual([true, false]);
  }
});
