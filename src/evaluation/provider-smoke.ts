import { AccessService } from "../access.ts";
import { SourceService } from "../sources.ts";
import { IdentityService } from "../identity.ts";
import { WikiService } from "../wiki.ts";
import { GraphService } from "../graph.ts";
import { EvidenceService } from "../evidence.ts";
import { KnowledgeHost } from "../host.ts";
import { PostgresConversations } from "../conversations.ts";
import { FixtureSources } from "../development/sources.ts";
import type { ProviderRuntimeConfig } from "../providers/config.ts";
import { createLifecycle } from "../lifecycle.ts";
import { OpenAIEmbeddings } from "../providers/embeddings.ts";
import { OpenAIKnowledgeModel } from "../providers/chat.ts";

/** Explicit smoke entry; the caller selects an isolated database and provider. */
export async function runProviderSmoke(
  url: string,
  provider: ProviderRuntimeConfig,
) {
  const lifecycle = createLifecycle(async ({ defer }) => {
    const embeddings = new OpenAIEmbeddings(provider.embedding);
    const model = new OpenAIKnowledgeModel(provider.chat);
    const access = new AccessService(url);
    defer(() => access.close());
    const sources = new SourceService(url, access, embeddings);
    defer(() => sources.close());
    const identities = new IdentityService(url, access, sources);
    defer(() => identities.close());
    const wiki = new WikiService(
      url,
      access,
      sources,
      identities,
      embeddings,
      model,
    );
    defer(() => wiki.close());
    const graph = new GraphService(url, access, sources, identities, model);
    defer(() => graph.close());
    const conversations = new PostgresConversations(url);
    defer(() => conversations.close());

    await access.migrate();
    const account = {
      organization: `provider-smoke-${crypto.randomUUID()}`,
      username: "admin",
      password: crypto.randomUUID(),
    };
    await access.bootstrap(account);
    const { token } = await access.login(account);
    const operation = await sources.submit(token, {
      key: crypto.randomUUID(),
      filename: "provider-smoke.md",
      bytes: new TextEncoder().encode(
        "# 日志规则\n\n生产环境的应用日志保留 30 天。\n\n系统 Alpha 依赖系统 Beta。",
      ),
    });
    await sources.workOne();
    const prepared = await sources.inspect(token, operation.id);
    if (prepared.source !== "searchable") {
      console.log(
        JSON.stringify(
          {
            kind: "real-provider-integration-smoke",
            qualityAcceptance: false,
            passed: false,
            stage: "source-preparation",
            operation: prepared,
          },
          null,
          2,
        ),
      );
      throw new Error("smoke_source_not_ready");
    }
    const original = await sources.version(token, operation.versionId);
    const relation = original.passages.find((p) => p.text.includes("Alpha"))!;
    // Recorded exact mentions isolate provider integration from automatic mention discovery.
    const alpha = await identities.record(token, {
      version: original.version,
      passageId: relation.id,
      label: "Alpha",
    });
    await identities.record(token, {
      version: original.version,
      passageId: relation.id,
      label: "Beta",
    });
    for (let n = 0; n < 20 && (await identities.workOne()); n++) {}
    for (let n = 0; n < 20 && (await wiki.workOne()); n++) {}
    for (let n = 0; n < 20 && (await graph.workOne()); n++) {}
    const evidence = new EvidenceService(sources, wiki, graph);
    const host = new KnowledgeHost({
      access,
      imports: sources,
      wiki,
      evidence,
      conversations,
      sources: new FixtureSources({
        organizationId: await access.organization(account.organization),
      }),
      providerUrl: provider.chat.baseUrl,
      model: {
        profile: model.profile,
        exploration: provider.exploration,
        request: model.request.bind(model),
      },
    });
    defer(() => host.close(), "settlement");
    const start = Date.now();
    const run = await host.start({
      credential: token,
      question: "生产环境的应用日志保留几天？",
    });
    await host.settled(run.id);
    const result = await host.get(run.id, token);
    const status = await sources.inspect(token, operation.id);
    const relations = await graph.neighborhood(token, {
      entityId: alpha.canonicalId,
    });
    const passed =
      result.status === "answered" &&
      Boolean(result.answer?.certificate) &&
      result.answer!.citations.some((c) => c.version === original.version) &&
      relations.claims.length > 0 &&
      status.wiki === "ready";
    console.log(
      JSON.stringify(
        {
          kind: "real-provider-integration-smoke",
          qualityAcceptance: false,
          passed,
          models: { chat: model.profile, embedding: embeddings.profile },
          operation: status,
          graphClaims: relations.claims.length,
          answer: {
            status: result.status,
            text: result.answer?.text,
            citations: result.answer?.citations.map((c) => ({
              version: c.version,
              passageId: c.passageId,
            })),
            counts: result.counts,
            reason: result.reason,
            elapsedMs: Date.now() - start,
          },
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  });
  // A failed run is rolled back by start(), preserving both errors. Successful
  // verification still owns resources until close() completes.
  await lifecycle.start();
  await lifecycle.close();
}
