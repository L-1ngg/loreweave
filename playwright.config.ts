import { defineConfig } from "@playwright/test";
import { loadLocalConfiguration } from "./scripts/configuration";
import postgres from "postgres";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

await loadLocalConfiguration();
if (!process.env.LOREWEAVE_BROWSER_DATABASE) {
  const testUrl = new URL(process.env.LOREWEAVE_DATABASE_URL!);
  const testDatabase = `loreweave_pageindex_browser_${process.pid}`;
  testUrl.pathname = "/postgres";
  const admin = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${testDatabase}"`);
  await admin.end();
  testUrl.pathname = `/${testDatabase}`;
  process.env.LOREWEAVE_DATABASE_URL = testUrl.toString();
  process.env.LOREWEAVE_BROWSER_DATABASE = testDatabase;
  process.env.LOREWEAVE_ARTIFACT_DIRECTORY = await mkdtemp(
    join(tmpdir(), "loreweave-pageindex-browser-"),
  );
}
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  globalTeardown: "./tests/support/browser-teardown.ts",
  use: { baseURL: "http://127.0.0.1:41739", headless: true },
  webServer: {
    command: "bun run start",
    env: { LOREWEAVE_PORT: "41739", LOREWEAVE_MODE: "fixture" },
    url: "http://127.0.0.1:41739",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
