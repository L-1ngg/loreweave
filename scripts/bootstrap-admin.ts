import { AccessService } from "../src/access.ts";
if (!process.env.DATABASE_URL || !process.env.LOREWEAVE_BOOTSTRAP_PASSWORD)
  throw new Error(
    "Set DATABASE_URL and LOREWEAVE_BOOTSTRAP_PASSWORD (at least 12 characters)",
  );
const access = new AccessService(process.env.DATABASE_URL);
try {
  await access.migrate();
  await access.bootstrap({
    organization: process.env.LOREWEAVE_ORGANIZATION ?? "local",
    username: process.env.LOREWEAVE_BOOTSTRAP_USERNAME ?? "admin",
    password: process.env.LOREWEAVE_BOOTSTRAP_PASSWORD,
  });
  console.log("Administrator account is ready. Credentials were not printed.");
} finally {
  await access.close();
}
