# Repo Cleanup Inventory - 2026-05-06

This inventory records the evidence used for the May 6 cleanup pass.

## Baseline

- Working tree started clean at `3382353 Recover May 6 worktree changes`.
- `pnpm run deadcode:prod` passed with no findings.
- `pnpm run deadcode` initially reported only root `@emnapi/core` and `@emnapi/runtime`.
- Tracked files were dominated by `artifacts/`, `lib/`, session handoffs, generated API clients, a Windows bridge bundle, vendored GLib files, and pasted attachments.

## Cleanup Decisions

- Root `@emnapi/core` and `@emnapi/runtime`: removed. After removal, `pnpm run deadcode` passed.
- Unlisted tests: preserved and wired into package `test:unit` scripts after focused runs passed. They cover active account, IBKR, market-session, and flow-filter code.
- `attached_assets/**`: removed from Git and ignored. No source imports referenced the `@assets` Vite alias; the alias was removed.
- `.vendor/ubuntu-glib/**`: removed from Git and ignored. No runtime or build code referenced it; it was local environment/debug payload.
- Session handoffs: kept `SESSION_HANDOFF_MASTER.md` plus current May 6 recovery handoffs. Removed April/legacy handoffs, stale live notes, and May 1-May 5 handoff bodies from the repo root; Git history is the archive for older bodies.
- Generated API clients/types: kept. They are owned by `lib/api-spec/openapi.yaml` and Orval codegen.
- `artifacts/ibgateway-bridge-windows-current.tar.gz`: externalized. The API route still serves a local copy when present, but otherwise redirects to `IBKR_BRIDGE_BUNDLE_URL` or `RAYALGO_IBKR_BRIDGE_BUNDLE_URL`. The removed tracked bundle was 1,542,958 bytes with SHA-256 `29a82d80c27f476c462f0d8de11d54084e5eaa851bbf47b8f734b752d8698a91`.
- Pine script data under `artifacts/api-server/data/**`: kept. It is loaded by the Pine script service at runtime.
- Chart hydration cleanup: preserved a recovered low-risk lifecycle fix that clears chart hydration scope state on unmount, plus a unit test and richer memory-soak diagnostics.
- Unit test commands: replaced long inline package scripts with package-local `scripts/runUnitTests.mjs` manifests that preserve the same test files.
- RayAlgo dev-port wrapper: removed `artifacts/rayalgo/scripts/reapDevPort.mjs`; it only imported the root `scripts/reap-dev-port.mjs`, and the package script already calls the root helper directly.
- Retained May handoffs: kept only May 6 recovery notes. Some may reference older handoff files removed from the repo root; current recovery should start from `SESSION_HANDOFF_MASTER.md` plus the retained May 6 handoffs.
- Oversized live modules: inventoried but not refactored in this cleanup pass. The largest retained source files are active research/charting/platform modules and generated API clients.
- Flow snapshot queue refresh control: preserved and committed before deeper cleanup. `GET /flow/events` supports `queueRefresh=false` so nonblocking broad scanner reads can avoid enqueueing deep scans.

## Current Protected WIP Boundary

The following dirty or untracked work is protected WIP, not cleanup debt. Do not delete, stage, or refactor these files as part of repo cleanup unless that specific feature workstream is being completed:

- Polygon premium-distribution API/spec/client work: `lib/api-spec/openapi.yaml`, `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`, `artifacts/api-server/src/providers/polygon/market-data.ts`, `artifacts/api-server/src/providers/polygon/market-data.test.ts`, `artifacts/api-server/src/routes/platform.ts`, and `artifacts/api-server/src/services/platform.ts`.
- Premium/order-intent work: `artifacts/api-server/src/services/option-order-intent.ts` and `lib/ibkr-contracts/src/client.ts`.
- Chart/flow recovered WIP: `artifacts/rayalgo/src/features/charting/ResearchChartDashboardStrip.ts`, `artifacts/rayalgo/src/features/flow/flowTapeColumns.js`, and `artifacts/rayalgo/src/features/flow/flowTapeColumns.test.js`.
- Flow scanner/platform recovery work currently in the tree, including `artifacts/rayalgo/src/screens/FlowScreen.jsx`, should remain isolated from chart cleanup commits.

Mini-chart premium flow currently comes from broad scanner flow events. The Polygon premium-distribution endpoint/client work above is a separate in-flight backend surface and should not be wired into mini charts without an explicit product decision.

## Chart Ownership Boundary

The active broker-facing chart surface is intentionally shared:

- Market mini charts: `MiniChartCell` -> `TradeEquityPanel` -> `ResearchChartFrame` -> `ResearchChartSurface`.
- Trade spot charts: `TradeEquityPanel` -> `ResearchChartFrame` -> `ResearchChartSurface`.
- Trade option charts, Flow contract inspection option charts, and Backtesting spot/options charts use `ResearchChartFrame`.

These wrappers are not dead code. A React chart cleanup pass must not remove `ResearchChartSurface` or `ResearchChartFrame` wrappers unless all consumers are replaced in one coordinated pass with equivalent behavior and tests.

The remaining chart-like surfaces are intentional separate surfaces:

- `PhotonicsObservatory` uses Recharts/D3 for the authored research workspace.
- `ChartParityLab` keeps `TradingViewWidgetReference` as a parity reference and still renders local comparison charts through `ResearchChartFrame`.

## Current Validation Boundary

While the protected WIP above remains in the tree, full repo checks that traverse untracked WIP are diagnostic only, not cleanup gates. Use targeted validation for the cleanup scope plus `pnpm --filter @workspace/rayalgo run typecheck` for frontend-only chart cleanup commits.

Current diagnostic status for this boundary pass:

- `pnpm --filter @workspace/rayalgo run typecheck`: passed.
- `pnpm --filter @workspace/api-server run typecheck`: passed.
- `pnpm run deadcode`: fails on protected WIP file `artifacts/rayalgo/src/features/charting/ResearchChartDashboardStrip.ts`.

Do not claim full repo health until that WIP is completed, removed, or intentionally excluded from the relevant checks.

## Validation Notes

- Passed: `pnpm run deadcode`, `pnpm run deadcode:prod`, `pnpm run typecheck`.
- Passed: `pnpm --filter @workspace/api-server run test:unit` (305 tests) and `pnpm --filter @workspace/rayalgo run test:unit` (404 tests).
- Passed: API server build, RayAlgo production build with `PORT=18747 BASE_PATH=/`, and Playwright test discovery.
- Known browser gate failure: `pnpm --filter @workspace/rayalgo run test:e2e:replit` launched Chromium but failed existing Flow/Market/Trade UI specs. A focused rerun of `e2e/flow-layout.spec.ts:478` and `e2e/market-premium-flow.spec.ts:228` still failed after rejecting the unrelated queue-refresh work, so those failures were not kept in this cleanup diff.

## Follow-Up Candidates

- Publish or document the canonical external Windows bridge bundle location, then set `IBKR_BRIDGE_BUNDLE_URL` in deployed API environments.
- If old handoff bodies are still wanted outside Git history, move them to an external archive rather than restoring them to the repo root.
- Move oversized live modules toward narrower service/component boundaries only with feature-specific tests and a separate refactor plan.
