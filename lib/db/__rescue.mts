// Rescue loop: catch ANY moment Postgres accepts, then immediately free quota
// by truncating the regenerable bar cache (6.2GB), which unpins the disk and
// ends the crash loop. Ledger tables are only READ (counts) — never modified.
import pg from "pg";
const url = process.env.DATABASE_URL!;
let attempt = 0;
async function tryOnce(): Promise<boolean> {
  attempt++;
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    console.log(`[rescue] CONNECTED on attempt ${attempt} at ${new Date().toISOString()}`);
    await c.query(`SET statement_timeout = 0`);
    // Free ~6.2GB instantly: bar_cache is Massive bar data the app re-hydrates on
    // demand (its own name + hydration infra). TRUNCATE unlinks files immediately
    // with minimal WAL — the safest possible space release under quota pressure.
    const t0 = Date.now();
    await c.query(`TRUNCATE TABLE bar_cache`);
    console.log(`[rescue] TRUNCATE bar_cache done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    // Verify ledger data intact — read-only counts, reported verbatim.
    for (const t of ["algo_deployments", "shadow_orders", "shadow_positions", "shadow_fills", "execution_events", "shadow_accounts", "shadow_position_marks"]) {
      try { const r = await c.query(`SELECT count(*)::int n FROM "${t}"`); console.log(`[rescue] rows ${t} = ${r.rows[0].n}`); }
      catch (e: any) { console.log(`[rescue] rows ${t} ERR: ${String(e.message).slice(0, 80)}`); }
    }
    const s = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) s`);
    console.log(`[rescue] db size now: ${s.rows[0].s}`);
    await c.end();
    console.log("[rescue] SUCCESS");
    return true;
  } catch (e: any) {
    if (attempt % 60 === 0) console.log(`[rescue] attempt ${attempt}: ${String(e.message).slice(0, 50)}`);
    await c.end().catch(() => {});
    return false;
  }
}
// hammer every 500ms for up to 60 minutes
for (let i = 0; i < 7200; i++) {
  if (await tryOnce()) process.exit(0);
  await new Promise((r) => setTimeout(r, 500));
}
console.log("[rescue] gave up after 60min");
process.exit(1);
