# Live Session Handoff — Shadow Watchlist Backtest

- Session ID: pending
- Repo Root: `/home/runner/workspace`
- Current CWD: `/home/runner/workspace`
- Workstream: Shadow Account watchlist backtest + intraday equity curve tracking
- User constraints: Do not edit `artifacts/rayalgo/src/RayAlgoPlatform.jsx`; use post-modularization account/platform files only.

## Current Request

Implement the approved plan:

- Write a one-off Shadow Account watchlist backtest into the Shadow ledger.
- Use all saved watchlists, spot-equity RayReplica signals, and equal-risk sizing.
- Preserve the existing active Shadow position.
- Fix the Shadow Account equity curve so today's existing open position updates intraday.

## Active Files

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/shadow-account.test.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/rayalgo/src/screens/AccountScreen.jsx`
- `artifacts/rayalgo/src/screens/account/PositionsPanel.jsx`
- `artifacts/rayalgo/src/screens/account/TradesOrdersPanel.jsx`
- `artifacts/rayalgo/src/screens/account/CashFundingPanel.jsx`

## Status

- Backend Shadow watchlist backtest runner implemented.
- Shadow equity history now refreshes marks before building the terminal equity point.
- Post-modularization Shadow Account UI panel and source filters implemented.
- `artifacts/rayalgo/src/RayAlgoPlatform.jsx` was not edited for this implementation. The worktree already contains a pre-existing diff for that file.
- Validation run:
  - `pnpm --filter @workspace/api-server typecheck`
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/shadow-account.test.ts`
  - `pnpm --filter @workspace/rayalgo typecheck`
  - `pnpm --filter @workspace/rayalgo exec node --import tsx --test src/screens/account/accountPositionRows.test.js src/screens/account/accountReturnsModel.test.js src/screens/account/equityCurveData.test.js`
  - `PORT=18747 BASE_PATH=/ pnpm --filter @workspace/rayalgo build`
- One-off run executed:
  - Run ID: `d1edb66f-bb45-4b7b-b9a5-18a5632637fd`
  - Market date: `2026-05-01`
  - Timeframe: `15m`
  - Signals: `7`
  - Synthetic orders: `5`
  - Open synthetic positions: `5`
  - Skipped signals: `2`
  - Ending Shadow net liquidation reported by runner: `$30,670.87`
  - IBKR watchlist prewarm logged a 503 lane-backoff warning, but the run completed.
- Readback confirmed:
  - `5` `Watchlist Backtest` positions visible through `getShadowAccountPositions`.
  - `5` `Watchlist Backtest` history orders visible through `getShadowAccountOrders`.
  - `1D` equity history returned `42` points; latest net liquidation after mark refresh was `$30,633.9816`.

## Follow-Up Week Replay

- User requested the same test over the past week and allowed updating prior results.
- Runner updated to support date ranges and `range: "past_week"`.
- UI panel now has `Today` and `Week` actions.
- Past-week run executed:
  - Run ID: `acc50ee6-0c66-4a93-b261-5a207da4de43`
  - Range: `2026-04-27` through `2026-05-01`
  - Timeframe: `15m`
  - Signals: `85`
  - Synthetic orders: `52`
  - Entries / exits: `31 / 21`
  - Open synthetic positions: `10`
  - Skipped signals: `33`
  - Realized P&L: `-$190.46`
  - Fees: `$52.00` during run; readback latest Shadow equity reports total ledger fees `$57.50`
  - Ending Shadow net liquidation: `$30,718.41`
  - Ending Shadow cash: `$218.46`
- Readback confirmed:
  - `10` `Watchlist Backtest` open positions.
  - `52` `Watchlist Backtest` history orders.
  - `21` `Watchlist Backtest` closed trades.
  - `1W` equity history returned `135` points.
  - Latest equity point net liquidation: `$30,718.41`.

## Next Step

## Follow-Up Month Replay

- User requested the same test over the last month.
- Interpreted as the previous full New York calendar month: `2026-04-01` through `2026-04-30`.
- Runner updated to support `range: "last_month"` / `range: "month"`.
- UI panel now has `Today`, `Week`, `Month`, and `YTD` actions.
- Each watchlist backtest run now replaces prior `watchlist_backtest` ledger artifacts so the selected one-off window is not contaminated by prior Today/Week/Month runs.
- Long-window backtests now scale the historical bar request above the RayReplica warmup floor so month windows are not clipped to only the latest 1,000 bars.
- Month run executed:
  - Run ID: `2a12cd86-a78a-4408-9111-24523fa062ae`
  - Range: `2026-04-01` through `2026-04-30`
  - Timeframe: `15m`
  - Signals: `565`
  - Synthetic orders: `247`
  - Entries / exits: `128 / 119`
  - Open synthetic positions: `9`
  - Skipped signals: `318`
  - Realized P&L: `$2,592.15`
  - Fees: `$247.00` during run; readback latest Shadow equity reports total ledger fees `$252.50`
  - Ending Shadow cash: `$1,908.12`
  - Latest readback Shadow net liquidation after mark refresh: `$33,837.58`
