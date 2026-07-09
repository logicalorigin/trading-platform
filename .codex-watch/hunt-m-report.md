# HUNT-M money math report

1. artifacts/backtest-worker/src/index.ts:1317 | P1 | Signal-options backtests key daily loss by UTC day
   Evidence: `utcDateKey` returns `value.toISOString().slice(0, 10)` at 1317-1318; realized exits are stored under that key at 1456-1458 and daily halt reads the same UTC key at 1530-1539. The live path explicitly fixed this class by comparing `marketDateKeyFromDate(event.occurredAt)` to `marketDateKeyFromDate(now)` at artifacts/api-server/src/services/signal-options-automation.ts:8298-8303.
   Consequence: a historical/backtest signal-options exit after 20:00 ET is charged to the next UTC date, so daily-loss halts and simulated entry eligibility can be wrong around evening/overnight replay windows.
   Laziest fix: replace the worker UTC date key with the same NY market-date key used by live signal-options daily P&L.
   Confidence: 0.87

2. artifacts/api-server/src/services/signal-options-automation.ts:18807 | P1 | Historical signal-options backfill/replay uses UTC day for daily-loss P&L
   Evidence: `closeBackfillPosition` stores realized P&L with `input.occurredAt.toISOString().slice(0, 10)` at 18807-18808, and candidate gating computes `dayKey = historicalSignal.signalAt.toISOString().slice(0, 10)` at 20029-20037. The same file already has `marketDateKeyFromDate` at 17014-17017 and uses it for live daily realized P&L at 8298-8303.
   Consequence: replay/backfill results can skip or allow trades on the wrong market day, so historical performance and promoted profiles can be biased around UTC/NY date boundaries.
   Laziest fix: use `marketDateKeyFromDate` for `realizedByDay` and `dailyPnlForBackfill` keys.
   Confidence: 0.86

3. artifacts/api-server/src/services/signal-options-automation.ts:8271 | P1 | Signal-options daily P&L ignores commissions
   Evidence: `signalOptionsRealizedPnl` only computes `(exitPrice - entryPrice) * quantity * multiplier` at 8271-8283. Daily realized P&L then sums `payload.pnl` at 8327-8329, while exit events populate that field from `signalOptionsRealizedPnl` at 14199-14204 and 16328-16333. Shadow fills do compute fees separately and sell realized P&L subtracts fees in artifacts/api-server/src/services/shadow-account.ts:4471-4478.
   Consequence: the cockpit daily P&L and daily-loss halt can be gross of commissions, delaying halts on small losses and overstating wins compared with shadow account cash/NLV.
   Laziest fix: make signal-options exit event P&L fee-aware or compute daily realized P&L from the shadow fill ledger for closed positions.
   Confidence: 0.73

4. lib/backtest-core/src/analytics.ts:21 | P2 | Intraday backtest Sharpe/volatility annualize as if bars are daily
   Evidence: `TRADING_PERIODS_PER_YEAR` is hardcoded to 252 at 21; `equityReturns` treats every adjacent point as one return at 70-80; Sharpe and volatility both multiply by `sqrt(252)` at 86-95 and 292-294. The engine emits a point for every backtest timestamp/bar at lib/backtest-core/src/engine.ts:480-486.
   Consequence: 1m/5m/15m/hourly backtests show materially understated annualized volatility and Sharpe/Sortino values, distorting optimizer rankings and strategy comparisons.
   Laziest fix: pass timeframe/periods-per-year into metrics and annualize by bar cadence, not a fixed daily constant.
   Confidence: 0.91

5. lib/backtest-core/src/analytics.ts:469 | P2 | Profit factor returns dollars when there are no losses
   Evidence: when `grossLoss === 0`, profit factor becomes `grossProfit` at 469-470 instead of an unbounded/null ratio. The signal-options metric avoids this unit mix by returning `null` when gains exist but losses do not at artifacts/api-server/src/services/signal-options-automation.ts:11499-11508.
   Consequence: all-winning backtests are ranked by gross profit dollars under a field that otherwise means gain/loss ratio, so dashboards and sweeps compare incompatible units.
   Laziest fix: return `null`, `Infinity`, or a documented capped sentinel for no-loss profit factor consistently across backtest metrics.
   Confidence: 0.84

Coverage note: Read-only audit focused on `shadow-account.ts` ledger folds, `signal-options-*` P&L/marks, `account.ts` and `account-equity-history-model.ts` equity reconstruction, `lib/account-math`, and `lib/backtest-core` return math. I excluded the known dashboard P&L-from-last-100-events issue and did not inspect unrelated hunt sections.
