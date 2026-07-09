# landing2 execution report - 2026-07-07

Executor: `codex-worker` for `claude-lead`

## Start

- Manifest: `.codex-watch/landing2-manifest-2026-07-07.md`
- Manifest base observed first: `cd1e3eb2004aaa243a7e1a847ef3f01bf558b3aa`
- Base drift before staging: sibling commit `65e9b71babfd6256001a9773366c5c3ce0def449` landed `lib/db/src/index.ts` and `lib/db/src/testing.ts`.
- Deviation: continued from `65e9b71b` because the A2 lib/db test seam is now already in HEAD and no longer dirty; it was not staged in any landing commit.
- Verification worktree: `/tmp/pyrus-land2-verify`
- Initial verification install: `pnpm install --frozen-lockfile` passed.
- Verification prep deviation: first package typecheck hit missing `lib/*/dist` declaration outputs in the isolated worktree; ran `pnpm run typecheck:libs` once, then reran package typecheck.

## Commits

### 1. `fix(signals): breadth history from exact snapshots`

- SHA: `0e6aa6c0c1bbd99130a425d71b32f9843293417e`
- Files:
  - `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`
  - `artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts`
  - `artifacts/api-server/src/services/signal-monitor.ts`
  - `artifacts/pyrus/.replit-artifact/artifact.toml`
- Cached hunk count: 15 initial; amend repair staged 12 correction hunks after zero-context intra-file offset misplacement.
- Pre-commit checks: `git diff --cached --name-status` matched commit 1 manifest paths; `git diff --cached --check` passed.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout 0e6aa6c0`
  - `pnpm --filter @workspace/api-server run typecheck` passed after one-time `pnpm run typecheck:libs`.
- Deviations:
  - Initial commit 1 SHA `337b7aed` failed api-server typecheck due misplaced adjacent zero-context hunks in `signal-monitor.ts`; amended to `0e6aa6c0` using index-only repair patch from the correct working-tree content.

### 2. `fix(signals): decouple display freshness from automation trigger freshness`

- SHA: `3e6e000b532e1d94a1af3bc74f3a83cdcd8779c6`
- Files:
  - `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts`
  - `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - `artifacts/api-server/src/services/signal-monitor.ts`
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx`
- Cached hunk count: 22 initial; amend repair staged 2 helper-cast hunks.
- Pre-commit checks: `git diff --cached --name-status` matched commit 2 manifest paths; `git diff --cached --check` passed; cached stream diff did not include `withTestDb`, `drizzle-orm`, or server-owned producer tests.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout 3e6e000b`
  - `pnpm --filter @workspace/api-server run typecheck` passed.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
- Deviations:
  - Initial commit 2 SHA `6b22b853` failed api-server typecheck because two manifest-owned helper return edits in `signal-monitor-stream.test.ts` were missing; amended to `3e6e000b` with only those helper casts.

### 3. `perf(signals): bypass UI-delta work for server-owned matrix producer`

- SHA: `795ce87c8bcb6199c11f804cecfe28ad4df9c9c9`
- Files:
  - `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - `artifacts/api-server/src/services/signal-monitor.ts`
- Cached hunk count: 9.
- Pre-commit checks: `git diff --cached --name-status` matched commit 3 manifest paths; `git diff --cached --check` passed.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout 795ce87c`
  - `pnpm --filter @workspace/api-server run typecheck` passed.
- Deviations: none.

### 4. `perf(api): cache + SQL-bucket breadth hydration`

- SHA: `f2b8286f0f1599ac6ff1de9fe5f6522b05b71a7f`
- Files:
  - `artifacts/api-server/src/routes/signal-monitor-route-cache.test.ts`
  - `artifacts/api-server/src/routes/signal-monitor.ts`
  - `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`
  - `artifacts/api-server/src/services/signal-monitor.ts`
- Cached hunk count: 6.
- Pre-commit checks: `git diff --cached --name-status` matched commit 4 manifest paths; `git diff --cached --check` passed; cached `signal-monitor.ts` did not include events-list cache HOLD symbols.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout f2b8286f`
  - `pnpm --filter @workspace/api-server run typecheck` passed.
- Deviations: none.

### 5. `fix(web): algo screen no longer flashes stale-then-empty control panel`

- SHA: `e294a877cadc520872e32c95c84869b768479dd8`
- Files:
  - `artifacts/pyrus/src/screens/AlgoScreen.test.mjs`
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`
- Cached hunk count: 4.
- Pre-commit checks: `git diff --cached --name-status` matched commit 5 manifest paths; `git diff --cached --check` passed.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout e294a877`
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
- Deviations: none.

### 6. `fix(web): honest Age column, idle-aware hydration strip, scope indicator`

- SHA: `3ccc38954873bcefd580f7cc158f716f921e1cf9`
- Files:
  - `artifacts/pyrus/src/features/signals/signalsMatrixHydration.js`
  - `artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.mjs`
  - `artifacts/pyrus/src/features/signals/signalsRowModel.js`
  - `artifacts/pyrus/src/features/signals/signalsRowModel.test.mjs`
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs`
- Cached hunk count: 21.
- Pre-commit checks: `git diff --cached --name-status` matched commit 6 manifest paths; `git diff --cached --check` passed; cached split files did not include commit 7 retry/fallback test symbols.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout 3ccc3895`
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
- Deviations: none.

### 7. `fix(web): STA table recovers from pressure shedding and stream drops`

- SHA: `7fcf8b508ad32688afbaecc8ea9ee371d27eb9b7`
- Files:
  - `artifacts/pyrus/src/app/AppContent.preloadContention.test.mjs`
  - `artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx`
  - `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
  - `artifacts/pyrus/src/features/platform/live-streams.test.mjs`
  - `artifacts/pyrus/src/features/platform/platformJsonRequest.js`
  - `artifacts/pyrus/src/features/platform/platformJsonRequest.test.mjs`
  - `artifacts/pyrus/src/features/platform/queryDefaults.js`
  - `artifacts/pyrus/src/features/platform/queryDefaults.test.mjs`
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs`
- Cached hunk count: 24.
- Pre-commit checks: `git diff --cached --name-status` matched commit 7 manifest paths; `git diff --cached --check` passed.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout 7fcf8b50`
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
- Deviations: none.

