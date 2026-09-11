import { writeFile } from "node:fs/promises";
import { capacityFixture } from "../src/evaluation/capacity-fixture.ts";
const output = Bun.argv[2],
  database = process.env.TEST_DATABASE_URL;
if (!output || !database)
  throw new Error("TEST_DATABASE_URL and new output path required");
const report = await capacityFixture(database);
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(output);
