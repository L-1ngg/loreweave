import { parseDirectAnswer, type DirectAnswer } from "./direct-answer.ts";
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
export type EvidenceRoute = "source" | "wiki" | "graph";
export type RetrievalProfile = "source" | "wiki" | "graph" | "combined";
const spanKey = (item: SourceCandidate) =>
  `${item.version}:${item.passageId}:${item.start}:${item.end}`;

export interface EvidenceItem extends SourceCandidate {
  handle: string;
  routes?: EvidenceRoute[];
}
export interface EvidencePack {
  runId: string;
  question: string;
  items: EvidenceItem[];
  hash: string;
  diagnostics: {
    routeOutcomes?: Partial<
      Record<
        EvidenceRoute,
        { status: string; candidates: number; originals: number }
      >
    >;
    cache?: "hit" | "miss";
    reusedHandles?: string[];
    wikiCandidates?: number;
    graphCandidates?: number;
    graph?: unknown;
    retrieved?: SourceCandidate[];
    retrievalProfile?: RetrievalProfile | "default";
    requestedRoutes?: string[];
    lexicalCandidates: number;
    vectorCandidates: number;
    retrievalMs: number;
    embeddingRequests: number;
    gaps: string[];
  };
}
export interface RetrievalInput {
  runId: string;
  question: string;
  routes?: EvidenceRoute[];
  graph?: import("./graph-queries.ts").GraphSearchOptions;
  projectId?: string;
  signal: AbortSignal;
  complex?: boolean;
  beforeEmbedding?: () => Promise<void>;
  beforeRetrieval?: () => Promise<void>;
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
  contract?: "direct-answer-v2";
  validation?: { kind: "citation-traceability"; semanticReview: false };
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
  private readonly dependencies = new Map<string, Map<string, string>>();
  private readonly retrievals = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, Map<string, EvidencePack>>();
  private readonly owners = new Map<
    string,
    { token: string; projectId?: string }
  >();
  private readonly views = new Map<string, EvidencePack>();
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
    readonly profile?: RetrievalProfile,
  ) {}
  configuration() {
    return {
      profile: this.profile ?? "default",
      wiki: Boolean(this.wiki),
      graph: Boolean(this.graph),
      retrieval: "hybrid-rrf60-v1",
      context: "8000-16000-v1",
    };
  }
  async retrieve(token: string, input: RetrievalInput): Promise<EvidencePack> {
    const previous = this.retrievals.get(input.runId) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => this.retrieveOnce(token, input));
    this.retrievals.set(input.runId, current);
    try {
      return await current;
    } finally {
      if (this.retrievals.get(input.runId) === current)
        this.retrievals.delete(input.runId);
    }
  }
  private async retrieveOnce(
    token: string,
    input: RetrievalInput,
  ): Promise<EvidencePack> {
    input.signal.throwIfAborted();
    const started = performance.now();
    const routes =
      input.routes ??
      (this.profile === "combined"
        ? ["source", "wiki", "graph"]
        : this.profile === "wiki"
          ? ["source", "wiki"]
          : this.profile === "graph"
            ? ["source", "graph"]
            : ["source"]);
    if (
      !routes.length ||
      routes.some((route) => !["source", "wiki", "graph"].includes(route))
    )
      throw new Error("invalid_input");
    const snapshot = await this.sources.retrievalSnapshot(
      token,
      input.projectId,
    );
    const owner = JSON.stringify({ token, projectId: input.projectId });
    if (
      this.owners.has(input.runId) &&
      JSON.stringify(this.owners.get(input.runId)) !== owner
    )
      throw new Error("unauthorized");
    this.owners.set(input.runId, {
      token,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
    const key = hash({
      snapshot,
      question: input.question,
      routes: [...routes].sort(),
      graph: input.graph,
      complex: input.complex,
      configuration: this.configuration(),
    });
    const cached = this.cache.get(input.runId)?.get(key);
    if (cached)
      return {
        ...structuredClone(cached),
        items: [],
        diagnostics: {
          ...cached.diagnostics,
          cache: "hit",
          reusedHandles: cached.items.map((item) => item.handle),
          embeddingRequests: 0,
          retrievalMs: performance.now() - started,
        },
      };
    await input.beforeRetrieval?.();
    input.signal.throwIfAborted();
    let candidates: Awaited<ReturnType<SourceService["candidates"]>> = {
      lexical: [],
      vector: [],
    };
    const gaps: string[] = [];
    let wikiCandidates = 0,
      wikiOriginals: SourceCandidate[] = [];
    let graphCandidates = 0;
    let graphDetails: unknown;
    let graphOriginals: SourceCandidate[] = [];
    const useWiki = routes.includes("wiki");
    const useGraph = routes.includes("graph");
    const sourceTask = async () => {
      if (!routes.includes("source")) return;
      try {
        candidates = await this.sources.candidates(token, input);
        if (candidates.degradation) gaps.push(candidates.degradation);
      } catch (error) {
        input.signal.throwIfAborted();
        if (error instanceof Error && error.message === "unauthorized")
          throw error;
        gaps.push("source_unavailable");
      }
    };
    const wikiTask = async () => {
      if (useWiki && this.wiki) {
        try {
          const result = await this.wiki.search(token, input);
          wikiCandidates = result.pages;
          wikiOriginals = result.originals;
          if (result.truncated) gaps.push("wiki_original_limit");
          if (result.pending) gaps.push("wiki_pending");
          if (result.incomplete) gaps.push("wiki_incomplete");
          if (result.pageLevelMapping) gaps.push("wiki_page_level_mapping");
        } catch (error) {
          input.signal.throwIfAborted();
          if (error instanceof Error && error.message === "unauthorized")
            throw error;
          gaps.push("wiki_unavailable");
        }
      } else if (useWiki) gaps.push("wiki_unavailable");
    };
    const graphTask = async () => {
      if (useGraph && this.graph) {
        try {
          const result = await this.graph.search(
            token,
            input.question,
            input.projectId,
            input.signal,
            input.graph,
          );
          const bounded = {
            ...result,
            orderedPaths: [...result.orderedPaths],
            claims: [...result.claims],
            entities: [...result.entities],
            ambiguity: [...result.ambiguity],
          };
          const graphBytes = (input.complex ? 16000 : 8000) / 4;
          while (
            new TextEncoder().encode(JSON.stringify(bounded)).length >
              graphBytes &&
            (bounded.claims.length ||
              bounded.entities.length ||
              bounded.ambiguity.length ||
              bounded.orderedPaths.length)
          ) {
            if (bounded.orderedPaths.length) bounded.orderedPaths.pop();
            else if (bounded.claims.length) bounded.claims.pop();
            else if (bounded.ambiguity.length) bounded.ambiguity.pop();
            else bounded.entities.pop();
            bounded.truncated = true;
          }
          if (bounded.truncated && !result.truncated)
            gaps.push("graph_metadata_limit");
          graphDetails = bounded;
          graphCandidates = result.claims.length;
          if (result.truncated) gaps.push("graph_claim_limit");
          if (result.pending) gaps.push("graph_pending");
          gaps.push(...result.gaps);
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
                  documentId: passage.documentId,
                  version: support.version,
                  passageId: support.passageId,
                  title: passage.title,
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
        } catch (error) {
          input.signal.throwIfAborted();
          if (error instanceof Error && error.message === "unauthorized")
            throw error;
          gaps.push("graph_unavailable");
        }
      }
      if (useGraph && !this.graph) gaps.push("graph_unavailable");
    };
    const outcomes = await Promise.allSettled([
      sourceTask(),
      wikiTask(),
      graphTask(),
    ]);
    for (const outcome of outcomes)
      if (outcome.status === "rejected") throw outcome.reason;
    input.signal.throwIfAborted();
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
        const id = spanKey(candidate);
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
    if (!ranked.size && gaps.some((gap) => gap.endsWith("unavailable")))
      throw new Error("retrieval_unavailable");
    const registry = this.packs.get(input.runId)?.items ?? [];
    const provenance = new Map<string, EvidenceRoute[]>();
    for (const [route, originals] of [
      ["source", [...candidates.lexical, ...candidates.vector]],
      ["wiki", wikiOriginals],
      ["graph", graphOriginals],
    ] as Array<[EvidenceRoute, SourceCandidate[]]>)
      for (const item of originals)
        provenance.set(spanKey(item), [
          ...new Set([...(provenance.get(spanKey(item)) ?? []), route]),
        ]);
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
    const context = ordered.flatMap(
      (candidate) => surrounding.get(candidate.passageId) ?? [],
    );
    const requiredContext = context.filter((item) => item.start === 0);
    for (const group of [requiredContext, ordered, context]) {
      for (const item of group) {
        const key = spanKey(item);
        if (included.has(key)) continue;
        // UTF-8 bytes conservatively bound tokens without assuming a model tokenizer.
        const existing = registry.find(
          (previous) => spanKey(previous) === spanKey(item),
        );
        const entry = {
          ...item,
          routes: provenance.get(key) ?? ["source" as const],
          handle:
            existing?.handle ??
            `e${registry.length + items.filter((item) => !registry.some((previous) => previous.handle === item.handle)).length + 1}`,
        };
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
      question: input.question.slice(0, 512),
      items,
      hash: hash(items),
      diagnostics: {
        routeOutcomes: Object.fromEntries(
          routes.map((route) => {
            const count =
              route === "source"
                ? candidates.lexical.length + candidates.vector.length
                : route === "wiki"
                  ? wikiCandidates
                  : graphCandidates;
            const originals =
              route === "source"
                ? new Set(
                    [...candidates.lexical, ...candidates.vector].map(spanKey),
                  ).size
                : route === "wiki"
                  ? wikiOriginals.length
                  : graphOriginals.length;
            return [
              route,
              {
                status: gaps.includes(`${route}_unavailable`)
                  ? "unavailable"
                  : gaps.includes(`${route}_pending`)
                    ? "pending"
                    : gaps.includes(`${route}_incomplete`)
                      ? "unavailable"
                      : gaps.some(
                            (gap) =>
                              gap.startsWith(route + "_") &&
                              gap.endsWith("limit"),
                          )
                        ? "truncated"
                        : count
                          ? "success"
                          : "empty",
                candidates: count,
                originals,
              },
            ];
          }),
        ),
        cache: "miss" as const,
        wikiCandidates,
        graphCandidates,
        graph: graphDetails,
        requestedRoutes: [...routes],
        retrievalProfile: this.profile ?? ("default" as const),
        lexicalCandidates: candidates.lexical.length,
        vectorCandidates: candidates.vector.length,
        retrievalMs: performance.now() - started,
        embeddingRequests: routes.includes("source") ? 1 : 0,
        gaps,
      },
    };
    const cap = (input.complex ? 16000 : 8000) - 512;
    while (
      new TextEncoder().encode(JSON.stringify(pack)).length > cap &&
      items.length
    ) {
      if (!gaps.includes("context_limit")) gaps.push("context_limit");
      items.pop();
    }
    pack.hash = hash(items);
    const dependencies =
      this.dependencies.get(input.runId) ?? new Map<string, string>();
    for (const item of items)
      if (!item.routes?.includes("source"))
        dependencies.set(item.handle, snapshot);
      else dependencies.delete(item.handle);
    this.dependencies.set(input.runId, dependencies);
    const union = [
      ...registry,
      ...items.filter(
        (item) => !registry.some((previous) => previous.handle === item.handle),
      ),
    ];
    this.packs.set(
      input.runId,
      structuredClone({ ...pack, items: union, hash: hash(union) }),
    );
    const cache =
      this.cache.get(input.runId) ?? new Map<string, EvidencePack>();
    cache.set(key, structuredClone(pack));
    this.cache.set(input.runId, cache);
    const view = {
      ...pack,
      items: items.filter(
        (item) => !registry.some((previous) => previous.handle === item.handle),
      ),
      diagnostics: {
        ...pack.diagnostics,
        reusedHandles: items
          .filter((item) =>
            registry.some((previous) => previous.handle === item.handle),
          )
          .map((item) => item.handle),
      },
    };
    this.views.set(input.runId, structuredClone(view));
    return view;
  }
  async finalizeDirect(
    token: string,
    runId: string,
    answer: DirectAnswer,
    signal: AbortSignal,
  ): Promise<GroundedAnswer> {
    signal.throwIfAborted();
    answer = parseDirectAnswer(JSON.stringify(answer));
    if (this.owners.get(runId)?.token !== token)
      throw new Error("unauthorized");
    const pack = this.packs.get(runId);
    if (!pack || answer.basis === "general") throw new Error("invalid_draft");
    const citations = answer.citations.map((handle) => {
      const item = pack.items.find((item) => item.handle === handle);
      if (!item) throw new Error("invalid_citation");
      return { ...item, id: item.passageId };
    });
    if (!citations.length && !answer.gaps.length)
      throw new Error("invalid_citation");
    const snapshot = await this.sources.retrievalSnapshot(
      token,
      this.owners.get(runId)?.projectId,
    );
    if (
      citations.some((item) => {
        const dependency = this.dependencies.get(runId)?.get(item.handle);
        return dependency && dependency !== snapshot;
      })
    )
      throw new Error("source_changed");
    const validatedAt = await this.validateSources(
      token,
      { ...pack, items: citations },
      signal,
    );
    signal.throwIfAborted();
    const gaps = [...answer.gaps, ...answer.conflicts];
    return {
      contract: "direct-answer-v2",
      validation: { kind: "citation-traceability", semanticReview: false },
      status: gaps.length ? "partial" : "answered",
      text: answer.text + (gaps.length ? "\n\n" + gaps.join("\n") : ""),
      citations,
      validatedAt,
      ...(gaps.length ? { reason: "evidence_gap" } : {}),
    };
  }

  async finalize(
    token: string,
    supplied: EvidencePack,
    runtime: FinalizationRuntime,
  ): Promise<GroundedAnswer> {
    const pack = this.views.get(supplied.runId);
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
    this.views.delete(runId);
    this.cache.delete(runId);
    this.dependencies.delete(runId);
    this.owners.delete(runId);
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
