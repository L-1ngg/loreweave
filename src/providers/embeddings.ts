import { validateEmbeddings, type EmbeddingAdapter } from "../embeddings.ts";
import { record } from "../answer-validation.ts";
import { providerJSON, type ProviderConfig } from "./http.ts";

export interface EmbeddingConfig extends ProviderConfig {
  dimensions: number;
  batchSize: number;
  sendDimensions: boolean;
}
export class OpenAIEmbeddings implements EmbeddingAdapter {
  readonly dimensions: number;
  readonly profile: string;
  constructor(private readonly config: EmbeddingConfig) {
    this.dimensions = config.dimensions;
    this.profile = `openai-embeddings:${config.model}:${config.dimensions}:v1`;
    if (
      !Number.isSafeInteger(config.batchSize) ||
      config.batchSize < 1 ||
      !Number.isSafeInteger(this.dimensions) ||
      this.dimensions < 1
    )
      throw new Error("invalid_embedding_config");
  }
  async embed(texts: string[], signal: AbortSignal): Promise<number[][]> {
    signal.throwIfAborted();
    const vectors: number[][] = [];
    for (
      let offset = 0;
      offset < texts.length;
      offset += this.config.batchSize
    ) {
      const batch = texts.slice(offset, offset + this.config.batchSize);
      const raw = await providerJSON(
        this.config,
        "embeddings",
        {
          input: batch,
          encoding_format: "float",
          ...(this.config.sendDimensions
            ? { dimensions: this.dimensions }
            : {}),
        },
        signal,
      );
      if (
        !record(raw) ||
        !Array.isArray(raw.data) ||
        raw.data.length !== batch.length
      )
        throw new Error("invalid_embedding");
      const indexed = new Map<number, number[]>();
      for (const item of raw.data) {
        if (
          !record(item) ||
          !Number.isInteger(item.index) ||
          Number(item.index) < 0 ||
          Number(item.index) >= batch.length ||
          indexed.has(Number(item.index)) ||
          !Array.isArray(item.embedding) ||
          item.embedding.some((value) => typeof value !== "number")
        )
          throw new Error("invalid_embedding");
        indexed.set(Number(item.index), item.embedding as number[]);
      }
      const ordered = batch.map((_, index) => indexed.get(index)!);
      validateEmbeddings(ordered, batch.length, this.dimensions);
      vectors.push(...ordered);
    }
    return vectors;
  }
}
