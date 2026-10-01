import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWeb } from "../server/access";
import { attachRun } from "../server/knowledge";
import { httpBoundary } from "../server/errors";
export const Route = createFileRoute("/api/runs/$id/events")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        httpBoundary(async () =>
          attachRun(
            await requireWeb(request),
            z.string().uuid().parse(params.id),
            request.headers.get("Last-Event-ID") ??
              new URL(request.url).searchParams.get("offset") ??
              "-1",
          ),
        ),
    },
  },
});
