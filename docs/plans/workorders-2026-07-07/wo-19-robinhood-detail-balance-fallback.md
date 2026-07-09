# WO-19: Robinhood account detail + balance sync, and remove the legacy IBKR persisted fallback

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE. Read-only DB allowed via `cd lib/db && node -e` with pg + `$DATABASE_URL`. Robinhood is CONNECTED for app user `272b0024-e3a5-4edd-abac-e3bca9c8e125` (token valid) — you may call its MCP to verify shapes.

## Context (verified 2026-07-07)

Robinhood connect + account-list now work (`785beb45`, `b978f62d`): `getRobinhoodBackedAccounts` returns 2 accounts (`560316630`, agentic `727958282`) into `listAccounts`. Three gaps remain:

1. **Detail 404.** Opening a Robinhood account 404s: `account.ts` `readLiveAccountUniverseUncached` (~line 1220) resolves an accountId via IBKR-live → `getPersistedBackedAccounts` (matches by `providerAccountId`) → flex → `throw 404` (line ~1271). No Robinhood branch, and the list keys Robinhood accounts by their UUID `id`, which never matches a `providerAccountId` lookup. Every Robinhood account 404s on open.
2. **No balance/position data.** The connector only calls MCP `get_accounts` (metadata). Balances/positions are never synced, so even once the 404 is fixed the account shows $0 — but the user HAS a real balance.
3. **Bad legacy fallback (owner asked to remove).** `getPersistedBackedAccounts` (~line 1164) hardcodes `provider: "ibkr"` (~line 1324) — IBKR-era legacy, and IBKR is retired (`bridge_retired`). Owner wants this removed.

### Verified Robinhood MCP shapes (captured live — use these, do not re-guess)

Tools available include: `get_accounts`, `get_portfolio`, `get_equity_positions`, `get_option_positions`, `get_realized_pnl`, plus order tools (`place_equity_order`, `review_equity_order`, `cancel_equity_order`, option variants).

`get_portfolio` (called with `{ account_number }`) returns:
```
{ "data": { "total_value":"40", "equity_value":"0", "options_value":"0", "cash":"40",
            "currency":"USD", "buying_power": { "buying_power":"40.0000", "unleveraged_buying_power":"40.0000", "display_currency":"USD" }, ... },
  "guide": "... total_value = account/portfolio value; cash = cash; buying_power.buying_power = spendable ..." }
```
The MCP session pattern: `new RobinhoodMcpSession({ accessToken, fetchImpl })`, `await s.initialize()`, `await s.callTool({ name, arguments: { account_number } })` (see `providers/robinhood/mcp-client.ts` and how `robinhood-account-sync.ts` uses it). `get_accounts` nests under `{ data: { accounts:[...] } }` — expect `get_portfolio`/positions to nest under `data` similarly; verify by calling before parsing.

## Task

1. **Balance in the account snapshots.** In `getRobinhoodBackedAccounts` (account.ts), after loading the account rows, fetch each account's `get_portfolio` via a `RobinhoodMcpSession` (one session, per-account `account_number = providerAccountId`) and populate the `BrokerAccountSnapshot` balance fields (netLiquidation/total value from `data.total_value`, cash from `data.cash`, buying power from `data.buying_power.buying_power`, currency). Mirror how SnapTrade balances are shaped in a `BrokerAccountSnapshot`. Degrade gracefully: if the portfolio call fails, return the account with null/zero balances and log — never fail the whole account list. Consider a short cache to avoid an MCP call on every account-list hit (mirror any existing per-account balance cache; if none, a small in-memory TTL is fine).

2. **Fix the detail 404.** Add a Robinhood branch to the account-detail resolver (`readLiveAccountUniverseUncached`, before the line ~1271 throw): resolve Robinhood accounts via `getRobinhoodBackedAccounts(mode)` filtered to the requested id (the list keys them by broker_accounts UUID, so match `account.id === requestedAccountId`), returning the same result shape the persisted/flex branches use (`source: "persisted"` or add a `"robinhood"` source if the return type allows). This makes summary/positions/allocation/equity-history stop 404ing.

3. **Positions (include if clean, else report as follow-up).** If it fits without ballooning scope, wire `get_equity_positions` + `get_option_positions` into the Robinhood account positions path so the detail shows holdings. If it requires touching many detail endpoints, implement balance (task 1) + 404 fix (task 2) and list positions as a follow-up in the report.

4. **Remove the legacy IBKR persisted fallback (owner request).** Remove `getPersistedBackedAccounts`'s hardcoded `provider: "ibkr"` legacy path. IBKR live is retired, so this fallback mislabels non-IBKR accounts. Ensure `listAccounts` and the detail resolver still work afterward via the proper per-provider sources (SnapTrade source, Robinhood source, IBKR-live when present). If any current behavior genuinely depends on persisted IBKR snapshots, report exactly what and gate the removal rather than breaking it — but the default intent is removal. Update/rename tests that asserted the ibkr-labeled fallback.

5. **Tests.** Robinhood account detail resolves (no 404) and carries the get_portfolio balance; account list shows the balance; removal of the ibkr fallback doesn't break SnapTrade/Robinhood list or detail. Follow existing account.ts test patterns; mock MCP calls.

## SCOPE

`artifacts/api-server/src/services/account.ts`, a small `robinhood-account-portfolio.ts` helper if cleaner (mirror `snaptrade-account-portfolio.ts`), `providers/robinhood/mcp-client.ts` only if a helper is needed, and the account test files. Before editing account.ts, `git diff -- artifacts/api-server/src/services/account.ts` — if foreign hunks overlap your regions, implement at the cleanest seam and report. Do NOT touch signal-options/signal-monitor/backtesting/backtest-worker files. Do NOT change order-execution (that's the separate `order_tooling_unverified` follow-up).

## Acceptance / verification

- `pnpm --filter @workspace/api-server run typecheck` clean.
- Account tests green; add the new coverage.
- Read-only live check in the report: `getRobinhoodBackedAccounts` returns 2 accounts WITH balances (agentic `727958282` shows a non-zero total_value/cash), and the detail resolver returns them without 404 (a standalone tsx probe like claude-lead used is fine; note it needs no app-user context since the source is unscoped on this route).
- Scope-check clean. Commit as `feat(api): Robinhood account balances + detail resolution; drop legacy IBKR persisted fallback`; do NOT push.

## Deliverable

`.codex-watch/wo-19-robinhood-detail-report-2026-07-07.md`: balance wiring (get_portfolio shape used), detail-resolver fix, positions done-or-deferred, exactly what was removed for the IBKR fallback and proof list/detail still work, test evidence, commit hash, any lane-collision deferral.
