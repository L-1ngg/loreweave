import { test, expect } from "bun:test";
import { extractPdf } from "../src/server/pdf-engine";
import { buildStandard, mapToc } from "../src/server/standard";
import type { IndexModel } from "../src/server/index-model";
test("TOC offset repair uses original titles and rejects ambiguous or absent anchors", async () => {
  const e = await extractPdf(
    new Uint8Array(
      await Bun.file("tests/fixtures/pdf/toc-offset.pdf").arrayBuffer(),
    ),
  );
  const entries = [
    { title: "1 Overview", label: "1", depth: 0 },
    { title: "2 Results", label: "3", depth: 0 },
    { title: "Appendix", label: "5", depth: 0 },
  ];
  const mapped = mapToc(entries, e, [2]);
  expect(mapped.tree.map((n) => n.start)).toEqual([1, 3, 5, 7]);
  expect(
    mapToc([{ title: "1 Overview", label: "iv", depth: 0 }], e, [2]).repairs,
  ).toHaveLength(1);
  e.pages[2].label = "iv";
  expect(
    mapToc([{ title: "1 Overview", label: "iv", depth: 0 }], e, [2]).repairs,
  ).toHaveLength(0);
  expect(() =>
    mapToc([{ title: "2 Results", label: "999", depth: 0 }], e, [2]),
  ).toThrow("toc_repair_bound_exceeded");
  expect(() =>
    mapToc([{ title: "Invented chapter", label: "1", depth: 0 }], e, [2]),
  ).toThrow("toc_heading_unverified");
  expect(() =>
    mapToc([{ title: "Acme", label: "xx", depth: 0 }], e, [2]),
  ).toThrow("toc_mapping_ambiguous");
});
test("Standard model evidence excludes repeated margins that cannot become verified headings", async () => {
  const e = await extractPdf(
    new Uint8Array(
      await Bun.file("tests/fixtures/pdf/mixed-cjk.pdf").arrayBuffer(),
    ),
  );
  const model: IndexModel = {
    contextChars: 60000,
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    check() {},
    async save() {},
    async ask(task, evidence, schema) {
      expect(task).toBe("no_toc");
      const text = JSON.stringify(evidence);
      const anchor = text.includes("上海公司 年度报告")
        ? "上海公司 年度报告"
        : "1 营业结果";
      return schema.parse({
        headings: [{ title: anchor, anchor, page: 1, depth: 0 }],
      });
    },
  };
  const result = await buildStandard(e, model);
  expect(result.path).toBe("no-toc");
  expect(result.tree[0].title).toBe("1 营业结果");
  expect(result.tree[0].end).toBe(3);
});
