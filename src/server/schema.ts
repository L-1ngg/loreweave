import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import type {
  Extraction,
  PdfPage,
  TreeNode,
  IndexMode,
  WorkStatus,
} from "../contracts/documents";
import type { CapturedModel } from "./models";
import type { ModelMessage, RunRecord } from "@tanstack/ai";
import type { Scope, Pin, Answer, RunStatus } from "../contracts/knowledge";

export const owners = pgTable("owners", {
  singleton: text("singleton").primaryKey(),
  id: uuid("id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => owners.id),
  credentialVersion: text("credential_version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const mcpTokens = pgTable("mcp_tokens", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => owners.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
export const modelConnections = pgTable("model_connections", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  currentRevision: uuid("current_revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const connectionRevisions = pgTable("connection_revisions", {
  id: uuid("id").primaryKey(),
  connectionId: uuid("connection_id").notNull(),
  provider: text("provider").$type<"openai" | "openai-compatible">().notNull(),
  baseURL: text("base_url").notNull(),
  sealedKey: text("sealed_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const modelRoles = pgTable("model_roles", {
  ownerId: uuid("owner_id").notNull(),
  role: text("role").$type<"index" | "qa">().notNull(),
  connectionId: uuid("connection_id").notNull(),
  model: text("model").notNull(),
});
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  libraryRevision: integer("library_revision").notNull().default(0),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  effectiveVersion: uuid("effective_version"),
  effectiveIndex: uuid("effective_index"),
  latestVersion: uuid("latest_version").notNull(),
  latestOperation: uuid("latest_operation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sourceVersions = pgTable("source_versions", {
  id: uuid("id").primaryKey(),
  documentId: uuid("document_id").notNull(),
  contentHash: text("content_hash").notNull(),
  filename: text("filename").notNull(),
  byteLength: integer("byte_length").notNull(),
  pageCount: integer("page_count"),
  extractionMeta: jsonb("extraction_meta").$type<Omit<Extraction, "pages">>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const documentPages = pgTable(
  "document_pages",
  {
    versionId: uuid("version_id").notNull(),
    physicalPage: integer("physical_page").notNull(),
    artifact: jsonb("artifact").$type<PdfPage>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.physicalPage] })],
);
export const indexOperations = pgTable("index_operations", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  documentId: uuid("document_id").notNull(),
  versionId: uuid("version_id").notNull(),
  submissionId: uuid("submission_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  action: text("action").$type<"upload" | "update">().notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  latestAttempt: uuid("latest_attempt").notNull(),
  status: text("status").$type<WorkStatus>().notNull(),
  stage: text("stage").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type StageManifest = {
  valid: true;
  sourceVersion: string;
  extractorRevision: string;
  digest: string;
  compatibility: string;
};
export type Usage = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  readPages?: number;
  toolCalls?: number;
  elapsedMs?: number;
};
export const indexingAttempts = pgTable("indexing_attempts", {
  id: uuid("id").primaryKey(),
  operationId: uuid("operation_id").notNull(),
  mode: text("mode").$type<IndexMode>().notNull(),
  modelConfig: jsonb("model_config").$type<CapturedModel>().notNull(),
  status: text("status").$type<WorkStatus>().notNull(),
  stage: text("stage").notNull(),
  reason: text("reason"),
  manifests: jsonb("manifests")
    .$type<Record<string, StageManifest>>()
    .notNull(),
  draftTree: jsonb("draft_tree").$type<TreeNode[]>(),
  usage: jsonb("usage").$type<Usage>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export const indexRevisions = pgTable("index_revisions", {
  id: uuid("id").primaryKey(),
  versionId: uuid("version_id").notNull(),
  attemptId: uuid("attempt_id").notNull(),
  mode: text("mode").$type<IndexMode>().notNull(),
  tree: jsonb("tree").$type<TreeNode[]>().notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const indexRetrySubmissions = pgTable(
  "index_retry_submissions",
  {
    ownerId: uuid("owner_id").notNull(),
    submissionId: uuid("submission_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    attemptId: uuid("attempt_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.submissionId] })],
);
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  scope: jsonb("scope").$type<Scope>().notNull().default({ mode: "library" }),
  activeRun: uuid("active_run"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const chatThreads = pgTable("chat_threads", {
  threadId: text("thread_id").primaryKey(),
  messages: jsonb("messages").$type<ModelMessage[]>().notNull(),
});
export const sdkRuns = pgTable("sdk_runs", {
  runId: text("run_id").primaryKey(),
  threadId: text("thread_id").notNull(),
  record: jsonb("record").$type<RunRecord>().notNull(),
});
export const knowledgeRuns = pgTable("knowledge_runs", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  conversationId: uuid("conversation_id"),
  threadId: text("thread_id").notNull(),
  channel: text("channel").$type<"web" | "mcp">().notNull(),
  tokenId: uuid("token_id"),
  submissionId: uuid("submission_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  question: text("question").notNull(),
  modelConfig: jsonb("model_config").$type<CapturedModel>().notNull(),
  scope: jsonb("scope").$type<Scope>().notNull(),
  pins: jsonb("pins").$type<Record<string, Pin>>().notNull(),
  status: text("status").$type<RunStatus>().notNull(),
  reason: text("reason"),
  result: jsonb("result").$type<Answer>(),
  usage: jsonb("usage").$type<Usage>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export const sourceReferences = pgTable("source_references", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull(),
  documentId: uuid("document_id").notNull(),
  versionId: uuid("version_id").notNull(),
  physicalPage: integer("physical_page").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  contentDigest: text("content_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
