import { PostgresConversations } from "../src/conversations.ts";
const [id, confirmation] = process.argv.slice(2);
if (
  !id ||
  !/^[0-9a-f-]{36}$/i.test(id) ||
  (confirmation && confirmation !== "--execution-terminated")
)
  throw new Error(
    "Usage: bun run reconcile:run RUN_ID [--execution-terminated]",
  );
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = new PostgresConversations(process.env.DATABASE_URL);
try {
  const run = await store.reconcile(
    id,
    confirmation ? { executionTerminated: true } : {},
  );
  console.log(JSON.stringify(run, null, 2));
} finally {
  await store.close();
}
