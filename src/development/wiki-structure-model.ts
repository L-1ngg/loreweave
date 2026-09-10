import { hash } from "../answer-validation.ts";
import type {
  StructureClaim,
  StructurePlan,
} from "../wiki-structure-validation.ts";
import type { TopicDescriptor, WikiPack } from "../wiki-types.ts";
import { extract } from "./wiki-model.ts";
/** Small logistics fixtures only; these checks do not establish general semantic quality. */
export function scriptedStructure(
  phase: "structure" | "structure_review",
  input: Record<string, unknown>,
) {
  const pack = input.pack as WikiPack,
    claims = input.claims as StructureClaim[];
  const claimTopics = (claim: StructureClaim) =>
    extract(
      {
        ...pack,
        items: pack.items.filter((item) => claim.handles.includes(item.handle)),
      },
      true,
    ).topics;
  if (phase === "structure_review") {
    const plan = input.plan as StructurePlan;
    if (input.stage === "publication") {
      const published = input.published as Array<{
        claims: Array<{ id: string; text: string }>;
      }>;
      return {
        planHash: hash(plan),
        evidenceHash: pack.hash,
        publishedHash: hash(published),
        coverage: plan.successors.flatMap((successor, index) =>
          successor.claimIds.map((id) => {
            const original = claims.find((claim) => claim.id === id)!;
            const matches = published[index]!.claims.filter(
              (claim) => claim.text === original.text,
            );
            return {
              id,
              successor: index,
              verdict: matches.length ? "supported" : "insufficient",
              qualifiersChecked: true,
              claimIds: matches.map((claim) => claim.id),
            };
          }),
        ),
      };
    }

    const correct = plan.successors.every((successor) =>
      successor.claimIds.every((id) =>
        claimTopics(claims.find((claim) => claim.id === id)!).some(
          (topic) => topic.subjectKey === successor.topic.subjectKey,
        ),
      ),
    );
    return {
      planHash: hash(plan),
      evidenceHash: pack.hash,
      boundariesSupported: correct,
      overlapSupported: plan.kind === "merge",
      problems: correct ? [] : ["Fixture topic assignment differs"],
      claims: claims.map((claim) => ({
        id: claim.id,
        verdict: correct ? "supported" : "insufficient",
        qualifiersChecked: true,
      })),
    };
  }
  const pages = input.pages as Array<{
    id: string;
    descriptor: TopicDescriptor;
  }>;
  const kind = input.kind as "merge" | "split";
  const groups = new Map<
    string,
    { topic: TopicDescriptor; claimIds: string[]; independent: boolean }
  >();
  for (const claim of claims)
    for (const topic of claimTopics(claim)) {
      const group = groups.get(topic.subjectKey) ?? {
        topic,
        claimIds: [],
        independent: true,
      };
      group.claimIds.push(claim.id);
      groups.set(topic.subjectKey, group);
    }
  const overlap: StructurePlan["overlap"] = [];
  for (const left of claims)
    for (const right of claims)
      if (
        left.pageId !== right.pageId &&
        left.handles.some((a) =>
          right.handles.some(
            (b) =>
              pack.items.find((item) => item.handle === a)?.text ===
              pack.items.find((item) => item.handle === b)?.text,
          ),
        )
      )
        overlap.push({ left: left.id, right: right.id });
  return {
    kind,
    reason:
      "Controlled fixture questions, scope and exact overlapping original claims",
    equivalentSubject: groups.size === 1,
    equivalentAspect: pages.every(
      (page) => page.descriptor.aspectKey === pages[0]!.descriptor.aspectKey,
    ),
    equivalentApplicability: true,
    overlap,
    successors: [...groups.values()],
  };
}
