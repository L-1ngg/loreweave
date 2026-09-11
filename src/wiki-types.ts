import type { EvidencePack, EvidenceItem } from "./evidence.ts";
import type { Draft, Review } from "./answer-validation.ts";
export type WikiPhase =
  | "structure"
  | "structure_review"
  | "graph_extraction"
  | "graph_review"
  | "extraction"
  | "planning"
  | "inspection"
  | "support"
  | "conflicts"
  | "generation"
  | "review";
export interface WikiModel {
  request(
    phase: WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
  readonly profile: string;
}
export interface TopicDescriptor {
  title: string;
  aliases: string[];
  subjectKey: string;
  aspectKey: string;
  question: string;
  inclusion: string;
  exclusion: string;
  handles: string[];
  identities: Array<{ mentionId: string; revisionId: string; proofId: string }>;
  identityRequired: boolean;
}
export interface TopicExtraction {
  topics: TopicDescriptor[];
  coverage: Array<{
    handle: string;
    topicIndexes: number[];
    outcome: "assigned" | "context" | "unresolved";
  }>;
}
export interface WikiCertificate {
  draft: Draft;
  evidence: EvidenceItem[];
  offset: number;
  draftHash: string;
  evidenceHash: string;
  review: Review;
  model: string;
  prompt: string;
  policy: string;
  checkedAt: string;
}
export interface WikiPage {
  id: string;
  version: string;
  title: string;
  text: string;
  fresh: boolean;
  lifecycle: string;
  sources: EvidenceItem[];
  certificates: WikiCertificate[];
  descriptor: TopicDescriptor;
  successors?: Array<{ pageId: string; title: string }>;
  editSetId?: string;
  retirement?: { reason: string; at: string; operationId: string };
}
export interface WikiCandidate {
  omitted?: string[];
  id: string;
  version: string;
  title: string;
  descriptor: TopicDescriptor;
  fresh: boolean;
  projectId?: string;
}
export interface TopicDecision {
  action: "create" | "update" | "revalidate" | "link" | "no_change" | "defer";
  pageId?: string;
  reason: string;
  contribution: {
    handles: string[];
    claim: string;
    question: string;
    substantive: boolean;
  };
  assessments: Array<{
    pageId: string;
    version: string;
    handles: string[];
    subjectCompatible: boolean;
    aspectCompatible: boolean;
    scopeCompatible: boolean;
    boundaryCompatible: boolean;
    addedClaims: string[];
    revisedClaims: string[];
    conflictingClaims: string[];
    reason: string;
  }>;
  proposals?: Array<{
    kind: "merge" | "split";
    pageIds: string[];
    reason: string;
  }>;
}
export type WikiDraft = Draft;
export type WikiPack = EvidencePack;
