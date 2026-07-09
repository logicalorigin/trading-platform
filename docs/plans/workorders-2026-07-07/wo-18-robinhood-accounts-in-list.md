# WO-18: Surface Robinhood accounts in the account list / tab bar

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE. Read-only DB checks allowed via `cd lib/db && node -e` with pg + `$DATABASE_URL`.

## Verified root cause (2026-07-07)

Robinhood was connected + synced: two rows exist in `broker_accounts` (via connection `b841980e-be3f-4546-820e-670982efaa6d`, provider robinhood), both `included_in_trading=true`, `account_status=open`, correct `app_user_id`, `mode=live`, one flagged agentic (`727958282`, nickname "Agentic"). But they do NOT appear in the accounts screen / account tab bar.

Cause: `artifacts/api-server/src/services/account.ts` → `listAccountsUncached` (~line 4487) aggregates only:
- IBKR live via `listLiveAccounts`/`listIbkrAccounts`,
- SnapTrade via `getSnapTradeBackedAccounts` (merged at ~4497-4523),
- a persisted/flex fallback (`getPersistedBackedAccounts` ~line 1164) that hardcodes `provider: "ibkr"` (~line 1324) and runs only when IBKR-live is empty.

There is NO Robinhood source anywhere in `account.ts` (grep for "robinhood" = 0 hits). SnapTrade accounts surface because they have a dedicated backed-accounts source; Robinhood has none, so its synced accounts are never merged into the list.

## Task

Add a Robinhood account source that mirrors the SnapTrade one, and merge it into the account list so Robinhood accounts appear correctly (labeled provider "robinhood", not "ibkr").

1. **Study the SnapTrade pattern first**: `getSnapTradeBackedAccounts` and its helpers in `account.ts` / `snaptrade-account-portfolio.ts` — how it reads `broker_accounts` for its provider (via the connection/provider), builds `BrokerAccountSnapshot` (id, providerAccountId, displayName, provider, mode, balances, executionReady/executionBlockers, includedInTrading), resolves balances, and degrades gracefully on failure. The Robinhood source must follow the SAME shape and failure-tolerance.
2. **Implement `getRobinhoodBackedAccounts(mode)`**: read `broker_accounts` joined to `broker_connections` where provider = robinhood and `mode` matches, for the current user scope (respect the same user-scoping the SnapTrade/WO-15 path uses — do NOT reintroduce a cross-user leak). Map each row to a `BrokerAccountSnapshot` with `provider: "robinhood"`, carrying `included_in_trading`, `account_status`, `agentic`/capabilities, and `execution_blockers` (e.g. `robinhood.order_tooling_unverified`, `robinhood.account.non_agentic`). Balances: Robinhood balances may not be available via the current sync (the MCP `get_accounts` returns account metadata, not balances) — if no balance source exists, return the account with null/zero balances rather than failing, and note it. Do NOT invent a balance API call that isn't already implemented.
3. **Merge into `listAccountsUncached`**: add Robinhood accounts alongside SnapTrade in BOTH the live-wins branch (~4520-4525) and the persisted-fallback branch (so they show whether or not IBKR live is present), guarded by the same `.catch(() => [])` degrade pattern SnapTrade uses. Ensure `withTradingInclusionDefault` still applies.
4. **Mode**: the synced Robinhood rows are `mode="live"`. Ensure the source returns them for the mode the accounts screen requests. If the app's default view is a different mode (e.g. shadow) and that's why they're hidden, report that finding rather than silently changing mode semantics.
5. **Tests**: add a unit test proving `listAccounts` includes a Robinhood account when one exists in `broker_accounts` (mock the source like the SnapTrade tests do), and that provider is "robinhood" not "ibkr". Follow the existing account.ts test pattern.

## SCOPE

`artifacts/api-server/src/services/account.ts` (+ a small helper file if the SnapTrade pattern uses one, e.g. a `robinhood-account-portfolio.ts` mirroring `snaptrade-account-portfolio.ts`), and the relevant account test file. Before editing account.ts, `git diff -- artifacts/api-server/src/services/account.ts` — it may carry other lanes' hunks; if your target regions overlap, implement at the cleanest non-colliding seam and report. Do NOT touch signal-options/signal-monitor/backtesting files.

## Acceptance / verification

- `pnpm --filter @workspace/api-server run typecheck` clean in SCOPE.
- New + existing account tests green (`pnpm --dir artifacts/api-server exec node --import tsx --test <account test files>`).
- A read-only DB-backed sanity note in the report: with the real connection `b841980e-...`, the new source would return 2 accounts (`560316630` non-agentic, `727958282` agentic).
- Scope-check clean. Commit as `feat(api): surface Robinhood accounts in the account list`; do NOT push.

## Deliverable

`.codex-watch/wo-18-robinhood-accounts-report-2026-07-07.md`: the source added, how it mirrors SnapTrade, the mode finding, balance-availability note, merge points, test evidence, commit hash, and any lane-collision deferral.
