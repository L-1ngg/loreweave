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
        evidence?: { text: string };
        draft?: { text: string };
      };
      const summary = JSON.stringify(body.system ?? "").includes(
        "You are a context summarization assistant.",
      );
      calls.push({ phase: body.phase ?? (summary ? "summary" : "task"), body });
      options.onRequest?.(body.phase ?? "task");
      const delay = options.delays?.[body.phase ?? "task"] ?? options.delayMs;
      if (delay) await Bun.sleep(delay);
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
      const tool =
        !summary &&
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
                name: "search_evidence",
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
                  partial_json: JSON.stringify(options.toolArguments ?? {}),
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
