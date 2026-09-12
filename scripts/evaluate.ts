import { writeFile } from "node:fs/promises";
import { PublicAnswers } from "../src/evaluation/client.ts";
import { evaluate } from "../src/evaluation/runner.ts";
import { profiles, type Profile } from "../src/evaluation/schema.ts";
import { loadEvaluationConfig } from "../src/config.ts";
const config = loadEvaluationConfig();
const args = new Map<string, string>();
for (let index = 2; index < Bun.argv.length; index += 2) {
  const key = Bun.argv[index]!,
    value = Bun.argv[index + 1];
  if (!key.startsWith("--") || !value || args.has(key))
    throw new Error("invalid arguments");
  args.set(key, value);
}
if (
  !["--manifest", "--dataset", "--output"].every((key) => args.has(key)) ||
  !config.token
)
  throw new Error(
    "Required: --manifest FILE --dataset FILE --output FILE; LOREWEAVE_EVAL_TOKEN. Routes: --source URL --wiki URL --graph URL --combined URL. Acceptance also requires --development FILE.",
  );
const clients: Partial<Record<Profile, PublicAnswers>> = {};
for (const profile of profiles)
  if (args.has(`--${profile}`))
    clients[profile] = new PublicAnswers(
      args.get(`--${profile}`)!,
      config.token,
    );
const report = await evaluate({
  manifest: await Bun.file(args.get("--manifest")!).json(),
  dataset: await Bun.file(args.get("--dataset")!).json(),
  ...(args.has("--development")
    ? { development: await Bun.file(args.get("--development")!).json() }
    : {}),
  clients,
});
await writeFile(args.get("--output")!, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify(
    { report: args.get("--output"), categories: report.categories },
    null,
    2,
  ),
);
