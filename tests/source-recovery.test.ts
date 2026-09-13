import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");

test("AC12: a killed source worker resumes completed embedding batches and preserves the acceptance deadline", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `checkpoint-${crypto.randomUUID()}`,
    username: "admin",
    password: "checkpoint-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const embedded: number[] = [];
  const embeddings = new ControlledEmbeddings();
  const sources = new SourceService(url!, access, {
    profile: embeddings.profile,
    dimensions: embeddings.dimensions,
    async embed(texts, signal) {
      embedded.push(texts.length);
      return embeddings.embed(texts, signal);
    },
  });
  const operation = await sources.submit(token, {
    key: crypto.randomUUID(),
    filename: "batches.md",
    bytes: new TextEncoder().encode(
      Array.from(
        { length: 70 },
        (_, i) => `Paragraph ${i}: ${"x".repeat(600)}.`,
      ).join("\n\n"),
    ),
  });
  const deadline = (await sources.preparation(token, operation.id)).deadline;
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `
    import {AccessService} from './src/access.ts'; import {SourceService} from './src/sources.ts'; import {ControlledEmbeddings} from './src/development/embeddings.ts';
    const a = new AccessService(process.env.TEST_DATABASE_URL); const e = new ControlledEmbeddings(); let calls=0;
    const s = new SourceService(process.env.TEST_DATABASE_URL,a,{ profile:e.profile,dimensions:e.dimensions,async embed(texts,signal){ if(++calls===2){console.log('checkpoint-ready');await Bun.sleep(60000);} return e.embed(texts,signal); }});
    await s.workOne({leaseMs:300,organizationId:process.env.CHECKPOINT_ORGANIZATION}); await s.close();await a.close();
  `,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CHECKPOINT_ORGANIZATION: context.organizationId },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    const reader = child.stdout.getReader();
    const ready = await Promise.race([
      reader.read(),
      Bun.sleep(5000).then(() => {
        throw new Error("checkpoint_worker_timeout");
      }),
    ]);
    expect(new TextDecoder().decode(ready.value)).toContain("checkpoint-ready");
    expect(
      (await sources.preparation(token, operation.id)).completedBatches,
    ).toBe(1);
    expect((await sources.inspect(token, operation.id)).source).toBe(
      "processing",
    );
    child.kill("SIGKILL");
    await child.exited;
    await Bun.sleep(400);
    await sources.workOne({ organizationId: context.organizationId });
    expect((await sources.inspect(token, operation.id)).source).toBe(
      "searchable",
    );
    expect((await sources.preparation(token, operation.id)).deadline).toBe(
      deadline,
    );
    expect(embedded).toEqual([32, 6]);
    const version = await sources.version(token, operation.versionId);
    expect(version.passages).toHaveLength(70);
    expect(
      version.passages.every(
        (passage) =>
          version.text.slice(passage.start, passage.end) === passage.text,
      ),
    ).toBe(true);
  } finally {
    child.kill();
    await child.exited;
    await sources.close();
    await access.close();
  }
}, 15000);

test("AC27: structural search hits expose bounded exact original subranges for CRLF code and non-BMP text", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `chunks-${crypto.randomUUID()}`,
    username: "admin",
    password: "chunks-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const controlled = new ControlledEmbeddings();
  const inputs: string[] = [];
  const sources = new SourceService(url!, access, {
    profile: controlled.profile,
    dimensions: controlled.dimensions,
    async embed(texts, signal) {
      inputs.push(...texts);
      return controlled.embed(texts, signal);
    },
  });
  try {
    const text =
      "# 配置\r\n\r\n```ts\r\n" +
      Array.from(
        { length: 100 },
        (_, i) => `const value${i} = "👩🏽‍💻 中文";\r\n`,
      ).join("") +
      "const UNIQUE_IDENTIFIER = 42;\r\n```\r\n\r\n|项目|说明|\r\n|---|---|\r\n|A|原始表格|\r\n";
    const operation = await sources.submit(token, {
      key: crypto.randomUUID(),
      filename: "code.md",
      bytes: new TextEncoder().encode(text),
    });
    await sources.workOne();
    expect((await sources.inspect(token, operation.id)).source).toBe(
      "searchable",
    );
    expect(inputs.length).toBeGreaterThan(1);
    expect(
      inputs.every((input) => new TextEncoder().encode(input).length <= 768),
    ).toBe(true);
    const result = await sources.candidates(token, {
      question: "UNIQUE_IDENTIFIER",
      signal: AbortSignal.timeout(5000),
    });
    const hit = result.lexical.find((item) =>
      item.text.includes("UNIQUE_IDENTIFIER"),
    )!;
    expect(hit).toBeDefined();
    expect(hit.text.length).toBeLessThan(768);
    expect(text.slice(hit.start, hit.end)).toBe(hit.text);
    expect((await sources.validateReferences(token, [hit])).valid).toBe(true);
    expect(
      (
        await sources.validateReferences(token, [
          { ...hit, start: hit.start + 1 },
        ])
      ).valid,
    ).toBe(false);
    const version = await sources.version(token, operation.versionId);
    expect(
      version.passages.every((p) => text.slice(p.start, p.end) === p.text),
    ).toBe(true);
  } finally {
    await sources.close();
    await access.close();
  }
});

