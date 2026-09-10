import type { EvidencePack } from "../evidence.ts";
import type { Claim, Draft, Review } from "../answer-validation.ts";
import { lexicalText } from "../indexing.ts";
/** Extractive development oracle only. Online semantic quality requires a configured model. */
export function scriptedDraft(pack: EvidencePack) {
  const words = lexicalText(pack.question)
    .split(" ")
    .filter((word) => word.length > 1);
  const direct = pack.items.filter((item) =>
    words.some((word) => item.text.toLowerCase().includes(word)),
  );
  const scopeNotes = pack.items.filter(
    (item) =>
      direct.some((candidate) => candidate.version === item.version) &&
      /以下规定|仅适用|仅限|除外/.test(item.text),
  );
  const relevant = [
    ...scopeNotes,
    ...direct.filter((item) => !scopeNotes.includes(item)),
  ];
  const claims: Claim[] = [];
  let text = "";
  for (const item of relevant) {
    const sentence = `《${item.title}》记载：${item.text.trim()}`;
    const start = text.length + (text ? 1 : 0),
      nextText = text + (text ? "\n" : "") + sentence;
    const claim: Claim = {
      id: `c${claims.length + 1}`,
      start,
      end: nextText.length,
      role: "fact",
      handles: [item.handle],
      subject: item.title,
      scope: item.headingPath.join(" / ") || "该来源的陈述范围",
      conditions: [],
      attribution: "source",
      premises: [],
    };
    if (
      new TextEncoder().encode(
        JSON.stringify({ text: nextText, claims: [...claims, claim] }),
      ).length > 1150
    )
      break;
    text = nextText;
    claims.push(claim);
  }
  if (claims.length && claims.length < relevant.length) {
    const start = text.length + 1;
    text += "\n仅列出部分来源，其他内容尚未完整覆盖。";
    claims.push({
      id: "gap",
      start,
      end: text.length,
      role: "gap",
      handles: [],
      subject: "",
      scope: "",
      conditions: [],
      attribution: "source",
      premises: [],
    });
  }
  if (!claims.length) {
    text = "本次检索未取得足够依据，无法确定答案。";
    claims.push({
      id: "gap",
      start: 0,
      end: text.length,
      role: "gap",
      handles: [],
      subject: "",
      scope: "",
      conditions: [],
      attribution: "source",
      premises: [],
    });
  }
  return { text, claims };
}
export function scriptedReview(pack: EvidencePack, draft: Draft): Review {
  const expected = scriptedDraft(pack);
  const unlistedClaims =
    draft.claims.some((claim) => claim.role !== "fact") &&
    draft.text !== expected.text
      ? ["Unverified non-factual role"]
      : [];
  return {
    draftHash: draft.hash,
    evidenceHash: pack.hash,
    unlistedClaims,
    claims: draft.claims.map((claim) => {
      const text = draft.text.slice(claim.start, claim.end),
        item = pack.items.find((item) => claim.handles.includes(item.handle));
      const supported =
        claim.role === "fact"
          ? Boolean(
              item &&
              text === `《${item.title}》记载：${item.text.trim()}` &&
              expected.claims.some((expectedClaim) =>
                expectedClaim.handles.includes(item.handle),
              ),
            )
          : expected.claims.some(
              (expectedClaim) =>
                expectedClaim.role === claim.role &&
                text ===
                  expected.text.slice(expectedClaim.start, expectedClaim.end),
            );
      return {
        id: claim.id,
        verdict: supported ? "supported" : "insufficient",
        standalone: supported,
        reason: supported
          ? "Exact attributed original text under the fixture oracle"
          : "Not an exact supported fixture statement",
        spans: item
          ? [{ handle: item.handle, start: 0, end: item.text.length }]
          : [],
      };
    }),
  };
}
