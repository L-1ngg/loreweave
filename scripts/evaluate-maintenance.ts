import { writeFile } from "node:fs/promises";
import { PublicAnswers } from "../src/evaluation/client.ts";
import { MaintenanceDiagnostics } from "../src/evaluation/maintenance.ts";
import { routingTargetsSchema } from "../src/evaluation/schema.ts";
import { loadEvaluationConfig } from "../src/config.ts";
const config = loadEvaluationConfig();
const [endpoint, operationId, output, targetsFile] = Bun.argv.slice(2);
const token = config.token,
  provenance = config.provenance;
if (
  !endpoint ||
  !operationId ||
  !output ||
  !token ||
  !["controlled-provider", "real-provider"].includes(provenance ?? "")
)
  throw new Error(
    "Usage: eval:maintenance URL OPERATION_ID NEW_OUTPUT [TARGETS]; set LOREWEAVE_EVAL_TOKEN and LOREWEAVE_EVAL_PROVENANCE",
  );
const client = new PublicAnswers(endpoint, token);
await client.configuration(AbortSignal.timeout(5000));
const targets = targetsFile
  ? routingTargetsSchema.parse(await Bun.file(targetsFile).json())
  : undefined;
const diagnostics = await new MaintenanceDiagnostics(
  client,
  provenance as "controlled-provider" | "real-provider",
  targets,
).capture(operationId);
await writeFile(
  output,
  JSON.stringify({ schemaVersion: 1, operationId, diagnostics }, null, 2) +
    "\n",
  { flag: "wx" },
);
console.log(output);