test("AC28: concurrent identical inputs deduplicate, no-op reuses vectors, and a governing heading change invalidates affected inputs", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `reuse-${crypto.randomUUID()}`,
    username: "admin",
    password: "reuse-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const controlled = new ControlledEmbeddings();
  let texts = 0;
  const embeddings = {
    profile: controlled.profile,
    dimensions: controlled.dimensions,
    async embed(input: string[], signal: AbortSignal) {
      texts += input.length;
      await Bun.sleep(20);
      return controlled.embed(input, signal);
    },
  };
  const a = new SourceService(url!, access, embeddings),
    b = new SourceService(url!, access, embeddings);
  const bytes = new TextEncoder().encode("# Production\n\nLogs stay 30 days.");
  try {
    const [first, second] = await Promise.all([
      a.submit(token, { key: crypto.randomUUID(), filename: "a.md", bytes }),
      b.submit(token, { key: crypto.randomUUID(), filename: "b.md", bytes }),
    ]);
    await Promise.all([
      a.workOne({ organizationId: context.organizationId }),
      b.workOne({ organizationId: context.organizationId }),
    ]);
    expect((await a.inspect(token, first.id)).source).toBe("searchable");
    expect((await b.inspect(token, second.id)).source).toBe("searchable");
    expect(texts).toBe(1);
    const unchanged = await a.submit(token, {
      key: crypto.randomUUID(),
      filename: "a.md",
      bytes,
      documentId: first.documentId,
      expectedPrior: first.versionId,
    });
    await a.workOne({ organizationId: context.organizationId });
    expect(texts).toBe(1);
    await a.submit(token, {
      key: crypto.randomUUID(),
      filename: "a.md",
      bytes: new TextEncoder().encode("# Staging\n\nLogs stay 30 days."),
      documentId: first.documentId,
      expectedPrior: unchanged.versionId,
    });
    await a.workOne({ organizationId: context.organizationId });
    expect(texts).toBe(2);
  } finally {
    await a.close();
    await b.close();
    await access.close();
  }
});

