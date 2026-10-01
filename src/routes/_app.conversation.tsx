import { createFileRoute } from "@tanstack/react-router";
import { ConversationView } from "../components/conversation";
export const Route = createFileRoute("/_app/conversation")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => ({
    id: typeof s.id === "string" ? s.id : undefined,
  }),
  component: () => <ConversationView selectedId={Route.useSearch().id} />,
});
