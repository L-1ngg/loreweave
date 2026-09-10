import { scriptedStructure } from "./wiki-structure-model.ts";
import type { Draft, Claim, Review } from "../answer-validation.ts";
import type {
  WikiModel,
  WikiPhase,
  TopicDescriptor,
  TopicExtraction,
  WikiPack,
  WikiCandidate,
} from "../wiki-types.ts";
/** Deterministic topic fixtures; not semantic routing or model-quality evidence. */
export class ScriptedWikiModel implements WikiModel {
  readonly profile = "scripted-wiki-v1";
  readonly calls: Array<{ phase: WikiPhase; input: Record<string, unknown> }> =
    [];
  async request(
    phase: WikiPhase,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    this.calls.push({ phase, input: structuredClone(input) });
    if (phase === "structure" || phase === "structure_review")
      return scriptedStructure(phase, input);
    const pack = input.pack as WikiPack;
    if (phase === "extraction") return extract(pack);
    const topic = input.topic as TopicDescriptor;
    if (phase === "conflicts")
      return {
        evidenceHash: pack.hash,
        pairs: (input.left as string[]).flatMap((left) =>
          (input.right as string[]).map((right) => {
            const a = pack.items.find((item) => item.handle === left)!,
              b = pack.items.find((item) => item.handle === right)!;
            return {
              left,
              right,
              verdict: fixtureConflict(a.text, b.text)
                ? "conflict"
                : "compatible",
              scopeChecked: true,
              reason: "Controlled comparison retaining both original scopes",
            };
          }),
        ),
      };
    if (phase === "support")
      return {
        claimId: (input.claim as { id: string }).id,
        claimVerdict: pack.items.some((item) =>
          (input.claim as { text: string }).text.includes(item.text.trim()),
        )
          ? "supported"
          : "absent",
        qualifiersChecked: true,
        claimReason:
          "Controlled comparison of each retained claim and original scope",
        claimHandles: pack.items
          .filter((item) =>
            (input.claim as { text: string }).text.includes(item.text.trim()),
          )
          .map((item) => item.handle),
        evidenceHash: pack.hash,
        pageVersion: input.pageVersion,
        coverage: pack.items.map((item) => ({
          handle: item.handle,
          outcome: (
            topic.subjectKey.startsWith("rule:")
              ? item.text.includes(`规则 ${topic.subjectKey.slice(5)}：`)
              : item.text.includes(topic.subjectKey) ||
                extract({ ...pack, items: [item] }).topics.some(
                  (candidate) => candidate.subjectKey === topic.subjectKey,
                )
          )
            ? "support"
            : "context",
          reason: "Controlled fixture subject and applicable original scope",
        })),
      };
    if (phase === "planning") {
      const candidates = input.candidates as WikiCandidate[];
      const matched = candidates.find(
        (candidate) =>
          (candidate.projectId ?? "shared") === input.scope &&
          candidate.descriptor.subjectKey === topic.subjectKey &&
          candidate.descriptor.aspectKey === topic.aspectKey,
      );
      const decision = matched
        ? {
            action: "update",
            pageId: matched.id,
            reason:
              "Matching fixture subject, reader question and applicable scope",
          }
        : {
            action: "create",
            reason:
              "Independent supported fixture question without an inspected compatible topic",
          };
      return {
        ...decision,
        contribution: {
          handles: topic.handles,
          claim:
            pack.items
              .find((item) => topic.handles.includes(item.handle))
              ?.text.slice(0, 100) ?? "",
          question: topic.question,
          substantive: true,
        },
        assessments: candidates.map((candidate, index) => [
          index,
          [
            candidate.descriptor.subjectKey === topic.subjectKey,
            candidate.descriptor.aspectKey === topic.aspectKey,
            (candidate.projectId ?? "shared") === input.scope,
            candidate.descriptor.aspectKey === topic.aspectKey,
          ],
          [],
          [],
          [],
          "fixture",
        ]),
      };
    }
    if (phase === "generation") return draft(pack, topic);
    if (phase === "review") {
      const supplied = input.draft as Draft,
        expected = draft(pack, topic);
      const correct =
        JSON.stringify({ text: supplied.text, claims: supplied.claims }) ===
        JSON.stringify(expected);
      const result: Review = {
        draftHash: supplied.hash,
        evidenceHash: pack.hash,
        unlistedClaims: [],
        claims: supplied.claims.map((claim) => ({
          id: claim.id,
          verdict: correct ? "supported" : "insufficient",
          standalone: correct,
          reason: correct
            ? "Fixture topic label and exact attributed originals"
            : "Not the fixture-supported complete text",
          spans: claim.handles.map((handle) => ({
            handle,
            start: 0,
            end: pack.items.find((item) => item.handle === handle)!.text.length,
          })),
        })),
      };
      return result;
    }
    return {
      relevant: (input.window as Array<{ text: string; kind: string }>).flatMap(
        (range, index) =>
          range.kind === "original" &&
          !(topic.subjectKey.startsWith("rule:")
            ? range.text.includes(`规则 ${topic.subjectKey.slice(5)}：`)
            : range.text.includes(topic.subjectKey.slice(0, 2)))
            ? []
            : [
                {
                  range: index,
                  start: 0,
                  end: Math.min(range.text.length, 80),
                },
              ],
      ),
      windowHash: input.windowHash,
      complete: true,
      reason: "Complete controlled fixture ranges",
      remaining: [],
    };
  }
}
export function extract(
  pack: WikiPack,
  separateTopics = false,
): TopicExtraction {
  const groups = new Map<string, TopicDescriptor>();
  const coverage: TopicExtraction["coverage"] = [];
  for (const item of pack.items) {
    const key = /日志/.test(item.text)
      ? "日志保留"
      : /发布|部署/.test(item.text)
        ? "发布安排"
        : /备份/.test(item.text)
          ? "备份规则"
          : undefined;
    if (!key) {
      coverage.push({
        handle: item.handle,
        topicIndexes: [],
        outcome: item.text.trim().length < 8 ? "context" : "unresolved",
      });
      continue;
    }
    let topic = groups.get(key);
    if (!topic) {
      topic = {
        title: key,
        aliases: [],
        subjectKey: key,
        aspectKey: "规则与适用条件",
        question: `${key}有哪些要求和适用条件？`,
        inclusion: "原文明确陈述的规则及其适用条件",
        exclusion: "原文没有说明的推断",
        handles: [],
        identities: [],
        identityRequired: false,
      };
      groups.set(key, topic);
    }
    topic.handles.push(item.handle);
    coverage.push({
      handle: item.handle,
      topicIndexes: [[...groups.keys()].indexOf(key)],
      outcome: "assigned",
    });
  }
  if (
    !separateTopics &&
    groups.size > 1 &&
    pack.items.some((item) => item.headingPath.includes("运维总览"))
  )
    return {
      topics: [
        {
          ...groups.values().next().value!,
          title: "运维规则",
          subjectKey: "运维规则",
          question: "日常运维有哪些规则？",
          handles: [...groups.values()].flatMap((topic) => topic.handles),
        },
      ],
      coverage: coverage.map((entry) => ({
        ...entry,
        topicIndexes: entry.outcome === "assigned" ? [0] : [],
      })),
    };
  return { topics: [...groups.values()], coverage };
}
function draft(pack: WikiPack, topic: TopicDescriptor) {
  const claims: Claim[] = [];
  let text = `# ${topic.title}`;
  claims.push({
    id: "title",
    start: 0,
    end: text.length,
    role: "fact",
    handles: pack.items.map((item) => item.handle),
    subject: topic.subjectKey,
    scope: "主题目录标签",
    conditions: [],
    attribution: "source",
    premises: [],
  });
  for (const item of pack.items) {
    const start = text.length + 2;
    text += `\n\n《${item.title}》：${item.text.trim()}`;
    claims.push({
      id: `c${claims.length}`,
      start,
      end: text.length,
      role: "fact",
      handles: [item.handle],
      subject: item.title,
      scope: item.headingPath.join(" / ") || "该来源的适用范围",
      conditions: [],
      attribution: "source",
      premises: [],
    });
  }
  if (
    pack.items.some((a, index) =>
      pack.items.slice(index + 1).some((b) => fixtureConflict(a.text, b.text)),
    )
  ) {
    const start = text.length + 2;
    text +=
      "\n\n来源分歧尚未解决：上述来源陈述了不同的日志保留期限；请结合各自适用范围判断。";
    claims.push({
      id: "conflict",
      start,
      end: text.length,
      role: "fact",
      handles: pack.items.map((item) => item.handle),
      subject: topic.subjectKey,
      scope: "上述来源各自的适用范围",
      conditions: [],
      attribution: "inference",
      premises: claims
        .filter((claim) => claim.id !== "title")
        .map((claim) => claim.id),
    });
  }
  return { text, claims };
}
function fixtureConflict(a: string, b: string) {
  const duration = (text: string) => text.match(/日志保留\s*(\d+)\s*天/)?.[1];
  const scope = (text: string) =>
    text.match(/(?:区域|环境)\s*\d+/)?.[0] ?? text.match(/生产|测试/)?.[0];
  return Boolean(
    duration(a) &&
    duration(b) &&
    duration(a) !== duration(b) &&
    !(scope(a) && scope(b) && scope(a) !== scope(b)),
  );
}
