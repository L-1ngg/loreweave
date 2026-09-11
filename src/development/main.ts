import { MaintenanceService } from "../maintenance.ts";
import { ExternalKnowledge } from "../external-knowledge.ts";
import { WikiService } from "../wiki.ts";
import { ScriptedWikiModel } from "./wiki-model.ts";
import { IdentityService } from "../identity.ts";
import { EvidenceService } from "../evidence.ts";
import { SourceService } from "../sources.ts";
import { ControlledEmbeddings } from "./embeddings.ts";
import { AccessService } from "../access.ts";
import { PostgresConversations } from "../conversations.ts";
import { KnowledgeHost } from "../host.ts";
import { createApp } from "../http.ts";
import { startScriptedProvider } from "./provider.ts";
import { FixtureSources } from "./sources.ts";
import { GraphService } from "../graph.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set DATABASE_URL to a dedicated LoreWeave PostgreSQL database. See README.",
  );
const access = new AccessService(databaseUrl);
const conversations = new PostgresConversations(databaseUrl);
const maintenance = new MaintenanceService(databaseUrl, access);
let host: KnowledgeHost | undefined;
let provider: ReturnType<typeof startScriptedProvider> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let closing = false;
const imports = new SourceService(
  databaseUrl,
  access,
  new ControlledEmbeddings(),
);
const identities = new IdentityService(databaseUrl, access, imports);
const wiki = new WikiService(
  databaseUrl,
  access,
  imports,
  identities,
  new ControlledEmbeddings(),
  new ScriptedWikiModel(),
);
const graph = new GraphService(
  databaseUrl,
  access,
  imports,
  identities,
  new ScriptedWikiModel(),
);
let worker: Promise<void> | undefined;
async function prepareSources() {
  while (!closing) {
    try {
      if (
        !(await imports.workOne()) &&
        !(await identities.workOne()) &&
        !(await wiki.workOne()) &&
        !(await graph.workOne())
      )
        await Bun.sleep(200);
    } catch (error) {
      console.error(
        "Source worker unavailable",
        error instanceof Error ? error.name : "error",
      );
      await Bun.sleep(1000);
    }
  }
}
async function close() {
  if (closing) return;
  closing = true;
  await host?.close();
  server?.stop(true);
  provider?.stop();
  await worker;
  await wiki.close();
  await graph.close();
  await identities.close();
  await imports.close();
  await conversations.close();
  await maintenance.close();
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
  const evidence = new EvidenceService(imports, wiki, graph);
  host = new KnowledgeHost({
    wiki,
    providerUrl: provider.url,
    sources,
    conversations,
    evidence,
    imports,
    access,
  });
  const external = new ExternalKnowledge(access, imports, evidence, host);
  const app = createApp(host, sources, {
    external,
    maintenance,
    identities,
    wiki,
    imports,
    browserOrigin: "http://127.0.0.1:41735",
    access,
    graph,
  });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 41736,
    maxRequestBodySize: 2 * 1024 * 1024,
    fetch: (request) => app.fetch(request),
  });
  worker = prepareSources();
  console.log("LoreWeave authenticated fixture API: http://127.0.0.1:41736");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void close().then(() => process.exit(0));
    });
} catch (error) {
  await close();
  throw error;
}
