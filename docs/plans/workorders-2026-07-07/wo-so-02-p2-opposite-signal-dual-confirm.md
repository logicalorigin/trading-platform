# WO-SO-02: P2 — Opposite-signal dual-confirm exits (GATED on WO-SO-01)

You are `codex-worker` (xhigh) for `claude-lead` (session ea30b14a, signal-options lane). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Ponytail discipline binds you: minimal solution, no speculative abstractions.

## Gate (check first, abort politely if it fails)

`.codex-watch/wo-so-01-capture-p1-report-2026-07-07.md` must exist and its P1 phase must report the scale-out/partial-exit machinery (`exitQuantity`) landed with green tests. If absent or failed, write `.codex-watch/wo-so-02-blocked-2026-07-07.md` explaining, and STOP. You inherit WO-SO-01's file ownership; confirm no OTHER codex worker holds these files (check for newer wo-so-* order files claiming them).

## Ownership + tree rules

Same as WO-SO-01: build on the uncommitted working-tree state (P3 + P1 code); never touch other lanes' files (`signal-monitor*`, `platform*`, `backtest-worker/*`, `lib/db/schema/*`, pyrus UI); do NOT commit; do NOT flip deployment flags or edit `algo_deployments.config`.

## Background

6x evidence (`TRADING_STRATEGY_BACKHALF_PLAN_2026-06-16.md` §3b): `opposite_signal` exits realized $50,488 but left **$255,874** post-exit — the system panic-exits the full position on ONE opposing bar. P2 (plan §6 Phase 1): half-exit on the first opposite bar; full exit only on a second consecutive opposite confirm or MTF-alignment loss. `5-27 trading analysis.md` §Opposite-Signal Exits adds the quality shading: strong position quality + profit → trim, don't liquidate; weak quality → full exit immediately.

Current behavior: find the opposite-signal exit path in `signal-options-automation.ts` / `signal-options-exit-policy.ts` (exit reason `opposite_signal`; also see `flipOnOppositeSignal: true` in the exitPolicy config — understand what flip-close does today, including its exit-claim guard from the review fixes, before changing anything).

## Task (config-gated, default OFF)

1. **Config**: extend exitPolicy in `lib/backtest-core/src/signal-options.ts` with `oppositeSignalDualConfirm: { enabled: boolean (default false), firstBarSellFractionPct: number (default 50) }`. Thread exactly like P3/P1 fields.
2. **Decision layer**: on the FIRST opposite actionable bar against an open position: if enabled and quantity ≥ 2, emit a partial exit (reuse WO-SO-01's `exitQuantity` machinery — do NOT build a second partial-exit path) for `firstBarSellFractionPct`, and record a pending-confirm state on the position (which bar/signal triggered it). On a SECOND consecutive opposite confirm — or if MTF alignment for the original direction is lost, whichever the existing signal data makes cheapest to evaluate honestly — full-exit the residual with reason `opposite_signal`. If the next bar resumes the original direction, clear the pending-confirm state (the runner survives).
3. **Quality shading (only if cheap)**: if the position already carries the P3 quality tier (`signalQuality.tier`), use it: `low` tier → keep today's immediate full exit even when the feature is enabled. Do not build new quality computation.
4. **Flip interplay**: `flipOnOppositeSignal` currently closes-and-reverses. Define precedence explicitly: when dual-confirm is enabled, the flip decision applies at the FULL-exit step (second confirm), never on the half-exit. Pin with a test.
5. **Restart safety**: pending-confirm state must survive a restart (persist alongside whatever position state the scale-out once-only flag from WO-SO-01 uses).
6. **Tests (failing-first)**: new `signal-options-opposite-dual-confirm.test.ts`: half-exit fires once with correct quantity; second opposite → full exit with reason `opposite_signal`; direction-resume clears pending state; 1-contract position → today's behavior; low-tier → today's behavior; flip precedence; disabled flag = byte-identical behavior; restart persistence.

## SCOPE

`signal-options-automation.ts`, `signal-options-exit-policy.ts`, `signal-options-worker.ts`, their tests (incl. the new file), `lib/backtest-core/src/signal-options.ts` + test. Nothing else.

## Acceptance / verification

- `pnpm --filter @workspace/api-server run typecheck` clean for SCOPE files; `pnpm exec tsc -p lib/backtest-core/tsconfig.json --noEmit` clean.
- From `artifacts/api-server`: `pnpm exec tsx --test src/services/signal-options-opposite-dual-confirm.test.ts src/services/signal-options-scale-out.test.ts src/services/signal-options-overnight-exit.test.ts src/services/signal-options-trailing-ratchet.test.ts src/services/signal-options-automation.test.ts` all green.
- Scope-check via `git status --short`.

## Deliverable

`.codex-watch/wo-so-02-p2-dual-confirm-report-2026-07-07.md`: design decisions (esp. what counts as "second confirm" and why, flip precedence), test evidence, `git diff --stat`, deferred items. claude-lead lands and flips the flag.
