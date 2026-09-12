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

type FinalPhase = "generation" | "review";

/** Evidence decisions use Host admission; this pipeline owns no run budget or lifecycle. */
export interface EvidenceRunPolicy {
  signal: AbortSignal;
  authorize(): Promise<TrustedContext | undefined>;
  beforeEmbedding(signal: AbortSignal): Promise<void>;
  remaining(phase: FinalPhase): number;
  request(
    phase: FinalPhase,
    input: object,
    signal?: AbortSignal,
  ): Promise<unknown>;
  refresh(): Promise<boolean>;
  refreshed(): Promise<void>;
  diagnostics(pack: EvidencePack): Promise<void>;
  retrievalFailed(): Promise<void>;
}

export class HostEvidence {
  private evidence?: Evidence;
  private pack?: EvidencePack;
  private retrievalError?: unknown;

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

  assertRetrieval(): void {
    if (!this.pack && this.retrievalError) throw this.retrievalError;
  }

  async search(signal: AbortSignal) {
    const context = await this.policy.authorize();
    signal.throwIfAborted();
    if (this.options.service) {
      try {
        this.pack = await this.retrieve(signal, context);
      } catch (error) {
        this.retrievalError = error;
        await this.policy.retrievalFailed();
        throw error;
      }
      await this.policy.diagnostics(this.pack);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(this.pack) }],
        details: this.pack,
      };
    }
    this.evidence = this.options.sources.read(context);
    return {
      content: [{ type: "text" as const, text: this.evidence.text }],
      details: this.evidence,
    };
  }

  private retrieve(signal: AbortSignal, context?: TrustedContext) {
    signal.throwIfAborted();
    return this.options.service!.retrieve(this.options.credential, {
      runId: this.options.runId,
      question: this.options.question,
      complex: this.options.complex,
      ...(context?.scope.projectId
        ? { projectId: context.scope.projectId }
        : {}),
      signal,
      beforeEmbedding: () => this.policy.beforeEmbedding(signal),
    });
  }

  async finalize(): Promise<CheckedAnswer> {
    if (this.pack) return this.finalizePack(this.pack);
    if (this.retrievalError) throw this.retrievalError;
    if (!this.evidence) throw new Error("insufficient_evidence");
    return this.finalizeFixture(this.evidence);
  }

  private async finalizePack(initial: EvidencePack): Promise<CheckedAnswer> {
    const service = this.options.service!;
    let pack = initial;
    for (;;) {
      try {
        return await service.finalize(this.options.credential, pack, {
          signal: this.policy.signal,
          model: this.options.model,
          remaining: (phase) => this.policy.remaining(phase),
          request: (phase, input, signal) =>
            this.policy.request(phase, input, signal),
        });
      } catch (error) {
        this.policy.signal.throwIfAborted();
        if (!(error instanceof Error) || error.message !== "source_changed")
          throw error;
        if (!(await this.policy.refresh())) {
          const subset = await service.supportedSubset(
            this.options.credential,
            this.options.runId,
            this.policy.signal,
          );
          if (subset) return { ...subset, reason: "source_changed" };
          throw error;
        }
        const context = await this.policy.authorize();
        pack = await this.retrieve(this.policy.signal, context);
        await this.policy.diagnostics(pack);
        await this.policy.refreshed();
      }
    }
  }

  private async finalizeFixture(initial: Evidence): Promise<CheckedAnswer> {
    let evidence = initial;
    for (;;) {
      if (
        this.policy.remaining("generation") <= 0 ||
        this.policy.remaining("review") <= 0
      )
        throw new Error("budget_exhausted");
      try {
        const draft = await this.policy.request("generation", {
          question: this.options.question,
          evidence,
        });
        if (!this.options.sources.current(evidence))
          throw new Error("source_changed");
        if (!isRecord(draft) || typeof draft.text !== "string")
          throw new Error("invalid_draft");
        const review = await this.policy.request("review", { draft, evidence });
        if (!this.options.sources.current(evidence))
          throw new Error("source_changed");
        if (!isRecord(review) || review.supported !== true)
          throw new Error("insufficient_evidence");
        return {
          status: "answered",
          text: draft.text,
          citations: [evidence],
          validatedAt: new Date().toISOString(),
        };
      } catch (error) {
        this.policy.signal.throwIfAborted();
        if (this.options.sources.current(evidence)) {
          if (
            error instanceof Error &&
            ["invalid_draft", "insufficient_evidence"].includes(
              error.message,
            ) &&
            this.policy.remaining("generation") > 0 &&
            this.policy.remaining("review") > 0
          )
            continue;
          throw error;
        }
        if (!(await this.policy.refresh())) throw new Error("source_changed");
        const context = await this.policy.authorize();
        this.policy.signal.throwIfAborted();
        evidence = this.options.sources.read(context);
        await this.policy.refreshed();
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
