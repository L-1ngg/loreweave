import { z } from "zod";

export const connectionInput = z
  .object({
    id: z.string().uuid().optional(),
    expectedRevision: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    provider: z.enum(["openai", "openai-compatible"]),
    apiKey: z.string().min(1).max(4096).optional(),
    baseURL: z.string().url().max(500).optional().or(z.literal("")),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.id && !value.apiKey)
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "API Key is required",
      });
    if (value.provider === "openai-compatible" && !value.baseURL)
      ctx.addIssue({
        code: "custom",
        path: ["baseURL"],
        message: "Base URL is required",
      });
  });
export const roleInput = z
  .object({
    role: z.enum(["index", "qa"]),
    connectionId: z.string().uuid(),
    model: z.string().trim().min(1).max(200),
  })
  .strict();
export type ConnectionInput = z.infer<typeof connectionInput>;
export type RoleInput = z.infer<typeof roleInput>;
