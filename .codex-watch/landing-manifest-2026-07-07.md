# PYRUS landing manifest - 2026-07-07

Mapper: `codex-worker` for `claude-lead` / Claude session `68e08ab5`.
Repo HEAD observed: `285dedf4`.

Scope: read-only mapping of dirty tree for landing authorized ready slices. This file is the only repo write made by this worker.

## Reconciliation basis

- Observed with `git status --porcelain=v1`: 236 porcelain rows before this manifest write; porcelain collapses untracked directories.
- Expanded path set from `(git diff --name-only; git ls-files --others --exclude-standard)`: 264 paths before this manifest write.
- After this file is written, expanded dirty path set should be 265 paths, with `.codex-watch/landing-manifest-2026-07-07.md` classified HOLD/operational.
- Completeness target below: commit paths + HOLD paths + UNKNOWN paths = the expanded dirty path set.

## Anchor evidence

- P&L missing-file anchor: `git show HEAD:artifacts/api-server/src/routes/broker-execution.ts | rg snaptrade-history-scheduler` shows committed HEAD already imports `../services/snaptrade-history-scheduler` and calls both `refreshSnapTradeAccountHistoryForUser` and `refreshSnapTradeAccountHistoryOnRead`. The imported file is untracked, so clean HEAD cannot build until the P&L slice adds it.
- Additional P&L startup hunk is currently dirty in `artifacts/api-server/src/index.ts`: add `startSnapTradeHistoryRefreshScheduler` import and scheduler registration.
- `routes/index.ts` is mixed: IBKR settings guard removal is #4; tax import/user-path/router mount is TAX HOLD.
- `broker-execution.test.ts` is mixed: Task #3 included-account tests plus tax preflight test/imports. No Slice-7 hunk was found in the current diff for this file despite stale handoff language.

## Proposed commit order

1. `fix(api): serve snaptrade history from stored backfill`
2. `fix(api): preserve launch entitlement claims`
3. `feat(web): gate platform behind auth session`
4. `chore(api): retire legacy ibkr bridge surfaces`
5. `feat(broker): categorize and include trading accounts`

The order is adjusted only by facts above: P&L must land first because committed HEAD imports an untracked file. Slice-7 and Slice-8 are independent after P&L. IBKR retirement should precede Task #3 if leader wants removed settings/openapi surfaces gone before generated clients land. Task #3 lands generated clients whole by recommendation below.

## Commit 1 - P&L slice

Message: `fix(api): serve snaptrade history from stored backfill`

Stage plan:

- NEW/WHOLE: `artifacts/api-server/src/services/snaptrade-history-scheduler.ts`
  - Evidence: new proactive scheduler, connect-time refresh, read-time throttled refresh; untracked file imported by committed `routes/broker-execution.ts`.
