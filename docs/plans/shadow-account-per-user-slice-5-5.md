# Slice 5.5 — Shadow (paper-trading) accounts: per-user isolation

Part of the PYRUS multi-user rollout (after 5.3 watchlists, 5.4 user-preferences).
Decisions locked by the user 2026-07-05: **per-user isolated, full flip**, with these
defaults — auto-create an empty $25k standalone shadow on first view; move the public
`/streams/accounts/shadow` under `requireUser` together with `/shadow/orders`; the
marketing dashboard stays global (pins the platform id); the signal pipeline universe
is unchanged (the automation replay stays platform-only).

## Core shape (mirrors 5.3)

`shadow-account.ts` (15,581 lines, ~30 exported fns, 99 `SHADOW_ACCOUNT_ID` sites) is
DUAL-USE: its read/write functions are called by BOTH `requireUser` routes (a user's own
book) AND no-user callers (public marketing dashboard, background SSE timers, automation
workers). We therefore **cannot** put `requireCurrentAppUserId()` inside them — it would
401 marketing and crash the timers. Instead:

- A dedicated **shadow-account ALS** (`services/shadow-account-context.ts`):
  `currentShadowAccountId()` defaults to the platform singleton `SHADOW_ACCOUNT_ID="shadow"`
  (founding-admin row); `runWithShadowAccountId(id, fn)` binds a scope; only trusted
  `requireUser` route boundaries wrap the exact read/write call in the caller's resolved id.
- **Ownership lives only on `shadow_accounts.app_user_id`** (Slice-3). All child tables
  (orders/fills/positions/marks/balance_snapshots/portfolio_analysis_snapshots) reach the
  account by `accountId` FK only — **no child migration needed**; scoping the account id
  transitively scopes every child. Slice-3 partial-unique indexes already exist
  (one active standalone per user; one active paired per broker account).
- `source` (manual | automation | watchlist_backtest | signal_options_replay) is a
  data-origin partition, **not** an ownership boundary — it stays as-is.

## 3-way site classification (the delicate part)

Each of the 99 `SHADOW_ACCOUNT_ID` sites is one of:

1. **DB query filter / insert into a shadow table** (`eq(table.accountId, …)`, `accountId: …`
   in inserts, raw-SQL param tuples) → `currentShadowAccountId()` (scope-aware).
2. **Response DTO field** (`accountId`, `accounts:[…]` on returned position/summary objects,
   e.g. lines 8687/9132/9560) → **stay `SHADOW_ACCOUNT_ID`** ('shadow' is the URL alias the
   frontend keys on; `isShadowAccountId` at 15368 compares to it).
3. **Const/type/comparison/background-platform-pinned** → stay hardcoded. Includes the
   const (111), the `typeof SHADOW_ACCOUNT_ID` type (7812 → widen to `string`),
   `isShadowAccountId` (15368), and background replay/mirror writes.

## Chokepoints

- `withShadowReadCache(key, …)` (792): prefix `key` with `currentShadowAccountId()` — one edit
  partitions all ~15 read caches + in-flight maps per account (prevents the cross-user cache
  leak; the current keys are `source`-only = process-global).
- `shadowFreshStateCache` (478, single slot) + `shadowFreshStateInFlight` (484): → `Map` keyed
  by `currentShadowAccountId()`.
- `ensureShadowAccount` (2814) / `readShadowAccount` (2851): resolve `currentShadowAccountId()`.
- `invalidateShadowFreshStateCache` (619): global `.clear()` is correct (never serves wrong
  data); per-account invalidation is a later perf optimization, not a leak fix.

## Background-automation carve-out (must NOT be user-scoped)

