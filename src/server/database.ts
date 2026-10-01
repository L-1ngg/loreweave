import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { configuration } from "./config";
import * as schema from "./schema";

let instance: ReturnType<typeof connect> | undefined;
function connect() {
  const client = postgres(configuration().databaseUrl, {
    max: 8,
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}
export function database() {
  return (instance ??= connect());
}

export async function migrateDatabase() {
  const { client } = database();
  const files = [...new Bun.Glob("*.sql").scanSync("migrations")].sort();
  await client.begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(842901)`;
    await sql`create table if not exists pageindex_migrations (name text primary key, digest text not null)`;
    for (const name of files) {
      const text = await Bun.file(`migrations/${name}`).text();
      const digest = new Bun.CryptoHasher("sha256").update(text).digest("hex");
      const saved =
        await sql`select digest from pageindex_migrations where name=${name}`;
      if (saved.length) {
        if (saved[0].digest !== digest)
          throw new Error(`migration_changed: ${name}`);
        continue;
      }
      await sql.unsafe(text);
      await sql`insert into pageindex_migrations(name,digest) values(${name},${digest})`;
    }
    await sql`insert into owners(singleton,id) values('owner',${crypto.randomUUID()}) on conflict do nothing`;
  });
}
