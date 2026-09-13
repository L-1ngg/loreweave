import { hash, record } from "./answer-validation.ts";
import type { Job } from "./operations.ts";
import { packetPacks } from "./wiki-packets.ts";
import type { WikiModelRuntime } from "./wiki-model-runtime.ts";
import type {
  TopicDescriptor,
  WikiCertificate,
  WikiPack,
} from "./wiki-types.ts";
export interface WikiSection {
  id: string;
  purpose: string;
  key: string;
}
export const evidenceContext = (item: WikiPack["items"][number]) =>
  hash({
    document: item.documentId,
    title: item.title,
    text: item.text,
    heading: item.headingPath,
    context: item.contextHash,
  });

/** Stable reader-question sections own bounded continuation units, independently of source packets. */
export async function sectionPacks(
  runtime: WikiModelRuntime,
  job: Job,
  topic: TopicDescriptor,
  pack: WikiPack,
  pageId: string,
  previous: WikiCertificate[],
  index: number | string,
) {
  const sections = new Map<
    string,
    { section: WikiSection; items: WikiPack["items"] }
  >();
  const add = (section: WikiSection, items: WikiPack["items"]) => {
    const current = sections.get(section.key) ?? { section, items: [] };
    for (const item of items)
      if (!current.items.some((prior) => prior.handle === item.handle))
        current.items.push(item);
    sections.set(section.key, current);
  };
  const assigned = new Set<string>();
  const existing = [
    ...new Map(
      previous.flatMap((c) =>
        c.section ? [[c.section.key, c.section] as const] : [],
      ),
    ).values(),
  ];
  for (const old of previous) {
    if (!old.section) continue;
    for (const evidence of old.evidence) {
      if (!evidence.contextHash) continue;
      const matches = pack.items.filter(
        (item) => evidenceContext(item) === evidenceContext(evidence),
      );
      if (matches.length !== 1 || assigned.has(matches[0]!.handle)) continue;
      add(old.section, matches);
      assigned.add(matches[0]!.handle);
    }
  }
  const remaining = {
    ...pack,
    items: pack.items.filter((item) => !assigned.has(item.handle)),
  };
  for (const [ordinal, packet] of packetPacks(remaining, 4000).entries()) {
    const plans = await runtime.request(
      job,
      `sections:${index}:${ordinal}`,
      "sections",
      2,
      { topic, pack: packet, existing: existing.slice(0, 20) },
      (raw) => {
        if (
          !record(raw) ||
          !Array.isArray(raw.sections) ||
          !raw.sections.length ||
          raw.sections.length > 8
        )
          throw new Error("invalid_section_plan");
        const covered = new Set<string>();
        const plans = raw.sections.map((value) => {
          if (
            !record(value) ||
            typeof value.key !== "string" ||
            !value.key.trim() ||
            value.key.length > 100 ||
            typeof value.purpose !== "string" ||
            !value.purpose.trim() ||
            value.purpose.length > 200 ||
            !Array.isArray(value.handles) ||
            !value.handles.length
          )
            throw new Error("invalid_section_plan");
          const items = value.handles.map((handle) => {
            if (typeof handle !== "string" || covered.has(handle))
              throw new Error("invalid_section_plan");
            const item = packet.items.find((item) => item.handle === handle);
            if (!item) throw new Error("invalid_section_plan");
            covered.add(handle);
            return item;
          });
          const prior = existing.find((section) => section.key === value.key);
          const section = prior ?? {
            id: hash({ pageId, key: value.key }),
            key: value.key,
            purpose: value.purpose,
          };
          return { section, items };
        });
        if (covered.size !== packet.items.length)
          throw new Error("incomplete_section_plan");
        return plans;
      },
    );
    for (const plan of plans) add(plan.section, plan.items);
  }
  return [...sections.values()].flatMap(({ section, items }) =>
    packetPacks({ ...pack, items, hash: hash(items) }, 2000).map(
      (block, continuation) => ({ block, section, continuation }),
    ),
  );
}
