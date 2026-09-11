import { setTimeout as pause } from "node:timers/promises";
import type { AccessService } from "./access.ts";
import type { SourceService } from "./sources.ts";
import type { EvidenceService } from "./evidence.ts";
import type { KnowledgeHost } from "./host.ts";

export interface ExternalQuestion {
  question: string;
  projectId?: string;
  complex?: boolean;
}
/** Independent MCP requests share domain validation, never a browser conversation. */
export class ExternalKnowledge {
  private searches = 0;
  constructor(
    private readonly access: AccessService,
    private readonly sources: SourceService,
    private readonly evidence: EvidenceService,
    private readonly host: KnowledgeHost,
  ) {}
  async search(token: string, input: ExternalQuestion, signal: AbortSignal) {
    const context = await this.access.authorize(token, "read", input.projectId);
    if (this.searches >= 5) throw new Error("unavailable");
    this.searches++;
    const runId = crypto.randomUUID();
    try {
      const pack = await this.evidence.retrieve(token, {
        ...input,
        runId,
        signal,
      });
      const versions = new Map<
        string,
        Awaited<ReturnType<SourceService["version"]>>
      >();
      for (const item of pack.items) {
        signal.throwIfAborted();
        if (!versions.has(item.version))
          versions.set(
            item.version,
            await this.sources.version(token, item.version),
          );
      }
      const gaps = new Set(pack.diagnostics.gaps);
      const items = pack.items.flatMap((item) => {
        const source = versions.get(item.version)!;
        if (
          source.currentVersionId !== item.version ||
          source.state !== "active"
        ) {
          gaps.add("source_changed");
          return [];
        }
        return [
          {
            ...item,
            citation: `loreweave://source/${item.version}#${item.passageId}`,
            applicability: {
              organizationId: context.organizationId,
              projectId: source.projectId ?? null,
            },
            sourceState: "active" as const,
          },
        ];
      });
      if (!items.length) gaps.add("insufficient_evidence");
      await this.access.authorize(token, "read", input.projectId);
      signal.throwIfAborted();
      return {
        schemaVersion: 1,
        requestId: runId,
        scope: { organizationId: context.organizationId, ...context.scope },
        items,
        gaps: [...gaps],
        checkedAt: new Date().toISOString(),
        diagnostics: pack.diagnostics,
      };
    } finally {
      this.searches--;
      this.evidence.release(runId);
    }
  }
  async original(token: string, version: string, passageId: string) {
    const source = await this.sources.version(token, version);
    const passage = source.passages.find((item) => item.id === passageId);
    if (!passage) throw new Error("not_found");
    return {
      version,
      passageId,
      title: source.title,
      text: passage.text,
      headingPath: passage.headingPath,
      state: source.state,
      currentVersion: source.currentVersionId,
      applicability: { projectId: source.projectId ?? null },
    };
  }
  async answer(token: string, input: ExternalQuestion, signal: AbortSignal) {
    const context = await this.access.authorize(token, "read", input.projectId);
    signal.throwIfAborted();
    const run = await this.host.start({ ...input, credential: token });
    const cancel = () => {
      void this.host.cancel(run.id, token).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      let result = await this.host.get(run.id, token);
      while (
        ["queued", "executing", "finalizing", "refreshing"].includes(
          result.status,
        )
      ) {
        await pause(20, undefined, { signal });
        result = await this.host.get(run.id, token);
      }
      signal.throwIfAborted();
      const citations = [];
      for (const item of result.answer?.citations ?? []) {
        const source = await this.sources.version(token, item.version);
        citations.push({
          version: item.version,
          passageId: item.passageId,
          citation: `loreweave://source/${item.version}#${item.passageId}`,
          validatedAt: result.answer!.validatedAt,
          applicability: { projectId: source.projectId ?? null },
          sourceState: source.state,
        });
      }
      await this.access.authorize(token, "read", input.projectId);
      signal.throwIfAborted();
      return {
        schemaVersion: 1,
        run: result,
        gaps:
          result.diagnostics?.gaps ?? (result.reason ? [result.reason] : []),
        citations,
        scope: { organizationId: context.organizationId, ...result.scope },
      };
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
}
