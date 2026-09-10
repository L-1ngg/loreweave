import MarkdownIt from "markdown-it";
import React from "react";
const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
parser.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]!,
    alt = parser.utils.escapeHtml(token.content),
    url = String(token.attrGet("src") ?? "");
  return parser.validateLink(url)
    ? `<span>图片：${alt}（<a href="${parser.utils.escapeHtml(url)}" rel="noreferrer">图片链接</a>）</span>`
    : `<span>图片：${alt}</span>`;
};
export function markdownContext(text: string): Record<string, unknown> {
  const context = {};
  parser.parse(text, context);
  return context;
}
/** Raw HTML is disabled and images never create network requests. */
export function Markdown({
  text,
  context = {},
}: {
  text: string;
  context?: Record<string, unknown>;
}) {
  return (
    <div dangerouslySetInnerHTML={{ __html: parser.render(text, context) }} />
  );
}
