# Trading Position Management Audit - 2026-05-27 through 2026-05-29

## Request

Audit trading from Wednesday through today because positions appeared not to be properly managed. With current date `2026-05-29`, the audited window is `2026-05-27` through `2026-05-29`.

## Data Reviewed

- Shadow options ledger tables: `shadow_orders`, `shadow_fills`, `shadow_positions`, `shadow_position_marks`.
- Automation events: `execution_events` where `provider_account_id = 'shadow'` and `event_type like 'signal_options_%'`.
- Generated review report:
  - `scripts/scripts/reports/shadow-options-management-review/2026-05-27-through-2026-05-29-audit/report.md`
  - `scripts/scripts/reports/shadow-options-management-review/2026-05-27-through-2026-05-29-audit/results.json`
  - `scripts/scripts/reports/shadow-options-management-review/2026-05-27-through-2026-05-29-audit/top-leaks.csv`

## Findings

- Window totals: `49` fills, `26` buys, `23` sells, `22` symbols, realized P&L `-4751.24`, fees `203.87`.
- By day:
  - `2026-05-27`: `34` fills, realized P&L `-2896.00`.
  - `2026-05-28`: `9` fills, realized P&L `-165.78`.
  - `2026-05-29`: `6` fills through `14:31:37Z`, realized P&L `-1689.46`.
- Exit reasons for filled sells:
  - `runner_trail_stop`: `7` exits, `+548.42`.
  - `overnight_risk_exit`: `6` exits, `-481.90`.
  - `opposite_signal`: `2` ledger exits, `-598.04`.
  - `hard_stop`: `3` exits, `-2029.79`.
  - `early_invalidation`: `5` exits, `-2189.93`.
- The manager emitted `25` `signal_options_shadow_exit` events, but only `23` became shadow ledger sell orders.
- The two unmirrored exits were both after the option session:
  - `AMZN` opposite-signal exit at `2026-05-28T22:23:58.240Z`, intended exit `7.37`, entry `4.29`, quantity `4`; not mirrored to a sell order.
  - `META` opposite-signal exit at `2026-05-28T22:51:13.085Z`, intended exit `10.03`, entry `10.03`, quantity `1`; not mirrored to a sell order.
- The ledger also contained out-of-session entries:
  - `CRWV` buy at `2026-05-27T20:00:27.164Z` / `16:00:27 ET`, after the regular options close for that underlying.
  - `META` buy at `2026-05-28T20:04:15.178Z` / `16:04:15 ET`, after the regular options close.
- Current open shadow positions at audit time:
  - `META` open from `2026-05-28T20:04:15.178Z`, entry `10.03`, mark around `3.35`, hard-stop threshold `7.02`, unrealized about `-668.00`. This is below the configured `-30%` hard stop.
  - `TQQQ` open from `2026-05-29T13:44:03.346Z`, entry `3.59`, mark around `3.25`, above hard stop.
  - `SPY` open from `2026-05-29T14:11:34.314Z`, entry `4.00`, mark around `3.13`, above hard stop.
- Second pass after app restart:
  - `META` remained visible after the first code fix because the fix prevented future bad after-hours entries/exits but did not rewrite historical shadow ledger rows.
  - The live manager later closed that persisted `META` ledger position through a hard-stop sell at `2026-05-29T15:00:44.754Z` (`order_id c00dacce-fd46-4b44-9914-75e25141de90`, limit `3.62`, original stop `7.02`).
  - The open shadow positions checks after the patch no longer showed `META`.
- Third pass on `SL` / `TRL` / `TP` semantics:
  - The prior second-pass fix incorrectly treated runner trail activation as a take-profit target.
  - Current contract is:
    - `SL`: protective stop.
    - `TRL`: actual active trailing-stop state / level.
    - `TP`: explicit take-profit target or working limit target order only.
    - Trail activation stays in automation metadata and must not populate `TP`.
  - Current service check before the trail-stop close showed:
    - `GLD`: `quantity 4`, latest checked mark `7.65`, `stopLoss 2.81`, `takeProfit null`, `trailActivationPrice 5.43`.
    - `SQQQ`: `quantity 10`, latest checked mark `1.53`, `stopLoss 1.04`, `takeProfit null`, `trailActivationPrice 2.00`.
  - After display trail computation was fixed, existing shadow mark enforcement closed `GLD` through automation at `2026-05-29T15:30:08.735Z` with `reason runner_trail_stop`, exit `6.94`, computed trail stop `7.29`, hard stop `2.81`, and mark `7.275`.
