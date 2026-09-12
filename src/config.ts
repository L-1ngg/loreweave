import {
  providerConfig,
  type ProviderRuntimeConfig,
} from "./providers/config.ts";

export type RuntimeConfig = {
  databaseUrl?: string;
  testDatabaseUrl?: string;
  providerMode: "scripted" | "real";
  organization: string;
  bootstrap?: { username: string; password: string };
  retrievalProfile: "source" | "wiki" | "graph" | "combined";
  provider?: ProviderRuntimeConfig;
  evaluation: {
    token?: string;
    updateToken?: string;
    provenance?: "controlled-provider" | "real-provider";
  };
};

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`missing_config:${key}`);
    return value;
  };
  const providerMode = env.LOREWEAVE_PROVIDER_MODE ?? "scripted";
  if (providerMode !== "scripted" && providerMode !== "real")
    throw new Error("invalid_config:LOREWEAVE_PROVIDER_MODE");
  const retrievalProfile = env.LOREWEAVE_RETRIEVAL_PROFILE ?? "source";
  if (!["source", "wiki", "graph", "combined"].includes(retrievalProfile))
    throw new Error("invalid_config:LOREWEAVE_RETRIEVAL_PROFILE");
  const password = env.LOREWEAVE_BOOTSTRAP_PASSWORD?.trim();
  return {
    ...(env.DATABASE_URL?.trim()
      ? { databaseUrl: env.DATABASE_URL.trim() }
      : {}),
    ...(env.TEST_DATABASE_URL
      ? { testDatabaseUrl: env.TEST_DATABASE_URL.trim() }
      : {}),
    providerMode,
    organization: env.LOREWEAVE_ORGANIZATION?.trim() || "local",
    ...(password
      ? {
          bootstrap: {
            username: env.LOREWEAVE_BOOTSTRAP_USERNAME?.trim() || "admin",
            password,
          },
        }
      : {}),
    retrievalProfile: retrievalProfile as RuntimeConfig["retrievalProfile"],
    ...(providerMode === "real" ? { provider: providerConfig(env) } : {}),
    evaluation: {
      ...(env.LOREWEAVE_EVAL_TOKEN
        ? { token: env.LOREWEAVE_EVAL_TOKEN.trim() }
        : {}),
      ...(env.LOREWEAVE_UPDATE_TOKEN
        ? { updateToken: env.LOREWEAVE_UPDATE_TOKEN.trim() }
        : {}),
      ...(env.LOREWEAVE_EVAL_PROVENANCE === "controlled-provider" ||
      env.LOREWEAVE_EVAL_PROVENANCE === "real-provider"
        ? { provenance: env.LOREWEAVE_EVAL_PROVENANCE }
        : {}),
    },
  };
}

export function loadEvaluationConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const config = loadConfig(env);
  return { ...config.evaluation, testDatabaseUrl: config.testDatabaseUrl };
}
