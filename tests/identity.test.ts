import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { IdentityService } from "../src/identity.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
async function fixture() {
  const access = new AccessService(url!);
  await access.migrate();
  const account = {
    organization: `identity-${crypto.randomUUID()}`,
    username: "admin",
    password: "identity-test-password",
  };
  await access.bootstrap(account);
  const { token } = await access.login(account);
  const sources = new SourceService(url!, access, new ControlledEmbeddings());
  const identities = new IdentityService(url!, access, sources);
  return {
    token,
    access,
    sources,
    identities,
    async source(filename: string, text: string, projectId?: string) {
      const operation = await sources.submit(token, {
        key: crypto.randomUUID(),
        filename,
        bytes: new TextEncoder().encode(text),
        ...(projectId ? { projectId } : {}),
      });
      await sources.workOne();
      return sources.version(token, operation.versionId);
    },
    async close() {
      await identities.close();
      await sources.close();
      await access.close();
    },
  };
}
test("same-named mentions remain independently addressable and never merge by name alone", async () => {
  const f = await fixture();
  try {
    const a = await f.source("alpha.md", "Atlas 提供订单服务。"),
      b = await f.source("beta.md", "Atlas 提供支付服务。");
    const first = await f.identities.record(f.token, {
      version: a.version,
      passageId: a.passages[0]!.id,
      label: "Atlas",
    });
    const second = await f.identities.record(f.token, {
      version: b.version,
      passageId: b.passages[0]!.id,
      label: "Atlas",
    });
    expect(first.id).not.toBe(second.id);
    expect(first.canonicalId).not.toBe(second.canonicalId);
    expect(first.outcome).toBe("distinct");
    expect(
      (
        await f.identities.record(f.token, {
          version: a.version,
          passageId: a.passages[0]!.id,
          label: "Atlas",
        })
      ).id,
    ).toBe(first.id);
    expect((await f.identities.inspect(f.token, first.id)).mention.text).toBe(
      "Atlas",
    );
  } finally {
    await f.close();
  }
});

test("explicit equivalence carries transitive original proof and becomes ineligible before reconciliation", async () => {
  const f = await fixture();
  try {
    const a = await f.source("a.md", "A 提供订单服务。"),
      b = await f.source("b.md", "B 提供支付接口。"),
      c = await f.source("c.md", "C 提供通知接口。");
    const ab = await f.source("ab.md", "“B”与“A”指同一实体。"),
      bc = await f.source("bc.md", "“C”与“B”指同一实体。");
    const mentions = [];
    for (const [source, label] of [
      [a, "A"],
      [b, "B"],
      [c, "C"],
    ] as const)
      mentions.push(
        await f.identities.record(f.token, {
          version: source.version,
          passageId: source.passages[0]!.id,
          label,
        }),
      );
    const linkedB = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: mentions[1]!.id,
      targetId: mentions[0]!.id,
      expectedRevision: mentions[1]!.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [{ version: ab.version, passageId: ab.passages[0]!.id }],
        },
      ],
    });
    const linkedC = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: mentions[2]!.id,
      targetId: mentions[1]!.id,
      expectedRevision: mentions[2]!.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [{ version: bc.version, passageId: bc.passages[0]!.id }],
        },
      ],
    });
    expect(linkedB.canonicalId).toBe(mentions[0]!.canonicalId);
    expect(linkedC.canonicalId).toBe(mentions[0]!.canonicalId);
    expect(linkedC.valid).toBe(true);
    expect(
      linkedC.proofs
        .flatMap((proof) => proof.sources)
        .some((ref) => ref.version === ab.version),
    ).toBe(true);
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "ab.md",
      bytes: new TextEncoder().encode("此前的身份等价声明已撤销。"),
      documentId: ab.id,
      expectedPrior: ab.version,
    });
    await f.sources.workOne();
    expect((await f.identities.inspect(f.token, linkedB.id)).valid).toBe(false);
    expect((await f.identities.inspect(f.token, linkedC.id)).valid).toBe(false);
    expect((await f.identities.inspect(f.token, mentions[0]!.id)).valid).toBe(
      true,
    );
  } finally {
    await f.close();
  }
});

