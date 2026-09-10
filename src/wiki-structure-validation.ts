import { hash, record } from "./answer-validation.ts";
import type {
  TopicDescriptor,
  WikiPack,
  WikiCertificate,
} from "./wiki-types.ts";

export interface StructurePage {
  id: string;
  version: string;
  projectId: string | null;
  descriptor: TopicDescriptor;
  sources: WikiPack["items"];
  certificates: WikiCertificate[];
  inputs: string[];
}
export interface StructureClaim {
  id: string;
  pageId: string;
  text: string;
  handles: string[];
  subject: string;
  scope: string;
  conditions: string[];
  conflict: boolean;
}
export interface StructurePlan {
  kind: "merge" | "split";
  reason: string;
  equivalentSubject: boolean;
  equivalentAspect: boolean;
  equivalentApplicability: boolean;
  overlap: Array<{ left: string; right: string }>;
  successors: Array<{
    topic: TopicDescriptor;
    claimIds: string[];
    independent: boolean;
  }>;
}
export function structureClaims(
  pages: StructurePage[],
  pack: WikiPack,
): StructureClaim[] {
  return pages.flatMap((page) =>
    page.certificates.flatMap((certificate, block) =>
      certificate.draft.claims
        .filter(
          (claim) =>
            claim.end >
            (certificate.draft.text.indexOf("\n") < 0
              ? certificate.draft.text.length
              : certificate.draft.text.indexOf("\n")),
        )
        .map((claim) => ({
          id: `${page.id}:${block}:${claim.id}`,
          pageId: page.id,
          text: certificate.draft.text.slice(claim.start, claim.end),
          subject: claim.subject,
          scope: claim.scope,
          conditions: claim.conditions,
          conflict:
            claim.attribution === "inference" && claim.handles.length > 1,
          handles: [
            ...new Set(
              claim.handles.map((handle) => {
                const ref = certificate.evidence.find(
                  (item) => item.handle === handle,
                );
                const current = pack.items.find(
                  (item) =>
                    ref &&
                    item.version === ref.version &&
                    item.passageId === ref.passageId &&
                    item.start <= ref.start &&
                    item.end >= ref.end,
                );
                if (!current) throw new Error("source_changed");
                return current.handle;
              }),
            ),
          ],
        })),
    ),
  );
}
export function validateStructure(
  raw: unknown,
  kind: "merge" | "split",
  pages: StructurePage[],
  claims: StructureClaim[],
  pack: WikiPack,
): StructurePlan {
  if (
    !record(raw) ||
    raw.kind !== kind ||
    typeof raw.reason !== "string" ||
    !raw.reason.trim() ||
    !Array.isArray(raw.successors) ||
    !Array.isArray(raw.overlap)
  )
    throw new Error("invalid_structure_plan");
  if (
    kind === "merge" &&
    (raw.successors.length !== 1 ||
      raw.equivalentSubject !== true ||
      raw.equivalentAspect !== true ||
      raw.equivalentApplicability !== true)
  )
    throw new Error("needs_attention:merge_not_equivalent");
  if (
    kind === "split" &&
    (raw.successors.length < 2 || raw.successors.length > 4)
  )
    throw new Error("needs_attention:split_not_independent");
  const assigned = new Set<string>(),
    questions = new Set<string>();
  for (const successor of raw.successors) {
    if (
      !record(successor) ||
      !record(successor.topic) ||
      !Array.isArray(successor.claimIds) ||
      !successor.claimIds.length ||
      successor.independent !== true
    )
      throw new Error("invalid_claim_map");
    const topic = successor.topic;
    if (
      [
        "title",
        "subjectKey",
        "aspectKey",
        "question",
        "inclusion",
        "exclusion",
      ].some(
        (key) =>
          typeof topic[key] !== "string" ||
          !String(topic[key]).trim() ||
          String(topic[key]).length > 400,
      ) ||
      !Array.isArray(topic.aliases) ||
      topic.aliases.length > 8 ||
      topic.aliases.some(
        (alias) => typeof alias !== "string" || alias.length > 200,
      )
    )
      throw new Error("invalid_structure_topic");
    if (questions.has(String(topic.question).normalize("NFKC").trim()))
      throw new Error("needs_attention:split_not_independent");
    questions.add(String(topic.question).normalize("NFKC").trim());
    const refs = new Set<string>();
    for (const id of successor.claimIds) {
      const claim = claims.find((item) => item.id === id);
      if (!claim) throw new Error("invalid_claim_map");
      assigned.add(String(id));
      claim.handles.forEach((handle) => refs.add(handle));
    }
    // Source and identity dependencies are host-derived, never accepted from the planner.
    topic.handles = [...refs];
    topic.identities = pages
      .flatMap((page) => page.descriptor.identities)
      .filter(
        (ref, index, all) =>
          all.findIndex((other) => hash(other) === hash(ref)) === index,
      );
    topic.identityRequired = pages.some(
      (page) => page.descriptor.identityRequired,
    );
  }
  if (assigned.size !== claims.length)
    throw new Error("needs_attention:incomplete_claim_map");
  if (kind === "split") {
    for (const claim of claims.filter((item) => item.conflict)) {
      const involved = claims.filter(
        (other) =>
          other.pageId === claim.pageId &&
          other.handles.some((handle) => claim.handles.includes(handle)),
      );
      if (
        !raw.successors.some(
          (successor) =>
            record(successor) &&
            Array.isArray(successor.claimIds) &&
            involved.every((other) =>
              (successor.claimIds as unknown[]).includes(other.id),
            ),
        )
      )
        throw new Error("needs_attention:conflict_split");
    }
  } else {
    const connected = new Set<string>([pages[0]!.id]);
    for (const pair of raw.overlap) {
      if (!record(pair)) throw new Error("invalid_overlap");
      const left = claims.find((claim) => claim.id === pair.left),
        right = claims.find((claim) => claim.id === pair.right);
      if (!left || !right || left.pageId === right.pageId)
        throw new Error("invalid_overlap");
    }
    for (let pass = 0; pass < pages.length; pass++)
      for (const pair of raw.overlap) {
        const left = claims.find((claim) => claim.id === pair.left)!,
          right = claims.find((claim) => claim.id === pair.right)!;
        if (connected.has(left.pageId) || connected.has(right.pageId)) {
          connected.add(left.pageId);
          connected.add(right.pageId);
        }
      }
    if (connected.size !== pages.length)
      throw new Error("needs_attention:no_supported_overlap");
  }
  if (!pack.items.length) throw new Error("insufficient_evidence");
  return raw as unknown as StructurePlan;
}
export function validateStructureReview(
  raw: unknown,
  plan: StructurePlan,
  claims: StructureClaim[],
  pack: WikiPack,
) {
  if (
    !record(raw) ||
    raw.planHash !== hash(plan) ||
    raw.evidenceHash !== pack.hash ||
    raw.boundariesSupported !== true ||
    !Array.isArray(raw.problems) ||
    raw.problems.length ||
    !Array.isArray(raw.claims) ||
    raw.claims.length !== claims.length ||
    new Set(raw.claims.map((item) => (record(item) ? item.id : undefined)))
      .size !== claims.length ||
    raw.claims.some(
      (item) =>
        !record(item) ||
        !claims.some((claim) => claim.id === item.id) ||
        item.verdict !== "supported" ||
        item.qualifiersChecked !== true,
    ) ||
    raw.overlapSupported !== (plan.kind === "merge")
  )
    throw new Error("needs_attention:structure_review_failed");
  return true;
}

