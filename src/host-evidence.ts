import { parseDirectAnswer, noRetrievalLabel } from "./direct-answer.ts";
import type { TrustedContext } from "./access.ts";
import type {
  EvidenceService,
  EvidencePack,
  GroundedAnswer,
} from "./evidence.ts";
import type { FixtureSources, Evidence } from "./development/sources.ts";

type CheckedAnswer = Omit<GroundedAnswer, "citations"> & {
  citations: Evidence[];
};

/** Host owns the logical deadline and retrieval budget; M06 owns citation validation. */
export interface EvidenceRunPolicy {
  signal: AbortSignal;
  authorize(): Promise<TrustedContext | undefined>;
  beforeRetrieval(): Promise<void>;
  beforeEmbedding(signal: AbortSignal): Promise<void>;
  diagnostics(pack: EvidencePack): Promise<void>;
  retrievalFailed(reason: string): Promise<void>;
}

export class HostEvidence {
  private evidence?: Evidence;
  private pack?: EvidencePack;
  private retrievalError?: unknown;
  private rounds = 0;
  private noGain = false;

  constructor(
    private readonly options: {
      service?: EvidenceService | undefined;
      sources: FixtureSources;
      credential: string;
      runId: string;
      question: string;
      complex: boolean;
      model: string;
    },
    private readonly policy: EvidenceRunPolicy,
  ) {}

  get available(): boolean {
    return Boolean(this.pack || this.evidence);
  }

  failed(): void {
    this.retrievalError = new Error("retrieval_unavailable");
  }
  assertRetrieval(): void {
    if (!this.pack && this.retrievalError) throw this.retrievalError;
  }

  async search(
    signal: AbortSignal,
    query?: string,
    routes?: import("./evidence.ts").EvidenceRoute[],
    graph?: import("./graph-queries.ts").GraphSearchOptions,
    gap?: string,
  ) {
    const context = await this.policy.authorize();
    signal.throwIfAborted();
    if (this.options.service) {
      try {
        this.pack = await this.retrieve(
          signal,
          context,
          query,
          routes,
          graph,
          gap,
        );
      } catch (error) {
        this.retrievalError = error;
        await this.policy.retrievalFailed(
          error instanceof Error &&
            [
              "specific_gap_required",
              "retrieval_no_gain",
              "retrieval_budget_exhausted",
            ].includes(error.message)
            ? error.message
            : "retrieval_unavailable",
        );
        throw error;
      }
      if (
        this.pack.diagnostics.cache === "miss" &&
        this.rounds > 1 &&
        !this.pack.items.length
      )
        this.noGain = true;
      await this.policy.diagnostics(this.pack);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(this.pack) }],
        details: this.pack,
      };
    }
    await this.policy.beforeRetrieval();
    this.evidence = { ...this.options.sources.read(context), handle: "e1" };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(this.evidence) }],
      details: this.evidence,
    };
  }

  private retrieve(
    signal: AbortSignal,
    context?: TrustedContext,
    query?: string,
    routes?: import("./evidence.ts").EvidenceRoute[],
    graph?: import("./graph-queries.ts").GraphSearchOptions,
    gap?: string,
  ) {
    signal.throwIfAborted();
    return this.options.service!.retrieve(this.options.credential, {
      runId: this.options.runId,
      question: query ?? this.options.question,
      ...(routes ? { routes } : {}),
      ...(graph ? { graph } : {}),
      complex: this.options.complex,
      ...(context?.scope.projectId
        ? { projectId: context.scope.projectId }
        : {}),
      signal,
      beforeRetrieval: async () => {
        if (this.rounds && (!gap?.trim() || gap.trim() === "context_limit"))
          throw new Error("specific_gap_required");
        if (this.noGain) throw new Error("retrieval_no_gain");
        await this.policy.beforeRetrieval();
        this.rounds++;
      },
      beforeEmbedding: () => this.policy.beforeEmbedding(signal),
    });
  }

  async finalizeDirect(text: string): Promise<CheckedAnswer> {
    await this.policy.authorize();
    this.policy.signal.throwIfAborted();
    const answer = parseDirectAnswer(text);
    if (this.options.service && this.pack)
      return this.options.service.finalizeDirect(
        this.options.credential,
        this.options.runId,
        answer,
        this.policy.signal,
      );
    if (answer.citations.some((handle) => handle !== "e1" || !this.evidence))
      throw new Error("invalid_citation");
    if (this.evidence && !this.options.sources.current(this.evidence))
      throw new Error("source_changed");
    if (
      answer.basis !== "general" &&
      !answer.citations.length &&
      !answer.gaps.length
    )
      throw new Error("invalid_citation");
    if (answer.basis === "general" && this.available)
      throw new Error("invalid_draft");
    const gaps = [...answer.gaps, ...answer.conflicts];
    return {
      status: gaps.length ? "partial" : "answered",
      text:
        (this.available ? "" : noRetrievalLabel + "\n\n") +
        answer.text +
        (gaps.length ? "\n\n" + gaps.join("\n") : ""),
      citations: answer.citations.length ? [this.evidence!] : [],
      validatedAt: new Date().toISOString(),
      contract: "direct-answer-v2",
      validation: { kind: "citation-traceability", semanticReview: false },
      ...(gaps.length ? { reason: "evidence_gap" } : {}),
    };
  }
}
