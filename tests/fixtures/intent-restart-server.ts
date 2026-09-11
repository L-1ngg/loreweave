/** Test-only process crash after a real source effect, before its run result is saved. */
import { AccessService } from "../../src/access.ts";
import { SourceService } from "../../src/sources.ts";
import { PostgresConversations } from "../../src/conversations.ts";
import { KnowledgeHost, type RunEvent } from "../../src/host.ts";
import { EvidenceService } from "../../src/evidence.ts";
import { ControlledEmbeddings } from "../../src/development/embeddings.ts";
import { FixtureSources } from "../../src/development/sources.ts";
import { startScriptedProvider } from "../../src/development/provider.ts";
import { createApp } from "../../src/http.ts";

const database = process.env.TEST_DATABASE_URL;
const organization = process.env.RESTART_TEST_ORGANIZATION;
if (!database || !organization)
  throw new Error("test database and organization required");
class CrashAfterEffect extends PostgresConversations {
  override async acquire(id: string, runId?: string) {
    const writer = await super.acquire(id, runId);
    if (!writer) return writer;
    return {
      ...writer,
      save: async (event: RunEvent) => {
        if (process.argv[3] === "crash" && event.run.operations?.length)
          process.exit(89);
        await writer.save(event);
      },
    };
  }
}
const access = new AccessService(database);
await access.migrate();
await access.bootstrap({
  organization,
  username: "restart-admin",
  password: "restart-test-password",
});
const imports = new SourceService(database, access, new ControlledEmbeddings());
const conversations = new CrashAfterEffect(database);
const sources = new FixtureSources();
const provider = startScriptedProvider();
const host = new KnowledgeHost({
  access,
  imports,
  conversations,
  sources,
  providerUrl: provider.url,
  evidence: new EvidenceService(imports),
});
const app = createApp(host, sources, { access, imports });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.argv[2] ?? 0),
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return app.fetch(request);
    if (path.startsWith("/assets/") && /^\/assets\/[\w.-]+$/.test(path))
      return new Response(Bun.file(`dist/web${path}`));
    return new Response(Bun.file("dist/web/index.html"));
  },
});
console.log(JSON.stringify({ url: server.url.href }));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void (async () => {
      await host.close();
      server.stop(true);
      provider.stop();
      await conversations.close();
      await imports.close();
      await access.close();
      process.exit(0);
    })();
  });
