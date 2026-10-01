import postgres from "postgres";
import { rm } from "node:fs/promises";
export default async function teardown() {
  const url = new URL(process.env.LOREWEAVE_DATABASE_URL!);
  const name = url.pathname.slice(1);
  if (!/^loreweave_pageindex_browser_\d+$/.test(name))
    throw new Error("unsafe_test_cleanup");
  url.pathname = "/postgres";
  const client = postgres(url.toString(), { max: 1 });
  try {
    await client.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
  if (
    process.env.LOREWEAVE_ARTIFACT_DIRECTORY?.startsWith(
      "/tmp/loreweave-pageindex-browser-",
    )
  )
    await rm(process.env.LOREWEAVE_ARTIFACT_DIRECTORY, { recursive: true });
}
