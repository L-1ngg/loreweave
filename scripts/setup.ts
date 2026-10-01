import { randomBytes } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";

if (await Bun.file(".pageindex.env").exists()) {
  console.log("Existing .pageindex.env preserved.");
} else {
  await Bun.write(
    ".pageindex.env",
    [
      "LOREWEAVE_DATABASE_URL=postgres://loreweave:loreweave_local@127.0.0.1:45434/loreweave_pageindex",
      "LOREWEAVE_ARTIFACT_DIRECTORY=.pageindex-data/originals",
      `LOREWEAVE_ACCESS_PASSWORD=${randomBytes(18).toString("base64url")}`,
      `LOREWEAVE_SECRET_KEY=${randomBytes(32).toString("hex")}`,
      "LOREWEAVE_MODE=fixture",
      "LOREWEAVE_PORT=41737",
      "",
    ].join("\n"),
  );
  await chmod(".pageindex.env", 0o600);
  console.log(
    "Created private .pageindex.env; access password is stored there.",
  );
}
await mkdir(".pageindex-data/originals", { recursive: true, mode: 0o700 });
console.log(
  "Start the new database with: docker compose up -d --wait postgres",
);
