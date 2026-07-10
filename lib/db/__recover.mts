// Post-recovery space triage for the helium DB incident (2026-07-10).
// Run the MOMENT the DB accepts connections. Frees reusable space WITHOUT
// exclusive locks (no VACUUM FULL): prunes aged giant execution_events payloads,
// then plain VACUUM so pages become reusable. Read-only checks first.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await c.connect();
const q = async (t: string, p: any[] = []) => (await c.query(t, p)).rows as any[];
console.log("connected.");
// 1) quota picture: database size vs relation sum (gap ≈ orphaned files)
const dbsize = (await q(`SELECT pg_database_size(current_database())::bigint b, pg_size_pretty(pg_database_size(current_database())) s`))[0];
const relsum = (await q(`SELECT sum(pg_total_relation_size(oid))::bigint b FROM pg_class WHERE relkind IN ('r','i','t','m')`))[0];
console.log("db size:", dbsize.s, "| relations sum:", Math.round(Number(relsum.b) / 1e6) + "MB", "| gap(≈orphans):", Math.round((Number(dbsize.b) - Number(relsum.b)) / 1e6) + "MB");
// 2) execution_events payload profile by age
for (const r of await q(`SELECT (occurred_at::date) d, count(*) n, pg_size_pretty(sum(pg_column_size(payload))::bigint) sz
  FROM execution_events GROUP BY 1 ORDER BY 1 DESC LIMIT 8`)) console.log("events", r.d, "n=" + r.n, r.sz);
// 3) payload profile by event_type — position reconstruction reads signal_options_%
//    events, so ledger-critical types must NOT be pruned even when old. Print the
//    profile; only delete when an explicit, reviewed predicate is provided.
for (const r of await q(`SELECT event_type, count(*) n, pg_size_pretty(sum(pg_column_size(payload))::bigint) sz,
  min(occurred_at)::date oldest FROM execution_events GROUP BY 1 ORDER BY sum(pg_column_size(payload)) DESC NULLS LAST LIMIT 10`))
  console.log("type", r.event_type, "n=" + r.n, r.sz, "oldest=" + r.oldest);
if (process.env.PRUNE_PREDICATE) {
  const del = await c.query(`DELETE FROM execution_events WHERE ${process.env.PRUNE_PREDICATE}`);
  console.log("pruned rows:", del.rowCount, "predicate:", process.env.PRUNE_PREDICATE);
} else {
  console.log("no PRUNE_PREDICATE provided — profiling only, nothing deleted");
}
// 4) plain vacuums (no exclusive lock) so freed pages are reusable
await c.query(`SET statement_timeout=0`);
for (const t of ["execution_events", "shadow_position_marks", "shadow_balance_snapshots"]) {
  const t0 = Date.now();
  await c.query(`VACUUM (ANALYZE) "${t}"`);
  console.log("vacuumed", t, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
// 5) verify the algo's critical reads work
const dep = await q(`SELECT count(*) n FROM algo_deployments`);
console.log("algo_deployments readable:", dep[0].n, "rows");
await c.end();
console.log("RECOVERY TRIAGE DONE");
