import { AccessService } from "../src/access.ts";
import { loadConfig } from "../src/config.ts";
const config = loadConfig();
if (!config.databaseUrl || !config.bootstrap)
  throw new Error(
    "Set DATABASE_URL and LOREWEAVE_BOOTSTRAP_PASSWORD (at least 12 characters)",
  );
const access = new AccessService(config.databaseUrl);
try {
  await access.migrate();
  await access.bootstrap({
    organization: config.organization,
    ...config.bootstrap,
  });
  console.log("Administrator account is ready. Credentials were not printed.");
} finally {
  await access.close();
}
