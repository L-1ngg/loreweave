import { resolve } from "node:path";
import { evaluationOutputPath } from "./evaluation-artifacts";
const source = process.env.LOREWEAVE_PAGEINDEX_REFERENCE;
const reportPath = evaluationOutputPath(
  "pageindex-reference.json",
  process.env.LOREWEAVE_REFERENCE_REPORT,
);
if (!source)
  throw new Error(
    "Set LOREWEAVE_PAGEINDEX_REFERENCE to the external pinned checkout.",
  );
const revision = Bun.spawn(["git", "rev-parse", "HEAD"], {
  cwd: source,
  stdout: "pipe",
});
if (
  (await new Response(revision.stdout).text()).trim() !==
  "d2693d80791a86345ef78b3234834f5fe53a70a0"
)
  throw new Error("reference_revision_mismatch");
const child = Bun.spawn(
  [
    "uv",
    "run",
    "--no-project",
    "--with",
    "pypdfium2",
    "--with",
    "PyPDF2==3.0.1",
    "--with",
    "sortedcontainers==2.4.0",
    "--with",
    "regex",
    "--with",
    "python-dotenv",
    "--with",
    "pyyaml",
    resolve("tests/comparison/pageindex.py"),
    resolve(source),
    resolve("tests/fixtures/pdf"),
  ],
  {
    cwd: source,
    env: { ...process.env, PYTHON_DOTENV_DISABLED: "1" },
    stdout: "pipe",
    stderr: "inherit",
  },
);
const text = await new Response(child.stdout).text();
if (await child.exited) throw new Error("reference_comparison_failed");
const result = JSON.parse(text);
await Bun.write(reportPath, JSON.stringify(result, null, 2) + "\n");
console.log(
  `Pinned isolated reference: ${result.fixtures.length} fixtures, no model requests.`,
);
