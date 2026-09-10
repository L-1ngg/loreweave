import { AccessService } from "../access.ts";
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
const access = new AccessService(databaseUrl);
const conversations = new PostgresConversations(databaseUrl);
let host: KnowledgeHost | undefined;
let provider: ReturnType<typeof startScriptedProvider> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host?.close();
  server?.stop(true);
  provider?.stop();
  await conversations.close();
  await access.close();
}
try {
  await access.migrate();
  const organization = process.env.LOREWEAVE_ORGANIZATION ?? "local";
  if (process.env.LOREWEAVE_BOOTSTRAP_PASSWORD) {
    await access.bootstrap({
      organization,
      username: process.env.LOREWEAVE_BOOTSTRAP_USERNAME ?? "admin",
      password: process.env.LOREWEAVE_BOOTSTRAP_PASSWORD,
    });
  }
  const sources = new FixtureSources({
    organizationId: await access.organization(organization),
  });
  provider = startScriptedProvider({ delayMs: 120 });
  host = new KnowledgeHost({
    providerUrl: provider.url,
    sources,
    conversations,
    access,
  });
  const app = createApp(host, sources, {
    browserOrigin: "http://127.0.0.1:41735",
    access,
  });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 41736,
    maxRequestBodySize: 32768,
    fetch: (request) => app.fetch(request),
  });
  console.log("LoreWeave authenticated fixture API: http://127.0.0.1:41736");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void close().then(() => process.exit(0));
    });
} catch (error) {
  await close();
  throw error;
}
