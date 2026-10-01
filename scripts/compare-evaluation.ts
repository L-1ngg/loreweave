// Artifact comparison only. Semantic answer/citation review is recorded separately.
import { hashData } from "../src/server/library";
import {
  evaluationInputPath,
  evaluationOutputPath,
  isReviewedBaselineComparison,
  reviewedBaselineCandidates,
  readEvaluationArtifact,
} from "./evaluation-artifacts";

const candidatePaths = (
  process.env.LOREWEAVE_COMPARE_CANDIDATES ??
  reviewedBaselineCandidates.join(",")
)
  .split(",")
  .map(evaluationInputPath);
const candidates = await Promise.all(
  candidatePaths.map(async (path) => ({
    path,
    report: await readEvaluationArtifact(path),
  })),
);
const referencePath = evaluationInputPath(
  process.env.LOREWEAVE_COMPARE_REFERENCE ?? "pageindex-full-reference.json",
);
const reference = await readEvaluationArtifact(referencePath);
const additionalReferencePaths = (
  process.env.LOREWEAVE_COMPARE_REFERENCES ??
  "pageindex-encrypted-reference.json"
)
  .split(",")
  .filter(Boolean)
  .map(evaluationInputPath);
const frozenCandidates = isReviewedBaselineComparison({
  candidatePaths,
  referencePath,
  additionalReferencePaths,
});
const referenceRecords = new Map(
  reference.fixtures.map((r: any) => [`${r.mode}:${r.file}`, r]),
);
for (const path of additionalReferencePaths) {
  const report = await readEvaluationArtifact(path);
  if (
    report.reference !== reference.reference ||
    report.model !== reference.model
  )
    throw new Error(`reference_configuration_mismatch:${path}`);
  for (const r of report.fixtures)
    referenceRecords.set(`${r.mode}:${r.file}`, { ...r, report: path });
}
const questions = await Bun.file("tests/fixtures/questions.json").json();
const expectedFiles = [
  ...(await Bun.file("tests/fixtures/pdf/manifest.json").json()).fixtures,
  ...(await Bun.file("tests/fixtures/pdf/question-manifest.json").json())
    .fixtures,
  await Bun.file("tests/fixtures/pdf/boundary-manifest.json").json(),
];
for (const f of expectedFiles)
  if (
    hashData(
      new Uint8Array(
        await Bun.file(`tests/fixtures/pdf/${f.file}`).arrayBuffer(),
      ),
    ) !== f.sha256
  )
    throw new Error(`frozen_fixture_changed:${f.file}`);
const latest = new Map<string, any>();
const answers = new Map<string, any>();
for (const { path, report } of candidates) {
  for (const d of report.imports)
    latest.set(`${d.mode}:${d.file}`, { ...d, report: path });
  for (const q of report.questions)
    answers.set(`${q.mode}:${q.id}`, { ...q, report: path });
}
type Node = {
  title: string;
  start: number;
  end: number;
  depth: number;
  summary?: string;
  id?: string;
};
function flatten(nodes: any[], depth = 0): Node[] {
  return nodes.flatMap((n) => [
    {
      title: n.title,
      start: n.start_index,
      end: n.end_index,
      depth,
      summary: n.summary,
      id: n.node_id,
    },
    ...flatten(n.nodes ?? [], depth + 1),
  ]);
}
const shape = (nodes: Node[], pageCount: number) => {
  const valid = nodes.filter(
    (n) =>
      Number.isInteger(n.start) &&
      Number.isInteger(n.end) &&
      n.start >= 1 &&
      n.end >= n.start &&
      n.end <= pageCount,
  );
  const coverage = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => valid.some((n) => p >= n.start && p <= n.end),
  );
  return {
    nodes: nodes.length,
    roots: nodes.filter((n) => n.depth === 0).length,
    maxDepth: Math.max(0, ...nodes.map((n) => n.depth)),
    validRanges: valid.length,
    coveredPhysicalPages: coverage.length,
    completePageCoverage: pageCount > 0 && coverage.length === pageCount,
    nodesWithSummaries: nodes.filter((n) => n.summary?.trim()).length,
    locations: nodes.map(({ title, start, end, depth }) => ({
      title,
      start,
      end,
      depth,
    })),
  };
};
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const chars = (s: string) => Array.from(normalize(s)).sort().join("");
const records: Array<{
  mode: string;
  file: string;
  sha256: string;
  ts: {
    report: string;
    status: string;
    reason: string | null;
    elapsedMs: number;
    usage: unknown;
    shape: ReturnType<typeof shape>;
  };
  python: {
    status: string;
    error: unknown;
    elapsedMs: number;
    shape: ReturnType<typeof shape>;
  };
  extraction: {
    bothExtracted: boolean;
    samePageCount: boolean;
    sameCharacters: boolean;
    differingPhysicalPages: number[];
    sameOrder: boolean;
  };
  evidenceReachability: { question: string; ts: boolean; python: boolean }[];
}> = [];
for (const mode of ["flash", "standard"])
  for (const fixture of expectedFiles) {
    const ts = latest.get(`${mode}:${fixture.file}`);
    const py: any = referenceRecords.get(`${mode}:${fixture.file}`);
    if (!ts || !py || ts.sha256 !== py.sha256 || ts.sha256 !== fixture.sha256)
      throw new Error(`missing_or_mismatched_pair:${mode}:${fixture.file}`);
    const tsNodes: Node[] = ts.tree ?? [];
    const pyNodes = flatten(py.tree?.structure ?? []);
    const tsText = (ts.pages ?? []).map((p: any) => p.text).join("");
    const pyText = (py.pages ?? []).join("");
    const evidenceReachability = questions.questions.flatMap((q: any) =>
      q.evidence
        .filter((e: any) => e.file === fixture.file)
        .map((e: any) => ({
          question: q.id,
          ts:
            ts.status === "ready" &&
            e.pages.some(
              (p: number) =>
                tsNodes.some((n) => p >= n.start && p <= n.end) &&
                (ts.pages ?? [])
                  .find((page: any) => page.number === p)
                  ?.text.includes(e.contains),
            ),
          python:
            py.status === "completed" &&
            e.pages.some(
              (p: number) =>
                pyNodes.some((n) => p >= n.start && p <= n.end) &&
                py.pages?.[p - 1]?.includes(e.contains),
            ),
        })),
    );
    records.push({
      mode,
      file: fixture.file,
      sha256: fixture.sha256,
      ts: {
        report: ts.report,
        status: ts.status,
        reason: ts.reason,
        elapsedMs: ts.elapsedMs,
        usage:
          ts.provenance?.usage ?? ts.operation?.attempts?.[0]?.usage ?? null,
        shape: shape(tsNodes, fixture.pages),
      },
      python: {
        status: py.status,
        error: py.error ?? py.refusal ?? null,
        elapsedMs: py.elapsedMs,
        shape: shape(pyNodes, fixture.pages),
      },
      extraction: {
        bothExtracted: !!tsText && !!pyText,
        samePageCount: ts.pages?.length === py.pages?.length,
        sameCharacters: !!tsText && !!pyText && chars(tsText) === chars(pyText),
        differingPhysicalPages: Array.from(
          { length: fixture.pages },
          (_, i) => i + 1,
        ).filter(
          (page) =>
            chars(ts.pages?.find((p: any) => p.number === page)?.text ?? "") !==
            chars(py.pages?.[page - 1] ?? ""),
        ),
        sameOrder:
          !!tsText && !!pyText && normalize(tsText) === normalize(pyText),
      },
      evidenceReachability,
    });
  }
