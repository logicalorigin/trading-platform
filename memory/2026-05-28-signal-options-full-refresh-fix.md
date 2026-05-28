# Signal Options Full Refresh Fix

Date: 2026-05-28

## Debug Report

- Symptom: Algo rows showed fresh/late signals but stayed in awaiting scan, with signal bars often 10-15 minutes behind even though Massive realtime bars were current.
- Root cause: The signal-options worker refreshed only a pressure-capped rotating batch of deployment symbols before action scanning. Under high/critical pressure that batch could shrink to 20/8 symbols at concurrency 1, so symbols outside the current slice waited multiple worker ticks before reaching candidate and IBKR option-chain logic.
- Fix: Signal-options scans now full-refresh the deployment universe with soft pressure caps bypassed and concurrency 6, while preserving the existing pressure-capped batch path for hard API pressure.
- Regression tests: Added coverage for explicit signal monitor soft-cap bypass and updated signal-options source assertions to require full-universe refresh plus hard-pressure fallback.
- Verification:
  - `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts`
  - `pnpm --filter @workspace/api-server typecheck`
  - `pnpm --filter @workspace/api-server run build`

Status: DONE_WITH_CONCERNS. Source validation passes; live runtime acceptance still needs a normal Replit Run App restart/reload.
