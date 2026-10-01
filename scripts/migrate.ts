import { loadLocalConfiguration } from "./configuration";
await loadLocalConfiguration();
const { migrateDatabase, database } = await import("../src/server/database");
await migrateDatabase();
await database().client.end();
console.log("PageIndex migrations applied to the isolated database.");
