import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const base = {
  DATABASE_URL: "postgres://localhost/loreweave",
  LOREWEAVE_PROVIDER_MODE: "scripted",
  RAG_DATABASE_URL: "postgresql+asyncpg://retired/python",
};

describe("runtime configuration", () => {
  test("uses the current database contract and ignores retired database settings", () => {
    const config = loadConfig(base);
    expect(config.databaseUrl).toBe(base.DATABASE_URL);
    expect(config).not.toHaveProperty("legacyDatabaseUrl");
  });

  test("validates provider mode before runtime composition", () => {
    expect(() =>
      loadConfig({ ...base, LOREWEAVE_PROVIDER_MODE: "legacy" }),
    ).toThrow("invalid_config:LOREWEAVE_PROVIDER_MODE");
  });

  test("requires complete provider settings in real mode", () => {
    expect(() =>
      loadConfig({ ...base, LOREWEAVE_PROVIDER_MODE: "real" }),
    ).toThrow("invalid_config:RAG_CHAT_BASE_URL");
  });
});
