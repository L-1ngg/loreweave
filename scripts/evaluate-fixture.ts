import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluationFixture } from "../src/evaluation/fixture.ts";
import { evaluate } from "../src/evaluation/runner.ts";
const database = process.env.TEST_DATABASE_URL,
  output = Bun.argv[2];
if (!database || !output)
  throw new Error("TEST_DATABASE_URL and new output directory required");
await mkdir(output); // Existing reports must be preserved.
for (const [name, corrupt] of [
  ["good", false],
  ["bad", true],
] as const) {
  const fixture = await evaluationFixture(database, corrupt, "source", true);
  try {
    const report = await evaluate({
      manifest: fixture.manifest,
      dataset: fixture.dataset,
      clients: fixture.clients,
    });
    for (const [suffix, value] of [
      ["manifest", fixture.manifest],
      ["development", fixture.dataset],
      ["report", report],
    ] as const)
      await writeFile(
        resolve(output, `${name}.${suffix}.json`),
        JSON.stringify(value, null, 2) + "\n",
        { flag: "wx" },
      );
    console.log(name, report.categories);
  } finally {
    await fixture.close();
  }
}
