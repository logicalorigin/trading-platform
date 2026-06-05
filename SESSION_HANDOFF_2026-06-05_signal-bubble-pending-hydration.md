# Signal Bubble Pending Hydration Handoff

- Last Updated (MT): `2026-06-04 22:18:09 MDT`
- Last Updated (UTC): `2026-06-05T04:18:09Z`
- Native Codex Session ID: `signal-bubble-pending-hydration`
- Status: restart audit passed; focused code fix committed as `ef89d4b`.

## Summary

Root cause: signal bubbles were empty because the app painted shared `signalMatrixStates` from partial stored matrix coverage while exact-cell catch-up was still in flight. A broad stored bootstrap returned only persisted clean cells, and exact 48-cell catch-up could take ~41s, leaving null cells across Signals, watchlist, header, and Algo surfaces.

Fix:
- Added client-side pending matrix placeholders for exact requested cells in `PlatformApp.jsx`.
- Added `buildSignalMatrixPendingStates` and merge replacement rules in `signalMatrixScheduler.js`.
- Treated `pending` as non-current in `signalStateFreshness.js` so placeholders do not affect signal direction/bias.
- Updated compact signal dots/header pellets/Signals interval cells to render pending cells as pending instead of empty/no signal.
- Disabled broad stored-state bootstrap while foreground signal routes/surfaces are active, so Signals/Algo visible hydration goes straight to exact-cell requests.
- Kept the prior local STA visible page cap alignment at `48/36/24/12` cells by pressure.

## Validation

- PASS: `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/signalMatrixScheduler.validation.js`
- PASS: `pnpm -C artifacts/pyrus exec tsx validation runner src/features/signals/signalsRowModel.validation.js`
- PASS: `pnpm -C artifacts/pyrus run typecheck`
- PASS: `pnpm -C artifacts/pyrus exec tsx validation runner src/features/platform/platformRootSource.validation.js`
- PASS: `pnpm -C artifacts/pyrus exec tsx validation runner src/screens/SignalsScreen.validation.js`
- PASS: `pnpm -C artifacts/pyrus exec tsx validation runner src/components/platform/primitives.validation.js`
- PASS: safe-QA browser smoke on `http://127.0.0.1:18747/?pyrusQa=safe` with Signals route showed exact foreground plan (`storedStateBootstrap: false`), `24` pending states, `295` pending dots, `22` queued interval cells, and no console/page errors.
- PASS: scoped `git diff --check` for touched signal-bubble files.

## Notes

- Direct paper matrix exact-cell probe for 8 symbols x 6 timeframes returned `48` states with `hydratedSymbols: 8`, but took about `40.9s`.
- Restart audit root cause: foreground pages could repeatedly take broad stored-state bootstrap as the Signals universe changed, which bypassed exact `requestCells` and therefore bypassed pending placeholders.
- The wider worktree remains dirty with unrelated Replit, API, semantic-tone, account, and generated-client changes; do not treat this handoff as covering those files.
