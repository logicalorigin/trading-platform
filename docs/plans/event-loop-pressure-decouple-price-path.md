# Plan: Decouple price reads & trading scans from the event-loop pressure signal

**Status:** Stage 1 IMPLEMENTED + verified (2026-06-24, session 7f625e0d) — working-tree, not yet
committed/deployed. Stage 2 + Track B still open.
**Date:** 2026-06-24
**Author:** investigation session 54d65e0d (Stage 1 impl: session 7f625e0d)
**Related:** `docs/plans/execution-events-saturation-remediation.md`, `docs/plans/db-pool-saturation-index-fix.md`

## Problem (measured)

All consequential pressure sheds — freezing live prices and pausing trading scans —
gate on `resourceLevel === "high"`. `resourceLevel = max(rss, heap, pool, eventLoop)`
(resource-pressure.ts:411). In practice **event-loop delay is the only component that
trips "high"**:

| Component | Trip ("high") | Observed | Tripping? |
|---|---|---|---|
| event-loop p95 | ≥ 400 ms | 176 ms @5min → 346 ms @14min → ~1000–1400 ms @80min | **YES (sole driver)** |
| RSS | ≥ 8,192 MB | 1,812 MB (22%) | no — 6.4 GB headroom |
| heap % | ≥ 80% | 26% | no |
| db pool | 12/12 + ≥2 waiters | bursty | intermittent only |

Consequence when it trips:
- **Price freeze**: route-admission sheds quote/sparkline/move-column (429, `Retry-After: 15s`),
  repeating the whole time it's "high" (≈continuous for ~30 min on the 80-min process).
- **Scan pause**: `isApiResourcePressureHardBlock` pauses deployment scans (+30s/cycle;
  measured **29.5 min** fully stalled).

**Why this is a foot-gun:** event-loop delay is a *symptom*, not a finite resource.
Shedding cheap price reads / pausing scans does **not** free event-loop time if the
blocker is elsewhere (DB result processing, GC, flight-recorder writes) → self-defeating
loop: shed → no relief → stays high → keeps shedding. Root load is unchanged by the
rebuild: **38–43 slow DB queries/min, up to 16 s** (execution_events LIKE scans + shadow
read cache).

## Principle

Gate **consequential** sheds (user-facing price reads, trading-scan pauses) on **finite-resource
exhaustion only** — `max(rss, heap, pool)` — where shedding genuinely relieves the constraint.
Keep event-loop delay as a **telemetry/display** signal and for **harmless** sheds (diagnostics
DB-write skip), but stop letting it freeze prices or halt trading.

## Design

Add a derived level `hardResourceLevel = applyHysteresis(max(rssLevel, heapLevel, poolLevel))`
to `ApiResourcePressureSnapshot` (excludes `eventLoopLevel`). Compute it in `buildSnapshot`
alongside `resourceLevel`, with its own hysteresis tracker (rss stays immediate-high).

- `resourceLevel` (unchanged) = max(rss, heap, pool, **eventLoop**) → keep for display,
  `/readiness`, diagnostics-skip, telemetry.
- `hardResourceLevel` (new) = max(rss, heap, pool) → drives the consequential sheds.

This is surgical: under today's conditions (event-loop high, everything else normal)
`hardResourceLevel` = `normal`/`watch`, so prices and scans stop being shed — but if RSS or
the pool genuinely saturate, `hardResourceLevel` goes high and protection still fires.

## Changes (staged)

### Stage 1 — Stop price freezes  *(✅ DONE 2026-06-24 — verified, working-tree)*
Implemented: `hardResourceLevel = applyHysteresis(max(rss, heap, pool))` with an independent
hysteresis tracker (resource-pressure.ts); route-admission price/quote shed now gates on it
(route-admission.ts). `X-Pyrus-Resource-Level` header preserved as full `resourceLevel` for
telemetry; `X-Pyrus-Pressure-Level` = the governing (hard) level. 4 new unit tests; full suite
(resource-pressure 17/17, route-admission 17/17, readiness/bg-worker/completed-bars) + typecheck
green. 3-lens adversarial review = ship. Confirmed: route-admission is the complete consequential
price-shed surface; `isApiResourcePressureHardBlock` (scan pause) intentionally still on
`resourceLevel` pending Stage 2. Frontend client throttle (signal-matrix pollMs) keys off
`resourceLevel` (unchanged) — only a cosmetic display field reflects the lower hard level.

