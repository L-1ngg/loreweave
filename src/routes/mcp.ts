import { createFileRoute } from "@tanstack/react-router";
import { handleMcp } from "../server/mcp";
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcp(request),
      POST: ({ request }) => handleMcp(request),
      DELETE: ({ request }) => handleMcp(request),
    },
  },
});
