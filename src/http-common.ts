import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export function credential(context: Context): string {
  return getCookie(context, "loreweave_session") ?? "";
}
export function accessError(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : "unavailable";
  if (message === "unauthorized") return context.json({ error: message }, 401);
  if (message === "invalid_input") return context.json({ error: message }, 400);
  if (
    message === "version_conflict" ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505")
  )
    return context.json({ error: "version_conflict" }, 409);
  if (
    [
      "source_changed",
      "identity_unresolved",
      "identity_cycle",
      "insufficient_evidence",
    ].includes(message)
  )
    return context.json({ error: message }, 409);
  if (message === "not_found") return context.json({ error: message }, 404);
  return context.json({ error: "unavailable" }, 503);
}
