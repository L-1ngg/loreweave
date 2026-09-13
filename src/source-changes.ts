import { hash } from "./answer-validation.ts";
import type { ParsedPassage } from "./markdown.ts";
type Block = ParsedPassage & { id: string };
const key = (blocks: Block[], index: number) =>
  hash({
    text: blocks[index]!.text,
    kind: blocks[index]!.kind,
    heading: blocks[index]!.headingPath,
    previous: blocks[index - 1]?.text,
    next: blocks[index + 1]?.text,
  });
/** Equality requires governing context; repeated/uncertain mappings never authorize reuse. */
export function sourceChanges(previous: Block[], current: Block[]) {
  const oldKeys = previous.map((_, index) => key(previous, index)),
    newKeys = current.map((_, index) => key(current, index));
  const priorByKey = new Map<string, Block[]>();
  for (const [index, block] of previous.entries()) {
    const group = priorByKey.get(oldKeys[index]!) ?? [];
    group.push(block);
    priorByKey.set(oldKeys[index]!, group);
  }
  const currentCounts = new Map<string, number>();
  for (const value of newKeys)
    currentCounts.set(value, (currentCounts.get(value) ?? 0) + 1);
  const used = new Set<string>();
  const ranges = current.map((block, index) => {
    const candidates = priorByKey.get(newKeys[index]!) ?? [];
    const unique =
      candidates.length === 1 && currentCounts.get(newKeys[index]!) === 1;
    const prior = unique ? candidates[0] : undefined;
    if (prior) used.add(prior.id);
    return {
      passageId: block.id,
      start: block.start,
      end: block.end,
      contextHash: newKeys[index]!,
      outcome: prior
        ? "unchanged"
        : candidates.length
          ? "uncertain"
          : "added_or_changed",
      ...(prior
        ? {
            previousPassageId: prior.id,
            previousStart: prior.start,
            previousEnd: prior.end,
          }
        : {}),
    };
  });
  return {
    profile: "source-context-diff-v1",
    ranges,
    removedOrChanged: previous
      .filter((block) => !used.has(block.id))
      .map((block) => ({
        passageId: block.id,
        start: block.start,
        end: block.end,
      })),
    requiresCompleteCoverage: true,
  };
}
