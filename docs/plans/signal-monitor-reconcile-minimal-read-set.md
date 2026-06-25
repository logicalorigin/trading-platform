# Signal-Monitor Reconcile — Minimal-Read-Set Redesign

**Status:** Planned + audited (two independent multi-agent audits passed, unanimous "sound with fixes"). NOT yet implemented.
**Context:** Layers on the existing "Layer 2" reconcile temp-table work (around commit `e2d481c`). Another agent is active in the signal/ticker-data area — coordinate before touching shared surfaces.

## Problem
`reconcileSignalMonitorSymbolStatesForProfile` (signal-monitor.ts:8791-9142) rebuilds `tmp_trusted_events` at startup by running a per-event `bar_cache` LATERAL over **all ~37,807** qualifying events for the profile → **~104s** (≈37,807 × ~2.75ms cold random I/O). The `bar_cache` covering index `(symbol,timeframe,source,starts_at)` is present and used — the cost is **volume, not a bad plan**.

## Key facts (prod profile `a5721cf5-…`, read-only verified)
- 37,807 qualifying events (buy/sell, `close NOT NULL`), ~2 months, **no retention**.
- ~2,686 distinct `(symbol,timeframe)`; 3,177 active `signal_monitor_symbol_states`.
- **0 "ambiguous" events today** — every event is trusted via a cheap JSONB branch; the `bar_cache` close-tolerance branch decides trust for nobody right now.
- **Consumer map:** only passes 1,2,3,6 read the trusted set. `close` is written only by passes 1,2 from the **latest-per-`(symbol,tf)`** event. Pass 6 + pass-1-inner are membership/existence (no close). Passes 4,5 read `bar_cache` directly; 7,8 read card columns only.

## Design — three sets from ONE shared trust evaluation (inside the existing `db.transaction`)
- **(A) `tmp_trusted_membership`** — all trusted events. Columns `(id, symbol, timeframe, direction, signal_at, signal_price, filter_state, event_close, signal_bar_at)`. Trust = the 3 cheap JSONB branches OR a **gated, source-ranked LIMIT-1** branch-4 check (Fix #1) for residual events (~0 today). **No** close-override probe. Indexes `(symbol,timeframe,direction,signal_at)` and `(symbol,timeframe,signal_at DESC,id DESC)`. Used by pass 6 + pass-1-inner.
- **(B) `tmp_latest_trusted`** — `DISTINCT ON (symbol,timeframe) ORDER BY signal_at DESC, id DESC` over (A) (~2,684 rows), **with** the source-ranked LIMIT-1 `bar_cache` probe; `close = COALESCE(best_bar.close, event_close)`; carries `signal_price` + `filter_state` + `id`. Used by passes 1,2.
- **(C) `tmp_latest_filterstate`** — `DISTINCT ON (symbol,timeframe)` over (A) `WHERE filter_state IS NOT NULL`, same order; **no** probe. Used by pass 3.

Rewire: 1→B (+A inner); 2→B; 3→C; 6→A; 4,5,7,8 unchanged. Net: **~37,807 → ~2,684** `bar_cache` probes.

## The 6 audit fixes (all decided)
1. **Branch-4 = exact source-ranked LIMIT-1**, not a bare `EXISTS(any within 2%)`. Trust + close must come from the **same** best-source bar (reuse the original 8755-8776 LATERAL). *(decided: implement fully)*
2. **Compute the bar-key (`signal_bar_at`) once** as a column in (A), using the exact original expression (8727-8738); every probe keys off it.
3. **Verification:** direct A/B on the **dev DB** — snapshot the 8 written columns, run old, run new, diff — plus synthetic edge-case fixtures. Count-parity is a first screen only (pass-1 count is value-blind).
4. **Measure pass 5 (~12,708 probes, untouched) + end-to-end BEFORE** setting the timeout or quoting a speed number. Keep `statement_timeout` at **120s** until measured. Pass 5 may be the new bottleneck.
5. **Update the guard tests** (`signal-monitor-completed-bars.test.ts` ~1355-1415) to the new structure, keeping their perf-tripwire intent; new probes must use `source IN (${SOURCES})` form (not literal `source = 'massive-history'`) to keep the negative assertions green.
6. **Env kill-switch** to select old↔new path; keep the old `trustedSignalMonitorCanonicalEventsSql`/build for one release, then remove.

## Invariants (must hold or it silently corrupts)
- id-DESC tiebreak preserved — `(symbol,tf,direction,signal_at)` is **not** unique (only `event_key` is).
- (B)/(C) derive from (A) → one trust evaluation → passes 1 & 6 stay consistent.
- (B) probe = LEFT join, `COALESCE(best_bar.close, event_close)`, identical source CASE order + `signal_bar_at` key.
- Keep single transaction + `ON COMMIT DROP`.

## Verification fixtures (the cases live data won't exercise today)
- Multi-source ambiguous event straddling the 2% boundary (best source >2% off, lower-preference source within 2%) — catches the Fix #1 EXISTS-vs-LIMIT-1 divergence.
- Two trusted events tying on `signal_at` with different `id`/direction — catches tiebreak loss.
- A `(symbol,tf)` whose latest trusted event has `filter_state` NULL but an older one is non-null — catches the pass-3 separate-row requirement.

## Measurements (dev DB, recorded — step 1 done)
- **Pass 5** (latestBarAdvanceCandidates, untouched, ~12,708 probes): **~2.7s** — all hit the covering index at the warm latest-bar edge (~0.84ms/state). NOT the new bottleneck.
- **New gated membership build (set A):** `EXPLAIN ANALYZE` shows the branch-4 `bar_cache` SubPlan **"never executed"** (OR short-circuits; 0 ambiguous events) → **0 probes, ~0.3s** for all 38k events. Fix #1 gate validated.
- **Set B** (~2,686 latest-per-`(symbol,tf)` probes, the only real lookups left): **~14.7s COLD → ~1.7s warm → ~0.6s fully warm.** Cold cost is scattered historical-bar random I/O (~5.3ms/probe cold vs ~0.26ms warm). Set B, not pass 5, is the residual bottleneck.
- **Forecast new total:** cold **~18s** (104→18, ≈6×); warm **~3–5s** (≈20–30×). The cold residual is almost entirely Set B's scattered historical probes → the **write-time `close` precompute** follow-on (probes→0) would cut even the cold case to ~3s.
- **Timeout:** cold worst-case ~18s → a ~60s `statement_timeout` is safe (3× headroom); confirm against the real end-to-end build before lowering from 120s.

## Sequence (each step gated)
1. ~~*(safe, now)* Measure pass 5 cost + `EXPLAIN`-confirm the gated membership does ~0 probes.~~ **DONE — see Measurements above.**
2. Build the 3-set version + kill-switch → `typecheck`.
3. Synthetic fixtures pass on new + **fail** on a deliberately-broken build.
4. Update guard tests.
5. Dev A/B: count-parity + value-diff (snapshot old vs new) identical.
6. Measure new end-to-end runtime → set timeout to a measured value → swap (behind kill-switch).

## Follow-ons (not in this change)
- Composite index `(profile_id,symbol,timeframe,direction,signal_at)` on `signal_monitor_events`.
- Write-time `close` precompute → probes → 0 (needs a one-time backfill of 37,807 rows).
- Pass-5 optimization if measurement shows it is the new bottleneck.
