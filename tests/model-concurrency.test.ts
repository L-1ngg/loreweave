import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";
import { ModelAdmission } from "../src/model-admission.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");

test("AC06/16: three processes share actual chat and embedding HTTP capacity", async () => {
  const access = new AccessService(url!);
  await access.migrate();
  await access.close();
  const observer = new ModelAdmission(url!);
  const waiting = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();
  let active = 0,
    background = 0,
    peak = 0,
    backgroundPeak = 0,
    received = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const key = new URL(request.url).pathname;
      active++;
      received++;
      if (key.includes("background")) background++;
      peak = Math.max(peak, active);
      backgroundPeak = Math.max(backgroundPeak, background);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            waiting.set(key, controller);
            controller.enqueue(new TextEncoder().encode("started"));
          },
        }),
      );
    },
  });
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const start = (name: string, priority: "background" | "interactive") => {
    children.push(
      Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "-e",
          `
      import {ModelAdmission,withModelWork} from './src/model-admission.ts';
      const a=new ModelAdmission(process.env.TEST_DATABASE_URL);
      try { await Promise.all(Array.from({length:4},(_,i)=>withModelWork({operationId:crypto.randomUUID(),priority:process.env.WORK_PRIORITY,deadline:Date.now()+15000},async()=>{
        const endpoint=i%2?'chat/completions':'embeddings';
        const response=await a.fetch(new URL(process.env.WORK_NAME+'/'+endpoint+'/'+i,process.env.PROVIDER_URL),{method:'POST',body:JSON.stringify({input:'bounded input'})});
        await response.text();
      }))); } finally {await a.close();}
    `,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            WORK_NAME: name,
            WORK_PRIORITY: priority,
            PROVIDER_URL: server.url.toString(),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      ),
    );
  };
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 1000; i++) {
      if (predicate()) return;
      await Bun.sleep(5);
    }
    throw new Error("mixed_process_provider_wait_timeout");
  };
  const release = () => {
    for (const [key, controller] of waiting) {
      controller.close();
      waiting.delete(key);
      active--;
      if (key.includes("background")) background--;
    }
  };
  try {
    start("background-a", "background");
    start("background-b", "background");
    await until(() => active === 6);
    expect(background).toBe(6);
    start("interactive", "interactive");
    await until(() => active === 8);
    expect(background).toBe(6);
    release();
    await until(() => received === 12);
    release();
    const results = await Promise.all(
      children.map(async (child) => ({
        code: await child.exited,
        error:
          child.stderr instanceof ReadableStream
            ? await new Response(child.stderr).text()
            : "stderr_unavailable",
      })),
    );
    expect(results).toEqual(results.map(() => ({ code: 0, error: "" })));
    expect(peak).toBe(8);
    expect(backgroundPeak).toBe(6);
    expect((await observer.status()).active).toBe(0);
  } finally {
    release();
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map((child) => child.exited));
    server.stop(true);
    await observer.close();
  }
}, 20000);