const report = {
  date: new Date().toISOString(),
  candidatePaths,
  candidateTrials: candidates.map(({ path, report }) => ({
    path,
    selection: report.selection ?? { fixtures: null, questions: null },
    imports: ["flash", "standard"].map((mode) => ({
      mode,
      observed: report.imports.filter((d: any) => d.mode === mode).length,
      ready: report.imports.filter(
        (d: any) => d.mode === mode && d.status === "ready",
      ).length,
      rejected: report.imports
        .filter((d: any) => d.mode === mode && d.status !== "ready")
        .map((d: any) => ({
          file: d.file,
          status: d.status,
          reason: d.reason,
        })),
      earlierFailedAttempts: report.imports
        .filter((d: any) => d.mode === mode && d.deliberateRetry)
        .map((d: any) => ({
          file: d.file,
          outcome: d.deliberateRetry.originalOutcome,
        })),
    })),
    questionOutcomes: report.questions.map((q: any) => ({
      mode: q.mode,
      id: q.id,
      status: q.status ?? q.result?.status,
      reason: q.reason ?? q.result?.reason ?? q.why ?? null,
    })),
    failures: report.failures,
  })),
  referencePath,
  additionalReferencePaths,
  referenceRevision: reference.reference,
  questionSHA256: hashData(
    await Bun.file("tests/fixtures/questions.json").text(),
  ),
  method:
    "Paired frozen bytes, same declared model, complete modes and default summaries/optimization. Shape/range and character metrics describe raw artifacts, including rejected trees. Reachability requires an accepted index and the shared fixed question's original phrase on an indexed physical page; it is not a Python QA quality score or proof of semantic summary correctness.",
  coverage: ["flash", "standard"].map((mode) => {
    const subset = records.filter((r) => r.mode === mode);
    return {
      mode,
      denominator: expectedFiles.length,
      tsReady: subset.filter((r) => r.ts.status === "ready").length,
      tsRejected: subset
        .filter((r) => r.ts.status !== "ready")
        .map((r) => ({
          file: r.file,
          status: r.ts.status,
          reason: r.ts.reason,
        })),
      pythonCompleted: subset.filter((r) => r.python.status === "completed")
        .length,
      pythonRejected: subset
        .filter((r) => r.python.status !== "completed")
        .map((r) => ({
          file: r.file,
          status: r.python.status,
          reason: r.python.error,
        })),
    };
  }),
  records,
  qaChecks: [...answers.values()].map((q) => ({
    mode: q.mode,
    id: q.id,
    report: q.report,
    status: q.status ?? q.result?.status,
    outcome: q.run?.result?.outcome ?? q.result?.answer?.outcome,
    checks: q.checks,
    elapsedMs: q.elapsedMs,
    usage: q.run?.usage ?? q.result?.usage,
  })),
  semanticReview: frozenCandidates
    ? "docs/evaluation/pageindex-v1.md (implementation-agent original-evidence review; not a blind independent or population-scale benchmark)"
    : "pending explicit original-evidence review of this candidate cohort",
};
await Bun.write(
  evaluationOutputPath("pageindex-paired-comparison.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report.coverage, null, 2));
