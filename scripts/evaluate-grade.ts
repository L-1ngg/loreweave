import { writeFile } from "node:fs/promises";
import { grade, gradeAgent } from "../src/evaluation/grading.ts";
const [report, grades, output] = Bun.argv.slice(2);
if (!report || !grades || !output)
  throw new Error("Usage: bun run eval:grade REPORT GRADES NEW_OUTPUT");
const annotations = await Bun.file(grades).json();
const result = (annotations.kind === "independent-agent" ? gradeAgent : grade)(
  await Bun.file(report).json(),
  annotations,
);
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(output);
