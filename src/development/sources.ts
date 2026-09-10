export interface Evidence {
  id: string;
  version: string;
  title: string;
  text: string;
}

/** Explicit development corpus; durable original-source storage arrives in #5. */
export class FixtureSources {
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
  read(): Evidence {
    return structuredClone(this.history.at(-1)!);
  }
  current(evidence: Evidence): boolean {
    return (
      evidence.id === this.read().id && evidence.version === this.read().version
    );
  }
  version(version: string): Evidence | undefined {
    return structuredClone(
      this.history.find((item) => item.version === version),
    );
  }
  replace(text: string): void {
    this.history.push({
      ...this.read(),
      text,
      version: `v${this.history.length + 1}`,
    });
    for (const listener of this.listeners) listener();
  }
}
