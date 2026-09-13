import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { SearchIndexes } from "../src/search-indexes.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
const url = process.env.TEST_DATABASE_URL!;
if (!url) throw new Error("TEST_DATABASE_URL is required");

test("AC29: index build catches concurrent sources, switches one space, and rollback keeps current originals", async () => {
  const access = new AccessService(url);
  await access.migrate();
  const account = {
    organization: `index-${crypto.randomUUID()}`,
    username: "admin",
    password: "index-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const old = new ControlledEmbeddings(),
    next = new ControlledEmbeddings();
  const sources = new SourceService(url, access, old);
  let duringBuild: (() => Promise<void>) | undefined;
  const upgraded = {
    profile: "controlled-new-space",
    dimensions: next.dimensions,
    async embed(texts: string[], signal: AbortSignal) {
      const callback = duringBuild;
      duringBuild = undefined;
      await callback?.();
      return next.embed(texts, signal);
    },
  };
  const newSources = new SourceService(url, access, upgraded);
  const indexes = new SearchIndexes(url, access, upgraded);
  const write = (
    text: string,
    prior?: { documentId: string; versionId: string },
  ) =>
    sources.submit(token, {
      key: crypto.randomUUID(),
      filename: "logs.md",
      bytes: new TextEncoder().encode(text),
      ...(prior
        ? { documentId: prior.documentId, expectedPrior: prior.versionId }
        : {}),
    });
  try {
    const first = await write("日志保留 30 天");
    await sources.workOne({ organizationId: context.organizationId });
    const before = await sources.inspect(token, first.id);
    const accepted = await indexes.rebuild(token, "upgrade-v2");
    expect((await indexes.rebuild(token, "upgrade-v2")).id).toBe(accepted.id);
    expect((await indexes.inspect(token, accepted.id)).state).toBe("building");
    let latest = first;
    duringBuild = async () => {
      latest = await write("日志保留 90 天", first);
      await sources.workOne({ organizationId: context.organizationId });
    };
    await indexes.workOne({ organizationId: context.organizationId });
    expect((await indexes.inspect(token, accepted.id)).state).toBe("active");
    const hits = await newSources.candidates(token, {
      question: "日志",
      signal: AbortSignal.timeout(5000),
    });
    expect(hits.vector.some((hit) => hit.version === latest.versionId)).toBe(
      true,
    );
    expect(hits.vector.some((hit) => hit.version === first.versionId)).toBe(
      false,
    );
    expect((await sources.inspect(token, first.id)).maintenance).toEqual(
      before.maintenance,
    );
    const incompatible = await sources.candidates(token, {
      question: "日志",
      signal: AbortSignal.timeout(5000),
    });
    expect(incompatible.vector).toHaveLength(0);
    expect(incompatible.degradation).toBe("lexical_only:profile_unavailable");
    await indexes.rollback(token, accepted.id);
    const rolled = await sources.candidates(token, {
      question: "日志",
      signal: AbortSignal.timeout(5000),
    });
    expect(rolled.vector.some((hit) => hit.version === latest.versionId)).toBe(
      true,
    );
    expect(
      (await sources.version(token, first.versionId)).passages[0]!.text,
    ).toBe("日志保留 30 天");
  } finally {
    await indexes.close();
    await newSources.close();
    await sources.close();
    await access.close();
  }
}, 15000);

test("AC29: old-profile source activation after cutover exposes degradation until durable catch-up", async () => {
  const access = new AccessService(url);
  await access.migrate();
  const account = {
    organization: `catchup-${crypto.randomUUID()}`,
    username: "admin",
    password: "catchup-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const a = new ControlledEmbeddings(),
    b = {
      ...a,
      profile: "controlled-space-B",
      dimensions: a.dimensions,
      embed: a.embed.bind(a),
    };
  const old = new SourceService(url, access, a),
    current = new SourceService(url, access, b);
  try {
    const first = await old.submit(token, {
      key: "one",
      filename: "logs.md",
      bytes: new TextEncoder().encode("日志保留30天"),
    });
    await old.workOne({ organizationId: context.organizationId });
    const generation = await current.indexes.rebuild(token, "new-space");
    await current.indexes.workOne({ organizationId: context.organizationId });
    const next = await old.submit(token, {
      key: "two",
      filename: "logs.md",
      bytes: new TextEncoder().encode("日志保留90天"),
      documentId: first.documentId,
      expectedPrior: first.versionId,
    });
    await old.workOne({ organizationId: context.organizationId });
    const before = await current.candidates(token, {
      question: "日志",
      signal: AbortSignal.timeout(5000),
    });
    expect(before.vector).toHaveLength(0);
    expect(before.degradation).toBe("partial_lexical_only:index_pending");
    expect(
      (await old.inspect(token, next.id)).maintenance.some(
        (job) => job.kind === "source.index",
      ),
    ).toBe(true);
    await current.indexes.workOne({ organizationId: context.organizationId });
    const after = await current.candidates(token, {
      question: "日志",
      signal: AbortSignal.timeout(5000),
    });
    expect(after.vector.some((hit) => hit.version === next.versionId)).toBe(
      true,
    );
    expect(after.degradation).toBeUndefined();
    await current.indexes.rollback(token, generation.id);
    expect(
      (
        await old.candidates(token, {
          question: "日志",
          signal: AbortSignal.timeout(5000),
        })
      ).vector.some((hit) => hit.version === next.versionId),
    ).toBe(true);
  } finally {
    await current.close();
    await old.close();
    await access.close();
  }
});

test("AC28/29: unchanged index rebuild and catch-up reuse source preparation vectors", async () => {
  const access = new AccessService(url);
  await access.migrate();
  const account = {
    organization: `index-reuse-${crypto.randomUUID()}`,
    username: "admin",
    password: "index-reuse-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const controlled = new ControlledEmbeddings();
  let embedded = 0;
  const sources = new SourceService(url, access, {
    profile: controlled.profile,
    dimensions: controlled.dimensions,
    async embed(texts, signal) {
      embedded += texts.length;
      return controlled.embed(texts, signal);
    },
  });
  try {
    const first = await sources.submit(token, {
      key: "first",
      filename: "logs.md",
      bytes: new TextEncoder().encode("日志保留30天"),
    });
    await sources.workOne({ organizationId: context.organizationId });
    expect(embedded).toBe(1);
    const generation = await sources.indexes.rebuild(token, "same-profile");
    await sources.indexes.workOne({ organizationId: context.organizationId });
    expect((await sources.indexes.inspect(token, generation.id)).state).toBe(
      "active",
    );
    expect(embedded).toBe(1);
    await sources.submit(token, {
      key: "changed",
      filename: "logs.md",
      bytes: new TextEncoder().encode("日志保留90天"),
      documentId: first.documentId,
      expectedPrior: first.versionId,
    });
    await sources.workOne({ organizationId: context.organizationId });
    expect(embedded).toBe(2);
    await sources.indexes.workOne({ organizationId: context.organizationId });
    expect(embedded).toBe(2);
  } finally {
    await sources.close();
    await access.close();
  }
});
