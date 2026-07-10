# Pressure-gate retirement doctrine — 2026-07-10

Owner decision (Riley, 2026-07-09 evening): **every pressure/emergency degrade is a footgun
unless proven necessary.** Burden of proof is reversed — a gate does not stay because it might
help; it stays only if the numbers show it fired AND helped. Evidence base: 4-agent source/history
audit (session 8d954547, wf_2b62c00f), flight-recorder data Jul 8–10, and the pressure root-cause
docs (`signal-monitor-gc-pool-rootcause-2026-07-09.md`, `db-pool-admission-bus-2026-07-09.md`).

## The footgun ledger so far (why the doctrine is right)

Pressure degrades have repeatedly CAUSED user-visible wrongness:
- $0/blank day change and missing stops on the positions table (multiple sessions of debugging;
  fixed by DECOUPLING day change from pressure — `df70c38c`, `4dd80549`, `e93f50b2`).
- Bid/Ask column lagging Spot (pressure-starved option-quote work; the original complaint).
- Diagnostics probes 429'd by route admission during an incident — while debugging that incident.
- The positions fast path originally gated on the latency-folded `level` and served degraded data
  "almost constantly" until deliberately narrowed (comment at `shadow-account.ts:9555` region).
Meanwhile the thing that actually ended the Jul-9 meltdown (pool queue peak 137, 65 restarts/day →
tonight max queue 1, zero pressure events) was DEMAND REDUCTION + LANE FAIRNESS, not the degrades.

## Not in scope (not footguns — they never change what data is served)

- DB admission lanes (`lib/db/src/admission.ts`) — pure queue fairness, never sheds, not
  pressure-driven. KEEP.
- Physical `authPool`/`tradingPool` isolation — static capacity reservation. KEEP.
- Telemetry consumers (flight recorder pressure stamps, universe pressure gauge field). KEEP.

## Gate inventory and verdicts

Proof window: 2026-07-10 market open through Friday 2026-07-11 close, measured via the new
`shadowAccountReads.pressureDegrades` counters (runtime diagnostics), existing per-route
`staleServedCount`, `barsBackgroundPersist.pressureSkipped`, admission-lane gauges, and
`market-open-acceptance.mjs` (WO-OPEN-ACCEPT).

Verdict key: **RETIRE-NOW** (already proven wrong/uneeded) · **PROVE-OR-RETIRE** (kill unless it
fires AND demonstrably protected the open) · **KEEP** (fires on hard finite-resource limits only,
degrades nothing user-facing).

| # | Gate | File | User-visible effect | Counter | Verdict |
|---|------|------|--------------------|---------|---------|
| 1 | Positions pressure fast path (`resourceLevel==="high"`) | `shadow-account.ts:9554/10294` | Whole positions table served from last-known caches, `degraded:true` | `pressureDegrades.positionsFastPath` (NEW) | **PROVE-OR-RETIRE** — if open passes acceptance without it firing, delete the fast path + both lastKnown maps (~250 lines) |
| 2 | Equity-history hard-pressure fallback | `shadow-account.ts:8908` | Equity chart returns fallback series | `pressureDegrades.equityHistoryPressureFallback` (NEW; db-backoff cause split out — backoff is an OUTAGE response, judged separately) | **PROVE-OR-RETIRE** — WO-EQH-1 (`39c5b6ef`) just made the real read ~26ms; the expensive read this gate protected against no longer exists |
| 3 | Stale-if-high reuse serving (positions/allocation) | `shadow-account.ts` readReusable* gates | Slightly-old cached response instead of rebuild | per-route `staleServedCount` (exists) | **PROVE-OR-RETIRE** — mildest degrade; same test |
| 4 | Signal-options performance fallback on latency-folded `level` | `signal-options-automation.ts:~12344` | Stale performance payload whenever latency wobbles | none | **RETIRE-NOW (tomorrow)** — uses the exact gauge already proven wrong for gate #1; file carries tandem WIP tonight (algo exit-fill session), DO NOT touch until it lands. Either narrow to `resourceLevel` or delete |
| 5 | Route admission shed (hard-high; decorative/analytics only) | `route-admission.ts:471` | 204/429 on cosmetic + analytics routes | admission diagnostics | **KEEP** (hard memory/pool limits; never touches trading/positions/screens) — but add diagnostics routes to the never-shed set (they 429'd during the incident we were debugging) |
| 6 | Bars background persist drop under hard block | `platform.ts:9164` | None immediate (history persisted later) | `pressureSkipped` (exists) | **KEEP** for now — write-shedding under memory ceiling protects the process; re-judge after IDX-1 |
| 7 | Bars stale-refresh priority + historical hydration suppression (high) | `platform.ts:9473/17485` | Low-priority charts stay stale | partial | **PROVE-OR-RETIRE** |
| 8 | Signal-monitor hard-block skips + graduated caps | `signal-monitor.ts:143/1018/6022` | Matrix reads empty / fewer symbols under pressure | some counters exist | **PROVE-OR-RETIRE** — bar_cache demand fixes (F1/RET) removed most of what these protected |
| 9 | Options-flow scanner throttle | `platform.ts:1333` | Slower flow scanner | scanner diagnostics | **KEEP** — scanner is elastic background by nature; throttle = capacity planning, not data wrongness |
| 10 | Diagnostics DB-persist skip under high | `diagnostics.ts:3379` | None (events still in memory/recorder) | — | **KEEP** — prevents a write-storm feedback loop, no data served wrong |
| 11 | SnapTrade activity/history hard-block skips | `snaptrade-*.ts` | Sync deferred a tick | — | **KEEP** (background, retries) |
| 12 | Overnight-spot worker entry-skip | retired 2026-07-07 | — | — | already RETIRED by Riley — the precedent for this doctrine |

## Procedure

1. **Tonight**: counters live (this commit). Snapshot `pressureDegrades` = all zeros post-reload.
2. **07:15 MDT**: pre-open runbook (`soak-morning-runbook-2026-07-10.md`) unchanged.
3. **07:30–09:30 MDT**: run `market-open-acceptance.mjs`; read `pressureDegrades` +
   `staleServedCount` deltas at 08:00 and 09:30.
4. **Verdict rules**:
   - Gate never fired through Friday close → DELETE next session (each deletion is small and
     independent; #1 first, it has the worst footgun record).
   - Gate fired but acceptance FAILED anyway (interactive p95 ≥250ms etc.) → it didn't protect
     anything; DELETE and fix the demand instead.
   - Gate fired and acceptance passed → keep, re-judge monthly with the same counters.
5. Gate #4 (wrong gauge) is retired-or-narrowed tomorrow regardless, once the tandem exit-fill
   work in `signal-options-automation.ts` lands.

## Standing rule for new code (add to review checklist)

No new pressure-conditional behavior that changes WHAT DATA a user sees without (a) a firing
counter in diagnostics from day one, and (b) an entry in this table with a proof criterion.
Queue fairness, capacity caps, and background write-deferral don't need permission; serving
different numbers does.