Run these in an explicit platform scope (or keep `SHADOW_ACCOUNT_ID` hardcoded), so a user
scope can never leak in — several are reachable from `placeShadowOrder` (which fires
`recordShadowAutomationEvent({source:"automation"})` + `recomputeShadowAccountFromLedger`):
`runShadowOptionMaintenance` (5045), `refreshShadowPositionMarks` (5777),
`computeSignalOptionsLedgerRealizedForDeployment` (3487),
`recordShadowAutomationEvent`+Entry/Exit/Mark (15400/15440/15481),
`resetSignalOptionsReplayRowsFor*` (14020/14035),
`backfillSignalOptionsReplayEquitySnapshotsFromRun` (7684).
Entry points with no ALS user: `signal-options-worker.ts`, `signal-options-automation.ts`,
`overnight-spot-execution.ts`, `automation.ts`, `market-data-admission.ts`.
NOTE: `recomputeShadowAccountFromLedger` must recompute *the account just mutated*, so it
INHERITS the ambient scope (dual-use), it is NOT platform-pinned.

## Route boundaries (where behavior actually flips)

- `GET /accounts/shadow/*` reads (via `account.ts`) — `requireUser`-gated (verified
  routes/index.ts:46). Wrap the getter call in `runWithShadowAccountId(resolveCurrentUserShadowAccountId(), …)`.
- `POST /shadow/orders` + `/preview` (platform.ts:2300/2310) — `requireUser`-gated (index.ts:50).
  Wrap `placeShadowOrder`/`previewShadowOrder` in the caller's scope.
- `GET /streams/accounts/shadow` (platform.ts:3582) — currently **public/ungated** (verified: not
  in REQUIRE_USER_PATHS). Move under `requireUser` + per-connection user scope + per-account
  snapshot cache (`shadow-account-streams.ts:29`). Flip together with `/shadow/orders`.
- Marketing (`marketing-shadow-dashboard.ts`, public) reads the whole singleton with NO source
  (verified :535-543) → keep global; it resolves the platform id by default (no scope set).

`resolveCurrentUserShadowAccountId()`: `uid = requireCurrentAppUserId()`; find the user's active
standalone shadow (`app_user_id=uid AND source_broker_account_id IS NULL AND status='active'`,
matches `shadow_accounts_user_standalone_idx`); create it ($25k) if absent; return its id.

## Execution order (verified checkpoints)

- **A (behavior-identical):** ALS module + resolvers; `withShadowReadCache` key prefix;
  fresh-state Map; `ensure/readShadowAccount` scope; swap the class-1 DB-filter/insert sites to
  `currentShadowAccountId()`; wrap background-platform fns in explicit platform scope. All still
  resolve platform → behavior-identical. Verify: typecheck + automation/marketing/single-user
  reads unchanged. Commit.
- **B (the flip):** `resolveCurrentUserShadowAccountId()` (find-or-create) + route wrappers for
  `/accounts/shadow/*` reads and `/shadow/orders(/preview)`; then `/streams/accounts/shadow` under
  `requireUser` + per-account snapshot cache. Verify: two-user isolation (A vs B ledger) +
  automation still runs (no 401 in flight-recorder) + marketing unchanged. Commit.

## Riskiest change

`placeShadowOrder` (4312) — serves the user route write AND ≥4 automation call sites, and it
fires the platform replay mirror. It must resolve its account from the ambient scope (route →
caller; automation → platform), never blind-`requireCurrentAppUserId()`; and
`recordShadowAutomationEvent` inside it must stay platform-pinned so a user's manual trade never
pollutes the automation replay / public marketing P&L.

## Verified facts (source-checked)

- `/accounts/*`, `/shadow/orders/*` → `requireUser`-gated; `/streams/accounts/*` → public;
  marketing → public (routes/index.ts:43-60, 78-83).
- Marketing dashboard calls `getSummary()/getPositions({})/…` with NO source
  (marketing-shadow-dashboard.ts:535-543) → reads the whole singleton (all sources incl. manual)
  → today any human paper trade pollutes the public track record. This motivated per-user.
- Child tables carry only `accountId` FK (no `app_user_id`) → no migration beyond Slice 3.
