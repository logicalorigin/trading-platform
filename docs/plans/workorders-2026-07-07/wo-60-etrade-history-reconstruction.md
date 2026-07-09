# WO-60: E*TRADE (all-broker) account-history reconstruction — equity graph + P&L calendar

You are `codex-worker` for `claude-lead` (session 03f2c018). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE. Commit per theme; do NOT push. TRADING/FINANCIAL-DATA SENSITIVE: correctness matters more than speed — verify against the live E*TRADE account, do not hand-wave the math.

## Symptom (owner-reported)

The E*TRADE account-detail views are still wrong: the **equity graph is empty/flat** and the **P&L calendar (returns) is wrong/incomplete**, despite the account having a lengthy real history. This must render correctly for E*TRADE and, by the same mechanism, every connected broker whose provider gives no historical balance API (SnapTrade brokers + Robinhood).

## Ground truth (verified by claude-lead)

- E*TRADE accounts connect via **SnapTrade** (`broker_provider='snaptrade'`). Test account = **E*Trade RETIREMENT ROTH IRA**:
  - `appUserId = 272b0024-e3a5-4edd-abac-e3bca9c8e125`
  - `broker_accounts.id = 9197da68-4c3d-419d-9dc6-874589a05245`
  - **1,875 activities** in `snaptrade_account_activities`, spanning **2024-07-31 → 2026-06-30**.
  - Current NLV ≈ **$15,082.98** (from the latest `balance_snapshots` row, written by the current-balance fallback).
- Transaction history backfill WORKS (2,288 activities across 9 SnapTrade accounts). The gap is the derived views.

## Root cause (file:line evidence — confirm before acting)

1. **Equity graph is empty.** `getSnapTradeAccountHistory` builds `equityHistory` via `equityHistoryFromBalancePoints(readStoredBalanceSnapshots(...))` in `artifacts/api-server/src/services/snaptrade-account-history.ts` (~line 1300 + 1106 + 1085). That reads ONLY `balance_snapshots`. SnapTrade's historical `/balanceHistory` endpoint is **unavailable on this plan** (403/404 → 0 points; see `fetchBalanceHistory`, `optionalStatuses:[403,404]`). A recent fallback (`fetchCurrentBalancePoint`) writes the *current* NLV each backfill run, so the account has only 1–2 forward points → the curve has no history. **The historical equity curve must be reconstructed from the activity ledger**, anchored so the terminal value equals current NLV.
2. **Calendar may be wrong.** The P&L calendar (`artifacts/pyrus/src/screens/account/accountPnlCalendarModel.js` + `AccountReturnsPanel.jsx`) is built from **closed trades** (`trade.closeDate`, `trade.realizedPnl`), which for SnapTrade are reconstructed from activities by `buildClosedTradesFromActivities` (~line 869 in the same service). Verify the closed-trade reconstruction is correct for E*TRADE's activity types (stocks AND options; buys/sells/dividends/transfers/fees) and that every realized event lands on the right day with the right P&L. Fix reconstruction bugs that make the calendar wrong/empty.

## Task

Make the E*TRADE account-detail **equity graph** and **P&L calendar** correct, driven by the real activity ledger, for any SnapTrade/Robinhood account lacking a provider balance-history API.

1. **Historical equity reconstruction.** Build a daily (or per-activity) equity/return series from the SnapTrade activity ledger (`snaptrade_account_activities`) anchored to the current NLV balance snapshot:
   - Classify each activity's cash/position impact (deposit, withdrawal, buy, sell, dividend, fee, interest, transfer). The activity `amount`/`type`/`option_type` fields carry this; reuse the existing activity typing helpers in the service.
   - Produce an equity curve whose **terminal value = current NLV** and whose shape reflects cumulative contributions + realized P&L + dividends − fees over the activity date range. True historical mark-to-market is NOT available (no historical positions/prices) — the reconstructed curve is contributions-and-realized based; **document this limitation in code + report**. Feed the reconstructed points through the existing `account-equity-history-model.ts` (`calculateTransferAdjustedReturnPoints`) so deposits/withdrawals are return-neutral, exactly like the IBKR path.
   - Wire this reconstruction into `getSnapTradeAccountHistory` so `equityHistory.points` is populated when stored balance snapshots are sparse/absent. Keep real balance snapshots authoritative when present (IBKR-style); only reconstruct to fill the gap.
2. **Calendar correctness.** Verify/repair `buildClosedTradesFromActivities` so the daily realized-P&L calendar is complete and correct for E*TRADE (2024→2026). The calendar's daily P&L over a period must reconcile with the equity curve's realized-P&L delta over the same period.
3. **All-broker parity.** The reconstruction must key off "provider has no balance history" (SnapTrade + Robinhood), not a hardcoded provider. Robinhood uses `robinhood_account_activities` (per-trade `realized_gain`) + `robinhood-account-history.ts` — apply the equivalent reconstruction there, or factor a shared model both call. IBKR (real balance snapshots + flex) must be unchanged.

## Acceptance / verification (MUST run against live data)

- Live probe against the E*TRADE ROTH account (a one-shot `tsx` script calling `getSnapTradeAccountHistory({appUserId, accountId, range:"ALL"})`, then delete it):
  - `equityHistory.points.length` is **large** (covers the 2024→2026 span, not 1–2), monotonic in time, and the **last point ≈ current NLV $15,082.98**.
  - `closedTrades.summary.count > 0`; the calendar model (`accountPnlCalendarModel.js`) produces **non-empty** month/year daily-P&L when fed this payload.
  - Sum of daily realized P&L over the full range reconciles (± rounding) with `closedTrades.summary.realizedPnl`.
  - NOTE: the live app saturates the Postgres pool right after a reload — if the probe throws `Failed query`, retry after ~30s or when the app is quiet. Do NOT restart the app.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/snaptrade-account-history.test.ts` green; add cases covering activity→equity reconstruction (deposit + trades → terminal NLV) and the daily-P&L reconciliation.
- Frontend: `pnpm --filter @workspace/pyrus typecheck`; if you touch the calendar/equity model, add/extend their unit tests.
- api-server `tsc` clean in SCOPE. (Note: `signal-options-opposite-dual-confirm.test.ts` has a PRE-EXISTING typecheck failure owned by another lane — ignore it, do not "fix" it, do not let it mask your own errors.)

## SCOPE

`artifacts/api-server/src/services/snaptrade-account-history.ts`, `account-equity-history-model.ts`, `robinhood-account-history.ts`, a new shared reconstruction module if you factor one, and their `*.test.ts`. Frontend: `artifacts/pyrus/src/screens/account/accountPnlCalendarModel.js`, `equityCurveData.js`, `accountReturnsModel.js` + their tests, ONLY if a data-shape fix is required (say so loudly in the report — web dev-server implications are claude-lead's).

Do NOT touch: `signal-options-*`, `signal-monitor*`, `backtesting*`, `backtest-worker/*` (live lanes), IBKR flex/balance paths, or `account.ts`'s listAccounts balance path (WO-15 flagged it leaky — out of scope).

## Deliverable

`.codex-watch/wo-60-etrade-history-report-2026-07-07.md`: root-cause confirmation with file:line, the reconstruction approach + its documented limitation, the applied diffs, live-probe evidence (point count, terminal value vs NLV, calendar non-empty, P&L reconciliation), test evidence, and the exact commit SHAs. Commit as `fix(api): reconstruct account equity curve + P&L calendar from activity ledger`; do NOT push.
