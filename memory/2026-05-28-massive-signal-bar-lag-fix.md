# Massive Signal Bar Lag Fix

Date: 2026-05-28

## Debug Report

- Symptom: Algo signal rows showed signals late, with signal monitor 5m bars commonly 10-15 minutes behind while direct Massive bars could be current.
- Root cause: The platform bars hydrator used a generic recent-coverage tolerance of at least 20 minutes before fetching provider gap-fill. Signal-monitor requests use the same hydrator, so realtime Massive stored history that was 10-15 minutes behind could be accepted as fresh enough and fed into Pyrus signal evaluation.
- Fix: Realtime Massive `signal-matrix` bar requests now use a tight native-timeframe tolerance. For 5m signals, stored coverage more than one 5m bar behind forces a Massive provider gap-fill instead of waiting for the generic 20-minute window.
- Verification:
  - `pnpm --dir artifacts/api-server exec node JS validation runner --validation-name-pattern "signal-matrix Massive bars force gap-fill|recent live-edge gaps" src/services/option-chain-batch.validation.ts`
  - `pnpm --dir artifacts/api-server exec node JS validation runner src/services/signal-monitor.validation.ts src/services/option-chain-batch.validation.ts`
  - `pnpm --filter @workspace/api-server typecheck`
  - `pnpm --filter @workspace/api-server run build`

Status: DONE_WITH_CONCERNS. Source validation passes; live acceptance still requires the running API to restart onto the rebuilt bundle.
