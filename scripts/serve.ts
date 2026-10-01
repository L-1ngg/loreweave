import { resolve, sep } from "node:path";
import { loadLocalConfiguration } from "./configuration";
await loadLocalConfiguration();
const { migrateDatabase } = await import("../src/server/database");
await migrateDatabase();
await (await import("../src/server/runtime")).ensureRuntime();
const buildDirectory = process.env.LOREWEAVE_BUILD_DIRECTORY ?? "dist";
const entry = resolve(buildDirectory, "server/server.js");
const handler = (await import(entry)).default;
const assets = resolve(buildDirectory, "client");
const requested = Number(process.env.LOREWEAVE_PORT ?? 41737);
let server: ReturnType<typeof Bun.serve> | undefined;
for (let port = requested; port < requested + 100; port++) {
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      idleTimeout: 120,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const path = resolve(assets, `.${pathname}`);
        if (
          path.startsWith(assets + sep) &&
          pathname !== "/" &&
          ["GET", "HEAD"].includes(request.method)
        ) {
          const file = Bun.file(path);
          if (await file.exists())
            return new Response(request.method === "HEAD" ? null : file, {
              headers: { "Content-Type": file.type },
            });
        }
        return handler.fetch(request);
      },
    });
    break;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EADDRINUSE"
    )
      throw error;
  }
}
if (!server) throw new Error("No available local port");
console.log(`LoreWeave: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server?.stop(true);
    process.exit(0);
  });
