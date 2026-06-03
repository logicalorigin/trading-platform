# Session Handoff — Signal Bubbles Matrix Hydration

- Created: 2026-06-02
- Last Updated (MT): 2026-06-02 11:36:54 MDT
- Last Updated (UTC): 2026-06-02T17:36:54Z
- Session ID: `signal-bubbles-matrix-diagnosis` (workstream slug; canonical native Codex session ID was not resolved in this handoff file)
- Scope: Restore PYRUS signal bubble / signal matrix hydration so visible bubbles hydrate within 10 seconds of app startup.

## Current Outcome

- Closing snapshot:
  - Durable backend cache fix is committed as `86d9345 fix: hydrate signal matrix from durable cache`.
  - Follow-up UI/mapping work is implemented and validated but not committed yet.
  - Intended follow-up files:
    - `artifacts/pyrus/src/features/signals/signalsRowModel.js`
    - `artifacts/pyrus/src/features/signals/signalsRowModel.test.js`
    - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`
    - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`
    - `artifacts/pyrus/src/screens/SignalsScreen.jsx`
    - `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
  - Related but not part of the committed durable-cache fix: `artifacts/api-server/src/services/signal-monitor.ts` still has an unstaged live-edge completed-bars cache edit.
  - Repo remains heavily dirty with many unrelated modified/untracked files; stage narrowly if committing.
- Follow-up after commit `86d9345`:
  - Algo signal rows now hydrate the profile timeframe from the row's primary signal state before rendering matrix dots/verdicts, matching the Signals table row model.
  - Signals table timeframe columns now show a compact time-since readout under the bars count.
  - All Signals table columns expose sortable header controls, including `1m`, `2m`, `5m`, `15m`, and `1h`.
  - Browser QA, direct-start Signals: boot cleared after a slow profile load; `19/19` headers were sortable and interval age cells were populated.
  - Browser QA, direct-start Algo: rendered signal rows showed a populated `5m` dot from the primary signal fallback, e.g. `5m SELL fresh - 0 bars`.
  - Follow-up edits are not committed yet.
- Latest pass completed after the durable matrix-cache follow-up:
  - Commit: `86d9345 fix: hydrate signal matrix from durable cache`.
  - Backend matrix responses now reuse `signal_monitor_symbol_states` across all requested matrix timeframes, including `2m`.
  - Clean stored matrix rows are returned for automatic startup/poll requests before fresh Massive-backed refresh work.
  - Fresh/background matrix refresh is deferred to the next event-loop turn so it cannot delay the stored response.
  - Full signal-monitor scans no longer deactivate sibling matrix timeframe rows for active symbols.
  - Signals screen foreground priority includes rendered rows first plus the filtered table rows, so visible table bubbles do not starve behind the background gate.
  - Clean stale stored matrix cells render as hydrated bubbles while still remaining stale for signal-direction logic and refresh planning.
- Final browser QA against a fresh temp API process and fresh browser context:
  - URL: `http://127.0.0.1:18751/?pyrusQa=safe`
  - First matrix response at `4272ms` from app start.
  - Matrix response: `cacheStatus=stale`, `stateCount=150`, `sourceRequestCount=0`, backend `durationMs=6`, `requestedSymbols=30`, `hydratedSymbols=30`, `missingSymbols=0`.
  - All `20/20` rendered Signals rows reached `data-matrix-hydrated-count=5` at `4390ms`.
  - No browser console errors were captured.
- Final targeted validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts` passed `55/55`.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/signals/signalsMatrixHydration.test.js src/features/platform/signalMatrixScheduler.test.js` passed `93/93`.
  - `pnpm --filter @workspace/api-server run build` passed.
  - `pnpm --filter @workspace/pyrus run build` passed.
  - `pnpm --filter @workspace/api-server run typecheck` still fails from unrelated dirty-worktree tests: `src/services/ibkr-line-usage.test.ts(819,3)` and `src/services/signal-options-worker.test.ts(584,3)`.