- HUNKS: `artifacts/api-server/src/index.ts`
  - Stage only:
    - `@@ -38,0 +39 @@` add `startSnapTradeHistoryRefreshScheduler` import.
    - `@@ -319,0 +319 @@` add `startSnapTradeHistoryRefreshScheduler` to scheduler startup list.
  - Do not stage:
    - `@@ -47 +47,0 @@` remove `ensureIbkrLaneRuntimeOverridesLoaded` import (#4).
    - `@@ -275 +274,0 @@` remove `ensureIbkrLaneRuntimeOverridesLoaded()` (#4).
- HUNKS: `artifacts/api-server/src/services/snaptrade-account-history.ts`
  - Stage all observed hunks:
    - `@@ -1084,0 +1085,21 @@` add `readStoredBalanceSnapshots`.
    - `@@ -1171,3 +1192,26 @@` split live ingest into exported `ingestSnapTradeAccountHistory`.
    - `@@ -1222,5 +1266,27 @@` return ingest result then reintroduce stored-first `getSnapTradeAccountHistory`.
    - `@@ -1238 +1304 @@`, `@@ -1249,0 +1316 @@`, `@@ -1273,3 +1340,3 @@`, `@@ -1278,4 +1345,4 @@` use stored balance/activity counts in response metadata.
- HUNKS: `artifacts/api-server/src/services/snaptrade-account-history.test.ts`
  - Stage all observed hunks:
    - `@@ -13 +13,4 @@` import `ingestSnapTradeAccountHistory`.
    - `@@ -181 +184,2 @@`, `@@ -200,0 +205,13 @@`, `@@ -256 +273,2 @@`, `@@ -266,0 +285,8 @@`, `@@ -271 +297,4 @@` prove ingest path and stored-first read path.

Deterministic staging recommendation: extract the exact hunks above with `git diff --unified=0 -- <files>` into a temporary patch outside the repo, then `git apply --cached --unidiff-zero <patch>`. Add the new scheduler with `git add artifacts/api-server/src/services/snaptrade-history-scheduler.ts`.

Intermediate coherence: this unbreaks clean HEAD by adding the file already imported by committed `routes/broker-execution.ts`. It should not include unrelated #4 `index.ts` lane-runtime removals.

## Commit 2 - Slice-7 entitlements

Message: `fix(api): preserve launch entitlement claims`

Stage plan:

- WHOLE: `artifacts/api-server/src/services/entitlements.ts`
  - Evidence: removes dead `KNOWN_ENTITLEMENTS`, adds `resolveLaunchEntitlements` with explicit-array vs absent-claim behavior.
- WHOLE: `artifacts/api-server/src/services/entitlements.test.ts`
  - Evidence: tests explicit empty array, absent claim plan default, stored-plan relaunch default.
- WHOLE: `artifacts/api-server/src/services/auth-launch.ts`
  - Evidence: `provisionLaunchUser` accepts raw `entitlementsClaim` and resolves with stored plan context.

Do not stage `artifacts/api-server/src/routes/broker-execution.test.ts` for Slice-7 in the current tree. Observed diff hunks are Task #3 included-account tests and TAX preflight hunks, not the stale handoff's admin-only regression.

Intermediate coherence: API-only; independent after P&L.

## Commit 3 - Slice-8 login gate

Message: `feat(web): gate platform behind auth session`

Stage plan:

- NEW/WHOLE:
  - `artifacts/pyrus/src/features/auth/LoginGate.d.ts`
  - `artifacts/pyrus/src/features/auth/LoginGate.jsx`
  - `artifacts/pyrus/src/features/auth/authSession.d.ts`
  - `artifacts/pyrus/src/features/auth/authSession.jsx`
- HUNKS: `artifacts/pyrus/src/app/AppProviders.tsx`
  - Stage `@@ -4,0 +5 @@` import `AuthProvider`.
  - Stage `@@ -80 +81 @@` wrap children in `<AuthProvider>`.
- HUNKS: `artifacts/pyrus/src/app/AppContent.tsx`
  - Stage `@@ -6,0 +7 @@` import `LoginGate`.
  - Stage `@@ -461 +462,9 @@` gate preloaded fast path except lab modes.
  - Stage `@@ -469 +478,3 @@` gate normal `<PlatformApp />`.
  - Do not stage `LogoLoader` -> `NeuralLoader` hunks (`@@ -4 +4 @@`, `@@ -486 +497 @@`) because those are neural/brand HOLD.

Optional/PROPOSED-EXTRA backlog #7 (auth dedupe) - do not fold into Slice-8 without leader approval:

- `artifacts/pyrus/src/features/platform/HeaderSessionStatus.jsx` WHOLE/HUNKS replaces local auth query with `useAuthSession`.
- `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx` WHOLE/HUNKS replaces local auth query with `useAuthSession`.
- `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx` is mixed auth-dedupe plus TAX; hold as TAX unless separately split.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx` is mixed auth-dedupe plus Task #3 algo account tabs; hunk-split if leader approves #7.
- `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx` is mixed auth-dedupe plus Task #3 picker; hunk-split as noted in Commit 5.

Intermediate coherence: login gate compiles only with the four new auth files and the provider/content hunks. Neural loader hunks are explicitly held.

## Commit 4 - IBKR bridge retirement (#4)

Message: `chore(api): retire legacy ibkr bridge surfaces`

Stage plan:

- DELETE/WHOLE:
  - `artifacts/api-server/src/providers/ibkr/bridge-client.ts`
  - `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
  - `artifacts/api-server/src/services/ibkr-historical-admission.ts`
  - `artifacts/api-server/src/services/ibkr-lane-policy.ts`
  - `artifacts/api-server/src/services/ibkr-lanes.ts`
  - `artifacts/api-server/src/services/ibkr-line-usage.ts`
  - `artifacts/api-server/src/services/ibkr-perf-capture.test.ts`
  - `artifacts/api-server/src/services/ibkr-perf-capture.ts`
  - `artifacts/api-server/src/services/platform-bars-bridge-health.test.ts`
  - `artifacts/api-server/src/services/platform-bridge-health.test.ts`
  - `artifacts/api-server/src/services/platform-bridge-health.ts`

- HUNKS: `artifacts/api-server/src/index.ts`
  - Stage `@@ -47 +47,0 @@` remove `ensureIbkrLaneRuntimeOverridesLoaded` import.
  - Stage `@@ -275 +274,0 @@` remove runtime override loader call.
  - Do not stage P&L scheduler hunks if Commit 1 was not already landed.
- HUNKS: `artifacts/api-server/src/routes/diagnostics.ts`
  - Stage `@@ -27 +26,0 @@` remove `recordLatestClientPerfMetrics` import.
  - Stage `@@ -271,3 +269,0 @@` stop forwarding client metrics to IBKR perf capture.
- HUNKS: `artifacts/api-server/src/routes/index.ts`
  - Stage only `@@ -40 +41 @@` change admin guard from `/settings/(backend|ibkr-lanes|ibkr-line-usage)` to `/settings/backend`.
  - Hold tax hunks `@@ -21,0 +22 @@`, `@@ -64,0 +66,2 @@`, `@@ -103,0 +107 @@`.
- HUNKS: `artifacts/api-server/src/routes/platform.ts`
  - Stage `@@ -174,35 +173,0 @@` remove bridge runtime/connection audit/perf imports.
  - Stage `@@ -1784,210 +1748,0 @@` remove `/diagnostics/ibkr-perf`, `/ibkr/bridge/*`, `/ibkr/desktops`, `/ibkr/activation/*`, `/ibkr/remote-*`, `/ibkr/connection-audit` routes.
  - Hold `@@ -2381,0 +2137,9 @@` tax preflight fields in `/orders/submit`.
- HUNKS: `artifacts/api-server/src/routes/settings.ts`
  - Stage all observed hunks that remove IBKR lanes/line usage route surface:
    - `@@ -1,2 +1 @@` remove `once`, `Request`, `Response` only if no remaining code needs them after hunk split.
    - `@@ -8,5 +6,0 @@` remove `ibkr-lanes` and `ibkr-line-usage` imports.
    - `@@ -19,16 +12,0 @@` remove line-usage route cache state.
    - `@@ -157,243 +134,0 @@` remove compact line-usage formatter/cache helpers.
    - Stage subsequent route deletion hunks for `/settings/ibkr-lanes`, `/settings/ibkr-line-usage`, `/settings/ibkr-line-usage/stream` (not shown in truncated output but present in this file's large diff).
- HUNKS: `artifacts/api-server/src/routes/platform.ts`, `artifacts/api-server/src/services/platform.ts`
  - Stage bridge-retirement stubs/removals from `services/platform.ts`:
    - `@@ -73 +73,0 @@` remove `IbkrBridgeClient`.
    - `@@ -153 +148,0 @@` remove `resolveIbkrLaneSymbols`.
    - `@@ -189,4 +183,0 @@` remove historical admission import.
    - `@@ -205,7 +195,0 @@` remove platform bridge health import.
    - `@@ -218 +201,0 @@` remove bridge-health test export.
    - `@@ -224,0 +208,123 @@` add retired bridge health/runtime local stubs.
    - `@@ -831,0 +938,34 @@`, `@@ -834 +974 @@`, `@@ -11924 +12127 @@`, `@@ -12493 +12696 @@` replace lane-symbol resolver with local `resolveMarketDataSymbols`.
    - `@@ -1139,23 +1279 @@` retire bridge prewarm reconciliation.
    - Type-only bridge-client replacement hunks at `@@ -5170 +5373 @@`, `@@ -10406 +10609 @@`, `@@ -10874 +11077 @@`, `@@ -10890 +11093 @@`.
  - Hold TAX hunks in this file: imports `assertTaxPreflightForOrderSubmission`, `TaxOrderLike`, `ibkrOrderToTaxOrder`, `PlaceOrderTaxPreflightFields`, `placeOrder`/`submitRawOrders` tax enforcement.
- HUNKS: `artifacts/pyrus/src/screens/SettingsScreen.jsx`
  - Stage IBKR settings removal only:
    - `@@ -23,3 +22,0 @@` remove `IbkrLaneArchitecturePanel`.
    - `@@ -61 +58,0 @@` remove `useRuntimeControlSnapshot`.
    - `@@ -3156,7 +3159,0 @@` remove line-usage runtime snapshot.
    - `@@ -3399,3 +3402,0 @@` remove `IbkrLineUsagePanel`.
  - Hold TAX settings tab/panel hunks.
- HUNKS: `artifacts/pyrus/src/features/platform/MobileMoreSheet.jsx`
  - Stage `@@ -26 +25,0 @@` and `@@ -302,4 +300,0 @@` remove footer pressure indicator only if leader considers it part of bridge/lane surface removal; otherwise HOLD signal/pressure.
- HUNKS: `artifacts/pyrus/src/features/platform/PlatformShell.jsx`
  - Same as MobileMoreSheet: remove `FooterMemoryPressureIndicator` import/render only if accepted as #4 UI surface removal; otherwise HOLD signal/pressure.

High-risk #4 entanglement:

- `artifacts/api-server/src/services/bridge-streams.ts`, `ibkr-account-bridge.ts`, `ibkr-live-demand-coordinator.ts`, `ibkr-live-demand-coordinator` replacement, `order-read-suppression.ts`, `work-governor.ts`, and `option-quote-demand-coordinator.ts` form a compile dependency chain if `bridge-client.ts` is deleted. However `work-governor.ts`, `order-read-suppression.ts`, and `option-quote-demand-coordinator.ts` are explicitly excluded signal-options/pressure lane files. If #4 deletes `bridge-client.ts` without landing the replacement hunks and new files, intermediate typecheck likely fails. I recommend leader either:
  - keep `bridge-client.ts` deletion held until the demand/governor lane is authorized, or
  - approve a PROPOSED-EXTRA "bridge compile shim" commit containing only the minimal replacements required by the deleted bridge client.

Do not include `lib/api-spec/openapi.yaml` or generated clients in #4. They are assigned to Commit 5 by instruction.

## Commit 5 - Task #3 categorization / inclusion / algo-tabs

Message: `feat(broker): manage tradable account inclusion`

Stage plan:

- NEW/WHOLE:
  - `artifacts/api-server/src/services/broker-account-category.ts`
  - `artifacts/api-server/src/services/broker-account-category.test.ts`
  - `artifacts/api-server/src/services/broker-account-inclusion.ts`
  - `artifacts/api-server/src/services/broker-account-inclusion.test.ts`
  - `lib/db/migrations/20260706_broker_account_type_inclusion.sql`
  - `lib/api-zod/src/generated/types/brokerAccountInclusionAccount.ts`
  - `lib/api-zod/src/generated/types/brokerAccountInclusionResponse.ts`
  - `lib/api-zod/src/generated/types/setBrokerAccountInclusionBody.ts`
  - `lib/api-zod/src/generated/types/snapTradeBrokerageConnectionSyncAccountAccountType.ts`
  - `lib/api-zod/src/generated/types/getTaxStateRulesStatusParams.ts` (generated TAX type; see risk flag)
- WHOLE:
  - `artifacts/api-server/src/services/snaptrade-account-sync.ts`
  - `artifacts/api-server/src/services/snaptrade-account-sync.test.ts`
  - `lib/db/src/schema/broker.ts`
  - `lib/api-client-react/src/generated/api.schemas.ts`
  - `lib/api-client-react/src/generated/api.ts`
  - `lib/api-zod/src/generated/api.ts`
  - `lib/api-zod/src/generated/types/brokerAccount.ts`
  - `lib/api-zod/src/generated/types/brokerProvider.ts`
  - `lib/api-zod/src/generated/types/placeOrderRequest.ts`
  - `lib/api-zod/src/generated/types/schwabEquityOrderSubmitBody.ts`
  - `lib/api-zod/src/generated/types/snapTradeBrokerageConnectionSyncAccount.ts`
  - `lib/api-zod/src/generated/types/snapTradeEquityOrderSubmitBody.ts`
  - `lib/api-zod/src/generated/types/submitIbkrOrdersRequest.ts`
  - `lib/api-spec/openapi.yaml` (WHOLE recommended; risk below)
- HUNKS:
  - `artifacts/api-server/src/routes/broker-execution.ts`: stage all observed included-account route hunks (`@@ -4,0 +5 @@`, `@@ -26,0 +28,2 @@`, `@@ -57,0 +61,4 @@`, `@@ -360,0 +368,20 @@`).
  - `artifacts/api-server/src/routes/broker-execution.test.ts`: stage included-account tests only (`@@ -353,0 +356,181 @@`). Do not stage tax imports or SnapTrade equity preflight hunks (`@@ -13,0 +14 @@`, `@@ -24,0 +26 @@`, `@@ -2328,0 +2512,19 @@`, `@@ -2344,0 +2547,2 @@`) unless TAX lane is authorized.
  - `artifacts/api-server/src/services/account.ts`: stage Task #3 hunks only:
    - `@@ -4164,0 +4175,17 @@` `withTradingInclusionDefault`.
    - `@@ -4180,0 +4208,2 @@` select `accountType`/`includedInTrading`.
    - `@@ -4193,0 +4223 @@` filter `includedInTrading = true`.
    - `@@ -4219 +4249,2 @@` expose `accountType`/`includedInTrading`.
    - `@@ -4490 +4521,4 @@`, `@@ -4505 +4539 @@`, `@@ -4508 +4542 @@`, `@@ -4514 +4548,6 @@`, `@@ -4517 +4556 @@` apply inclusion defaults.
    - Do not stage option-demand/day-change hunks (`@@ -156,6 +156,6 @@` through `@@ -2270 +2280 @@`, `@@ -8356,0 +8396 @@`) unless backlog #6 is approved.
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`: stage account-tab hunks (`useAccountTab` import, state derivation, positions account id, pass-through props). Do not stage auth-session dedupe import/use unless backlog #7 approved.
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`: stage all observed Task #3 hunks adding `AccountTabs` and `OperationsPositionsTable` account-mode props.
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`: WHOLE if diff only covers account-tab pass-through.
  - `artifacts/pyrus/src/screens/algo/OperationsPositionsTable.jsx`: stage all observed Task #3 hunks (`filterByDeployment`, `sourceLabel`).
  - `artifacts/pyrus/src/screens/algo/OperationsPositionsTable.test.mjs`: WHOLE if diff only covers `filterByDeployment`/`sourceLabel`.
  - `artifacts/pyrus/src/features/platform/useAccountTab.js`: stage all observed hunks enabling a default tab argument.
  - `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx`: stage Task #3 picker hunks:
    - generated hook imports for included accounts.
    - `formatBrokerProvider`, `formatAccountCategory`.
    - `inclusionQuery`, `inclusionMutation`, busy/error/refetch integration, `toggleIncludedAccount`.
    - trading-account checkbox UI block.
    - Auth dedupe hunks (`useAuthSession` import and removal of local query) are PROPOSED-EXTRA #7 unless leader approves bundling because this file is already being edited.

OpenAPI/generated recommendation:

- Recommend landing `lib/api-spec/openapi.yaml` and all regenerated clients WHOLE in Commit 5, even though the spec/client diff includes TAX endpoints/types. Reason: generated outputs are cross-file coherent as a codegen snapshot, and hunk-splitting generated files is high-risk and not deterministic without rerunning codegen. Tax routes remain held, so this temporarily exposes generated tax client methods/spec paths ahead of server route landing. This is a product/API contract risk, not a TypeScript compile risk based on observed generated files. Alternative: hunk-split `openapi.yaml` to omit TAX and rerun codegen in a separate maintenance pass; that is outside this read-only manifest and would violate the "all regenerated client files WHOLE" instruction.

## PROPOSED-EXTRA backlog commits for leader decision

- #2 phantom-mid / data-correctness:
  - `artifacts/pyrus/src/features/account/positionDisplayModel.js`
  - `artifacts/pyrus/src/features/account/positionDisplayModel.test.mjs`
  - Evidence: `bid > 0 && ask > 0` fix in `buildQuote`, new test file.
- #5 broker-marks money columns:
  - `artifacts/pyrus/src/screens/account/PositionsPanel.jsx`
  - `artifacts/pyrus/src/screens/account/PositionsPanel.test.mjs`
  - Evidence: broker money helpers and tests "display totals sum broker money, not live Massive money".
- #6 option day-change null guard:
  - `artifacts/api-server/src/providers/massive/market-data.ts`
  - `lib/ibkr-contracts/src/client.ts`
  - `artifacts/api-server/src/services/bridge-option-quote-stream.ts`
  - `artifacts/api-server/src/services/account.ts` option quote hunks only
  - `artifacts/api-server/src/services/option-quote-day-change-guard.test.ts`
  - Evidence: `QuoteSnapshot.change/changePercent` become `number | null`; day-change helper returns null when `prevClose` missing.
- #7 auth dedupe:
  - `artifacts/pyrus/src/features/platform/HeaderSessionStatus.jsx`
  - `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx`
  - hunk-splits in `AlgoScreen.jsx`, `SnapTradeConnectPanel.jsx`, `TradeOrderTicket.jsx`
  - Evidence: replaces duplicate `["auth-session"]` queries with `useAuthSession`.

## HOLD inventory

Operational/noise/session/docs/Replit/startup - HOLD:

- `.codex-watch-live-auth/auth-live-probe-summary.json`
- `.codex-watch-live/issue-10-visible-runtime-state.png`
- `.codex-watch-live/live-watch-summary.json`
- `.codex-watch/task3-completion-report-2026-07-07.md`
- `.codex-watch/watch-038.png`
- `.codex-watch/watch-291.png`
- `.codex-watch/watch-300.png`
- `.codex-watch/watch-summary.json`
- `.codex-watch/landing-manifest-2026-07-07.md`
- `CODEX_WORKER_IGNITION.md`
- `CLAUDE.md`
- `.env.example`
- `SESSION_HANDOFF_2026-07-05_0a16f7cc-0030-4762-8ef5-fd97147754d7.md`
- `SESSION_HANDOFF_2026-07-05_113d7d20-310a-4f34-8886-b650d04d28d0.md`
- `SESSION_HANDOFF_2026-07-05_134896bd-a1eb-47f1-b0ab-d6bca2e6be12.md`
- `SESSION_HANDOFF_2026-07-05_182a4859-3a9a-4166-a21c-d05fec4e58f6.md`
- `SESSION_HANDOFF_2026-07-05_30002be4-9321-42dc-bd0a-424f277061ca.md`
- `SESSION_HANDOFF_2026-07-05_3031a953-6144-4a63-ae27-9f21173d48f6.md`
- `SESSION_HANDOFF_2026-07-05_45ad4715-669e-4d4b-b117-9efbb977226a.md`
- `SESSION_HANDOFF_2026-07-05_5c7aa51d-8dd1-4203-b82f-9e43ad57fbb8.md`
- `SESSION_HANDOFF_2026-07-05_5de488c2-8ff8-4413-8789-b3f9b29eab00.md`
- `SESSION_HANDOFF_2026-07-05_60473da9-4bce-4a67-ab18-ff1acaca29de.md`
- `SESSION_HANDOFF_2026-07-05_627f9c4a-d576-41ba-be7b-345670c3b6f6.md`
- `SESSION_HANDOFF_2026-07-05_6765f941-f062-4a70-b852-fb42f1d5c54a.md`
- `SESSION_HANDOFF_2026-07-05_7943526c-b016-4b6b-87e3-c12b3b04f503.md`
- `SESSION_HANDOFF_2026-07-05_82f9cebc-58c7-4ae0-a1ac-be06b4787f96.md`
- `SESSION_HANDOFF_2026-07-05_b9dafa30-72f6-415e-a500-95045ce2a39e.md`
- `SESSION_HANDOFF_2026-07-05_d378bab2-87ad-4e12-8e67-1acd7567bb83.md`
- `SESSION_HANDOFF_2026-07-05_d6cc55a2-d861-4e14-8fb4-556e5452bb5f.md`
- `SESSION_HANDOFF_2026-07-06_019f38a7-58c8-70c3-8792-837c89329301.md`
- `SESSION_HANDOFF_2026-07-06_019f38ab-4b6b-7542-8d53-741907f0a993.md`
- `SESSION_HANDOFF_2026-07-06_019f38ad-342d-7142-9fbc-31940b1c40df.md`
- `SESSION_HANDOFF_2026-07-06_019f3912-e715-7722-ab78-f505ac1df1e1.md`
- `SESSION_HANDOFF_2026-07-06_019f392c-e9b0-74e1-9bf2-44398fbed56b.md`
- `SESSION_HANDOFF_2026-07-06_019f392d-0e71-7cc1-97cc-114d33008f0b.md`
- `SESSION_HANDOFF_2026-07-06_019f392d-ffa8-7141-857a-81679acf98cb.md`
- `SESSION_HANDOFF_2026-07-06_019f392f-97be-77a3-a59c-4fc965c2b4a0.md`
- `SESSION_HANDOFF_2026-07-06_019f3930-8c7b-7aa1-82ad-a7122dde5ccc.md`
- `SESSION_HANDOFF_2026-07-06_019f3934-8477-7773-a909-ca6e5957f143.md`
- `SESSION_HANDOFF_2026-07-06_019f3935-01a1-7ca2-99bf-9ffe88234139.md`
- `SESSION_HANDOFF_2026-07-06_019f3939-8ac7-7862-82ed-a5f35f211952.md`
- `SESSION_HANDOFF_2026-07-06_019f393b-3401-7d62-b799-89e3fa7afc9e.md`
- `SESSION_HANDOFF_2026-07-06_019f393d-bb8c-7ee1-a638-f516b9d9264e.md`
- `SESSION_HANDOFF_2026-07-06_019f393f-a4f7-7122-aa90-b5d21a9de800.md`
- `SESSION_HANDOFF_2026-07-06_019f3946-7cc9-75e1-b142-743975c67934.md`
- `SESSION_HANDOFF_2026-07-06_019f3946-e994-71e1-8d86-c0d7f8b0a1c4.md`
- `SESSION_HANDOFF_2026-07-06_019f394c-761a-70c1-840c-b251f16a8771.md`
- `SESSION_HANDOFF_2026-07-06_019f398d-d9cc-7a70-b9ed-daed51ab52e9.md`
- `SESSION_HANDOFF_2026-07-06_019f398e-01e7-7720-8574-9ac38dcc322b.md`
- `SESSION_HANDOFF_2026-07-06_13073e07-2d43-4d89-8e44-bed92d9f0362.md`
- `SESSION_HANDOFF_2026-07-06_1cec6f98-3b4b-44c6-bac3-3933b3f9c295.md`
- `SESSION_HANDOFF_2026-07-06_242a10dc-de69-44b3-b08c-00c1d0471796.md`
- `SESSION_HANDOFF_2026-07-06_24557ffb-3bb2-44c3-9eb9-4db3775df4b6.md`
- `SESSION_HANDOFF_2026-07-06_63e4317b-e5a6-4cd6-9caf-0a7fd723cf6a.md`
- `SESSION_HANDOFF_2026-07-06_65f6f1c1-acb9-4a2c-aa0c-e98cbfa4f678.md`
- `SESSION_HANDOFF_2026-07-06_662a18d9-e915-4a80-a97a-4392ec3aee60.md`
- `SESSION_HANDOFF_2026-07-06_7013d59a-1551-44f7-aa2e-661e31ed2316.md`
- `SESSION_HANDOFF_2026-07-06_711bf96b-b23a-40de-9246-ba1216e8050e.md`
- `SESSION_HANDOFF_2026-07-06_907ad490-5048-4d4b-826d-27a74395aee7.md`
- `SESSION_HANDOFF_2026-07-06_98a14f41-6230-4863-94b1-49a4655e39f7.md`
- `SESSION_HANDOFF_2026-07-06_adc68b55-16da-434d-9a66-fc4a4b40af90.md`
- `SESSION_HANDOFF_2026-07-06_b6ab8be7-3f75-44cb-8594-0295b0d54261.md`
- `SESSION_HANDOFF_2026-07-06_ca9f4967-61a3-4e1c-b09d-9a7b0f0892d6.md`
- `SESSION_HANDOFF_2026-07-06_cb3f16dd-d3c5-42bf-8a10-7c5d65c29513.md`
- `SESSION_HANDOFF_2026-07-06_df03e38d-88b8-4467-ab9e-df15f1c03a3c.md`
- `SESSION_HANDOFF_2026-07-06_dfe32281-f023-48ac-b75b-6260243d3ccc.md`
- `SESSION_HANDOFF_2026-07-06_e89674ed-76b4-4979-a13d-ffb784f9a28d.md`
- `SESSION_HANDOFF_2026-07-07_5360980c-fbf6-464f-9218-7740228e4d2f.md`
- `SESSION_HANDOFF_2026-07-07_68e08ab5-bcaa-4f77-aa9e-84bbd6e754a2.md`
- `SESSION_HANDOFF_2026-07-07_99067da6-77ef-4891-9e75-b26746320298.md`
- `SESSION_HANDOFF_2026-07-07_e61dae50-84a9-4daa-83f1-6130b28bed55.md`
- `SESSION_HANDOFF_CURRENT.md`
- `SESSION_HANDOFF_LIVE_2026-07-03_ibkr-client-portal-hosted-connector.md`
- `SESSION_HANDOFF_MASTER.md`
- `docs/plans/ibkr-connector-local-setup-spec.md`
- `docs/plans/2026-07-06-approach-a-running-tally-tasks.md`
- `docs/plans/2026-07-06-running-tally-PICKUP.md`
- `docs/plans/2026-07-06-signal-options-push-native-redesign-scope.md`
- `replit.md`
- `scripts/README.md`
- `scripts/check-replit-startup-guards.mjs`
- `scripts/run-validation-command.mjs`
- `artifacts/api-server/__mint-agent-session.mts`
- `artifacts/mcp-server/src/host/procinfo.ts`
- `artifacts/mcp-server/src/host/procinfo.test.mjs`
- `artifacts/pyrus/scripts/flightRecorder.mjs`
- `artifacts/pyrus/scripts/runDevApp.mjs`

TAX/wash lane - HOLD:

- `artifacts/api-server/src/routes/tax.ts`
- `artifacts/api-server/src/routes/index.ts` tax import/user-path/router mount hunks
- `artifacts/api-server/src/routes/platform.ts` tax preflight request fields hunk
- `artifacts/api-server/src/routes/broker-execution.test.ts` tax preflight import/test hunks
- `artifacts/api-server/src/services/platform-tax-preflight.test.ts`
- `artifacts/api-server/src/services/tax-planning.ts`
- `artifacts/api-server/src/services/tax-planning.test.ts`
- `artifacts/api-server/src/services/tax-planning-model.ts`
- `artifacts/api-server/src/services/tax-planning-model.test.ts`
- `artifacts/api-server/src/services/schwab-equity-orders.ts`
- `artifacts/api-server/src/services/schwab-equity-orders.test.ts`
- `artifacts/api-server/src/services/snaptrade-equity-orders.ts`
- `artifacts/api-server/src/services/snaptrade-equity-orders.test.ts`
- `artifacts/api-server/src/services/route-admission.ts` tax route classification hunks
- `artifacts/api-server/src/services/route-admission.test.ts` tax route classification test hunks
- `lib/db/migrations/20260706_tax_planning_foundation.sql`
- `lib/db/src/schema/tax.ts`
- `lib/db/src/schema/index.ts`
- `artifacts/pyrus/src/screens/account/TaxCenterPanel.jsx`
- `artifacts/pyrus/src/screens/settings/TaxSettingsPanel.jsx`
- `artifacts/pyrus/src/screens/AccountScreen.jsx`
- `artifacts/pyrus/src/screens/SettingsScreen.jsx` tax tab/panel hunks
- `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx`

Neural/brand lane - HOLD:

- `artifacts/pyrus/index.html`
- `artifacts/pyrus/package.json`
- `pnpm-lock.yaml`
- `artifacts/pyrus/src/app/App.tsx`
- `artifacts/pyrus/src/app/AppContent.tsx` NeuralLoader hunks only
- `artifacts/pyrus/src/components/brand/pyrus-loader-mark.tsx`
- `artifacts/pyrus/src/components/brand/pyrus-mark.tsx`
- `artifacts/pyrus/src/components/brand/pyrus-wordmark.tsx`
- `artifacts/pyrus/src/components/neural/NeuralCanvas.tsx`
- `artifacts/pyrus/src/components/neural/NeuralLoader.tsx`
- `artifacts/pyrus/src/components/neural/neural-core/NeuralPoints.tsx`
- `artifacts/pyrus/src/components/neural/neural-core/useMorphMachine.ts`
- `artifacts/pyrus/src/boot-neural.tsx`
- `artifacts/pyrus/src/boot-neural-scene.tsx`
- `artifacts/pyrus/src/components/marketing/brand-loader.tsx`
- `artifacts/pyrus/src/components/marketing/brand-resolve.tsx`
- `artifacts/pyrus/src/components/marketing/brandKitInstall.test.mjs`
- `artifacts/pyrus/src/components/marketing/neural-core-scene.tsx`
- `artifacts/pyrus/src/components/marketing/neural-core/NeuralCore.tsx`
- `artifacts/pyrus/src/components/marketing/neural-core/helpers.ts`
- `artifacts/pyrus/src/components/marketing/neural-core/index.ts`
- `artifacts/pyrus/src/components/marketing/neural-core/pyrus-logo-points.ts`
- `artifacts/pyrus/src/components/marketing/neural-core/pyrus-wordmark-points.ts`
- `artifacts/pyrus/src/components/marketing/neural-core/shaders.ts`
- `artifacts/pyrus/src/components/marketing/neural-core/types.ts`
- `artifacts/pyrus/src/components/marketing/neural-loader.tsx`
- `artifacts/pyrus/src/components/marketing/neural-stage.tsx`
- `artifacts/pyrus/src/components/marketing/pyrus-logo.standalone.tsx`
- `artifacts/pyrus/src/components/marketing/pyrus-mark-3d-scene.tsx`
- `artifacts/pyrus/src/components/marketing/pyrus-mark-3d.tsx`
- `artifacts/pyrus/src/components/marketing/pyrus-mark-shared.tsx`
- `artifacts/pyrus/src/components/marketing/pyrus-mark.tsx`
- `artifacts/pyrus/public/brand/pyrus-mark-dark.svg`
- `artifacts/pyrus/public/brand/pyrus-mark.svg`
- `artifacts/pyrus/public/brand/pyrus-wordmark-tight-light.png`
- `artifacts/pyrus/public/brand/pyrus-wordmark-tight.png`
- `artifacts/pyrus/src/index.css`
- `artifacts/pyrus/src/lib/observe-visibility.ts`
- `artifacts/pyrus/src/lib/pyrus-mark-geometry.ts`
- `artifacts/pyrus/src/lib/webglCapability.ts`
- `artifacts/pyrus/src/lib/webglCapability.test.ts`
- `artifacts/pyrus/src/main.tsx`
- `artifacts/pyrus/src/styles/brand.css`
- `artifacts/pyrus/vite.config.ts`
- `artifacts/pyrus/src/features/platform/AppHeader.jsx` brand lockup/neural hunks
- `artifacts/pyrus/src/features/platform/PlatformApp.jsx` NeuralLoader/header-status hunks
- `artifacts/pyrus/src/features/platform/loadingFallbackTheme.test.mjs`

Signal-options/tally/pressure lane - HOLD:

- `artifacts/api-server/src/services/background-worker-pressure.test.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`
- `artifacts/api-server/src/services/resource-pressure.test.ts`
- `artifacts/api-server/src/services/overnight-spot-execution.ts`
- `artifacts/api-server/src/services/overnight-spot-worker.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-evaluation-worker.ts`
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache-prefetch.test.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-options-worker.ts`
- `artifacts/api-server/src/services/signal-options-position-tick-manager.ts`
- `artifacts/api-server/src/services/signal-options-ledger-recovery.test.ts`
- `artifacts/api-server/src/services/signal-options-candidate-display.test.ts`
- `artifacts/api-server/src/services/signal-options-position-fold.test.ts`
- `artifacts/api-server/src/services/order-read-suppression.ts`
- `artifacts/api-server/src/services/option-quote-demand-coordinator.ts`
- `artifacts/api-server/src/services/work-governor.ts`
- `artifacts/api-server/src/services/bridge-streams.ts` unless #4 compile-shim extra approved
- `artifacts/api-server/src/services/ibkr-account-bridge.ts` unless #4 compile-shim extra approved
- `artifacts/api-server/src/services/ibkr-live-demand-coordinator.ts` unless #4 compile-shim extra approved
- `artifacts/api-server/src/services/bridge-option-quote-stream.ts` except backlog #6 proposed-extra
- `artifacts/api-server/src/services/platform.ts` pressure/work-governor hunks not needed for #4
- `artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx`
- `artifacts/pyrus/src/components/platform/signal-language/SignalDots.test.mjs`
- `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx`
- `artifacts/pyrus/src/features/platform/signalFrameState.js`
- `artifacts/pyrus/src/features/signals/signalStateFreshness.js`
- `artifacts/pyrus/src/features/signals/signalStateFreshness.test.mjs`
- `artifacts/pyrus/src/features/signals/signalsRowModel.js`
- `artifacts/pyrus/src/features/signals/signalsRowModel.test.mjs`
- `artifacts/pyrus/src/lib/formatters.js`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs`
- `artifacts/pyrus/src/screens/algo/OvernightControlPanel.jsx`
- `artifacts/pyrus/src/screens/algo/algoHelpers.js`

Backlog verified-done but not authorized - HOLD unless PROPOSED-EXTRA approved:

- `artifacts/pyrus/src/features/account/positionDisplayModel.js`
- `artifacts/pyrus/src/features/account/positionDisplayModel.test.mjs`
- `artifacts/pyrus/src/screens/account/PositionsPanel.jsx`
- `artifacts/pyrus/src/screens/account/PositionsPanel.test.mjs`
- `artifacts/api-server/src/providers/massive/market-data.ts`
- `lib/ibkr-contracts/src/client.ts`
- `artifacts/api-server/src/services/option-quote-day-change-guard.test.ts`
- `artifacts/pyrus/src/features/platform/HeaderSessionStatus.jsx`
- `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx`

Misc UI/app files needing hunk split or hold by evidence:

- `artifacts/pyrus/src/features/platform/MobileMoreSheet.jsx` - #4 removal candidate or pressure HOLD; leader decision.
- `artifacts/pyrus/src/features/platform/PlatformShell.jsx` - #4 removal candidate or pressure HOLD; leader decision.
- `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx` - auth dedupe PROPOSED-EXTRA #7.
- `artifacts/pyrus/src/features/platform/HeaderSessionStatus.jsx` - auth dedupe PROPOSED-EXTRA #7.

## UNKNOWN table

None. All expanded dirty paths are assigned to a commit plan, HOLD lane, or PROPOSED-EXTRA requiring leader approval.

## Final risk flags

- #4 compile coherence is the biggest risk: deleted legacy bridge files are entangled with excluded work-governor/order-read-suppression/option-demand replacements. A pure #4 deletion may not typecheck unless a minimal compile-shim extra is approved or deletions are narrowed.
- `openapi.yaml` whole-file landing in Commit 5 includes TAX endpoints while TAX routes are held. Recommended for generated-client coherence; product/API contract risk is explicitly accepted or leader should order a separate codegen split.
- `routes/index.ts` must exclude TAX import/mount hunks. Excluding them keeps the router coherent because `routes/tax.ts` is held.
- Shared files requiring careful hunk staging: `index.ts`, `routes/index.ts`, `routes/platform.ts`, `routes/settings.ts`, `services/platform.ts`, `services/account.ts`, `broker-execution.test.ts`, `AppContent.tsx`, `AlgoScreen.jsx`, `SettingsScreen.jsx`, `SnapTradeConnectPanel.jsx`.
