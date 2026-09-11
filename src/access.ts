import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";

export const grants = [
  "read",
  "import",
  "correct",
  "restore",
  "admin",
] as const;
export type Grant = (typeof grants)[number];
export interface Actor {
  id: string;
  organizationId: string;
  username: string;
  grants: Grant[];
}
export interface TrustedContext {
  actorId: string;
  organizationId: string;
  scope: { projectId?: string; includeShared: true };
}
export interface LoginInput {
  organization: string;
  username: string;
  password: string;
}

/** Credentials establish identity; model arguments never create a TrustedContext. */
export class AccessService {
  private readonly client;
  private readonly db;
  constructor(url: string) {
    this.client = postgres(url, { max: 5, onnotice: () => {} });
    this.db = drizzle(this.client);
  }
  async migrate() {
    await migrate(this.db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url),
      ),
    });
  }
  async bootstrap(input: LoginInput): Promise<void> {
    validateAccount(input.username, input.password);
    if (!/^[a-z0-9-]{1,64}$/.test(input.organization))
      throw new Error("invalid_input");
    const passwordHash = await Bun.password.hash(input.password);
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bootstrap:${input.organization}`}, 0))`,
      );
      const existing =
        await tx.execute(sql`SELECT m.username, m.password_hash, m.grants FROM organizations o
        JOIN members m ON m.organization_id = o.id WHERE o.slug = ${input.organization}`);
      if (existing.length) {
        const admin = existing.find(
          (row) =>
            row.username === input.username &&
            (row.grants as Grant[]).includes("admin"),
        );
        if (
          !admin ||
          !(await Bun.password.verify(
            input.password,
            String(admin.password_hash),
          ))
        )
          throw new Error("version_conflict");
        return;
      }
      const organizationId = crypto.randomUUID();
      await tx.execute(
        sql`INSERT INTO organizations(id, slug) VALUES (${organizationId}, ${input.organization})`,
      );
      await tx.execute(sql`INSERT INTO members(id, organization_id, username, password_hash, grants)
        VALUES (${crypto.randomUUID()}, ${organizationId}, ${input.username}, ${passwordHash}, ${JSON.stringify(grants)}::jsonb)`);
    });
  }
  async login(input: LoginInput): Promise<{ token: string; actor: Actor }> {
    if (
      !input.organization ||
      !input.username ||
      !input.password ||
      input.password.length > 1024
    )
      throw new Error("unauthorized");
    const rows = await this.db
      .execute(sql`SELECT m.* FROM members m JOIN organizations o ON o.id = m.organization_id
      WHERE o.slug = ${input.organization} AND m.username = ${input.username} AND m.enabled`);
    const row = rows[0];
    if (
      !row ||
      !(await Bun.password.verify(input.password, String(row.password_hash)))
    )
      throw new Error("unauthorized");
    const token = randomBytes(32).toString("hex");
    await this.db
      .execute(sql`INSERT INTO login_sessions(token_hash, member_id, expires_at)
      VALUES (${digest(token)}, ${String(row.id)}, now() + interval '7 days')`);
    return { token, actor: actor(row) };
  }
  async issueCredential(
    token: string,
    input: { name: string; grants: Grant[] },
  ) {
    await this.authorize(token, "admin");
    const member = await this.identity(token);
    if (
      !input.name.trim() ||
      input.name.length > 100 ||
      input.grants.length !== 1 ||
      input.grants[0] !== "read" ||
      !member.grants.includes("read")
    )
      throw new Error("invalid_input");
    const id = crypto.randomUUID();
    const credential = `lw_${randomBytes(32).toString("hex")}`;
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await this.db
      .execute(sql`INSERT INTO external_credentials(id,token_hash,member_id,name,grants,expires_at)
      VALUES(${id},${digest(credential)},${member.id},${input.name.trim()},${JSON.stringify(input.grants)}::jsonb,${expiresAt}::timestamptz)`);
    return {
      id,
      token: credential,
      name: input.name.trim(),
      grants: input.grants,
      expiresAt,
    };
  }
  async revokeCredential(token: string, id: string): Promise<void> {
    const context = await this.authorize(token, "admin");
    const rows = await this.db
      .execute(sql`UPDATE external_credentials c SET revoked_at=now()
      FROM members m WHERE c.id=${id} AND c.member_id=m.id AND m.organization_id=${context.organizationId} RETURNING c.id`);
    if (!rows.length) throw new Error("not_found");
  }
  async externalIdentity(token: string): Promise<Actor> {
    if (!/^lw_[0-9a-f]{64}$/.test(token)) throw new Error("unauthorized");
    const rows = await this.db
      .execute(sql`SELECT m.*,c.grants AS credential_grants FROM external_credentials c
      JOIN members m ON m.id=c.member_id WHERE c.token_hash=${digest(token)} AND c.revoked_at IS NULL AND c.expires_at>now() AND m.enabled`);
    if (!rows[0]) throw new Error("unauthorized");
    const member = actor(rows[0]);
    return {
      ...member,
      grants: member.grants.filter((grant) =>
        (rows[0]!.credential_grants as Grant[]).includes(grant),
      ),
    };
  }
  async identity(token: string): Promise<Actor> {
    if (token.startsWith("lw_")) return this.externalIdentity(token);
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("unauthorized");
    const rows = await this.db
      .execute(sql`SELECT m.* FROM login_sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = ${digest(token)} AND s.expires_at > now() AND m.enabled`);
    if (!rows[0]) throw new Error("unauthorized");
    return actor(rows[0]);
  }
  async authorize(
    token: string,
    operation: Grant,
    projectId?: string,
  ): Promise<TrustedContext> {
    const member = await this.identity(token);
    if (!member.grants.includes(operation)) throw new Error("unauthorized");
    if (projectId) {
      const rows = await this.db.execute(
        sql`SELECT id FROM projects WHERE id = ${projectId} AND organization_id = ${member.organizationId}`,
      );
      if (!rows.length) throw new Error("unauthorized");
    }
    return {
      actorId: member.id,
      organizationId: member.organizationId,
      scope: { includeShared: true, ...(projectId ? { projectId } : {}) },
    };
  }
  async createMember(
    token: string,
    input: { username: string; password: string; grants: Grant[] },
  ): Promise<Actor> {
    const context = await this.authorize(token, "admin");
    validateAccount(input.username, input.password);
    if (
      !Array.isArray(input.grants) ||
      input.grants.some((grant) => !grants.includes(grant))
    )
      throw new Error("invalid_input");
    const id = crypto.randomUUID(),
      passwordHash = await Bun.password.hash(input.password);
    await this.db
      .execute(sql`INSERT INTO members(id, organization_id, username, password_hash, grants)
      VALUES (${id}, ${context.organizationId}, ${input.username}, ${passwordHash}, ${JSON.stringify([...new Set(input.grants)])}::jsonb)`);
    return {
      id,
      organizationId: context.organizationId,
      username: input.username,
      grants: [...new Set(input.grants)],
    };
  }
  async createProject(
    token: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    const context = await this.authorize(token, "admin");
    if (!name.trim() || name.length > 200) throw new Error("invalid_input");
    const id = crypto.randomUUID();
    await this.db.execute(
      sql`INSERT INTO projects(id, organization_id, name) VALUES (${id}, ${context.organizationId}, ${name.trim()})`,
    );
    return { id, name: name.trim() };
  }
  async projects(token: string): Promise<Array<{ id: string; name: string }>> {
    const context = await this.authorize(token, "read");
    const rows = await this.db.execute(
      sql`SELECT id, name FROM projects WHERE organization_id = ${context.organizationId} ORDER BY name, id`,
    );
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  }
  async members(token: string): Promise<Actor[]> {
    const context = await this.authorize(token, "admin");
    const rows = await this.db.execute(
      sql`SELECT * FROM members WHERE organization_id = ${context.organizationId} ORDER BY username`,
    );
    return rows.map(actor);
  }
  async revokeMemberSessions(token: string, memberId: string): Promise<void> {
    const context = await this.authorize(token, "admin");
    const member = await this.db.execute(
      sql`SELECT id FROM members WHERE id = ${memberId} AND organization_id = ${context.organizationId}`,
    );
    if (!member.length) throw new Error("unauthorized");
    await this.db.execute(
      sql`DELETE FROM login_sessions WHERE member_id = ${memberId}`,
    );
  }
  async organization(slug: string): Promise<string> {
    const rows = await this.db.execute(
      sql`SELECT id FROM organizations WHERE slug = ${slug}`,
    );
    if (!rows[0]) throw new Error("not_found");
    return String(rows[0].id);
  }
  async revoke(token: string): Promise<void> {
    await this.db.execute(
      sql`DELETE FROM login_sessions WHERE token_hash = ${digest(token)}`,
    );
  }
  async close(): Promise<void> {
    await this.client.end();
  }
}
function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function actor(row: Record<string, unknown>): Actor {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    username: String(row.username),
    grants: row.grants as Grant[],
  };
}
function validateAccount(username: string, password: string): void {
  if (
    !/^[a-zA-Z0-9_.-]{1,64}$/.test(username) ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new Error("invalid_input");
}
