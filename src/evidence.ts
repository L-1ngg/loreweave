import type { WikiService } from "./wiki.ts";
import { setTimeout as pause } from "node:timers/promises";
import {
  hash,
  validateDraft,
  validateReview,
  reviewPrompt,
  type Draft,
  type Claim,
  type Review,
} from "./answer-validation.ts";
import { SourceService, type SourceCandidate } from "./sources.ts";
import type { GraphService } from "./graph.ts";
export interface EvidenceItem extends SourceCandidate {
  handle: string;
}
export interface EvidencePack {
  runId: string;
  question: string;
  items: EvidenceItem[];
  hash: string;
  diagnostics: {
    wikiCandidates?: number;
    lexicalCandidates: number;
    vectorCandidates: number;
    retrievalMs: number;
    embeddingRequests: number;
    gaps: string[];
  };
}
export interface FinalizationRuntime {
  signal: AbortSignal;
  remaining: (phase: "generation" | "review") => number;
  request: (
    phase: "generation" | "review",
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  model: string;
}
export interface AnswerCertificate {
  evidence: Array<{ handle: string; version: string; passageId: string }>;
  identityRevisions: string[];
  draftHash: string;
  evidenceHash: string;
  review: Review;
  model: string;
  prompt: string;
  policy: string;
  checkedAt: string;
}
export interface GroundedAnswer {
  status: "answered" | "partial";
  text: string;
  citations: Array<EvidenceItem & { id: string }>;
  validatedAt: string;
  certificate?: AnswerCertificate;
  subset?: {
    originalDraftHash: string;
    evidenceHash: string;
    retainedClaimIds: string[];
    subsetHash: string;
    certificate: AnswerCertificate;
    checkedAt: string;
  };
  reason?: string;
}
export class EvidenceService {
  private readonly packs = new Map<string, EvidencePack>();
  private readonly reviewed = new Map<
    string,
    Array<{
      draft: Draft;
      review: Review;
      pack: EvidencePack;
      model: string;
      checkedAt: string;
    }>
  >();
  constructor(
    private readonly sources: SourceService,
    private readonly wiki?: Pick<WikiService, "search">,
    private readonly graph?: Pick<GraphService, "search">,
  ) {}
  async retrieve(
    token: string,
    input: {
      runId: string;
      question: string;
      projectId?: string;
      signal: AbortSignal;
      complex?: boolean;
      beforeEmbedding?: () => Promise<void>;
    },
  ): Promise<EvidencePack> {
    const started = performance.now();
    let candidates: Awaited<ReturnType<SourceService["candidates"]>>;
    try {
      candidates = await this.sources.candidates(token, input);
    } catch (error) {
      input.signal.throwIfAborted();
      if (error instanceof Error && error.message === "unauthorized")
        throw error;
      throw new Error("retrieval_unavailable");
    }
    const gaps: string[] = [];
    let wikiCandidates = 0,
      wikiOriginals: SourceCandidate[] = [];
    let graphCandidates = 0;
    let graphOriginals: SourceCandidate[] = [];
    if (this.wiki) {
      try {
        const result = await this.wiki.search(token, input);
        wikiCandidates = result.pages;
        wikiOriginals = result.originals;
        if (result.truncated) gaps.push("wiki_original_limit");
      } catch {
        input.signal.throwIfAborted();
        gaps.push("wiki_unavailable");
      }
    } else gaps.push("wiki_unavailable");
    if (
      /依赖|关系|项目|数据库|负责|属于|连接|dependency|relationship/i.test(
        input.question,
      ) &&
      this.graph
    ) {
      try {
        const result = await this.graph.search(
          token,
          input.question,
          input.projectId,
          input.signal,
        );
        graphCandidates = result.claims.length;
        if (result.truncated) gaps.push("graph_claim_limit");
        if (result.pending) gaps.push("graph_pending");
        const refs = [
          ...new Map(
            result.claims
              .flatMap((claim) => claim.support)
              .map((support) => [
                `${support.version}:${support.passageId}`,
                support,
              ]),
          ).values(),
        ];
        const resolved = await this.sources.resolveMany(
          token,
          refs,
          input.signal,
        );
        for (const claim of result.claims) {
          for (const support of claim.support) {
            try {
              const passage = resolved.get(
                `${support.version}:${support.passageId}`,
              );
              if (!passage) throw new Error("not_found");
              graphOriginals.push({
                documentId: "",
                version: support.version,
                passageId: support.passageId,
                title: passage.headingPath.join(" / "),
                text: passage.text,
                headingPath: passage.headingPath,
                start: passage.start,
                end: passage.end,
              });
            } catch {
              gaps.push("graph_support_unavailable");
            }
          }
        }
      } catch {
        input.signal.throwIfAborted();
        gaps.push("graph_unavailable");
      }
    }
    const ranked = new Map<
      string,
      { candidate: SourceCandidate; score: number }
    >();
    for (const route of [
      candidates.lexical,
      candidates.vector,
      wikiOriginals,
      graphOriginals,
    ]) {
      const seen = new Set<string>();
      let rank = 0;
      for (const candidate of route) {
        const id = `${candidate.version}:${candidate.passageId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        rank++;
        const previous = ranked.get(id);
        ranked.set(id, {
          candidate,
          score: (previous?.score ?? 0) + 1 / (60 + rank),
        });
      }
    }
    const items: EvidenceItem[] = [];
    let remaining = (input.complex ? 16000 : 8000) - 2;
    const ordered = [...ranked.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.candidate.passageId.localeCompare(b.candidate.passageId),
      )
      .map((item) => item.candidate);
    const surrounding = await this.sources.surroundings(
      token,
      ordered,
      input.signal,
    );
    const included = new Set<string>();
    for (const candidate of ordered) {
      for (const item of [
        candidate,
        ...(surrounding.get(candidate.passageId) ?? []),
      ]) {
        const key = `${item.version}:${item.passageId}`;
        if (included.has(key)) continue;
        // UTF-8 bytes conservatively bound tokens without assuming a model tokenizer.
        const entry = { ...item, handle: `e${items.length + 1}` };
        const cost = new TextEncoder().encode(JSON.stringify(entry)).length + 1;
        if (cost > remaining) {
          if (!gaps.includes("context_limit")) gaps.push("context_limit");
          continue;
        }
        remaining -= cost;
        included.add(key);
        items.push(entry);
      }
    }
    if (!items.length) gaps.push("insufficient_evidence");
    const pack = {
      runId: input.runId,
      question: input.question,
      items,
      hash: hash(items),
      diagnostics: {
        wikiCandidates,
        lexicalCandidates: candidates.lexical.length,
        vectorCandidates: candidates.vector.length,
        retrievalMs: performance.now() - started,
        embeddingRequests: 1,
        gaps,
      },
    };
    this.packs.set(input.runId, structuredClone(pack));
    return pack;
  }
  async finalize(
    token: string,
    supplied: EvidencePack,
    runtime: FinalizationRuntime,
  ): Promise<GroundedAnswer> {
    const pack = this.packs.get(supplied.runId);
    if (!pack || hash(pack) !== hash(supplied))
      throw new Error("invalid_evidence_pack");
    const stop = new AbortController();
    const changed = new AbortController();
    const signal = AbortSignal.any([runtime.signal, changed.signal]);
    const watcher = (async () => {
      try {
        while (!stop.signal.aborted) {
          await pause(100, undefined, { signal: stop.signal });
          await this.validateSources(
            token,
            pack,
            AbortSignal.any([stop.signal, runtime.signal]),
          );
        }
      } catch (error) {
        if (!stop.signal.aborted) changed.abort(error);
      }
    })();
    const parent = runtime;
    runtime = {
      ...parent,
      signal,
      request: async (phase, input) => {
        signal.throwIfAborted();
        const result = await parent.request(phase, input, signal);
        signal.throwIfAborted();
        return result;
      },
    };
    try {
      runtime.signal.throwIfAborted();
      if (!pack.items.length) throw new Error("insufficient_evidence");
      let lastError: unknown = new Error("insufficient_evidence");
      let feedback: unknown;
      let reviewed: { draft: Draft; review: Review } | undefined;
      for (let generation = 0; generation < 2; generation++) {
        runtime.signal.throwIfAborted();
        if (
          runtime.remaining("generation") < 1 ||
          runtime.remaining("review") < 1
        )
          break;
        let sourceCheckedAt = await this.validateSources(
          token,
          pack,
          runtime.signal,
        );
        let draft: Draft;
        try {
          draft = validateDraft(
            await runtime.request("generation", {
              pack,
              feedback,
              tools: [],
              prompt:
                "Produce a draft answering the question from originals, preserving qualifications/conflicts. Return text and exact-span claim manifest (id,start,end,role,handles,subject,scope,conditions,attribution,premises). Cover every non-whitespace span; use at most 24 facts. Gap/question roles are not factual assertions. No tools.",
            }),
            pack,
          );
        } catch (error) {
          runtime.signal.throwIfAborted();
          lastError = error;
          feedback = { error: "invalid_or_unavailable_draft" };
          continue;
        }
        sourceCheckedAt = await this.validateSources(
          token,
          pack,
          runtime.signal,
        );
        let review: Review | undefined;
        for (
          let attempt = 0;
          attempt < 2 && runtime.remaining("review") > 0;
          attempt++
        ) {
          runtime.signal.throwIfAborted();
          try {
            review = validateReview(
              await runtime.request("review", {
                pack,
                draft,
                tools: [],
                prompt: reviewPrompt,
              }),
              draft,
              pack,
            );
            break;
          } catch (error) {
            runtime.signal.throwIfAborted();
            lastError = error;
          }
        }
        if (!review) break;
        reviewed = { draft, review };
        const checkpoints = this.reviewed.get(pack.runId) ?? [];
        checkpoints.push(
          structuredClone({
            draft,
            review,
            pack,
            model: runtime.model,
            checkedAt: sourceCheckedAt,
          }),
        );
        this.reviewed.set(pack.runId, checkpoints.slice(-2));
        if (review.claims.some((claim) => claim.verdict !== "supported")) {
          feedback = { draft, review };
          lastError = new Error("insufficient_evidence");
          continue;
        }
        const validatedAt = await this.validateSources(
          token,
          pack,
          runtime.signal,
        );
        runtime.signal.throwIfAborted();
        const used = new Set(
          draft.claims.flatMap((claim) => claimDependencies(claim, review)),
        );
        return {
          status:
            draft.claims.some((claim) => claim.role === "fact") &&
            !draft.claims.some((claim) => claim.role === "gap") &&
            !pack.diagnostics.gaps.includes("context_limit")
              ? "answered"
              : "partial",
          ...(draft.claims.some((claim) => claim.role === "gap") ||
          pack.diagnostics.gaps.includes("context_limit")
            ? { reason: "incomplete_support" }
            : {}),
          text: draft.text,
          citations: pack.items
            .filter((item) => used.has(item.handle))
            .map((item) => ({ ...item, id: item.documentId })),
          validatedAt,
          certificate: certificate(
            draft,
            review,
            pack,
            runtime.model,
            validatedAt,
          ),
        };
      }
      runtime.signal.throwIfAborted();
      if (reviewed) {
        await this.validateSources(token, pack, runtime.signal);
        const subset = await this.supportedSubset(
          token,
          pack.runId,
          runtime.signal,
        );
        if (subset) return subset;
      }
      throw lastError;
    } finally {
      stop.abort();
      await watcher;
    }
  }
  async supportedSubset(
    token: string,
    runId: string,
    signal: AbortSignal,
  ): Promise<GroundedAnswer | undefined> {
    signal.throwIfAborted();
    for (const { draft, review, pack, model, checkedAt } of [
      ...(this.reviewed.get(runId) ?? []),
    ].reverse()) {
      const validity = await this.sources.validateReferences(
        token,
        pack.items,
        signal,
      );
      if (!validity.valid) throw new Error("invalid_citation");
      const validatedAt = validity.checkedAt;
      const current = new Set(validity.currentPassages);
      let retained = draft.claims.filter(
        (claim) =>
          claim.role === "fact" &&
          claimDependencies(claim, review).every((handle) =>
            pack.items.some(
              (item) => item.handle === handle && current.has(item.passageId),
            ),
          ) &&
          review.claims.some(
            (result) =>
              result.id === claim.id &&
              result.verdict === "supported" &&
              result.standalone === true,
          ),
      );
      for (let count = 0; count < draft.claims.length; count++)
        retained = retained.filter((claim) =>
          claim.premises.every((id) =>
            retained.some((other) => other.id === id),
          ),
        );
      if (retained.length) {
        retained.sort((a, b) => a.start - b.start);
        const text =
          retained
            .map((claim) => draft.text.slice(claim.start, claim.end))
            .join("\n") + "\n部分问题尚缺少通过审核的依据。";
        const used = new Set(
          retained.flatMap((claim) => claimDependencies(claim, review)),
        );
        signal.throwIfAborted();
        return {
          status: "partial",
          text,
          citations: pack.items
            .filter((item) => used.has(item.handle))
            .map((item) => ({ ...item, id: item.documentId })),
          validatedAt,
          reason: "incomplete_support",
          subset: {
            originalDraftHash: draft.hash,
            evidenceHash: pack.hash,
            retainedClaimIds: retained.map((claim) => claim.id),
            subsetHash: hash(text),
            certificate: certificate(draft, review, pack, model, checkedAt),
            checkedAt: validatedAt,
          },
        };
      }
    }
    return undefined;
  }
  private async validateSources(
    token: string,
    pack: EvidencePack,
    signal?: AbortSignal,
  ) {
    const result = await this.sources.validateReferences(
      token,
      pack.items,
      signal,
    );
    if (!result.valid) throw new Error("invalid_citation");
    if (!result.current) throw new Error("source_changed");
    return result.checkedAt;
  }
  release(runId: string) {
    this.packs.delete(runId);
    this.reviewed.delete(runId);
  }
}

function claimDependencies(claim: Claim, review: Review): string[] {
  return [
    ...new Set([
      ...claim.handles,
      ...(review.claims
        .find((result) => result.id === claim.id)
        ?.spans.map((span) => span.handle) ?? []),
    ]),
  ];
}

function certificate(
  draft: Draft,
  review: Review,
  pack: EvidencePack,
  model: string,
  checkedAt: string,
): AnswerCertificate {
  return {
    draftHash: draft.hash,
    evidenceHash: pack.hash,
    review,
    model,
    prompt: "loreweave-support-review-v1",
    policy: "V01-v1",
    checkedAt,
    evidence: pack.items.map((item) => ({
      handle: item.handle,
      version: item.version,
      passageId: item.passageId,
    })),
    identityRevisions: [],
  };
}
