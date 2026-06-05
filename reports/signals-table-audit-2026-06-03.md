# Signals Table Audit - 2026-06-03

## Scope

- Audited `main` at `307f95d` plus the current dirty Signals/platform worktree.
- Covered Signals table columns, sort/reorder wiring, interval cell data rendering, row-model data-quality behavior, matrix hydration, scheduler request planning, and related source guards.
- Live browser QA was intentionally deferred per plan; this pass is code/test audit only.

## Executive Summary

- Data-quality and scheduler behavior validated cleanly in targeted tests: six table intervals, primary-profile fallback hydration, skipped-symbol handling, exact request-cell planning, and `1d` propagation are all covered by green focused suites.
- Found one concrete UI/accessibility bug in the Signals table: the blank action column is configured as a duplicate sortable Symbol column, which creates an empty sort title.
- Found one test-quality issue: the current source-regex tests explicitly require the action-column sort mapping and do not render or interact with the table, so they would keep the bug in place.

## Findings

### P1 - Blank action column is sortable with an empty sort title

Evidence:

- `artifacts/pyrus/src/screens/SignalsScreen.jsx:141` maps `action` to the `symbol` sort key.
- `artifacts/pyrus/src/screens/SignalsScreen.jsx:2646` defines the action column with `header: ""`.
- `artifacts/pyrus/src/screens/SignalsScreen.jsx:2671` to `2681` derives `label` from the header and builds `sortTitle: columnSortKey ? \`Sort by ${label}\` : undefined`.
- `artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx:219` to `238` marks the column sortable and passes that empty title into `ColumnHeaderCell`; `InteractiveColumnHeader.jsx:196` to `199` then exposes it as the button aria-label/title.

Impact:

- The rightmost icon-only action column behaves like a hidden duplicate Symbol sort.
- Its sort affordance has bad assistive text (`Sort by ; ...`) and a low-information tooltip.
- This is confusing because the Symbol column already owns symbol sorting and the action column's visible purpose is navigation to Trade.

Fix plan:

- Remove `action: "symbol"` from `SIGNALS_SORT_KEYS_BY_COLUMN_ID`.
- Keep `symbol: "symbol"` as the canonical Symbol sort.
- Optionally set action column meta label to a descriptive non-sort label such as `Open trade`, but leave `sortable: false`.
- Update `SignalsScreen.table-cells.validation.js` and `platformRootSource.validation.js` so the action column is explicitly non-sortable instead of expected to have a sort key.

Suggested validation:

- Add/adjust a source guard that asserts `SIGNALS_SORT_KEYS_BY_COLUMN_ID` does not include `action`.
- Prefer a small render-level test for `DenseVirtualTable`/Signals column metadata that asserts the action header has no sort button and the Symbol header still sorts by `symbol`.

### P2 - Source-regex tests protect structure, not behavior

Evidence:

- `artifacts/pyrus/src/screens/SignalsScreen.table-cells.validation.js:5` to `29` reads `SignalsScreen.jsx` as text and checks regexes rather than rendering headers/cells.
- `artifacts/pyrus/src/screens/SignalsScreen.table-cells.validation.js:11` to `25` currently requires the buggy `action -> symbol` sort mapping.
- `artifacts/pyrus/src/features/platform/platformRootSource.validation.js:2234` to `2239` checks that every listed Signals table column has a sort-key regex match, also locking in the action-column behavior.

Impact:

- Regressions in header aria text, blank sort labels, click behavior, and sort-state toggling can pass as long as the source still contains matching strings.
- The test suite is green while the action-column UX bug is present.

Fix plan:

- Keep the cheap source guards for broad contract coverage, but make them assert product intent: action column locked and non-sortable; data columns sortable.
- Add one behavior test around table header metadata/callbacks. The minimum useful case is:
  - action header renders without a sort button;
  - Symbol header calls `onSortChange("symbol", "symbol")`;
  - a timeframe header calls `onSortChange("tf-5m", "tf-5m")`;
  - drag reorder callback receives `(nextOrder, { activeColumnId, overColumnId })`.

## Validated Clean

- `artifacts/pyrus/src/features/signals/signalsRowModel.js:11` to `17` now defines six table timeframes including `1d`.
- `artifacts/pyrus/src/features/signals/signalsRowModel.js:369` to `386` hydrates the profile timeframe from the primary state when matrix storage is missing or stale.
- `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js:11` to `28` caps exact request cells under pressure.
- `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js:420` to `457` now selects exact missing `(symbol, timeframe)` cells instead of expanding every selected symbol to all timeframes.
- `artifacts/pyrus/src/features/platform/PlatformApp.jsx:3912` to `3918` sends `cells: plan.requestCells` with the matrix request.

Validation run:

- PASS: `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/SignalsScreen.table-cells.validation.js src/features/signals/signalsRowModel.validation.js src/features/signals/signalsMatrixHydration.validation.js src/features/signals/signalMatrixSnapshotCache.validation.js` - 32/32 passed.
- PASS: `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/platformRootSource.validation.js` - 90/90 passed.
- PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- PASS: `PYRUS_ALLOW_HOT_VALIDATION=1 pnpm exec tsc -b lib/db/tsconfig.json lib/api-client-react/tsconfig.json`.

