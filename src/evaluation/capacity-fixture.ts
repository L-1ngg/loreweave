import { ScriptedWikiModel } from "../development/wiki-model.ts";
import type { WikiPhase } from "../wiki-types.ts";
import { evaluationFixture } from "./fixture.ts";
import { measureCapacity } from "./capacity.ts";
import { MarkdownUpdate } from "./markdown-update.ts";
class ObservableMaintenance extends ScriptedWikiModel {
  override async request(
    phase: WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    await Bun.sleep(125);
    return super.request(phase, input, signal);
  }
}
/** A small controlled-provider load validates scheduling, not the capacity baseline. */
export async function capacityFixture(
  database: string,
  corrupt = false,
  options: { runUpdateMaintenance?: boolean } = {},
) {
  const f = await evaluationFixture(database, corrupt, "combined", true, {
    answer: { delayMs: 150 },
    wiki: new ObservableMaintenance(),
    graph: new ObservableMaintenance(),
  });
  let updating: Promise<void> | undefined;
  async function drain() {
    for (let step = 0; step < 100; step++) {
      const a = await f.identities!.workOne(f.token);
      const b = await f.wiki!.workOne(f.token);
      const c = await f.graph!.workOne(f.token);
      if (!a && !b && !c) return;
    }
    throw new Error("capacity_fixture_worker_limit");
  }
  try {
    await drain();
    const dataset = {
      ...f.dataset,
      cases: [
        ...f.dataset.cases,
        {
          ...f.dataset.cases[0]!,
          id: "complex-logs",
          complexity: "complex" as const,
        },
      ],
    };
    const plan = {
      schemaVersion: 1,
      mode: "fixture",
      profile: "combined",
      seed: 18,
      total: 20,
      concurrency: 5,
      environment: {
        hardware: "local disposable integration",
        providerQuotas: "controlled HTTP model",
        warmup: "one source built; no answer warmup",
        answerCache: "disabled",
      },
    };
    const idle = await measureCapacity({
      plan: { ...plan, scenario: "idle" },
      manifest: f.manifest,
      dataset,
      client: f.client,
    });
    const original = (await f.sources.list(f.token))[0]!;
    const updater = new MarkdownUpdate(f.endpoint, f.token);
    const interference = await measureCapacity({
      plan: { ...plan, scenario: "update-interference" },
      manifest: f.manifest,
      dataset,
      client: f.client,
      update: async () => {
        const accepted = await updater.submit({
          filename: "logs-v2.md",
          bytes: new TextEncoder().encode("生产日志保留 90 天。"),
          documentId: original.documentId,
          expectedPrior: original.versionId,
          key: crypto.randomUUID(),
        });
        updating = (async () => {
          await Bun.sleep(150);
          await f.sources.workOne();
          if (options.runUpdateMaintenance !== false) await drain();
        })();
        return accepted;
      },
    });
    await updating;
    return {
      schemaVersion: 1,
      kind: "capacity-integration",
      provenance: "controlled-provider",
      idle,
      interference,
    };
  } finally {
    await updating?.catch(() => {});
    await f.close();
  }
}
