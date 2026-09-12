import type { Context } from "hono";

/** Catch decoding failures here, not domain failures thrown later by a handler. */
export async function jsonInput(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new Error("invalid_input");
  }
}

export async function inputRecord(
  context: Context,
): Promise<Record<string, unknown>> {
  const input = await jsonInput(context);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_input");
  return input as Record<string, unknown>;
}
export function stringField(
  input: Record<string, unknown>,
  key: string,
): string {
  if (typeof input[key] !== "string") throw new Error("invalid_input");
  return input[key];
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
