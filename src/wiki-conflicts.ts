import { hash, record } from "./answer-validation.ts";
import { Operations, jsonValue, type Job } from "./operations.ts";
import { packetPacks } from "./wiki-packets.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import type { WikiPack, TopicDescriptor } from "./wiki-types.ts";
/** Compare every bounded source-packet pair before independently generating blocks. */
export async function conflictPacks(
  operations: Operations,
  runtime: WikiModelRuntime,
  job: Job,
  topic: TopicDescriptor,
  pack: WikiPack,
  index: number | string,
) {
  const packets = packetPacks(pack, 2000),
    conflicts = new Map<string, WikiPack>(),
    pairs = packets.flatMap((a, i) =>
      packets.slice(i + 1).map((b) => ({ a, b, key: hash([a.hash, b.hash]) })),
    );
  if (pairs.length > 512)
    throw new Error("needs_attention:conflict_comparison_limit");
  for (const [pairIndex, { a, b, key }] of pairs.entries()) {
    const items = [...a.items, ...b.items],
      comparison = { ...pack, items, hash: hash(items) };
    const result = await runtime.request(
      job,
      `conflicts:${index}:${pairIndex}`,
      "conflicts",
      2,
      {
        topic: { ...topic, handles: [] },
        pack: comparison,
        left: a.items.map((item) => item.handle),
        right: b.items.map((item) => item.handle),
      },
      (raw) => {
        if (
          !record(raw) ||
          raw.evidenceHash !== comparison.hash ||
          !Array.isArray(raw.pairs) ||
          raw.pairs.length !== a.items.length * b.items.length
        )
          throw new Error("invalid_conflict_review");
        const seen = new Set<string>();
        return raw.pairs.map((pair) => {
          if (
            !record(pair) ||
            typeof pair.left !== "string" ||
            typeof pair.right !== "string" ||
            !a.items.some((item) => item.handle === pair.left) ||
            !b.items.some((item) => item.handle === pair.right) ||
            seen.has(`${pair.left}:${pair.right}`) ||
            !["compatible", "conflict", "unresolved"].includes(
              String(pair.verdict),
            ) ||
            typeof pair.reason !== "string" ||
            !pair.reason.trim() ||
            pair.scopeChecked !== true
          )
            throw new Error("invalid_conflict_review");
          seen.add(`${pair.left}:${pair.right}`);
          return {
            left: pair.left,
            right: pair.right,
            verdict: String(pair.verdict),
            reason: pair.reason,
          };
        });
      },
    );
    await operations.checkpoint(job, async (tx) => {
      await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ [`conflicts:${index}:${pairIndex}`]: { key, result, remaining: pairs.length - pairIndex - 1 } }))}::jsonb WHERE job_id=${job.id}`;
    });
    if (result.some((pair) => pair.verdict === "unresolved"))
      throw new Error("needs_attention:unresolved_cross_block_conflict");
    for (const pair of result)
      if (pair.verdict === "conflict") {
        const items = comparison.items.filter(
          (item) => item.handle === pair.left || item.handle === pair.right,
        );
        conflicts.set(`${pair.left}:${pair.right}`, {
          ...pack,
          items,
          hash: hash(items),
        });
      }
  }
  return [...conflicts.values()];
}
