import { mkdir, writeFile, rename, unlink, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { providerConfig } from "../src/providers/config.ts";
import { routeFixture } from "../src/evaluation/route-fixture.ts";
import { summarizeRoutes } from "../src/evaluation/comparison.ts";
import { evaluate } from "../src/evaluation/runner.ts";
const args = new Map<string, string>();
for (let index = 2; index < Bun.argv.length; index += 2) {
  const key = Bun.argv[index]!,
    value = Bun.argv[index + 1];
  if (
    ![
      "--provider",
      "--output",
      "--corpus",
      "--questions",
      "--maintenance-seconds",
    ].includes(key) ||
    !value ||
    args.has(key)
  )
    throw new Error("invalid_arguments");
  args.set(key, value);
}
const mode = args.get("--provider"),
  output = args.get("--output");
if (!output || (mode !== "controlled" && mode !== "real"))
  throw new Error(
    "Required: --provider controlled|real --output NEW_DIRECTORY [--maintenance-seconds 300] [--corpus FILE] [--questions FILE]",
  );
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL must point to a disposable isolated database",
  );
function databaseIdentity(value: string) {
  const parsed = new URL(value);
  return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
}
if (
  process.env.DATABASE_URL &&
  databaseIdentity(url) === databaseIdentity(process.env.DATABASE_URL)
)
  throw new Error("comparison_requires_separate_test_database");
const maintenanceBudgetMs =
  Number(args.get("--maintenance-seconds") ?? 300) * 1000;
const corpus = await Bun.file(
  args.get("--corpus") ?? "docs/evaluation/forge-preflight/originals.json",
).json();
const questions = await Bun.file(
  args.get("--questions") ?? "docs/evaluation/issue-25/reviewed-questions.json",
).json();
const provider = mode === "real" ? providerConfig(process.env) : undefined;
const directory = resolve(output);
await mkdir(directory, { recursive: false });
async function save(name: string, value: unknown) {
  const target = join(directory, name);
  await writeFile(`${target}.tmp`, JSON.stringify(value, null, 2) + "\n");
  await rename(`${target}.tmp`, target);
}
await save("execution.json", {
  startedAt: new Date().toISOString(),
  provider: mode,
  maintenanceBudgetMs,
  qualityAcceptance: false,
  note: "Development route comparison; independent grading required. Work budget excludes settling the current bounded operation.",
});
await writeFile(join(directory, "progress.jsonl"), "", { flag: "wx" });
let fixture: Awaited<ReturnType<typeof routeFixture>> | undefined;
try {
  fixture = await routeFixture({
    databaseUrl: url,
    corpus,
    questions,
    ...(provider ? { provider } : {}),
    maintenanceBudgetMs,
    progress: async (event) => {
      await appendFile(
        join(directory, "progress.jsonl"),
        JSON.stringify({ capturedAt: new Date().toISOString(), ...event }) +
          "\n",
      );
      console.log(JSON.stringify(event));
    },
  });
  await save("originals.json", fixture.originals);
  await save("manifest.json", fixture.manifest);
  await save("dataset.json", fixture.dataset);
  await save("maintenance.json", fixture.maintenance);
  const report = await evaluate({
    manifest: fixture.manifest,
    dataset: fixture.dataset,
    clients: fixture.clients,
    onCase: async (report) => {
      await save("report.partial.json", report);
      const last = report.cases.at(-1);
      console.log(
        JSON.stringify({
          stage: "answer",
          completed: report.cases.length,
          profile: last?.profile,
          id: last?.id,
          outcome: last?.outcome,
        }),
      );
    },
  });
  await save("report.json", report);
  await save("summary.json", summarizeRoutes(report.cases));
  await unlink(join(directory, "report.partial.json"));
  console.log(
    JSON.stringify({ output: directory, categories: report.categories }),
  );
} catch (error) {
  await save("failure.json", {
    failedAt: new Date().toISOString(),
    stage: fixture ? "evaluation" : "setup",
    reason:
      error instanceof Error &&
      /^(comparison_|reviewed_|reference_|invalid_)/.test(error.message)
        ? error.message
        : "comparison_execution_failed",
    evidence: "progress.jsonl",
  });
  throw error;
} finally {
  await fixture?.close();
}
