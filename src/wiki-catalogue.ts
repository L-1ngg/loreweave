import { Operations } from "./operations.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "./embeddings.ts";
import { lexicalText } from "./indexing.ts";
import type { TopicDescriptor, WikiCandidate } from "./wiki-types.ts";
export interface CataloguePool {
  cards: WikiCandidate[];
  ranks: Record<
    string,
    Partial<Record<"title" | "entity" | "lexical" | "vector", number>>
  >;
  count: number;
  scopeRevisions: Record<string, number>;
  unavailable: string[];
  routeTotals: Record<string, number>;
  truncated: boolean;
}
export class WikiCatalogue {
  constructor(
    private readonly operations: Operations,
    private readonly embeddings: EmbeddingAdapter,
  ) {}
  async find(
    organizationId: string,
    scope: string,
    topic: TopicDescriptor,
    signal: AbortSignal,
    entities: string[] = [],
  ): Promise<CataloguePool> {
    let vector: number[] | undefined;
    const unavailable: string[] = [];
    try {
      const vectors = await this.embeddings.embed(
        [descriptorText(topic)],
        signal,
      );
      validateEmbeddings(vectors, 1, this.embeddings.dimensions);
      vector = vectors[0]!;
    } catch {
      signal.throwIfAborted();
      unavailable.push("vector");
    }
    const query = lexicalText(descriptorText(topic))
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `'${term.replaceAll("'", "''")}'`)
      .join(" | ");
    const sql = this.operations.sql;
    const statement = sql`WITH candidates AS (
   SELECT p.id,p.project_id,p.lifecycle,p.created_at,v.id AS version,v.title,c.descriptor,e.eligible,c.normalized_title,c.routing_aliases AS aliases,
    (c.normalized_title=${normalizeTitle(topic.title)} OR c.routing_aliases ? ${normalizeTitle(topic.title)}) AS title_exact,
    c.title_search @@ to_tsquery('simple',${query}) AS title_match,ts_rank_cd(c.title_search,to_tsquery('simple',${query})) AS title_score,
    c.lexical @@ to_tsquery('simple',${query}) AS lexical_match,ts_rank_cd(c.lexical,to_tsquery('simple',${query})) AS lexical_score,
    (SELECT count(*) FROM jsonb_array_elements_text(c.subject_ids) subject WHERE subject.value IN (SELECT jsonb_array_elements_text(${sql.json(entities)}::jsonb))) AS entity_score,
    (c.embedding IS NOT NULL AND c.embedding_profile=${this.embeddings.profile} AND c.dimensions=${this.embeddings.dimensions}) AS vector_ready,
    CASE WHEN c.embedding_profile=${this.embeddings.profile} AND c.dimensions=${this.embeddings.dimensions} THEN c.embedding <=> ${vector ? JSON.stringify(vector) : null}::vector END AS distance
   FROM wiki_pages p JOIN wiki_routing_catalogue c ON c.page_id=p.id JOIN wiki_versions v ON v.id=c.version_id JOIN wiki_version_eligibility e ON e.id=v.id
   WHERE p.organization_id=${organizationId} AND (p.project_id IS NULL OR p.project_id::text=${scope})
  ), routes AS (
   (SELECT 'title' AS route,to_jsonb(candidates) AS card,row_number() OVER(ORDER BY title_exact DESC,title_score DESC,id) AS rank FROM candidates WHERE title_exact OR title_match ORDER BY title_exact DESC,title_score DESC,id LIMIT 20)
   UNION ALL (SELECT 'entity',to_jsonb(candidates),row_number() OVER(ORDER BY entity_score DESC,lexical_score DESC,id) FROM candidates WHERE entity_score>0 ORDER BY entity_score DESC,lexical_score DESC,id LIMIT 20)
   UNION ALL (SELECT 'lexical',to_jsonb(candidates),row_number() OVER(ORDER BY lexical_score DESC,id) FROM candidates WHERE lexical_match ORDER BY lexical_score DESC,id LIMIT 20)
   UNION ALL (SELECT 'vector',to_jsonb(candidates),row_number() OVER(ORDER BY distance,id) FROM candidates WHERE distance IS NOT NULL ORDER BY distance,id LIMIT 20)
  ) SELECT route,card,rank FROM routes UNION ALL SELECT 'meta',jsonb_build_object(
   'count',(SELECT count(*) FROM candidates),'vectorReady',(SELECT count(*) FILTER(WHERE NOT vector_ready)=0 FROM candidates),
   'scopeRevisions',jsonb_build_object('shared',COALESCE((SELECT revision FROM wiki_catalogue_scopes WHERE organization_id=${organizationId} AND scope='shared'),0),${scope}::text,COALESCE((SELECT revision FROM wiki_catalogue_scopes WHERE organization_id=${organizationId} AND scope=${scope}),0)),
   'routeTotals',jsonb_build_object('title',(SELECT count(*) FROM candidates WHERE title_exact OR title_match),'entity',(SELECT count(*) FROM candidates WHERE entity_score>0),'lexical',(SELECT count(*) FROM candidates WHERE lexical_match),'vector',(SELECT count(*) FROM candidates WHERE distance IS NOT NULL))
  ),0`;
    const cancel = () => statement.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const rows = await statement;
      signal.throwIfAborted();
      const meta = rows.find((row) => row.route === "meta")!.card;
      if (!meta.vectorReady && !unavailable.includes("vector"))
        unavailable.push("vector");
      const ranked = new Map<
        string,
        {
          card: WikiCandidate;
          score: number;
          routes: CataloguePool["ranks"][string];
        }
      >();
      for (const row of rows.filter((row) => row.route !== "meta")) {
        const value = row.card,
          id = String(value.id),
          entry: {
            card: WikiCandidate;
            score: number;
            routes: CataloguePool["ranks"][string];
          } = ranked.get(id) ?? {
            score: 0,
            routes: {},
            card: {
              id,
              version: String(value.version),
              title: compactDescriptor(value.descriptor).descriptor.title,
              descriptor: compactDescriptor(value.descriptor).descriptor,
              omitted: compactDescriptor(value.descriptor).omitted,
              fresh: Boolean(value.eligible) && value.lifecycle === "active",
              ...(value.project_id
                ? { projectId: String(value.project_id) }
                : {}),
            },
          };
        const route = row.route as "title" | "entity" | "lexical" | "vector",
          rank = Number(row.rank);
        entry.routes[route] = rank;
        entry.score += 1 / (60 + rank);
        ranked.set(id, entry);
      }
      const ordered = [...ranked.values()].sort(
        (a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id),
      );
      return {
        cards: ordered.slice(0, 40).map((item) => item.card),
        ranks: Object.fromEntries(
          ordered.map((item) => [item.card.id, item.routes]),
        ),
        count: Number(meta.count),
        scopeRevisions: meta.scopeRevisions,
        unavailable,
        routeTotals: meta.routeTotals,
        truncated:
          ordered.length > 40 ||
          Object.values(meta.routeTotals as Record<string, number>).some(
            (count) => count > 20,
          ),
      };
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
}
export function normalizeTitle(text: string) {
  return text.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
}
export function descriptorText(topic: TopicDescriptor) {
  return [
    topic.title,
    ...topic.aliases,
    topic.question,
    topic.inclusion,
    topic.exclusion,
  ].join("\n");
}

function compactDescriptor(topic: TopicDescriptor): {
  descriptor: TopicDescriptor;
  omitted: string[];
} {
  let remaining = 160;
  const omitted: string[] = [];
  const keep = (key: string, value: string) => {
    let text = "";
    for (const point of value) {
      const size = new TextEncoder().encode(point).length;
      if (size > remaining) {
        omitted.push(key);
        break;
      }
      text += point;
      remaining -= size;
    }
    return text;
  };
  const subjectKey = keep("subjectKey", topic.subjectKey),
    aspectKey = keep("aspectKey", topic.aspectKey),
    title = keep("title", topic.title),
    question = keep("question", topic.question),
    inclusion = keep("inclusion", topic.inclusion),
    exclusion = keep("exclusion", topic.exclusion),
    aliases = topic.aliases
      .map((alias, index) => keep(`alias:${index}`, alias))
      .filter(Boolean);
  return {
    descriptor: {
      ...topic,
      subjectKey,
      aspectKey,
      title,
      question,
      inclusion,
      exclusion,
      aliases,
      handles: [],
    },
    omitted,
  };
}
