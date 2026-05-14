# App-Wide Regression Audit Findings - 2026-05-13

**Audit type**: regression audit against the current dirty worktree.  
**Baseline**: `AUDIT_FINDINGS_2026-05-12.md`.  
**Scope**: whole workspace, with static/unit/build validation only. No browser bring-up.  
**Write scope**: this report only. No app source repairs were made by this audit.

## Executive Summary

The cleanup and guardrail work since the May 12 audit materially improved the repo:

- API route/spec drift is resolved: 142 implemented route-method pairs and 142 OpenAPI route-method pairs, with zero missing server paths and zero orphan spec paths.
- Env documentation, markdown path checks, and API codegen drift now have root audit scripts, and `pnpm run audit:guards` passes.
- Workspace/package drift from the previous audit is resolved: the stale `lib/integrations/*` workspace glob is gone, shared dependency versions are cataloged, and `knip` reports clean.
- Full typecheck, build, deadcode, RayAlgo unit tests, and an API unit rerun all pass.

Two important findings remain:

1. **HIGH - Flow scanner stops/clears the frontend broad-flow runtime when the browser page is hidden.** This matches the user's observation that flow scanning turns off when the page is not being viewed. Active app screen changes are not the problem; hidden browser-tab/page visibility is.
2. **MED - Database runtime selection is over-configured.** The environment currently has `DATABASE_URL`, `LOCAL_DATABASE_URL`, and `RAYALGO_DATABASE_SOURCE` all set. Runtime resolution selects `LOCAL_DATABASE_URL` and marks `overrideActive: true`; the desired model is one secret, `DATABASE_URL`, containing the local Postgres URL.

## Validation Results

| Command | Result | Notes |
|---|---:|---|
| `pnpm run audit:guards` | pass | Env inventory, markdown paths, and API codegen drift passed. Codegen output is current. |
| `pnpm run typecheck` | pass | Libs, artifacts, and scripts typechecked. |
| `pnpm run deadcode` | pass | No knip findings in files/dependencies/catalog pass. |
| `pnpm run deadcode:prod` | pass | No production knip findings in files/exports/types/duplicates pass. |
| `pnpm --filter @workspace/rayalgo run test:unit` | pass | 676/676 passed. |
| `pnpm --filter @workspace/api-server run test:unit` | pass on rerun | First full run had one transient diagnostics failure; targeted file and full rerun passed. |
| `pnpm run build` | pass | Typecheck plus all artifact builds passed. |

API unit detail: the first full run failed `diagnostics treat quiet market stream as healthy` with `true !== false` at `artifacts/api-server/src/services/diagnostics.test.ts:639`. Running `diagnostics.test.ts` alone passed 18/18, and rerunning the full API unit suite passed 461/461. Treat this as a watch item for diagnostics test isolation, not a blocking current failure.

## Findings

### HIGH - Flow scanner frontend runtime is hidden-page gated

Evidence:

- `artifacts/rayalgo/src/features/platform/appWorkScheduler.js` computes `broadFlowAllowed` from `visible && sessionReady`, so `streams.broadFlowRuntime` becomes false when `pageVisible` is false.
- `artifacts/rayalgo/src/features/platform/PlatformRuntimeLayer.jsx` passes `workSchedule.streams.broadFlowRuntime` into `BroadFlowScannerRuntime`.
- `artifacts/rayalgo/src/features/platform/MarketFlowRuntimeLayer.jsx` clears `BROAD_MARKET_FLOW_STORE_KEY` when `runtimeActive` is false.
- `artifacts/rayalgo/src/features/platform/appWorkScheduler.test.js` explicitly asserts `defers broad flow runtime while page is hidden`.
- `artifacts/rayalgo/src/features/platform/useLiveMarketFlow.js` also slows client-symbol scanner scheduling by 6x when `document.hidden`.

Conclusion: the scanner is already independent of the active app screen, but not independent of browser page visibility. If "not being viewed" means the Flow tab/screen is inactive, current scheduling is mostly correct. If it means the browser tab/page is hidden, the current behavior intentionally disables the frontend broad-flow runtime and clears the broad-flow store.

Expected repair:

- Decouple broad-flow scanner ownership from browser page visibility. The scanner should remain enabled after session metadata settles.
- Replace the hidden-page stop with a pressure-aware cadence policy if needed: memory/IBKR pressure may slow scanning, but should not clear scanner ownership or broad-flow snapshots.
- Update tests that currently assert hidden-page deferral so they assert always-on scanner behavior instead.
- Decide whether the `document.hidden ? 6 : 1` multiplier in `useLiveMarketFlow` should stay as a throttle or be removed for truly always-on flow.

### MED - Database URL configuration has conflicting sources

Evidence:

