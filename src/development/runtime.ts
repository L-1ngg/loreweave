import { loadEmbeddingTokenizer } from "../embedding-tokenizer.ts";
import { ModelAdmission } from "../model-admission.ts";
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
import { createLifecycle } from "../lifecycle.ts";

export function createRuntime(config: RuntimeConfig) {
  return createLifecycle(async ({ signal, defer }) => {
    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) throw new Error("missing_config:DATABASE_URL");
    const admission = new ModelAdmission(databaseUrl);
    defer(() => admission.close());
    const real = config.provider;
    const embeddings = real
      ? new OpenAIEmbeddings(
          { ...real.embedding, fetch: admission.fetch },
          await loadEmbeddingTokenizer(real.embedding.model),
        )
      : new ControlledEmbeddings();
    const knowledgeModel = real
      ? new OpenAIKnowledgeModel({ ...real.chat, fetch: admission.fetch })
      : new ScriptedWikiModel();

    const access = new AccessService(databaseUrl);
    defer(() => access.close());
    const conversations = new PostgresConversations(databaseUrl);
    defer(() => conversations.close());
    const maintenance = new MaintenanceService(databaseUrl, access);
    defer(() => maintenance.close());
    let host: KnowledgeHost | undefined;
    let provider: ReturnType<typeof startScriptedProvider> | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;

    const imports = new SourceService(
      databaseUrl,
      access,
      embeddings,
      config.importLimits,
      config.preparationDeadlineMs,
    );
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
      { packetQuantum: 1 },
    );
    defer(() => graph.close());
    let worker: Promise<void> | undefined;
    async function lane(name: string, workOne: () => Promise<unknown>) {
      while (!signal.aborted) {
        try {
          if (!(await workOne())) await Bun.sleep(200);
        } catch (error) {
          console.error(
            `${name} worker unavailable`,
            error instanceof Error ? error.name : "error",
          );
          await Bun.sleep(1000);
        }
      }
    }
    async function prepareSources() {
      await Promise.all([
        lane("source", () => imports.workOne({ batchQuantum: 1 })),
        lane("search-index", () => imports.indexes.workOne()),
        lane("identity", () => identities.workOne()),
        lane("wiki", () => wiki.workOne()),
        lane("wiki-peer", () => wiki.workOne()),
        lane("graph", () => graph.workOne()),
      ]);
    }
    await access.migrate();
    signal.throwIfAborted();
    const organization = config.organization;
    if (config.bootstrap) {
      await access.bootstrap({ organization, ...config.bootstrap });
    }
    if (config.role === "worker") {
      defer(() => worker);
      worker = prepareSources();
      return;
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
      modelFetch: admission.fetch,
      settleModelWork: admission.settled.bind(admission),
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
    if (config.role !== "api") worker = prepareSources();
  });
}
