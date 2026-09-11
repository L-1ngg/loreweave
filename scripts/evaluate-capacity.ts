import { writeFile, readFile, access } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { PublicAnswers } from "../src/evaluation/client.ts";
import {
  measureCapacity,
  capacityPlanSchema,
} from "../src/evaluation/capacity.ts";
import { MarkdownUpdate } from "../src/evaluation/markdown-update.ts";
const [file, output] = Bun.argv.slice(2);
const token = process.env.LOREWEAVE_EVAL_TOKEN;
if (!file || !output || !token)
  throw new Error(
    "Usage: eval:capacity CONFIG_JSON NEW_OUTPUT; set read-only LOREWEAVE_EVAL_TOKEN; update scenario also needs LOREWEAVE_UPDATE_TOKEN",
  );
// Do not start load or a source update when the requested output already exists.
if (
  await access(output).then(
    () => true,
    () => false,
  )
)
  throw new Error("output_exists");
const config = z
  .strictObject({
    endpoint: z.url(),
    plan: capacityPlanSchema,
    manifest: z.string(),
    dataset: z.string(),
    development: z.string().optional(),
    update: z
      .strictObject({
        file: z.string(),
        documentId: z.uuid(),
        expectedPrior: z.uuid(),
        projectId: z.uuid().optional(),
        key: z.string().min(1),
      })
      .optional(),
  })
  .parse(await Bun.file(file).json());
let update: (() => Promise<{ operationId: string }>) | undefined;
if (config.update) {
  const updateToken = process.env.LOREWEAVE_UPDATE_TOKEN;
  if (!updateToken) throw new Error("LOREWEAVE_UPDATE_TOKEN required");
  const original = config.update;
  const bytes = new Uint8Array(await readFile(original.file));
  const updater = new MarkdownUpdate(config.endpoint, updateToken);
  update = () =>
    updater.submit({
      documentId: original.documentId,
      expectedPrior: original.expectedPrior,
      key: original.key,
      ...(original.projectId ? { projectId: original.projectId } : {}),
      bytes,
      filename: basename(original.file),
    });
}
let report: unknown;
try {
  report = await measureCapacity({
    plan: config.plan,
    manifest: await Bun.file(config.manifest).json(),
    dataset: await Bun.file(config.dataset).json(),
    ...(config.development
      ? { development: await Bun.file(config.development).json() }
      : {}),
    client: new PublicAnswers(config.endpoint, token),
    ...(update ? { update } : {}),
  });
} catch (error) {
  report = {
    schemaVersion: 1,
    kind: "capacity-not-completed",
    createdAt: new Date().toISOString(),
    plan: config.plan,
    reason: error instanceof Error ? error.message : "capacity_failed",
    eligibleForAcceptance: false,
  };
  process.exitCode = 1;
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(output);
