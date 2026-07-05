# LIVE — IBKR market-data-path removal

- Session ID: c60d901f-6617-4549-ac3b-83ce6ebf24c3 (Claude)
- Date: 2026-07-02 (MT) · CWD: /home/runner/workspace · Branch: main · HEAD: 28314c4
- Follows: SESSION_HANDOFF_LIVE_2026-07-02_compute-gex-bridge-audit-fixes-resume.md (complete,
  uncommitted)

## User decisions (AskUserQuestion, ~15:10 MDT)

- Scope: **data path only** — remove ibkr_sidecar + bridge market-data services and stop them
  running. KEEP dormant IBKR broker/execution code (accounts/orders/IB Gateway reconnect path),
  KEEP SnapTrade (incl. IBKR-FLEX read-only), KEEP Massive + pyrus_compute + rust worker.
- Commit-first: **declined** — removal proceeds on top of the uncommitted audit fixes +
  workstream-A calibration changes.

## Safety net (because no commit)

- Tracked modifications: recoverable stash object `stash@{0}` "pre-ibkr-datapath-removal snapshot
  2026-07-02" (created via git stash create/store; working tree untouched).
- Untracked files: /tmp/claude-1000/-home-runner-workspace/c60d901f-6617-4549-ac3b-83ce6ebf24c3/scratchpad/untracked-pre-ibkr-removal.tgz
- NOTE: stash@{1} is a PRIOR session's stash (fix/ticker-search-massive-repoint) — do not touch.

## Runtime evidence justifying removal (observed 2026-07-02 ~14:08 MDT)

- Provider policy: Massive owns ALL market data (stocks ws + options + GEX); IBKR policy role is
  broker workflows only. ibkrLive/Equity/OptionLineCount all 0; bridgeActiveLineCount null;
  ibkr-paper/ibkr-live connections "disconnected". SnapTrade: IBKR-FLEX read-only + ETRADE
  execution-ready, both connected. Massive ws: connected, 2014 symbols, real-time.
  ibkrAsyncSidecar: still enabled+healthy on :18769 pointing at disconnected gateway :7497 —
  the hang-on being removed.

## Scope addendum (user, ~15:20 MDT)

Also remove the bridge GOVERNOR front + back (user still sees it in the diagnostics UI).
Anchors found: backend core src/services/bridge-governor.ts; refs in ibkr-lanes.ts,
ibkr-line-usage.ts, bridge-streams.ts, bridge-quote-stream.ts, diagnostics.ts, platform.ts,
platform-bridge-health.ts, ibkr-perf-capture.ts, routes/settings.ts (governor settings surface),
options-flow-scanner-metadata-timeout.test.ts; CAUTION ibkr-account-bridge.ts (broker-side, KEEP)
references it. Frontend: DiagnosticsScreen.jsx, SettingsScreen.jsx (governor config UI),
screens/diagnostics/machineStateDiagramModel.js (+test/+MACHINE_STATE_WIRING.md),
features/platform/{ibkrPopoverModel,ibkrConnectionSnapshot,runtimeControlModel,
useRuntimeControlSnapshot}.js.

## Current step

Codex continuation completed the IBKR market-data-path removal integration pass as of
2026-07-02 16:59 MDT. Backend sidecar/old bridge stock market-data paths have been removed
or disabled, frontend calls to deleted position-quote/bar/market-depth routes are gone, and
old Bridge Governor diagnostics/control surfaces were removed from lane architecture,
line-usage/settings/perf/runtime payloads, OpenAPI, and generated clients. Broker-health
failure text is preserved through `lastError` instead of a public `governor` object; internal
broker/account/order backoff guards remain.

Observed final sweeps:
- Deleted route paths `/streams/position-quotes`, `/streams/bars`, `/market-depth`, and
  `/streams/market-depth` are absent from app source/spec/generated clients. Remaining
  `streamBars` hits are local variable names in signal-monitor bar merge code, not API routes.
- Deleted sidecar/generation helpers are absent from runtime source/package exports:
  `market-data-sidecar`, `ibkr_sidecar`, `ibkr-async-sidecar`, `IbkrAsyncSidecar`,
  `buildIbkrSidecarDesiredGeneration`, `applyMarketDataGeneration`.
- Public old-governor keys are absent from touched runtime/spec/generated/frontend surfaces:
  `apiGovernor`, `api.governor`, `governorConfig`, `runtime.governor`, `runtimeIbkr.governor`.
