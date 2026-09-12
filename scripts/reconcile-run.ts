import { PostgresConversations } from "../src/conversations.ts";
import { loadConfig } from "../src/config.ts";
const config = loadConfig();
const [id, confirmation] = process.argv.slice(2);
if (
  !id ||
  !/^[0-9a-f-]{36}$/i.test(id) ||
  (confirmation && confirmation !== "--execution-terminated")
)
  throw new Error(
    "Usage: bun run reconcile:run RUN_ID [--execution-terminated]",
  );
if (!config.databaseUrl) throw new Error("missing_config:DATABASE_URL");
const store = new PostgresConversations(config.databaseUrl);
try {
  const run = await store.reconcile(
    id,
    confirmation ? { executionTerminated: true } : {},
  );
  console.log(JSON.stringify(run, null, 2));
} finally {
  await store.close();
}
