# Option-chain snapshot write contention — fix spec

**Status:** diagnosed & verified 2026-06-17. Historical root-cause note; superseded by `option-chain-upsert-latest-redesign.md` and later source changes that write/read `option_chain_latest`. Verify live DB/app runtime state separately before assuming the redesign is deployed.

## Confirmed root cause (observed)

A single `insert into option_chain_snapshots` of **512 rows takes 18–45 s** (live `sqlx` slow-statement warnings, escalating during the incident). This one slow write cascades into a full system stall:

1. `crates/market-data-worker/src/ingest.rs:175-201` — per 512-row batch, `persist_option_chain_snapshots` opens **one** transaction (`pool.begin()`) and runs `ensure_instrument` → `ensure_option_instruments` → `ensure_option_contracts` → `insert_option_chain_snapshots` **sequentially**, then commits. The whole 18–45 s runs **inside that open transaction**, pinning one connection the entire time.
2. The write is slow because `option_chain_snapshots` is **append-only, random-UUID PK, 4 secondary indexes + 2 FKs, ~975k rows/day, on a remote shared Postgres ("helium")** — each row = random index-leaf I/O over the wire on multi-GB bloated indexes (`lib/db/migrations/20260529_market_data_ingest.sql:101-126`). Retention deletes (now scheduled, `main.rs:240-253`) bound row count but **do not reclaim index bloat**.
3. **Coupling:** helium **hard-caps client connections at 12, shared between the Rust worker and the Node API** (`lib/db/src/index.ts:39-43`). The 18–45 s write pins a scarce backend and saturates the shared server's I/O, so unrelated Node `execution_events` SELECTs (`signal-options-automation.ts:10873`, `account.ts:4842`) blow the **15 s `statement_timeout`** (`lib/db/src/index.ts:66`) and are cancelled; the Node pool (max 12) then queues **100+ deep** (observed live), the single Node event loop is starved, and:
   - the **Massive equities sidebar freezes** (aggregate processing can't run),
   - the **IBKR market-data line budget shows 0/200** (admission cycle can't run),
   - **synchronized ~20 s quote gaps** appear across all symbols at once (the gap detector measures processing time, so an event-loop stall fabricates a simultaneous gap).

This is the "Massive ↔ broker" coupling: **one shared, connection-capped, I/O-bound Postgres + one Node event loop, both starved by the slow option-chain write.** Not a direct code dependency.

## Ruled out (do not pursue)

- **"Too many DB connections in the worker"** — false. Rust pool is `max_connections=2` (`config.rs:42`), serial job loop, ~1 connection per ingest. Lowering it won't help.
- **Massive WS teardown (`platform.ts:11966`)** — disabled (`MASSIVE_STOCK_UNIVERSE_STREAM_ENABLED` unset → false). The live subscriber (`signal-monitor-evaluation-worker`) already uses incremental `setSymbols`.
- **"Retention never runs / unbounded growth"** — stale; retention runs every 6 h and the backlog delete+VACUUM was done 2026-06-11.
- **Row-level locks** — append-only distinct-UUID inserts don't block the SELECTs; the contention is shared-server I/O + the 12-connection cap, not locking.

## Fix levers (priority order)

1. **Shorten the held transaction — fastest, lowest risk, no rebuild.**
   Set env on the market-data-worker and restart:
   `MARKET_DATA_OPTION_CHAIN_WRITE_BATCH_SIZE=64` (from default 512).
   Read at runtime (`ingest.rs:31-37`), so no Rust rebuild — just env + restart. 64-row batches commit ~8× faster, releasing the shared connection between commits so Node queries interleave instead of timing out. (Mirrors the in-crate precedent `retention.rs:76-97`: "delete in bounded chunks so each transaction stays small.") Keep the 20 ms inter-batch throttle. Tune 32–128 to taste.
   - **Touches startup config** (`.replit [env]` or the worker launch env) → run `pnpm run audit:replit-startup` before handoff; restart is user-controlled.
   - Code-default alternative: change `DEFAULT_OPTION_CHAIN_WRITE_BATCH_SIZE` (`ingest.rs:12`) — but that needs a `cargo` rebuild.

2. **Cut write volume.** ~975k snapshots/day for a ~500-symbol universe is the upstream driver — reduce scanner universe size / cadence.

3. **Reclaim index bloat.** `REINDEX` (or pg_repack) `option_chain_snapshots`; retention deletes alone don't reclaim it. Reconsider whether all 4 secondary indexes are needed on the write path.

4. **Isolate the worker's DB access** from the Node 12-connection cap — separate endpoint, or a hard sub-budget so it can't starve foreground/account/trading reads (precedent: `artifacts/ibkr-bridge/src/work-scheduler.ts:121-135`, lanes sized "below the level that starved reads").

## Verify after applying

- No more `option_chain_snapshots` 18–45 s `sqlx` slow-statement warnings.
- Node `dbPool.waiting` returns to ~0; API p95 falls from ~20 s back to normal.
- No more `execution_events` `statement timeout` cancellations or IBKR bridge `/accounts` `/executions` 504s.
- Massive equities sidebar stays live; IBKR line budget stops flapping to 0/200; `stockAggregates/gapCount` stops incrementing.