test("independent alternative witnesses preserve a binding and evidenced correction advances revisions without losing mentions", async () => {
  const f = await fixture();
  try {
    const a = await f.source("a.md", "A 提供订单服务。"),
      b = await f.source("b.md", "B 提供支付接口。"),
      c = await f.source("c.md", "C 提供通知接口。");
    const ab = await f.source("ab.md", "“B”与“A”指同一实体。"),
      alternative = await f.source("alternate.md", "“B”与“A”指同一实体。"),
      bc = await f.source("bc.md", "“B”与“C”指同一实体。");
    const mentions = [];
    for (const [source, label] of [
      [a, "A"],
      [b, "B"],
      [c, "C"],
    ] as const)
      mentions.push(
        await f.identities.record(f.token, {
          version: source.version,
          passageId: source.passages[0]!.id,
          label,
        }),
      );
    const linked = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: mentions[1]!.id,
      targetId: mentions[0]!.id,
      expectedRevision: mentions[1]!.revisionId,
      witnesses: [ab, alternative].map((source) => ({
        kind: "equivalence",
        sources: [
          { version: source.version, passageId: source.passages[0]!.id },
        ],
      })),
    });
    await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "ab.md",
      bytes: new TextEncoder().encode("不再提供身份等价证据。"),
      documentId: ab.id,
      expectedPrior: ab.version,
    });
    await f.sources.workOne();
    const surviving = await f.identities.inspect(f.token, linked.id);
    expect(surviving.valid).toBe(true);
    expect(surviving.proofs.filter((proof) => proof.valid)).toHaveLength(1);
    const corrected = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: linked.id,
      targetId: mentions[2]!.id,
      expectedRevision: linked.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [{ version: bc.version, passageId: bc.passages[0]!.id }],
        },
      ],
    });
    expect(corrected.canonicalId).toBe(mentions[2]!.canonicalId);
    expect(corrected.revision).toBe(3);
    expect(corrected.mention).toEqual(linked.mention);
    expect(
      (await f.identities.history(f.token, linked.id)).map(
        (item) => item.revision,
      ),
    ).toEqual([1, 2, 3]);
    expect(corrected.affected).toContain(linked.id);
  } finally {
    await f.close();
  }
});

test("source activation reconciles every affected binding in durable batches of twenty", async () => {
  const f = await fixture();
  try {
    const original = await f.source(
      "objects.md",
      Array.from({ length: 25 }, (_, i) => `Object${i} 是一个独立对象。`).join(
        "\n\n",
      ),
    );
    const ids = [];
    for (let i = 0; i < 25; i++)
      ids.push(
        (
          await f.identities.record(f.token, {
            version: original.version,
            passageId: original.passages[i]!.id,
            label: `Object${i}`,
          })
        ).id,
      );
    const update = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "objects.md",
      bytes: new TextEncoder().encode("这些旧提及已撤回。"),
      documentId: original.id,
      expectedPrior: original.version,
    });
    await f.sources.workOne();
    let report;
    for (let i = 0; i < 2000; i++) {
      report = await f.identities.workOne();
      if (report?.operationId === update.id) break;
    }
    expect(report?.processed).toBe(20);
    expect(report?.complete).toBe(false);
    await f.identities.close();
    const replacement = new IdentityService(url!, f.access, f.sources);
    try {
      for (let i = 0; i < 2000; i++) {
        report = await replacement.workOne();
        if (report?.operationId === update.id && report.complete) break;
      }
      expect(report?.processed).toBe(5);
      expect(report?.complete).toBe(true);
      for (const id of ids) {
        const identity = await replacement.inspect(f.token, id);
        expect(identity.outcome).toBe("unresolved");
        expect(identity.revision).toBe(2);
        expect(identity.valid).toBe(false);
      }
      const operation = await f.sources.inspect(f.token, update.id);
      expect(
        operation.maintenance.filter((job) => job.kind === "wiki.identity"),
      ).toHaveLength(2);
      expect(
        operation.maintenance.filter((job) => job.kind === "graph.identity"),
      ).toHaveLength(2);
    } finally {
      await replacement.close();
    }
  } finally {
    await f.close();
  }
}, 30000);