- Removed option-governor lanes are absent from backend source: no `optionsScanner`,
  `getBridgeGovernorSnapshot().options`, `isBridgeWorkBackedOff("options")`, or
  `runBridgeWork("options...")` hits.

Observed validation:
- `pnpm --filter @workspace/api-spec run codegen` passed twice; the script also ran
  `typecheck:libs` successfully both times.
- `pnpm --filter @workspace/api-server run typecheck` passed after final edits.
- `pnpm --filter @workspace/pyrus run typecheck` passed after final edits.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner-metadata-timeout.test.ts src/services/platform-bridge-health.test.ts`
  passed 42/42.
- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/ibkrConnectionSnapshot.test.mjs src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/appWorkScheduler.test.mjs src/features/platform/PlatformWatchlist.test.mjs src/screens/diagnostics/machineStateDiagramModel.test.mjs`
  passed 86/86.

## Post-rebuild Codex audit (2026-07-02 17:06 MDT)

User rebuilt the app and asked Codex to review/audit the work. Observed:

- Rebuilt dev process is running under the sanctioned supervisor:
  `pnpm --filter @workspace/pyrus run dev:replit`, with API child `dist/index.mjs`.
- Source sweeps after rebuild/codegen are clean for deleted route paths and helpers:
  `/streams/position-quotes`, `/streams/bars`, `/market-depth`, `/streams/market-depth`,
  `positionQuoteStream`, `usePositionQuoteSnapshotStream`, `getBrokerMarketDepthRequest`,
  `quoteStreams`, `market-data-sidecar`, `ibkr_sidecar`, `ibkr-async-sidecar`,
  `IbkrAsyncSidecar`, `buildIbkrSidecarDesiredGeneration`, `applyMarketDataGeneration`.
- Source sweeps are clean for old public governor fields in scoped runtime/spec/frontend
  surfaces: `apiGovernor`, `api.governor`, `governorConfig`, `bridgeGovernor`,
  `runtime.governor`, `runtimeIbkr.governor`, `getGovernorLastFailure`,
  `getBridgeGovernorSnapshot().options`, `isBridgeWorkBackedOff("options")`,
  `runBridgeWork("options...")`, `optionsScanner`.
- `git diff --check` on scoped files passed.
- Runtime probes against rebuilt API:
  - `GET /api/healthz` -> 200.
  - `GET /api/streams/bars?symbol=AAPL&timeframe=1m` -> 404.
  - `GET /api/market-depth?symbol=AAPL` -> 404.
  - `GET /api/streams/market-depth?symbol=AAPL` -> 404.
  - `GET /api/streams/position-quotes?symbols=AAPL` -> 404.
  - `GET /api/diagnostics/runtime?detail=compact` -> 200, `ibkr` present,
    `ibkr.governor` absent, broker-health fields (`healthError*`, `lastError`) present.
  - `GET /api/settings/ibkr-line-usage?detail=compact` -> 200, no `governor`,
    no `governorConfig`, no `streams.quoteStreams`; stream keys are
    `massiveStockQuotes`, `optionQuoteStreams`, `stockAggregates`.
- Post-rebuild validation:
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `pnpm --filter @workspace/api-server run typecheck` passed after the first attempt
    correctly refused while another validation lock was held.
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner-metadata-timeout.test.ts src/services/platform-bridge-health.test.ts`
    passed 42/42.
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/ibkrConnectionSnapshot.test.mjs src/features/platform/ibkrPopoverModel.test.mjs src/features/platform/appWorkScheduler.test.mjs src/features/platform/PlatformWatchlist.test.mjs src/screens/diagnostics/machineStateDiagramModel.test.mjs`
    passed 86/86.
  - `pnpm --filter @workspace/api-spec run codegen` passed, including `typecheck:libs`.
  - `pnpm run audit:api-codegen` passed with
    `[check-api-codegen-drift] ok: generated API clients are current`.

Audit finding: no IBKR market-data-path removal bug found in the scoped source, generated
API, focused tests, or rebuilt runtime probes. Landing caveat remains: the repo has a very
large dirty tree from other workstreams, and generated API files include unrelated
SnapTrade/signal-schema output. Do not stage/land these changes with broad `git add`.

## Codex follow-up: diagnostics broker label cleanup (2026-07-02)

User reported that the diagnostics broker feed map still showed `(IBKR)`.

Observed:
- The child node label was already `Broker Feed`, but the master group label in
  `MACHINE_STATE_GROUPS` still read `Broker Feed (IBKR)`.
- `MACHINE_STATE_WIRING.md` carried the same stale heading.

