# PYRUS landing execution report - 2026-07-07

Executor: `codex-worker` for `claude-lead`

Plan: `.codex-watch/landing-manifest-2026-07-07.md` plus approved amendments A1-A8.

Result: DONE. Landed 9/9 commits. Final HEAD: `4feae5d45340d85d9978979a00f92b41f2787b30`.

## Setup

- BASE observed: `285dedf45285279633102d7fce2511841443a5d4` (required `285dedf4` prefix OK).
- Verification worktree: `/tmp/pyrus-land-verify`.
- `pnpm install --frozen-lockfile`: OK from prior run.
- Required when lib packages changed: `pnpm run typecheck:libs` in the verification worktree before artifact typechecks.

## Commit 1

- SHA: `dcf7f449`
- Message: `fix(api): serve snaptrade history from stored backfill`
- Verification: `pnpm --filter @workspace/api-server run typecheck` OK at `dcf7f449`.

## Commit 2

- SHA: `880f0930`
- Message: `fix(api): preserve launch entitlement claims`
- Verification: `pnpm --filter @workspace/api-server run typecheck` OK at `880f0930`.

## Commit 3

- SHA: `b2fc05f2`
- Message: `feat(web): gate platform behind auth session`
- Verification: `pnpm --filter @workspace/pyrus run typecheck` OK at `b2fc05f2`.

## Commit 4

- Final SHA: `9b621077`
- Message: `chore(api): retire legacy ibkr bridge surfaces`
- Amended per A6/A7 from blocked `e244be51`.
- Additional A6 hunk staged:
  - `artifacts/api-server/src/services/backend-settings.ts`: removed only deleted `ibkr-lanes` import/usage (`getIbkrLaneArchitectureSummary`, promise slot, `laneSummary`, and `ibkrLaneCount`).
- Additional A2 shim hunks staged:
  - `artifacts/api-server/src/services/bridge-streams.ts`
  - `artifacts/api-server/src/services/ibkr-account-bridge.ts`
  - `artifacts/api-server/src/services/ibkr-live-demand-coordinator.ts`
  - `artifacts/api-server/src/services/option-quote-demand-coordinator.ts`
  - `artifacts/api-server/src/services/order-read-suppression.ts`
- Verification: `pnpm --filter @workspace/api-server run typecheck` OK at `9b621077`.

## Commit 5

- Final SHA: `62045a84`
- Message: `feat(broker): manage tradable account inclusion`
- Scope:
  - Task #3 account category/inclusion services, route, tests, migration, DB broker schema columns.
  - OpenAPI/generated client snapshot staged whole, including generated tax client/spec artifacts per plan.
  - UI account inclusion picker and algo account tabs.
- Held:
  - Tax route/service/schema implementation hunks.
  - Auth dedupe hunks reserved for commit 9.
  - `TradeOrderTicket.jsx`.
- Verification:
  - `pnpm run typecheck:libs` OK at `62045a84`.
  - `pnpm --filter @workspace/api-server run typecheck` OK at `62045a84`.
  - `pnpm --filter @workspace/pyrus run typecheck` OK at `62045a84`.

## Commit 6

- Final SHA: `639ed0e8`
- Message: `fix(api): guard option day change without prior close`
- Scope:
  - Option quote `change`/`changePercent` widened to nullable where needed.
  - Massive option quote conversion and payload emission now null day-change values when `prevClose` is absent.
  - Account option quote display model and tests updated.
- Held:
  - Tax preflight fields in `lib/ibkr-contracts/src/client.ts`.
- Verification:
  - `pnpm run typecheck:libs` OK at `639ed0e8`.
  - `pnpm --filter @workspace/api-server run typecheck` OK at `639ed0e8`.

## Commit 7

- SHA: `bca3d5de`
- Message: `fix(web): show broker marks in position totals`
- Verification: `pnpm --filter @workspace/pyrus run typecheck` OK at `bca3d5de`.

## Commit 8

- SHA: `a58f8e5e`
- Message: `fix(web): avoid phantom option mids`
- Verification: `pnpm --filter @workspace/pyrus run typecheck` OK at `a58f8e5e`.

## Commit 9

- SHA: `4feae5d4`
- Message: `refactor(web): share auth session query`
- Scope:
  - `HeaderSessionStatus.jsx`
  - `HeaderSnapTradeBrokerStatus.jsx`
  - `AlgoScreen.jsx`
  - `SnapTradeConnectPanel.jsx`
- Held:
  - `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx` per instruction.
- Verification: `pnpm --filter @workspace/pyrus run typecheck` OK at `4feae5d4`.

## Final Gate

Ran in `/tmp/pyrus-land-verify` at `4feae5d45340d85d9978979a00f92b41f2787b30`:

- `pnpm --filter @workspace/api-server run typecheck`: OK.
- `pnpm --filter @workspace/pyrus run typecheck`: OK.
- `pnpm --filter @workspace/api-server run build`: OK (`dist/index.mjs` bundled, 711 modules).

## Index State

- `git diff --cached --name-only`: empty.

## Reconciliation

Observed remaining dirty set is unstaged HOLD/A8 work, not landing index drift:

- Tax lane remains dirty/untracked: `artifacts/api-server/src/routes/tax.ts`, tax planning services/tests, tax DB schema/migration, tax UI panels, tax hunks in broker execution/platform/order files, and generated tax exposure already intentionally included only as part of commit 5 generated snapshot.
- A8 sibling WIP remains dirty: `artifacts/api-server/src/services/algo-cockpit-streams.ts`, `.test.ts`; `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`; additional `signal-monitor.ts` and related signal/pressure files.
- Auth dedupe hold remains dirty in `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx`.
- A4/manifest holds remain dirty: settings/mobile/footer pressure and signal/pressure/neural/brand/Replit/session/documentation churn.
- `.codex-watch/` contains this updated execution report plus other expected report artifacts.

## Worktree Cleanup

- `/tmp/pyrus-land-verify` intentionally kept at final SHA for leader inspection.
