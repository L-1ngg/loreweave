/** The caller can stop waiting without destroying the provider completion signal.
 * Delivery uses backpressure; detached responses drain without retaining content. */
export function modelTransport(input: {
  request: Request;
  caller: AbortSignal;
  transport: AbortSignal;
  headers: (response: Response) => Promise<void>;
  detached: () => Promise<void>;
  finished: (state: "settled" | "uncertain", outcome: string) => Promise<void>;
}) {
  const ready = Promise.withResolvers<Response>();
  // Cancellation can precede the admission wrapper returning this promise.
  void ready.promise.catch(() => {});
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let demand: (() => void) | undefined;
  let detached = false;
  let detachment: Promise<void> | undefined;
  const detach = (reason: unknown) => {
    if (detached) return;
    detached = true;
    ready.reject(reason);
    controller?.error(reason);
    demand?.();
    detachment = input.detached();
    void detachment.catch(() => {});
  };
  const abort = () => detach(input.caller.reason);
  const transportAbort = () => demand?.();
  input.caller.addEventListener("abort", abort, { once: true });
  input.transport.addEventListener("abort", transportAbort, { once: true });
  if (input.caller.aborted) abort();
  const completion = (async () => {
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let outcome = "transport_uncertain";
    let state: "settled" | "uncertain" = "uncertain";
    let failure: unknown;
    try {
      response = await globalThis.fetch(input.request, {
        signal: input.transport,
      });
      reader = response.body?.getReader();
      await input.headers(response);
      const body = response.body
        ? new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
              if (detached) value.error(input.caller.reason);
            },
            pull() {
              demand?.();
            },
            cancel(reason) {
              detach(reason ?? new Error("consumer_canceled"));
            },
          })
        : null;
      ready.resolve(
        new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      );
      const sse = response.headers
        .get("content-type")
        ?.includes("text/event-stream");
      const anthropic = new URL(input.request.url).pathname.endsWith(
        "/messages",
      );
      const decoder = new TextDecoder();
      let frame = "",
        protocolComplete = false;
      if (reader)
        for (;;) {
          input.transport.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          if (sse) {
            frame += decoder.decode(part.value, { stream: true });
            const lines = frame.split(/\r?\n/);
            frame = lines.pop() ?? "";
            if (
              lines.some((line) => {
                if (!anthropic) return /^data: ?\[DONE\]$/.test(line);
                if (!line.startsWith("data:")) return false;
                try {
                  return JSON.parse(line.slice(5)).type === "message_stop";
                } catch {
                  return false;
                }
              })
            )
              protocolComplete = true;
            if (frame.length > 65536) frame = frame.slice(-65536);
          }
          if (!detached) {
            controller!.enqueue(part.value);
            if ((controller!.desiredSize ?? 0) <= 0 && !protocolComplete) {
              await new Promise<void>((resolve) => {
                demand = resolve;
                if (
                  detached ||
                  input.transport.aborted ||
                  (controller!.desiredSize ?? 0) > 0
                )
                  resolve();
              });
              demand = undefined;
            }
          }
          if (protocolComplete) break;
        }
      // An SSE EOF without its terminal marker can be a truncated generation.
      state = sse && response.ok && !protocolComplete ? "uncertain" : "settled";
      outcome = protocolComplete
        ? "provider_stream_done"
        : state === "uncertain"
          ? "stream_missing_done"
          : `http_${response.status}`;
    } catch (error) {
      failure = error;
      outcome = input.transport.aborted
        ? "transport_deadline_or_owner_lost"
        : response
          ? "stream_interrupted"
          : "transport_uncertain";
    } finally {
      // Finish the physical reader before returning its transport capacity. A
      // cancel failure cannot undo an already observed protocol completion.
      try {
        await reader?.cancel();
      } catch {}
      reader?.releaseLock();
      input.caller.removeEventListener("abort", abort);
      input.transport.removeEventListener("abort", transportAbort);
    }
    // Persistence failures must not skip transport accounting or manufacture a
    // second, contradictory outcome. An unrecorded release stays fail-closed.
    const recorded = await Promise.allSettled([
      detachment,
      input.finished(state, outcome),
    ]);
    const persistenceFailure = recorded.find(
      (result) => result.status === "rejected",
    );
    if (persistenceFailure?.status === "rejected")
      failure = persistenceFailure.reason;
    if (failure) {
      ready.reject(failure);
      if (!detached) controller?.error(failure);
      if (persistenceFailure?.status === "rejected") throw failure;
    } else if (!detached) controller?.close();
  })();
  void completion.catch(() => {});
  return { response: ready.promise, completion };
}
