import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { bgeTokenizer } from "../src/embedding-tokenizer.ts";
const directory = ".cache/tokenizers/bge-m3";
await mkdir(directory, { recursive: true });
for (const [file, expected] of Object.entries(bgeTokenizer.files)) {
  const response = await fetch(
    `https://huggingface.co/${bgeTokenizer.model}/resolve/${bgeTokenizer.revision}/${file}`,
  );
  if (!response.ok) throw new Error(`tokenizer_download_${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(content).digest("hex") !== expected)
    throw new Error("tokenizer_hash_mismatch");
  await writeFile(`${directory}/${file}`, content);
}
console.log(
  `Prepared verified ${bgeTokenizer.model} tokenizer at ${bgeTokenizer.revision}.`,
);
