# WO-SO-01: Capture-diagnostic fix (Phase 0) + P1 partial scale-outs (Phase 1)

You are `codex-worker` (xhigh) for `claude-lead` (session ea30b14a, signal-options lane). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. The working tree has other agents' WIP — obey SCOPE strictly. Ponytail discipline binds you: laziest solution that actually works; no speculative abstractions; every changed line traces to this order.

## Ownership + tree state (read first)

- You are the ONLY worker allowed to edit `signal-options-automation.ts` / `signal-options-exit-policy.ts` / `signal-options-worker.ts` / `lib/backtest-core/src/signal-options.ts` while you run.
- Those files already carry UNCOMMITTED P3 work (conditional quality exits — flag `conditionalQualityExitsEnabled` already LIVE on deployment 7e2e4e6f). Build on top; do not revert or "clean up" any of it.
- Files owned by OTHER live lanes — never touch: `signal-monitor*.ts`, `platform.ts`, `market-data-store.ts`, `runtime-flight-recorder.ts`, `automation.ts`, `backtesting.ts`, anything under `artifacts/backtest-worker/`, `overnight-signal-expectancy*`, `lib/db/schema/*`, `artifacts/pyrus/*`. `shadow-account.ts` is dirty with adjacent work: you may edit ONLY the shared exit-dedup guard region (~4914–4954) and its tests if Phase 1 requires it — leave every other dirty hunk in that file untouched.
- Do NOT commit anything. Leave changes in the working tree, report `git diff --stat`.
- Do NOT flip any deployment flag or edit any `algo_deployments.config` row. claude-lead does flag flips.

## Background — root causes are ALREADY CONFIRMED (2026-07-07 recon, SQL + code evidence). Do not re-diagnose; verify cheaply and fix.

The 6x thesis (`5-27 trading analysis.md`, `TRADING_STRATEGY_BACKHALF_PLAN_2026-06-16.md`): Apr1–May21 realized $150,959 vs $996,747 post-exit-high (6.6x); biggest leak `runner_trail_stop` ($485k left). P1 = partial scale-outs. KNOWN CAVEAT you must respect in your report: window A's numbers are 100% backfill-reconstructed (hindsight fills); the live window (May22→) is the honest baseline, where `runner_trail_stop` is still the top positive bucket (+$8,659, 67% win, 36 exits).

**Confirmed fact 1 — capture diagnostic:** `postExitOutcome` is a hindsight enrichment stamped ONLY by the backfill/replay path: `computeBackfillPostExitOutcome` defined `signal-options-automation.ts:16703`, called `:17876`, stamped onto the payload at `:17920` inside `closeBackfillPosition`. The LIVE exit writer (`:13497–13528`, `SIGNAL_OPTIONS_EXIT_EVENT`) never sets it. All 722 enriched exits were enriched by ONE backfill run on 2026-05-22 00:27–03:27 UTC; it was never re-run. Every exit occurring on/after 2026-05-22 (145 events) lacks the field → review reads 0.00. The review consumes `shadow_orders.payload #>> '{postExitOutcome,highPrice}'` (mirrored from the exit ExecutionEvent) at `scripts/src/shadow-options-management-review.ts:241,288,311,343`.

**Confirmed fact 2 — "unknown" exit reasons:** the 30 unknown exits (−$11.4k) are `shadow-expiry-maintenance-*` orders whose reason lives at `payload.exitReason` / `payload.maintenanceReason`; the review buckets on `coalesce(o.payload->>'reason','unknown')` (`shadow-options-management-review.ts:336,766`). Mis-keyed, not lost.

DB: `psql -h helium -d heliumdb -U postgres`. Events table: `execution_events` (`event_type='signal_options_shadow_exit'`); orders mirror: `shadow_orders`.

## Phase 0 — Restore the capture diagnostic (small, surgical)

