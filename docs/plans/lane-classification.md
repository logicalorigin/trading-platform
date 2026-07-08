# SIGNAL-CALIBRATION landing — lane classification

Baseline snapshot: `baseline-dirty.txt` (268 lines). Fresh `git status --porcelain`: `fresh-status.txt` (282 lines).
**State drift since baseline** (files that changed status between the two snapshots — a concurrent
process, almost certainly the WO-FIX-01..07 / WO-FR-01/02 codex workers, kept running after the
baseline was captured):
- New `M`: `artifacts/api-server/src/services/shadow-account-latest-marks.test.ts`,
  `shadow-account-read-cache.test.ts`, `signal-options-position-fold.test.ts` (all gained the
  WO-FIX-05 batch-write test additions during the window).
- New `??`: `.codex-watch/wo-fix-01..07-report.md`, `wo-fr-01/02-report.md` (the fix-session's own
  reports finished writing), `SESSION_HANDOFF_2026-07-08_f1d3f876-...md`,
  `artifacts/api-server/__mint-qa-session.mts`.
No file changed in a way that alters this report's per-file lane calls below (I re-diffed every
entangled file fresh), but treat the working tree as **actively moving**, not a static snapshot.

Cross-referenced `docs/plans/workorders-2026-07-07/README.md` (dispatch board, no literal
lane-ownership table) and `.codex-watch/wo-02-ownership-matrix-2026-07-07.md` (the actual
lane-ownership matrix artifact — confirms `signal-monitor.ts` / `signal-options-automation.ts`
carry lane `4f0c846b`'s uncommitted PICKUP/tally/MTF/Greek-selector work, i.e. this IS the
SIGNAL-CALIBRATION content).

## Key corrections to the task's stated priors

1. **`lib/market-calendar` is NOT a new package** (`git log` shows 3 prior commits). What's new is
   a purely-additive set of exports (`tradingDaysBetween`, `previousTradingDayOrSame`,
   `addTradingDays`, `rthBarsBetween`, `rthBarsBack`) consumed by calibration call sites
   (shadow-account backtest-warmup parity, signal-options DTE calc, backtesting.ts DTE). Still
   correctly calibration-owned, just not a "new package."
2. **`shadow-account.ts` is NOT "07-02 read-cache-version-split + FIX-05."** The read-cache
   lateral-join functions (`latestShadowPositionMarksAt`, `readShadowPositionPeakMarkPrices`) are
   already committed at HEAD (unchanged in this diff). The actual dirty content is THREE strands:
   calibration (market-calendar backtest-warmup fix + signal-options partial-scale-out exit
   dedup) + WO-FIX-05 (mark-write batching). See entanglement detail below.