for (const state of ["completed", "uncertain"] as const) {
  test(`AC28: legacy index cache ${state} inputs preserve reuse and quarantine after profile unification`, async () => {
    const postgres = (await import("postgres")).default;
    const { hash } = await import("../src/answer-validation.ts");
    const { chunkerProfile } = await import("../src/retrieval-chunks.ts");
    const { controlledInputCounter } =
      await import("../src/embedding-tokenizer.ts");
    const { ModelAdmission } = await import("../src/model-admission.ts");
    const sql = postgres(url!);
    const access = new AccessService(url!);
    await access.migrate();
    const account = {
      organization: `legacy-cache-${crypto.randomUUID()}`,
      username: "admin",
      password: "legacy-cache-password",
    };
    await access.bootstrap(account);
    const { token } = await access.login(account);
    const context = await access.authorize(token, "read");
    const controlled = new ControlledEmbeddings();
    let embedded = 0;
    const sources = new SourceService(url!, access, {
      profile: controlled.profile,
      dimensions: controlled.dimensions,
      async embed(texts, signal) {
        embedded += texts.length;
        return controlled.embed(texts, signal);
      },
    });
    const admission = new ModelAdmission(url!);
    const requestId = crypto.randomUUID();
    const partition = hash({
      organization: context.organizationId,
      project: null,
      role: "document",
    });
    const bytes = new TextEncoder().encode("日志保留30天");
    const write = () =>
      sources.submit(token, {
        key: crypto.randomUUID(),
        filename: "logs.md",
        bytes,
      });
    try {
      await write();
      await sources.workOne({ organizationId: context.organizationId });
      expect(embedded).toBe(1);
      // Persisted pre-upgrade cache fixture: index work used this older namespace.
      await sql`UPDATE embedding_cache SET profile=${`${controlled.profile}:${chunkerProfile}:${controlledInputCounter.profile}`} WHERE partition=${partition}`;
      if (state === "uncertain") {
        const operationId = crypto.randomUUID();
        await sql`UPDATE embedding_cache SET state='reserved',vector=NULL,completed_at=NULL,request_operation=${operationId} WHERE partition=${partition}`;
        await sql`INSERT INTO model_requests(id,operation_id,input_hash,owner,priority,state,deadline,provider_key) VALUES(${requestId},${operationId},'legacy-input',${crypto.randomUUID()},'background','uncertain',clock_timestamp()+interval '1 minute','controlled-legacy-provider')`;
      }
      const next = await write();
      await sources.workOne({ organizationId: context.organizationId });
      expect(embedded).toBe(1);
      expect((await sources.inspect(token, next.id)).source).toBe(
        state === "completed" ? "searchable" : "failed",
      );
      if (state === "uncertain") {
        expect(
          (await admission.status()).requests.find(
            (row) => row.id === requestId,
          )?.state,
        ).toBe("uncertain");
        await admission.reconcile(requestId, {
          kind: "provider-terminated",
          reference: "legacy controlled fixture confirms old request ended",
        });
        const retried = await write();
        await sources.workOne({ organizationId: context.organizationId });
        expect((await sources.inspect(token, retried.id)).source).toBe(
          "searchable",
        );
        expect(embedded).toBe(2);
      }
    } finally {
      if (
        (await admission.status()).requests.some(
          (row) => row.id === requestId && row.state === "uncertain",
        )
      )
        await admission.reconcile(requestId, {
          kind: "provider-terminated",
          reference: "legacy controlled fixture cleanup",
        });
      await admission.close();
      await sources.close();
      await access.close();
      await sql.end();
    }
  });
}

test("AC33: accepted source preparation keeps its configured absolute deadline across restart and expires in queue", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `source-deadline-${crypto.randomUUID()}`,
    username: "admin",
    password: "source-deadline-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const context = await access.authorize(token, "read");
  const controlled = new ControlledEmbeddings();
  let requests = 0;
  const embeddings = {
    profile: controlled.profile,
    dimensions: controlled.dimensions,
    async embed(texts: string[], signal: AbortSignal) {
      requests++;
      return controlled.embed(texts, signal);
    },
  };
  const sources = new SourceService(url!, access, embeddings, undefined, 50);
  const resumed = new SourceService(url!, access, embeddings, undefined, 60000);
  const input = {
    key: "deadline",
    filename: "logs.md",
    bytes: new TextEncoder().encode("日志保留30天"),
  };
  try {
    const start = Date.now();
    const accepted = await sources.submit(token, input);
    const deadline = (await sources.preparation(token, accepted.id)).deadline;
    expect(new Date(deadline).getTime()).toBeGreaterThanOrEqual(start);
    expect(new Date(deadline).getTime()).toBeLessThanOrEqual(Date.now() + 50);
    const duplicate = await resumed.submit(token, input);
    expect(duplicate.id).toBe(accepted.id);
    expect((await resumed.preparation(token, accepted.id)).deadline).toBe(
      deadline,
    );
    await Bun.sleep(Math.max(0, new Date(deadline).getTime() - Date.now()) + 5);
    await resumed.workOne({ organizationId: context.organizationId });
    expect((await resumed.inspect(token, accepted.id)).source).toBe("failed");
    expect((await resumed.inspect(token, accepted.id)).reason).toBe(
      "preparation_deadline",
    );
    expect(requests).toBe(0);
  } finally {
    await resumed.close();
    await sources.close();
    await access.close();
  }
});