- Readback confirmed:
  - `9` `Watchlist Backtest` open positions.
  - `247` `Watchlist Backtest` history orders.
  - `119` `Watchlist Backtest` closed trades.
  - `1M` equity history returned `217` points.
  - Latest equity point net liquidation: `$33,837.58`.

## Follow-Up 2026 YTD Replay

- User requested the same test since the beginning of 2026 and clarified that `VXX` is fine for volatility-long exposure.
- Runner updated to support `range: "ytd"` / `range: "year_to_date"` / `range: "since_2026"`.
- Initial YTD run included extended-hours bars and exposed that the Shadow order history endpoint returned only the newest 500 orders.
- Follow-up fix:
  - Watchlist backtest signals/fills are explicitly filtered to New York regular-session times.
  - Shadow order history limit raised to `5,000` rows so the YTD synthetic orders are visible in the UI service readback.
- Corrected YTD run executed:
  - Run ID: `770dfb15-d0a9-43ae-a635-6248c9be4848`
  - Range: `2026-01-01` through `2026-05-01`
  - Timeframe: `15m`
  - Signals: `764`
  - Synthetic orders/fills: `276`
  - Entries / exits: `143 / 133`
  - Open synthetic positions: `10`
  - Skipped signals: `488`
  - Realized P&L: `$3,446.57`
  - Fees: `$276.00` during run; readback latest Shadow equity reports total ledger fees `$281.50`
  - Ending Shadow cash: `$1,842.45`
  - Latest readback Shadow net liquidation after mark refresh: `$34,510.44`
- VXX confirmation:
  - `VXX` was present in the Macro watchlist universe.
  - `VXX` generated `17` synthetic fills: `9` buys and `8` sells.
  - VXX realized P&L: `-$409.78`.
  - `VXX` remains open with `107` shares in the corrected run.
- Readback confirmed:
  - `10` `Watchlist Backtest` open positions.
  - `276` `Watchlist Backtest` history orders through the UI service.
  - `133` `Watchlist Backtest` closed trades.
  - `YTD` equity history returned `238` points.
  - Latest equity point net liquidation: `$34,510.44`.
  - Direct ledger check found `0` orders outside regular session.
  - All five saved watchlists contributed orders: Core, High Beta, Macro, Mag 7, Semis + AI.

## Next Step

## Follow-Up Expanded Universe + Stops

- User requested adding `TQQQ` and `SQQQ`, expanding obvious missing watchlist names, and testing stop-loss/trailing-stop overlays on RayReplica.
- Live watchlists updated:
  - Core: added `TQQQ`, `SQQQ`.
  - Semis + AI: added `SMH`, `ASML`, `MRVL`, `ANET`.
  - Built-in watchlist seed updated with the same additions.
- Backtest engine updated:
  - API accepts optional `riskOverlay` with `stopLossPercent` and/or `trailingStopPercent`.
  - Simulated stop exits use 15m bar lows/highs on existing long positions while RayReplica still controls entries and ordinary exits.
  - Risk overlay metadata is stored on synthetic order payloads.
- Expanded universe:
  - `5` watchlists.
  - `37` unique symbols.
  - Prewarm confirmed no dropped symbols.
- Strategy sweep:
  - Tested baseline, fixed stops `3%`, `5%`, `8%`, trailing stops `3%`, `5%`, `8%`, and combos `SL5/TR5`, `SL5/TR8`, `SL8/TR5`.
  - Initial pass showed history hydration variance for newly added symbols, so a warmed-data pass was run for the top candidates.
  - Best warmed-data variant: `TR3` (`3%` trailing stop).
- Final Shadow ledger run:
  - Run ID: `245d3e23-cbde-4b6e-8470-f0b263ee38f3`
  - Range: `2026-01-01` through `2026-05-01`
  - Timeframe: `15m`
  - Risk overlay: `TR3` / `3%` trailing stop
  - Signals: `878`
  - Synthetic orders/fills: `528`
  - Entries / exits: `269 / 259`
  - Open synthetic positions: `10`
  - Skipped signals: `542`
  - Realized P&L: `$3,857.91`
  - Fees: `$528.00` during run; readback latest Shadow equity reports total ledger fees `$533.50`
  - Ending Shadow cash: `$442.06`
  - Latest readback Shadow net liquidation after mark refresh: `$34,815.55`
- Readback confirmed:
  - `10` `Watchlist Backtest` open positions.
  - `528` `Watchlist Backtest` history orders through the UI service.
  - `259` `Watchlist Backtest` closed trades.
  - `YTD` equity history returned `346` points.
  - Latest equity point net liquidation: `$34,815.55`.
  - Direct ledger check found `0` orders outside regular session.
  - All five saved watchlists contributed orders.

## Next Step

Review the live UI against a running backend; Account > Shadow should now show the expanded YTD watchlist backtest using the `TR3` trailing-stop overlay.
