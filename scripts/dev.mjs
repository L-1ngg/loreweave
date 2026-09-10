import { spawn } from "node:child_process";
const children = [
  spawn("bun", ["--no-env-file", "src/development/main.ts"], {
    stdio: "inherit",
  }),
  spawn("node", ["node_modules/vite/bin/vite.js"], { stdio: "inherit" }),
];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, close);
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    close();
  });
  child.on("exit", (code) => {
    if (!closing) {
      process.exitCode = code ?? 1;
      close();
    }
  });
}
