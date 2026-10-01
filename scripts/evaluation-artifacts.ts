import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const repository = resolve(import.meta.dirname, "..");
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

export function requiredEvaluationInput(variable: string) {
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`evaluation_input_required:${variable}`);
  return value;
}

export async function readEvaluationArtifact(path: string) {
  return Bun.file(resolve(path)).json();
}
