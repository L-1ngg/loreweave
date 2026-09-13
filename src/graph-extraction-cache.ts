import { hash } from "./answer-validation.ts";
import type { GraphOriginal } from "./graph-packets.ts";
import type { GraphPacketResult } from "./graph-types.ts";
import { Operations, jsonValue, type Job } from "./operations.ts";
type Mention = {
  id: string;
  text: string;
  passageId: string;
  start: number;
  end: number;
};

/** Only raw extraction is reusable across bindings; every replacement is reviewed again. */
export async function graphExtraction(
  operations: Operations,
  job: Job,
  documentId: string,
  profile: string,
  items: GraphOriginal[],
  mentions: Mention[],
  extract: () => Promise<GraphPacketResult>,
) {
  const localMentions = mentions
    .map((mention) => {
      const item = items.find(
        (item) =>
          item.passageId === mention.passageId &&
          item.start <= mention.start &&
          item.end >= mention.end,
      );
      return {
        mention,
        key: item
          ? hash({
              item: items.indexOf(item),
              text: mention.text,
              start: mention.start - item.start,
              end: mention.end - item.start,
            })
          : mention.id,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const inputHash = hash({
    items: items.map((item) => ({
      text: item.text,
      title: item.title,
      context: item.context,
      heading: item.headingPath,
    })),
    mentions: localMentions.map((item) => item.key),
  });
  const passageIds = [...new Set(items.map((item) => item.passageId))];
  const [cached] =
    await operations.sql`SELECT * FROM graph_extraction_cache WHERE document_id=${documentId} AND profile=${profile} AND input_hash=${inputHash}`;
  if (cached && !(cached.response as GraphPacketResult).exclusions.length) {
    const old = cached.mentions as Array<{ id: string; key: string }>;
    const mapping = new Map(
      old.map((item) => [
        item.id,
        localMentions.find((next) => next.key === item.key)?.mention.id,
      ]),
    );
    const priorPassages = cached.passage_ids as string[];
    const passages = new Map(
      priorPassages.map((id, index) => [id, passageIds[index]]),
    );
    const raw = structuredClone(cached.response) as GraphPacketResult;
    const sameVersion = cached.version_id === items[0]?.version;
    const endpoint = (id: string) =>
      mapping.get(id) ??
      (sameVersion || !/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    if (
      raw.relations.every(
        (r) =>
          endpoint(r.subjectMention) &&
          endpoint(r.objectMention) &&
          r.locators.every((id) => passages.has(id)),
      ) &&
      raw.exclusions.every((e) => !e.mention || endpoint(e.mention))
    ) {
      for (const r of raw.relations) {
        r.subjectMention = endpoint(r.subjectMention)!;
        r.objectMention = endpoint(r.objectMention)!;
        r.locators = r.locators.map((id) => passages.get(id)!);
      }
      for (const e of raw.exclusions)
        if (e.mention) e.mention = endpoint(e.mention)!;
      return { raw, reused: true };
    }
  }
  const raw = await extract();
  await operations.checkpoint(job, async (tx) => {
    await tx`INSERT INTO graph_extraction_cache(document_id,profile,input_hash,version_id,passage_ids,mentions,response) VALUES(${documentId},${profile},${inputHash},${items[0]!.version},${tx.json(passageIds)},${tx.json(localMentions.map((item) => ({ id: item.mention.id, key: item.key })))},${tx.json(jsonValue(raw))}) ON CONFLICT(document_id,profile,input_hash) DO UPDATE SET version_id=excluded.version_id,passage_ids=excluded.passage_ids,mentions=excluded.mentions,response=excluded.response`;
  });
  return { raw, reused: false };
}
