import { writeFile } from "node:fs/promises";
import { maintenanceFixture } from "../src/evaluation/maintenance-fixture.ts";
const output = Bun.argv[2],
  database = process.env.TEST_DATABASE_URL;
if (!output || !database)
  throw new Error("TEST_DATABASE_URL and new report path required");
const result = await maintenanceFixture(database);
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(output);
