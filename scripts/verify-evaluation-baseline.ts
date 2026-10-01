import { createHash } from "node:crypto";
import { join } from "node:path";
import { baselineDirectory, baselineManifest } from "./evaluation-artifacts";

for (const entry of [
  ...baselineManifest.artifacts.map((e) => ({
    ...e,
    path: join(baselineDirectory, e.path),
  })),
  ...baselineManifest.fixtures,
]) {
  const bytes = new Uint8Array(await Bun.file(entry.path).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error(`frozen_evidence_changed:${entry.path}`);
}
console.log(
  `Verified ${baselineManifest.artifacts.length} byte-preserved artifacts and ${baselineManifest.fixtures.length} fixture files from ${baselineManifest.sourceRevision}.`,
);
