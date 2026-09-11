import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  prepareAcceptance,
  preparationMarkdown,
} from "../src/evaluation/preparation.ts";
const [inputFile, output] = Bun.argv.slice(2);
if (!inputFile || !output)
  throw new Error(
    "Usage: eval:prepare INPUT_PATHS_JSON NEW_OUTPUT_DIRECTORY ({} records missing prerequisites)",
  );
const paths = (await Bun.file(inputFile).json()) as Record<string, string>;
const input: Record<string, unknown> = {};
for (const [key, path] of Object.entries(paths)) {
  if (
    !["manifest", "development", "acceptance", "report", "grades"].includes(
      key,
    ) ||
    typeof path !== "string"
  )
    throw new Error("invalid_artifact_path");
  input[key] = await Bun.file(path).json();
}
const report = prepareAcceptance(input);
await mkdir(output);
await writeFile(
  join(output, "preparation.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
await writeFile(join(output, "preparation.md"), preparationMarkdown(report), {
  flag: "wx",
});
console.log(output);
