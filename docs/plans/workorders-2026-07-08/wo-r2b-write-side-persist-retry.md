# WO-R2B — Retry of WO-R2: commit the write-side persist unit (REBASED after f834d411's backoff commit)

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). You HAVE commit
authority for exactly the files below. NEVER `git add -A`, `git add .`, or `git commit -a`.

CONTEXT: WO-R2 (`.codex-watch/wo-r2-report.md`) declined for two reasons, both now resolved:
1. Verify command was wrong — this repo runs tests via
   `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <files>` (NOT vitest).
2. platform.ts carried session f834d411's option-backoff lane — that lane has since LANDED at HEAD
   (`24b18d9d fix(option-chain): back off only on genuine upstream failure...`), which also
   committed `option-chain-policy.test.ts` (now clean — dropped from this order). The only backoff
   remnants in the dirty diff are content-identical +/- PAIRS (a pure relocation: the block sits at
   a different offset in the working tree than at HEAD). They ride along intentionally so the tree
   ends clean. Whole-file staging is now correct.

## Stage (explicit paths, whole files) — ONE commit
- `artifacts/api-server/src/services/market-data-store.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/platform-sparkline-seed.test.ts`
- `artifacts/api-server/src/services/platform-bars-background-persist.test.ts`
- EXCLUDED (held, SnapTrade shape): `artifacts/api-server/src/routes/broker-execution.test.ts`

## Pre-commit guards (ALL must hold; on failure `git reset` index and report)
1. Relocation check: in `git diff -- artifacts/api-server/src/services/platform.ts`, every +/- line
   containing `OptionBackoffTestInternals|clearOptionUpstreamBackoff|shouldBackOffOptionUpstream|optionUpstreamBackoffUntilByKey`
   must appear as content-identical +/- pairs (pure move, no semantic delta). If any such line is
   UNPAIRED, STOP — that means f834d411 has new in-flight work; report instead of committing.
2. Hunk floor: `git diff --unified=0 -- artifacts/api-server/src/services/platform.ts | grep '^@@' | head -3`
   — apart from the backoff relocation pairs, hunks must sit at/above ~line 8000 as before.
3. `git status --porcelain -- <the 5 staged paths>` shows only ` M` entries (no unexpected states).

## Verify (before the commit)
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT=0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/platform-bars-background-persist.test.ts src/routes/platform-sparkline-seed.test.ts` → all pass.

Commit message: `perf(bars-persist): coalesce background persist by window key, bounded queue + skipped-state contract, concurrency 1->3; requireFreshHistorical scope gating; drop dead IBKR option-chain path (WO-R2B)`

## Guardrails
Do NOT touch: account.ts, backtest-worker/**, flow-universe.ts, snaptrade-*, backtesting.ts,
overnight-spot-worker.ts, signal-monitor*.ts (WO-R3B owns), diagnostics.ts, automation.ts (WO-R4B
owns), lib/db/**, artifacts/pyrus/**, SESSION_HANDOFF*/POLISH_BACKLOG.md, untracked files.
If verify fails: no commit; report verbatim.

Report → `.codex-watch/wo-r2b-report.md`: commit SHA, guard outputs (esp. the relocation-pair
check), verify output tails.
