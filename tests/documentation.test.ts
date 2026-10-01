import { test, expect } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectDocumentation } from "../scripts/check-docs";
import {
  evaluationOutputPath,
  evaluationInputPath,
  readEvaluationArtifact,
} from "../scripts/evaluation-artifacts";

test("documentation checks Unicode/duplicate anchors, images, navigation and task-copy placement", async () => {
  const root = await mkdtemp(join(tmpdir(), "loreweave-docs-test-"));
  try {
    await mkdir(join(root, "docs/guides"), { recursive: true });
    await writeFile(
      join(root, "docs/README.md"),
      "# Docs\n\n[Read](guides/use.md#原文-1)\n",
    );
    await writeFile(
      join(root, "docs/guides/use.md"),
      "# 原文\n\n## 原文\n\n![Original](../../original.png)\n",
    );
    await writeFile(join(root, "original.png"), "fixture");
    const files = ["docs/README.md", "docs/guides/use.md"];
    expect(inspectDocumentation(root, files).failures).toEqual([]);
    await writeFile(
      join(root, "docs/guides/use.md"),
      "# 原文\n\n[Wrong](#missing)\n\n![Missing](../../absent.png)\n",
    );
    await writeFile(join(root, "docs/guides/orphan.md"), "# Orphan\n");
    const failures = inspectDocumentation(root, [
      ...files,
      "docs/guides/orphan.md",
      "docs/development/issue-99.md",
    ]).failures;
    expect(failures.some((f) => f.includes("missing anchor"))).toBe(true);
    expect(failures.some((f) => f.includes("missing target"))).toBe(true);
    expect(failures.some((f) => f.includes("unreachable"))).toBe(true);
    expect(failures.some((f) => f.includes("task copies"))).toBe(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("new evaluation cohorts require their own ledgers and do not inherit baseline review or cost", async () => {
  const root = await mkdtemp(join(tmpdir(), "loreweave-cohort-test-"));
  try {
    const candidate = join(root, "candidate.json");
    await copyFile(evaluationInputPath("pageindex-real.json"), candidate);
    const run = join(root, "run");
    const env = {
      ...process.env,
      LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY: run,
      LOREWEAVE_COMPARE_CANDIDATES: candidate,
      LOREWEAVE_COMPARE_INPUT: join(run, "pageindex-paired-comparison.json"),
      LOREWEAVE_MEASUREMENT_LEDGERS: "",
      LOREWEAVE_MEASUREMENT_CHECKPOINT: "",
    };
    const compare = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/compare-evaluation.ts"],
      { env },
    );
    expect(compare.exitCode).toBe(0);
    expect(
      (await Bun.file(env.LOREWEAVE_COMPARE_INPUT).json()).semanticReview,
    ).toContain("pending");
    const blocked = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/report-evaluation.ts"],
      { env },
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr.toString()).toContain(
      "new_candidate_ledger_selection_required",
    );
    expect(
      await Bun.file(join(run, "pageindex-measurements.json")).exists(),
    ).toBe(false);
    const ledger = join(root, "ledger.json");
    await Bun.write(
      ledger,
      JSON.stringify({
        observedCostUSD: 0,
        keyCumulative: { actual_cost: 0 },
        calls: [],
      }),
    );
    const report = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/report-evaluation.ts"],
      {
        env: { ...env, LOREWEAVE_MEASUREMENT_LEDGERS: ledger },
      },
    );
    expect(report.exitCode).toBe(0);
    const measured = await Bun.file(
      join(run, "pageindex-measurements.json"),
    ).json();
    expect(measured.semanticReview).toContain("pending");
    expect(measured.service).toBeNull();
    expect(measured.ledgers.length).toBe(1);
    expect(measured.accountingIntervals.length).toBe(1);
    expect(measured.finalKeyAccounting.actual_cost).toBe(0);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("evaluation reads byte-verified legacy provenance and refuses tracked/symlink output targets", async () => {
  const record = await readEvaluationArtifact(
    "docs/evaluation/pageindex-paired-comparison.json",
  );
  expect(
    record.coverage.map((entry: { denominator: number }) => entry.denominator),
  ).toEqual([15, 15]);
  expect(() =>
    evaluationOutputPath("result.json", "docs/evaluation/pageindex-v1.md"),
  ).toThrow("ignored_run_directory");
  expect(() =>
    evaluationOutputPath(
      "result.json",
      "evaluation/baselines/pageindex-v1/pageindex-real.json",
    ),
  ).toThrow("ignored_run_directory");
  const root = await mkdtemp(join(tmpdir(), "loreweave-artifacts-test-"));
  try {
    await symlink(
      resolve("evaluation/baselines/pageindex-v1/pageindex-real.json"),
      join(root, "alias.json"),
    );
    expect(() =>
      evaluationOutputPath("result.json", join(root, "alias.json")),
    ).toThrow("ignored_run_directory");
    const output = evaluationOutputPath(
      "result.json",
      join(root, "new/result.json"),
    );
    await Bun.write(output, "{}");
    expect(await Bun.file(output).text()).toBe("{}");
  } finally {
    await rm(root, { recursive: true });
  }
});
