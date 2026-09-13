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

test("source preparation duration defaults to 30 minutes and validates configured seconds", () => {
  expect(loadConfig(base).preparationDeadlineMs).toBe(1800000);
  expect(
    loadConfig({ ...base, LOREWEAVE_SOURCE_PREPARATION_SECONDS: "60" })
      .preparationDeadlineMs,
  ).toBe(60000);
  for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "86401"])
    expect(() =>
      loadConfig({ ...base, LOREWEAVE_SOURCE_PREPARATION_SECONDS: value }),
    ).toThrow("invalid_config:LOREWEAVE_SOURCE_PREPARATION_SECONDS");
});
