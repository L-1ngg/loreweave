import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { Operations } from "../src/operations.ts";
import { ModelAdmission } from "../src/model-admission.ts";
import { WikiModelRuntime } from "../src/wiki-model-runtime.ts";
import { OpenAIKnowledgeModel } from "../src/providers/chat.ts";
import { hash } from "../src/answer-validation.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");

for (const scenario of [
  "slow response",
  "hard deadline",
  "received checkpoint",
] as const)
  test(`maintenance ${scenario} preserves completion, deadlines and request accounting`, async () => {
    const access = new AccessService(url!);
    await access.migrate();
    const account = {
      organization: `late-${crypto.randomUUID()}`,
      username: "admin",
      password: "maintenance-password",
    };
    await access.bootstrap(account);
    const { token } = await access.login(account);
    const context = await access.authorize(token, "import");
    const operations = new Operations(url!);
    const admission = new ModelAdmission(url!);
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        calls++;
        await Bun.sleep(650);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ topics: [], coverage: [] }),
              },
            },
          ],
        });
      },
    });
    const model = new OpenAIKnowledgeModel({
      fetch: admission.fetch,
      baseUrl: server.url.toString(),
      apiKey: "fixture",
      model: "fixture",
      timeoutMs: 40,
    });
    const runtime = new WikiModelRuntime(operations, model);
    try {
      const operation = await operations.accept(
        context,
        crypto.randomUUID(),
        "fixture",
        async (tx, id) => {
          await operations.enqueue(tx, id, "fixture.maintenance", {});
        },
      );
      let result: unknown;
      await operations.execute(
        {
          kinds: ["fixture.maintenance"],
          organizationId: context.organizationId,
        },
        async (job) => {
          if (scenario !== "slow response")
            await operations.checkpoint(job, async (tx) => {
              await tx`INSERT INTO wiki_work(job_id) VALUES(${job.id})`;
              await tx`INSERT INTO wiki_work_units(job_id,unit_key,deadline) VALUES(${job.id},'packet:0',clock_timestamp()+${scenario === "hard deadline" ? 100 : 5000}*interval '1 millisecond')`;
              if (scenario === "received checkpoint")
                await tx`INSERT INTO wiki_model_attempts(job_id,unit_key,phase,attempt,input_hash,model_profile,prompt_profile,state,response,dispatched_at) VALUES(${job.id},'packet:0','extraction',1,${hash({})},${model.profile},'wiki-request-v2','received',${tx.json({ topics: [], coverage: [] })},clock_timestamp())`;
            });
          result = await runtime.request(
            job,
            "packet:0",
            "extraction",
            scenario === "received checkpoint" ? 1 : 2,
            {},
            (raw) => raw,
          );
          await operations.commit(job, async () => {});
        },
        async (tx, job, error) => {
          await tx`UPDATE knowledge_jobs SET reason=${error instanceof Error ? error.message : "unknown"} WHERE id=${job.id}`;
          return "failed";
        },
      );
      const [job] =
        await operations.sql`SELECT state,reason FROM knowledge_jobs WHERE operation_id=${operation}`;
      expect(job!.state).toBe(
        scenario === "hard deadline" ? "failed" : "succeeded",
      );
      expect(result).toEqual(
        scenario === "hard deadline" ? undefined : { topics: [], coverage: [] },
      );
      expect(calls).toBe(scenario === "received checkpoint" ? 0 : 1);
      const attempts =
        await operations.sql`SELECT a.state,a.response FROM wiki_model_attempts a JOIN knowledge_jobs j ON j.id=a.job_id WHERE j.operation_id=${operation}`;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.state).toBe(
        scenario === "hard deadline" ? "failed" : "completed",
      );
      if (scenario === "hard deadline") {
        expect(job!.reason).toBe("maintenance_deadline");
        await admission.settled(operation);
        expect((await admission.status()).active).toBe(0);
        expect(attempts[0]!.response).toBeNull();
      } else expect(attempts[0]!.response).toEqual(result);
    } finally {
      await admission.close();
      server.stop(true);
      await operations.close();
      await access.close();
    }
  }, 10000);
