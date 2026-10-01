import { createFileRoute } from "@tanstack/react-router";
import { LibraryView } from "../components/library";
import { z } from "zod";
export const Route = createFileRoute("/_app/documents")({
  validateSearch: (search: Record<string, unknown>) =>
    z.object({ id: z.string().uuid().optional() }).parse(search),
  component: () => {
    const { id } = Route.useSearch();
    return <LibraryView selectedId={id} />;
  },
});
