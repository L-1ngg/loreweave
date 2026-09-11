/** Supported development utterances. Only the current user message can authorize a write. */
export type SourceIntent = { kind: "new" | "update"; target?: string };
export interface ConversationContext {
  sourceVersion?: string;
  pageId?: string;
  pageVersion?: string;
  pageCurrentVersion?: string;
  pending?: {
    intent: SourceIntent;
    attachmentId: string;
    candidates: Array<{
      documentId: string;
      versionId: string;
      title: string;
      projectId: string | null;
      project: string;
    }>;
  };
}
export function sourceIntent(text: string): SourceIntent | undefined {
  const input = text.trim().replace(/[。！!]$/, "");
  if (
    /^(?:请)?(?:把|将)?附件(?:作为新文档导入|导入(?:到)?知识库)$/.test(input) ||
    /^(?:please )?import (?:the )?attachment$/i.test(input)
  )
    return { kind: "new" };
  const update = input.match(
    /^(?:请)?(?:用附件)?(?:更新|替换)(?:「([^」]+)」|这个文档|这份文档|该文档|那个项目的手册)$/,
  );
  if (update)
    return { kind: "update", ...(update[1] ? { target: update[1] } : {}) };
  return undefined;
}

export function sourceChoice(text: string): number | undefined {
  const match = text.trim().match(/^(?:请)?选择第?([1-9][0-9]?)个[。！!]?$/);
  return match ? Number(match[1]) - 1 : undefined;
}

export function wikiIntent(text: string):
  | {
      kind: "fact" | "guidance";
      text: string;
      target?: string;
      selected?: boolean;
    }
  | undefined {
  const input = text.trim();
  const fact = input.match(/^请纠正(?:「([^」]+)」|这个主题)[：:]\s*(.+)$/s);
  if (fact)
    return {
      kind: "fact" as const,
      text: fact[2]!,
      ...(fact[1] ? { target: fact[1] } : { selected: true }),
    };
  const guidance = input.match(
    /^请(?:记住整理偏好|保留整理偏好)[：:]\s*(.+)$/s,
  );
  if (guidance) return { kind: "guidance" as const, text: guidance[1]! };
  if (
    /^(?:请)?保留(?:原来|旧)的?步骤结构[。！!？?]?$/.test(input) &&
    !/[？?]$/.test(input)
  )
    return { kind: "guidance" as const, text: input, selected: true };
  return undefined;
}
export function restoreIntent(text: string) {
  const match = text
    .trim()
    .match(/^请恢复这个主题(?:的)?(上一版|所选历史版本)[：:]\s*(.+)$/s);
  return match
    ? { previous: match[1] === "上一版", reason: match[2]! }
    : undefined;
}
