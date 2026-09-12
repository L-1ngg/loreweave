import { loadConfig } from "../config.ts";
import { createRuntime } from "./runtime.ts";

const config = loadConfig();
const runtime = createRuntime(config);
let stopping = false;
async function stop() {
  stopping = true;
  try {
    await runtime.close();
  } catch {
    console.error("Runtime cleanup failed");
    process.exitCode = 1;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.off(signal, onSignal);
  }
}
function onSignal() {
  void stop();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, onSignal);
try {
  await runtime.start();
  if (!stopping)
    console.log(
      `LoreWeave authenticated API (${config.providerMode}): http://127.0.0.1:41736`,
    );
} catch (error) {
  if (!stopping) {
    console.error(
      "Runtime startup failed",
      error instanceof Error ? error.name : "error",
    );
    process.exitCode = 1;
  }
  await stop();
}
