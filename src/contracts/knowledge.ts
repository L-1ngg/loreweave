import { z } from "zod";
export const scopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("library") }).strict(),
  z
    .object({
      mode: z.literal("selected"),
      documentIds: z.array(z.string().uuid()).min(1).max(30),
    })
    .strict(),
]);
export type Scope = z.infer<typeof scopeSchema>;
export type Pin = { versionId: string; indexId: string; pageCount: number };
export const answerSchema = z
  .object({
    outcome: z.enum(["answer", "clarification", "evidence_gap", "incomplete"]),
    text: z
      .string()
      .min(1)
      .max(100000)
      .describe(
        "Markdown answer. Cite original-backed claims using exactly [Document name · pN](cite:referenceId) with a referenceId returned by this run's get_page_content. Use ordinary Markdown links, never provider-native citation markers or invented IDs.",
      ),
  })
  .strict();
export type Answer = z.infer<typeof answerSchema>;
export type RunStatus =
  | "queued"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";
export const questionInput = z
  .object({
    conversationId: z.string().uuid(),
    submissionId: z.string().uuid(),
    messageId: z
      .string()
      .max(128)
      .regex(/^msg-[a-zA-Z0-9-]+$/)
      .optional(),
    question: z.string().trim().min(1).max(8000),
    scope: scopeSchema.optional(),
  })
  .strict();
export const independentQuestionInput = z
  .object({
    question: z.string().trim().min(1).max(8000),
    scope: scopeSchema.optional(),
  })
  .strict();
export const independentAnswerSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["completed", "failed", "stopped", "interrupted"]),
  reason: z.string().nullable(),
  answer: answerSchema.nullable(),
  scope: scopeSchema,
  references: z.array(
    z.object({
      id: z.string().uuid(),
      runId: z.string().uuid(),
      documentId: z.string().uuid(),
      documentName: z.string(),
      versionId: z.string().uuid(),
      page: z.number().int().min(1),
      label: z.string().nullable(),
      uri: z.string(),
    }),
  ),
  usage: z.object({
    modelCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    toolCalls: z.number().int().optional(),
    readPages: z.number().int().optional(),
    elapsedMs: z.number().optional(),
  }),
});
