import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";
const tokenizer = Jieba.withDict(dict);
/** Search-only derivation. Evidence always resolves to the original passage. */
export function lexicalText(text: string): string {
  return [
    ...new Set(
      [
        ...tokenizer
          .cut(text, false)
          .filter((term) => /[\p{L}\p{N}]/u.test(term)),
        ...(text.match(/[A-Za-z0-9]+(?:[._:/+-][A-Za-z0-9]+)*/g) ?? []),
      ].map((term) => term.toLowerCase()),
    ),
  ].join(" ");
}
