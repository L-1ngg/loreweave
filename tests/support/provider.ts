export function startProbeProvider(expectedKey?: string) {
  let qaProfile = "answer";
  let failTask: string | undefined;
  let delayMs = 60;
  let qaDelayMs: number | undefined;
  const requests: Array<{
    model: string;
    stream: boolean;
    structured: boolean;
    tools: string[];
    authorized: boolean;
    task?: string;
    question?: string;
    history?: Array<{ role: string; content: unknown }>;
  }> = [];
  let aborted = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions")
        return new Response("Not Found", { status: 404 });
      const body = await request.json();
      let payload: { task?: string; evidence?: any } = {};
      try {
        payload = JSON.parse(
          body.messages.findLast((m: { role: string }) => m.role === "user")
            ?.content ?? "",
        );
      } catch {
        /* capability probe prose */
      }
      const task = payload.task;
      const isQA = body.model === "qa-fixture";
      const responseDelay = isQA ? (qaDelayMs ?? delayMs) : delayMs;
      const originalQuestion = body.messages.findLast(
        (m: { role: string }) => m.role === "user",
      )?.content;
      requests.push({
        model: body.model,
        stream: !!body.stream,
        structured: !!body.response_format,
        tools: (body.tools ?? []).map(
          (t: { function: { name: string } }) => t.function.name,
        ),
        authorized:
          !expectedKey ||
          request.headers.get("authorization") === `Bearer ${expectedKey}`,
        task,
        question: isQA ? originalQuestion : undefined,
        history: isQA ? body.messages : undefined,
      });
      const requestNumber = requests.length;
      request.signal.addEventListener("abort", () => aborted++, { once: true });
      if (!requests.at(-1)!.authorized)
        return Response.json(
          { error: { message: "fixture_auth_rejected" } },
          { status: 401 },
        );
      const base = {
        id: `fixture-${requestNumber}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
      };
      let object: unknown = { value: 42 };
      let qaCall: { name: string; arguments: string } | undefined;
      if (isQA) {
        const lastUser = body.messages.findLastIndex(
          (m: { role: string }) => m.role === "user",
        );
        const results = body.messages
          .slice(lastUser + 1)
          .filter((m: { role: string }) => m.role === "tool")
          .flatMap((m: { content: string }) => {
            try {
              return [JSON.parse(m.content)];
            } catch {
              return [];
            }
          });
        const system = body.messages.findLast(
          (m: { role: string; content: string }) =>
            m.role === "system" && m.content.includes('"pins"'),
        );
        let binding: any = {};
        try {
          binding = JSON.parse(system?.content ?? "{}");
        } catch {
          /* policy prose */
        }
        const call = (name: string, args: unknown) => {
          qaCall = { name, arguments: JSON.stringify(args) };
        };
        const browse = results.find((r: any) => r.items);
        const selected =
          binding.scope?.mode === "selected"
            ? binding.scope.documentIds
            : undefined;
        const ids: string[] =
          selected ??
          browse?.items.filter((d: any) => d.ready).map((d: any) => d.id) ??
          [];
        const filter = /\[document:([^\]]+)\]/.exec(
          String(originalQuestion),
        )?.[1];
        if (!selected && !browse)
          call("browse_documents", {
            limit: 20,
            ...(filter ? { filter } : {}),
          });
        else if (qaProfile === "clarification")
          object = {
            outcome: "clarification",
            text: "有多份可能的文档，请指定要查询的报告。",
          };
        else {
          for (const id of ids) {
            const doc = results.find(
              (r: any) => r.documentId === id && r.provenance,
            );
            if (!doc) {
              call("get_document", { documentId: id });
              break;
            }
            if (
              doc.pageCount > 20 &&
              !results.some((r: any) => r.documentId === id && r.nodes)
            ) {
              call("get_document_structure", {
                documentId: id,
                versionId: doc.versionId,
                limit: 20,
              });
              break;
            }
            if (!results.some((r: any) => r.documentId === id && r.pages)) {
              call("get_page_content", {
                documentId: id,
                versionId: doc.versionId,
                pages: [Math.min(2, doc.pageCount)],
              });
              break;
            }
          }
          if (!qaCall) {
            const reads = results.filter((r: any) => r.pages);
            object =
              qaProfile === "evidence_gap"
                ? {
                    outcome: "evidence_gap",
                    text: "已读页面没有支持该事实，不能断言整份文档没有此信息。",
                  }
                : {
                    outcome: "answer",
                    text: reads
                      .map(
                        (r: any) =>
                          `Acme 2026 revenue was 120 million USD, domestic operations only. [${r.name} · p${r.pages[0].page}](cite:${qaProfile === "invalid_citation" ? crypto.randomUUID() : r.pages[0].referenceId})`,
                      )
                      .join("\n\n"),
                  };
            if (!reads.length)
              object = {
                outcome: "incomplete",
                text: "当前没有可问答文档；未完成原文阅读。",
              };
          }
        }
      }
      if (task === "printed_toc") {
        const entries = payload.evidence.pages.flatMap((p: { text: string }) =>
          p.text.split("\n").flatMap((line: string) => {
            const m = /^(.*?)\s*\.{3,}\s*(\d+|[ivxlcdm]+)\s*$/i.exec(line);
            return m ? [{ title: m[1].trim(), label: m[2], depth: 0 }] : [];
          }),
        );
        object = { usable: !!entries.length, entries };
      }
      if (task === "no_toc") {
        const headings = payload.evidence.pages.flatMap(
          (p: { page: number; text: string }) =>
            p.text
              .split("\n")
              .filter((line: string) =>
                /^(?:Annual Report|\d+(?:\.\d+)*\s|Appendix|Regional Operating Details)/.test(
                  line,
                ),
              )
              .map((line: string) => ({
                title: line,
                anchor: line,
                page: p.page,
                depth: /^Annual Report/.test(line)
                  ? 0
                  : /^\d+\.\d/.test(line)
                    ? 2
                    : 1,
              })),
        );
        if (!headings.length) {
          const p = payload.evidence.pages[0];
          const anchor =
            p.text
              .split("\n")
              .find(
                (line: string) =>
                  line.trim() && !/LOREWEAVE|Physical page/.test(line),
              ) ?? "";
          headings.push({
            title: `Section: ${anchor.slice(0, 100)}`,
            anchor,
            page: p.page,
            depth: 0,
          });
        }
        object = { headings };
      }
      if (task?.startsWith("summarize"))
        object = {
          summary: (
            payload.evidence.pages
              ?.map((p: { text: string }) => p.text)
              .join("\n") ??
            payload.evidence.summaries?.join("\n") ??
            ""
          ).slice(0, 1100),
        };
      if (task === "subdivide") {
        const p = payload.evidence.pages[0];
        const anchor =
          p.text
            .split("\n")
            .find(
              (line: string) =>
                line.trim() && !/LOREWEAVE|Physical page/.test(line),
            ) ?? "";
        object = {
          headings: [
            {
              title: `Section: ${anchor.slice(0, 100)}`,
              anchor,
              page: p.page,
              depth: 0,
            },
          ],
        };
      }
      if (failTask && task === failTask) object = { invalid: true };
      if (!body.stream)
        return Response.json({
          ...base,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(object),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      const read = isQA
        ? !qaCall
        : !!body.response_format ||
          body.messages.some((m: { role: string }) => m.role === "tool");
      const stream = new ReadableStream({
        async start(controller) {
          const send = (delta: unknown, finish_reason: string | null = null) =>
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
              ),
            );
          try {
            if (!read && body.tools?.length) {
              await Bun.sleep(responseDelay);
              if (request.signal.aborted) {
                controller.close();
                return;
              }
              send({
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `fixture-call-${requestNumber}`,
                    type: "function",
                    function: {
                      name: qaCall?.name ?? body.tools[0].function.name,
                      arguments: qaCall?.arguments ?? "{}",
                    },
                  },
                ],
              });
              send({}, "tool_calls");
            } else {
              send({ role: "assistant", content: "" });
              const json = JSON.stringify(object);
              const pieces = body.response_format
                ? isQA
                  ? [json.slice(0, 40), json.slice(40, 80), json.slice(80)]
                  : [json]
                : ["The ", "value ", "is ", "42."];
              for (const content of pieces) {
                await Bun.sleep(responseDelay);
                if (request.signal.aborted) break;
                send({ content });
              }
              send({}, "stop");
            }
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`,
              ),
            );
            controller.close();
          } catch {
            aborted++;
          }
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
  return {
    server,
    url: `${server.url}v1`,
    requests,
    setExpectedKey(value: string) {
      expectedKey = value;
    },
    failOnTask(value?: string) {
      failTask = value;
    },
    setQAProfile(value: string) {
      qaProfile = value;
    },
    setDelay(value: number) {
      delayMs = value;
    },
    setQADelay(value?: number) {
      qaDelayMs = value;
    },
    get aborted() {
      return aborted;
    },
  };
}
