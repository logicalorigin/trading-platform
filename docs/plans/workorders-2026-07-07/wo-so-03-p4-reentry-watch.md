# WO-SO-03: P4 — Early-invalidation re-entry watch (GATED on WO-SO-02)

You are `codex-worker` (xhigh) for `claude-lead` (session ea30b14a, signal-options lane). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Ponytail discipline binds you.

## Gate (check first, abort politely if it fails)

`.codex-watch/wo-so-02-p2-dual-confirm-report-2026-07-07.md` must exist (or a `wo-so-02-blocked` note plus an explicit claude-lead go-ahead marker `.codex-watch/wo-so-03-go.md`). Otherwise write `.codex-watch/wo-so-03-blocked-2026-07-07.md` and STOP.

## Ownership + tree rules

Same as WO-SO-01/02: uncommitted P3+P1+P2 work is in your files — build on it; never touch other lanes' files; do NOT commit; do NOT flip deployment flags.

## Background

6x evidence (`TRADING_STRATEGY_BACKHALF_PLAN_2026-06-16.md` §3b): `early_invalidation` exits realized −$10,677 with $53,290 left post-exit; **~49% of early-invalidation exits re-validated after exit**. `5-27 trading analysis.md` §Re-Entry Watch: after an early-invalidation or hard-stop exit, watch the setup; if it recovers, re-enter — via a FRESH contract selection (the original contract has decayed; never blindly reopen it).

## Task (config-gated, default OFF — smallest honest v1)

1. **Config**: `reEntryWatch: { enabled: boolean (default false), watchWindowBars: number (default 6), maxReEntriesPerSignal: number (default 1) }` in the exitPolicy/config block of `lib/backtest-core/src/signal-options.ts`, threaded like P1/P2/P3.
2. **Watch state**: when a position exits with reason `early_invalidation` or `hard_stop`, record a watch entry (symbol, direction, source signal identity, exit bar/time, exit underlying price) in the position/candidate state the automation already persists — no new DB tables (owner architecture rule).
3. **Re-validation check**: during the normal entry scan (do NOT add a new scheduler), if a watched setup shows a fresh actionable same-direction signal within `watchWindowBars` — passing ALL existing entry gates (actionability, MTF, liquidity, budget) — allow re-entry even where the seen-signal/dedup logic would normally suppress the "same" signal, capped by `maxReEntriesPerSignal`. Contract selection runs fresh through the existing greek/slot selector (this satisfies the "new contract, not the decayed one" rule for free).
4. **Observability**: emit a distinguishable event/marker on re-entries (e.g. payload flag `reEntry: true` on the entry event) so the management review can later measure P4's value. If trivial (<10 lines), add a re-entry count line to the review script; otherwise defer with a note.
5. **Tests (failing-first)**: new `signal-options-reentry-watch.test.ts`: watch entry created on the two exit reasons only; re-entry allowed within window when gates pass; suppressed outside window; cap respected; dedup/seen-signal suppression correctly bypassed only for watched setups; disabled flag = byte-identical behavior.

## SCOPE

`signal-options-automation.ts`, `signal-options-worker.ts`, `signal-options-exit-policy.ts` (only if the exit path needs to signal watch creation), their tests (incl. new file), `lib/backtest-core/src/signal-options.ts` + test, optionally `scripts/src/shadow-options-management-review.ts` (count line only). Nothing else.

## Acceptance / verification

- `pnpm --filter @workspace/api-server run typecheck` clean for SCOPE files; backtest-core tsc clean.
- From `artifacts/api-server`: `pnpm exec tsx --test src/services/signal-options-reentry-watch.test.ts src/services/signal-options-scale-out.test.ts src/services/signal-options-opposite-dual-confirm.test.ts src/services/signal-options-automation.test.ts` green.
- Scope-check via `git status --short`.

## Deliverable

`.codex-watch/wo-so-03-p4-reentry-report-2026-07-07.md`: design decisions (esp. how re-validation is detected and how dedup bypass is bounded), test evidence, `git diff --stat`, deferred items.