test("reliable source identifiers unify automatically only inside their identifier scope", async () => {
  const f = await fixture();
  try {
    const a = await f.source("a.md", "“Alpha”的service-id为“svc-123”。"),
      b = await f.source("b.md", "“Beta”的service-id为“svc-123”。");
    const first = await f.identities.record(f.token, {
      version: a.version,
      passageId: a.passages[0]!.id,
      label: "Alpha",
    });
    const second = await f.identities.record(f.token, {
      version: b.version,
      passageId: b.passages[0]!.id,
      label: "Beta",
    });
    expect(second.canonicalId).toBe(first.canonicalId);
    expect(second.outcome).toBe("confirmed");
    expect(second.proofs[0]?.kind).toBe("identifier");
    const project = await f.access.createProject(f.token, "Other project");
    const scoped = await f.source(
      "scoped.md",
      "“Gamma”的service-id为“svc-123”。",
      project.id,
    );
    const third = await f.identities.record(f.token, {
      version: scoped.version,
      passageId: scoped.passages[0]!.id,
      label: "Gamma",
    });
    expect(third.canonicalId).not.toBe(first.canonicalId);
    expect(third.outcome).toBe("distinct");
  } finally {
    await f.close();
  }
});

test("unchanged explicit equivalence in a new revision is revalidated while a second update supersedes older work", async () => {
  const f = await fixture();
  try {
    const a = await f.source("a.md", "A 提供订单服务。"),
      b = await f.source("b.md", "B 提供支付接口。"),
      proof = await f.source("proof.md", "“B”与“A”指同一实体。");
    const first = await f.identities.record(f.token, {
        version: a.version,
        passageId: a.passages[0]!.id,
        label: "A",
      }),
      second = await f.identities.record(f.token, {
        version: b.version,
        passageId: b.passages[0]!.id,
        label: "B",
      });
    const linked = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: second.id,
      targetId: first.id,
      expectedRevision: second.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            { version: proof.version, passageId: proof.passages[0]!.id },
          ],
        },
      ],
    });
    let update = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "proof.md",
      bytes: new TextEncoder().encode("“B”与“A”指同一实体。\n\n补充记录。"),
      documentId: proof.id,
      expectedPrior: proof.version,
    });
    await f.sources.workOne();
    const skipped = update;
    update = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "proof.md",
      bytes: new TextEncoder().encode("“B”与“A”指同一实体。\n\n再次补充记录。"),
      documentId: proof.id,
      expectedPrior: update.versionId,
    });
    await f.sources.workOne();
    expect((await f.identities.inspect(f.token, linked.id)).valid).toBe(false);
    for (let i = 0; i < 2000; i++) {
      const report = await f.identities.workOne();
      if (!report) break;
    }
    const refreshed = await f.identities.inspect(f.token, linked.id);
    expect(refreshed.valid).toBe(true);
    expect(refreshed.canonicalId).toBe(first.canonicalId);
    expect(refreshed.revision).toBe(3);
    expect(
      refreshed.proofs
        .flatMap((item) => item.sources)
        .some((source) => source.version === update.versionId),
    ).toBe(true);
    expect(
      (await f.sources.inspect(f.token, skipped.id)).maintenance.find(
        (job) => job.kind === "identity.revalidate",
      )?.state,
    ).toBe("superseded");
  } finally {
    await f.close();
  }
}, 30000);

test("expired identity worker cannot publish after a replacement consumes its activation event", async () => {
  const { Operations } = await import("../src/operations.ts");
  const f = await fixture(),
    operations = new Operations(url!);
  try {
    // Drain events through the public worker before isolating this activation.
    while (await f.identities.workOne()) {}
    const source = await f.source("a.md", "A 提供服务。");
    const stale = await operations.claim(["identity.revalidate"], 10);
    expect(stale).toBeDefined();
    await Bun.sleep(20);
    await f.identities.workOne();
    let effect = false;
    await expect(
      operations.commit(stale!, async () => {
        effect = true;
      }),
    ).rejects.toThrow("stale_worker");
    expect(effect).toBe(false);
    const mention = await f.identities.record(f.token, {
      version: source.version,
      passageId: source.passages[0]!.id,
      label: "A",
    });
    expect(mention.valid).toBe(true);
  } finally {
    await operations.close();
    await f.close();
  }
});

