import { createFileRoute } from "@tanstack/react-router";
import { uploadOriginal } from "../server/upload";
export const Route = createFileRoute("/api/documents/$id/updates")({
  server: {
    handlers: {
      POST: ({ request, params }) => uploadOriginal(request, params.id),
    },
  },
});
