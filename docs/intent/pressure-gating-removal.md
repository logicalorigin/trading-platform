# Intent: Relieve DB-pool pressure (demand reduction) + remove dead caps + de-flap the signal

Status: **confirmed & corrected** (interview-me + inventory audit, 2026-06-22). Renamed focus: the pressure signal is *real*, so the fix is to reduce the demand that maxes the pool, not to remove the signal.

## Correction to the original premise (important)
The earlier belief — "the app falsely thinks pressure is high; the gating is deprecated, remove it" — was **disproven by an independent inventory**:
- `resourceLevel` (what every real gate reads) = `max(rss, heap, dbPool, eventLoop)` and **deliberately excludes request latency** (`resource-pressure.ts:384-389`) — so the "slow broker route → false high" theory was already engineered out.
- "high" is driven by **db-pool 12/12 active with waiters** (`dbPoolLevel`, `resource-pressure.ts:243-260`) — a **true** saturation reading, confirmed across live reads.
- 12 is a **hard provider cap** (helium plan): `lib/db/src/index.ts:145-157` — *"Do not raise it: relief must come from reducing concurrent demand."*
- Most pressure *consumers* are load-bearing back-pressure that protect the scarce pool. Only the **cap-based gating is dead code** (gutted 2026-06-05 `d030937`): `caps.signalOptions` is a no-op at all levels; four signal-monitor capping fns `void` their pressure input.

Unification: the price-freeze, the 56 "outside freshness", and "pressure high" are **one root cause — genuine DB-pool exhaustion against the hard 12-connection cap, driven by excessive concurrent demand.** Reduce the demand → pool stops maxing → pressure falls → gates stop firing → freshness self-heals.

## Confirmed intent (option a)
- **Outcome:** Reduce concurrent DB-pool demand so the pool is no longer chronically 12/12; `resourceLevel` then sits at normal/watch under normal load and the (kept) back-pressure gates rarely fire. Also: delete the Tier-1 dead caps (cosmetic, zero behavior change) and de-flap the dbPool signal.
- **Success:** Pool not chronically saturated (idle headroom under normal load); `resourceLevel` not stuck "high"; **zero tickers outside freshness**, self-healing with no manual chart view; Tier-1 dead caps removed; dbPool de-flap in place.
- **Constraint:** **Keep** the load-bearing gates (route-admission shed, diagnostics DB-persist skip, signal-monitor backfill skip, shadow fast-fallback, overnight pause); do **not** raise the hard 12 cap; preserve trading correctness (no bar-content/signal-semantics changes).
- **Out of scope:** removing/relaxing the load-bearing gates; the chart-view side-effect backfill; cohort-1 aged-out non-universe symbols (JPM/ORCL hygiene); "cope with high pressure" workarounds (floor/max-staleness).

## The demand hogs (evidence, this session)
1. ✓ DONE — sparkline-seed concurrency capped 4→2 (`routes/platform.ts`); seed p95 12s→0.7s, pool went to idle:4-7.
2. ✓ DONE — quote-snapshot de-block (`platform.ts getQuoteSnapshotsUncached`); SPY snapshot 6.4s→0.05s.
3. **TODO (biggest)** — `execution_events` over-fetch: `listDeploymentEvents` (`signal-options-automation.ts:2017`, `SELECT *` incl. large `payload`, limits 500/2500/10000) called ~8× per signal-options scan cycle → 1,632 slow queries today (4× any other table). **This file is parallel-agent-owned → coordinate.**
4. **TODO** — signal-monitor `/state` 1.4MB poll + per-change cockpit recomputes across ~477 live SSE connections.
5. Bar backfill itself is a pool consumer but does not need changing — once others stop maxing the pool, the backfill (currently skipped under "high") runs and freshness heals.

## Plan shape (to be detailed via /planning-and-task-breakdown)
- Phase A (safe, mine, now): dbPool de-flap (`resource-pressure.ts:252`, require `waiting≥2`); delete Tier-1 dead caps/no-op fns.
- Phase B (the real relief): cut `execution_events` over-fetch (coordinate w/ parallel agent) + trim the `/state` payload/cadence.
- Phase C (verify): pool not chronically 12/12; `resourceLevel` normal; 0 outside freshness self-healing; no manual `/bars`.

## Grounding pointers
- Pressure producer/levels/thresholds: `artifacts/api-server/src/services/resource-pressure.ts` (levels `normal|watch|high`; `resourceLevel` 384-389; dbPoolLevel 243-260; caps no-op 301-339).
- Hard pool cap: `lib/db/src/index.ts:145-157`. Inventory tiers (dead vs load-bearing) recorded in this session's audit.
- Freshness chain: `signal-monitor.ts` backfill `:3559/3600/7396`; 1d excluded from rollup `signal-monitor-local-bar-cache.ts:39`.