test("transitive revalidation converges even when children sort before their proof parents", async () => {
  const f = await fixture();
  try {
    const source = await f.source(
      "mentions.md",
      "A 是一个服务。\n\nB 是一个服务。\n\nC 是一个服务。",
    );
    const mentions = [];
    for (const [index, label] of ["A", "B", "C"].entries())
      mentions.push(
        await f.identities.record(f.token, {
          version: source.version,
          passageId: source.passages[index]!.id,
          label,
        }),
      );
    mentions.sort((a, b) => b.id.localeCompare(a.id));
    const [root, middle, child] = mentions;
    const text = `“${middle!.mention.text}”与“${root!.mention.text}”指同一实体。\n\n“${child!.mention.text}”与“${middle!.mention.text}”指同一实体。`;
    const proof = await f.source("proof.md", text);
    await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: middle!.id,
      targetId: root!.id,
      expectedRevision: middle!.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            { version: proof.version, passageId: proof.passages[0]!.id },
          ],
        },
      ],
    });
    await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: child!.id,
      targetId: middle!.id,
      expectedRevision: child!.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            { version: proof.version, passageId: proof.passages[1]!.id },
          ],
        },
      ],
    });
    const update = await f.sources.submit(f.token, {
      key: crypto.randomUUID(),
      filename: "proof.md",
      bytes: new TextEncoder().encode(text + "\n\n新增备注。"),
      documentId: proof.id,
      expectedPrior: proof.version,
    });
    await f.sources.workOne();
    for (let i = 0; i < 2000; i++) if (!(await f.identities.workOne())) break;
    const resolved = await f.identities.inspect(f.token, child!.id);
    expect(resolved.valid).toBe(true);
    expect(resolved.canonicalId).toBe(root!.canonicalId);
    expect(
      resolved.proofs
        .flatMap((item) => item.sources)
        .some((ref) => ref.version === update.versionId),
    ).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);

test("identity correction durably revalidates unchanged-source dependents without duplicate retries", async () => {
  const f = await fixture();
  try {
    const source = await f.source(
      "objects.md",
      "A 提供服务。\n\nB 提供服务。\n\nC 提供服务。\n\nD 提供服务。",
    );
    const mentions = [];
    for (const [index, label] of ["A", "B", "C", "D"].entries())
      mentions.push(
        await f.identities.record(f.token, {
          version: source.version,
          passageId: source.passages[index]!.id,
          label,
        }),
      );
    const proof = await f.source(
      "proof.md",
      "“B”与“A”指同一实体。\n\n“C”与“B”指同一实体。\n\n“B”与“D”指同一实体。",
    );
    const linkedB = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: mentions[1]!.id,
      targetId: mentions[0]!.id,
      expectedRevision: mentions[1]!.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            { version: proof.version, passageId: proof.passages[0]!.id },
          ],
        },
      ],
    });
    const linkedC = await f.identities.bind(f.token, {
      key: crypto.randomUUID(),
      mentionId: mentions[2]!.id,
      targetId: mentions[1]!.id,
      expectedRevision: mentions[2]!.revisionId,
      witnesses: [
        {
          kind: "equivalence",
          sources: [
            { version: proof.version, passageId: proof.passages[1]!.id },
          ],
        },
      ],
    });
    const correction = {
      key: crypto.randomUUID(),
      mentionId: linkedB.id,
      targetId: mentions[3]!.id,
      expectedRevision: linkedB.revisionId,
      witnesses: [
        {
          kind: "equivalence" as const,
          sources: [
            { version: proof.version, passageId: proof.passages[2]!.id },
          ],
        },
      ],
    };
    const corrected = await f.identities.bind(f.token, correction);
    expect((await f.identities.inspect(f.token, linkedC.id)).valid).toBe(false);
    for (let i = 0; i < 2000; i++) if (!(await f.identities.workOne())) break;
    const resolved = await f.identities.inspect(f.token, linkedC.id);
    expect(resolved.valid).toBe(true);
    expect(resolved.canonicalId).toBe(mentions[3]!.canonicalId);
    expect(resolved.revision).toBe(3);
    expect((await f.identities.bind(f.token, correction)).revisionId).toBe(
      corrected.revisionId,
    );
    for (let i = 0; i < 2000; i++) if (!(await f.identities.workOne())) break;
    expect(
      (await f.identities.history(f.token, linkedC.id)).map(
        (item) => item.revision,
      ),
    ).toEqual([1, 2, 3]);
  } finally {
    await f.close();
  }
}, 30000);
