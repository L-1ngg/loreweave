import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:41735", headless: true },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:41735",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
