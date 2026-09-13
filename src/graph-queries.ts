import { lexicalText } from "./indexing.ts";
import type { AccessService, TrustedContext } from "./access.ts";
import type { Operations } from "./operations.ts";
import type { GraphRelation } from "./graph-types.ts";
export interface GraphSearchOptions {
  entityHints?: string[];
  predicate?: string;
  direction?: "incoming" | "outgoing" | "both";
  hops?: 1 | 2;
  indirectNeed?: string;
  time?: string;
  environment?: string;
}
interface Claim {
  id: string;
  subjectMention: string;
  objectMention: string;
  predicate: string;
  direction: string;
  qualifiers: GraphRelation["qualifiers"];
  relationText: string;
  sourceVersion: string;
  support: Array<{ version: string; passageId: string }>;
}
/** Bounded breadth-first traversal over currently eligible support memberships. */
export class GraphQueries {
  constructor(
    private readonly operations: Operations,
    private readonly access: AccessService,
  ) {}
  async neighborhood(
    token: string,
    input: {
      entityId: string;
      projectId?: string;
      predicate?: string;
      hops?: number;
    },
    signal?: AbortSignal,
  ) {
    const context = await this.access.authorize(token, "read", input.projectId);
    return this.walk(
      context,
      [input.entityId],
      Math.min(2, Math.max(1, input.hops ?? 2)),
      input.predicate,
      signal,
    );
  }
  async search(
    token: string,
    question: string,
    projectId?: string,
    signal?: AbortSignal,
    options: GraphSearchOptions = {},
  ) {
    const context = await this.access.authorize(token, "read", projectId);
    signal?.throwIfAborted();
    if (
      (options.entityHints?.length ?? 0) > 8 ||
      options.entityHints?.some((hint) => !hint.trim() || hint.length > 200) ||
      (options.hops !== undefined && ![1, 2].includes(options.hops)) ||
      (options.hops === 2 && !options.indirectNeed?.trim()) ||
      (options.direction !== undefined &&
        !["incoming", "outgoing", "both"].includes(options.direction))
    )
      throw new Error("invalid_input");
    const sql = this.operations.sql;
    const names =
      options.entityHints?.map((hint) =>
        hint.normalize("NFKC").trim().toLowerCase(),
      ) ?? [];
    const seeds = await cancellable(
      sql`SELECT DISTINCT rev.canonical_id AS id,lower(normalize(m.original_text,NFKC)) AS name,d.project_id FROM identity_mentions m
      JOIN identity_revisions rev ON rev.id=m.current_revision_id JOIN source_documents d ON d.active_version_id=m.version_id
      WHERE m.organization_id=${context.organizationId}
      AND ((${!names.length} AND position(lower(normalize(m.original_text,NFKC)) IN lower(${question.normalize("NFKC")}))>0) OR lower(normalize(m.original_text,NFKC)) IN (SELECT value FROM jsonb_array_elements_text(${sql.json(names)}::jsonb)) OR rev.canonical_id::text IN (SELECT value FROM jsonb_array_elements_text(${sql.json(names)}::jsonb)))
      AND (${projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${projectId ?? null})
      AND EXISTS(SELECT 1 FROM identity_proof_eligibility pe WHERE pe.revision_id=rev.id AND pe.valid)
      ORDER BY name,id,project_id LIMIT 50`,
      signal,
    );
    const groups = new Map<string, Set<string>>();
    for (const seed of seeds) {
      const ids = groups.get(String(seed.name)) ?? new Set<string>();
      ids.add(String(seed.id));
      groups.set(String(seed.name), ids);
    }
    const ambiguousNames = new Set(
      [...groups].filter(([, ids]) => ids.size > 1).map(([name]) => name),
    );
    const ambiguity = seeds
      .filter((seed) => ambiguousNames.has(String(seed.name)))
      .map((seed) => ({
        id: String(seed.id),
        name: String(seed.name),
        projectId: seed.project_id as string | null,
      }));
    const resolved = [
      ...new Set(
        seeds
          .filter((seed) => !ambiguousNames.has(String(seed.name)))
          .map((seed) => String(seed.id)),
      ),
    ];
    const predicates = [
      "responsibility",
      "membership",
      "ownership",
      "part_of",
      "dependency",
      "usage",
      "applicability",
    ];
    const predicate =
      options.predicate === "depends_on" ? "dependency" : options.predicate;
    const unknownPredicate = Boolean(
      predicate && !predicates.includes(predicate),
    );
    const result = await this.walk(
      context,
      resolved.slice(0, 8),
      options.hops ?? 1,
      unknownPredicate ? undefined : predicate,
      signal,
      options,
      lexicalText(question.normalize("NFKC"))
        .split(" ")
        .filter(Boolean)
        .slice(0, 32),
    );
    return {
      ...result,
      ambiguity,
      truncated: result.truncated || resolved.length > 8 || seeds.length === 50,
      gaps: [
        ...result.gaps,
        ...(ambiguity.length ? ["entity_ambiguous"] : []),
        ...(!resolved.length ? ["entity_unresolved"] : []),
        ...(unknownPredicate ? ["unknown_relation_unconstrained"] : []),
      ],
    };
  }
  private async walk(
    context: TrustedContext,
    seeds: string[],
    hops: number,
    predicate?: string,
    signal?: AbortSignal,
    options: GraphSearchOptions = {},
    queryTerms: string[] = [],
  ) {
    const sql = this.operations.sql;
    const entities = new Set(seeds),
      claims = new Map<string, Claim>();
    type Edge = {
      claimId: string;
      from: string;
      to: string;
      traversal: "forward" | "reverse";
      qualifiers: GraphRelation["qualifiers"];
    };
    const paths = new Map<string, { seed: string; edges: Edge[] }>(
      seeds.map((seed) => [seed, { seed, edges: [] }]),
    );
    const orderedPaths: Array<{
      seed: string;
      edges: Edge[];
      interpretation: "discovery-path";
    }> = [];
    let frontier = [...entities],
      truncated = false;
    for (let depth = 0; depth < hops && frontier.length; depth++) {
      signal?.throwIfAborted();
      const query = sql`SELECT c.id,c.subject_id,c.object_id,c.predicate,c.direction,c.qualifiers,c.relation_text,
        jsonb_agg(DISTINCT jsonb_build_object('version',s.source_version_id,'locators',s.locators)) AS supports
        FROM graph_claims c JOIN graph_supports s ON s.claim_id=c.id
        JOIN graph_generations g ON g.id=s.generation_id AND g.state='active'
        JOIN source_documents d ON d.active_version_id=s.source_version_id
        WHERE c.organization_id=${context.organizationId} AND c.status='active'
        AND (c.subject_id::text IN ${sql(frontier)} OR c.object_id::text IN ${sql(frontier)})
        AND (${predicate ?? null}::text IS NULL OR c.predicate=${predicate ?? null})
        AND (${options.direction ?? "both"}='both' OR (${options.direction ?? "both"}='outgoing' AND (CASE WHEN c.direction='reverse' THEN c.object_id ELSE c.subject_id END)::text IN ${sql(frontier)}) OR (${options.direction ?? "both"}='incoming' AND (CASE WHEN c.direction='reverse' THEN c.subject_id ELSE c.object_id END)::text IN ${sql(frontier)}))
        AND (${options.time ?? null}::text IS NULL OR c.qualifiers->>'time'=${options.time ?? null})
        AND (${options.environment ?? null}::text IS NULL OR c.qualifiers->>'environment'=${options.environment ?? null})
        AND (${context.scope.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${context.scope.projectId ?? null})
        AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(s.identity_dependencies) dep(mention_id uuid,revision_id uuid,proof_id uuid)
          LEFT JOIN identity_mentions m ON m.id=dep.mention_id
          LEFT JOIN identity_proof_eligibility pe ON pe.id=dep.proof_id AND pe.revision_id=dep.revision_id AND pe.valid
          WHERE m.current_revision_id IS DISTINCT FROM dep.revision_id OR pe.id IS NULL)
        GROUP BY c.id ORDER BY
        (SELECT count(*) FROM jsonb_array_elements_text(${sql.json(queryTerms)}::jsonb) term
          WHERE position(term.value IN lower(normalize(c.relation_text||' '||c.qualifiers::text,NFKC)))>0) DESC,
        CASE WHEN ${queryTerms.length}>0 THEN c.relation_text END,c.id LIMIT 101`;
      const rows = await cancellable(query, signal);
      if (rows.length > 100) truncated = true;
      const next = new Set<string>();
      for (const row of rows.slice(0, 100)) {
        const id = String(row.id),
          subject = String(row.subject_id),
          object = String(row.object_id);
        if (claims.has(id)) continue;
        const extra = [subject, object].filter(
          (entity) => !entities.has(entity),
        );
        if (claims.size >= 100 || entities.size + new Set(extra).size > 50) {
          truncated = true;
          continue;
        }
        for (const entity of extra) {
          entities.add(entity);
          next.add(entity);
        }
        const support = [
          ...new Map(
            (row.supports as Array<{ version: string; locators: string[] }>)
              .flatMap((source) =>
                source.locators.map((passageId) => ({
                  version: source.version,
                  passageId,
                })),
              )
              .map((ref) => [`${ref.version}:${ref.passageId}`, ref]),
          ).values(),
        ];
        const from = frontier.includes(subject) ? subject : object;
        const to = from === subject ? object : subject;
        const prior = paths.get(from) ?? { seed: from, edges: [] };
        const actualFrom = row.direction === "reverse" ? object : subject;
        const path = {
          seed: prior.seed,
          edges: [
            ...prior.edges,
            {
              claimId: id,
              from: actualFrom,
              to: actualFrom === subject ? object : subject,
              traversal:
                from === actualFrom
                  ? ("forward" as const)
                  : ("reverse" as const),
              qualifiers: row.qualifiers,
            },
          ],
        };
        if (!paths.has(to)) paths.set(to, path);
        orderedPaths.push({ ...path, interpretation: "discovery-path" });
        claims.set(id, {
          id,
          subjectMention: subject,
          objectMention: object,
          predicate: String(row.predicate),
          direction: String(row.direction),
          qualifiers: row.qualifiers,
          relationText: String(row.relation_text),
          sourceVersion: support[0]!.version,
          support,
        });
      }
      frontier = [...next];
    }
    const coverage = await this.coverage(context, signal);
    return {
      orderedPaths,
      claims: [...claims.values()],
      entities: [...entities],
      truncated,
      ...coverage,
    };
  }
  private async coverage(context: TrustedContext, signal?: AbortSignal) {
    const [row] = await cancellable(
      this.operations.sql`WITH relevant_sources AS (
      SELECT d.id,d.active_version_id FROM source_documents d
      WHERE d.organization_id=${context.organizationId}
      AND (${context.scope.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${context.scope.projectId ?? null})
    ), relevant_mentions AS (
      SELECT m.id::text AS id FROM identity_mentions m JOIN relevant_sources d ON d.active_version_id=m.version_id
      UNION SELECT endpoint.value FROM graph_packets p JOIN graph_generations g ON g.id=p.generation_id
        JOIN relevant_sources d ON d.active_version_id=g.source_version_id,
        jsonb_array_elements_text(p.endpoint_mentions) endpoint
      WHERE g.state IN('active','staged','failed')
    ) SELECT
      EXISTS(SELECT 1 FROM knowledge_jobs j JOIN knowledge_operations o ON o.id=j.operation_id
        WHERE o.organization_id=${context.organizationId} AND j.kind LIKE 'graph.%' AND j.state IN('queued','running','retry_wait','outcome_unknown')
        AND (j.payload->>'versionId' IN (SELECT active_version_id::text FROM relevant_sources)
          OR j.payload->>'mentionId' IN (SELECT id FROM relevant_mentions)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(j.payload->'mentionIds','[]')) mention WHERE mention.value IN (SELECT id FROM relevant_mentions)))) AS pending,
      EXISTS(SELECT 1 FROM graph_generations g JOIN relevant_sources d ON d.active_version_id=g.source_version_id
        WHERE g.state='failed' AND NOT EXISTS(SELECT 1 FROM graph_generations newer
          WHERE newer.source_version_id=g.source_version_id AND newer.state IN('active','staged','failed')
          AND (newer.created_at,newer.id)>(g.created_at,g.id))) AS incomplete,
      EXISTS(SELECT 1 FROM graph_generations g JOIN relevant_sources d ON d.active_version_id=g.source_version_id JOIN graph_packets p ON p.generation_id=g.id
        WHERE g.state='active' AND p.exclusions<>'[]'::jsonb) AS exclusions`,
      signal,
    );
    return {
      pending: row?.pending === true,
      gaps: [
        ...(row?.incomplete ? ["graph_incomplete"] : []),
        ...(row?.exclusions ? ["graph_exclusions"] : []),
      ],
    };
  }
}
async function cancellable<T>(
  query: PromiseLike<T> & { cancel(): void },
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const cancel = () => query.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await query;
    signal?.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
