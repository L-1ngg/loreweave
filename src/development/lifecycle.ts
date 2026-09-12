/** Own resources as soon as they are acquired; release them in reverse order. */
export function createLifecycle(
  setup: (scope: {
    signal: AbortSignal;
    defer: (release: () => void | Promise<unknown>) => void;
  }) => Promise<void>,
) {
  const controller = new AbortController();
  const releases: Array<() => void | Promise<unknown>> = [];
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let releasing: Promise<void> | undefined;
  function release() {
    return (releasing ??= (async () => {
      const errors: unknown[] = [];
      for (const cleanup of releases.reverse()) {
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
          await setup({
            signal: controller.signal,
            defer: (cleanup) => releases.push(cleanup),
          });
          controller.signal.throwIfAborted();
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
