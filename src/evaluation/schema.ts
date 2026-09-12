import { z } from "zod";
import { createHash } from "node:crypto";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const profiles = ["source", "wiki", "graph", "combined"] as const;
const name = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.strictObject({ version: z.uuid(), passageId: z.uuid() });
export const sourceManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  corpus: name,
  snapshot: name,
  sources: z
    .array(
      z.strictObject({
        version: z.uuid(),
        sha256: sha,
        projectId: z.uuid().nullable(),
        parser: name,
        embedding: name,
      }),
    )
    .min(1),
});
const review = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pending") }),
  z.strictObject({
    kind: z.literal("human"),
    reviewer: name,
    reviewedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("agent"),
    reviewer: name,
    reviewedAt: z.iso.datetime(),
  }),
  z.strictObject({ kind: z.literal("fixture"), oracle: name }),
]);
const caseSchema = z.strictObject({
  id: name,
  question: name.max(8000),
  paraphraseGroup: name,
  complexity: z.enum(["ordinary", "complex"]),
  category: z.enum(["sufficient", "missing", "conflicting"]),
  projectId: z.uuid().nullable(),
  tags: z.array(name),
  references: z.array(reference),
  expectedGaps: z.array(name),
  requiredPoints: z.array(name),
  review,
});
const common = {
  schemaVersion: z.literal(1),
  version: name,
  manifestSha256: sha,
  cases: z.array(caseSchema).min(1),
};
export const developmentSchema = z.strictObject({
  ...common,
  split: z.literal("development"),
  mode: z.enum(["fixture", "human", "agent"]),
});
export const acceptanceSchema = z.strictObject({
  ...common,
  split: z.literal("acceptance"),
  mode: z.literal("human"),
  frozenAt: z.iso.datetime(),
  developmentSha256: sha,
});
export const datasetSchema = z.discriminatedUnion("split", [
  developmentSchema,
  acceptanceSchema,
]);
export type Dataset = z.infer<typeof datasetSchema>;
export type EvaluationCase = Dataset["cases"][number];
export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type Profile = (typeof profiles)[number];
export type Measurement<T> =
  { status: "available"; value: T } | { status: "unavailable"; reason: string };
export const unavailable = (reason: string): Measurement<never> => ({
  status: "unavailable",
  reason,
});
export const measured = <T>(value: T): Measurement<T> => ({
  status: "available",
  value,
});
export const metricSchema = z.strictObject({
  numerator: z.number().nonnegative(),
  denominator: z.number().nonnegative(),
});
export const maintenanceKinds = [
  "routing",
  "inspection",
  "lifecycle",
  "identity",
  "graph",
  "review",
  "work",
] as const;
export const routingTargetsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: name,
  split: z.enum(["development", "acceptance"]),
  examples: z.array(
    z.strictObject({
      operationId: z.uuid(),
      topicKey: name,
      referencePages: z.array(z.uuid()),
      expectedDecision: z.enum(["create", "reuse", "defer"]),
      references: z.array(reference),
      review,
    }),
  ),
});
export const diagnosticSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(maintenanceKinds),
  operationId: z.uuid(),
  capturedAt: z.iso.datetime(),
  provenance: z.enum(["controlled-provider", "real-provider"]),
  versions: z.record(name, name),
  status: z.enum(["available", "unavailable"]),
  reason: name.optional(),
  metrics: z.record(name, metricSchema),
  details: z.record(name, z.unknown()),
});
export type MaintenanceDiagnostic = z.infer<typeof diagnosticSchema>;
export interface DiagnosticAdapter {
  capture(operationId: string): Promise<MaintenanceDiagnostic[]>;
}
export function unavailableDiagnostics(
  operationId: string,
): MaintenanceDiagnostic[] {
  return maintenanceKinds.map((kind) => ({
    schemaVersion: 1,
    kind,
    operationId,
    capturedAt: new Date().toISOString(),
    provenance: "controlled-provider",
    versions: {},
    status: "unavailable",
    reason: "maintenance adapter not installed",
    metrics: {},
    details: {},
  }));
}
export function validateDataset(
  manifest: SourceManifest,
  dataset: Dataset,
  development?: Dataset,
) {
  if (dataset.manifestSha256 !== digest(JSON.stringify(manifest)))
    throw new Error("manifest_hash_mismatch");
  const versions = new Set(manifest.sources.map((source) => source.version));
  if (
    versions.size !== manifest.sources.length ||
    new Set(dataset.cases.map((item) => item.id)).size !== dataset.cases.length
  )
    throw new Error("duplicate_input");
  for (const item of dataset.cases) {
    if (item.references.some((ref) => !versions.has(ref.version)))
      throw new Error("unknown_reference_version");
    if (
      item.review.kind === "pending" ||
      (dataset.mode === "human" && item.review.kind !== "human") ||
      (dataset.mode === "agent" && item.review.kind !== "agent")
    )
      throw new Error("unreviewed_reference");
    if (item.category === "sufficient" && !item.references.length)
      throw new Error("missing_reference");
  }
  if (dataset.split === "acceptance") {
    if (
      !development ||
      development.split !== "development" ||
      digest(JSON.stringify(development)) !== dataset.developmentSha256
    )
      throw new Error("development_manifest_required");
    const groups = new Set(
      development.cases.map((item) => item.paraphraseGroup),
    );
    const questions = new Set(
      development.cases.map((item) =>
        item.question.normalize("NFKC").replace(/\s/g, "").toLowerCase(),
      ),
    );
    if (
      dataset.cases.some(
        (item) =>
          groups.has(item.paraphraseGroup) ||
          questions.has(
            item.question.normalize("NFKC").replace(/\s/g, "").toLowerCase(),
          ),
      )
    )
      throw new Error("holdout_overlap");
  }
}