1. **Enrichment job**: create `scripts/src/shadow-options-post-exit-enrich.ts` — a re-runnable job that finds exit events (and their `shadow_orders` mirrors) missing `postExitOutcome` in a `--from/--to` window, computes the outcome with the SAME semantics as `computeBackfillPostExitOutcome` (post-exit option-bar scan; reuse/extract that logic rather than reimplementing — a small export from `signal-options-automation.ts` is acceptable), and `jsonb_set`s it ONLY where absent. Additive and idempotent: never overwrite an existing `postExitOutcome`, never touch other payload fields. If post-exit option bars are unavailable for some exits, skip and count them honestly.
2. Run it for 2026-05-22 → 2026-07-07. Report coverage: enriched / skipped-no-data / already-present.
3. **Review reason fix**: in `shadow-options-management-review.ts`, bucket on `coalesce(payload->>'reason', payload->>'exitReason', 'unknown')` (both SQL sites, :336 and :766 — verify no other bucketing sites), so maintenance liquidations attribute correctly.
4. Re-run the management review for 2026-05-22..2026-07-07 (find the invocation from the script header / scripts/package.json; prior run dir `scripts/reports/shadow-options-management-review/2026-07-07T23-55-31-225Z`). Quote the refreshed Opportunity Snapshot + exit-reason table in your report — this is the honest LIVE-window capture baseline that P1 will be judged against.
5. OPTIONAL (only if trivial, <30 lines): schedule/wire the enrichment so future exits get enriched (e.g., piggyback an existing maintenance pass). If not trivial, write the recommended wiring in the report instead — claude-lead will order it separately.

## Phase 1 — P1 partial scale-outs (config-gated, default OFF)

Precise anchors from recon (verify as you go; line numbers may drift a few lines from the uncommitted WIP):

