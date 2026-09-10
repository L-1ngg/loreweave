import {
  createAgent,
  type Agent,
  type SessionState,
} from "@forge-agent/core/sdk";
import { FixtureSources, type Evidence } from "./development/sources.ts";

import {
  PostgresConversations,
  type ConversationWriter,
} from "./conversations.ts";

type Phase = "exploration" | "generation" | "review";
export type RunStatus =
  | "queued"
  | "executing"
  | "finalizing"
  | "refreshing"
  | "answered"
  | "failed"
  | "canceled"
  | "timed_out";
export interface RunSnapshot {
  id: string;
  conversationId: string;
  status: RunStatus;
  counts: Record<Phase | "retrieval", number>;
  answer?: { text: string; citations: Evidence[]; validatedAt: string };
  reason?: string;
  settledAt?: string;
  refreshUsed?: boolean;
  deadline: number;
  draftId?: string;
  supersededDraftIds?: string[];
}
export interface RunEvent {
  sequence: number;
  type: "state" | "progress" | "result" | "settled";
  run: RunSnapshot;
  message?: string;
}
interface Run {
  snapshot: RunSnapshot;
  events: RunEvent[];
  writer?: ConversationWriter;
  persistence: Promise<void>;
  claim?: Promise<void>;
  storageFailed: boolean;
  done: Promise<void>;
  agent?: Agent;
  finish: () => void;
  question: string;
  active: boolean;
  controller: AbortController;
  finalController?: AbortController;
  deadline: number;
  explorationDeadline: number;
  retrievalCap: number;
  timer?: ReturnType<typeof setTimeout>;
}
export interface StartTurn {
  question: string;
  complex?: boolean;
  conversationId?: string;
}
export interface HostOptions {
  conversations?: PostgresConversations;
  providerUrl: string;
  sources: FixtureSources;
  timing?: {
    ordinaryMs?: number;
    ordinaryReserveMs?: number;
    complexMs?: number;
    complexReserveMs?: number;
  };
}

