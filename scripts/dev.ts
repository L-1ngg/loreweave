import { loadLocalConfiguration } from "./configuration";
await loadLocalConfiguration();
const { migrateDatabase, database } = await import("../src/server/database");
await migrateDatabase();
await (await import("../src/server/runtime")).ensureRuntime();
await database().client.end();
const requested = Number(process.env.LOREWEAVE_PORT ?? 41737);
let port = requested;
for (; port < requested + 100; port++) {
  try {
    const check = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response(),
    });
    check.stop(true);
    break;
  } catch {
    /* Preserve existing services and choose another local port. */
  }
}
const child = Bun.spawn(
  [
    process.execPath,
    "--no-env-file",
    "node_modules/vite/bin/vite.js",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, LOREWEAVE_PORT: String(port) },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
