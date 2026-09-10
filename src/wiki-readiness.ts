export function wikiReadiness(jobs: Array<{ kind: string; state: string }>) {
  const required = jobs.filter(
    (job) => job.kind.startsWith("wiki.") && job.kind !== "wiki.project",
  );
  if (!required.length) return "pending" as const;
  if (required.some((job) => job.state === "failed")) return "failed" as const;
  if (required.some((job) => !["succeeded", "superseded"].includes(job.state)))
    return "pending" as const;
  return required.every((job) => job.state === "superseded")
    ? ("superseded" as const)
    : ("ready" as const);
}
