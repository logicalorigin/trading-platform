# WO-60 E*TRADE Account History Reconstruction Report

## Scope

Worker: `codex-worker` for `claude-lead` session `03f2c018`.

Touched files:
- `artifacts/api-server/src/services/account-equity-history-model.ts`
- `artifacts/api-server/src/services/snaptrade-account-history.ts`
- `artifacts/api-server/src/services/snaptrade-account-history.test.ts`
- `artifacts/api-server/src/services/robinhood-account-history.ts`
- `artifacts/api-server/src/services/robinhood-account-history.test.ts`

Frontend files were not changed.

## Root-Cause Confirmation

Observed from source:

- `fetchBalanceHistory` treats SnapTrade `/balanceHistory` 403/404 as optional/unavailable at `artifacts/api-server/src/services/snaptrade-account-history.ts:1176`.
- The current-NLV fallback still snapshots only one current point via `fetchCurrentBalancePoint` at `artifacts/api-server/src/services/snaptrade-account-history.ts:1199`.
- `getSnapTradeAccountHistory` reads only stored activities and stored balance snapshots at `artifacts/api-server/src/services/snaptrade-account-history.ts:1535`.
- Before this fix, `equityHistoryFromBalancePoints` could only turn those stored snapshots into chart points. After the fix, the same function is still the final formatter at `artifacts/api-server/src/services/snaptrade-account-history.ts:1284`, but sparse snapshot selection now routes through activity reconstruction at `artifacts/api-server/src/services/snaptrade-account-history.ts:1338`.

Inference: for E*TRADE/SnapTrade accounts where provider balance history is unavailable, `balance_snapshots` contains only current/future NLV samples, so the account-detail equity graph has no historical shape even when `snaptrade_account_activities` has years of data.

## Fix

- Added `reconstructEquityHistoryFromActivityLedger` in `account-equity-history-model.ts:259`.
- The helper builds daily seed points from deposits, withdrawals, realized P&L, dividends, interest, and fees, then anchors the terminal point to the latest stored NLV.
- The reconstructed seed points still flow through `calculateTransferAdjustedReturnPoints`, so deposits and withdrawals are return-neutral.
- SnapTrade now uses real balance snapshots when they cover the activity span, otherwise it reconstructs from activities and closed trades. Selection is in `snaptrade-account-history.ts:1338`.
- SnapTrade activity typing now reuses `classifyExternalCashTransfer` and broadens trade-side detection for rows that carry side in `optionType`, signed quantity, and signed amount.
- Robinhood now has `readRobinhoodActivityLedgerEquityHistory` at `robinhood-account-history.ts:370`, using Robinhood per-trade `realizedGain` plus the latest current snapshot.

Documented limitation in code:

- SnapTrade comment at `snaptrade-account-history.ts:1363`.
- Robinhood comment at `robinhood-account-history.ts:408`.

Limitation: this is a realized/contribution-based reconstruction, not true historical mark-to-market. Historical positions/prices are not available from these provider paths. Open-position MTM is absorbed into the terminal NLV anchor.

## Calendar / P&L

Observed from source:

- Calendar daily realized P&L is driven by `closedTrades.trades[].closeDate` and `realizedPnl` in `accountPnlCalendarModel.js`.

Applied:

- `buildClosedTradesFromActivities` now accepts BUY/SELL from explicit `type`, `optionType`, or signed quantity/amount at `snaptrade-account-history.ts:897`.
- Added a SnapTrade test proving daily realized grouping from reconstructed closed trades reconciles to `closedTrades.summary.realizedPnl`.

## All-Broker Parity

Applied inside allowed scope:

- Shared reconstruction helper in `account-equity-history-model.ts`.
- SnapTrade wiring in `snaptrade-account-history.ts`.
- Robinhood equivalent reconstruction helper in `robinhood-account-history.ts`.

Concern:

- The generic Robinhood account-detail equity route is implemented in `artifacts/api-server/src/services/account.ts`, which the work order explicitly excluded from SCOPE. I did not edit it. Robinhood has the reconstruction helper and tests, but generic route wiring remains outside this worker diff.

## Test Evidence

Passed:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/snaptrade-account-history.test.ts
tests 3, pass 3, duration_ms 44196.122977
```

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/robinhood-account-history.test.ts
tests 4, pass 4, duration_ms 46047.165557
```

```text
pnpm --filter @workspace/api-server exec tsc --noEmit --pretty false
exit 0
```

```text
pnpm --filter @workspace/pyrus typecheck
exit 0
```

## Live Probe

Attempted the required one-shot `tsx` probe against:

- `appUserId = 272b0024-e3a5-4edd-abac-e3bca9c8e125`
- `accountId = 9197da68-4c3d-419d-9dc6-874589a05245`
- `range = ALL`

The temporary probe file was `.codex-watch/wo60-live-probe.ts` and was deleted after use.

Observed blocker:

- Direct `getSnapTradeAccountHistory` probe repeatedly failed before reading account data:

```text
DrizzleQueryError: Failed query:
select ... from "broker_accounts" inner join "broker_connections" ...
cause: Error: Connection terminated due to connection timeout
```

- Retried with the default DB pool timeout and again with `DB_POOL_MAX=1 DB_CONNECTION_TIMEOUT_MS=120000`; the long-timeout probe still did not acquire a connection after several minutes and was interrupted to avoid leaving a stuck DB client.
- TCP to `helium:5432` was open, so this was not a DNS/socket failure.
- A separate long-running DB diagnostic process was observed holding a `pg_stat_activity` query for over 11 minutes. I did not kill or restart any process.

Unknown because live DB acquisition was blocked:

- Live E*TRADE point count.
- Live terminal NLV comparison against `$15,082.98`.
- Live calendar non-empty count.
- Live realized-P&L reconciliation from the real account payload.

## Commits

Exact commit SHA cannot be embedded into the same commit without changing that commit's tree. The final worker response records the actual SHA after commit.

