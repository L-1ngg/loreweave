import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { database } from "./database";
import { owners, sessions } from "./schema";
import { configuration } from "./config";
import { fail } from "./errors";
import { ensureRuntime } from "./runtime";

export type Actor = {
  ownerId: string;
  channel: "web" | "mcp";
  tokenId?: string;
};
const cookieName = "loreweave_session";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const credentialVersion = () =>
  createHmac("sha256", Buffer.from(configuration().secretKey, "hex"))
    .update(configuration().accessPassword)
    .digest("hex");
let passwordCache: { value: string; hash: Promise<string> } | undefined;
const failures = new Map<string, { count: number; until: number }>();

export function sameOrigin(request: Request) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin)
      fail("origin_rejected", 403);
  }
}
function cookieToken(request: Request) {
  const part = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((p) => p.startsWith(`${cookieName}=`));
  return part?.slice(cookieName.length + 1);
}
function setCookie(request: Request, token: string, age: number) {
  setResponseHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  );
  setResponseHeader("Cache-Control", "no-store");
}
export async function session(
  request: Request = getRequest(),
): Promise<Actor | null> {
  const token = cookieToken(request);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [record] = await database()
    .db.select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, digest(token)),
        eq(sessions.credentialVersion, credentialVersion()),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return record ? { ownerId: record.ownerId, channel: "web" } : null;
}
export async function requireWeb(request: Request = getRequest()) {
  await ensureRuntime();
  sameOrigin(request);
  const actor = await session(request);
  if (!actor) fail("unauthorized", 401);
  if (request === getRequest())
    setResponseHeader("Cache-Control", "private, no-store");
  return actor;
}
export function requireManagement(actor: Actor) {
  if (actor.channel !== "web") fail("management_forbidden", 403);
}
export async function login(password: string) {
  const request = getRequest();
  sameOrigin(request);
  const key = new URL(request.url).hostname;
  const rate = failures.get(key);
  if (rate && rate.until > Date.now() && rate.count >= 10)
    fail("login_rate_limited", 429);
  const expected = configuration().accessPassword;
  if (passwordCache?.value !== expected)
    passwordCache = {
      value: expected,
      hash: Bun.password.hash(expected, { algorithm: "argon2id" }),
    };
  const ok = await Bun.password.verify(password, await passwordCache.hash);
  if (!ok) {
    failures.set(key, {
      count: rate && rate.until > Date.now() ? rate.count + 1 : 1,
      until: Date.now() + 60_000,
    });
    fail("invalid_password", 401);
  }
  failures.delete(key);
  const { db } = database();
  const [owner] = await db.select().from(owners);
  const previous = cookieToken(request);
  if (previous)
    await db.delete(sessions).where(eq(sessions.tokenHash, digest(previous)));
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: digest(token),
    ownerId: owner.id,
    credentialVersion: credentialVersion(),
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  setCookie(request, token, 7 * 86400);
  return { ownerId: owner.id };
}
export async function logout() {
  const request = getRequest();
  sameOrigin(request);
  const token = cookieToken(request);
  if (token)
    await database()
      .db.delete(sessions)
      .where(eq(sessions.tokenHash, digest(token)));
  setCookie(request, "", 0);
  return { ok: true };
}