Changed:
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`: broker master label
  is now `Broker Feed`.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs`: added a
  focused assertion that the broker master group label remains `Broker Feed`.
- `artifacts/pyrus/src/screens/diagnostics/MACHINE_STATE_WIRING.md`: updated the broker
  section heading to match the runtime label.

Validated:
- `rg -n "Broker Feed \\(IBKR\\)|Broker Feed \\(ibkr\\)|\\(IBKR\\).*broker|\\(ibkr\\).*broker|broker.*\\(IBKR\\)|broker.*\\(ibkr\\)" artifacts/pyrus/src/screens/diagnostics artifacts/pyrus/src/features/platform -g '!node_modules'`
  returned no matches.
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/diagnostics/machineStateDiagramModel.test.mjs`
  passed 36/36.

## Codex follow-up: SnapTrade broker diagnostics (2026-07-02)

User asked for Diagnostics and related surfaces to reflect the current SnapTrade broker
connection style. In particular, the broker map box must show multiple connected brokers and
their status.

Observed:
- `/api/broker-connections` already exposes broker connection rows through generated
  `useListBrokerConnections`; persisted SnapTrade broker connections carry
  `provider: "snaptrade"`, `brokerageSlug`, `status`, `mode`, `capabilities`, and
  `updatedAt`.
- The diagnostics machine-state model still used a single fallback `ibkr` diagnostics
  snapshot as the broker box child.

Changed:
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`
  - Added dynamic broker group children via `groupId`.
  - Added SnapTrade broker connection normalization: one broker-card row per non-disconnected
    SnapTrade brokerage, with `connected` → healthy, `configured` → checking, `error` →
    down.
  - The old `ibkr-bridge` row remains only as a fallback when no SnapTrade broker rows are
    observed.
- `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
  - Fetches `useListBrokerConnections` while Overview or Broker diagnostics are visible.
  - Passes broker connections into `buildMachineStateDiagramModel`.
  - Renamed the Diagnostics detail tab from `IBKR` to `Broker`.
  - Added a `SnapTrade Brokers` panel and changed the overview metric to `Broker health`.
- `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx`
  - Changed broker execution transport tooltips from IBKR-specific wording to generic broker
    order/status wording.
- `artifacts/pyrus/src/screens/diagnostics/MACHINE_STATE_WIRING.md`
  - Documented dynamic SnapTrade broker rows and fallback broker runtime behavior.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs`
  - Added a regression test proving multiple SnapTrade broker rows render in the broker
    master and suppress the old single `ibkr-bridge` row.

