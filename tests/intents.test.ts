import { test, expect } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { PostgresConversations } from "../src/conversations.ts";
import { KnowledgeHost, type RunSnapshot } from "../src/host.ts";
import { EvidenceService } from "../src/evidence.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { FixtureSources } from "../src/development/sources.ts";
import { startScriptedProvider } from "../src/development/provider.ts";
import { IdentityService } from "../src/identity.ts";
import { WikiService } from "../src/wiki.ts";
import { ScriptedWikiModel } from "../src/development/wiki-model.ts";
import { createApp } from "../src/http.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
class ResultLossConversations extends PostgresConversations {
  loseResult = false;
  beforeDispatch: (() => Promise<void>) | undefined;
  override async acquire(id: string, runId?: string) {
    const writer = await super.acquire(id, runId);
    if (!writer) return writer;
    return {
      ...writer,
      save: async (event: import("../src/host.ts").RunEvent) => {
        if (
          this.beforeDispatch &&
          event.run.operationKeys?.length &&
          !event.run.operations?.length
        ) {
          const gate = this.beforeDispatch;
          this.beforeDispatch = undefined;
          await gate();
        }
        if (this.loseResult && event.run.operations?.length) {
          this.loseResult = false;
          throw new Error("simulated result persistence loss");
        }
        await writer.save(event);
      },
    };
  }
}
async function fixture(
  timing?: import("../src/host.ts").HostOptions["timing"],
) {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `intents-${crypto.randomUUID()}`,
    username: "admin",
    password: "intents-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const sources = new SourceService(url!, access, new ControlledEmbeddings());
  const identities = new IdentityService(url!, access, sources);
  const wiki = new WikiService(
    url!,
    access,
    sources,
    identities,
    new ControlledEmbeddings(),
    new ScriptedWikiModel(),
  );
  const conversations = new ResultLossConversations(url!);
  const provider = startScriptedProvider();
  const options = {
    wiki,
    access,
    imports: sources,
    conversations,
    evidence: new EvidenceService(sources),
    sources: new FixtureSources(),
    providerUrl: provider.url,
    ...(timing ? { timing } : {}),
  };
  let host = new KnowledgeHost(options);
  return {
    access,
    sources,
    wiki,
    token,
    conversations,
    provider,
    async turn(
      question: string,
      input: Record<string, unknown> = {},
      onAccepted?: (run: RunSnapshot) => void,
    ) {
      const app = createApp(host, options.sources, {
        access,
        imports: sources,
        wiki,
      });
      const response = await app.request("/api/runs", {
        method: "POST",
        headers: {
          cookie: `loreweave_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ question, ...input }),
      });
      expect(response.status).toBe(202);
      const accepted = (await response.json()) as RunSnapshot;
      onAccepted?.(accepted);
      await host.settled(accepted.id);
      return host.get(accepted.id, token);
    },
    async events(id: string) {
      return host.events(id, 0, token);
    },
    async cancel(id: string) {
      return host.cancel(id, token);
    },
    async readRun(id: string) {
      return host.get(id, token);
    },
    async restart() {
      await host.close();
      host = new KnowledgeHost(options);
    },
    async source(text = "日志保留 30 天。", projectId?: string) {
      const op = await sources.submit(token, {
        key: crypto.randomUUID(),
        filename: "manual.md",
        bytes: Buffer.from(text),
        ...(projectId ? { projectId } : {}),
      });
      while ((await sources.inspect(token, op.id)).source === "processing")
        await sources.workOne();
      return op;
    },
    async upload(text = "日志保留 60 天。", projectId?: string) {
      return sources.upload(token, {
        filename: "manual.md",
        bytes: Buffer.from(text),
        ...(projectId ? { projectId } : {}),
      });
    },
    async close() {
      await host.close();
      while (
        (await sources.list(token)).some(
          (operation) => operation.source === "processing",
        )
      )
        await sources.workOne();
      provider.stop();
      await conversations.close();
      await wiki.close();
      await identities.close();
      await sources.close();
      await access.close();
    },
  };
}
test("explicit update resolves the named manual, while explicit new keeps the duplicate filename distinct", async () => {
  const f = await fixture();
  try {
    const original = await f.source();
    const attachment = await f.upload();
    const updated = await f.turn("请用附件更新「manual.md」", {
      attachmentIds: [attachment.id],
    });
    expect(updated.operations).toHaveLength(1);
    const update = await f.sources.inspect(f.token, updated.operations![0]!);
    expect(update.documentId).toBe(original.documentId);
    await f.sources.workOne();
    const created = await f.turn("请把附件作为新文档导入", {
      conversationId: updated.conversationId,
      attachmentIds: [attachment.id],
    });
    expect(created.operations).toHaveLength(1);
    expect(
      (await f.sources.inspect(f.token, created.operations![0]!)).documentId,
    ).not.toBe(original.documentId);
  } finally {
    await f.close();
  }
}, 30000);

test("ambiguous update survives restart and a numbered reply selects the original pending attachment once", async () => {
  const f = await fixture();
  try {
    await f.source();
    await f.source("日志保留 45 天。");
    const a = await f.upload();
    const pending = await f.turn("请用附件更新「manual.md」", {
      attachmentIds: [a.id],
    });
    expect(pending.operations ?? []).toHaveLength(0);
    expect(pending.clarification).toContain("请选择");
    await f.restart();
    const done = await f.turn("选择第2个", {
      conversationId: pending.conversationId,
    });
    expect(done.operations).toHaveLength(1);
    expect(
      (await f.sources.inspect(f.token, done.operations![0]!)).documentId,
    ).toBe(pending.intentContext!.pending!.candidates[1]!.documentId);
    const before = await f.sources.list(f.token);
    await f.restart();
    expect((await f.sources.list(f.token)).length).toBe(before.length);
  } finally {
    await f.close();
  }
}, 30000);

test("selected project and document persist across turns and scope changes cannot reuse a different project target", async () => {
  const f = await fixture();
  try {
    const project = await f.access.createProject(f.token, "项目一");
    const original = await f.source("生产日志保留 30 天。", project.id);
    const selection = await f.turn("日志保留多久？", {
      projectId: project.id,
      sourceVersion: original.versionId,
    });
    await f.restart();
    const attachment = await f.upload("生产日志保留 80 天。", project.id);
    const update = await f.turn("请更新这个文档", {
      conversationId: selection.conversationId,
      attachmentIds: [attachment.id],
    });
    expect(update.operations).toHaveLength(1);
    expect(
      (await f.sources.inspect(f.token, update.operations![0]!)).documentId,
    ).toBe(original.documentId);
    const shared = await f.upload();
    const reset = await f.turn("请更新这个文档", {
      conversationId: update.conversationId,
      projectId: null,
      attachmentIds: [shared.id],
    });
    expect(reset.operations ?? []).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);

test("selected Wiki corrections and retained structure guidance use original user intent across restart", async () => {
  const f = await fixture();
  try {
    await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const selected = await f.turn("日志保留多久？", {
      pageId: page.id,
      pageVersion: page.version,
    });
    await f.restart();
    const guidance = await f.turn("请保留旧步骤结构", {
      conversationId: selected.conversationId,
    });
    expect(guidance.operations).toHaveLength(1);
    expect(
      (await f.wiki.guidance(f.token)).some(
        (item) => item.pageId === page.id && item.text === "请保留旧步骤结构",
      ),
    ).toBe(true);
    const corrected = await f.turn("请纠正这个主题：测试日志保留 14 天。", {
      conversationId: guidance.conversationId,
    });
    expect(corrected.operations).toHaveLength(1);
    expect(
      (await f.sources.inspect(f.token, corrected.operations![0]!)).source,
    ).toBe("processing");
  } finally {
    await f.close();
  }
}, 30000);

test("effect committed before result persistence fails is inspected by durable key after restart without another import", async () => {
  const f = await fixture();
  try {
    const original = await f.source();
    const attachment = await f.upload();
    f.conversations.loseResult = true;
    const interrupted = await f.turn("请用附件更新「manual.md」", {
      attachmentIds: [attachment.id],
    });
    expect(interrupted.operations).toHaveLength(1);
    expect(
      (await f.sources.inspect(f.token, interrupted.operations![0]!))
        .documentId,
    ).toBe(original.documentId);
    await f.restart();
    const recovered = await f.readRun(interrupted.id);
    expect(recovered.operations).toEqual(interrupted.operations);
    const replay = await f.events(interrupted.id);
    expect(replay.length).toBeGreaterThan(0);
    for (const event of replay)
      expect(event.run.operations).toEqual(interrupted.operations);
    expect(
      (await f.sources.list(f.token)).filter(
        (op) => op.documentId === original.documentId,
      ),
    ).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30000);

test("a selected historical Wiki version restores with its reason and does not roll back original sources", async () => {
  const f = await fixture();
  try {
    const original = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const first = (await f.wiki.list(f.token)).items[0]!;
    const changed = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "manual.md",
      bytes: Buffer.from("生产日志保留 90 天。"),
      documentId: original.documentId,
      expectedPrior: original.versionId,
    });
    while (
      (await f.sources.inspect(f.token, changed.id)).source === "processing"
    )
      await f.sources.workOne();
    while (await f.wiki.workOne(f.token)) {}
    const selected = await f.turn("日志保留多久？", {
      pageId: first.id,
      pageVersion: first.version,
    });
    const restored = await f.turn(
      "请恢复这个主题的所选历史版本：恢复旧步骤供对照。",
      { conversationId: selected.conversationId },
    );
    expect(restored.operations).toHaveLength(1);
    await f.wiki.workOne(f.token);
    expect(
      (await f.wiki.history(f.token, first.id)).items.some(
        (v) => v.reason === "恢复旧步骤供对照。",
      ),
    ).toBe(true);
    expect(await f.sources.current(f.token, changed.versionId)).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

test("cross-project duplicate choice accepts the original attachment in the chosen document scope", async () => {
  const f = await fixture();
  try {
    const a = await f.access.createProject(f.token, "项目甲");
    const b = await f.access.createProject(f.token, "项目乙");
    await f.source("日志保留 30 天。", a.id);
    await f.source("日志保留 45 天。", b.id);
    const attachment = await f.upload();
    const pending = await f.turn("请用附件更新「manual.md」", {
      attachmentIds: [attachment.id],
    });
    expect(pending.clarification).toContain("项目甲");
    expect(pending.clarification).toContain("项目乙");
    await f.restart();
    const selected = pending.intentContext!.pending!.candidates[1]!;
    const done = await f.turn("选择第2个", {
      conversationId: pending.conversationId,
    });
    expect(done.operations).toHaveLength(1);
    expect(
      (await f.sources.inspect(f.token, done.operations![0]!)).documentId,
    ).toBe(selected.documentId);
    expect(done.scope?.projectId).toBe(selected.projectId!);
  } finally {
    await f.close();
  }
}, 30000);

for (const stop of ["cancel", "deadline"] as const) {
  test(`${stop} while persisting the operation key prevents the source effect`, async () => {
    const f = await fixture(
      stop === "deadline"
        ? { ordinaryMs: 800, ordinaryReserveMs: 50 }
        : undefined,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let accepted!: RunSnapshot;
    try {
      const attachment = await f.upload();
      f.conversations.beforeDispatch = async () => {
        entered();
        await gate;
      };
      const completion = f.turn(
        "请把附件导入知识库",
        { attachmentIds: [attachment.id] },
        (run) => {
          accepted = run;
        },
      );
      await reached;
      if (stop === "cancel") {
        // Cancellation signals immediately, but its persistence waits behind the gate.
        const cancellation = f.cancel(accepted.id);
        while (!(await f.conversations.cancellationRequested(accepted.id)))
          await Bun.sleep(5);
        release();
        await cancellation;
      } else {
        await Bun.sleep(Math.max(0, accepted.deadline - Date.now() + 20));
        release();
      }
      const result = await completion;
      expect(result.status).toBe(stop === "cancel" ? "canceled" : "timed_out");
      expect(await f.sources.list(f.token)).toHaveLength(0);
    } finally {
      release();
      await f.close();
    }
  }, 30000);
}

test("Wiki restore clarifies when publication changes after selection", async () => {
  const f = await fixture();
  try {
    const original = await f.source("生产日志保留 30 天。");
    while (await f.wiki.workOne(f.token)) {}
    const page = (await f.wiki.list(f.token)).items[0]!;
    const selected = await f.turn("日志保留多久？", {
      pageId: page.id,
      pageVersion: page.version,
    });
    const changed = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "manual.md",
      bytes: Buffer.from("生产日志保留 90 天。"),
      documentId: original.documentId,
      expectedPrior: original.versionId,
    });
    while (
      (await f.sources.inspect(f.token, changed.id)).source === "processing"
    )
      await f.sources.workOne();
    while (await f.wiki.workOne(f.token)) {}
    const restored = await f.turn("请恢复这个主题的上一版：恢复旧步骤。", {
      conversationId: selected.conversationId,
    });
    expect(restored.operations ?? []).toHaveLength(0);
    expect(restored.clarification).toBeDefined();
    expect(
      (await f.wiki.history(f.token, page.id)).items.some(
        (item) => item.reason === "恢复旧步骤。",
      ),
    ).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);
