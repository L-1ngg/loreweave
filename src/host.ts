import { createAgent, type Agent } from "@forge-agent/core/sdk";
import { FixtureSources, type Evidence } from "./development/sources.ts";

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
  status: RunStatus;
  counts: Record<Phase | "retrieval", number>;
  answer?: { text: string; citations: Evidence[]; validatedAt: string };
  reason?: string;
  settledAt?: string;
  refreshUsed?: boolean;
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
export interface HostOptions {
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
  constructor(private readonly options: HostOptions) {}
  start(input: { question: string; complex?: boolean }): RunSnapshot {
    if (this.active >= 5 && this.queue.length >= 10)
      throw new Error("unavailable");
    const snapshot: RunSnapshot = {
      id: crypto.randomUUID(),
      status: "queued",
      counts: { exploration: 0, generation: 0, review: 0, retrieval: 0 },
    };
    const milliseconds = input.complex
      ? (this.options.timing?.complexMs ?? 60000)
      : (this.options.timing?.ordinaryMs ?? 30000);
    const reserve = input.complex
      ? (this.options.timing?.complexReserveMs ?? 15000)
      : (this.options.timing?.ordinaryReserveMs ?? 8000);
    const deadline = Date.now() + milliseconds;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run: Run = {
      snapshot,
      events: [],
      done,
      finish,
      question: input.question,
      active: false,
      controller: new AbortController(),
      deadline,
      explorationDeadline: deadline - reserve,
      retrievalCap: input.complex ? 3 : 2,
    };
    run.timer = setTimeout(() => this.stop(run, "timed_out"), milliseconds);
    this.runs.set(snapshot.id, run);
    this.publish(run, "state");
    this.queue.push(run);
    this.pump();
    return structuredClone(snapshot);
  }
  get(id: string): RunSnapshot {
    return structuredClone(this.run(id).snapshot);
  }
  events(id: string, after = 0): RunEvent[] {
    return structuredClone(
      this.run(id).events.filter((event) => event.sequence > after),
    );
  }
  settled(id: string): Promise<void> {
    return this.run(id).done;
  }
  cancel(id: string): void {
    const run = this.run(id);
    this.stop(run, "canceled");
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
      run.finish();
    }
  }
  async close(): Promise<void> {
    for (const id of this.runs.keys()) this.cancel(id);
    await Promise.all([...this.runs.values()].map((run) => run.done));
  }
  private pump(): void {
    while (this.active < 5 && this.queue.length) {
      const run = this.queue.shift()!;
      run.active = true;
      this.active++;
      run.snapshot.status = "executing";
      this.publish(run, "state");
      void this.execute(run, run.question).finally(() => {
        run.active = false;
        this.active--;
        run.finish();
        this.pump();
      });
    }
  }
  private publish(run: Run, type: RunEvent["type"], message?: string): void {
    run.events.push({
      sequence: run.events.length + 1,
      type,
      run: structuredClone(run.snapshot),
      ...(message ? { message } : {}),
    });
  }
  private run(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new Error("Run not found");
    return run;
  }
  private admit(run: Run, phase: Phase): void {
    if (Date.now() >= run.deadline) this.stop(run, "timed_out");
    run.controller.signal.throwIfAborted();
    if (phase === "exploration" && Date.now() >= run.explorationDeadline)
      throw new Error("budget_exhausted");
    const cap = phase === "exploration" ? 3 : 2;
    if (run.snapshot.counts[phase] >= cap) throw new Error("budget_exhausted");
    run.snapshot.counts[phase]++;
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
      run.agent = await createAgent({
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
      if (!run.controller.signal.aborted) {
        run.snapshot.status = "failed";
        run.snapshot.reason =
          error instanceof Error && error.message === "budget_exhausted"
            ? "budget_exhausted"
            : "insufficient_evidence";
        this.publish(run, "result");
      }
    } finally {
      unsubscribe();
      clearTimeout(explorationTimer);
      clearTimeout(run.timer);
      await run.agent?.dispose();
      run.snapshot.settledAt = new Date().toISOString();
      this.publish(run, "settled");
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
        this.publish(run, "state");
        run.snapshot.refreshUsed = true;
        run.snapshot.counts.retrieval++;
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
    this.admit(run, phase);
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
