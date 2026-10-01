import { createFileRoute } from "@tanstack/react-router";
import { SettingsView, settingsOptions } from "../components/settings";
export const Route = createFileRoute("/_app/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsOptions),
  component: SettingsView,
});
