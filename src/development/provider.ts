import { scriptedDraft, scriptedReview } from "./evidence-model.ts";
import type { EvidencePack } from "../evidence.ts";
import type { Draft } from "../answer-validation.ts";
/** Local, credential-free scripted HTTP provider for bootstrap development only. */
export interface ScriptedOptions {
  toolArguments?: Record<string, unknown>;
  repeatTool?: boolean;
  delayMs?: number;
  delays?: Record<string, number>;
  onRequest?: (phase: string) => void;
  rejectReviews?: number;
  failTasks?: number;
}
export function startScriptedProvider(options: ScriptedOptions = {}) {
  const calls: Array<{ phase: string; body: unknown }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        system?: unknown;
        messages?: Array<{ role: string; content: unknown }>;
        phase?: string;
        pack?: EvidencePack;
        evidence?: { text: string };
        draft?: Draft;
      };
      const summary = JSON.stringify(body.system ?? "").includes(
        "You are a context summarization assistant.",
      );
      calls.push({ phase: body.phase ?? (summary ? "summary" : "task"), body });
      options.onRequest?.(body.phase ?? "task");
      const delay = options.delays?.[body.phase ?? "task"] ?? options.delayMs;
      if (delay) await Bun.sleep(delay);
      if (body.pack && body.phase === "generation")
        return Response.json(scriptedDraft(body.pack));
      if (body.pack && body.phase === "review" && body.draft)
        return Response.json(scriptedReview(body.pack, body.draft));
      if (body.phase === "generation")
        return Response.json({ text: `证据表明：${body.evidence?.text} [1]` });
      if (body.phase === "review")
        return Response.json({
          supported:
            calls.filter((call) => call.phase === "review").length >
              (options.rejectReviews ?? 0) &&
            body.draft?.text === `证据表明：${body.evidence?.text} [1]`,
        });
      const count = calls.filter((call) => call.phase === "task").length;
      if (!body.phase && !summary && count <= (options.failTasks ?? 0))
        return Response.json(
          {
            type: "error",
            error: { type: "overloaded_error", message: "overloaded" },
          },
          { status: 529 },
        );
      const messages = body.messages ?? [];
      const questionIndex = messages.findLastIndex(
        (message) =>
          message.role === "user" &&
          (typeof message.content === "string" ||
            (Array.isArray(message.content) &&
              message.content.some((block) => block.type === "text"))),
      );
      const content = messages[questionIndex]?.content;
      const latest =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((block) => block.type === "text")
                .map((block) => String(block.text))
                .join("\n")
            : "";
      const attachment = latest
        .split("Supplied attachment IDs:")[1]
        ?.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        )?.[0];
      const instruction =
        latest.split("\nSupplied attachment IDs:")[0]?.trim() ?? "";
      // This provider is a deterministic fixture, not an intent classifier.
      // Only explicitly supported affirmative commands may trigger a real write.
      const importing = Boolean(
        attachment &&
        /^(?:(?:请)?(?:把|将)?附件导入(?:到)?知识库[。！!]?|(?:please )?import (?:the )?attachment[.!]?)$/i.test(
          instruction,
        ),
      );
      const correction = instruction.match(/^请纠正「([^」]+)」[：:]\s*(.+)$/s);
      const preference = instruction.match(/^请记住整理偏好[：:]\s*(.+)$/s);
      const contribution = correction
        ? { kind: "fact", target: correction[1], text: correction[2] }
        : preference
          ? { kind: "guidance", text: preference[1] }
          : undefined;
      const tool =
        !summary &&
        (!attachment || importing) &&
        (options.repeatTool ||
          !JSON.stringify(messages.slice(Math.max(0, questionIndex))).includes(
            '"tool_result"',
          ));
      const events = [
        {
          type: "message_start",
          message: {
            id: `fixture-${count}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: tool
            ? {
                type: "tool_use",
                id: `call-${count}`,
                name: importing
                  ? "import_markdown"
                  : contribution
                    ? "contribute_knowledge"
                    : "search_evidence",
                input: {},
              }
            : {
                type: "text",
                text: "Exploration text is not the product answer.",
              },
        },
        ...(tool
          ? [
              {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(
                    options.toolArguments ??
                      (importing
                        ? { attachmentId: attachment }
                        : (contribution ?? {})),
                  ),
                },
              },
            ]
          : []),
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: {
            stop_reason: tool ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: { output_tokens: 5 },
        },
        { type: "message_stop" },
      ];
      return new Response(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  return { url: server.url.toString(), calls, stop: () => server.stop(true) };
}
