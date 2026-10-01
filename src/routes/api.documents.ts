import { createFileRoute } from "@tanstack/react-router";
import { uploadOriginal } from "../server/upload";

export const Route = createFileRoute("/api/documents")({
  server: {
    handlers: {
      POST: ({ request }) => uploadOriginal(request),
    },
  },
});
