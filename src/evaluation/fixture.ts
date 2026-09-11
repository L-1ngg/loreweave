import { MaintenanceService } from "../maintenance.ts";
import type { WikiModel } from "../wiki-types.ts";
import { IdentityService } from "../identity.ts";
import { WikiService } from "../wiki.ts";
import { GraphService } from "../graph.ts";
import { ScriptedWikiModel } from "../development/wiki-model.ts";
import type { Profile } from "./schema.ts";
import { AccessService } from "../access.ts";
import { SourceService } from "../sources.ts";
import { PostgresConversations } from "../conversations.ts";
import { EvidenceService } from "../evidence.ts";
import { KnowledgeHost } from "../host.ts";
import { ControlledEmbeddings } from "../development/embeddings.ts";
import { FixtureSources } from "../development/sources.ts";
import { startScriptedProvider } from "../development/provider.ts";
import { createApp } from "../http.ts";
import { PublicAnswers } from "./client.ts";
import { digest, sourceManifestSchema, developmentSchema } from "./schema.ts";
/** A separate source corpus is ingested first; benchmark questions/labels never enter it. */
export async function evaluationFixture(
  url: string,
  corruptDraft = false,
  profile: Profile = "source",
  derived = false,
  models: { wiki?: WikiModel; graph?: WikiModel } = {},
) {
  const access = new AccessService(url),
    conversations = new PostgresConversations(url);
  await access.migrate();
  const account = {
    organization: `evaluation-${crypto.randomUUID()}`,
    username: "admin",
    password: crypto.randomUUID(),
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const reader = {
    organization: account.organization,
    username: "evaluator",
    password: crypto.randomUUID(),
  };
  await access.createMember(token, { ...reader, grants: ["read"] });
  const readerToken = (await access.login(reader)).token;
  const sources = new SourceService(url, access, new ControlledEmbeddings());
  const submitted = await sources.submit(token, {
    key: "original-v1",
    filename: "日志策略.md",
    bytes: new TextEncoder().encode("生产日志保留 30 天。"),
  });
  await sources.workOne();
  const original = await sources.version(token, submitted.versionId);
  const manifest = sourceManifestSchema.parse({
    schemaVersion: 1,
    corpus: "controlled-logs",
    snapshot: "v1",
    sources: [
      {
        version: original.version,
        sha256: digest(original.text),
        projectId: null,
        parser: original.parserProfile,
        embedding: original.embeddingProfile,
      },
    ],
  });
  const dataset = developmentSchema.parse({
    schemaVersion: 1,
    version: "controlled-logs-v1",
    manifestSha256: digest(JSON.stringify(manifest)),
    split: "development",
    mode: "fixture",
    cases: [
      {
        id: "logs",
        question: "生产日志保留多久？",
        paraphraseGroup: "log-retention",
        complexity: "ordinary",
        category: "sufficient",
        projectId: null,
        tags: [],
        references: [
          { version: original.version, passageId: original.passages[0]!.id },
        ],
        expectedGaps: [],
        requiredPoints: ["30 天"],
        review: { kind: "fixture", oracle: "literal-log-retention-v1" },
      },
    ],
  });
  const provider = startScriptedProvider();
  const faulty = corruptDraft
    ? Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const body = (await request.json()) as { phase?: string };
          const response = await fetch(
            new URL(new URL(request.url).pathname, provider.url),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          if (body.phase !== "generation") return response;
          // A real provider boundary sends a wrong numeric fact; product review rejects it.
          const text = await response.text();
          return new Response(text.replaceAll("30", "99"), {
            headers: { "content-type": "application/json" },
          });
        },
      })
    : undefined;
  const identities = derived
    ? new IdentityService(url, access, sources)
    : undefined;
  const wiki = identities
    ? new WikiService(
        url,
        access,
        sources,
        identities,
        new ControlledEmbeddings(),
        models.wiki ?? new ScriptedWikiModel(),
      )
    : undefined;
  const graph = identities
    ? new GraphService(
        url,
        access,
        sources,
        identities,
        models.graph ?? new ScriptedWikiModel(),
      )
    : undefined;
  const maintenance = new MaintenanceService(url, access);
  const fixtureSources = new FixtureSources();
  const host = new KnowledgeHost({
    access,
    imports: sources,
    conversations,
    sources: fixtureSources,
    evidence: new EvidenceService(sources, wiki, graph, profile),
    providerUrl: faulty ? String(faulty.url) : provider.url,
  });
  const app = createApp(host, fixtureSources, {
    access,
    imports: sources,
    maintenance,
    ...(identities ? { identities } : {}),
    ...(wiki ? { wiki } : {}),
    ...(graph ? { graph } : {}),
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => app.fetch(request),
  });
  return {
    manifest,
    dataset,
    sources,
    access,
    token,
    host,
    client: new PublicAnswers(String(server.url), readerToken),
    provider,
    maintenance,
    identities,
    wiki,
    graph,
    async close() {
      await host.close();
      server.stop(true);
      faulty?.stop(true);
      provider.stop();
      await wiki?.close();
      await graph?.close();
      await identities?.close();
      await maintenance.close();
      await conversations.close();
      await sources.close();
      await access.close();
    },
  };
}
