import { createHash } from "node:crypto";
import type { EmbeddingAdapter } from "../embeddings.ts";
/** Deterministic storage/integration fixture; not a semantic retrieval model. */
export class ControlledEmbeddings implements EmbeddingAdapter {
  readonly profile = "controlled-sha256-v1";
  readonly dimensions = 8;
  async embed(texts: string[], signal: AbortSignal): Promise<number[][]> {
    signal.throwIfAborted();
    return texts.map((text) =>
      Array.from(
        createHash("sha256").update(text).digest().subarray(0, 8),
        (byte) => (byte + 1) / 256,
      ),
    );
  }
}
