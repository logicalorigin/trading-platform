# Option-chain ingest redesign — append-firehose → upsert "latest"

**Status:** drafted + adversarially verified 2026-06-17 (workflow `wf_43804ff0-6f5`, 12 agents). Source implementation later landed in this repository; verify live DB/app runtime state separately before treating this as applied. `drizzle-kit push` is disabled on the shared DB since the 2026-06-15 data-loss incident. Supersedes the interim band-aid in `option-chain-snapshot-write-contention-fix.md`.

## Goal (confirmed intent)
Replace the append-only `option_chain_snapshots` firehose (512-row batches, 18–45 s writes, ~975k rows/day) with an **upsert "latest" table** — updated in place — ending the writes that starve the shared 12-connection Postgres and cause the sidebar freeze / `0/200` flap / quote gaps / meltdown. **History is dropped** (verified: no reader, view, test, range-scan, or external consumer uses it; every live reader takes latest-per-contract).

## Load-bearing design decision (verified SOUND)
**Upsert key = `(option_contract_id, source)` — NOT `option_contract_id` alone.** Four source families write the same contract: Rust=`massive` (the GEX/firehose target, 1 row/contract), Node `ibkr-metadata`/`ibkr-snapshot`, `signal-options:<variant>`, `signal-options:decision:<deploymentId>`. GEX reads `source='massive'` only; the Node chain read blends all sources. A contract-only key would let a non-massive write **clobber the massive row and corrupt GEX**. The `(contract, source)` key preserves both readers exactly. Monotonicity guard `WHERE excluded.as_of >= existing.as_of` prevents an out-of-order fetch regressing a fresher row.

