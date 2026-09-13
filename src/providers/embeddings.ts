import { setTimeout as pause } from "node:timers/promises";
import { hash } from "../answer-validation.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "../embeddings.ts";
import { record } from "../answer-validation.ts";
import { providerJSON, type ProviderConfig } from "./http.ts";

export interface EmbeddingConfig extends ProviderConfig {
  dimensions: number;
  batchSize: number;
  sendDimensions: boolean;
  revision?: string;
}
export class OpenAIEmbeddings implements EmbeddingAdapter {
  readonly dimensions: number;
  readonly batchSize: number;
  readonly profile: string;
  constructor(
    private readonly config: EmbeddingConfig,
    readonly inputCounter?: import("../embedding-tokenizer.ts").InputCounter,
  ) {
    this.dimensions = config.dimensions;
    this.batchSize = Math.min(32, config.batchSize);
    this.profile = `openai-embeddings:${config.model}:${config.dimensions}:${hash({ deployment: config.baseUrl, revision: config.revision ?? config.model, normalization: "cosine", input: inputCounter?.profile ?? "legacy-original-v1", role: "symmetric" })}`;
    if (
      !Number.isSafeInteger(config.batchSize) ||
      config.batchSize < 1 ||
      !Number.isSafeInteger(this.dimensions) ||
      this.dimensions < 1
    )
      throw new Error("invalid_embedding_config");
  }
  async embed(
    texts: string[],
    signal: AbortSignal,
    checkpoint?: (indices: number[], vectors: number[][]) => Promise<void>,
  ): Promise<number[][]> {
    signal.throwIfAborted();
    if (
      this.inputCounter &&
      texts.some(
        (text) => this.inputCounter!.count(text) > this.inputCounter!.maxInput,
      )
    )
      throw new Error("embedding_input_limit");
    const vectors: number[][] = [];
    const send = async (
      batch: string[],
      indices: number[],
      attempt = 0,
    ): Promise<number[][]> => {
      signal.throwIfAborted();
      let raw: unknown;
      try {
        raw = await providerJSON(
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
      } catch (error) {
        signal.throwIfAborted();
        // Only an explicit HTTP size rejection permits subdivision; schema/auth errors never do.
        if (
          error instanceof Error &&
          error.message === "provider_http_413" &&
          batch.length > 1
        ) {
          const middle = Math.ceil(batch.length / 2);
          const left = await send(
            batch.slice(0, middle),
            indices.slice(0, middle),
            attempt,
          );
          return [
            ...left,
            ...(await send(
              batch.slice(middle),
              indices.slice(middle),
              attempt,
            )),
          ];
        }
        if (
          error instanceof Error &&
          /^provider_http_(429|5\d\d)$/.test(error.message) &&
          attempt < 2
        ) {
          await pause(
            250 * 2 ** attempt + Math.floor(Math.random() * 100),
            undefined,
            { signal },
          );
          return send(batch, indices, attempt + 1);
        }
        throw error;
      }
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
      await checkpoint?.(indices, ordered);
      return ordered;
    };
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      vectors.push(
        ...(await send(
          batch,
          batch.map((_, index) => offset + index),
        )),
      );
    }
    return vectors;
  }
}
