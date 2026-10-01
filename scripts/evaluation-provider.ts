// Development-only accounting proxy. Neither imported nor started by the app.
import { z } from "zod";

export async function evaluationProvider() {
  const path = process.env.LOREWEAVE_EVAL_PROVIDER_FILE;
  if (!path) throw new Error("LOREWEAVE_EVAL_PROVIDER_FILE_required");
  const config = z
    .object({
      baseURL: z.string().url(),
      model: z.string().min(1),
      apiKey: z.string().min(1),
      maxUSD: z.number().positive().max(10),
    })
    .parse(await Bun.file(path).json());
  const balance = async () => {
    const response = await fetch(new URL("/v1/usage", config.baseURL), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("evaluation_accounting_unavailable");
    const value = await response.json();
    if (
      !Number.isFinite(value.balance) ||
      !Number.isFinite(value.usage?.total?.actual_cost) ||
      value.unit !== "USD"
    )
      throw new Error("evaluation_accounting_invalid");
    return {
      balance: value.balance as number,
      cost: value.usage.total.actual_cost as number,
      requests: value.usage.total.requests as number,
      total: value.usage.total,
    };
  };
  const before = await balance();
  const key = crypto.randomUUID();
  let lane = "compatibility";
  let tail = Promise.resolve();
  let closed = false;
  const calls: Array<Record<string, unknown>> = [];
  const ledger =
    process.env.LOREWEAVE_EVAL_LEDGER ??
    "docs/evaluation/pageindex-real-ledger.json";
  const save = async () => {
    const current = await balance();
    await Bun.write(
      ledger,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          baseURL: config.baseURL,
          model: config.model,
          maxUSD: config.maxUSD,
          accounting:
            "provider /v1/usage actual_cost plus wallet delta; external key cap controlled by owner",
          observedCostUSD: current.cost - before.cost,
          walletDeltaUSD: before.balance - current.balance,
          previousProbeCostUSD: before.cost,
          keyCumulative: { unit: "USD", ...current.total },
          calls,
        },
        null,
        2,
      ) + "\n",
    );
    return current;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 120,
    async fetch(request) {
      if (closed || request.headers.get("authorization") !== `Bearer ${key}`)
        return Response.json(
          { error: { message: "evaluation_unauthorized" } },
          { status: 401 },
        );
      if (new URL(request.url).pathname !== "/v1/chat/completions")
        if (new URL(request.url).pathname === "/evaluation-label") {
          lane = (await request.json()).lane;
          return Response.json({ ok: true });
        } else return new Response(null, { status: 404 });
      const body = await request.json();
      const callLane = lane;
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((r) => {
        release = r;
      });
      await previous;
      const started = Date.now();
      const record: Record<string, unknown> = {
        lane: callLane,
        model: body.model,
        stream: !!body.stream,
        structured: !!body.response_format,
        tools: (body.tools ?? []).map((t: any) => t.function.name),
        inputChars: JSON.stringify(body.messages).length,
      };
      try {
        record.task = JSON.parse(
          body.messages.findLast((m: any) => m.role === "user")?.content ??
            "{}",
        ).task;
      } catch {
        /* ordinary question prose */
      }
      calls.push(record);
      try {
        const current = await balance();
        // Leave headroom for the final bounded call; the owner controls the
        // gateway's hard key quota. Include all prior probes on this key.
        if (
          current.cost >= config.maxUSD - 1 ||
          (record.inputChars as number) > 250000
        )
          throw new Error("evaluation_budget_exhausted");
        body.max_tokens = Math.min(
          body.max_tokens ?? body.max_completion_tokens ?? 8192,
          8192,
        );
        delete body.max_completion_tokens;
        const upstream = await fetch(
          `${config.baseURL.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: request.signal,
          },
        );
        record.status = upstream.status;
        if (!upstream.body) throw new Error("provider_response_empty");
        const reader = upstream.body.getReader();
        let raw = "";
        const decoder = new TextDecoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (;;) {
                const next = await reader.read();
                if (next.done) break;
                record.firstOutputMs ??= Date.now() - started;
                raw += decoder.decode(next.value, { stream: true });
                controller.enqueue(next.value);
              }
              raw += decoder.decode();
              controller.close();
            } catch (error) {
              record.cancelled = request.signal.aborted;
              record.error = String(error).replaceAll(
                config.apiKey,
                "[redacted]",
              );
              try {
                controller.error(error);
              } catch {
                /* reader already detached */
              }
            } finally {
              record.elapsedMs = Date.now() - started;
              try {
                if (body.stream) {
                  let output = "";
                  for (const line of raw.split("\n")) {
                    if (!line.startsWith("data: ") || line.includes("[DONE]"))
                      continue;
                    try {
                      const chunk = JSON.parse(line.slice(6));
                      if (chunk.usage) record.usage = chunk.usage;
                      output += chunk.choices?.[0]?.delta?.content ?? "";
                    } catch {
                      /* incomplete cancelled chunk */
                    }
                  }
                  if (body.response_format)
                    record.output = output.slice(0, 20000);
                } else {
                  const value = JSON.parse(raw);
                  record.usage = value.usage;
                }
                if (!upstream.ok)
                  record.error = raw
                    .slice(0, 1000)
                    .replaceAll(config.apiKey, "[redacted]");
              } catch {
                /* non-JSON error response */
              }
              try {
                await save();
              } catch (error) {
                closed = true;
                record.accountingError = String(error);
              }
              release();
            }
          },
          async cancel() {
            await reader.cancel();
          },
        });
        return new Response(stream, {
          status: upstream.status,
          headers: {
            "Content-Type":
              upstream.headers.get("content-type") ?? "application/json",
          },
        });
      } catch (error) {
        record.error = String(error).replaceAll(config.apiKey, "[redacted]");
        record.elapsedMs = Date.now() - started;
        try {
          await save();
        } catch {
          closed = true;
        }
        release();
        return Response.json(
          { error: { message: String(record.error) } },
          { status: 400 },
        );
      }
    },
  });
  return {
    url: `${server.url}v1`,
    key,
    model: config.model,
    calls,
    setLane(value: string) {
      lane = value;
    },
    async finish() {
      await tail;
      const after = await save();
      closed = true;
      server.stop(true);
      return {
        observedCostUSD: after.cost - before.cost,
        walletDeltaUSD: before.balance - after.balance,
        previousProbeCostUSD: before.cost,
      };
    },
  };
}
