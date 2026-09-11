import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { AccessService } from "./access.ts";
import type { ExternalKnowledge } from "./external-knowledge.ts";

const question = z
  .object({
    question: z.string().trim().min(1).max(8000),
    projectId: z.string().uuid().optional(),
    complex: z.boolean().optional(),
  })
  .strict();
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Stateless MCP over standard Request/Response; each request rechecks its bearer. */
export function mcpHandler(
  access: AccessService,
  knowledge: ExternalKnowledge,
) {
  return async (request: Request): Promise<Response> => {
    const admittedAt = Date.now();
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      (origin && origin !== url.origin)
    )
      return Response.json({ error: "forbidden" }, { status: 403 });
    const token =
      request.headers
        .get("authorization")
        ?.match(/^Bearer (lw_[0-9a-f]{64})$/)?.[1] ?? "";
    try {
      await beforeDeadline(
        AbortSignal.any([
          request.signal,
          AbortSignal.timeout(Math.max(0, admittedAt + 30000 - Date.now())),
        ]),
        async () => {
          await access.externalIdentity(token);
          await access.authorize(token, "read");
        },
      );
    } catch (error) {
      const reason = safeReason(error);
      return Response.json(
        { error: reason },
        {
          status:
            reason === "unauthorized"
              ? 401
              : reason === "budget_exhausted"
                ? 408
                : 503,
        },
      );
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const server = new McpServer({ name: "loreweave", version: "1.0.0" });
    server.registerResource(
      "original_passage",
      new ResourceTemplate("loreweave://source/{version}#{passageId}", {
        list: undefined,
      }),
      {
        description:
          "Immutable original passage, with current/historical status and applicability.",
        mimeType: "application/json",
      },
      async (uri, variables) => {
        try {
          const ref = z
            .object({
              version: z.string().uuid(),
              passageId: z.string().uuid(),
            })
            .parse(variables);
          const original = await knowledge.original(
            token,
            ref.version,
            ref.passageId,
          );
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(original),
              },
            ],
          };
        } catch (error) {
          throw new McpError(ErrorCode.InvalidParams, safeReason(error));
        }
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    for (const [name, execute] of [
      ["evidence_search", knowledge.search.bind(knowledge)],
      ["question_answer", knowledge.answer.bind(knowledge)],
    ] as const) {
      server.registerTool(
        name,
        {
          description:
            name === "evidence_search"
              ? "Retrieve current original evidence with immutable citations and explicit coverage gaps."
              : "Answer an independent question with reviewed original citations under the shared run budget.",
          inputSchema: question,
          outputSchema: z.object({ schemaVersion: z.literal(1) }).passthrough(),
          annotations,
        },
        async (input) => {
          try {
            const signal = AbortSignal.any([
              request.signal,
              AbortSignal.timeout(
                Math.max(
                  0,
                  admittedAt + (input.complex ? 60000 : 30000) - Date.now(),
                ),
              ),
            ]);
            const result = await beforeDeadline(
              signal,
              async () =>
                await execute(
                  token,
                  {
                    question: input.question,
                    ...(input.projectId ? { projectId: input.projectId } : {}),
                    ...(input.complex !== undefined
                      ? { complex: input.complex }
                      : {}),
                  },
                  signal,
                ),
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            const reason = safeReason(error);
            return {
              isError: true,
              content: [{ type: "text", text: reason }],
              structuredContent: { schemaVersion: 1, error: reason },
            };
          }
        },
      );
    }
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError")
    return "budget_exhausted";
  if (error instanceof Error && error.name === "AbortError") return "canceled";
  if (error instanceof z.ZodError) return "invalid_input";
  return error instanceof Error &&
    [
      "unauthorized",
      "invalid_input",
      "not_found",
      "source_changed",
      "retrieval_unavailable",
      "budget_exhausted",
      "canceled",
    ].includes(error.message)
    ? error.message
    : "unavailable";
}

/** Release the response on abort; domain work retains its own settlement accounting. */
async function beforeDeadline<T>(
  signal: AbortSignal,
  execute: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([execute(), stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
