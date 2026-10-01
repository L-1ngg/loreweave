import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import MarkdownIt from "markdown-it";

const root = process.cwd();
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((p) => p.endsWith(".md") && existsSync(p));
const parser = new MarkdownIt();
let checked = 0;
const failures: string[] = [];
for (const file of new Set(files)) {
  const body = readFileSync(file, "utf8");
  if (
    file.startsWith(".scratch/") ||
    body.startsWith("> Historical ") ||
    file.startsWith("docs/history/") ||
    file.startsWith("docs/research/")
  )
    continue;
  const tokens = parser.parse(body, {});
  for (const token of tokens.flatMap((t) => t.children ?? [t])) {
    if (token.type !== "link_open") continue;
    const href = String(token.attrGet("href") ?? "");
    if (
      !href ||
      /^[a-z][a-z\d+.-]*:/i.test(href) ||
      href.startsWith("/") ||
      href.startsWith("#")
    )
      continue;
    const relative = decodeURIComponent(href.split("#")[0]);
    checked++;
    if (!existsSync(resolve(root, dirname(file), relative)))
      failures.push(`${file}: ${href}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${checked} active local Markdown links; retired records use their documented recovery baseline.`,
  );