## What the adversarial pass caught — and the fixes folded in
1. **Migration lock-safety (was FLAWED):** inline `references instruments/option_contracts` in `CREATE TABLE` takes a blocking lock on the **hot parent tables the firehose is hammering** → could *worsen* the meltdown. **Fix:** the latest table carries **no FK constraints** (it's a derived cache; Rust writes instruments→contracts→latest in order, so parents always exist; dropping FKs also removes 2 index probes per upsert = cheaper writes). Indexes are built on the new *empty* table, so plain `CREATE INDEX` (NOT `CONCURRENTLY`) is correct.
2. **Cutover (was FLAWED):** the new table starts empty and fills per-symbol; switching readers too early → GEX reads empty for not-yet-filled symbols. **Fix:** a hard gate before the reader switch (below).
3. **Node prune (was FLAWED):** a blanket no-op prune → **unbounded growth** of `signal-options:decision:<deploymentId>` (per-deployment cardinality). **Fix:** a **source-scoped** prune (below), not time-based (time-based would wrongly delete a live latest row).

SOUND (no change needed): the Rust `ON CONFLICT DO UPDATE` column set, the GEX reader equivalence, and the Node reader equivalence (one doc correction: the Node JS keep-first dedup is **not** a no-op — it still selects newest-across-sources, since multiple source rows per contract coexist).

---

## Migration — `lib/db/migrations/20260617_option_chain_latest.sql` (additive, reversible, lock-safe)
```sql
-- Additive: create the upsert "latest" table. NO FKs (avoids a blocking lock on
-- the hot instruments/option_contracts tables; integrity maintained by the
-- ingest order). option_chain_snapshots is left fully intact for rollback.
create table if not exists option_chain_latest (
  id uuid primary key default gen_random_uuid(),
  underlying_instrument_id uuid not null,
  option_contract_id uuid not null,
  bid numeric(18,6), ask numeric(18,6), last numeric(18,6), mark numeric(18,6),
  implied_volatility numeric(18,6), delta numeric(18,6), gamma numeric(18,6),
  theta numeric(18,6), vega numeric(18,6),
  open_interest integer, volume integer,
  source text not null default 'massive',
  as_of timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
-- Upsert key: one row per (contract, source). See design decision above.
create unique index if not exists option_chain_latest_contract_source_key
  on option_chain_latest (option_contract_id, source);
-- GEX reader: join on underlying_instrument_id then filter source='massive'.
create index if not exists option_chain_latest_underlying_idx
  on option_chain_latest (underlying_instrument_id);
analyze option_chain_latest;
```
(If you later want DB-enforced integrity, add the 2 FKs separately as `NOT VALID` + `VALIDATE CONSTRAINT` under a short `lock_timeout` — never inline.)

## Rust — `crates/market-data-worker/src/ingest.rs` (`insert_option_chain_snapshots_tx`, ~548)
Keep the entire UNNEST body and 15 binds verbatim. Change only the target table + add the conflict clause:
```sql
        insert into option_chain_latest ( ... same 16 columns ... )
        select $1::uuid, input.option_contract_id, ... , $14, $15, now()
        from input
        on conflict (option_contract_id, source) do update set
          bid = excluded.bid, ask = excluded.ask, last = excluded.last,
          mark = excluded.mark, implied_volatility = excluded.implied_volatility,
          delta = excluded.delta, gamma = excluded.gamma, theta = excluded.theta,
          vega = excluded.vega, open_interest = excluded.open_interest,
          volume = excluded.volume, as_of = excluded.as_of, updated_at = now()
        where excluded.as_of >= option_chain_latest.as_of
```
`source`/`underlying_instrument_id`/`created_at` are intentionally not in the UPDATE set. **Phase-1 dual-write:** keep the original `insert into option_chain_snapshots` AND add this upsert in the same per-batch tx (`persist_option_chain_snapshots`, ~161-204). Remove the old append in Phase 4.

## Rust — `gex.rs` (`LOAD_LATEST_OPTION_SNAPSHOTS_SQL`, ~34)
The unique index guarantees one massive row per contract, so the `distinct on` CTE collapses to a plain select (same columns/casts → `GexContract` mapping unchanged):
```sql
select snap.option_contract_id, snap.bid::float8 as bid, ... snap.as_of,
       contract.massive_ticker, ... contract.shares_per_contract
from option_chain_latest snap
join instruments underlying on underlying.id = snap.underlying_instrument_id
join option_contracts contract on contract.id = snap.option_contract_id
where underlying.symbol = $1 and snap.source = 'massive'
order by contract.expiration_date asc, contract.strike asc
```

## Node — `artifacts/api-server/src/services/option-metadata-store.ts`
- **Read** (~824-859): point the `.from(...)` at the new `optionChainLatestTable`. Keep the `asOf >= now-staleMaxAgeMs` window, `orderBy(desc(asOf))`, the 500-chunk `inArray`, and the keep-first-per-contract dedup **unchanged** (still needed — multiple source rows per contract coexist).
- **Write** (~542): change `.insert(...)` to an upsert `onConflictDoUpdate({ target: [optionContractId, source], set: {...metrics, asOf, updatedAt} })` with the same `excluded.as_of >=` monotonicity guard.
- **Prune** (`pruneOldSnapshots`, ~476-490): **source-scoped, not no-op, not blanket-time-based.** Delete only the unbounded non-massive rows — primarily `signal-options:decision:%` for inactive/aged deployments (and any `OPTION_METADATA_PRUNABLE_SOURCES`) — guarded so it can never delete a live `massive` latest row.
- **Drizzle schema** (`lib/db/src/schema/market-data.ts`): add `optionChainLatestTable` mirroring the migration (no `.references(...)`; `uniqueIndex("option_chain_latest_contract_source_key").on(optionContractId, source)` + `index(...).on(underlyingInstrumentId)`).

## Cutover — 4 reversible phases (each independently safe)
1. **Migrate + dual-write.** Apply the migration; deploy Rust+Node writing to **both** tables; readers still on `option_chain_snapshots`. Rebuild worker + restart. *Rollback: stop dual-write.*
2. **GATE → switch readers.** Before flipping GEX/Node to the new table, **verify `option_chain_latest` has ≥1 `massive` row for every active GEX symbol** (run the new GEX select per symbol; confirm non-empty). Only then deploy the reader change. Rebuild + restart. *Rollback: revert reader change.*
3. **Verify** (1–2 trading sessions): no `option_chain_snapshots` slow-statement warnings, `dbPool.waiting`→~0, p95 normal, GEX numbers match pre-cutover, chain UI populated, no quote gaps / `0/200` flap.
4. **Decommission.** Drop the old append `insert`, the Rust retention sweep target, and (after a safety window) `option_chain_snapshots` + its 4 indexes. *This is the only destructive step — do last, after Phase 3 passes.*

## Verify checklist (post-cutover)
- [ ] No `sqlx` slow-statement warnings for `option_chain_latest` (upserts are sub-second).
- [ ] `dbPool.waiting` ~0; API p95 normal; no `execution_events` statement-timeout cancellations; no IBKR bridge 504s.
- [ ] GEX `net_gex` matches pre-cutover for spot-check symbols.
- [ ] Trade-screen chain populated; sidebar stable; `stockAggregates/gapCount` flat; line budget stops flapping to 0/200.
- [ ] `option_chain_latest` row count bounded (≈ active contracts × active sources); `signal-options:decision:%` not growing unbounded.
