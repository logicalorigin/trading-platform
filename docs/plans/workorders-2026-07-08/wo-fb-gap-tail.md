# WO-FB-GAP-TAIL — bounded on-demand gap fetch for the stubborn frozen-signal tail (illiquid + 1h/1d)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals for this run):** You are a
> headless work-order worker, not an interactive session. (1) Do NOT create or update any
> SESSION_HANDOFF_* file — the orchestrator owns handoffs. (2) Do NOT read ~/.claude/, ~/.agents/,
> .claude/skills/, .agents/skills/, or agents/ — skill definitions are for other tooling and waste
> your run. (3) NEVER restart, rebuild, or reload the app; never run REPLIT_MODE=workflow, never
> signal the supervisor (no SIGUSR2) — the orchestrator owns runtime. (4) AGENTS.md coding
> discipline (lazy-minimal, stdlib-first, smallest diff) still applies. Work ONLY the order below.


Codex worker (xhigh), /home/runner/workspace. Brief: `docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md`
(§STAGE 2 DETAIL + "FOLLOW-UP for the stubborn tail"). READ THAT SECTION FIRST. Stage 2 landed a
memory-only 1m gap-fill (1m/2m/5m/15m) and verifiably unfroze cells at scale (frozen 1m cells 1142→1018
in ~4min as the cache warmed). The STUBBORN TAIL remains frozen: (a) illiquid symbols (MIDD: ~21.5h gap,
bars_since_signal 7228) where too few live 1m bars stream into memory to fill the gap; (b) 1h/1d
timeframes (would need >120h of standing memory — forbidden). Fix: when the memory cache CANNOT fill a
cell's gap, fetch ONLY the missing gap window from durable history, bounded and rate-capped.

## Anchors (verified 2026-07-08; re-locate by snippet)
- `signal-monitor.ts:5125` — `loadSignalMonitorLocalMemoryGapFillBars` merge into eval input (Stage 2 landing).
- `:4375` — `mergeCompletedBars` (the union-by-timestamp that leaves the hole).
- `:5105` — `SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE` (~64/cycle) — the established per-cycle capping
  pattern to imitate.
- Durable read helpers live in `market-data-store.ts` (prefer REUSING an existing narrow read; extending one
  with column projection is acceptable; a brand-new broad query is not).

## The change (design constraints are hard requirements)
1. Detection: a cell whose base-end << live-edge-start AND whose memory gap-fill could not close the hole
   (Stage 2 path already knows this) becomes a gap-fetch candidate.
2. Fetch: EXACT (symbol, timeframe, [base-end .. live-edge-start]) window, projected columns only, LIMIT
   bounded by the window/timeframe (a 240-bar ceiling is fine). 1h/1d supported via the same bounded fetch.
3. Budget: hard per-cycle cap (own constant, same order as the :5105 pattern; pick conservatively, e.g. 8-16
   cells/cycle) + never block the eval hot path (fetch async; the cell unfreezes on a later tick when the
   gap bars arrive — same contract as Stage 2's warm-cache behavior).
4. No standing memory growth: fetched gap bars flow into the SAME merge path Stage 2 uses (or the
   backfilled-base promote), not a new long-lived cache. This program exists because DB reads saturated the
   event loop — a read-storm regression is the failure mode. Your cap + narrow window is the defense; state
   the worst-case reads/sec in the report.
5. IDENTITY TEST (required by the brief, non-negotiable): for a filled-gap symbol, the crossovers that fire
   must equal a from-scratch contiguous-history computation. Stage 2 added a parity test
   (gap-filled == contiguous) — find it (rg "parity" / gap tests in signal-monitor tests) and EXTEND the
   same pattern to the fetched-gap path incl. a 1h case. Also a no-gap case (fetch never triggers).

## MUST-NOT
- Byte-identical signal semantics: this lever UNFREEZES cells; it must not alter which signals fire on
  contiguous data. No universe shrink. Do NOT raise DB pool max.
- Touch ONLY signal-monitor.ts, (optionally) market-data-store.ts read helpers, + tests. Dirty tree: no
  reverts/reformats outside your hunks; NEVER `git checkout`/`restore`. No commits, no `git add`.
- `git diff --stat` on both files at start AND end → report.

## Verification (paste tails)
1. `pnpm --filter @workspace/api-server run typecheck` → exit 0
2. `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → baseline 442/0; must stay green (your new tests add to the count).
3. New identity/no-gap/1h tests green.

## Report → `.codex-watch/wo-fb-gap-tail-report.md`
design as implemented (detection, window math, cap value + worst-case reads/sec), what changed (file:line),
test/typecheck tails, risks, start+end diff --stat.