Validated:
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/diagnostics/machineStateDiagramModel.test.mjs src/screens/diagnostics/machineStateDiagram.contract.test.mjs`
  passed 47/47.
- Exact stale diagnostics string sweep for `IBKR heartbeat`, `IBKR Heartbeat`,
  `IBKR Raw Snapshot`, `activeTab === "IBKR"`, `IBKR / TWS`, `IBKR order submit`,
  `IBKR fills/status`, and `Broker Feed (IBKR)` returned no matches in the scoped
  diagnostics/platform files.
- `git diff --check` passed for the touched diagnostics files.

## Codex follow-up: Account diagnostics SnapTrade readiness (2026-07-02)

User reported failures in the diagnostics Account box after the broker map was
updated for SnapTrade.

Observed root cause:
- Live `/api/accounts` returned 4 accounts: the stale legacy IBKR account first,
  then 3 SnapTrade E*Trade accounts.
- Live `/api/broker-connections` showed connected SnapTrade broker rows for
  `INTERACTIVE-BROKERS-FLEX` and `ETRADE`.
- Live `/api/diagnostics/latest` degraded the `accounts` snapshot only because
  the collector selected the first account and ran the position visibility probe
  through the retired IBKR Client Portal path:
  `lastError: "IBKR Client Portal is not configured."`
- Direct `/api/streams/accounts` and `/api/streams/orders` probes still emitted
  legacy IBKR stream setup errors, so the diagram's Account State and Order State
  rows were stale IBKR-era signals.

Changed:
- `artifacts/api-server/src/services/diagnostics-account-probes.ts`
  - Added a provider-aware diagnostics account probe target selector.
  - Prefers SnapTrade accounts over stale legacy IBKR accounts when SnapTrade
    accounts are observed.
  - Builds a synthetic SnapTrade position visibility probe that marks the old
    legacy bridge probe as intentionally skipped for diagnostics.
- `artifacts/api-server/src/index.ts`
  - `collectDiagnosticsInput()` now uses the provider-aware probe target.
  - The position probe no longer calls `getAccountPositionVisibilityProbe()` for
    SnapTrade-backed account views.
  - Account probe raw data now includes `probeAccountProvider` and
    `snapTradeAccountCount`; position probe raw data includes provider/reason and
    `skippedLegacyBridgeProbe`.
- `artifacts/api-server/src/services/diagnostics.ts`
  - Account metrics now expose `positionProbeProvider`,
    `positionProbeReason`, and `skippedLegacyBridgeProbe`.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`
  - Account State and Order State use observed SnapTrade broker capabilities when
    non-disconnected SnapTrade broker rows exist.
  - Legacy `runtimeControl.streams.account/order` freshness remains the fallback
    when no SnapTrade broker rows are observed.
  - `account-view` ignores legacy `streams.tradingFresh` stale state when
    SnapTrade broker readiness is observed.
  - Dynamic SnapTrade broker edges now label account state as `broker sync` and
    order state as `broker orders`.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs`
  - Added regression coverage for stale legacy account/order streams plus
    connected SnapTrade brokers producing a healthy Account box.
- `artifacts/pyrus/src/screens/diagnostics/MACHINE_STATE_WIRING.md`
  - Documented the SnapTrade-first Account State / Order State semantics and
    legacy fallback.

Validated:
- `pnpm --filter @workspace/api-server exec tsx --test src/services/diagnostics-account-probes.test.ts`
  passed 3/3.
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/diagnostics/machineStateDiagramModel.test.mjs src/screens/diagnostics/machineStateDiagram.contract.test.mjs`
  passed 48/48.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- A final `pnpm --filter @workspace/api-server run typecheck` rerun after an
  indentation-only cleanup failed on unrelated existing `signal-quality-kpis-service`
  errors (`signalQualityKpiSnapshotsTable`, removed KPI snapshot exports, and
  missing KPI cache constants). The account diagnostics focused test still passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `git diff --check` passed for the touched diagnostics files.
- Restarted through the sanctioned workflow command:
  `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit`.
- Live `/api/diagnostics/latest` after restart showed `accounts.status: "ok"`,
  `visibilityFailures: 0`, `positionProbeProvider: "snaptrade"`,
  `positionProbeReason: "snaptrade_accounts_observed"`,
  `skippedLegacyBridgeProbe: true`, and `lastError: null`.

## Codex follow-up: Algo Engine diagnostics attribution (2026-07-02)

User asked about an error in the diagnostics Algo Engine box.

Observed:
- Live `automation` snapshot was degraded, but the worker itself was not failing:
  `workerRunning: true`, `lastScanOutcome: "success"`, `lastError: null`,
  `failureCount: 0`, `gatewayBlockedCount: 0`.
- The open automation event was `signal_options_signal_scan_degraded`:
  scans were completing with stale/unavailable signal inputs.
- Live metrics showed 12,000 scanned signals, ~30 fresh signals, 0 stale signals,
  and 2,123 unavailable signals. That put degraded signal inputs over the backend
  10% warning threshold.
- The diagnostics map incorrectly put that broad automation snapshot warning on
  `algo-engine` because the Algo node used `statusFromSnapshot(automationSnapshot)`.
  The Signals node ignored `unavailableSignalCount`, so the signal-input warning
  had nowhere accurate to land.

Changed:
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`
  - Signals now reads `staleSignalCount` and `unavailableSignalCount`, reports
    degraded input ratio, and becomes checking when signal inputs are degraded.
  - Algo Engine no longer inherits broad automation snapshot severity. It now
    derives health from worker running state, scan staleness/long-running scan,
    gateway blocks, failures, and algo line usage.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs`
  - Added a regression matching the live case: degraded automation snapshot from
    unavailable signal inputs, successful worker scan, no gateway/failure. Signals
    is checking and Algo Engine remains healthy.
- `artifacts/pyrus/src/screens/diagnostics/MACHINE_STATE_WIRING.md`
  - Documented that degraded signal inputs belong to the Signals bubble and broad
    automation snapshot severity is not applied to Algo Engine.