export function validateStructureCoverage(
  raw: unknown,
  plan: StructurePlan,
  claims: StructureClaim[],
  pack: WikiPack,
  published: Array<{
    pageId: string;
    text: string;
    claims: Array<{ id: string; text: string; handles: string[] }>;
  }>,
) {
  if (
    !record(raw) ||
    raw.planHash !== hash(plan) ||
    raw.evidenceHash !== pack.hash ||
    raw.publishedHash !== hash(published) ||
    !Array.isArray(raw.coverage)
  )
    throw new Error("needs_attention:incomplete_structural_publication");
  const obligations = plan.successors.flatMap((successor, index) =>
    successor.claimIds.map((id) => ({ id, successor: index })),
  );
  if (raw.coverage.length !== obligations.length)
    throw new Error("needs_attention:incomplete_structural_publication");
  for (const obligation of obligations) {
    const matches = raw.coverage.filter(
      (item) =>
        record(item) &&
        item.id === obligation.id &&
        item.successor === obligation.successor,
    );
    const result = matches[0];
    if (
      matches.length !== 1 ||
      !record(result) ||
      result.verdict !== "supported" ||
      result.qualifiersChecked !== true ||
      !Array.isArray(result.claimIds) ||
      !result.claimIds.length ||
      result.claimIds.some(
        (id) =>
          !published[obligation.successor]!.claims.some(
            (claim) => claim.id === id,
          ),
      )
    )
      throw new Error("needs_attention:incomplete_structural_publication");
  }
  return true;
}