/** M07 host owns product outcomes; Forge retains the exploration/tool loop. */
export class KnowledgeHost {
  private runs = new Map<string, Run>();
  private queue: Run[] = [];
  private active = 0;
  private admitting = 0;
  private starts = new Set<Promise<RunSnapshot>>();
  private polling = false;
  private pumping = false;
  private closed = false;
  private readonly poller: ReturnType<typeof setInterval>;
  constructor(private readonly options: HostOptions) {
    this.poller = setInterval(() => {
      void this.poll().catch(() => {
        for (const run of this.runs.values()) {
          if (!run.snapshot.settledAt) this.fault(run);
        }
      });
    }, 50);
    this.poller.unref();
  }
  private async poll(): Promise<void> {
    if (this.closed || this.polling) return;
    this.polling = true;
    try {
      for (const run of this.runs.values()) {
        if (
          !run.active &&
          !run.snapshot.settledAt &&
          this.options.conversations
        ) {
          const current = await this.options.conversations.run(run.snapshot.id);
          if (current.settledAt) {
            run.snapshot = current;
            run.controller.abort();
            clearTimeout(run.timer);
            this.queue = this.queue.filter((queued) => queued !== run);
            run.finish();
            continue;
          }
        }
        if (
          !run.snapshot.settledAt &&
          this.options.conversations &&
          (await this.options.conversations.cancellationRequested(
            run.snapshot.id,
          ))
        )
          this.stop(run, "canceled");
      }
      await this.pump();
    } finally {
      this.polling = false;
    }
  }
  start(input: StartTurn): Promise<RunSnapshot> {
    const task = this.startRun(input);
    this.starts.add(task);
    void task.finally(() => this.starts.delete(task)).catch(() => {});
    return task;
  }
  private async startRun(input: StartTurn): Promise<RunSnapshot> {
    if (this.closed) throw new Error("unavailable");
    if (
      [...this.runs.values()].filter((run) => !run.snapshot.settledAt).length +
        this.admitting >=
      15
    )
      throw new Error("unavailable");
    this.admitting++;
    try {
      const startedAt = Date.now();
      const snapshot: RunSnapshot = {
        id: crypto.randomUUID(),
        deadline: 0,
        conversationId:
          input.conversationId ??
          (await this.options.conversations?.create())?.id ??
          crypto.randomUUID(),
        status: "queued",
        counts: { exploration: 0, generation: 0, review: 0, retrieval: 0 },
      };
      const milliseconds = input.complex
        ? (this.options.timing?.complexMs ?? 60000)
        : (this.options.timing?.ordinaryMs ?? 30000);
      const reserve = input.complex
        ? (this.options.timing?.complexReserveMs ?? 15000)
        : (this.options.timing?.ordinaryReserveMs ?? 8000);
      const deadline = startedAt + milliseconds;
      snapshot.deadline = deadline;
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const run: Run = {
        snapshot,
        events: [],
        persistence: Promise.resolve(),
        storageFailed: false,
        done,
        finish,
        question: input.question,
        active: false,
        controller: new AbortController(),
        deadline,
        explorationDeadline: deadline - reserve,
        retrievalCap: input.complex ? 3 : 2,
      };
      await this.options.conversations?.register(
        snapshot,
        input.question,
        deadline,
      );
      run.timer = setTimeout(
        () => this.stop(run, "timed_out"),
        Math.max(0, deadline - Date.now()),
      );
      this.runs.set(snapshot.id, run);
      this.publish(run, "state");
      await run.persistence;
      this.queue.push(run);
      void this.pump().catch(() => this.fault(run));
      return structuredClone(snapshot);
    } finally {
      this.admitting--;
    }
  }
  async get(id: string): Promise<RunSnapshot> {
    if (this.options.conversations) return this.options.conversations.run(id);
    return structuredClone(this.run(id).snapshot);
  }
  async conversation(id: string) {
    if (!this.options.conversations) throw new Error("unavailable");
    return {
      ...(await this.options.conversations.read(id)),
      runs: await this.options.conversations.runs(id),
    };
  }
  async events(id: string, after = 0): Promise<RunEvent[]> {
    if (this.options.conversations)
      return this.options.conversations.events(id, after);
    return structuredClone(
      this.run(id).events.filter((event) => event.sequence > after),
    );
  }
  settled(id: string): Promise<void> {
    return this.run(id).done;
  }
  async cancel(id: string): Promise<void> {
    await this.options.conversations?.requestCancel(id);
    const run = this.runs.get(id);
    if (run) {
      this.stop(run, "canceled");
      await run.persistence;
    } else if (!this.options.conversations) throw new Error("not_found");
  }
  private stop(run: Run, status: "canceled" | "timed_out"): void {
    if (
      ["answered", "failed", "canceled", "timed_out"].includes(
        run.snapshot.status,
      )
    )
      return;
    run.snapshot.status = status;
    run.snapshot.reason =
      status === "timed_out" ? "budget_exhausted" : "canceled";
    this.publish(run, "result");
    run.controller.abort();
    run.agent?.abort();
    if (!run.active) {
      this.queue = this.queue.filter((queued) => queued !== run);
      clearTimeout(run.timer);
      run.snapshot.settledAt = new Date().toISOString();
      this.publish(run, "settled");
      void run.persistence.finally(() => run.finish()).catch(() => {});
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.poller);
    await Promise.allSettled([...this.starts]);
    for (const run of this.runs.values()) this.stop(run, "canceled");
    await Promise.all([...this.runs.values()].map((run) => run.done));
  }
  private async pump(): Promise<void> {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    try {
      for (const run of [...this.queue]) {
        if (this.active >= 5) break;
        if (run.controller.signal.aborted) continue;
        if (
          [...this.runs.values()].some(
            (other) =>
              other.active &&
              other.snapshot.conversationId === run.snapshot.conversationId,
          )
        )
          continue;
        let claimComplete!: () => void;
        run.claim = new Promise<void>((resolve) => {
          claimComplete = resolve;
        });
        run.active = true;
        this.active++;
        let writer: ConversationWriter | null | undefined;
        try {
          writer = await this.options.conversations?.acquire(
            run.snapshot.conversationId,
            run.snapshot.id,
          );
          if (writer) run.writer = writer;
        } catch {
          this.fault(run);
        } finally {
          claimComplete();
        }
        if (writer === null && !run.controller.signal.aborted) {
          run.active = false;
          this.active--;
          continue;
        }
        this.queue = this.queue.filter((queued) => queued !== run);
        if (!run.controller.signal.aborted) {
          run.snapshot.status = "executing";
          this.publish(run, "state");
        }
        void this.execute(run, run.question)
          .catch(() => this.fault(run))
          .finally(() => {
            run.active = false;
            this.active--;
            run.finish();
            void this.pump().catch(() => this.fault(run));
          });
      }
    } finally {
      this.pumping = false;
    }
  }
  private fault(run: Run): void {
    if (run.storageFailed) return;
    run.storageFailed = true;
    run.controller.abort(new Error("storage_uncertain"));
    run.agent?.abort();
    if (!run.active) {
      this.queue = this.queue.filter((queued) => queued !== run);
      clearTimeout(run.timer);
      void run.persistence.catch(() => {}).then(() => run.finish());
    }
  }
  private publish(run: Run, type: RunEvent["type"], message?: string): void {
    const event: RunEvent = {
      sequence: run.events.length + 1,
      type,
      run: structuredClone(run.snapshot),
      ...(message ? { message } : {}),
    };
    run.events.push(event);
    const claim = run.claim;
    run.persistence = run.persistence.then(async () => {
      await claim;
      if (run.writer) await run.writer.save(event);
      else await this.options.conversations?.saveQueued(event);
    });
    void run.persistence.catch(() => this.fault(run));
  }
  private run(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new Error("Run not found");
    return run;
  }
  private async admit(run: Run, phase: Phase): Promise<void> {
    if (Date.now() >= run.deadline) this.stop(run, "timed_out");
    run.controller.signal.throwIfAborted();
    if (phase === "exploration" && Date.now() >= run.explorationDeadline)
      throw new Error("budget_exhausted");
    const cap = phase === "exploration" ? 3 : 2;
    if (run.snapshot.counts[phase] >= cap) throw new Error("budget_exhausted");
    run.snapshot.counts[phase]++;
    this.publish(run, "progress");
    await run.persistence;
    run.controller.signal.throwIfAborted();
  }
  private async execute(run: Run, question: string): Promise<void> {
    let evidence: Evidence | undefined;
    const unsubscribe = this.options.sources.subscribe(() =>
      run.finalController?.abort(new Error("source_changed")),
    );
    const explorationTimer = setTimeout(
      () => run.agent?.abort(),
      Math.max(0, run.explorationDeadline - Date.now()),
    );
    try {
      await run.persistence;
      run.controller.signal.throwIfAborted();
      if (run.writer) assertReconciled(await run.writer.storage.load());
      run.agent = await createAgent({
        ...(run.writer
          ? {
              storage: {
                load: () => run.writer!.storage.load(),
                append: async (entry) => {
                  try {
                    await run.writer!.storage.append(entry);
                  } catch (error) {
                    this.fault(run);
                    throw error;
                  }
                },
              },
            }
          : {}),
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        apiKey: "fixture-only",
        baseUrl: this.options.providerUrl,
        cwd: process.cwd(),
        systemPrompt:
          "Retrieve original evidence with search_evidence. Exploration is provisional, not the final answer.",
        retry: { enabled: false, maxRetries: 0 },
        context: { enabled: false },
        maxTokens: 1500,
        permission: {
          rules: [
            { tool: "search_evidence", argsPattern: "*", effect: "allow" },
          ],
        },
        beforeModelRequest: () => this.admit(run, "exploration"),
        tools: [
          {
            name: "search_evidence",
            label: "查询原文",
            description: "Read the development source.",
            parameters: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
            execute: async () => {
              if (
                Date.now() >= run.explorationDeadline ||
                run.controller.signal.aborted ||
                run.snapshot.counts.retrieval >= run.retrievalCap
              )
                throw new Error("budget_exhausted");
              run.snapshot.counts.retrieval++;
              this.publish(run, "progress");
              await run.persistence;
              run.controller.signal.throwIfAborted();
              evidence = this.options.sources.read();
              return {
                content: [{ type: "text", text: evidence.text }],
                details: evidence,
              };
            },
          },
        ],
      });
      run.controller.signal.throwIfAborted();
      const turn = run.agent.runTurn(question);
      for await (const event of turn) {
        if (event.type === "tool_execution_start")
          this.publish(run, "progress", "正在查阅原文");
      }
      await turn.result;
      clearTimeout(explorationTimer);
      run.controller.signal.throwIfAborted();
      run.snapshot.status = "finalizing";
      this.publish(run, "state");
      if (!evidence) throw new Error("insufficient_evidence");
      run.snapshot.answer = await this.finalize(run, question, evidence);
      run.snapshot.status = "answered";
      this.publish(run, "result");
    } catch (error) {
      if (run.storageFailed || !run.controller.signal.aborted) {
        if (!["canceled", "timed_out"].includes(run.snapshot.status))
          run.snapshot.status = "failed";
        run.snapshot.reason = run.storageFailed
          ? "storage_uncertain"
          : error instanceof Error && error.message === "budget_exhausted"
            ? "budget_exhausted"
            : error instanceof Error &&
                error.message === "history_requires_reconciliation"
              ? "history_requires_reconciliation"
              : "insufficient_evidence";
        this.publish(run, "result");
      }
    } finally {
      unsubscribe();
      clearTimeout(explorationTimer);
      clearTimeout(run.timer);
      try {
        await run.agent?.dispose();
      } catch {
        this.fault(run);
      }
      run.snapshot.settledAt = new Date().toISOString();
      this.publish(run, "settled");
      try {
        await run.persistence;
      } catch {
        /* Leave durable run unsettled for reconciliation. */
      }
      await run.writer?.release();
    }
  }
  private async finalize(
    run: Run,
    question: string,
    initial: Evidence,
  ): Promise<NonNullable<RunSnapshot["answer"]>> {
    let evidence = initial;
    for (;;) {
      if (
        run.snapshot.counts.generation >= 2 ||
        run.snapshot.counts.review >= 2
      )
        throw new Error("budget_exhausted");
      try {
        run.snapshot.draftId = crypto.randomUUID();
        const draft = await this.request(run, "generation", {
          question,
          evidence,
        });
        if (!this.options.sources.current(evidence))
          throw new Error("source_changed");
        if (!isRecord(draft) || typeof draft.text !== "string")
          throw new Error("invalid_draft");
        const review = await this.request(run, "review", { draft, evidence });
        if (!this.options.sources.current(evidence))
          throw new Error("source_changed");
        if (!isRecord(review) || review.supported !== true)
          throw new Error("insufficient_evidence");
        return {
          text: draft.text,
          citations: [evidence],
          validatedAt: new Date().toISOString(),
        };
      } catch (error) {
        run.controller.signal.throwIfAborted();
        if (this.options.sources.current(evidence)) {
          if (
            error instanceof Error &&
            ["invalid_draft", "insufficient_evidence"].includes(
              error.message,
            ) &&
            run.snapshot.counts.generation < 2 &&
            run.snapshot.counts.review < 2
          )
            continue;
          throw error;
        }
        if (
          run.snapshot.refreshUsed ||
          run.snapshot.counts.retrieval >= run.retrievalCap ||
          run.snapshot.counts.generation >= 2 ||
          run.snapshot.counts.review >= 2 ||
          Date.now() >= run.deadline
        )
          throw new Error("source_changed");
        run.snapshot.status = "refreshing";
        run.snapshot.refreshUsed = true;
        if (run.snapshot.draftId) {
          (run.snapshot.supersededDraftIds ??= []).push(run.snapshot.draftId);
          delete run.snapshot.draftId;
        }
        run.snapshot.counts.retrieval++;
        this.publish(run, "state");
        await run.persistence;
        run.controller.signal.throwIfAborted();
        evidence = this.options.sources.read();
        run.snapshot.status = "finalizing";
        this.publish(run, "state");
      }
    }
  }
  private async request(
    run: Run,
    phase: "generation" | "review",
    input: object,
  ): Promise<unknown> {
    await this.admit(run, phase);
    run.finalController = new AbortController();
    const response = await fetch(
      new URL("finalize", this.options.providerUrl),
      {
        signal: AbortSignal.any([
          run.controller.signal,
          run.finalController.signal,
        ]),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase,
          maxTokens: phase === "generation" ? 1500 : 2000,
          ...input,
        }),
      },
    );
    if (!response.ok) throw new Error("provider_unavailable");
    return response.json();
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Raw entries stay unchanged; unknown historic effects require M08 reconciliation. */
function assertReconciled(state: SessionState): void {
  const entries = new Map(state.entries.map((entry) => [entry.id, entry]));
  const branch = [];
  const visited = new Set<string>();
  let id = state.leafId;
  while (id !== null) {
    const entry = entries.get(id);
    if (!entry || visited.has(id))
      throw new Error("history_requires_reconciliation");
    visited.add(id);
    branch.push(entry);
    id = entry.parentId;
  }
  const pending = new Set<string>();
  for (const entry of branch.reverse()) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "assistant") {
      for (const block of entry.message.content)
        if (block.type === "tool_call") pending.add(block.id);
    }
    if (entry.message.role === "toolResult")
      pending.delete(entry.message.toolCallId!);
  }
  if (pending.size) throw new Error("history_requires_reconciliation");
}
