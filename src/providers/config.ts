import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ProviderConfig } from "./http.ts";
import type { EmbeddingConfig } from "./embeddings.ts";

/** Read only the explicitly selected provider settings, never legacy database URLs. */
export function providerConfig(env: Record<string, string | undefined>) {
  function required(key: string) {
    const value = env[key]?.trim();
    if (!value) throw new Error(`missing_config:${key}`);
    return value;
  }
  function integer(key: string, fallback: number, max: number) {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`invalid_config:${key}`);
    return value;
  }
  function endpoint(key: string) {
    let url: URL;
    try {
      url = new URL(required(key));
    } catch {
      throw new Error(`invalid_config:${key}`);
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(`invalid_config:${key}`);
    return url.toString().replace(/\/$/, "");
  }
  const chat: ProviderConfig = {
    baseUrl: endpoint("RAG_CHAT_BASE_URL"),
    apiKey: required("RAG_CHAT_API_KEY"),
    model: required("RAG_CHAT_MODEL"),
    timeoutMs: integer("RAG_CHAT_TIMEOUT_SECONDS", 45, 300) * 1000,
  };
  // A catalog entry selects the SDK wire protocol; baseUrl still targets the configured service.
  const provider = env.LOREWEAVE_CHAT_PROVIDER ?? "huggingface";
  const model = builtinModels().getModel(provider, chat.model);
  if (!model || model.api !== "openai-completions")
    throw new Error("unsupported_chat_catalog_model");
  const send = env.RAG_EMBEDDING_SEND_DIMENSIONS ?? "false";
  if (send !== "true" && send !== "false")
    throw new Error("invalid_config:RAG_EMBEDDING_SEND_DIMENSIONS");
  const embedding: EmbeddingConfig = {
    baseUrl: endpoint("RAG_EMBEDDING_BASE_URL"),
    apiKey: required("RAG_EMBEDDING_API_KEY"),
    model: required("RAG_EMBEDDING_MODEL"),
    dimensions: integer("RAG_EMBEDDING_DIMENSIONS", 1024, 16000),
    batchSize: integer("RAG_EMBEDDING_BATCH_SIZE", 16, 128),
    sendDimensions: send === "true",
    timeoutMs: 45000,
  };
  return {
    chat,
    embedding,
    exploration: {
      provider,
      model: chat.model,
      apiKey: chat.apiKey,
      baseUrl: chat.baseUrl,
    },
  };
}
