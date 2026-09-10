import { record } from "./answer-validation.ts";
import type {
  WikiPack,
  WikiCandidate,
  TopicExtraction,
  TopicDescriptor,
  TopicDecision,
} from "./wiki-types.ts";
export function validateExtraction(
  raw: unknown,
  pack: WikiPack,
): TopicExtraction {
  if (
    !record(raw) ||
    !Array.isArray(raw.topics) ||
    raw.topics.length > 4 ||
    !Array.isArray(raw.coverage)
  )
    throw new Error("invalid_topic_extraction");
  const topics = raw.topics.map((topic) => {
    if (
      !record(topic) ||
      ![
        "title",
        "subjectKey",
        "aspectKey",
        "question",
        "inclusion",
        "exclusion",
      ].every(
        (key) => typeof topic[key] === "string" && String(topic[key]).trim(),
      ) ||
      /[\r\n]/.test(String(topic.title)) ||
      String(topic.title).length > 200 ||
      !Array.isArray(topic.handles) ||
      !topic.handles.length ||
      topic.handles.some(
        (handle) =>
          typeof handle !== "string" ||
          !pack.items.some((item) => item.handle === handle),
      ) ||
      !Array.isArray(topic.aliases) ||
      topic.aliases.some((alias) => typeof alias !== "string") ||
      !Array.isArray(topic.identities) ||
      topic.identities.some(
        (ref) =>
          !record(ref) ||
          !["mentionId", "revisionId", "proofId"].every(
            (key) =>
              typeof ref[key] === "string" &&
              /^[0-9a-f-]{36}$/i.test(String(ref[key])),
          ),
      ) ||
      typeof topic.identityRequired !== "boolean" ||
      (topic.identityRequired && !topic.identities.length)
    )
      throw new Error("invalid_topic_descriptor");
    return topic as unknown as TopicDescriptor;
  });
  const coverage = raw.coverage;
  if (
    coverage.length !== pack.items.length ||
    pack.items.some(
      (item) =>
        coverage.filter(
          (entry: unknown) => record(entry) && entry.handle === item.handle,
        ).length !== 1,
    )
  )
    throw new Error("incomplete_source_coverage");
  for (const entry of raw.coverage)
    if (
      !record(entry) ||
      !["assigned", "context", "unresolved"].includes(String(entry.outcome)) ||
      !Array.isArray(entry.topicIndexes) ||
      (entry.outcome === "assigned" && !entry.topicIndexes.length) ||
      (entry.outcome === "context" && entry.topicIndexes.length !== 0) ||
      new Set(entry.topicIndexes).size !== entry.topicIndexes.length ||
      entry.topicIndexes.some(
        (index) =>
          !Number.isInteger(index) ||
          !topics[Number(index)]?.handles.includes(String(entry.handle)),
      )
    )
      throw new Error("invalid_source_coverage");
  for (const [index, topic] of topics.entries())
    for (const handle of topic.handles) {
      const entry = raw.coverage.find(
        (entry) => record(entry) && entry.handle === handle,
      );
      if (
        !record(entry) ||
        !Array.isArray(entry.topicIndexes) ||
        !entry.topicIndexes.includes(index) ||
        entry.outcome === "context"
      )
        throw new Error("invalid_source_coverage");
    }
  return { topics, coverage: raw.coverage as TopicExtraction["coverage"] };
}
export function validateDecision(
  raw: unknown,
  cards: WikiCandidate[],
  pack: WikiPack,
): TopicDecision {
  if (
    !record(raw) ||
    !["create", "update", "revalidate", "link", "no_change", "defer"].includes(
      String(raw.action),
    ) ||
    typeof raw.reason !== "string" ||
    !raw.reason.trim() ||
    (["update", "revalidate", "link", "no_change"].includes(
      String(raw.action),
    ) &&
      (typeof raw.pageId !== "string" ||
        !cards.some((card) => card.id === raw.pageId)))
  )
    throw new Error("invalid_topic_decision");
  if (Array.isArray(raw.assessments))
    raw.assessments = raw.assessments.map((entry) => {
      if (!Array.isArray(entry)) return entry;
      const [
          index,
          checks,
          addedClaims,
          revisedClaims,
          conflictingClaims,
          reason,
        ] = entry,
        card = Number.isInteger(index) ? cards[index] : undefined;
      if (!card || !Array.isArray(checks) || checks.length !== 4) return entry;
      return {
        pageId: card.id,
        version: card.version,
        handles: record(raw.contribution) ? raw.contribution.handles : [],
        subjectCompatible: checks[0],
        aspectCompatible: checks[1],
        scopeCompatible: checks[2],
        boundaryCompatible: checks[3],
        addedClaims,
        revisedClaims,
        conflictingClaims,
        reason,
      };
    });
  if (
    !record(raw.contribution) ||
    !Array.isArray(raw.contribution.handles) ||
    !raw.contribution.handles.length ||
    raw.contribution.handles.some(
      (handle) => !pack.items.some((item) => item.handle === handle),
    ) ||
    typeof raw.contribution.claim !== "string" ||
    !raw.contribution.claim.trim() ||
    typeof raw.contribution.question !== "string" ||
    !raw.contribution.question.trim() ||
    raw.contribution.substantive !== true
  )
    throw new Error("needs_attention:unsupported_topic");
  if (
    !Array.isArray(raw.assessments) ||
    raw.assessments.length !== cards.length
  )
    throw new Error("invalid_topic_assessment");
  for (const card of cards) {
    const matches = raw.assessments.filter(
      (entry) => record(entry) && entry.pageId === card.id,
    );
    const assessment = matches[0];
    if (
      matches.length !== 1 ||
      !record(assessment) ||
      assessment.version !== card.version ||
      ![
        "subjectCompatible",
        "aspectCompatible",
        "scopeCompatible",
        "boundaryCompatible",
      ].every((key) => typeof assessment[key] === "boolean") ||
      !Array.isArray(assessment.handles) ||
      !assessment.handles.length ||
      assessment.handles.some(
        (handle) => !pack.items.some((item) => item.handle === handle),
      ) ||
      typeof assessment.reason !== "string" ||
      !assessment.reason.trim() ||
      !["addedClaims", "revisedClaims", "conflictingClaims"].every(
        (key) =>
          Array.isArray(assessment[key]) &&
          (assessment[key] as unknown[]).every(
            (value) => typeof value === "string",
          ),
      )
    )
      throw new Error("invalid_topic_assessment");
    if (
      raw.pageId === card.id &&
      raw.action !== "link" &&
      (!assessment.subjectCompatible ||
        !assessment.aspectCompatible ||
        !assessment.scopeCompatible ||
        !assessment.boundaryCompatible)
    )
      throw new Error("needs_attention:incompatible_topic");
    if (
      raw.action === "create" &&
      assessment.subjectCompatible &&
      assessment.aspectCompatible &&
      assessment.scopeCompatible &&
      assessment.boundaryCompatible
    )
      throw new Error("needs_attention:reuse_required");
  }
  if (
    raw.proposals !== undefined &&
    (!Array.isArray(raw.proposals) ||
      raw.proposals.some(
        (proposal) =>
          !record(proposal) ||
          !["merge", "split"].includes(String(proposal.kind)) ||
          !Array.isArray(proposal.pageIds) ||
          !proposal.pageIds.length ||
          proposal.pageIds.some(
            (id) => !cards.some((card) => card.id === id),
          ) ||
          typeof proposal.reason !== "string" ||
          !proposal.reason.trim(),
      ))
  )
    throw new Error("invalid_structure_proposal");
  return raw as unknown as TopicDecision;
}
