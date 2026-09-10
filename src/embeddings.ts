export interface EmbeddingAdapter {
  readonly profile: string;
  readonly dimensions: number;
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>;
}
export function validateEmbeddings(
  vectors: number[][],
  count: number,
  dimensions: number,
): void {
  if (
    vectors.length !== count ||
    vectors.some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length !== dimensions ||
        vector.some((value) => !Number.isFinite(value)) ||
        !vector.some((value) => value !== 0),
    )
  )
    throw new Error("invalid_embedding");
}