## Recommended Next Slice

1. Fix the action-column sort metadata and update the two source guards.
2. Add the small behavior-level header test so blank titles and duplicate action sorting cannot recur.
3. Run the same focused validation plus live PYRUS QA with `?pyrusQa=safe` when ready to verify the real header affordances.

## Continuation - 2026-06-03 07:09 MT

### Action column fix

- Fixed the P1 action-column defect in `artifacts/pyrus/src/screens/SignalsScreen.jsx` by removing `action: "symbol"` from `SIGNALS_SORT_KEYS_BY_COLUMN_ID`.
- The action column remains locked via `SIGNALS_LOCKED_COLUMN_IDS = ["symbol", "action"]`, but now derives `sortable: false`, `sortKey: undefined`, and no empty `sortTitle`.
- Updated `artifacts/pyrus/src/screens/SignalsScreen.table-cells.validation.js` and the focused Signals route guard in `artifacts/pyrus/src/features/platform/platformRootSource.validation.js` to assert that `action` is not mapped to Symbol sorting.

### Matrix data path audit

- Frontend request planning:
  - `SignalsScreen.jsx` builds visible-row priority and passes exact missing `requestCells` from `buildSignalsMatrixHydrationPlan`.
  - `PlatformApp.jsx` merges those cells into the platform matrix scheduler.
  - `signalMatrixScheduler.js` rotates exact missing cells by pressure cap and sends only the missing `(symbol, timeframe)` cells to `/api/signal-monitor/matrix`.
- Frontend cache:
  - `signalMatrixSnapshotCache.js` stores a sanitized localStorage warm-start snapshot under `pyrus:signal-matrix-snapshot:v1` for six timeframes: `1m`, `2m`, `5m`, `15m`, `1h`, `1d`.
  - The snapshot is capped to 750 states and expires after 15 minutes.
- Backend request/cache:
  - `signal-monitor.ts` canonicalizes exact cells, enforces pressure caps, and keys the in-memory matrix response cache by sorted exact-cell list plus profile/settings/pressure/concurrency.
  - Automatic foreground leader exact-cell requests are no longer forced cache-only under high pressure.
  - Automatic requests still fast-return stored rows first, then schedule a background refresh. That is intentional, but it means first responses can be partial until the next catch-up/poll.
- Backend durable save:
  - Clean `ok` and `stale` matrix cells are persisted through `signal_monitor_symbol_states` with neutralized stale direction/freshness.
  - Settled `unavailable` cells are treated as evaluated coverage and can be held in the short-lived matrix response cache, but they are not written durably. This avoids saving permanent no-data/error rows; old unavailable cells are retried by the scheduler.
  - Timeout/error rows remain retryable and are not pinned in cache.

### Runtime probe

- Direct exact-cell live probe against the running app:
  - First request: `CEG 1h` + `APH 5m` returned stored rows with `cacheStatus: "stale"`, `refreshing: true`, `sourceRequestCount: 0`, and `hydratedSymbols: 2`.
  - Follow-up after 3 seconds returned `cacheStatus: "hit"`, `refreshing: false`, `sourceRequestCount: 2`, and refreshed `ok` rows for both cells.
- Safe browser hydration probe against `/?pyrusQa=safe` with initial screen `signals`:
  - First bounded 180s run: 21 visible rows, distribution `{"3":1,"4":2,"5":2,"6":16}`, header `Intervals 200/540`, no console errors.
  - Warm follow-up sample after the ongoing matrix work had filled cache: no visible rows below `data-matrix-hydrated-count=6`.
- `/api/diagnostics/latest` reported API `degraded`/warning with high API pressure driven by account/shadow routes, but the exact-cell matrix sample still refreshed and cached successfully.
- `/api/health` is not a valid route on this dev server; `/api/session` and `/api/diagnostics/latest` were reachable.

### Validation

- PASS: `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/SignalsScreen.table-cells.validation.js src/features/signals/signalsRowModel.validation.js src/features/signals/signalsMatrixHydration.validation.js src/features/signals/signalMatrixSnapshotCache.validation.js` - 34/34.
- PASS: `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js --validation-name-pattern "exact|unavailable|stale|missing|cell|pressure"` - 29/29.
- PASS: `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-monitor.validation.ts --validation-name-pattern "matrix|cache|stored hydration|unavailable|exact cells|pressure"` - 63/63.
- PASS: `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "signals screen is registered as a first-class platform route" src/features/platform/platformRootSource.validation.js` - 1/1.
- PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- PASS: `pnpm --filter @workspace/api-server run typecheck`.
- PASS: scoped `git diff --check` for the touched Signals/matrix files.

### Remaining gap

- Cold safe browser convergence is improved but still not proven within 180s for all visible rows. Warm convergence did reach all visible rows at `6/6` after the matrix background/catch-up path had time to populate cache.