- **Decision point**: first trail arm = `signal-options-exit-policy.ts:508–511` (`legacyTrailActive` via `progressiveTrailStep != null` or `returnPct >= trailActivationPct`; `trailActive = usesWireTrail || legacyTrailActive`). Progressive step selection `:119–139`; `returnPct` is PEAK return (`:425`).
- **Decision return shape**: `computeSignalOptionsPositionStop` returns at `:561–619` — add optional `exitQuantity` (or `exitFraction`) + a `scaleOutArmed` marker there; absent field = full close everywhere (backward compatible).
- **Fold full-close assumption (THE core change)**: `foldSignalOptionsPositionEvent` (`signal-options-automation.ts:6720–6813`) does `positions.delete(symbol)` at `:6752` on ANY exit event. Partial exits must branch: decrement `current.quantity` (and `premiumAtRisk` proportionally), preserve `peakPrice`/`stopPrice`/trail state, delete only when residual ≈ 0.
- **P&L**: `signalOptionsRealizedPnl` (`:7704–7717`) and every emit site pass full `position.quantity` — partial exits pass the SOLD quantity.
- **Primary emit site** for the scale-out: the live mark-time management path `:13497–13529` (in-memory claim `tryClaimSignalOptionsPositionExit` keyed `deployment:positionId` at `:13489` / defined `:12944–12957`). A scale-out must NOT consume the position's one exit claim in a way that blocks the later final exit.
- **Shadow book already handles partial sells**: `applyShadowFillToBook` (`shadow-account.ts:3465–3514`) decrements quantity and deletes only at ≤1e-9 — a partial SELL via the normal shadow order path Just Works at the book layer. The reconciliation merge `mergeActivePositionsWithShadowLedger` (`automation.ts:7244–7278`) overwrites quantity from the ledger and max-merges peak — residual quantity flows back through here; verify peak/trail preservation.
- **DEDUP CONSTRAINT (design carefully, this is the trap)**: the shared guard rule (`shadow-account.ts:4914–4954`, commit `c9138f63`) is "one pnl-bearing `shadow_exit` per deployment+symbol at/after position.openedAt", covering the three maintenance/tick sites; and `computeSignalOptionsDailyRealizedPnl` (`automation.ts:7719–7761`) assumes ONE realized pnl per position lifecycle (keyed by position.id). If the scale-out emits a standard pnl-bearing `signal_options_shadow_exit`, the final exit will be treated as a duplicate and daily pnl will mis-count. Choose the least-invasive resolution and justify it — e.g. mark scale-out events `payload.partial: true` with their own event identity, teach the guard rule "partials don't count as THE exit", and make daily-pnl SUM partial+final per position. A new event_type is allowed if cleaner (it becomes a DB-durable string — name it `signal_options_shadow_scale_out` and note it for the review script), but prefer flagging on the existing type if that keeps the diff smaller.
- **Config**: type block `lib/backtest-core/src/signal-options.ts:107–131`; defaults in BOTH blocks (`:271–278` baseline, `:363–369` tuned/aggressive); **normalizer `:886–931` MUST get a `scaleOut` branch or deployment-config values are silently dropped** (progressiveTrailSteps normalizer `:538–560` is the pattern). Shape: `scaleOut: { enabled: boolean (default false), sellFractionPct: number (default 60), runnerGivebackPct: number (default 30) }`. Generated zod (`lib/api-zod/.../signalOptionsExecutionProfile.ts`) types exitPolicy as opaque JsonObject — no codegen needed. NO UI work in this order.
- **Semantics**: fires at most ONCE per position (persist the fired marker so restarts don't double-fire — the fold/ledger is the durable state; an event-derived marker is better than new state), only when `quantity ≥ 2`; sell `clamp(round(quantity*sellFractionPct/100), 1, quantity-1)`; residual uses `runnerGivebackPct` for trail giveback (looser), peak NOT reset; progressive-trail, P3 conditional-quality overnight logic, and wire/greek trail keep operating on the residual unchanged.
- **Backtest parity**: the backfill/replay exit path (`closeBackfillPosition` `:17841–17925`, stop loop `:18002–18046`) is the backtest-parity surface and does single full closes. Either implement the same scale-out there or — acceptable for v1 — leave backfill full-close and STATE IN THE REPORT that backfill/replay does not simulate scale-outs yet (so sweep results stay interpretable). Do not silently diverge.

**Tests (failing-first)** — new `signal-options-scale-out.test.ts` (api-server) + backtest-core additions as needed:
- fires once at first trail arm, correct quantity math + clamps (1 contract → no scale-out; 2 → sell 1 keep 1);
- residual keeps peak and uses `runnerGivebackPct`;
- fold: partial exit event → position retained with reduced quantity; final exit → deleted; restart replay (fold from events) does not re-fire the scale-out;
- dedup: scale-out + final exit both land; duplicate scale-out blocked; daily-pnl sums partial+final exactly once each;
- disabled/absent config → byte-identical behavior (existing suites double as proof);
- normalizer round-trip: deployment-config scaleOut values survive `resolveSignalOptionsExecutionProfile`.

## SCOPE (exhaustive)

`artifacts/api-server/src/services/signal-options-automation.ts`, `signal-options-exit-policy.ts`, `signal-options-worker.ts`, `shadow-account.ts` (dedup-guard region ~4914–4954 ONLY), their `signal-options-*.test.ts` / `shadow-account-signal-options-*.test.ts` siblings incl. new test files, `lib/backtest-core/src/signal-options.ts` + `signal-options.test.ts`, `scripts/src/shadow-options-management-review.ts`, new `scripts/src/shadow-options-post-exit-enrich.ts`. Nothing else. If you believe you need another file, STOP and write that in the report instead of editing it.

## Acceptance / verification

- Phase 0: enrichment coverage counts; refreshed review report path + Opportunity Snapshot and exit-reason table quoted (expectation: `unknown` bucket ~empty, post-exit-high > 0 for enrichable exits).
- `pnpm --filter @workspace/api-server run typecheck` → zero errors in SCOPE files (list pre-existing errors elsewhere; don't fix them).
- `pnpm exec tsc -p lib/backtest-core/tsconfig.json --noEmit` clean.
- From `artifacts/api-server`: `pnpm exec tsx --test src/services/signal-options-scale-out.test.ts src/services/signal-options-overnight-exit.test.ts src/services/signal-options-trailing-ratchet.test.ts src/services/signal-options-automation.test.ts` green; from `lib/backtest-core`: `pnpm exec tsx --test src/signal-options.test.ts` green. Run any `shadow-account-signal-options-*` suites you touched.
- Scope-check: `git status --short` delta vs your start covers only SCOPE files.

## Deliverable

`.codex-watch/wo-so-01-capture-p1-report-2026-07-07.md`: Phase 0 coverage + refreshed live-window baseline numbers; P1 design decisions (esp. the dedup resolution and any new event type); backfill-parity stance; test evidence (pass counts); `git diff --stat`; expected tally-comparator drift note (`SIGNAL_OPTIONS_TALLY=shadow` bake is running — partial exits may create EXPECTED drift; say where); deferred items with reasons. claude-lead reviews, flips `scaleOut.enabled` on 7e2e4e6f, and lands commits.
