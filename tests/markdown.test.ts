import { expect, test } from "bun:test";
import { parseMarkdown } from "../src/markdown.ts";

test("Markdown preserves exact decoded spans, heading paths, tables, code and image references", () => {
  const original =
    "---\r\ntitle: 运维\r\n---\r\n# 项目说明\r\n\r\n- 日志保留 30 天\r\n- 使用 GraphRAG\r\n\r\n| 服务 | 周期 |\r\n| --- | --- |\r\n| API | 每日 |\r\n\r\n```ts\r\nconst id = 'SKU-004';\r\n```\r\n\r\n![架构示意](https://example.invalid/diagram.png)\r\n";
  const parsed = parseMarkdown(new TextEncoder().encode(original));
  expect(parsed.decoded).toBe(original);
  expect(parsed.passages.map((passage) => passage.kind)).toEqual([
    "metadata",
    "heading",
    "list",
    "table",
    "code",
    "paragraph",
  ]);
  expect(parsed.passages[3]!.headingPath).toEqual(["项目说明"]);
  expect(parsed.passages[4]!.text).toContain(
    "```ts\r\nconst id = 'SKU-004';\r\n```",
  );
  expect(parsed.passages[5]!.text).toContain(
    "https://example.invalid/diagram.png",
  );
  for (const passage of parsed.passages)
    expect(original.slice(passage.start, passage.end)).toBe(passage.text);
});

test("derived Chinese lexical terms preserve mixed technical identifiers without rewriting evidence", async () => {
  const { lexicalText } = await import("../src/indexing.ts");
  const original =
    "星河项目使用 GraphRAG 与 PostgreSQL；API 通过 HTTP/2 查询 SKU-004，应用日志保留 30 天。";
  const terms = lexicalText(original).split(/\s+/);
  expect(terms).toContain("graphrag");
  expect(terms).toContain("postgresql");
  expect(terms).toContain("http/2");
  expect(terms).toContain("sku-004");
  expect(terms).toContain("日志");
  expect(terms).toContain("30");
  expect(
    parseMarkdown(new TextEncoder().encode(original)).passages[0]!.text,
  ).toBe(original);
});

test("reference-style links retain definition locators and document context for rendering", async () => {
  const original =
    "![部署图][diagram]\n\n参阅[手册][manual]。\n\n[diagram]: https://example.invalid/architecture.png\n[manual]: https://example.invalid/manual\n";
  const parsed = parseMarkdown(new TextEncoder().encode(original));
  expect(
    parsed.passages.some(
      (p) =>
        p.kind === "reference" &&
        p.text.includes("https://example.invalid/architecture.png"),
    ),
  ).toBe(true);
  for (const passage of parsed.passages)
    expect(original.slice(passage.start, passage.end)).toBe(passage.text);
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { Markdown, markdownContext } = await import("../web/markdown.tsx");
  const context = markdownContext(original);
  const html = renderToStaticMarkup(
    createElement(Markdown, { text: parsed.passages[0]!.text, context }),
  );
  expect(html).toContain('href="https://example.invalid/architecture.png"');
  expect(html).toContain("部署图");
  expect(html).not.toContain("<img");
  expect(
    renderToStaticMarkup(
      createElement(Markdown, { text: parsed.passages[1]!.text, context }),
    ),
  ).toContain('href="https://example.invalid/manual"');
});
