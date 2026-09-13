import { Tokenizer } from "@huggingface/tokenizers";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface InputCounter {
  profile: string;
  unit: "tokens" | "utf8-bytes";
  count(text: string): number;
  maxInput: number;
}
/** Only controlled adapters use this byte profile; it makes no token-count claim. */
export const controlledInputCounter: InputCounter = {
  profile: "controlled-utf8-bytes-v1",
  unit: "utf8-bytes",
  maxInput: 8192,
  count: (text) => new TextEncoder().encode(text).length,
};
export const bgeTokenizer = {
  model: "BAAI/bge-m3",
  revision: "5617a9f61b028005a4858fdac845db406aefb181",
  files: {
    "tokenizer.json":
      "21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08",
    "tokenizer_config.json":
      "a62b2b6784f990259fddef5f16388693a8043be4f69179e6a5257eeb3f9abac4",
  },
};
export async function loadEmbeddingTokenizer(
  model: string,
  directory = ".cache/tokenizers/bge-m3",
): Promise<InputCounter> {
  if (model !== bgeTokenizer.model)
    throw new Error("embedding_tokenizer_not_validated");
  const loaded = await Promise.all(
    Object.entries(bgeTokenizer.files).map(async ([name, expected]) => {
      const data = await readFile(`${directory}/${name}`).catch(() => {
        throw new Error("embedding_tokenizer_missing:run_prepare_tokenizer");
      });
      if (createHash("sha256").update(data).digest("hex") !== expected)
        throw new Error("embedding_tokenizer_hash_mismatch");
      return JSON.parse(data.toString());
    }),
  );
  const tokenizer = new Tokenizer(loaded[0], loaded[1]);
  return {
    profile: `bge-m3:${bgeTokenizer.revision}:tokenizers-js-0.2.0`,
    unit: "tokens",
    maxInput: 8192,
    count: (text) => tokenizer.encode(text).ids.length,
  };
}
