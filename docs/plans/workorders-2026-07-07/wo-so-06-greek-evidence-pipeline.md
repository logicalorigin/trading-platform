# WO-SO-06: Greek evidence pipeline — G1 leftovers + gex_snapshots wiring (scripts lane)

You are `codex-worker` (xhigh) for `claude-lead` (session ea30b14a, signal-options lane). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Ponytail discipline binds you. Another worker (WO-SO-01) owns the signal-options SERVICE files right now — your scope is scripts + a possible small lib adapter ONLY.

## Ground truth (from WO-SO-05 audit, `.codex-watch/wo-so-05-greek-open-items-audit-2026-07-07.md` — read it first)

- G1 is HALF-fixed: `scripts/src/signal-options-exit-policy-sweep.ts:21` sets `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED`, but `scripts/src/signal-options-greek-selector-smoke.ts` does NOT, and still uses Black-Scholes reconstruction (`:217`). The latest sweep report rows show `missing_greeks`/`greeks_unavailable` — no real greek evidence run has ever succeeded.
- The exit-policy sweep hardcodes `greekMaxAgeMs` 15s somewhere (audit slice 2) — find and align to the 45s source default (`lib/backtest-core/src/signal-options.ts:290-295`).
- `gex_snapshots` holds real historical greeks but NOTHING in the signal-options selector/backfill/smoke reads it. Data profile (audit): 1,527 rows, 491 symbols, 2026-05-29→2026-07-06, 27 distinct dates, `partial=1523/ok=4`, snapshots per symbol-day median 1 / avg 2.41 / max 264; SPY-style symbols have rich 1-3 DTE near-money strike coverage (~72 near-money strikes per expiry).
- DB: `psql -h helium -d heliumdb -U postgres`. Schema ref: `lib/db/src/schema/market-data.ts:181` (gex_snapshots), row type `gex.ts:39`.

## Task

1. **G1 completion (S):** make the greek-selector smoke set `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED` the same way the exit sweep does; remove/align the 15s `greekMaxAgeMs` hardcode in the sweep to the 45s default (keep it overridable via env).
2. **gex_snapshots adapter (M, the core):** build a read-only historical-greeks lookup used by the smoke/evidence scripts — given (symbol, expiry, strike, right, timestamp) return the nearest gex snapshot greeks within a configurable tolerance (default ±30min), with explicit provenance (`source: gex_snapshot` vs `source: bs_reconstruction`). Put it in `scripts/src/` (or `lib/backtest-core` ONLY if it must be shared and touches no signal-options.ts exports another worker is editing — prefer scripts).
3. **Match-rate analysis (M, SQL + script):** quantify how much real-greek evidence is actually available: for historical shadow ENTRY events (signal_options entry events with a selected contract), what fraction has a gex snapshot for that underlying within ±15/±30/±60min at the matching expiry and within 1 strike step? Report by month and by symbol tier (SPY/QQQ-like vs long tail). Same question for EXIT-time greeks (this is the exit-management replay feasibility question — with median 1 snapshot/symbol-day, expect this to be thin; SAY SO with numbers).
4. **Verdict + smoke proof (S):** update the smoke script to prefer the adapter over BS reconstruction where a match exists, then do ONE bounded smoke run (≤5 symbols with best gex coverage, ≤5 trading days) purely to prove the plumbing produces `source: gex_snapshot` scored candidates. Before any run that hits the API/backfill: dry-check one tiny slice first and ABORT the run (report the blocker) if it 503s, errors, or visibly pressures the DB — this repo has a DB-saturation history; do not hammer it.
5. **Recommendation:** based on 3+4, state whether gex_snapshots supports (a) entry-selection A/B (G3) now, (b) exit-management replay, or (c) neither without an ingestion upgrade — and what the cheapest ingestion improvement would be (e.g., snapshot cadence on positions' symbols during RTH).

## SCOPE

`scripts/src/signal-options-greek-selector-smoke.ts`, `scripts/src/signal-options-exit-policy-sweep.ts`, new `scripts/src/gex-historical-greeks.ts` (+ its test if the scripts package has a test setup), new analysis script if needed. NOTHING under `artifacts/api-server/src/`, no `lib/backtest-core/src/signal-options.ts`, no deployment config, no env-file edits, no commits.

## Acceptance / verification

- `pnpm --filter @workspace/scripts run typecheck` (or the scripts package's check — find it) clean.
- Match-rate tables produced from bounded SQL (aggregates only).
- The one bounded smoke run's report dir path + evidence that ≥1 candidate scored with `source: gex_snapshot` (or the precise blocker).
- `git status --short` delta covers only SCOPE files.

## Deliverable

`.codex-watch/wo-so-06-greek-evidence-report-2026-07-07.md`: what changed, match-rate tables, smoke-run evidence, the (a)/(b)/(c) verdict with numbers, ingestion recommendation, `git diff --stat`, deferred items. claude-lead reviews and folds results into the G2/G3 program.
