import { resolve } from "node:path";
import { evaluationProvider } from "./evaluation-provider";
const source = process.env.LOREWEAVE_PAGEINDEX_REFERENCE;
if (!source) throw new Error("LOREWEAVE_PAGEINDEX_REFERENCE_required");
const pinned = Bun.spawn(["git", "rev-parse", "HEAD"], {
  cwd: source,
  stdout: "pipe",
});
if (
  (await new Response(pinned.stdout).text()).trim() !==
  "d2693d80791a86345ef78b3234834f5fe53a70a0"
)
  throw new Error("reference_revision_mismatch");
const provider = await evaluationProvider();
provider.setLane("python:complete-comparison");
const child = Bun.spawn(
  [
    "uv",
    "run",
    "--no-project",
    "--python",
    "3.12",
    "--with",
    "litellm==1.97.0",
    "--with",
    "pypdfium2==5.13.0",
    "--with",
    "PyPDF2==3.0.1",
    "--with",
    "pycryptodome==3.23.0",
    "--with",
    "sortedcontainers==2.4.0",
    "--with",
    "regex",
    "--with",
    "python-dotenv==1.2.2",
    "--with",
    "pyyaml==6.0.2",
    resolve("tests/comparison/full.py"),
    resolve(source),
    resolve("tests/fixtures/pdf"),
    resolve(
      process.env.LOREWEAVE_REFERENCE_REPORT ??
        "docs/evaluation/pageindex-full-reference.json",
    ),
  ],
  {
    cwd: source,
    env: {
      ...process.env,
      PYTHON_DOTENV_DISABLED: "1",
      OPENAI_API_KEY: provider.key,
      OPENAI_BASE_URL: provider.url,
      LOREWEAVE_REFERENCE_MODEL: provider.model,
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
try {
  const code = await child.exited;
  const accounting = await provider.finish();
  console.log(JSON.stringify({ code, accounting }));
  process.exitCode = code;
} finally {
  if (child.exitCode === null) child.kill();
}
