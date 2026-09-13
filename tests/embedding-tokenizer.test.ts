import { expect, test } from "bun:test";
import { loadEmbeddingTokenizer } from "../src/embedding-tokenizer.ts";
import { parseMarkdown } from "../src/markdown.ts";
import { retrievalChunks } from "../src/retrieval-chunks.ts";
// Counts cross-checked with Hugging Face's Rust-backed Python tokenizers on the pinned JSON.
const cases: Array<[string, number]> = [
  ["应用日志保留 30 天。", 11],
  ["Hello world", 4],
  ["```ts\r\nconst x = 42;\r\n```", 13],
  ["👩🏽‍💻 ＡＢＣ ㍻", 10],
  ["|项目|说明|\r\n|---|---|\r\n|甲|两天|", 20],
  ["- Production: logs 30 days.\n- Staging: logs 7 days.", 19],
];
test("AC27: pinned BGE tokenizer agrees with independent counts and bounds complete structural inputs", async () => {
  const counter = await loadEmbeddingTokenizer("BAAI/bge-m3");
  for (const [text, count] of cases) expect(counter.count(text)).toBe(count);
  const text =
    "# 配置\r\n\r\n" + cases.map(([text]) => text.repeat(250)).join("\r\n\r\n");
  const parsed = parseMarkdown(new TextEncoder().encode(text));
  const chunks = retrievalChunks(parsed, counter);
  expect(chunks.length).toBeGreaterThan(5);
  expect(chunks.every((chunk) => counter.count(chunk.text) <= 768)).toBe(true);
  for (const chunk of chunks)
    for (const span of chunk.spans)
      expect(text.slice(span.start, span.end)).toBe(span.text);
});
