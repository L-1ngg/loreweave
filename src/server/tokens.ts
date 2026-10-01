import { randomBytes } from "node:crypto";
import { and, eq, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { database } from "./database";
import { mcpTokens } from "./schema";
import { digest, requireManagement, type Actor } from "./access";
import { fail } from "./errors";
import { ensureRuntime } from "./runtime";

export async function listTokens(actor: Actor) {
  requireManagement(actor);
  return database()
    .db.select({
      id: mcpTokens.id,
      name: mcpTokens.name,
      createdAt: mcpTokens.createdAt,
      revokedAt: mcpTokens.revokedAt,
    })
    .from(mcpTokens)
    .where(eq(mcpTokens.ownerId, actor.ownerId))
    .orderBy(desc(mcpTokens.createdAt));
}
export async function createToken(actor: Actor, name: string) {
  requireManagement(actor);
  const id = crypto.randomUUID(),
    token = `lw_${randomBytes(32).toString("base64url")}`;
  await database()
    .db.insert(mcpTokens)
    .values({
      id,
      ownerId: actor.ownerId,
      name: z.string().trim().min(1).max(100).parse(name),
      tokenHash: digest(token),
    });
  return { id, token };
}
export async function revokeToken(actor: Actor, id: string) {
  requireManagement(actor);
  const rows = await database()
    .db.update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.ownerId, actor.ownerId)))
    .returning({ id: mcpTokens.id });
  if (!rows.length) fail("token_not_found", 404);
  return { ok: true };
}
export async function requireMcp(request: Request): Promise<Actor> {
  await ensureRuntime();
  const token = /^Bearer (lw_[A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!token) fail("mcp_unauthorized", 401);
  const [r] = await database()
    .db.select({ id: mcpTokens.id, ownerId: mcpTokens.ownerId })
    .from(mcpTokens)
    .where(
      and(eq(mcpTokens.tokenHash, digest(token)), isNull(mcpTokens.revokedAt)),
    );
  if (!r) fail("mcp_unauthorized", 401);
  return { ownerId: r.ownerId, tokenId: r.id, channel: "mcp" };
}
export async function authorizeMcp(actor: Actor) {
  if (actor.channel !== "mcp" || !actor.tokenId) fail("mcp_unauthorized", 401);
  const [r] = await database()
    .db.select({ id: mcpTokens.id })
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.id, actor.tokenId),
        eq(mcpTokens.ownerId, actor.ownerId),
        isNull(mcpTokens.revokedAt),
      ),
    );
  if (!r) fail("mcp_unauthorized", 401);
}
