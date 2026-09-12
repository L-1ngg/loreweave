import { z } from "zod";
import { digest, profiles, measured } from "./schema.ts";
import { categories, type EvaluationReport } from "./runner.ts";
export const humanGradesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviews: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        profile: z.enum(profiles),
        reviewer: z.string().min(1),
        reviewedAt: z.iso.datetime(),
        correctness: z.boolean(),
        completeness: z.boolean(),
        citationsSupported: z.boolean(),
        gaps: z.boolean(),
        notes: z.string(),
      }),
    )
    .min(1),
});
export const agentGradesSchema = humanGradesSchema.extend({
  kind: z.literal("independent-agent"),
});
/** Independent annotations bind to an exact immutable report, never model input. */
export function grade(report: EvaluationReport, input: unknown) {
  const grades = humanGradesSchema.parse(input);
  if (report.provenance === "independent-agent-review-required")
    throw new Error("agent_report_requires_agent_grades");
  return { ...applyGrades(report, grades, "human"), humanGrades: grades };
}
export function gradeAgent(report: EvaluationReport, input: unknown) {
  const grades = agentGradesSchema.parse(input);
  if (report.provenance !== "independent-agent-review-required")
    throw new Error("agent_review_report_required");
  return { ...applyGrades(report, grades, "agent"), agentGrades: grades };
}
function applyGrades(
  report: EvaluationReport,
  grades: z.infer<typeof humanGradesSchema>,
  reviewer: "human" | "agent",
) {
  if (grades.reportSha256 !== digest(JSON.stringify(report)))
    throw new Error("report_hash_mismatch");
  const result = structuredClone(report);
  const seen = new Set<string>();
  for (const review of grades.reviews) {
    const key = `${review.profile}:${review.id}`;
    if (seen.has(key)) throw new Error("duplicate_grade");
    seen.add(key);
    const item = result.cases.find(
      (item) => item.id === review.id && item.profile === review.profile,
    );
    if (!item) throw new Error("unknown_case");
    // Human scoring cannot make an unavailable route, failed transport or broken
    // original locator pass. It may accept equivalent evidence outside reference IDs.
    if (
      ![
        reviewer === "human" ? "pending_human" : "pending_agent",
        "pass",
      ].includes(item.outcome)
    )
      continue;
    item.quality = measured({
      correctness: review.correctness,
      completeness: review.completeness,
      gaps: review.gaps,
    });
    item.outcome =
      review.correctness &&
      review.completeness &&
      review.citationsSupported &&
      review.gaps
        ? "pass"
        : "fail";
    item.reason = `independent_${reviewer}_review`;
  }
  result.categories = categories(result.cases);
  return result;
}
