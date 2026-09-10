import { hash, record } from "./answer-validation.ts";
import {
  Operations,
  jsonValue,
  type Job,
  type Transaction,
} from "./operations.ts";
import { SourceService } from "./sources.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import type { WikiCandidate, TopicDescriptor, WikiPack } from "./wiki-types.ts";
interface DetailRange {
  pageId: string;
  version: string;
  kind: "page" | "original" | "descriptor";
  passageId?: string;
  start: number;
  end: number;
  text: string;
  hash: string;
}
/** Inspection notes route edits; only the separate support review authorizes prose. */
export class WikiInspection {
  constructor(
    private readonly operations: Operations,
    private readonly sources: SourceService,
    private readonly runtime: WikiModelRuntime,
  ) {}
  async inspect(
    job: Job,
    index: number,
    topic: TopicDescriptor,
    candidates: WikiCandidate[],
    contribution: WikiPack,
  ) {
    const key = `inspection:${index}`;
    const ranges: DetailRange[] = [];
    for (const candidate of candidates) {
      const [page] = await this.operations
        .sql`SELECT body,sources,descriptor FROM wiki_versions WHERE id=${candidate.version} AND page_id=${candidate.id}`;
      if (!page) throw new Error("version_conflict");
      ranges.push(
        ...splitRange({
          pageId: candidate.id,
          version: candidate.version,
          kind: "descriptor",
          text: JSON.stringify(page.descriptor),
        }),
      );
      ranges.push(
        ...splitRange({
          pageId: candidate.id,
          version: candidate.version,
          kind: "page",
          text: String(page.body),
        }),
      );
      const versions = new Set<string>();
      for (const ref of page.sources) {
        let source = await this.sources.maintenanceVersion(
          job.operationId,
          String(ref.version),
        );
        if (source.version !== source.currentVersionId)
          source = await this.sources.maintenanceVersion(
            job.operationId,
            source.currentVersionId,
          );
        if (versions.has(source.version)) continue;
        versions.add(source.version);
        for (const passage of source.passages)
          ranges.push(
            ...splitRange({
              pageId: candidate.id,
              version: source.version,
              kind: "original",
              passageId: passage.id,
              text: passage.text,
            }),
          );
      }
    }
    const ledger = await this.operations.checkpoint(job, async (tx) => {
      const [work] =
        await tx`SELECT state FROM wiki_work WHERE job_id=${job.id}`;
      const prior = work!.state[key] ?? { pages: [], windows: [] };
      const pages = [
        ...new Set<string>([
          ...prior.pages,
          ...candidates.map((card) => card.id),
        ]),
      ];
      if (pages.length > 3)
        throw new Error("needs_attention:detailed_page_limit");
      return {
        pages,
        windows: prior.windows as Array<{
          hash: string;
          ranges: DetailRange[];
          outcome: unknown;
        }>,
        remaining: ranges,
      };
    });
    const save = () =>
      this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ [key]: ledger }))}::jsonb WHERE job_id=${job.id}`;
      });
    await save();
    while (ledger.remaining.length) {
      const window: DetailRange[] = [];
      let bytes = 0;
      for (const range of ledger.remaining) {
        const size = new TextEncoder().encode(JSON.stringify(range)).length;
        if (window.length && bytes + size > 6000) break;
        window.push(range);
        bytes += size;
      }
      const windowHash = hash(window),
        cached = ledger.windows.find((item) => item.hash === windowHash);
      if (!cached && ledger.windows.length >= 6)
        throw new Error("needs_attention:detail_window_limit");
      const outcome =
        cached?.outcome ??
        (await this.runtime.request(
          job,
          key,
          "inspection",
          7,
          { topic, candidates, contribution, window, windowHash },
          (raw) => {
            if (
              !record(raw) ||
              raw.windowHash !== windowHash ||
              typeof raw.complete !== "boolean" ||
              typeof raw.reason !== "string" ||
              !Array.isArray(raw.remaining)
            )
              throw new Error("invalid_inspection");
            if (
              raw.complete === true &&
              (!Array.isArray(raw.relevant) ||
                !raw.relevant.length ||
                raw.relevant.some(
                  (ref) =>
                    !record(ref) ||
                    !Number.isInteger(ref.range) ||
                    !window[Number(ref.range)] ||
                    !Number.isInteger(ref.start) ||
                    !Number.isInteger(ref.end) ||
                    Number(ref.start) < 0 ||
                    Number(ref.end) <= Number(ref.start) ||
                    Number(ref.end) > window[Number(ref.range)]!.text.length,
                ))
            )
              throw new Error("invalid_inspection_spans");
            return raw;
          },
        ));
      if (!cached)
        ledger.windows.push({ hash: windowHash, ranges: window, outcome });
      if (
        !record(outcome) ||
        outcome.complete !== true ||
        !Array.isArray(outcome.remaining) ||
        outcome.remaining.length
      ) {
        await save();
        throw new Error(
          `needs_attention:inspection:${record(outcome) ? String(outcome.reason) : "invalid"}`,
        );
      }
      ledger.remaining = ledger.remaining.slice(window.length);
      await save();
    }
    return ledger;
  }
  planningContext(ledger: Awaited<ReturnType<WikiInspection["inspect"]>>) {
    return {
      pages: ledger.pages,
      windows: ledger.windows.map((window) => {
        const outcome = window.outcome as {
          complete: boolean;
          reason: string;
          relevant?: Array<{ range: number; start: number; end: number }>;
        };
        const relevant = (outcome.relevant ?? []).map((ref) => {
          const range = window.ranges[ref.range]!;
          return {
            pageId: range.pageId,
            version: range.version,
            kind: range.kind,
            passageId: range.passageId,
            start: range.start + ref.start,
            end: range.start + ref.end,
            text: range.text.slice(ref.start, ref.end),
          };
        });
        return {
          hash: window.hash,
          outcome: { complete: outcome.complete, reason: outcome.reason },
          relevant,
        };
      }),
      remaining: ledger.remaining.map((range) => ({
        pageId: range.pageId,
        version: range.version,
        start: range.start,
        end: range.end,
      })),
    };
  }
  async assertCurrent(
    tx: Transaction,
    organizationId: string,
    ledger: Awaited<ReturnType<WikiInspection["inspect"]>>,
  ) {
    const ranges = ledger.windows.flatMap((window) => window.ranges);
    const originals = [
      ...new Set(
        ranges
          .filter((range) => range.kind === "original")
          .map((range) => range.version),
      ),
    ];
    if (originals.length) {
      const sources =
        await tx`SELECT active_version_id FROM source_documents WHERE organization_id=${organizationId} AND id IN (SELECT document_id FROM source_versions WHERE id IN ${tx(originals)}) ORDER BY id FOR SHARE`;
      if (
        originals.some(
          (version) =>
            !sources.some((row) => row.active_version_id === version),
        )
      )
        throw new Error("version_conflict");
    }
    if (ledger.pages.length) {
      const pages =
        await tx`SELECT id,current_version_id FROM wiki_pages WHERE organization_id=${organizationId} AND id IN ${tx(ledger.pages)} ORDER BY id FOR SHARE`;
      if (
        ranges
          .filter((range) => range.kind === "page")
          .some(
            (range) =>
              !pages.some(
                (page) =>
                  page.id === range.pageId &&
                  page.current_version_id === range.version,
              ),
          )
      )
        throw new Error("version_conflict");
    }
  }
}
function splitRange(
  input: Omit<DetailRange, "start" | "end" | "hash">,
): DetailRange[] {
  const result: DetailRange[] = [];
  let start = 0,
    text = "",
    bytes = 0;
  for (const point of input.text) {
    const size = new TextEncoder().encode(point).length;
    if (bytes + size > 4000) {
      result.push({
        ...input,
        start,
        end: start + text.length,
        text,
        hash: hash(text),
      });
      start += text.length;
      text = "";
      bytes = 0;
    }
    text += point;
    bytes += size;
  }
  if (text)
    result.push({
      ...input,
      start,
      end: start + text.length,
      text,
      hash: hash(text),
    });
  return result;
}
