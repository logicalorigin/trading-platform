# WO-POS-3D — SUPERSEDED (root cause was a staleness predicate, not lost caches)

Status: **CLOSED — superseded by the root-cause fix landed 2026-07-09 evening**
(`shadowPositionMarkStaleForDayChange` in `shadow-account.ts`; see commit
`fix(shadow): same-day mark still on the opening fill is stale for day change`).
Do NOT implement the disk-persistence plan below.

## Why superseded (audit findings, 2026-07-09 ~19:30 MDT, 4-agent source/history audit)

- The day-change **baseline is already durable in Postgres** (`shadow_position_marks`,
  written by every mark refresh, read live per request via
  `readLatestShadowPositionBaselineMarks`). A restart loses nothing the disk file would save.
- The observed "$0 after reboot" rows (UCTT/SAIL/HON) were **same-day positions whose mark
  never got re-observed after the opening fill** (DB-verified: `as_of == opened_at`). For a
  same-day position the baseline IS the entry cost, so `current − baseline` is 0 **by
  construction** — a fabricated $0 that no cache persistence could fix.
- Fix landed: a mark still sitting on the opening fill is treated as stale for day-change
  purposes, so those rows flow into the existing honest-null branch (unknown → em-dash)
  until a real post-fill observation exists.
- The two guards proposed below were independently found unsafe: the clobber guard cannot
  distinguish a real flat day from a degenerate quote without threading `valuationReason`
  into the cache, and the trading-day guard must key on `dayStart`
  (`previousTradingDayOrSame`), not calendar day (overnight-session seam) — complexity that
  vanishes with the predicate fix.
- The in-memory `lastKnown*` maps remain memory-only by design: they only serve the
  pressure fast path (`resourceLevel === "high"`), warm from the full path + the
  non-blocking bootstrap (`e93f50b2`), and the fast path is expected to matter mainly at
  market open per `docs/plans/db-pool-admission-bus-2026-07-09.md`.

Original (retired) plan follows for the record — do not execute.

---

<details>
<summary>Retired plan: persist last-known stops/day-change to disk (D1) + full-path fallback (D2)</summary>

D1 was: one `.pyrus-runtime/shadow-last-known-marks.json` written debounced from both
record functions via `atomicWriteFlightRecorderJson`, hydrated lazily with a trading-day
guard. D2 was: full-path fallback to the lastKnown map on degenerate values plus a record
guard. Retired for the reasons above.

</details>
