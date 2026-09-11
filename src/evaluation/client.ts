import type { RunSnapshot } from "../host.ts";
import type { SourceVersion } from "../sources.ts";
import type { EvaluationCase } from "./schema.ts";
/** Only questions and scope cross the public interface; labels never do. */
export class PublicAnswers {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}
  async read<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(new URL(path, this.endpoint), {
      signal,
      headers: { cookie: `loreweave_session=${this.token}` },
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return (await response.json()) as T;
  }
  async configuration(signal: AbortSignal) {
    const identity = await this.read<{ actor: { grants: string[] } }>(
      "/api/auth/me",
      signal,
    );
    if (
      identity.actor.grants.length !== 1 ||
      identity.actor.grants[0] !== "read"
    )
      throw new Error("evaluation_requires_read_only_session");
    return this.read<{
      profile: string;
      wiki: boolean;
      graph: boolean;
      answeringModel: string;
      policy: string;
      retrieval: string;
      context: string;
      budgets: string;
      deadlines: {
        ordinaryMs: number;
        complexMs: number;
        ordinaryReserveMs: number;
        complexReserveMs: number;
      };
    }>("/api/runtime", signal);
  }
  source(version: string, signal: AbortSignal) {
    return this.read<SourceVersion>(`/api/sources/${version}`, signal);
  }
  inventory(signal: AbortSignal) {
    return this.read<{
      operations: Array<{ versionId: string; source: string }>;
    }>("/api/imports", signal);
  }
  async answer(
    item: Pick<EvaluationCase, "question" | "complexity" | "projectId">,
    signal: AbortSignal,
  ): Promise<RunSnapshot> {
    const response = await fetch(new URL("/api/runs", this.endpoint), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        cookie: `loreweave_session=${this.token}`,
      },
      body: JSON.stringify({
        question: item.question,
        complex: item.complexity === "complex",
        projectId: item.projectId,
      }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const run = (await response.json()) as RunSnapshot;
    try {
      let current = run;
      while (
        ["queued", "executing", "finalizing", "refreshing"].includes(
          current.status,
        )
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        signal.throwIfAborted();
        current = await this.read<RunSnapshot>(`/api/runs/${run.id}`, signal);
      }
      return current;
    } catch (error) {
      await fetch(new URL(`/api/runs/${run.id}/cancel`, this.endpoint), {
        method: "POST",
        headers: { cookie: `loreweave_session=${this.token}` },
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
      throw error;
    }
  }
}