### 8. `feat(web): shadcn login-03 gate`

- SHA: `1d5e0b9dd7cd28e961f82266cf7f35840f0d1d84`
- Files:
  - `artifacts/pyrus/package.json`
  - `artifacts/pyrus/src/components/ui/button.tsx`
  - `artifacts/pyrus/src/components/ui/card.tsx`
  - `artifacts/pyrus/src/components/ui/field.tsx`
  - `artifacts/pyrus/src/components/ui/input.tsx`
  - `artifacts/pyrus/src/components/ui/label.tsx`
  - `artifacts/pyrus/src/components/ui/separator.tsx`
  - `artifacts/pyrus/src/features/auth/LoginGate.jsx`
  - `pnpm-lock.yaml`
- Cached hunk count: 91 initial; amend repair staged 1 lockfile hunk.
- Pre-commit checks: `git diff --cached --name-status` matched commit 8 manifest paths; `git diff --cached --check` passed; cached names did not include `LoginGate.d.ts`, `lib/db`, session handoff, or `.codex-watch` paths.
- Verification:
  - `git -C /tmp/pyrus-land2-verify checkout 1d5e0b9d`
  - `pnpm install --frozen-lockfile` passed after amend.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
- Deviations:
  - Initial commit 8 SHA `b831bf43` failed post-lockfile `pnpm install --frozen-lockfile` because whole-lockfile staging captured a concurrent sibling `artifacts/backtest-worker` dependency hunk without staging that package file. Regenerated lockfile in `/tmp/pyrus-land2-verify` against commit 8's actual package set and amended only `pnpm-lock.yaml` to remove the stale `@workspace/market-calendar` importer entry.

## Final Gate

Final SHA: `1d5e0b9dd7cd28e961f82266cf7f35840f0d1d84`

- `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `pnpm --filter @workspace/api-server run build` passed.
- `pnpm --filter @workspace/api-server exec tsx --test --test-reporter=spec --test-force-exit src/services/signal-monitor-breadth-history.test.ts src/routes/signal-monitor-route-cache.test.ts src/services/signal-monitor-stream.test.ts src/services/signal-monitor-reconcile-minimal-readset.test.ts` passed: 56 tests, 0 failed.
- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/queryDefaults.test.mjs src/features/platform/platformJsonRequest.test.mjs` passed: 9 tests, 0 failed.
- Workspace-required startup guard: `pnpm run audit:replit-startup` passed with `[check-replit-startup-guards] ok`.

## Final Reconciliation

- Index: `git diff --cached --name-status` returned empty.
- Verification worktree: `git -C /tmp/pyrus-land2-verify status --short` returned empty.
- Last 8 commits, oldest to newest:
  1. `0e6aa6c0 fix(signals): breadth history from exact snapshots`
  2. `3e6e000b fix(signals): decouple display freshness from automation trigger freshness`
  3. `795ce87c perf(signals): bypass UI-delta work for server-owned matrix producer`
  4. `f2b8286f perf(api): cache + SQL-bucket breadth hydration`
  5. `e294a877 fix(web): algo screen no longer flashes stale-then-empty control panel`
  6. `3ccc3895 fix(web): honest Age column, idle-aware hydration strip, scope indicator`
  7. `7fcf8b50 fix(web): STA table recovers from pressure shedding and stream drops`
  8. `1d5e0b9d feat(web): shadcn login-03 gate`
- Commit trailers: all 8 commits contain exactly `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- A2/lib-db seam: not staged in landing commits; it landed before staging as sibling base commit `65e9b71b`, and `lib/db/src/index.ts` plus `lib/db/src/testing.ts` are no longer dirty.
- Manifest HOLD/churn left unstaged includes session handoffs, `.codex-watch*`, `.codex-watch-live*`, signal-monitor events-cache residue, signal-options WIP, late UI polish files, `OperationsSignalTable.test.mjs`, and `docs/reviews`.
- Additional sibling churn appeared during execution and remains unstaged: `artifacts/api-server/src/routes/backtesting.ts`, `artifacts/api-server/src/services/backtesting.ts`, `artifacts/backtest-worker/*`, `artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts`, `lib/db` overnight expectancy schema/migration files, `lib/pyrus-signals-core/*`, and `pnpm-lock.yaml`.
