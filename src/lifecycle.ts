/** Stop ingress, settle work, then release dependencies; reverse acquisition within each phase. */
const releaseOrder = { ingress: 0, settlement: 1, dependency: 2 };
export function createLifecycle<T>(
  setup: (scope: {
    signal: AbortSignal;
    defer: (
      release: () => void | Promise<unknown>,
      phase?: keyof typeof releaseOrder,
    ) => void;
  }) => Promise<T>,
) {
  const controller = new AbortController();
  const releases: Array<{
    cleanup: () => void | Promise<unknown>;
    phase: keyof typeof releaseOrder;
  }> = [];
  let starting: Promise<T> | undefined;
  let closing: Promise<void> | undefined;
  let releasing: Promise<void> | undefined;
  function release() {
    return (releasing ??= (async () => {
      const errors: unknown[] = [];
      for (const { cleanup } of releases
        .reverse()
        .sort((a, b) => releaseOrder[a.phase] - releaseOrder[b.phase])) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "runtime_cleanup_failed");
    })());
  }
  return {
    start() {
      if (controller.signal.aborted)
        return Promise.reject(new Error("runtime_closed"));
      return (starting ??= Promise.resolve().then(async () => {
        try {
          controller.signal.throwIfAborted();
          const result = await setup({
            signal: controller.signal,
            defer: (cleanup, phase = "dependency") =>
              releases.push({ cleanup, phase }),
          });
          controller.signal.throwIfAborted();
          return result;
        } catch (error) {
          controller.abort();
          try {
            await release();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "runtime_start_failed",
            );
          }
          throw error;
        }
      }));
    },
    close() {
      controller.abort();
      return (closing ??= (async () => {
        // Setup may still acquire a resource; do not race its cleanup registration.
        await starting?.catch(() => {});
        await release();
      })());
    },
  };
}