Validated:
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/diagnostics/machineStateDiagramModel.test.mjs src/screens/diagnostics/machineStateDiagram.contract.test.mjs`
  passed 49/49.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `git diff --check` passed for the touched diagnostics model/test/wiring files.
- Live model computation from the current `/api/diagnostics/latest` payload now
  shows `signal-engine.status: "checking"` with `2,123 unavailable` and
  `algo-engine.status: "healthy"` with `0 candidates / 27,905ms scan`.

## Codex continuation (2026-07-02, after Claude usage-limit pause)

- Claude session `c60d901f-6617-4549-ac3b-83ce6ebf24c3` is active/idle but paused by usage
  limit immediately after scout workflow `w2igxcyaf` completed.
- Observed scout status: `map:sidecar`, `map:bridge-streams`, and `map:lanes-workplan`
  returned usable manifests; `map:provider-client-health`, `map:web-ui`, and
  `map:config-startup-docs` returned null due to the usage limit.
- Observed repo state vs `stash@{0}`: no IBKR data-path removal edits had started. The only
  selected scope diff since the snapshot was an unrelated one-line SettingsScreen button style
  change.
- Codex delegated the three failed scout lanes as read-only explorer subtasks and is keeping
  integration/edits local to avoid overlapping patches.

## Next step

Immediate remaining targets:
- No remaining IBKR market-data-path removal target is known from this handoff.
- Before landing, classify the massive dirty tree carefully; generated API files also include
  unrelated SnapTrade/signal-schema outputs already present in the broader worktree.
- If runtime QA is desired, start the app through the sanctioned Replit workflow command and
  verify Settings/Diagnostics no longer expose the old governor or deleted stream routes.

## Codex audit: Diagnostics Signals / Flow / GEX (2026-07-02)

User asked what is happening with Signal Flow and GEX in the diagnostics map.

Observed:
- Live model with full runtime-control input:
  - `flow` master is `idle`: `Flow Scanner: market session quiet / enabled / 32 of 32 / 0 free scanner lines`.
  - `gex` master is `idle` when the client cache sensor is observed with zero queries:
    `GEX Projection: no gex requests this session`.
  - `signals` master is `checking`: `32 fresh signals / 1,263 stale signals /
    2,123 unavailable / 28% degraded inputs / ~29s scan age`.
- Flow is not failing. The scanner is enabled/backend-active, Massive is providing
  options data, and the market session is quiet after hours. The full scanner
  line allocation is expected for rotation.
- The Signals warning is real and now correctly lands on the Signals box, not
  Algo Engine. Backend automation event:
  `signal_options_signal_scan_degraded`.
- Root cause for the Signals count:
  - Canonical signal source environment is `shadow`
    (`resolveSignalSourceEnvironment()`).
  - Deployment `Pyrus Signals Options Shadow` expects 2,000 symbols x 6
    timeframes = 12,000 signal states.
  - DB reconciliation against `signal_monitor_profiles.environment='shadow'`
    showed exactly 12,000 expected states, 9,877 stored states, and 2,123
    missing states. Missing rows are mostly slow timeframes: 1,505 daily and
    598 hourly, plus small intraday gaps (`SATG`, `SATS`, and several 15m rows).
  - Worker counts these missing profile/deployment states as unavailable inputs.
- GEX map behavior is a diagnostic blind spot:
  - The map's GEX node only reads browser React Query cache keys
    (`gex-dashboard`, `gex-projection`, `gex-zero-gamma`).
  - A direct model call without `gexClientState` reports `unknown`; the real
    overview path should report `idle` when the cache is observed but no GEX
    queries happened in the session.
  - Lightweight backend read `/api/gex-snapshots?symbols=SPY,QQQ` succeeded but
    returned stale snapshots: QQQ computed `2026-06-17T23:19:01.226Z`, SPY
    computed `2026-07-02T20:49:51.213Z`, both `stale: true`.
  - `latest.marketDataWorkPlan.summary.persistBlockedJobCount` was 0, so no
    blocked GEX persist jobs were observed.
- During probes, API/resource pressure warnings appeared intermittently
  (`db_pool_waiting`, heap percent, API p95 latency), so some reads were slow,
  but these were separate from the signal coverage warning.

Recommended next steps:
- Signals: fix upstream signal monitor coverage for the shadow profile's 2,000-symbol
  universe, prioritizing missing `1d` and `1h` states. The diag map is accurately
  reporting degraded signal inputs; the source is missing/stale monitor state.
- GEX: decide whether the diagnostics map should remain a client-cache sensor or
  add backend GEX health. If we want it to answer "is GEX usable?", wire in
  persisted snapshot freshness / stale counts from the GEX ingest path rather
  than relying only on React Query cache observation.
- Flow: no immediate fix. Keep an eye on line-usage wording: full scanner line
  allocation is normal for steady-state rotation, not a failure by itself.