- There were `76` `position_mark_unavailable` skips and `5` `position_exit_quote_unavailable` skips in the same window, mostly from stale provider snapshots. That worsened reliability, but the confirmed state bug is the unmirrored after-hours exit path.
- A deeper pass found `6` `position_exit_quote_unavailable` skips where stop logic had already crossed an exit threshold using a fresh in-session `shadow_position_mark` sourced from `option_quote`, but the exit was refused because the provider snapshot was stale:
  - `VRT`: first skipped at `4.56`, finally exited `13.92` minutes later at `4.04`.
  - `LUNR`: skipped at `2.16`, finally exited `26.31` minutes later at `2.05`.
  - `RBLX`: skipped at `0.69`, finally exited `5.83` minutes later at `0.43`.
  - `TQQQ`: skipped at `2.73` and was still open when checked in that moment.

## Root Cause

The live entry and opposite-signal paths did not share the same option-session guard as the shadow ledger mirror. Entries could be recorded after the option market closed, and exits could be emitted after close. The ledger mirror rejected after-hours exits but accepted after-hours entries before this fix, so automation state and real shadow positions diverged.

The live mark path also treated a stale provider snapshot as authoritative for exit eligibility even when the shadow position had a fresh in-session option quote mark. That delayed exits after stops were already crossed.

The position table issue was a separate data-contract gap. The backend returned automation state with `stopPrice`, but did not expose normalized top-level stop information for shadow positions. A later second-pass fix overcorrected by deriving `takeProfit` from runner trail activation policy. That was wrong: runner activation is not take profit. The Trade positions panel also explicitly mapped backend `sl` and `tp` to `null`, so even a correct backend stop/target would not consistently reach the table.

The Algo page had an additional table-source bug: it fetched the same shadow account positions as the Account page, but then merged/fell back to cockpit/runtime active-position rows for table membership. If the account ledger was empty, narrower, or already repaired, stale runtime rows could still appear on Algo. Account rows must be authoritative for the Algo positions table whenever the account positions query exists.

The latest product decision is simpler than the earlier `TP` repair: position tables should not render mark/take-profit columns at all. `SL` and `TRL` are the only stop-management columns required in the table. Risk distance is still derived from the active protective stop, but it does not live in a standalone `DIST` column; it replaces the old `Auto` / source subtext under the relevant stop cell. Hard-stop distance renders under `SL` when no trail is active, and active trailing-stop distance renders under `TRL`.

The `TRL` issue was a stale display-state gap. Shadow option marks kept updating after the last `signal_options_shadow_mark` event, but `automationContext` only read the latest automation event. A position like `GLD` could have live marks above trail activation while still displaying stale `trailActive: false`. The corrected context now also looks at current shadow position marks and derives active trail state for display from the same exit policy.

`META` is the clearest evidence: the system emitted an opposite-signal exit after close at the entry price, did not mirror it to the ledger, and the position remained open into `2026-05-29` below its hard stop.

## Fix Applied

- `artifacts/api-server/src/services/signal-options-automation.ts`
  - Added option-session checks for live entry and exit events before event-state reconstruction treats them as actionable trades.
  - Blocked live shadow entries after option close with `after_hours_option_entry_blocked`.
  - Blocked opposite-signal close attempts after option close with `after_hours_option_exit_blocked`.
  - Made that skip retryable and prevented the scan from deleting the active position or opening the opposite side when the close could not trade.
  - Excluded non-actionable after-hours exit events from realized-P&L counting and seen-signal keys.
  - Reconciled out-of-session phantom entry events against the shadow ledger: ledger-backed legacy positions remain visible to the manager, but unmirrored out-of-session entry events are dropped.
  - Allowed shadow-paper exits from fresh in-session `shadow_position_mark` fallbacks only when the fallback source is `option_quote`, while still rejecting generic/stale/automation fallback marks.
- `artifacts/api-server/src/services/shadow-account.ts`
  - Added a defensive live-session guard so future live shadow entry events cannot mirror into ledger orders outside the option session.
  - Normalized shadow position management fields by exposing top-level `stopLoss` and `takeProfit` values.
  - Kept runner activation separate from take profit: `trailActivationPrice` remains in automation metadata, while `targetPrice` / `takeProfitPrice` are only populated from explicit profit-target fields.
  - Derived display trailing-stop state from current shadow position peak marks, so `TRL` can reflect active trail state even when no new automation mark event was written.
  - Added `stopLossPrice`, `targetPrice`, `takeProfitPrice`, `trailActivationPrice`, and `tradeManagement.trailActivationPrice` to `automationContext`.
- `artifacts/pyrus/src/features/account/positionTradeManagement.js`
  - Taught the account table management model to read automation stop fields and explicit automation target fields.
  - Split hard `SL` from active `TRL`; risk distance now uses the active protective stop while `SL` remains the hard stop column.
  - Added a guard so legacy/cached automation payloads with `targetKind: "trail_activation"` cannot populate `TP`.