- Current process environment has all three set: `DATABASE_URL`, `LOCAL_DATABASE_URL`, and `RAYALGO_DATABASE_SOURCE`.
- Runtime selection resolves to:
  - `sourceEnv: "LOCAL_DATABASE_URL"`
  - `source: "workspace-local-postgres"`
  - `overrideActive: true`
  - host: `/home/runner/workspace/.local/postgres/run`
  - database: `dev`
- `.replit` currently sets `[userenv.development] RAYALGO_DATABASE_SOURCE = "local"` and `LOCAL_DATABASE_URL = "postgres:///dev?host=/home/runner/workspace/.local/postgres/run&user=runner"`.
- `lib/db/src/runtime.ts`, `scripts/wait-for-local-postgres.sh`, and `artifacts/rayalgo/scripts/checkDevRuntime.mjs` all implement the legacy two-variable local override path.
- `.env.example` documents all three, which keeps `audit:env` green but preserves the drift.

Conclusion: the effective database is the local Postgres URL the user wants, but it is selected through the legacy `LOCAL_DATABASE_URL` plus `RAYALGO_DATABASE_SOURCE` override. The desired configuration is one variable: `DATABASE_URL=<that same local Postgres URL>`.

Expected repair:

- Set `DATABASE_URL` to the current workspace-local Postgres URL.
- Remove `LOCAL_DATABASE_URL` and `RAYALGO_DATABASE_SOURCE` from Replit Secrets/user env once `DATABASE_URL` is confirmed.
- Refactor repo code/docs to make `DATABASE_URL` canonical and remove the local override selector path.
- Be careful with `.replit`: editing `[userenv.*]` can reload the workspace and kill the local Postgres sidecar. Use Replit env/secrets tooling where possible.

### MED - Shadow-equity forward worker remains audit-only and not production-started

Evidence:

- `artifacts/api-server/src/services/shadow-equity-forward-worker.ts` exports `createShadowEquityForwardWorker` and `startShadowEquityForwardWorker`.
- The only current callers found are its unit test and internal references. There is no startup call from `artifacts/api-server/src/index.ts` or route wiring.
- API unit tests include `src/services/shadow-equity-forward-worker.test.ts`, so this is tested but not live.

Status: unchanged from the prior audit, except the files now typecheck and unit-test cleanly. Per user direction, this remains inspect/report only.

### LOW - Type-safety escape hatches remain mostly in tests

Current count: 243 matches for `@ts-*`, `as any`, `as unknown as`, and `: any`.

The largest clusters are test fixtures:

- `artifacts/api-server/src/services/option-chain-batch.test.ts`: 56
- `artifacts/rayalgo/src/features/platform/live-streams.test.ts`: 46
- `artifacts/api-server/src/services/options-flow-scanner.test.ts`: 31
- `artifacts/ibkr-bridge/src/tws-provider.test.ts`: 22

Production-side hits are now sparse, mainly boundary casts in runtime config/diagnostics/preferences/live-stream helpers. This is no longer the production hotspot it was in the May 12 audit.

### LOW - Local ignored artifacts remain on disk

Tracked artifacts are clean. Existing local logs and the IBKR bridge archive remain under `artifacts/`, but `.gitignore` now covers `artifacts/*.log` and `artifacts/ibgateway-bridge-windows-current.tar.gz`, so `git add -A` should not pick them up.

## Resolved Since May 12

- API route/spec drift: resolved. Manual comparison found 142 implemented route-method pairs and 142 spec route-method pairs, with no drift in either direction.
- Env documentation: resolved as a guardrail. `.env.example` now documents all referenced env vars, though the database variables need follow-up cleanup.
- Maintained-doc path checks: resolved. `pnpm run audit:markdown-paths` passes.
- API codegen drift: resolved. `pnpm run audit:api-codegen` passes after regenerating and hashing generated outputs.
- Workspace glob drift: resolved. `pnpm-workspace.yaml` no longer declares missing `lib/integrations/*`.
- Dependency catalog drift: improved. Previously noted shared dependencies are now in the root catalog.
- Unused-file/deadcode findings: resolved or explicitly ignored. Both knip passes are clean.
- Committable log/archive risk: resolved by `.gitignore` coverage.

## Notes And Non-Findings

- Active screen changes do not appear to disable broad flow scanning. The scheduler enables `broadFlowRuntime` across screens after session metadata settles. The disabling path is browser page visibility.
- The backend API options-flow scanner is server-side and starts from API service code; it is not directly tied to the active frontend page. The observed "turns off" behavior is explained by the frontend broad-flow runtime owner and snapshot clearing.
- The API diagnostics quiet-market test had one failing full-suite run, then passed in targeted and full-suite reruns. Keep an eye on test isolation, but do not treat the current worktree as failing validation.
- No repo-defined `.replit` runner or workflow was added. Validation used direct `pnpm` commands only, per `AGENTS.md`.
