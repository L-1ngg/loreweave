import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";

const directory = resolve(import.meta.dirname, "../tests/fixtures/pdf");
const fixture = z.object({
  file: z.string().regex(/^[a-z0-9-]+\.pdf$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifest = z.object({ fixtures: z.array(fixture) });
const entries = [
  ...manifest.parse(await Bun.file(`${directory}/manifest.json`).json())
    .fixtures,
  ...manifest.parse(
    await Bun.file(`${directory}/question-manifest.json`).json(),
  ).fixtures,
  fixture.parse(await Bun.file(`${directory}/boundary-manifest.json`).json()),
];
const files = new Set<string>();
for (const entry of entries) {
  if (files.has(entry.file)) throw new Error(`duplicate_fixture:${entry.file}`);
  files.add(entry.file);
  const bytes = new Uint8Array(
    await Bun.file(`${directory}/${entry.file}`).arrayBuffer(),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error(`frozen_fixture_changed:${entry.file}`);
}
console.log(
  `Verified ${entries.length} fixed PDF inputs against their manifests.`,
);