- `artifacts/pyrus/src/features/trade/TradePositionsPanel.jsx`
  - Stopped discarding backend stop values for live position rows and mapped top-level and `automationContext` stop fields into `sl`.
  - Removed the open-position table `TP` column and stopped creating local mark-derived `tp` display values.
  - Removed the open-position `DIST` column and renders stop distance as a small top-right badge inside the relevant `SL` / `TRL` cell.
- `artifacts/pyrus/src/features/account/positionTableColumns.js`, `artifacts/pyrus/src/screens/account/PositionsPanel.jsx`
  - Removed the shared Account/Algo position-table `TP` column and target detail rows.
  - Removed the standalone `DIST` column from shared Account/Algo position-table defaults.
  - Replaced the old `Auto` / source subtext under `SL` / `TRL` with active-stop distance. Hard-stop distance renders under `SL`; active trailing-stop distance renders under `TRL`.
- `artifacts/pyrus/src/screens/algo/OperationsPositionsTable.jsx`
  - Made the account positions query the source of truth for Algo table membership whenever that query exists.
  - Runtime/cockpit rows are now only a no-account-query fallback, not a source that can keep stale symbols alive.
- `artifacts/pyrus/src/screens/algo/algoAccountPositions.js`
  - Changed the runtime/account merge helper so account ledger rows define membership when both sources are present.
- `lib/api-spec/openapi.yaml`, generated API clients, and `lib/api-spec/run-codegen.mjs`
  - Added `stopLoss` and `takeProfit` to the account-position API contract and regenerated typed clients/schemas.
  - Clarified that `takeProfit` is an explicit take-profit price, not runner activation.
  - Normalized generated client EOF whitespace so codegen output passes `git diff --check`.
- `artifacts/api-server/src/services/signal-options-automation.test.ts`
  - Added regression coverage for after-hours entry/exit events, opposite-signal close blocking, stale fallback rejection, and fresh `option_quote` shadow fallback exits.
- `artifacts/api-server/src/services/shadow-account.test.ts`
  - Added regression coverage for entry mirroring respecting option sessions.
  - Added regression coverage that runner trail activation does not populate take-profit fields.
- `artifacts/pyrus/src/features/account/positionTradeManagement.test.js`
  - Added regression coverage that runner trail activation does not populate `TP`, while explicit automation take-profit still does.
- `artifacts/pyrus/src/features/trade/TradePositionsPanel.test.js`
  - Added regression coverage for live open-position rows preserving automation stop values and removing the table `TP` / `DIST` columns.
- `artifacts/pyrus/src/screens/account/PositionsPanel.test.js`
  - Added regression coverage that shared Account/Algo position-table defaults no longer include `target` / `TP` or standalone `riskDistance` / `DIST`.
- `artifacts/pyrus/src/screens/algo/algoHelpers.test.js`
  - Added regression coverage that Algo account-position merging keeps shadow ledger membership authoritative.

## Validation

