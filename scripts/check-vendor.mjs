import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = new URL("../vendor/forge-agent/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("upstream.json", root), "utf8"),
);
for (const [file, hashes] of Object.entries(manifest.files)) {
  const actual = createHash("sha256")
    .update(readFileSync(join(fileURLToPath(root), file)))
    .digest("hex");
  if (actual !== (hashes.patchedSha256 ?? hashes.upstreamSha256))
    throw new Error(`Unrecorded vendor modification: ${file}`);
}
console.log(
  `Verified ${Object.keys(manifest.files).length} pinned Forge files at ${manifest.commit}.`,
);
