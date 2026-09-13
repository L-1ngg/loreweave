import { PostgresConversations } from "../src/conversations.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { providerConfig } from "../src/providers/config.ts";
import { loadEmbeddingTokenizer } from "../src/embedding-tokenizer.ts";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { ModelAdmission } from "../src/model-admission.ts";
import { OpenAIEmbeddings } from "../src/providers/embeddings.ts";
import { OpenAIKnowledgeModel } from "../src/providers/chat.ts";
import { EvidenceService } from "../src/evidence.ts";
import { KnowledgeHost } from "../src/host.ts";
import { FixtureSources } from "../src/development/sources.ts";
const url = process.env.TEST_DATABASE_URL,
  output = Bun.argv[2];
if (!url || !output || url === process.env.DATABASE_URL)
  throw new Error(
    "Require isolated TEST_DATABASE_URL and a new output directory",
  );
await mkdir(output, { recursive: false });
const config = providerConfig(process.env),
  access = new AccessService(url),
  admission = new ModelAdmission(url);
const embeddings = new OpenAIEmbeddings(
  { ...config.embedding, fetch: admission.fetch },
  await loadEmbeddingTokenizer(config.embedding.model),
);
const conversations = new PostgresConversations(url);
const sources = new SourceService(url, access, embeddings),
  model = new OpenAIKnowledgeModel({ ...config.chat, fetch: admission.fetch });
let host: KnowledgeHost | undefined;
const cases = [
  {
    id: "general",
    question: "什么是数据库索引？",
    expected:
      "May answer general knowledge without retrieval; exact label if no retrieval.",
  },
  {
    id: "supported",
    question: "星河项目的生产日志保留多少天？",
    expected: "Retrieve originals and disclose the 30/60-day source conflict.",
  },
  {
    id: "precise",
    question: "星河项目的调试日志保留多久？",
    expected: "Seven days with original citation.",
  },
  {
    id: "missing",
    question: "星河项目每年的审计预算是多少？",
    expected: "Explicitly missing; no invented private facts.",
  },
  {
    id: "mixed",
    question: "解释日志保留的作用，并告诉我星河项目调试日志的保留期限。",
    expected:
      "Distinguish general explanation from cited seven-day project rule.",
  },
  {
    id: "relation",
    question: "星河发布流程由谁批准？",
    expected:
      "Chen Ming, supported by original source even without graph readiness.",
  },
];
const corpus = [
  {
    file: "operations.md",
    text: "# 星河项目运维规则\n\n星河项目的生产日志保留 30 天。调试日志保留 7 天。发布流程由陈明批准。",
  },
  {
    file: "audit.md",
    text: "# 星河项目审计规则\n\n星河项目的生产日志保留 60 天。本规则没有声明覆盖或废止运维规则。",
  },
];
const results: unknown[] = [];
try {
  await access.migrate();
  const account = {
    organization: `direct-dev-${crypto.randomUUID()}`,
    username: "admin",
    password: crypto.randomUUID(),
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  for (const source of corpus) {
    const op = await sources.submit(token, {
      key: source.file,
      filename: source.file,
      bytes: new TextEncoder().encode(source.text),
    });
    await sources.workOne({ organizationId: context.organizationId });
    const state = await sources.inspect(token, op.id);
    console.log(
      JSON.stringify({
        stage: "source",
        file: source.file,
        status: state.source,
      }),
    );
    if (state.source !== "searchable")
      throw new Error(`development_source_${state.reason}`);
  }
  host = new KnowledgeHost({
    access,
    conversations,
    imports: sources,
    sources: new FixtureSources({ organizationId: context.organizationId }),
    evidence: new EvidenceService(sources),
    modelFetch: admission.fetch,
    providerUrl: config.chat.baseUrl,
    model: {
      profile: model.profile,
      exploration: config.exploration,
      request: model.request.bind(model),
    },
  });
  await writeFile(
    `${output}/frozen-inputs.json`,
    JSON.stringify({ corpus, cases }, null, 2) + "\n",
  );
  for (const item of cases) {
    const start = performance.now();
    const run = await host.start({
      question: item.question,
      credential: token,
    });
    await host.settled(run.id);
    const answer = await host.get(run.id, token);
    const transport = (await admission.status()).requests.filter(
      (row) => row.operation_id === run.id,
    );
    results.push({
      ...item,
      elapsedMs: performance.now() - start,
      answer,
      transport,
    });
    await writeFile(
      `${output}/results.json`,
      JSON.stringify(
        {
          kind: "real-provider-development",
          model: config.chat.model,
          embedding: embeddings.profile,
          semanticAcceptance: false,
          p95TargetMs: 15000,
          results,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({ stage: "answer", id: item.id, status: answer.status }),
    );
  }
} finally {
  await host?.close();
  await sources.close();
  await conversations.close();
  await admission.close();
  await access.close();
}
