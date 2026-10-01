import { createFileRoute } from "@tanstack/react-router";
import { mcpProbe } from "../server/baseline";
export const Route = createFileRoute("/mcp-probe")({
  server: {
    handlers: {
      GET: ({ request }) => mcpProbe(request),
      POST: ({ request }) => mcpProbe(request),
      DELETE: ({ request }) => mcpProbe(request),
    },
  },
});
