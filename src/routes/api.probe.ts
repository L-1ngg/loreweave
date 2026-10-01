import { createFileRoute } from "@tanstack/react-router";
import {
  uploadProbe,
  originalProbe,
  modelProbe,
  databaseProbe,
  requireProbe,
} from "../server/baseline";

export const Route = createFileRoute("/api/probe")({
  server: {
    handlers: {
      POST: ({ request }) => uploadProbe(request),
      HEAD: ({ request }) => originalProbe(request),
      GET: async ({ request }) => {
        const kind = new URL(request.url).searchParams.get("kind");
        if (kind === "original") return originalProbe(request);
        if (kind === "stream") return modelProbe(request);
        requireProbe(request);
        return Response.json({ rows: await databaseProbe() });
      },
    },
  },
});
