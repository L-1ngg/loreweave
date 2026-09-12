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
import { OpenAIEmbeddings } from "../providers/embeddings.ts";
import { OpenAIKnowledgeModel } from "../providers/chat.ts";
import type { RuntimeConfig } from "../config.ts";
import { createLifecycle } from "./lifecycle.ts";

export function createRuntime(config: RuntimeConfig) {
  return createLifecycle(async ({ signal, defer }) => {
    const real = config.provider;
    const embeddings = real
      ? new OpenAIEmbeddings(real.embedding)
      : new ControlledEmbeddings();
    const knowledgeModel = real
      ? new OpenAIKnowledgeModel(real.chat)
      : new ScriptedWikiModel();

    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) throw new Error("missing_config:DATABASE_URL");
    const access = new AccessService(databaseUrl);
    defer(() => access.close());
    const conversations = new PostgresConversations(databaseUrl);
    defer(() => conversations.close());
    const maintenance = new MaintenanceService(databaseUrl, access);
    defer(() => maintenance.close());
    let host: KnowledgeHost | undefined;
    let provider: ReturnType<typeof startScriptedProvider> | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;

    const imports = new SourceService(databaseUrl, access, embeddings);
    defer(() => imports.close());
    const identities = new IdentityService(databaseUrl, access, imports);
    defer(() => identities.close());
    const wiki = new WikiService(
      databaseUrl,
      access,
      imports,
      identities,
      embeddings,
      knowledgeModel,
    );
    defer(() => wiki.close());
    const graph = new GraphService(
      databaseUrl,
      access,
      imports,
      identities,
      knowledgeModel,
    );
    defer(() => graph.close());
    let worker: Promise<void> | undefined;
    async function prepareSources() {
      while (!signal.aborted) {
        try {
          if (
            !(await imports.workOne()) &&
            !signal.aborted &&
            !(await identities.workOne()) &&
            !signal.aborted &&
            !(await wiki.workOne()) &&
            !signal.aborted &&
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
    await access.migrate();
    signal.throwIfAborted();
    const organization = config.organization;
    if (config.bootstrap) {
      await access.bootstrap({ organization, ...config.bootstrap });
    }
    const sources = new FixtureSources({
      organizationId: await access.organization(organization),
    });
    signal.throwIfAborted();
    if (!real) {
      provider = startScriptedProvider({ delayMs: 120 });
      defer(() => provider!.stop());
    }
    defer(() => worker);
    // Ordinary interactive answers use the source hybrid baseline. Additional
    // Wiki/graph routes are opt-in experiments so every question does not pay
    // their query and source-resolution cost.
    const profile = config.retrievalProfile;
    const evidence = new EvidenceService(imports, wiki, graph, profile);
    host = new KnowledgeHost({
      wiki,
      providerUrl: real?.chat.baseUrl ?? provider!.url,
      ...(real
        ? {
            model: {
              profile: knowledgeModel.profile,
              exploration: real.exploration,
              request: knowledgeModel.request.bind(knowledgeModel),
            },
          }
        : {}),
      sources,
      conversations,
      evidence,
      imports,
      access,
    });
    defer(() => host!.close());
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
    defer(() => server!.stop(true));
    worker = prepareSources();
  });
}
