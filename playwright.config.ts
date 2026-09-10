import { defineConfig } from "@playwright/test";
if (!process.env.TEST_DATABASE_URL)
  throw new Error("TEST_DATABASE_URL must point to an isolated test database");
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:41735", headless: true },
  webServer: {
    command: "bun run dev",
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOREWEAVE_ORGANIZATION: "browser-test",
      LOREWEAVE_BOOTSTRAP_USERNAME: "browser-admin",
      LOREWEAVE_BOOTSTRAP_PASSWORD: "browser-fixture-password",
    },
    url: "http://127.0.0.1:41735",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