- Commit `7e8a898 fix: hydrate signal matrix rows on startup` landed the first hydration fix, but a post-commit audit reproduced slow cold hydration.
- Browser QA with `http://127.0.0.1:18747/?pyrusQa=safe` had previously passed against the rebuilt API artifact when the exact matrix request cache was warm.
- Success measurement:
  - First matrix POST started at `2869ms`.
  - First matrix response returned at `8633ms`.
  - Request was `13` visible symbols x `5` timeframes (`65` states), `clientRole=leader`, `requestOrigin=startup`.
  - At the 10-second check: `13/13` visible Signals rows were fully hydrated, each `data-matrix-hydrated-count=5`.
- The live Replit API process still needs a Run Replit App restart to load the rebuilt backend `dist/index.mjs`; the browser QA routed matrix requests to a temporary API process running that rebuilt artifact.
- Post-restart live check:
  - Replit API process restarted at 10:15 and is running `artifacts/api-server/dist/index.mjs` with the fixed predicate.
  - Warm live browser probe: Signals rows mounted at `4258ms`; visible matrix request started at `4257ms`; first matrix response returned at `9429ms`; `13/13` visible rows were `5/5` hydrated by the 10-second check.
  - Direct live API miss after catch-up drained: `WMT,COST,PEP,MCD,XOM` x five timeframes returned `25` states, `cacheStatus=miss`, `sourceRequestCount=25`, `durationMs=4345`.
  - One immediate post-restart cold dev-server probe was skewed by Vite/app compilation: rows did not mount until after the 10-second window, so the matrix request could not start inside that first window. The warmed app path meets the hydration criterion.

## Post-Commit Audit Finding

- A later cold-miss browser audit reproduced the user's slow bubble hydration report:
  - First visible matrix request started at `7925ms`.
  - Request was `13` visible symbols x `5` timeframes (`65` states), `clientRole=leader`, `requestOrigin=startup`.
  - Response returned at `19444ms`, with `cacheStatus=miss`, `sourceRequestCount=65`, and backend `durationMs=8193`.
  - At the 10-second and 15-second checks, all rows were still only `1/5`.
  - At 25 seconds, the visible rows were `5/5`, while non-visible rows remained `1/5`.
- The original validation passed because the exact API matrix cache had been warmed by a previous probe. It did not prove the cold-start path.
- Mechanical reason the existing "cache" is insufficient:
  - The durable DB state currently hydrates the primary/profile timeframe only, which explains the reliable `1/5` state.
  - The browser snapshot is local to one browser, expires after 15 minutes, and only includes states completed in that browser.
  - The API matrix cache is in-memory and exact-request keyed by the whole symbol/timeframe/settings tuple, so a different visible row set is a miss.
  - The matrix response is atomic: the frontend does not receive per-cell or per-symbol results until the full batch completes.

## Recommended Next Fix

- `/plan-eng-review` selected the minimal complete architecture: reuse `signalMonitorSymbolStatesTable` as the durable per-symbol/per-timeframe matrix store.
- Rationale:
  - The DB schema already has a unique `(profileId, symbol, timeframe)` key.
  - `upsertSymbolState` already uses Drizzle/Postgres `ON CONFLICT DO UPDATE` for that exact key.
  - The matrix evaluator already produces the fields needed by signal bubbles: status, signal direction/time/price, latest bar, freshness, evaluation time, and error.
  - A new table would be cleaner separation but would add a migration, duplicate row-shape mapping, and more lifecycle code.
- Required implementation tasks:
  - Persist successful matrix evaluation states through the existing state upsert path, excluding timeout/error poison rows.
  - Replace `readCurrentSignalMonitorPrimaryMatrixStates` with a requested-timeframe stored matrix read.
  - Hydrate matrix responses from stored rows before/alongside fresh Massive-backed evaluation, so saved cells can return immediately.
  - Change `evaluateSignalMonitorProfileUniverse` cleanup so full primary scans do not deactivate sibling timeframe rows for active universe symbols.
  - Keep primary `/signal-monitor/state` scoped to the profile timeframe.
  - Add browser QA that proves visible Signals rows hit `data-matrix-hydrated-count=5` within 10 seconds with API in-memory cache cold.
- Review artifacts:
  - Test plan: `/home/runner/.gstack/projects/unknown/runner-main-eng-review-test-plan-20260602-103235.md`
  - Task JSONL: `/home/runner/.gstack/projects/unknown/tasks-eng-review-20260602-103235.jsonl`

## Root Cause

