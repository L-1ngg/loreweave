import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import MarkdownIt from "markdown-it";
import GithubSlugger from "github-slugger";

const parser = new MarkdownIt();

export function inspectDocumentation(root: string, files: string[]) {
  const failures: string[] = [];
  const documents = new Map<string, ReturnType<typeof parser.parse>>();
  const anchors = new Map<string, Set<string>>();
  const graph = new Map<string, string[]>();
  let checked = 0;
  let checkedAnchors = 0;

  for (const file of new Set(files)) {
    if (file.startsWith(".scratch/"))
      failures.push(`${file}: local drafts must be ignored`);
    if (file.startsWith("evaluation/"))
      failures.push(
        `${file}: generated evaluation results must stay outside Git`,
      );
    if (file.startsWith("docs/")) {
      if (/\/(?:tickets|issues)(?:\/|\.)|\/issue-\d+\.md$/.test(file))
        failures.push(`${file}: task copies belong in GitHub Issues`);
      if (
        !/^docs\/(?:README\.md|history\.md|(?:guides|architecture|development|evaluation|adr)\/.+\.md|licenses\/[^/]+\.txt|assets\/.+\.(?:png|jpg|svg|webp|gif))$/.test(
          file,
        )
      )
        failures.push(
          `${file}: unsupported document or generated artifact location`,
        );
    }
    const authored =
      file.startsWith("docs/") ||
      [
        "README.md",
        "CONTRIBUTING.md",
        "CONTEXT.md",
        "AGENTS.md",
        "NOTICE.md",
      ].includes(file);
    const path = resolve(root, file);
    if (authored && file.endsWith(".md") && existsSync(path))
      documents.set(path, parser.parse(readFileSync(path, "utf8"), {}));
  }

  const headingAnchors = (path: string) => {
    if (anchors.has(path)) return anchors.get(path)!;
    const ids = new Set<string>();
    const slugger = new GithubSlugger();
    const tokens =
      documents.get(path) ?? parser.parse(readFileSync(path, "utf8"), {});
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "heading_open") continue;
      const inline = tokens[i + 1];
      const text = (inline?.children ?? [])
        .filter((t) => ["text", "code_inline", "image"].includes(t.type))
        .map((t) => t.content)
        .join("");
      ids.add(slugger.slug(text));
    }
    anchors.set(path, ids);
    return ids;
  };

  for (const [file, tokens] of documents) {
    graph.set(file, []);
    for (const token of tokens.flatMap((t) => t.children ?? [t])) {
      if (!["link_open", "image"].includes(token.type)) continue;
      const href = String(
        token.attrGet(token.type === "image" ? "src" : "href") ?? "",
      );
      // Absolute paths are machine-owned context pointers, not portable repository links.
      if (!href || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("/"))
        continue;
      let target: string;
      let anchor: string;
      try {
        const hash = href.indexOf("#");
        const destination = decodeURIComponent(
          hash < 0 ? href : href.slice(0, hash),
        );
        anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
        target = destination ? resolve(dirname(file), destination) : file;
      } catch {
        failures.push(`${relative(root, file)}: malformed link ${href}`);
        continue;
      }
      checked++;
      if (!existsSync(target)) {
        failures.push(`${relative(root, file)}: missing target ${href}`);
        continue;
      }
      if (documents.has(target)) graph.get(file)!.push(target);
      if (anchor && target.endsWith(".md")) {
        checkedAnchors++;
        if (!headingAnchors(target).has(anchor))
          failures.push(`${relative(root, file)}: missing anchor ${href}`);
      }
    }
  }

  const index = resolve(root, "docs/README.md");
  if (!documents.has(index))
    failures.push("docs/README.md: documentation index required");
  const reachable = new Set<string>();
  const frontier = [index];
  while (frontier.length) {
    const next = frontier.pop()!;
    if (reachable.has(next)) continue;
    reachable.add(next);
    frontier.push(...(graph.get(next) ?? []));
  }
  for (const file of documents.keys())
    if (relative(root, file).startsWith("docs/") && !reachable.has(file))
      failures.push(`${relative(root, file)}: unreachable from docs/README.md`);

  return {
    failures: [...new Set(failures)],
    checked,
    checkedAnchors,
    documents: documents.size,
  };
}

if (import.meta.main) {
  const root = process.cwd();
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file && existsSync(resolve(root, file)));
  const result = inspectDocumentation(root, files);
  if (result.failures.length) {
    console.error(result.failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Checked ${result.documents} authored documents, ${result.checked} local links/images and ${result.checkedAnchors} heading anchors; navigation and placement passed.`,
    );
  }
}
