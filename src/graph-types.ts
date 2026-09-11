import type { WikiModel, WikiPhase } from "./wiki-types.ts";
export type GraphModel = WikiModel;
export type GraphPhase = Extract<
  WikiPhase,
  "graph_extraction" | "graph_review"
>;
export interface GraphRelation {
  subjectMention: string;
  objectMention: string;
  predicate: string;
  direction: "forward" | "reverse";
  relationText: string;
  scope: string;
  qualifiers: {
    time?: string;
    environment?: string;
    conditions?: string;
    negated?: boolean;
    status?: "planned" | "current" | "historical";
  };
  locators: string[];
}
export interface GraphPacketResult {
  relations: GraphRelation[];
  exclusions: Array<{ kind: string; reason: string; mention?: string }>;
  complete: boolean;
}
export interface GraphClaimView extends GraphRelation {
  id: string;
  sourceVersion: string;
  support: Array<{ version: string; passageId: string }>;
}
