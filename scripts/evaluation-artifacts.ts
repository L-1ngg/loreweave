import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

const repository = resolve(import.meta.dirname, "..");
export const baselineDirectory = join(
  repository,
  "evaluation/baselines/pageindex-v1",
);
export const baselineManifest = z
  .object({
    schemaVersion: z.literal(1),
    sourceRevision: z.string(),
    implementationRevision: z.string(),
    artifacts: z.array(
      z.object({
        sourcePath: z.string(),
        path: z.string(),
        sha256: z.string(),
      }),
    ),
    fixtures: z.array(z.object({ path: z.string(), sha256: z.string() })),
  })
  .parse(
    JSON.parse(readFileSync(join(baselineDirectory, "manifest.json"), "utf8")),
  );
const invocation = `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`;
const within = (parent: string, path: string) => {
  const part = relative(parent, path);
  return (
    part === "" ||
    (!part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part))
  );
};

export function evaluationOutputPath(name: string, override?: string) {
  const mutableRoot = join(repository, ".pageindex-data/evaluation/runs");
  const directory = resolve(
    process.env.LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY ??
      join(mutableRoot, invocation),
  );
  const path = override ? resolve(override) : resolve(directory, name);
  if (within(repository, path) && !within(mutableRoot, path))
    throw new Error("evaluation_output_requires_ignored_run_directory");
  let parent = path;
  while (!existsSync(parent)) parent = dirname(parent);
  const canonical = resolve(realpathSync(parent), relative(parent, path));
  if (
    within(realpathSync(repository), canonical) &&
    !within(mutableRoot, canonical)
  )
    throw new Error("evaluation_output_requires_ignored_run_directory");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function evaluationInputPath(name: string) {
  const artifact = baselineManifest.artifacts.find(
    (entry) => entry.sourcePath === name || entry.path === name,
  );
  return artifact ? join(baselineDirectory, artifact.path) : resolve(name);
}

export const reviewedBaselineCandidates = [
  "pageindex-real.json",
  "pageindex-real-regression.json",
  "pageindex-large-retry.json",
  "pageindex-large-final.json",
];

export function isReviewedBaselineComparison(comparison: {
  candidatePaths: string[];
  referencePath: string;
  additionalReferencePaths: string[];
}) {
  return (
    comparison.candidatePaths.length === reviewedBaselineCandidates.length &&
    comparison.candidatePaths.every(
      (path, index) =>
        evaluationInputPath(path) ===
        evaluationInputPath(reviewedBaselineCandidates[index]),
    ) &&
    evaluationInputPath(comparison.referencePath) ===
      evaluationInputPath("pageindex-full-reference.json") &&
    comparison.additionalReferencePaths.length === 1 &&
    evaluationInputPath(comparison.additionalReferencePaths[0]) ===
      evaluationInputPath("pageindex-encrypted-reference.json")
  );
}

export async function readEvaluationArtifact(name: string) {
  const path = evaluationInputPath(name);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const artifact = baselineManifest.artifacts.find(
    (entry) => join(baselineDirectory, entry.path) === path,
  );
  if (
    artifact &&
    createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
  )
    throw new Error(`baseline_artifact_changed:${artifact.path}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}
