import type { TrustedContext } from "../access.ts";
export interface Evidence {
  passageId?: string;
  handle?: string;
  id: string;
  version: string;
  title: string;
  text: string;
}

/** Explicit development corpus; durable original-source storage arrives in #5. */
export class FixtureSources {
  constructor(
    private readonly scope: {
      organizationId?: string;
      projectId?: string;
    } = {},
  ) {}
  private authorize(context?: TrustedContext, relevance = true): void {
    if (
      this.scope.organizationId &&
      this.scope.organizationId !== context?.organizationId
    )
      throw new Error("unauthorized");
    if (
      relevance &&
      this.scope.projectId &&
      this.scope.projectId !== context?.scope.projectId
    )
      throw new Error("insufficient_evidence");
  }
  private listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private history: Evidence[] = [
    {
      id: "demo-operations",
      version: "v1",
      title: "演示项目运维说明",
      text: "演示项目的应用日志保留 30 天。",
    },
  ];
  read(context?: TrustedContext): Evidence {
    this.authorize(context);
    return structuredClone(this.history.at(-1)!);
  }
  current(evidence: Evidence): boolean {
    return (
      evidence.id === this.history.at(-1)!.id &&
      evidence.version === this.history.at(-1)!.version
    );
  }
  version(version: string, context?: TrustedContext): Evidence | undefined {
    this.authorize(context, false);
    return structuredClone(
      this.history.find((item) => item.version === version),
    );
  }
  replace(text: string): void {
    this.history.push({
      ...this.history.at(-1)!,
      text,
      version: `v${this.history.length + 1}`,
    });
    for (const listener of this.listeners) listener();
  }
}
