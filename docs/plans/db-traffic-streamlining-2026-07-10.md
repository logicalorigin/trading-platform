# DB traffic streamlining — measured findings + plan (2026-07-10)

## How this was measured
- `pg_stat_statements` is installed but NOT in `shared_preload_libraries` (`timescaledb,helium`) → unusable on the managed DB.
- Instead: active-query sampling via `pg_stat_activity` (500 samples @150ms ≈ 75s of RTH), normalized by query shape — tool at `scripts/diag/db-activity-sampler.mts`.
- Cross-checked against the app's own `shadowAccountReads.routes` per-route counters (`GET /api/diagnostics/runtime`), which distinguish cache hit/miss/stale and carry avg/p95 latencies.

## Findings (observed)
Query-shape sample counts (≈ concurrent-active × time):
| shape | hits | note |
|---|---|---|
| `shadow_orders` full-row select | **987** | ~2 copies active at every instant — dominant load |
| `execution_events` full-row select (incl `payload`) | **495** | table is ~2.2k rows but **3.4GB bloated** (heap/TOAST) — every scan reads dead heap |
| `bar_cache` reads | 178 | signal-matrix hydration |
| `signal_monitor_events`/`symbol_states` writes | 131+50 | signal persistence churn |
| `shadow_positions` mark updates + `shadow_position_marks` inserts | 78+74 | per-position, per-tick — unbatched |
| `shadow_balance_snapshots` inserts | 65 | ~0.87/s ≈ 75k rows/day |

Wait events: cpu 797, **Client:ClientWrite 730** (PG blocked on the saturated node loop draining sockets — feedback loop with the API's 100% ELU), IO:DataFileRead 444 (bloat/scans), LWLock:WALWrite 236 + WALSync 129 (write churn).

Per-route app stats (before fix): `positions` 41% miss @ avg 7.9s (p95 28.8s), `ledger-bundle` 64% miss @ 4.8s (p95 20.8s), `allocation` 86% miss @ 14.5s (p95 54s), `open-positions` 100% miss, `summary` p95 42s, `stale-served ≈ 0` everywhere.

## Root cause of the read churn (verified in source)
Background mark refreshes clamp `expiresAt` on the `SHADOW_MARK_REFRESH_CACHE_KEY_PREFIXES` routes every few seconds during RTH (`invalidateShadowReadCachesAfterBackgroundMarkRefresh`, shadow-account.ts). `resolveShadowReadRequest` only served stale ON ERROR — so every mark-clamped read **blocked** on a full multi-second ledger rebuild (orders 20k full-row + fills + events + marks), keeping those queries continuously hot on the DB and giving users 20–54s p95s.

## LANDED (2026-07-10)
**Stale-while-revalidate for mark-clamped entries** in `withShadowReadCache` (shadow-account.ts): if an entry was expired by mark-refresh but is still within its NATURAL TTL age, serve it immediately (recorded as `cache_hit` + `servedStale:true`) and let ONE deduped background revalidation (`startShadowReadRevalidation`, shared with the miss path — identical version-guard semantics) land the fresh value. Past natural TTL age → blocking path unchanged. Contract test updated: `shadow-account-read-cache.test.ts` "background mark refresh keeps order and history caches hot" now asserts stale-serve + background-landing; suite 30/30.
Expected effect: positions/ledger-bundle/summary/allocation/open-positions/risk reads become instant (≤TTL-old data, same as a hit 1s before the mark tick); each mark tick triggers at most one background rebuild per key. Verify live via `shadowAccountReads.routes` (staleServed > 0, missCount collapse, p95 drop) once UI traffic accumulates.

## Follow-ups (ranked, not yet done)
1. **Orders read dedupe** — `orders:all/working/history/account-bounded/automation` are ~5 cache keys each independently running the same 20k full-row scan; derive all variants in-memory from the single `orders:account-bounded` base read (readShadowOrdersForSource already does this for non-automation; extend to all).
2. **execution_events**: (a) column-trim — most readers don't need `payload` (the TOASTed column); select it only where used. (b) **VACUUM FULL window — needs Riley's decision** (known 3.4GB bloat on ~2.2k rows; also fixes the IO:DataFileRead waits).
3. **Batch mark writes** — coalesce per-position `shadow_positions` UPDATE + `shadow_position_marks` INSERT into one multi-row statement per refresh cycle (cuts WALWrite/WALSync contention).
4. **Balance-snapshot debounce** — 65 inserts/75s; write only on material change or a minimum interval (retention also worth checking).
5. `Client:ClientWrite` waits are the event-loop feedback loop — resolved by OPT-1 (in flight), not a DB-side fix.
