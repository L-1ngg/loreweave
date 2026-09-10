import { lexicalText } from "./indexing.ts";
import { jsonValue, type Transaction } from "./operations.ts";
import { normalizeTitle, descriptorText } from "./wiki-catalogue.ts";
import type { TopicDescriptor } from "./wiki-types.ts";

export interface PageState {
  version: string;
  lifecycle: string;
  retirement: { reason: string; at: string; operationId: string } | null;
  successors: string[];
}

export async function pageState(
  tx: Transaction,
  pageId: string,
): Promise<PageState | null> {
  const [page] =
    await tx`SELECT current_version_id,lifecycle,retirement FROM wiki_pages WHERE id=${pageId} FOR UPDATE`;
  if (!page) return null;
  const routes =
    await tx`SELECT successor_id FROM wiki_page_routes WHERE page_id=${pageId} ORDER BY successor_id`;
  return {
    version: String(page.current_version_id),
    lifecycle: String(page.lifecycle),
    retirement: page.retirement,
    successors: routes.map((row) => String(row.successor_id)),
  };
}

/** Copy an immutable reviewed version. Live eligibility remains authoritative for restored content. */
export async function copyWikiVersion(
  tx: Transaction,
  input: {
    pageId: string;
    versionId: string;
    operationId: string;
    reason: string;
    restored?: boolean;
  },
) {
  const versionId = crypto.randomUUID();
  const [version] =
    await tx`INSERT INTO wiki_versions(id,page_id,operation_id,expected_prior,title,body,sources,identity_dependencies,certificates,descriptor,restored_from,reason) SELECT ${versionId},v.page_id,${input.operationId},p.current_version_id,v.title,v.body,v.sources,v.identity_dependencies,v.certificates,v.descriptor,${input.restored ? input.versionId : null},${input.reason} FROM wiki_versions v JOIN wiki_pages p ON p.id=v.page_id WHERE v.id=${input.versionId} AND v.page_id=${input.pageId} RETURNING *`;
  if (!version) throw new Error("not_found");
  await tx`INSERT INTO wiki_page_sources SELECT ${versionId},source_version_id,passage_id FROM wiki_page_sources WHERE version_id=${input.versionId}`;
  await tx`INSERT INTO wiki_version_inputs SELECT ${versionId},source_version_id FROM wiki_version_inputs WHERE version_id=${input.versionId}`;
  const topic = version.descriptor as TopicDescriptor;
  await tx`UPDATE wiki_pages SET current_version_id=${versionId} WHERE id=${input.pageId}`;
  await tx`UPDATE wiki_catalogue SET version_id=${versionId},normalized_title=${normalizeTitle(topic.title)},subject_key=${topic.subjectKey},aspect_key=${topic.aspectKey},descriptor=${tx.json(jsonValue(topic))},lexical_text=${lexicalText(descriptorText(topic))},embedding=NULL,aliases=${tx.json(topic.aliases.map(normalizeTitle))},title_lexical=${lexicalText([topic.title, ...topic.aliases].join(" "))},subject_ids='[]'::jsonb,body_lexical=${lexicalText(String(version.body))} WHERE page_id=${input.pageId}`;
  const entities =
    await tx`SELECT DISTINCT r.canonical_id FROM wiki_versions v,jsonb_array_elements(v.identity_dependencies) ref JOIN identity_mentions m ON m.id=(ref->>'mentionId')::uuid AND m.current_revision_id=(ref->>'revisionId')::uuid JOIN identity_revisions r ON r.id=m.current_revision_id JOIN identity_proof_eligibility p ON p.id=(ref->>'proofId')::uuid AND p.revision_id=r.id AND p.valid WHERE v.id=${versionId}`;
  await tx`UPDATE wiki_catalogue SET subject_ids=${tx.json(entities.map((row) => String(row.canonical_id)))} WHERE page_id=${input.pageId}`;
  return versionId;
}

export async function recordPageEdit(
  tx: Transaction,
  editSetId: string,
  pageId: string,
  before: PageState | null,
) {
  const after = await pageState(tx, pageId);
  if (!after) throw new Error("not_found");
  await tx`INSERT INTO wiki_edit_pages(edit_set_id,page_id,before_state,after_state) VALUES(${editSetId},${pageId},${before ? tx.json(jsonValue(before)) : null},${tx.json(jsonValue(after))})`;
}
