import { AsyncLocalStorage } from "node:async_hooks";
import {
  createMCPServer,
  resourceDefinition,
  type MCPToolContext,
} from "@tanstack/ai-mcp/server";
import { z } from "zod";
import { type Actor } from "./access";
import { requireMcp, authorizeMcp } from "./tokens";
import {
  readingDefinitions,
  browseDocuments,
  getDocument,
  getStructure,
  getPages,
} from "./reading";
import { resolveVersion } from "./library";
import { fail, httpBoundary } from "./errors";
import { toolDefinition } from "@tanstack/ai";
import { independentQuestion } from "./knowledge";
import {
  independentQuestionInput,
  independentAnswerSchema,
} from "../contracts/knowledge";

// ai-mcp 0.6.0's resource callback has neither URI nor request context.
// Carry only the verified caller and requested URI across its callback; the
// maintained MCP server still owns transport, session and result encoding.
const requests = new AsyncLocalStorage<{
  actor: Actor;
  resourceUri?: string;
}>();
const ctx = () => {
  const r = requests.getStore();
  if (!r) fail("mcp_context_unavailable", 401);
  return { actor: r.actor, check: () => authorizeMcp(r.actor) };
};
export const pageResourceUri = (versionId: string, page: number) =>
  `loreweave://sources/${versionId}/pages/${page}`;
const tools = [
  readingDefinitions.browse.server<MCPToolContext>((input) =>
    browseDocuments(ctx(), input),
  ),
  readingDefinitions.document.server<MCPToolContext>((input) =>
    getDocument(ctx(), input),
  ),
  readingDefinitions.structure.server<MCPToolContext>((input) =>
    getStructure(ctx(), input),
  ),
  readingDefinitions.pages.server<MCPToolContext>(async (input) => {
    const value = await getPages(ctx(), input);
    return {
      ...value,
      pages: value.pages.map((p) => ({
        ...p,
        uri: pageResourceUri(value.versionId, p.page),
      })),
    };
  }),
  toolDefinition({
    name: "question_answer",
    description:
      "Ask one independent bounded question using the server's configured QA model. Optional selected document scope is a nonempty allowlist; omitted scope discovers the current library. Returns an original-backed answer/citations, clarification, evidence gap, incomplete reading or explicit failure. Does not share Web or caller transcript.",
    inputSchema: independentQuestionInput,
    outputSchema: independentAnswerSchema,
    metadata: { annotations: { readOnlyHint: true, destructiveHint: false } },
  }).server<MCPToolContext>(async (input, call) => {
    const caller = ctx();
    await caller.check();
    const value = await independentQuestion(
      caller.actor,
      input,
      call.abortSignal,
    );
    return independentAnswerSchema.parse({
      runId: value.id,
      status: value.status,
      reason: value.reason,
      answer: value.result,
      scope: value.scope,
      usage: value.usage,
      references: value.references.map((r) => ({
        ...r,
        uri: pageResourceUri(r.versionId, r.page),
      })),
    });
  }),
];
const resource = resourceDefinition({
  name: "immutable_original_page",
  mimeType: "text/plain",
  uriTemplate: "loreweave://sources/{versionId}/pages/{page}",
}).read(async () => {
  const caller = ctx();
  await caller.check();
  const uri = requests.getStore()?.resourceUri;
  const match =
    uri && /^loreweave:\/\/sources\/([a-f0-9-]+)\/pages\/(\d+)$/.exec(uri);
  if (!match) fail("resource_invalid");
  const versionId = z.string().uuid().parse(match[1]),
    page = z.coerce.number().int().min(1).parse(match[2]);
  const { document } = await resolveVersion(caller.actor, versionId);
  const value = await getPages(caller, {
    documentId: document.id,
    versionId,
    pages: [page],
  });
  await caller.check();
  return { text: JSON.stringify({ ...value, physicalPage: page }) };
});
export const mcpServer = createMCPServer({
  name: "LoreWeave",
  version: "1.0.0",
  tools,
  resources: [resource],
});
export function handleMcp(request: Request) {
  return httpBoundary(async () => {
    const actor = await requireMcp(request);
    let resourceUri: string | undefined;
    if (request.method === "POST") {
      try {
        const body = await request.clone().json();
        resourceUri =
          body.method === "resources/read" ? body.params?.uri : undefined;
      } catch {
        /* SDK reports malformed protocol requests */
      }
    }
    return requests.run({ actor, resourceUri }, () =>
      mcpServer.handle(request, {
        authInfo: {
          token: actor.tokenId!,
          clientId: actor.tokenId!,
          scopes: ["documents:read"],
          extra: { sub: actor.ownerId },
        },
        context: { actor },
      }),
    );
  });
}
