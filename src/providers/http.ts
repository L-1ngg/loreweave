import { currentModelWork, withModelWork } from "../model-admission.ts";
export interface ProviderConfig {
  fetch?: typeof globalThis.fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** One dispatch per call. Domain admission owns retries and the absolute deadline. */
export async function providerJSON(
  config: ProviderConfig,
  path: string,
  body: object,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  try {
    const context = config.fetch ? currentModelWork() : undefined;
    const send = () =>
      (config.fetch ?? fetch)(`${config.baseUrl.replace(/\/$/, "")}/${path}`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, ...body }),
        signal: AbortSignal.any([
          signal,
          ...(!context ? [AbortSignal.timeout(config.timeoutMs)] : []),
        ]),
      });
    const response = context
      ? await withModelWork(
          { ...context, requestTimeoutMs: config.timeoutMs },
          send,
        )
      : await send();
    if (!response.ok) {
      await response.arrayBuffer();
      throw new Error(`provider_http_${response.status}`);
    }
    const result = await response.json();
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof Error &&
      (/^provider_http_\d+$/.test(error.message) ||
        [
          "provider_uncertain",
          "missing_model_work",
          "model_authority_lost",
          "model_capacity_blocked",
        ].includes(error.message))
    )
      throw error;
    // Provider bodies and fetch errors can contain credentials or source text.
    throw new Error("provider_unavailable");
  }
}