- Passed: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/shadow-account.test.ts src/services/signal-options-automation.test.ts` (`195/195`).
- Passed: `pnpm --filter @workspace/pyrus exec node --test src/features/account/positionTradeManagement.test.js src/features/trade/TradePositionsPanel.test.js` (`10/10`).
- Passed: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/algoHelpers.test.js src/screens/account/PositionsPanel.test.js src/features/trade/TradePositionsPanel.test.js src/features/account/positionTradeManagement.test.js` (`65/65`).
- Passed again after moving distance into `SL` / `TRL`: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/PositionsPanel.test.js src/features/trade/TradePositionsPanel.test.js src/screens/algo/algoHelpers.test.js src/features/account/positionTradeManagement.test.js` (`65/65`).
- Passed: `pnpm --filter @workspace/api-server run typecheck`.
- Passed: `pnpm --filter @workspace/pyrus run typecheck`.
- Passed: `pnpm run audit:api-codegen`.
- Passed: `git diff --check`.
- Verified service output after the patch: `GLD` no longer mapped trail activation into `takeProfit`; existing mark enforcement then closed `GLD` via runner trail stop at `2026-05-29T15:30:08.735Z`. Current open automation rows also return `takeProfit: null` when they only have trail activation metadata.
- Verified service output at `2026-05-29T15:40:22Z`: shadow account, signal-options state, and cockpit all listed `RBLX`, `HOOD`, and `SQQQ` with no open `META` or `GLD`; account rows had `stopLoss` populated and `takeProfit: null`.

## Follow-up

- Manually review current open shadow positions when needed, but `META` was no longer open in the second-pass database check; it had been closed by the live manager's hard-stop pass at `2026-05-29T15:00:44.754Z`.
- Restart through Replit's default Run App entry before expecting the running app to use these code fixes. The Algo position table should then match the Account position table, and position tables should show `SL` / `TRL` without a `TP` column.
- Continue monitoring `position_mark_unavailable`; this pass fixed stop execution when a fresh `option_quote` shadow fallback exists, but stale provider snapshots are still a data-quality signal.

## Visual Density Pass - 2026-05-29T16:16Z

- Tightened Account/Algo position-table sizing with responsive column widths, explicit minimum widths, tighter right-aligned numeric padding, 34px body rows, and 24px headers.
- Wired column `minWidth` through the fixed-layout `<colgroup>` so compact widths are honored consistently instead of only on individual cells.
- Reduced sticky summary/footer padding to match the dense body cells.
- Compact risk distance now displays as a signed percentage under the active `SL` or `TRL` cell, while full `away` / `past` wording remains in the tooltip.
- Tightened Trade open-position table padding/widths and changed its stop-distance corner badge to a compact signed percentage with amber/red tones for near/breached stops.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/PositionsPanel.test.js src/features/trade/TradePositionsPanel.test.js src/screens/algo/algoHelpers.test.js src/features/account/positionTradeManagement.test.js` (`67/67`).
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/pyrus run build`.
  - `git diff --check -- artifacts/pyrus/src/features/account/positionTableColumns.js artifacts/pyrus/src/screens/account/PositionsPanel.jsx artifacts/pyrus/src/features/trade/TradePositionsPanel.jsx artifacts/pyrus/src/screens/account/PositionsPanel.test.js artifacts/pyrus/src/features/trade/TradePositionsPanel.test.js`.
- Browser check against the already-running Replit app reached the shell, but Account, Algo, and Trade positions surfaces did not hydrate a positions table in this session; Account stayed at deferred `Loading positions`, Algo stayed at `Loading signal operations`, and Trade had no `trade-open-positions-table-scroll` instance.

## Visual Alignment Follow-up - 2026-05-29T16:23Z

- Corrected the remaining optical padding issue where right-aligned numeric columns left a visibly larger empty area on the left side of compact cells.
- Account/Algo compact position tables now render `right`/numeric columns with centered visual alignment while preserving the column metadata, and cell/header padding is symmetric left/right.
- Trade open-position table now uses the same centered visual alignment for numeric columns and symmetric left/right padding.
- Added regression assertions so asymmetric compact padding strings do not come back.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/PositionsPanel.test.js src/features/trade/TradePositionsPanel.test.js src/screens/algo/algoHelpers.test.js src/features/account/positionTradeManagement.test.js` (`67/67`).
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/pyrus run build`.
  - targeted `git diff --check`.

## Price / Bid-Ask Cleanup - 2026-05-29T16:27Z

- Root cause: the Account/Algo `Price` column intentionally displayed mark/current as the primary value and `Last` as secondary text. For option rows those are different concepts: mark/current can be midpoint/mark, while last is the last traded print and can be stale or legitimately different.
- Changed the compact position table `Price` column to show only one value: the current display mark/price.
- Removed visible secondary text under `Bid / Ask`; spread/freshness detail is still available in the cell title for debugging, but no longer consumes table space.
- Live bid/ask streaming path remains unchanged: visible option rows still mount `PositionOptionQuoteStreams`, and `useLiveOptionPositionRows` still overlays `getStoredOptionQuoteSnapshot(...)` data before rendering.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/PositionsPanel.test.js src/features/trade/TradePositionsPanel.test.js src/screens/algo/algoHelpers.test.js src/features/account/positionTradeManagement.test.js` (`67/67`).
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/pyrus run build`.
  - targeted `git diff --check`.

## Greeks / Signal Compact Design - 2026-05-29T16:34Z

- Reworked compact Account/Algo `Greeks` and `Signal` columns to be more information-dense instead of stacked text blocks.
- `Greeks` now uses the `Δ/θ` header and a one-line compact `Δ{value} θ{value}` cell. IV/OI/volume detail remains in the hover title.
- `Signal` now uses the `Sig` header and a compact lightning-icon badge with signal score and timeframe. Full signal/risk detail remains in the hover title.
- Tightened dense Account/Algo cell/header padding again from `2px 3px` to `1px 2px` (`actions` uses `1px 1px`).
- Narrowed the shared Account/Algo `Greeks` column to `clamp(50px, 5vw, 64px)` and `Signal` to `clamp(66px, 7vw, 92px)`.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/PositionsPanel.test.js src/features/trade/TradePositionsPanel.test.js src/screens/algo/algoHelpers.test.js src/features/account/positionTradeManagement.test.js` (`67/67`).
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/pyrus run build`.
  - targeted `git diff --check`.
