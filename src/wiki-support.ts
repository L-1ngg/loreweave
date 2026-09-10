import { hash, record } from "./answer-validation.ts";
import { Operations, jsonValue, type Job } from "./operations.ts";
import { packetPacks } from "./wiki-packets.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import type {
  TopicDescriptor,
  WikiPack,
  WikiCertificate,
} from "./wiki-types.ts";
/** Exhaustive old-claim/current-packet comparisons authorize retirement; topic routing alone cannot. */
export async function reviewCurrentSupport(
  operations: Operations,
  runtime: WikiModelRuntime,
  job: Job,
  topic: TopicDescriptor,
  pack: WikiPack,
  pageVersion: string,
  scope: string,
  certificates: WikiCertificate[],
  unit = "support",
) {
  const claims = certificates.flatMap((certificate, block) =>
    certificate.draft.claims
      .filter((claim) => claim.role === "fact")
      .map((claim) => ({
        id: `${block}:${claim.id}`,
        text: certificate.draft.text.slice(claim.start, claim.end),
        subject: claim.subject,
        scope: claim.scope,
        conditions: claim.conditions,
        attribution: claim.attribution,
        originals: certificate.evidence
          .filter((item) => claim.handles.includes(item.handle))
          .map((item) => ({
            text: item.text,
            title: item.title,
            headingPath: item.headingPath,
          })),
      })),
  );
  if (!claims.length) throw new Error("needs_attention:missing_claim_manifest");
  const packets = packetPacks(pack, 4000);
  if (!packets.length) packets.push({ ...pack, items: [], hash: hash([]) });
  const selected = new Set<string>(),
    ledger = {
      pageVersion,
      claims: claims.map((claim) => claim.id),
      completed: [] as Array<{
        claimId: string;
        packetHash: string;
        verdict: string;
        coverage: unknown;
      }>,
      remaining: claims.flatMap((claim) =>
        packets.map((packet) => ({
          claimId: claim.id,
          packetHash: packet.hash,
        })),
      ),
    };
  const save = () =>
    operations.checkpoint(job, async (tx) => {
      await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ [unit]: ledger }))}::jsonb WHERE job_id=${job.id}`;
    });
  await save();
  for (const [claimIndex, claim] of claims.entries())
    for (const [index, packet] of packets.entries()) {
      const result = await runtime.request(
        job,
        `${unit}:${claimIndex}:${index}`,
        "support",
        2,
        {
          topic: { ...topic, handles: [] },
          pack: packet,
          pageVersion,
          scope,
          claim,
        },
        (raw) => {
          if (
            !record(raw) ||
            raw.evidenceHash !== packet.hash ||
            raw.pageVersion !== pageVersion ||
            raw.claimId !== claim.id ||
            !["supported", "absent", "unresolved"].includes(
              String(raw.claimVerdict),
            ) ||
            raw.qualifiersChecked !== true ||
            typeof raw.claimReason !== "string" ||
            !raw.claimReason.trim() ||
            !Array.isArray(raw.claimHandles) ||
            raw.claimHandles.some(
              (handle) => !packet.items.some((item) => item.handle === handle),
            ) ||
            (raw.claimVerdict === "supported" && !raw.claimHandles.length) ||
            !Array.isArray(raw.coverage) ||
            raw.coverage.length !== packet.items.length
          )
            throw new Error("invalid_support_coverage");
          const seen = new Set<string>();
          const coverage = raw.coverage.map((entry) => {
            if (
              !record(entry) ||
              typeof entry.handle !== "string" ||
              !packet.items.some((item) => item.handle === entry.handle) ||
              seen.has(entry.handle) ||
              !["support", "context", "unresolved"].includes(
                String(entry.outcome),
              ) ||
              typeof entry.reason !== "string" ||
              !entry.reason.trim()
            )
              throw new Error("invalid_support_coverage");
            seen.add(entry.handle);
            return {
              handle: entry.handle,
              outcome: String(entry.outcome),
              reason: entry.reason,
            };
          });
          return {
            coverage,
            claimHandles: raw.claimHandles as string[],
            verdict: String(raw.claimVerdict),
            reason: raw.claimReason,
          };
        },
      );
      ledger.completed.push({
        claimId: claim.id,
        packetHash: packet.hash,
        verdict: result.verdict,
        coverage: result,
      });
      ledger.remaining.shift();
      await save();
      if (
        result.verdict === "unresolved" ||
        result.coverage.some((entry) => entry.outcome === "unresolved")
      )
        throw new Error("needs_attention:current_support_unresolved");
      for (const handle of result.claimHandles)
        if (result.verdict === "supported") selected.add(handle);
      for (const entry of result.coverage)
        if (entry.outcome === "support") selected.add(entry.handle);
    }
  const items = pack.items.filter((item) => selected.has(item.handle));
  return { ...pack, items, hash: hash(items) };
}
