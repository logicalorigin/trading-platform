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
- Session handoffs: kept `SESSION_HANDOFF_MASTER.md` plus May 1-May 6 canonical handoffs. Removed April/legacy handoffs and stale live notes from the repo root.
- Generated API clients/types: kept. They are owned by `lib/api-spec/openapi.yaml` and Orval codegen.
- `artifacts/ibgateway-bridge-windows-current.tar.gz`: externalized. The API route still serves a local copy when present, but otherwise redirects to `IBKR_BRIDGE_BUNDLE_URL` or `RAYALGO_IBKR_BRIDGE_BUNDLE_URL`. The removed tracked bundle was 1,542,958 bytes with SHA-256 `29a82d80c27f476c462f0d8de11d54084e5eaa851bbf47b8f734b752d8698a91`.
- Pine script data under `artifacts/api-server/data/**`: kept. It is loaded by the Pine script service at runtime.
- Chart hydration cleanup: preserved a recovered low-risk lifecycle fix that clears chart hydration scope state on unmount, plus a unit test and richer memory-soak diagnostics.
- Unit test commands: replaced long inline package scripts with package-local `scripts/runUnitTests.mjs` manifests that preserve the same test files.
- RayAlgo dev-port wrapper: removed `artifacts/rayalgo/scripts/reapDevPort.mjs`; it only imported the root `scripts/reap-dev-port.mjs`, and the package script already calls the root helper directly.
- Retained May handoffs: left in place as historical recovery notes. Some may reference older handoff files removed from the repo root; current recovery should start from `SESSION_HANDOFF_MASTER.md` plus the retained May handoffs.
- Oversized live modules: inventoried but not refactored in this cleanup pass. The largest retained source files are active research/charting/platform modules and generated API clients.

## Validation Notes

- Passed: `pnpm run deadcode`, `pnpm run deadcode:prod`, `pnpm run typecheck`.
- Passed: `pnpm --filter @workspace/api-server run test:unit` (305 tests) and `pnpm --filter @workspace/rayalgo run test:unit` (404 tests).
- Passed: API server build, RayAlgo production build with `PORT=18747 BASE_PATH=/`, and Playwright test discovery.
- Known browser gate failure: `pnpm --filter @workspace/rayalgo run test:e2e:replit` launched Chromium but failed existing Flow/Market/Trade UI specs. A focused rerun of `e2e/flow-layout.spec.ts:478` and `e2e/market-premium-flow.spec.ts:228` still failed after rejecting the unrelated queue-refresh work, so those failures were not kept in this cleanup diff.

## Follow-Up Candidates

- Publish or document the canonical external Windows bridge bundle location, then set `IBKR_BRIDGE_BUNDLE_URL` in deployed API environments.
- If old handoff bodies are still wanted outside Git history, move them to an external archive rather than restoring them to the repo root.
- Move oversized live modules toward narrower service/component boundaries only with feature-specific tests and a separate refactor plan.
