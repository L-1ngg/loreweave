import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireWeb } from "../server/access";
import {
  createConversation,
  listConversations,
  conversationSnapshot,
  acceptQuestion,
  dispatchQuestion,
  inspectRun,
  stopRun,
  renameConversation,
  deleteConversation,
} from "../server/knowledge";
import { questionInput } from "../contracts/knowledge";
export const getConversations = createServerFn({ method: "GET" }).handler(
  async () => listConversations(await requireWeb()),
);
export const newConversation = createServerFn({ method: "POST" }).handler(
  async () => createConversation(await requireWeb()),
);
export const getConversation = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    conversationSnapshot(await requireWeb(), data.id),
  );
export const askQuestion = createServerFn({ method: "POST" })
  .validator(questionInput)
  .handler(async ({ data }) => {
    const result = await acceptQuestion(await requireWeb(), data);
    if (result.created) dispatchQuestion(result.runId);
    return result;
  });
export const getRun = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => inspectRun(await requireWeb(), data.id));
export const stopQuestion = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => stopRun(await requireWeb(), data.id));
export const renameChat = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    renameConversation(await requireWeb(), data.id, data.name),
  );
export const removeChat = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => deleteConversation(await requireWeb(), data.id));
