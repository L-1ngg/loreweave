import postgres from "postgres";
import { setTimeout as pause } from "node:timers/promises";
/** One session-owned background slot. Active interactive runs take admission priority. */
export class BackgroundAdmission {
  constructor(private readonly url: string) {}
  async run<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
    const session = postgres(this.url, { max: 1, onnotice: () => {} });
    try {
      while (true) {
        signal.throwIfAborted();
        const [interactive] =
          await session`SELECT EXISTS(SELECT 1 FROM conversation_runs WHERE deadline>extract(epoch FROM clock_timestamp())*1000 AND snapshot->>'status' IN ('queued','executing','finalizing','refreshing')) AS waiting`;
        if (!interactive!.waiting) {
          const [lock] =
            await session`SELECT pg_try_advisory_lock(hashtextextended('loreweave:background-model',0)) AS acquired`;
          if (lock!.acquired) {
            signal.throwIfAborted();
            return await request();
          }
        }
        await pause(50, undefined, { signal });
      }
    } finally {
      await session.end();
    }
  }
}