Original plan (for reference):
- **`resource-pressure.ts`**: add `hardResourceLevel` to the snapshot type + `buildSnapshot`
  (mirror the existing `resourceLevel` hysteresis, minus the event-loop input).
- **`route-admission.ts:461`**: change `pressureLevel: pressure.resourceLevel` →
  `pressureLevel: pressure.hardResourceLevel` for the deferred-analytics/decorative price shed.
  - Update the comment block (455-460) to explain event-loop is now excluded from price shedding.
- **Routes affected** (confirm full list with freeze-trace subagent — known so far):
  `/quotes/snapshot`, sparkline family, move-column quotes, deferred chart bars.
- **Tests**: `route-admission.test.ts` — assert deferred-analytics is allowed when event-loop
  is high but rss/heap/pool normal; still shed when rss/pool high.

### Stage 2 — Stop scan pauses  *(after CPU x-ray confirms scans aren't the blocker)*
- **`resource-pressure.ts:561` `isApiResourcePressureHardBlock`**: gate on
  `snapshot.hardResourceLevel === "high"` (was `resourceLevel`). Keep the
  `skipDeploymentScans` OR-clause (inert today, harmless).
- This frees signal-options-worker + overnight-spot-worker scan scheduling.
- **Gate condition**: only ship after the x-ray shows the event-loop blocker is NOT the
  scan bodies. Scans hit the DB, so if they ARE part of the clog, keep pausing them.

### Keep unchanged — seatbelts
- **DB-pool backoff** (transient-postgres-error.ts) — separate mechanism, genuinely firing
  (pool waiters present ~⅓ of samples). Untouched.
- **Memory/OOM guard** — `rss` is *in* `hardResourceLevel`, so real memory pressure still
  sheds. 6.4 GB from tripping; no change needed.
- **Diagnostics DB-write skip** (diagnostics.ts:3202) — stays on `resourceLevel` (shedding
  DB writes when the loop is busy is correct + harmless). Untouched.

### Track B — root cause (separate, the real fix)
- Capture a 30 s CPU profile of the API process while event-loop is high to confirm the
  blocker (hypotheses: execution_events LIKE scans / shadow read-cache result processing /
  flight-recorder sync writes of the 145 MB JSONL).
- Reduce that cost (ties into `execution-events-saturation-remediation`). When the loop stops
  crossing 400 ms, even the telemetry signal calms and Stage 2 becomes moot.

## Risk assessment

| Change | Risk | Mitigation |
|---|---|---|
| Stage 1 (price shed → hardResourceLevel) | **Low** — prices are cheap reads, unlikely to be the loop blocker; still shed under real memory/pool exhaustion | unit tests; live 429→200 reproduction |
| Stage 2 (scan pause → hardResourceLevel) | **Medium** — scans hit the DB; could add load if they're the blocker | gate behind x-ray evidence; watch pool + query rate after |
| New `hardResourceLevel` field | Low — additive | default-safe; existing consumers untouched |

## Verification / success criteria

1. **Reproduce the freeze** (pre-fix): `/api/quotes/snapshot` with deferred priority →
   `429` while event-loop is high. (Already reproduced.)
2. **Post-Stage-1**: same probe → `200` while event-loop high + rss/pool normal; and a unit
   test proving it still `429`s when rss/pool forced high.
3. **Live watch** (reuse sampler harness): over a window where event-loop crosses 400 ms,
   confirm `defProbe` stays `200`, scan age stays low (Stage 2), readiness/seatbelts intact.
4. No regression in pool-pressure or memory headroom numbers.

## Rollback
Single-line revert of the two `pressureLevel`/`hardResourceLevel` gate swaps restores prior
behavior; `hardResourceLevel` field can remain (inert).
