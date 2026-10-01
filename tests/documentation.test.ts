import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectDocumentation } from "../scripts/check-docs";
import {
  evaluationOutputPath,
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
      "evaluation/result.json",
    ]).failures;
    expect(failures.some((f) => f.includes("missing anchor"))).toBe(true);
    expect(failures.some((f) => f.includes("missing target"))).toBe(true);
    expect(failures.some((f) => f.includes("unreachable"))).toBe(true);
    expect(failures.some((f) => f.includes("task copies"))).toBe(true);
    expect(failures.some((f) => f.includes("outside Git"))).toBe(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("evaluation requires explicit run inputs and ledgers and leaves semantic review pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "loreweave-cohort-test-"));
  try {
    const candidate = join(root, "candidate.json");
    const reference = join(root, "reference.json");
    const inputs = [
      ...(await Bun.file("tests/fixtures/pdf/manifest.json").json()).fixtures,
      ...(await Bun.file("tests/fixtures/pdf/question-manifest.json").json())
        .fixtures,
      await Bun.file("tests/fixtures/pdf/boundary-manifest.json").json(),
    ];
    const imports = ["flash", "standard"].flatMap((mode) =>
      inputs.map((f) => ({
        mode,
        file: f.file,
        sha256: f.sha256,
        status: "unsupported",
        reason: "controlled test record",
        pages: [],
        tree: [],
        elapsedMs: 0,
      })),
    );
    await Bun.write(
      candidate,
      JSON.stringify({ imports, questions: [], failures: [] }),
    );
    await Bun.write(
      reference,
      JSON.stringify({
        reference: "controlled-reference",
        model: "fixture",
        fixtures: imports,
      }),
    );
    const run = join(root, "run");
    const env = {
      ...process.env,
      LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY: run,
      LOREWEAVE_COMPARE_CANDIDATES: candidate,
      LOREWEAVE_COMPARE_REFERENCE: reference,
      LOREWEAVE_COMPARE_REFERENCES: "",
      LOREWEAVE_COMPARE_INPUT: join(run, "pageindex-paired-comparison.json"),
      LOREWEAVE_MEASUREMENT_LEDGERS: "",
      LOREWEAVE_MEASUREMENT_CHECKPOINT: "",
    };
    const compare = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/compare-evaluation.ts"],
      { env },
    );
    expect(compare.exitCode).toBe(0);
    const paired = await Bun.file(env.LOREWEAVE_COMPARE_INPUT).json();
    expect(paired.semanticReview).toContain("pending");
    expect(paired.candidatePaths).toEqual([candidate]);
    expect(paired.referencePath).toBe(reference);
    expect(paired.additionalReferencePaths).toEqual([]);
    const blocked = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/report-evaluation.ts"],
      { env },
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr.toString()).toContain(
      "evaluation_input_required:LOREWEAVE_MEASUREMENT_LEDGERS",
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
    const missing = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/compare-evaluation.ts"],
      { env: { ...env, LOREWEAVE_COMPARE_CANDIDATES: "" } },
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain(
      "evaluation_input_required:LOREWEAVE_COMPARE_CANDIDATES",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("evaluation reads explicit local results and refuses tracked/symlink output targets", async () => {
  expect(() =>
    evaluationOutputPath("result.json", "docs/evaluation/pageindex-v1.md"),
  ).toThrow("ignored_run_directory");
  expect(() =>
    evaluationOutputPath("result.json", "tests/fixtures/questions.json"),
  ).toThrow("ignored_run_directory");
  const root = await mkdtemp(join(tmpdir(), "loreweave-artifacts-test-"));
  try {
    await symlink(
      resolve("tests/fixtures/questions.json"),
      join(root, "alias.json"),
    );
    expect(() =>
      evaluationOutputPath("result.json", join(root, "alias.json")),
    ).toThrow("ignored_run_directory");
    const output = evaluationOutputPath(
      "result.json",
      join(root, "new/result.json"),
    );
    await Bun.write(output, '{"value":123}');
    expect(await readEvaluationArtifact(output)).toEqual({ value: 123 });
  } finally {
    await rm(root, { recursive: true });
  }
});
