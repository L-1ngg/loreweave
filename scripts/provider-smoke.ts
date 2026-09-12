import { providerConfig } from "../src/providers/config.ts";
import { loadConfig } from "../src/config.ts";
import { runProviderSmoke } from "../src/evaluation/provider-smoke.ts";

// Explicit opt-in command. Only generated sample text is sent; use an isolated DB.
const url = loadConfig().testDatabaseUrl;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL must point to a disposable isolated database",
  );
await runProviderSmoke(url, providerConfig(process.env));
