// Reproducible descriptive metrics; semantic support is reviewed separately.
export {};
const paired = await Bun.file(
  "docs/evaluation/pageindex-paired-comparison.json",
).json();
const candidates = await Promise.all(
  paired.candidatePaths.map(async (path: string) => ({
    path,
    report: await Bun.file(path).json(),
  })),
);
const latestQuestions = new Map<string, any>();
for (const { path, report } of candidates)
  for (const q of report.questions)
    latestQuestions.set(`${q.mode}:${q.id}`, { ...q, report: path });
const distribution = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1),
  };
};
const usage = (entries: any[]) =>
  entries.reduce(
    (out, e) => {
      const u =
        e.run?.usage ?? e.result?.usage ?? e.operation?.attempts?.[0]?.usage;
      if (u) {
        out.recordsWithUsage++;
        for (const key of [
          "modelCalls",
          "toolCalls",
          "readPages",
          "inputTokens",
          "outputTokens",
        ])
          out[key] += u[key] ?? 0;
      }
      return out;
    },
    {
      recordsWithUsage: 0,
      modelCalls: 0,
      toolCalls: 0,
      readPages: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  );
const outcome = (q: any) => q.status ?? q.result?.status;
const measurements = ["flash", "standard"].map((mode) => {
  const records = paired.records.filter((r: any) => r.mode === mode);
  const questions = [...latestQuestions.values()].filter(
    (q) => q.mode === mode,
  );
  const web = questions.filter((q) => q.id !== "mcp-revenue");
  const mcp = questions.filter((q) => q.id === "mcp-revenue");
  const accepted = records.filter((r: any) => r.ts.status === "ready");
  return {
    mode,
    imports: paired.coverage.find((c: any) => c.mode === mode),
    acceptedTSInvariants: {
      accepted: accepted.length,
      validRanges: accepted.every(
        (r: any) => r.ts.shape.nodes === r.ts.shape.validRanges,
      ),
      completePhysicalCoverage: accepted.every(
        (r: any) => r.ts.shape.completePageCoverage,
      ),
      summariesOnEveryNode: accepted.every(
        (r: any) => r.ts.shape.nodes === r.ts.shape.nodesWithSummaries,
      ),
    },
    extraction: {
      bothExtracted: records.filter((r: any) => r.extraction.bothExtracted)
        .length,
      perPageCharacterPreservation: records.filter(
        (r: any) =>
          r.extraction.bothExtracted &&
          !r.extraction.differingPhysicalPages.length,
      ).length,
      identicalOrder: records.filter(
        (r: any) => r.extraction.bothExtracted && r.extraction.sameOrder,
      ).length,
    },
    pairedReachability: records
      .flatMap((r: any) => r.evidenceReachability)
      .reduce(
        (out: any, e: any) => ({
          total: out.total + 1,
          ts: out.ts + Number(e.ts),
          python: out.python + Number(e.python),
        }),
        { total: 0, ts: 0, python: 0 },
      ),
    indexLatency: {
      tsReady: distribution(accepted.map((r: any) => r.ts.elapsedMs)),
      pythonCompleted: distribution(
        records
          .filter((r: any) => r.python.status === "completed")
          .map((r: any) => r.python.elapsedMs),
      ),
    },
    selectedIndexAttemptUsage: usage(
      records.map((r: any) => ({ run: { usage: r.ts.usage } })),
    ),
    web: {
      questions: web.length,
      completed: web.filter((q) => outcome(q) === "completed").length,
      latency: distribution(
        web.filter((q) => outcome(q) === "completed").map((q) => q.elapsedMs),
      ),
      usage: usage(web),
      outcomes: web.map((q) => ({
        id: q.id,
        status: outcome(q),
        outcome: q.run?.result?.outcome,
        report: q.report,
        lexical: q.checks?.lexicalFacts ?? null,
      })),
    },
    mcp: {
      questions: mcp.length,
      completed: mcp.filter((q) => outcome(q) === "completed").length,
      latency: distribution(mcp.map((q) => q.elapsedMs)),
      usage: usage(mcp),
    },
  };
});
const ledgerPaths = [
  "docs/evaluation/pageindex-real-preflight-failures.json",
  "docs/evaluation/pageindex-real-initial-ledger.json",
  "docs/evaluation/pageindex-real-ledger.json",
  "docs/evaluation/pageindex-regression-real-ledger.json",
  "docs/evaluation/pageindex-large-retry-ledger.json",
  "docs/evaluation/pageindex-reference-real-ledger.json",
  "docs/evaluation/pageindex-encrypted-reference-ledger.json",
  "docs/evaluation/pageindex-large-final-ledger.json",
];
const ledgers = await Promise.all(
  ledgerPaths.map(async (path) => {
    const value = await Bun.file(path).json();
    const r = value.ledger ?? value;
    return {
      path,
      observedCostUSD: r.observedCostUSD,
      walletDeltaUSD: r.walletDeltaUSD,
      previousCostUSD: r.previousProbeCostUSD,
      keyCumulative: r.keyCumulative ?? null,
      recordedCalls: r.calls.length,
      recordsWithoutUsage: r.calls.filter((c: any) => !c.usage).length,
      cancellations: r.calls.filter((c: any) => c.cancelled).length,
      requestErrors: r.calls
        .filter((c: any) => c.error)
        .map((c: any) => ({ lane: c.lane, error: c.error })),
      inputTokens: r.calls.reduce(
        (n: number, c: any) => n + (c.usage?.prompt_tokens ?? 0),
        0,
      ),
      outputTokens: r.calls.reduce(
        (n: number, c: any) => n + (c.usage?.completion_tokens ?? 0),
        0,
      ),
      lanes: [...new Set(r.calls.map((c: any) => c.lane))].map((lane) => {
        const calls = r.calls.filter((c: any) => c.lane === lane);
        return {
          lane,
          calls: calls.length,
          recordsWithoutUsage: calls.filter((c: any) => !c.usage).length,
          latency: distribution(calls.map((c: any) => c.elapsedMs)),
          firstOutput: distribution(calls.map((c: any) => c.firstOutputMs)),
          inputTokens: calls.reduce(
            (n: number, c: any) => n + (c.usage?.prompt_tokens ?? 0),
            0,
          ),
          outputTokens: calls.reduce(
            (n: number, c: any) => n + (c.usage?.completion_tokens ?? 0),
            0,
          ),
        };
      }),
    };
  }),
);
const report = {
  date: new Date().toISOString(),
  method:
    "Latest explicitly selected result per mode/input/question, with all earlier trial failures retained in candidateTrials and ledgers. Descriptive fixed-corpus metrics, not a general quality guarantee. Latency is observed wall time and includes the serialized accounting proxy. Semantic support is in the named review, not inferred from lexical checks.",
  comparison: "docs/evaluation/pageindex-paired-comparison.json",
  measurements,
  ledgers,
  accountingIntervals: [
    ...ledgers.map((r) => ({
      path: r.path,
      previousCostUSD: r.previousCostUSD,
      observedCostUSD: r.observedCostUSD,
    })),
    {
      path: "docs/evaluation/pageindex-real-index-checkpoint.json",
      ...(
        await Bun.file(
          "docs/evaluation/pageindex-real-index-checkpoint.json",
        ).json()
      ).accounting,
    },
  ],
  finalKeyAccounting: ledgers.at(-1)?.keyCumulative,
  lifecycle: candidates.flatMap((c) => c.report.observations ?? []),
  semanticReview: "docs/evaluation/pageindex-semantic-review.md",
  service: "docs/development/pageindex-local-service.json",
  boundaries: [
    "Synthetic acceptance originals; no population benchmark",
    "Implementation-agent original review; no blind independent reviewer",
    "Python comparison measures indexing and fixed original reachability, not a Python QA score",
    "Missing provider usage on cancelled/failed calls is not zero usage",
    "Wallet deltas include other account activity; use key actual_cost with USD unit; hard quota is owner controlled",
  ],
};
await Bun.write(
  "docs/evaluation/pageindex-measurements.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(measurements, null, 2));
