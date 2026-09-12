import { z } from "zod";
import { createLifecycle } from "../lifecycle.ts";
import { AccessService } from "../access.ts";
import { SourceService, type SourceVersion } from "../sources.ts";
import { IdentityService } from "../identity.ts";
import { WikiService } from "../wiki.ts";
import { GraphService } from "../graph.ts";
import { MaintenanceService } from "../maintenance.ts";
import { PostgresConversations } from "../conversations.ts";
import { EvidenceService } from "../evidence.ts";
import { KnowledgeHost } from "../host.ts";
import { createApp } from "../http.ts";
import { FixtureSources } from "../development/sources.ts";
import { ControlledEmbeddings } from "../development/embeddings.ts";
import { ScriptedWikiModel } from "../development/wiki-model.ts";
import { startScriptedProvider } from "../development/provider.ts";
import { OpenAIEmbeddings } from "../providers/embeddings.ts";
import { OpenAIKnowledgeModel } from "../providers/chat.ts";
import type { ProviderRuntimeConfig } from "../providers/config.ts";
import { PublicAnswers } from "./client.ts";
import { MaintenanceDiagnostics } from "./maintenance.ts";
import {
  datasetSchema,
  digest,
  profiles,
  sourceManifestSchema,
  type Profile,
} from "./schema.ts";

const corpusSchema = z
  .array(
    z.object({
      file: z.string().min(1),
      source: z.object({ text: z.string().min(1) }),
    }),
  )
  .min(1);
const portableSchema = z.object({
  version: z.string().optional(),
  corpusSha256: z.string(),
  corpusTextSha256: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        paraphraseGroup: z.string(),
        complexity: z.enum(["ordinary", "complex"]),
        category: z.enum(["sufficient", "missing", "conflicting"]),
        requiredPoints: z.array(z.string()),
        expectedGaps: z.array(z.string()),
        references: z.array(
          z.object({ filename: z.string(), quote: z.string().min(1) }),
        ),
        review: z.object({
          kind: z.literal("agent"),
          reviewer: z.string(),
          timestamp: z.string(),
        }),
      }),
    )
    .min(1),
});

/** Resolve reviewed literal quotes only; never guess a passage or reuse stale IDs. */
export function resolveRouteReferences(
  references: Array<{ filename: string; quote: string }>,
  originals: Array<{
    file: string;
    source: Pick<SourceVersion, "version"> & {
      passages: Array<{ id: string; text: string }>;
    };
  }>,
) {
  return references.map((ref) => {
    const original = originals.find((item) => item.file === ref.filename);
    const matches =
      original?.source.passages.filter((p) => p.text.includes(ref.quote)) ?? [];
    if (matches.length !== 1)
      throw new Error(`reference_quote_not_unique:${ref.filename}`);
    return { version: original!.source.version, passageId: matches[0]!.id };
  });
}

