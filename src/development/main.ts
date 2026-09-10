import { PostgresConversations } from "../conversations.ts";
import { KnowledgeHost } from "../host.ts";
import { createApp } from "../http.ts";
import { startScriptedProvider } from "./provider.ts";
import { FixtureSources } from "./sources.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set DATABASE_URL to a dedicated LoreWeave PostgreSQL database. See README.",
  );
const conversations = new PostgresConversations(databaseUrl);
await conversations.migrate();
const provider = startScriptedProvider({ delayMs: 120 });
const sources = new FixtureSources();
const host = new KnowledgeHost({
  providerUrl: provider.url,
  sources,
  conversations,
});
const app = createApp(host, sources, {
  browserOrigin: "http://127.0.0.1:41735",
});
let server: ReturnType<typeof Bun.serve> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host.close();
  server?.stop(true);
  provider.stop();
  await conversations.close();
}
try {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 41736,
    maxRequestBodySize: 32768,
    fetch: (request) => app.fetch(request),
  });
  console.log("LoreWeave fixture API: http://127.0.0.1:41736");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void close().then(() => process.exit(0));
    });
} catch (error) {
  await close();
  throw error;
}
