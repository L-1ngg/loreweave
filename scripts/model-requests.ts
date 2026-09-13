import { ModelAdmission } from "../src/model-admission.ts";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("missing_config:DATABASE_URL");
const admission = new ModelAdmission(url);
try {
  const [command, id, kind, reference, ...extra] = Bun.argv.slice(2);
  if (command === "reconcile") {
    if (
      !id ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      !["provider-completed", "provider-terminated"].includes(kind ?? "") ||
      !reference?.trim() ||
      extra.length
    )
      throw new Error(
        "Usage: model:status reconcile UUID provider-completed|provider-terminated EVIDENCE_REFERENCE",
      );
    await admission.reconcile(id, {
      kind: kind as "provider-completed" | "provider-terminated",
      reference,
    });
  } else if (command && command !== "status")
    throw new Error(
      "Usage: model:status [status|reconcile UUID KIND EVIDENCE_REFERENCE]",
    );
  console.log(JSON.stringify(await admission.status(), null, 2));
} finally {
  await admission.close();
}
