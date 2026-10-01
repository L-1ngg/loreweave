import { resolve } from "node:path";

export async function loadLocalConfiguration() {
  const path = process.env.LOREWEAVE_CONFIG_FILE ?? ".pageindex.env";
  if (!(await Bun.file(path).exists())) return;
  const text = await Bun.file(path).text();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z_0-9]*)=(.*)$/.exec(line.trim());
    if (!match || !match[1].startsWith("LOREWEAVE_")) continue;
    process.env[match[1]] ??= match[2];
  }
  process.env.LOREWEAVE_CONFIG_FILE = resolve(path);
}
