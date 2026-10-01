import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWeb } from "../server/access";
import { httpBoundary } from "../server/errors";
import { originalResponse } from "../server/originals";
const handle = ({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) =>
  httpBoundary(async () =>
    originalResponse(
      await requireWeb(request),
      z.string().uuid().parse(params.id),
      request,
    ),
  );
export const Route = createFileRoute("/api/document-versions/$id/original")({
  server: { handlers: { GET: handle, HEAD: handle } },
});