/** Isolated imported corpus, shared derived snapshot, four read-only HTTP endpoints. */
export async function routeFixture(input: {
  databaseUrl: string;
  corpus: unknown;
  questions: unknown;
  provider?: ProviderRuntimeConfig;
  maintenanceBudgetMs: number;
  progress?: (event: Record<string, unknown>) => void | Promise<void>;
}) {
  const corpus = corpusSchema.parse(input.corpus);
  const questions = portableSchema.parse(input.questions);
  if (
    questions.corpusTextSha256 !==
    digest(
      JSON.stringify(
        corpus.map(({ file, source }) => ({ file, text: source.text })),
      ),
    )
  )
    throw new Error("reviewed_corpus_hash_mismatch");
  if (new Set(corpus.map((item) => item.file)).size !== corpus.length)
    throw new Error("duplicate_corpus_filename");
  if (
    !Number.isSafeInteger(input.maintenanceBudgetMs) ||
    input.maintenanceBudgetMs < 0 ||
    input.maintenanceBudgetMs > 3600000
  )
    throw new Error("invalid_maintenance_budget");
  const lifecycle = createLifecycle(async ({ defer, signal }) => {
    const access = new AccessService(input.databaseUrl);
    defer(() => access.close());
    const embeddings = input.provider
      ? new OpenAIEmbeddings(input.provider.embedding)
      : new ControlledEmbeddings();
    const model = input.provider
      ? new OpenAIKnowledgeModel(input.provider.chat)
      : new ScriptedWikiModel();
    const sources = new SourceService(input.databaseUrl, access, embeddings);
    defer(() => sources.close());
    const identities = new IdentityService(input.databaseUrl, access, sources);
    defer(() => identities.close());
    const wiki = new WikiService(
      input.databaseUrl,
      access,
      sources,
      identities,
      embeddings,
      model,
    );
    defer(() => wiki.close());
    const graph = new GraphService(
      input.databaseUrl,
      access,
      sources,
      identities,
      model,
    );
    defer(() => graph.close());
    const maintenance = new MaintenanceService(input.databaseUrl, access);
    defer(() => maintenance.close());
    const conversations = new PostgresConversations(input.databaseUrl);
    defer(() => conversations.close());
    await access.migrate();
    const account = {
      organization: `route-comparison-${crypto.randomUUID()}`,
      username: "admin",
      password: crypto.randomUUID(),
    };
    await access.bootstrap(account);
    const { token } = await access.login(account);
    const project = await access.createProject(
      token,
      "Frozen route comparison",
    );
    const reader = {
      ...account,
      username: "evaluator",
      password: crypto.randomUUID(),
    };
    await access.createMember(token, { ...reader, grants: ["read"] });
    const readerToken = (await access.login(reader)).token;
    const originals: Array<{ file: string; source: SourceVersion }> = [];
    const operations: string[] = [];
    for (const item of corpus) {
      let operation;
      for (let attempt = 1; attempt <= 2; attempt++) {
        operation = await sources.submit(token, {
          key: crypto.randomUUID(),
          filename: item.file,
          projectId: project.id,
          bytes: new TextEncoder().encode(item.source.text),
        });
        await sources.workOne();
        const status = await sources.inspect(token, operation.id);
        await input.progress?.({
          stage: "source-preparation",
          filename: item.file,
          attempt,
          status,
        });
        if (status.source === "searchable") break;
        // Preserve the failed operation. Only transient unavailability gets one fresh candidate.
        if (status.reason !== "unavailable" || attempt === 2)
          throw new Error(`comparison_source_not_ready:${item.file}`);
      }
      if (!operation) throw new Error("comparison_source_operation_missing");
      const original = await sources.version(token, operation.versionId);
      if (original.text !== item.source.text)
        throw new Error(`comparison_source_text_changed:${item.file}`);
      originals.push({ file: item.file, source: original });
      operations.push(operation.id);
      await input.progress?.({
        stage: "import",
        completed: originals.length,
        total: corpus.length,
      });
    }
    const manifest = sourceManifestSchema.parse({
      schemaVersion: 1,
      corpus: "forge-documentation-frozen",
      snapshot: questions.corpusSha256,
      sources: originals.map(({ source }) => ({
        version: source.version,
        sha256: digest(source.text),
        projectId: project.id,
        parser: source.parserProfile,
        embedding: source.embeddingProfile,
      })),
    });
    const dataset = datasetSchema.parse({
      schemaVersion: 1,
      version: questions.version ?? "issue-25-agent-reviewed-v1",
      split: "development",
      mode: "agent",
      manifestSha256: digest(JSON.stringify(manifest)),
      cases: questions.cases.map((item) => ({
        ...item,
        projectId: project.id,
        tags: [],
        references: resolveRouteReferences(item.references, originals),
        review: {
          kind: "agent",
          reviewer: item.review.reviewer,
          reviewedAt: new Date(item.review.timestamp).toISOString(),
        },
      })),
    });
    // Budgets stop admitting work; a current bounded provider operation settles before queries.
    const maintenanceStarted = performance.now();
    const maintenanceDeadline = maintenanceStarted + input.maintenanceBudgetMs;
    async function drain(name: string, work: () => Promise<boolean>) {
      const started = performance.now();
      let steps = 0;
      let exhausted = false;
      while (performance.now() < maintenanceDeadline && steps < 1000) {
        signal.throwIfAborted();
        if (!(await work())) {
          exhausted = true;
          break;
        }
        steps++;
        await input.progress?.({
          stage: "maintenance",
          worker: name,
          steps,
          elapsedMs: Math.round(performance.now() - started),
        });
      }
      return {
        worker: name,
        steps,
        elapsedMs: performance.now() - started,
        budgetMs: input.maintenanceBudgetMs,
        stop: exhausted ? "queue_idle" : "operator_budget",
      };
    }
    const identityWork = await drain("identity", async () =>
      Boolean(await identities.workOne(token)),
    );
    const derivedWork = await Promise.allSettled([
      drain("wiki", () => wiki.workOne(token)),
      drain("graph", () => graph.workOne(token)),
    ]);
    for (const result of derivedWork)
      if (result.status === "rejected") throw result.reason;
    const workers = [
      identityWork,
      ...derivedWork.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    ];
    const provider = input.provider ? undefined : startScriptedProvider();
    if (provider) defer(() => provider.stop());
    const fixtureSources = new FixtureSources({
      organizationId: await access.organization(account.organization),
    });
    const clients: Partial<Record<Profile, PublicAnswers>> = {};
    for (const profile of profiles) {
      const host = new KnowledgeHost({
        access,
        imports: sources,
        conversations,
        sources: fixtureSources,
        evidence: new EvidenceService(sources, wiki, graph, profile),
        providerUrl: input.provider?.chat.baseUrl ?? provider!.url,
        ...(input.provider
          ? {
              model: {
                profile: model.profile,
                exploration: input.provider.exploration,
                request: model.request.bind(model),
              },
            }
          : {}),
      });
      defer(() => host.close(), "settlement");
      const app = createApp(host, fixtureSources, {
        access,
        imports: sources,
        identities,
        wiki,
        graph,
        maintenance,
      });
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) =>
          signal.aborted
            ? new Response(null, { status: 503 })
            : app.fetch(request),
      });
      defer(() => server.stop(true), "ingress");
      clients[profile] = new PublicAnswers(String(server.url), readerToken);
    }
    const adapter = new MaintenanceDiagnostics(
      clients.source!,
      input.provider ? "real-provider" : "controlled-provider",
    );
    const diagnostics = [];
    for (const operation of operations)
      diagnostics.push({
        operationId: operation,
        diagnostics: await adapter.capture(operation),
      });
    return {
      clients,
      manifest,
      dataset,
      originals,
      maintenance: {
        capturedAt: new Date().toISOString(),
        elapsedMs: performance.now() - maintenanceStarted,
        budgetMs: input.maintenanceBudgetMs,
        workers,
        operations: await sources.list(token),
        diagnostics,
      },
      close: () => lifecycle.close(),
    };
  });
  return lifecycle.start();
}
