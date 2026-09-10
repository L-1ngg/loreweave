import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
async function setup() {
  const access = new AccessService(url!);
  await access.migrate();
  const organization = `sources-${crypto.randomUUID()}`;
  const account = {
    organization,
    username: "admin",
    password: "source-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  return { access, token, organization };
}
test("accepted Markdown survives worker restart and becomes searchable with durable downstream work and immutable originals", async () => {
  const { SourceService } = await import("../src/sources.ts");
  const { ControlledEmbeddings } =
    await import("../src/development/embeddings.ts");
  const { access, token } = await setup();
  const first = new SourceService(url!, access, new ControlledEmbeddings());
  const bytes = new TextEncoder().encode(
    "# 运维\r\n\r\n应用日志保留 30 天。\r\n",
  );
  const input = { key: crypto.randomUUID(), filename: "ops.md", bytes };
  let second: InstanceType<typeof SourceService> | undefined;
  try {
    const accepted = await first.submit(token, input);
    expect(accepted.source).toBe("processing");
    expect(await first.searchRecords(token)).toHaveLength(0);
    await first.close();
    second = new SourceService(url!, access, new ControlledEmbeddings());
    expect((await second.submit(token, input)).id).toBe(accepted.id);
    await expect(
      second.submit(token, {
        ...input,
        bytes: new TextEncoder().encode("changed"),
      }),
    ).rejects.toThrow("version_conflict");
    await second.workOne();
    const ready = await second.inspect(token, accepted.id);
    expect(ready.source).toBe("searchable");
    expect(ready.maintenance.map((job) => job.kind).sort()).toEqual([
      "graph.refresh",
      "identity.revalidate",
      "wiki.refresh",
    ]);
    expect(ready.maintenance.every((job) => job.state === "queued")).toBe(true);
    const original = await second.version(token, ready.versionId);
    expect(original.text).toBe(new TextDecoder().decode(bytes));
    expect(await second.original(token, ready.versionId)).toEqual(bytes);
    expect(original.passages.length).toBe(2);
    expect(
      await second.resolve(token, ready.versionId, original.passages[1]!.id),
    ).toEqual(original.passages[1]!);
    expect((await second.searchRecords(token)).length).toBeGreaterThan(0);
    expect((await second.submit(token, input)).id).toBe(accepted.id);
    expect(await second.workOne()).toBe(false);
  } finally {
    await second?.close();
    await first.close();
    await access.close();
  }
});

test("revision races retain old references and only one expected-version update activates", async () => {
  const { SourceService } = await import("../src/sources.ts");
  const { ControlledEmbeddings } =
    await import("../src/development/embeddings.ts");
  const { access, token } = await setup();
  const sources = new SourceService(url!, access, new ControlledEmbeddings());
  const encode = (text: string) => new TextEncoder().encode(text);
  try {
    const first = await sources.submit(token, {
      key: crypto.randomUUID(),
      filename: "same.md",
      bytes: encode("日志保留 30 天"),
    });
    await sources.workOne();
    const old = await sources.version(token, first.versionId);
    const update = {
      filename: "renamed.md",
      documentId: first.documentId,
      expectedPrior: first.versionId,
    };
    const a = await sources.submit(token, {
      ...update,
      key: crypto.randomUUID(),
      bytes: encode("日志保留 60 天"),
    });
    const b = await sources.submit(token, {
      ...update,
      key: crypto.randomUUID(),
      bytes: encode("日志保留 90 天"),
    });
    expect(await sources.current(token, first.versionId)).toBe(true);
    await Promise.all([sources.workOne(), sources.workOne()]);
    const outcomes = await Promise.all([
      sources.inspect(token, a.id),
      sources.inspect(token, b.id),
    ]);
    expect(outcomes.map((o) => o.source).sort()).toEqual([
      "failed",
      "searchable",
    ]);
    expect(outcomes.find((o) => o.source === "failed")!.reason).toBe(
      "version_conflict",
    );
    expect(await sources.current(token, first.versionId)).toBe(false);
    expect(
      await sources.resolve(token, first.versionId, old.passages[0]!.id),
    ).toEqual(old.passages[0]!);
    expect(
      (await sources.searchRecords(token)).every(
        (r) => r.version_id !== first.versionId,
      ),
    ).toBe(true);
    expect(
      outcomes.find((o) => o.source === "failed")!.maintenance,
    ).toHaveLength(0);
    const unrelated = await sources.submit(token, {
      key: crypto.randomUUID(),
      filename: "same.md",
      bytes: encode("另一份来源"),
    });
    expect(unrelated.documentId).not.toBe(first.documentId);
    await sources.workOne();
  } finally {
    await sources.close();
    await access.close();
  }
});

test("parse, embedding and activation failures never expose partial source records or invalidate the old source", async () => {
  const { SourceService } = await import("../src/sources.ts");
  const { ControlledEmbeddings } =
    await import("../src/development/embeddings.ts");
  const { access, token } = await setup();
  const good = new SourceService(url!, access, new ControlledEmbeddings());
  const bad = new SourceService(url!, access, {
    profile: "bad",
    dimensions: 8,
    async embed() {
      return [[NaN]];
    },
  });
  // pgvector rejects >16000 dimensions inside the activation transaction.
  const activationFailure = new SourceService(url!, access, {
    profile: "oversized",
    dimensions: 16001,
    async embed(texts) {
      return texts.map(() => Array(16001).fill(1));
    },
  });
  try {
    const first = await good.submit(token, {
      key: crypto.randomUUID(),
      filename: "rule.md",
      bytes: new TextEncoder().encode("original"),
    });
    await good.workOne();
    for (const [worker, bytes, reason] of [
      [good, new Uint8Array([0xff]), "invalid_encoding"],
      [bad, new TextEncoder().encode("bad vectors"), "invalid_embedding"],
      [
        activationFailure,
        new TextEncoder().encode("rollback activation"),
        "unavailable",
      ],
    ] as const) {
      const operation = await worker.submit(token, {
        key: crypto.randomUUID(),
        filename: "rule.md",
        bytes,
        documentId: first.documentId,
        expectedPrior: first.versionId,
      });
      await worker.workOne();
      const result = await worker.inspect(token, operation.id);
      expect(result.source).toBe("failed");
      expect(result.reason).toBe(reason);
      expect(result.maintenance).toHaveLength(0);
      expect(await worker.current(token, first.versionId)).toBe(true);
      expect(
        (await worker.searchRecords(token)).every(
          (r) => r.version_id === first.versionId,
        ),
      ).toBe(true);
      await expect(worker.version(token, operation.versionId)).rejects.toThrow(
        "not_found",
      );
    }
  } finally {
    await good.close();
    await bad.close();
    await activationFailure.close();
    await access.close();
  }
});

test("conversation attachment import yields a durable operation receipt without answer-generation claims", async () => {
  const { SourceService } = await import("../src/sources.ts");
  const { ControlledEmbeddings } =
    await import("../src/development/embeddings.ts");
  const { KnowledgeHost } = await import("../src/host.ts");
  const { PostgresConversations } = await import("../src/conversations.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const { access, token } = await setup();
  const sources = new SourceService(url!, access, new ControlledEmbeddings()),
    conversations = new PostgresConversations(url!);
  const provider = startScriptedProvider();
  const host = new KnowledgeHost({
    access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    imports: sources,
  });
  try {
    const attachment = await sources.upload(token, {
      filename: "企业.md",
      bytes: new TextEncoder().encode("# 企业知识\n日志保留 60 天"),
    });
    const run = await host.start({
      credential: token,
      question: "请把附件导入知识库",
      attachmentIds: [attachment.id],
    });
    await host.settled(run.id);
    const result = await host.get(run.id, token);
    expect(result.status).toBe("answered");
    expect(result.operations).toHaveLength(1);
    expect(result.counts.generation).toBe(0);
    expect(result.counts.review).toBe(0);
    expect((await sources.inspect(token, result.operations![0]!)).source).toBe(
      "processing",
    );
    await sources.workOne();
    expect((await sources.inspect(token, result.operations![0]!)).source).toBe(
      "searchable",
    );
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await sources.close();
    await access.close();
  }
});

test("source and attachment access stays organization-bound while project classification only filters current search", async () => {
  const { SourceService } = await import("../src/sources.ts");
  const { ControlledEmbeddings } =
    await import("../src/development/embeddings.ts");
  const { access, token, organization } = await setup(),
    foreign = await setup();
  const sources = new SourceService(url!, access, new ControlledEmbeddings());
  try {
    const a = await access.createProject(token, "A"),
      b = await access.createProject(token, "B");
    const attachment = await sources.upload(token, {
      filename: "b.md",
      bytes: new TextEncoder().encode("项目 B 内容"),
      projectId: b.id,
    });
    await expect(
      sources.attachment(token, attachment.id, a.id),
    ).rejects.toThrow("not_found");
    await expect(
      sources.attachment(foreign.token, attachment.id),
    ).rejects.toThrow("not_found");
    const operation = await sources.importAttachment(
      token,
      attachment.id,
      crypto.randomUUID(),
      b.id,
    );
    await sources.workOne();
    expect(await sources.searchRecords(token, a.id)).toHaveLength(0);
    expect(await sources.searchRecords(token, b.id)).toHaveLength(1);
    expect(await sources.searchRecords(foreign.token)).toHaveLength(0);
    expect((await sources.version(token, operation.versionId)).text).toContain(
      "项目 B",
    );
    await expect(
      sources.version(foreign.token, operation.versionId),
    ).rejects.toThrow("not_found");
    await expect(sources.inspect(foreign.token, operation.id)).rejects.toThrow(
      "not_found",
    );
    await access.createMember(token, {
      username: "reader",
      password: "reader-test-password",
      grants: ["read"],
    });
    const reader = await access.login({
      organization,
      username: "reader",
      password: "reader-test-password",
    });
    await expect(
      sources.upload(reader.token, {
        filename: "denied.md",
        bytes: new TextEncoder().encode("denied"),
      }),
    ).rejects.toThrow("unauthorized");
    await access.revoke(token);
    await expect(
      sources.submit(token, {
        key: crypto.randomUUID(),
        filename: "revoked.md",
        bytes: new TextEncoder().encode("rejected"),
      }),
    ).rejects.toThrow("unauthorized");
  } finally {
    await sources.close();
    await access.close();
    await foreign.access.close();
  }
});

test("negative and interrogative attachment instructions never accept an import", async () => {
  const { SourceService } = await import("../src/sources.ts");
  const { ControlledEmbeddings } =
    await import("../src/development/embeddings.ts");
  const { KnowledgeHost } = await import("../src/host.ts");
  const { PostgresConversations } = await import("../src/conversations.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const { access, token } = await setup(),
    sources = new SourceService(url!, access, new ControlledEmbeddings());
  const conversations = new PostgresConversations(url!),
    provider = startScriptedProvider();
  const host = new KnowledgeHost({
    access,
    conversations,
    providerUrl: provider.url,
    sources: new FixtureSources(),
    imports: sources,
  });
  try {
    const attachment = await sources.upload(token, {
      filename: "do-not-import.md",
      bytes: new TextEncoder().encode("来源内容"),
    });
    for (const question of [
      "不要导入附件",
      "这个文件可以导入吗？",
      "Do not import this file",
      "请把附件导入知识库？",
    ]) {
      const run = await host.start({
        credential: token,
        question,
        attachmentIds: [attachment.id],
      });
      await host.settled(run.id);
      const result = await host.get(run.id, token);
      expect(result.operations ?? []).toHaveLength(0);
      expect(result.answer?.text).toContain("未导入");
    }
    expect(await sources.list(token)).toHaveLength(0);
  } finally {
    await host.close();
    provider.stop();
    await conversations.close();
    await sources.close();
    await access.close();
  }
});