3. **A same-day "IBKR bridge retirement from Algo/STA readiness" lane exists**, distinct from the
   OAuth-adding `ibkr-datapath-removal` files. It renames `gatewayReady`→`marketDataReady` and
   deletes IBKR-bridge-readiness logic across `AlgoScreen.jsx`, `algoCockpitDiagnosticsModel.js`,
   `AlgoLivePage.jsx`, `OperationsStatusOrb.jsx`, `failurePointModel.js`,
   `algo-gateway.ts` (new `resolveAlgoShadowDisplayReadiness`, comment: *"the IBKR Client Portal
   live-execution path is retired"*), and their tests — content-wise this is the same
   `ibkr-datapath-removal` lane (just the "remove" side, vs. the OAuth files' "add" side), NOT
   calibration, despite living in algo/signal screen files.
4. **`overnight-signal-expectancy` is a separate, freestanding feature lane**, not part of
   SIGNAL-CALIBRATION — it computes overnight-hold expectancy per timeframe for
   research/timeframe-selection, with no import links to `signal-options.ts`,
   `option-greek-selector.ts`, `signal-monitor.ts`, or `signal-options-automation.ts` (checked all
   7 files). One exception: ~40 lines inside `backtest-worker/src/index.ts` finish wiring
   `deploymentSignalOptionsProfile` (genuinely calibration) into the same file as the overnight
   pipeline — see entanglement detail.
5. **A separate "pressure-directive-2026-07-07" lane exists**: *"entries/option-chain batches
   never pause under resource pressure"* (owner directive dated 2026-07-07, predates today).
   Touches `signal-options-worker.ts` (dominant), `background-worker-pressure.test.ts` (partial),
   `platform.ts` (partial, `pressureDeferred` removal from `batchOptionChains`),
   `option-chain-policy.test.ts` (whole file), `overnight-spot-worker.ts` (whole file). Not
   calibration, not today's session.
6. **`signal-options-worker.ts` is entirely NON-calibration** despite the name match pattern —
   100% split between WO-FIX-03 Part B (today, scan-timeout scaling) and the pressure-directive
   lane above (#5).
7. **A separate "DB-demand-2026-07-07" lane exists** ("work-order B" cuts to signal-monitor DB
   read/write demand — catalog-expansion JOIN memoization, universe-watchlist resolution caching).
   Lives partly inside `signal-monitor.ts`'s diff (the `loadSignalMonitorCatalogExpansionSymbols`
   / `resolveSignalMonitorUniverseFromWatchlists` hunks) and wholly in the new
   `signal-monitor-db-demand.test.ts`. Not calibration, not today's FIX session (dated 07-07,
   matches `.codex-watch/fix-read-fanout-2026-07-07.md` / `fix-signal-monitor-db-2026-07-07.md`).

## Full file table

Legend for lane column: **calibration** | **ibkr-datapath-removal** | **overnight-expectancy**
(separate feature, not calibration) | **pressure-directive-07-07** (not calibration) |
**db-demand-07-07** (not calibration) | **fix-session-today** (WO-FIX-01..07/WO-FR-01/02) |
**market-data/other-perf** | **pyrus-ui** | **docs/handoffs** | **session-today** (meta
artifacts) | **infra** | **generated-multi-lane** | **unknown**

### Docs / handoffs (grouped — pattern-obvious, not individually diffed)

| file(s) | lane | confidence | summary |
|---|---|---|---|
| `SESSION_HANDOFF_2026-07-07_*.md` (17 files, `M` + `??`), `SESSION_HANDOFF_2026-07-08_*.md` (13 files, all `??`), `SESSION_HANDOFF_CURRENT.md`, `SESSION_HANDOFF_MASTER.md`, `SESSION_HANDOFF_LIVE_2026-07-03_ibkr-client-portal-hosted-connector.md` | docs/handoffs | high | Per-session handoff snapshots / index files. Not code. |
| `docs/plans/2026-07-07-*.md` (5 files), `docs/plans/2026-07-08-manifest-resolution-report.md`, `docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md` | docs/handoffs | high | Planning/investigation docs, various lanes' own paper trail. |
| `docs/plans/workorders-2026-07-07/*.md` (all `??` work-order spec files, ~27 files, EXCEPT `wo-cr-02-...md` which is `M`) | docs/handoffs | high | WO spec files for the 07-07 dispatch board (code-reduction, multi-user, calibration WO-SO-*, etc.) — specs, not the code they produced. |
| `docs/plans/workorders-2026-07-07/wo-cr-02-pyrus-formatter-consolidation.md` (`M`, 6 lines) | docs/handoffs | high | Status-line edit only (marks Button/LoginGate migration "SUPERSEDED 2026-07-08"). |
| `docs/reviews/2026-07-07-signal-options-system-review.md` (new dir+file) | docs/handoffs | high | The review doc whose "candidates 5-8" (Greek selector, tally finish line, config coherence, wire-trail hardening) are the calibration workstream's own spec. Doc, not code. |

### Session-today meta artifacts (grouped)

| file(s) | lane | confidence | summary |
|---|---|---|---|
| `.codex-watch/*.md`, `.codex-watch/*.png`, `.codex-watch/watch-summary.json`, `.codex-watch/code-reduction-baselines/`, `.codex-watch/tally-snapshots/` (all `??`, ~70 files incl. `wo-fix-01..07-report.md`, `wo-fr-01/02-report.md`) | session-today | high | Investigation/report artifacts from many different lanes' codex workers (07-07 AND 07-08). Per task definition, these are meta-artifacts, not lane-owned code. |
| `.codex-log-watch/`, `.codex-watch-current/`, `.codex-watch-live-auth/`, `.codex-watch-live/` (untracked dirs) | session-today | high | Session/log scratch dirs. |
| `docs/plans/workorders-2026-07-08/` (whole dir: wo-boot-01/02, wo-fix-01..07, wo-fr-01/02, wo-login-01) | session-today | high | Today's WO specs (per task definition). |
| `artifacts/api-server/__mint-qa-session.mts` (new) | session-today | high | Throwaway QA-session-mint helper, scratchpad-path only. |

### IBKR-datapath-removal lane (OAuth add + bridge-retirement remove — same overall lane, two sides)

| file | lane | confidence | summary |
|---|---|---|---|
| `artifacts/api-server/src/providers/ibkr/client.ts` (M, 79 ln) | ibkr-datapath-removal | high | Adds OAuth 1.0a HMAC signing (`signHmacRequest`) to the IBKR REST client. Pure addition. |
| `artifacts/api-server/src/providers/ibkr/client-oauth-hook.test.ts` (new) | ibkr-datapath-removal | high | Tests the above. |
| `artifacts/api-server/src/services/ibkr-oauth-session.ts` (new) | ibkr-datapath-removal | high | New `IbkrOAuthSessionManager`: DH-challenge live-session-token acquisition, tickle/reauth loop. |
| `artifacts/api-server/src/services/ibkr-oauth-session.test.ts` (new) | ibkr-datapath-removal | high | Tests the above. |
| `artifacts/api-server/src/services/diagnostics-ibkr-metrics.test.ts` (new, 27 ln) | ibkr-datapath-removal | medium | New coverage of pre-existing (already-at-HEAD) bridge-retirement diagnostics code; doesn't depend on this session's diffs. |
| `artifacts/api-server/src/services/algo-gateway.ts` (M, 25 ln, all additions) | ibkr-datapath-removal | high | New `resolveAlgoShadowDisplayReadiness` — explicit comment: "the IBKR Client Portal live-execution path is retired." |
| `artifacts/pyrus/src/screens/AlgoScreen.jsx` (M, 58 ln) | ibkr-datapath-removal | high | Deletes `isGatewayReadyForAlgo`/`bridgeRuntimeTone`/`hasGatewayLiveDataProof`; replaces with `isMarketDataReadyForAlgo` (Massive-based); "Data Bridge" → "Market Data" label; shadow deployment no longer blocked on IBKR account. |
| `artifacts/pyrus/src/screens/AlgoScreen.test.mjs` (M, 22 ln) | ibkr-datapath-removal | high | Tests the above rename/removal exclusively. |
| `artifacts/pyrus/src/screens/algoCockpitDiagnosticsModel.js` (M, 9 ln) | ibkr-datapath-removal | high | `gatewayReady`→`marketDataReady` prop rename + "GATEWAY"→"MARKET DATA" copy. Whole diff. |
| `artifacts/pyrus/src/screens/algoCockpitDiagnosticsModel.test.mjs` (M, 12 ln) | ibkr-datapath-removal | high | Tests the rename. |
| `artifacts/pyrus/src/screens/algo/OperationsStatusOrb.jsx` (M, 16 ln) | ibkr-datapath-removal | high | `gatewayReady`→`marketDataReady` prop rename throughout. Whole diff. |
| `artifacts/pyrus/src/features/platform/failurePointModel.js` (M, 9 ln) | ibkr-datapath-removal | high | Same rename; copy "Data bridge is not ready" → "Market-data stream is not ready." |
| `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx` (M, 27 ln) | ibkr-datapath-removal | high | Threads `marketDataReady` instead of `gatewayReady`/`bridgeTone` through `buildAttentionStream`/`resolveOperationsStatus`. |
| `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs` (M, 24 ln) | **ENTANGLED** | high | Mostly ibkr-removal tests (rename, "market data off" labels) + one calibration test block (`requiredCount` MTF draft-clamp, "product ruling 2026-07-07"). See entanglement detail. |
| `artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx` (M, 10 ln) | **ENTANGLED** | high | `gatewayReady`→`marketDataReady` rename (ibkr-removal) + `requiredCount` threading (calibration) in the same small diff. See entanglement detail. |
| `artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.test.mjs` (M, 24 ln) | **ENTANGLED** | high | Rename test + calibration MTF `currentSignalDirection` test. See entanglement detail. |

### Pressure-directive-07-07 lane (NOT calibration, NOT today's session)

| file | lane | confidence | summary |
|---|---|---|---|
| `artifacts/api-server/src/services/signal-options-worker.ts` (M, 54 ln) | **100% split: fix-session-today + pressure-directive-07-07** | high | Whole file is either WO-FIX-03 Part B (scan-timeout scaling) or the "entries never pause under pressure" hunk (removes `isApiResourcePressureHardBlock` usage). Zero calibration content despite the filename pattern. |
| `artifacts/api-server/src/services/overnight-spot-worker.ts` (M, 22 ln) | pressure-directive-07-07 | high | Removes entry-skip-under-pressure gate for the (unrelated) overnight-spot equity worker; explicit "owner directive 2026-07-07" comment. |
| `artifacts/api-server/src/services/option-chain-policy.test.ts` (M, 11 ln) | pressure-directive-07-07 | high | Asserts `shouldYieldOptionChainBatchForPressure` is GONE; explicit "Owner directive 2026-07-07" comment. |
| `artifacts/api-server/src/services/background-worker-pressure.test.ts` (M, 63 ln) | **ENTANGLED**: pressure-directive-07-07 + fix-session-today | high | `skipEntryWork` always-false hunks = pressure-directive-07-07; new `resolveWorkerScanTimeoutMs` scaling test = WO-FIX-03 Part B (today). |

### DB-demand-07-07 lane (NOT calibration, NOT today's session)

| file | lane | confidence | summary |
|---|---|---|---|
| `artifacts/api-server/src/services/signal-monitor-db-demand.test.ts` (new) | db-demand-07-07 | high | "DB read/write-demand cuts for signal-monitor (work-order B)" — catalog-expansion JOIN memoization tests. Matches `.codex-watch/fix-read-fanout-2026-07-07.md` / `fix-signal-monitor-db-2026-07-07.md`. |
| (entangled portion of `signal-monitor.ts` — see below) | db-demand-07-07 | medium-high | `loadSignalMonitorCatalogExpansionSymbols` / `resolveSignalMonitorUniverseFromWatchlists` memoization hunks (~diff lines old:3836-3934) match the test above, not calibration. |

### Overnight-signal-expectancy lane (separate feature, NOT calibration)

| file | lane | confidence | summary |
|---|---|---|---|
| `artifacts/api-server/src/services/overnight-signal-expectancy.test.ts` (new) | overnight-expectancy | high | Tests the api-server side of the feature. |
| `artifacts/backtest-worker/src/overnight-signal-expectancy.ts` (new) | overnight-expectancy | high | Core engine: RTH session/return-window builder, per-timeframe sampling, bootstrap CI. No calibration imports. |
| `artifacts/backtest-worker/src/overnight-signal-expectancy.test.ts` (new) | overnight-expectancy | high | Tests the above. |
| `artifacts/pyrus/src/features/backtesting/OvernightExpectancyPanel.tsx` (new) | overnight-expectancy | high | Standalone backtesting-UI panel. |
| `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx` (M, 20 ln) | overnight-expectancy | high | Wires the new panel into a 3rd workbench tab. |
| `lib/db/migrations/20260707_overnight_signal_expectancy.sql` (new) | overnight-expectancy | high | New tables. |
| `lib/db/src/schema/overnight-signal-expectancy.ts` (new) | overnight-expectancy | high | Drizzle schema mirror. |
| `lib/db/src/schema/index.ts` (M, 1 ln) | overnight-expectancy | high | Barrel export for the schema above. |
| `artifacts/backtest-worker/package.json` (M, 1 ln), `artifacts/backtest-worker/tsconfig.json` (M, 3 ln) | overnight-expectancy | high | Add `@workspace/market-calendar` workspace dep, needed by the engine above. |
| `artifacts/backtest-worker/src/index.ts` (M, 821 ln) | **ENTANGLED**: overnight-expectancy (dominant, ~750 ln) + calibration (~40 ln) | high | See entanglement detail below. |

### Market-data / other-perf / misc-other (NOT calibration)

| file | lane | confidence | summary |
|---|---|---|---|
| `artifacts/api-server/src/services/market-data-store.ts` (M, 30 ln) | other/infra | high | Adds "skipped" vs "failed" distinction + proactive-backoff skip to `persistMarketDataBars`. |
| `artifacts/api-server/src/services/flow-universe.ts` (M, 194 ln) | other/perf | high | Batches per-symbol flow-ranking EWMA upserts into debounced multi-row statements ("Census S11"). Not a provider migration. |
| `lib/db/src/schema/universe.ts` (M, 12 ln), `lib/db/migrations/20260707_universe_catalog_optionable_partial_idx.sql` (new) | other/perf | high | New partial index on `universe_catalog` optionable predicate ("Census S14"); general-purpose, used by 5 call sites incl. signal-monitor but not calibration-specific logic. |
| `artifacts/api-server/src/services/account.ts` (M, 53 ln) | other | high | New `accountPositionOpenedOnCurrentMarketDay` gates same-day P&L display. Unrelated to signals. |
| `artifacts/api-server/src/services/automation.ts` (M, 95 ln), `automation.merge-events.test.ts` (M, 50 ln) | fix-session-today (not named in a WO but same flavor) | high | TTL cache + in-flight dedup for `listExecutionEvents`. |
| `artifacts/api-server/src/services/diagnostics.ts` (M, 51 ln) | fix-session-today (not named in a WO) | high | Batches `buildMonitoredStorageTableStats` N+1 queries into one UNION ALL. No IBKR/calibration content despite the adjacent IBKR test file. |
| `artifacts/api-server/src/services/runtime-flight-recorder.ts` (M, 101 ln), `runtime-flight-recorder.test.ts` (new, 150 ln) | other (dated 07-07, "fix-observability" lane) | high | Slow-query firehose diet: truncate/rate-limit/byte-cap. Matches `.codex-watch/fix-observability-2026-07-07.md`, predates today. |
| `artifacts/api-server/__mint-agent-session.mts` (M, 34 ln) | session-today/docs | high | Dev/QA helper script edits (DB lookup instead of hardcoded user id, scratchpad path bump). |
| `lib/db/src/advisory-lock.ts` (M, 8 ln), `lib/db/src/index.ts` (M, 49 ln) | infra | high | Connection hygiene (`application_name`, `idle_in_transaction_session_timeout`) + new unused `tradingPool` export. |

### Pyrus-ui (boot/loader/login-gate — NOT calibration)

| file | lane | confidence | summary |
|---|---|---|---|
| `artifacts/pyrus/index.html`, `src/app/App.tsx`, `src/app/AppContent.tsx`, `src/app/bootProgress.ts`, `src/components/marketing/brandKitInstall.test.mjs`, `src/components/neural/NeuralBootOverlay.tsx`, `src/components/neural/NeuralLoader.tsx`, `src/components/neural/neuralOpenerState.ts`, `src/features/auth/LoginGate.jsx`, `src/index.css`, `src/main.tsx`, `src/vite.config.ts`, `src/features/platform/PlatformApp.jsx`, `src/features/platform/loadingFallbackTheme.test.mjs`, `src/components/neural/BootShellLayout.tsx` (new) | pyrus-ui | high | WO-BOOT-01/02 + WO-LOGIN-01 (today, 07-08): boot-neural WebGL entry removal, new shared `BootShellLayout`, split-panel login redesign. 1:1 correspondence to today's WO specs. |
| `artifacts/pyrus/src/boot-neural-scene.tsx` (D), `src/boot-neural.tsx` (D), `src/components/LogoLoader.tsx` (D), `src/components/marketing/brand-loader.tsx` (D), `src/components/marketing/neural-loader.tsx` (D), `src/components/marketing/neural-stage.tsx` (D), `src/components/ui/button.tsx` (D) | pyrus-ui | high | Dead-code deletions from the WO-BOOT-01 consolidation (button.tsx: WO-CR-02 explicitly marks this migration "SUPERSEDED" by WO-LOGIN-01). |
| `knip.json` (M, 2 ln) | pyrus-ui | high | Removes deleted boot-neural files from the knip ignore list. |
| `artifacts/pyrus/scripts/runDevApp.mjs` (M, 4 ln) | infra | high | Adds `PYRUS_DB_PROFILE`/`MARKET_DATA_WORKER_DB_POOL_MAX` env vars — DB-pooling plumbing, unrelated to boot UI. |

### SIGNAL-CALIBRATION lane (clean, whole-file-safe)

| file | confidence | summary |
|---|---|---|
| `artifacts/api-server/src/services/signal-monitor-actionability.ts` (M, 22 ln) | high | New `SIGNAL_MONITOR_BLOCK_PRIOR_SESSION_ENTRIES` gate — blocks entries whose crossover fired before the current session's open. |
| `artifacts/api-server/src/services/signal-monitor-actionability.test.ts` (new) | high | Tests the above. |
| `artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts` (M, 95 ln) | high | Backfilled-base tests, incl. FIX-02's `source` param plumbing (see entanglement — small, low-risk overlap). |
| `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts` (M, 68 ln) | high | Trading-day-aware `barsSinceSignal`, holiday handling, SMR regression tests. |
| `artifacts/api-server/src/services/signal-monitor-preserve-bar-metadata.test.ts` (M, 4 ln) | high | Trading-days barsSinceSignal aging. |
| `artifacts/api-server/src/services/signal-monitor-stream.test.ts` (M, 145 ln) | high | SSE delta persist-gating by dirty-key tests. |
| `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts` (new) | **ENTANGLED (small)** | high | Mostly calibration cache-key tests; the new promotion test + `source` param threading is FIX-02 (today). See entanglement detail. |
| `artifacts/api-server/src/services/signal-options-automation.test.ts` (M, 269 ln) | **ENTANGLED** | high | Majority calibration (tally/PICKUP/MTF/scale-out/exit tests); ~80 lines are WO-FIX-03 (abort-mid-scan, batch-cursor-resume tests) + WO-FIX-07 (MTF unset-default reconciliation). See entanglement detail. |
| `artifacts/api-server/src/services/signal-options-exit-policy.ts` (M, 61 ln) | high | Scale-out policy (`scaleOutArmed`/`exitQuantity`/`runnerGivebackPct`) + high-quality overnight-runner-giveback knob. |
| `artifacts/api-server/src/services/signal-options-greek-trail.test.ts` (M, 2 ln) | high | Bumps stale-greek threshold 15s→45s (matches WO-SO-06 `DEFAULT_WIRE_GREEK_TRAIL_MAX_AGE_MS`). |
| `artifacts/api-server/src/services/signal-options-overnight-exit.test.ts` (M, 57 ln) | high | High-quality overnight runner-giveback knob tests (signal-options exit-policy domain — NOT the separate overnight-signal-expectancy feature). |
| `artifacts/api-server/src/services/signal-options-position-fold.test.ts` (M, 6 ln — became dirty mid-session, see drift note) | high | Golden-fixture fields for opposite-signal dual-confirm (WO-SO-02) + reentry-watch (WO-SO-03). |
| `artifacts/api-server/src/services/signal-options-trailing-ratchet.test.ts` (M, 68 ln) | high | Exit-policy trailing-ratchet tests. |
| `artifacts/api-server/src/services/signal-options-opposite-dual-confirm.test.ts` (new) | high | WO-SO-02 deliverable. |
| `artifacts/api-server/src/services/signal-options-reentry-watch.test.ts` (new) | high | WO-SO-03 deliverable. |
| `artifacts/api-server/src/services/signal-options-scale-out.test.ts` (new) | high | WO-SO-01 deliverable. |
| `artifacts/api-server/src/services/backtesting-dte.test.ts` (new) | high | `calculateDte` trading-day math tests, cites Wave-2 C1 / `handoff-signal-options-lane-2026-07-07.md`. |
| `lib/backtest-core/src/option-greek-selector.ts` (M, 31 ln), `option-greek-selector.test.ts` (M, 50 ln) | high | DST bug fix in Black-Scholes time-to-expiration via `resolveNyseCalendarDay`. |
| `lib/backtest-core/src/signal-options.ts` (M, 167 ln), `signal-options.test.ts` (M, 125 ln) | high | MTF `requiredCount` resolver, DTE via `tradingDaysBetween`, scale-out/exit-policy schema. Untouched by any WO-FIX. |
| `lib/backtest-core/package.json` (M, 1 ln) | high | Adds `@workspace/market-calendar` dep. |
| `lib/market-calendar/src/index.ts` (M, 188 ln), `index.test.mjs` (M, 152 ln) | high | New additive trading-day/RTH-bar exports (see correction #1). |
| `scripts/src/shadow-options-management-review.ts` (M, 4 ln) | high | `exitReason` payload coalesce fallback. |
| `scripts/src/signal-options-exit-policy-sweep.ts` (M, 6 ln) | high | Env-overridable greek-max-age default (WO-SO-06). |
| `scripts/src/signal-options-greek-selector-smoke.ts` (M, 256 ln) | high | Wires `gex-historical-greeks.ts` into greek-selector candidate re-scoring/provenance. |
| `scripts/src/gex-historical-greeks.ts` (new) | high | WO-SO-06 deliverable — read-only `gex_snapshots` adapter. |
| `scripts/src/signal-options-gex-match-rate-analysis.ts` (new) | high | WO-SO-06 deliverable — match-rate report script. |
| `scripts/src/shadow-options-post-exit-enrich.ts` (new) | high | WO-SO-01 deliverable — backfills `postExitOutcome`. |
| `scripts/reports/shadow-options-management-review/{2026-07-07T23-54-31-944Z,2026-07-07T23-55-31-225Z,2026-07-08T01-27-35-765Z}/` (new dirs) | medium | Timestamped output artifacts of the review script above. Not gitignored; project precedent exists for committing these (older timestamped dirs are already tracked). Judgment call — safe to include or drop. |
| `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx` (M, 90 ln) | high | Blocked-signal display, raw-price-move color, new `resolveCandidateGateWorkOut` MTF gate breakdown. No gatewayReady content (checked full diff). |
| `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx` (M, 7 ln) | high | Renders hydrating rows instead of hiding them ("Owner report 2026-07-08"). |
| `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs` (M, 13 ln) | high | Tests the above. |
| `artifacts/pyrus/src/screens/algo/algoTimeframeControls.js` (M, 41 ln), `algoTimeframeControls.test.mjs` (M, 25 ln) | high | MTF `requiredCount` threading through timeframe-selection patches. |
| `artifacts/pyrus/src/screens/algo/algoSettingsFields.js` (M, 5 ln) | high | Preset `requiredCount` clamp fix. |
| `artifacts/pyrus/src/screens/SignalsScreen.jsx` (M, 7 ln) | high | Null-safe age formatting (`Number(null)===0` guard). |
| `artifacts/pyrus/src/screens/algo/algoHelpers.js` (M, 65 ln) | **ENTANGLED (small)** | high | Mostly calibration (MTF preset defaults, raw-move display, new gate-workout fn); ~9 ln is WO-FIX-07's `requiredCount` ternary fix. See entanglement detail. |
| `artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs` (M, 117 ln) | **ENTANGLED (small)** | high | Mostly calibration; one test block reconciled by WO-FIX-07. |

### Entangled files needing hunk-level split

**`artifacts/api-server/src/services/shadow-account.ts`** (258 ln changed) — three strands:
- **calibration**: import block (`addTradingDays`, `previousTradingDayOrSame`, `rthBarsBack` from
  `@workspace/market-calendar`, ~L14-19); `SignalOptionsShadowExitEventRow.payload` + partial-scale-out
  dedup guard in `signalOptionsShadowExitEventIsDuplicate`/`hasExistingSignalOptionsShadowExitEvent`
  (~L4939-4990); `previousWeekdayOrSame`/`addWeekdaysToMarketDate` rewritten onto
  `previousTradingDayOrSame`/`addTradingDays` (~L12141-12180); `watchlistBacktestHydrationStart`
  rewritten onto `rthBarsBack`/`addTradingDays` (~L12654-12680); the 3 new exports of those fns in
  `__shadowWatchlistBacktestInternalsForTests` (~L14705-14709).
- **fix-session-today (WO-FIX-05)**: `ShadowResolvedMark`/`ShadowPositionMarkRefreshWrite` types
  (~L277-300); `resolveEquityMarkForTests` var (~L557-563); `resolveEquityMark` return-type alias +
  new `resolveEquityMarkForShadowRefresh` (~L3828-3880); new `writeShadowPositionMarkBatch` +
  `refreshShadowPositionMarks` batching refactor (~L6064-6260); `setResolveEquityMarkForTests`
  export (~L14682-14684).
- Companion test files: `shadow-account-signal-options-exit-dedup.test.ts` (M, 18 ln, whole file =
  calibration, tests the partial-scale-out dedup above) is clean calibration.
  `shadow-account-read-cache.test.ts` (M, 240 ln) and `shadow-account-latest-marks.test.ts` (M, 29
  ln — both became dirty mid-session, see drift note) are 100% WO-FIX-05 test additions (batch
  query-capture assertions) — NOT calibration, do not land with the calibration commit.

**`artifacts/api-server/src/services/signal-monitor.ts`** (1582 ln changed) — three strands:
- **calibration (majority)**: essentially everything not called out below — tally/PICKUP,
  MTF-gate plumbing, quiet-market-session handling, backfilled-base mechanics' core logic, event
  anchor/backfill, stored-signal-state reads, etc. (confirmed as "workstream-A signal calibration"
  by the WO-FR-02 read-only reviewer).
- **fix-session-today (WO-FIX-02)**: `SignalMonitorBackfilledBaseEntry.contentStamp` field
  (diff ~L5215-5220 old-numbering); `rememberSignalMonitorBackfilledBaseBars` `source` param +
  contentStamp-preserve-on-promotion logic (~L5364-5388); `promoteSignalMonitorBackfilledBaseFromStream`
  passes `source: "stream-promotion"` (~L5410-5416); backfill call site passes `source: "backfill"`
  (~L5625-5631); two dirty-key comment/code updates swapping `refreshedAt`→`contentStamp`
  (~L8428-8434, ~L9781-9789); `seedSignalMonitorBackfilledBaseForTests` simplified to a direct alias
  (~L14095-14106).
- **db-demand-07-07 (not calibration, not today)**: `loadSignalMonitorCatalogExpansionSymbols` /
  `resolveSignalMonitorUniverseFromWatchlists` JOIN-memoization hunks (diff ~L3854-3934 new-numbering)
  — tested by the new `signal-monitor-db-demand.test.ts`, not part of the calibration scoring logic.
- Companion tests `signal-monitor-stream-completed-bars-cache.test.ts` (new) and
  `signal-monitor-backfill-base.test.ts` (M) each carry a handful of `source: "backfill"` param
  additions (FIX-02) mixed into otherwise-calibration test bodies — low-risk, mechanical
  (adding a required param to existing calls), safe to leave in either commit but technically
  FIX-02's.

**`artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`** (124 ln changed) —
two strands:
- **calibration** (pre-existing before today, from the same signal-quality-KPI/holiday-fidelity
  work): market-calendar import (`resolvePreviousUsEquitySessionClose`,
  `resolveUsEquityMarketSession`); `DEFAULT_MEMORY_RETENTION_MS` 72h→120h + holiday-weekend comment;
  `ROLLUP_RECENT_WINDOW_MS` comment update; new `rollupScanCutoffMs` function (session-aware
  rollup-scan-window widening across weekend/holiday gaps) and its use in `enqueueRollups`.
- **fix-session-today (WO-FIX-01 + WO-FIX-04)**: `MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS` +
  cadence-bound pruning machinery (`shouldPruneMinuteBarsForSymbol`, `pruneMinuteBarsForSymbol`,
  `minuteBarLastPrunedAtMsBySymbol`, prune counters); `storeMinuteBar` refactor to call it;
  `readMemoryBars` retention filter; the `enqueueRollups` early-return guard for
  `liveAggregatePersistEnabled()`; matching internals-reset/getter additions.
- Companion tests `signal-monitor-local-bar-cache-rollup.test.ts` (M, 95 ln) and
  `signal-monitor-local-bar-cache.test.ts` (M, 140 ln) mirror the same split (holiday-weekend-
  retention / weekend-gap-rollup tests = calibration; disabled-persistence-skip test + minute-
  retention-pruning-cadence test = FIX-01/04).

**`artifacts/api-server/src/services/signal-options-automation.ts`** (1213 ln changed) — two
strands:
- **calibration (majority)**: tally/PICKUP authority-flip machinery, MTF entry-gate
  (`requiredSignalOptionsMtfCount`), Greek-selector integration, scale-out/reentry/opposite-signal
  logic, exit-policy wiring — everything not called out below.
- **fix-session-today (WO-FIX-03)**: `shouldRefreshSignalOptionsMonitorState` `signal?: AbortSignal`
  param + `throwIfSignalOptionsScanAborted` checkpoint (~L6137-6173); signal param pass-through at
  the caller (~L6288-6293); batch-cursor `nextIndex: startIndex` fix + new
  `rememberSignalOptionsMonitorBatchSymbolProcessed` (~L6101-6141); its export (~L21430).
- `signal-options-automation.test.ts` (M, 269 ln): ~40 ln new abort-mid-scan test + ~35 ln new
  batch-cursor-resume test (both WO-FIX-03) + ~15 ln MTF-unset-default reconciliation (WO-FIX-07);
  remainder (~180 ln) is calibration.

**`artifacts/api-server/src/services/backtesting.ts`** (M, 54 ln) — two strands:
- **calibration**: `calculateDte` now uses `tradingDaysBetween` ("Wave-2 C1... product ruling
  2026-07-07") + trailing `__backtestingInternalsForTests` export.
- **fix-session-today**: `resolveBacktestDeploymentSignalOptionsSnapshot` moved outside
  `db.transaction` in `createBacktestRun`/`createBacktestSweep` to avoid a pool self-deadlock.

**`artifacts/api-server/src/services/platform.ts`** (M, 227 ln) — three strands:
- **calibration**: `requireFreshHistorical` bars-freshness plumbing (`GetBarsInput`, cache
  key/scope, `isRequiredFreshHistoricalResponseIncomplete`) — sole caller is
  `artifacts/backtest-worker/src/index.ts:529` (the calibration-linked backtest-fidelity code).
- **fix-session-today**: background-persist queue coalescing/dedup/bounding
  (`BarsBackgroundPersistQueueEntry`, tested by new `platform-bars-background-persist.test.ts`).
- **pressure-directive-07-07**: full removal of `shouldYieldOptionChainBatchForPressure`/
  `pressureDeferred` from `batchOptionChains`.

**`artifacts/api-server/src/routes/platform.ts`** (M, 4 ln) — two strands:
- **pressure-directive-07-07 or fix-session**: `SPARKLINE_SEED_DB_BATCH_SIZE` 4→64.
- **calibration**: `requireFreshHistorical` added to two route allowlists (plumbing for the
  platform.ts feature above).

**`artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx`** (M, 10 ln):
`gatewayReady`→`marketDataReady` rename (ibkr-datapath-removal) in the `resolveAlgoMonitorReadinessStatus`
return object, interleaved with a `requiredCount: source?.requiredCount ?? ...` calibration hunk
("product ruling 2026-07-07") a few lines below in the same file.

**`artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`** (M, 24 ln): the
"algo header labels readiness as market data" test = ibkr-removal; the "STA MTF config uses the
configured draft timeframe set" test block = calibration.

**`artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.test.mjs`** (M, 24 ln): the
"info-only options session pause ... not market-data warning" rename test = ibkr-removal; the
`currentSignalDirection` (vs `trendDirection`) MTF-gate test = calibration.

**`artifacts/pyrus/src/screens/algo/algoHelpers.js`** (M, 65 ln): the single
`requiredCount: mtfAlignmentConfig?.requiredCount ?? timeframes.length` hunk in
`staRowPassesMtfAlignment` (~L762-770) is WO-FIX-07; everything else (MTF preset defaults, raw-move
display, `resolveCandidateGateWorkOut`) is calibration. Low-risk: FIX-07's own report frames this as
"reconciling" pre-existing calibration work, so taking the whole file is defensible, but flagging
per the task's instruction to be exact.

**`artifacts/backtest-worker/src/index.ts`** (M, 821 ln): ~750 ln overnight-expectancy pipeline +
~40 ln calibration (`deploymentSignalOptionsProfile`/`resolveWorkerSignalOptionsProfile` wiring
through `runOptionsBacktest`/`executeStudyRun`/`processSingleRun`/`processSweep`, confirmed by
commit `62da9240`'s message calling this out as deferred work) + ~30 ln general `fetchBarsRange`
retry-on-incomplete-history plumbing (other, not calibration-specific).

**`pnpm-lock.yaml`** (M, 6 ln): two hunks, two importers gaining `@workspace/market-calendar:
workspace:*` — `artifacts/backtest-worker` (backs overnight-expectancy) vs `lib/backtest-core`
(backs calibration/`option-greek-selector.ts`). Splits cleanly by importer path.
