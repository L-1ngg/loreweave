import { afterAll } from "vitest";
import { runPersistenceConformance } from "@tanstack/ai-persistence/testkit";
import { persistence } from "../../src/server/persistence";
import { database } from "../../src/server/database";
runPersistenceConformance("LoreWeave PostgreSQL", () => persistence, {
  skip: ["interrupts", "metadata", "generationRuns", "artifacts", "blobs"],
  skipMethods: ["runs.listReclaimable", "runs.listByParentRun"],
  checks: ["messages.metadata", "runs.listByThread.state"],
});
afterAll(async () => {
  await database().client.end();
});
