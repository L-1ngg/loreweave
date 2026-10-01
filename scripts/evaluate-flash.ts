import { extractPdf } from "../src/server/pdf-engine";
import { buildFlash, validateTree } from "../src/server/trees";
const reference = await Bun.file(
  "docs/evaluation/pageindex-reference.json",
).json();
const records = [];
function flat(nodes: any[]): any[] {
  return nodes.flatMap((n) => [
    { title: n.title, start: n.start_index, end: n.end_index },
    ...flat(n.nodes ?? []),
  ]);
}
for (const fixture of reference.fixtures) {
  try {
    const extraction = await extractPdf(
      new Uint8Array(
        await Bun.file(`tests/fixtures/pdf/${fixture.file}`).arrayBuffer(),
      ),
    );
    const tree = buildFlash(extraction);
    validateTree(tree, extraction);
    const ref = flat(fixture.tree?.structure ?? []);
    const matching = tree.filter((n) =>
      ref.some(
        (r) =>
          r.start === n.start &&
          r.title.toLowerCase().replace(/\s/g, "") ===
            n.title.toLowerCase().replace(/\s/g, ""),
      ),
    ).length;
    records.push({
      file: fixture.file,
      sha256: fixture.sha256,
      ts: "candidate",
      modelCalls: 0,
      nodes: tree.length,
      tree,
      referenceNodes: ref.length,
      referenceSource: fixture.tree?.toc_source,
      referenceRefusal: fixture.refusal ?? fixture.treeError ?? null,
      matchingTitlesAndPages: matching,
    });
  } catch (e) {
    records.push({
      file: fixture.file,
      sha256: fixture.sha256,
      ts: e instanceof Error ? e.message : "failed",
      referenceRefusal: fixture.refusal ?? fixture.treeError ?? null,
    });
  }
}
const report = {
  date: new Date().toISOString(),
  reference: reference.reference,
  records,
  tolerances:
    "Every accepted tree requires physical bounds, verified start anchors, hierarchy and every-page reachability. Exact tree shape and IDs are not an acceptance target. Python's layout/bookmark classification differences are reported; no model quality is asserted by raw candidates.",
};
await Bun.write(
  "docs/evaluation/pageindex-flash-candidate.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    records.map(({ tree, ...r }: any) => r),
    null,
    2,
  ),
);
