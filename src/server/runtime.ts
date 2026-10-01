import { database } from "./database";

const state = globalThis as typeof globalThis & {
  loreweaveStartup?: Promise<void>;
};
export function ensureRuntime() {
  return (state.loreweaveStartup ??= (async () => {
    await database().client.begin(async (sql) => {
      await sql`update indexing_attempts set status='interrupted', reason='application_restarted', finished_at=now() where status in ('queued','processing')`;
      await sql`update index_operations set status='interrupted', reason='application_restarted', updated_at=now() where status in ('queued','processing')`;
      await sql`update sdk_runs set record=record || jsonb_build_object('status','aborted','finishedAt',extract(epoch from now())*1000,'error',jsonb_build_object('code','application_restarted','message','Application restarted without execution replay')) where run_id in (select id::text from knowledge_runs where status in ('queued','running','stopping'))`;
      await sql`update knowledge_runs set status='interrupted',reason='application_restarted',finished_at=now() where status in ('queued','running','stopping')`;
      await sql`update conversations set active_run=null where active_run is not null`;
    });
  })());
}