- Backend automatic matrix requests were serving foreground leader startup/poll reads from cache-only under non-critical pressure, returning empty state sets before Massive-backed computation could hydrate bubbles.
- Frontend startup matrix work waited for the profile query and then let a broad pre-screen matrix batch occupy the single matrix lane.
- `DenseVirtualTable` reported virtualizer overscan rows as visible rows, so the first Signals request was too broad.
- The Signals screen sent only the missing-timeframe union for the priority batch, allowing rows to land partially hydrated.

## Implemented Fix

- `artifacts/api-server/src/services/signal-monitor.ts`
  - Followers remain cache-only for automatic startup/poll.
  - Foreground leaders compute normally under normal/watch/high pressure.
  - Leader cache-only fallback is only allowed under critical API pressure.
  - Removed the leader background-refresh helper/path that returned empty cache responses first.
- `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
  - Foreground Signals/Algo matrix work can start while the profile query is still pending.
  - Signals route waits for the screen’s row hydration handoff before launching matrix work, avoiding the broad fallback first request.
  - Active foreground requests use the active task budget and leader role.
- `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`
  - Active screen budget is `normal=150`, `watch=150`, `high=60`, `critical=10`.
  - Soft pressure no longer shrinks active Signals/Algo hydration; critical pressure still constrains it.
- `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - Does not submit hydration until the table reports visible rows.
  - Sends the full table timeframe set for visible-priority rows so rows do not return `4/5`.
- `artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx`
  - `onVisibleRowsChange` now filters out overscan and includes a one-row viewport edge buffer.

## Validation

- Follow-up validation after Algo mapping / Signals table sort-age work:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/signals/signalsRowModel.test.js` passed `18/18`.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/OperationsSignalRow.test.js` passed `19/19`.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern "signals screen is registered as a first-class platform route" src/features/platform/platformRootSource.test.js` passed.
  - `pnpm --filter @workspace/pyrus run build` passed.
  - Browser QA direct-start Signals: after slow profile boot, `19/19` headers were sortable and interval age cells were populated.
  - Browser QA direct-start Algo: signal rows rendered and the first row had a populated `5m` dot from the primary signal fallback.
  - `git diff --check` passed for the follow-up files and this handoff.
- Backend signal monitor tests:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts`
  - Result: `48/48` passed.
- API build:
  - `pnpm --filter @workspace/api-server run build`
  - Verified `artifacts/api-server/dist/index.mjs` has the fixed predicate and no removed helper.
- Frontend focused tests:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/signals/signalsMatrixHydration.test.js src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js src/components/platform/tableColumnInteractions.test.js`
  - Result: `97/97` passed.
- Pyrus typecheck:
  - `pnpm --filter @workspace/pyrus run typecheck`
  - Passed.
- API typecheck:
  - `pnpm --filter @workspace/api-server run typecheck`
  - Still fails in unrelated dirty IBKR/option-chain tests:
    - `src/services/ibkr-account-bridge.test.ts`
    - `src/services/ibkr-line-usage.test.ts`
    - `src/services/option-chain-batch.test.ts`

## Notes

- No arbitrary client timeout increase was used for the final fix.
- Remaining broad catch-up continues after visible rows hydrate; final browser probe showed the second request started at `9309ms` for the next 30 symbols.
- The `90 symbols -> 75 signals` Algo text is a pipeline funnel (`scan_universe` to detected/actionable candidates), not a matrix-state count. Live browser QA confirmed rendered Algo rows map matrix dots by symbol and can hydrate the profile timeframe from the primary row signal.

## Next Recommended Steps

1. Review the six follow-up Pyrus files listed in the closing snapshot and commit them separately from unrelated dirty worktree changes. Suggested commit message: `fix: align algo signal matrix mapping`.
2. Keep the unstaged `artifacts/api-server/src/services/signal-monitor.ts` live-edge cache edit separate unless it is intentionally part of the next backend pass.
3. If committing the follow-up, stage only the six intended files, rerun the three focused Pyrus tests plus `pnpm --filter @workspace/pyrus run build`, then commit.
4. For live QA, start directly on Signals/Algo if needed by setting `pyrus:state:v1` screen in local storage; the app can sit on the boot overlay while the signal profile request warms.
