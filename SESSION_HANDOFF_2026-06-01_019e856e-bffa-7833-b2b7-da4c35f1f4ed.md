# Session Handoff — 2026-06-01

## Session Metadata

- Session ID: `019e856e-bffa-7833-b2b7-da4c35f1f4ed`
- Saved At (MT): `2026-06-01 17:42:24 MDT`
- Saved At (UTC): `2026-06-01T23:42:24Z`
- Summary: Streamed footer memory pressure bars with runtime consumption plus wave-backed Algo status badge.
- Repo Root: `/home/runner/workspace`
- Thread CWD: `/home/runner/workspace`
- Rollout Path: `/home/runner/.codex/sessions/2026/06/01/rollout-2026-06-01T17-04-48-019e856e-bffa-7833-b2b7-da4c35f1f4ed.jsonl`
- Branch: `main`
- HEAD: `5bfe96e71a6028cfd1f7994cc80debefffe60711`
- Latest Commit: `fix: harden shadow signal-options monitoring`
- Latest Commit Session ID: `unknown`
- Title: please pick up this session: └ SESSION_HANDOFF_CURRENT.md (+20 -18) 4 5 -- Last Updated (MT): `2026-06-01 16:5 3:15 MDT…
- Model: `gpt-5.5`
- Reasoning Effort: `xhigh`
- Tokens Used: `3679791`

## Latest Update — 2026-06-01 18:04:18 MDT

### Runtime Consumption Footer Correction

- Corrected the fourth compact footer bar after user clarification: active worker/poller/stream counts are metadata, not memory pressure.
- `MEMORY_PRESSURE_THRESHOLDS.workload` now has inert thresholds, so high active worker counts cannot mark workload high/critical.
- The fourth compact footer bar now renders `Runtime` instead of `Workload` and fills from runtime store/cache footprint (`storeEntryCount`) using the existing runtime-store thresholds.
- Workload counts remain available in driver details, but the threshold table no longer presents guessed active-work/poll/stream pressure thresholds.
- No backend fixes were needed for this correction; the streamed API RSS/heap path from the previous slice remains intact.
- No Replit startup config was changed.

### Validation

- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/memoryPressureModel.test.js`: pass, 18/18.
- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/features/platform/useMemoryPressureSignal.test.js src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/memoryPressureModel.test.js`: pass, 26/26.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- Scoped `git diff --check` for touched memory pressure model/component/popover/test files: pass.

### Remaining

1. Optional live visual QA can be done later if Playwright or the project browser QA harness is available.
2. Logo/sidebar follow-up remains separate from this footer memory work.

## Previous Update — 2026-06-01 17:56:19 MDT

### Streamed Footer Memory Pressure Bars

- Updated the footer memory pressure data path so API RSS and API heap now consume `/api/diagnostics/stream` through `EventSource` `ready` and `snapshot` events when available.
- Kept `/api/diagnostics/latest` as a fallback-only path for browsers without `EventSource`; safe QA mode still skips server diagnostics streaming.
- Changed workload pressure to update from the local runtime workload subscription immediately instead of waiting for the memory sample loop.
- Browser memory remains locally sampled because `performance.memory` and `measureUserAgentSpecificMemory` are measurement APIs, not push/event streams.
- Preserved the four horizontal compact bars: `Browser`, `RSS`, `Heap`, and `Workload`.
- Live SSE probe confirmed the running app emits both `ready` and `snapshot` events with `footerMemoryPressure.apiRssMb` and backend `apiRssThresholds`.
- No Replit startup config was changed.

### Validation

- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/features/platform/useMemoryPressureSignal.test.js src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/memoryPressureModel.test.js`: pass, 25/25.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/diagnostics.test.ts src/services/resource-pressure.test.ts`: pass, 40/40.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- `timeout 5s curl -N -sS 'http://127.0.0.1:18747/api/diagnostics/stream'`: returned `ready` and `snapshot` events including footer memory RSS data.
- Final scoped `git diff --check` across touched memory, diagnostics, CSS, and handoff files: pass.

### Remaining

1. Optional live visual QA can be done later if Playwright or the project browser QA harness is available.
2. Logo/sidebar follow-up remains separate from this footer memory work.

## Previous Update — 2026-06-01 17:55:11 MDT

### Wave-Backed Algo Status Badge

- Moved the reused `IbkrStatusWave` into the visible Algo top operations header in `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`, directly beside `Pyrus Signal-Options`.
- Updated the top header wave to use the same stream-state color tokens and animation mapping as the other header sine waves:
  - `healthy`: fast green wave,
  - `checking`, `capacity-limited`, `reconnecting`: slow wave using stream token colors,
  - `offline`, `no-subscribers`, and other inactive states: flat wave using stream token colors.
- Associated the wave with the status badge itself. The visible badge text now comes from the same `headerScanWave` resolver as the wave state/color/motion:
  - `running`,
  - `scanning`,
  - `syncing`,
  - `attention`,
  - `critical`,
  - `paused`.
- Removed the separate `running`/`paused` header chip from `headerStatusItems`, so the wave-backed badge is the single deployment/scan status text.
- Removed the rendered `OperationsStatusOrb` from the top header position, so the previous red critical button is replaced by the wave's red/offline critical state.
- Combined the pause/resume and scan-now controls into one compact `Signal-options scan controls` action group, while preserving the two distinct accessible button actions.
- Kept the lower signal-table wave from the earlier slice.
- No Replit startup config was changed.

### Validation

- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/OperationsSignalRow.test.js`: pass, 16/16.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- `pnpm --filter @workspace/pyrus run build`: pass.
- `git diff --check -- artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`: pass.
- Safe dev-server source check on `http://127.0.0.1:18747/src/screens/algo/AlgoLivePage.jsx?t=header-wave-mapping-check`: found `streamStateTokenVar`, `resolveHeaderScanWaveMotion`, and `algo-operations-header-wave`.
- Safe dev-server source check on `http://127.0.0.1:18747/src/screens/algo/AlgoLivePage.jsx?t=header-wave-badge-check`: found `algo-operations-header-wave-badge` and synced `badgeLabel` source.

### Remaining

1. Restart through Replit's normal Run App path if needed.
2. Visually inspect the Algo top wave-backed status badge/replaced critical state and combined controls.

## Latest Update — 2026-06-01 17:43:34 MDT

### Footer Memory Pressure Bars

- Implemented the footer memory indicator follow-up requested after investigation: the compact footer memory meter now renders four horizontal dynamic bars for `Browser`, `RSS`, `Heap`, and `Workload` instead of a single fill plus three narrow vertical meters.
- Added backend diagnostics data needed for correct scaling: `footerMemoryPressure` and the `resource-pressure` snapshot now include `apiRssMb` and `apiRssThresholds`, using the same backend resolver as API resource-pressure gating.
- Threaded `apiRssMb` and `apiRssThresholds` through the Pyrus memory pressure store/merge path so API RSS and API heap remain separate in footer UI state.
- Preserved the existing footer pill, `Memory` label, level text, tooltip, and popover. The existing `showCompactLabel` preference now hides/shows labels, not the bars themselves.
- Kept non-memory resource pressure out of the footer memory level/fill; latency/cache pressure can still be seen in diagnostics but does not fill the memory bars.
- Browser QA note: root and Pyrus workspaces do not currently have Playwright installed, so no live browser screenshot was taken in this pass. SSR render tests cover the footer DOM/inline styles, and the running app diagnostics endpoint confirmed the new RSS payload is present.

### Validation

- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/useMemoryPressureSignal.test.js src/features/platform/memoryPressureModel.test.js`: pass, 24/24.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/diagnostics.test.ts src/services/resource-pressure.test.ts`: pass, 40/40.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- Scoped `git diff --check` for the touched memory diagnostics/footer files: pass.
- Running app diagnostics probe: `/api/diagnostics/latest` returned `footerMemoryPressure.apiRssMb` plus `apiRssThresholds` and matching resource-pressure RSS thresholds.

### Remaining

1. Optional live visual QA can be done later if Playwright or the project browser QA harness is available.
2. Logo/sidebar follow-up remains separate from this footer memory work.

## Previous Update — 2026-06-01 17:42:24 MDT

### Overview/Pipeline Spacing Tightening

- Tightened the Algo top overview block the user called out: `P&L`, `Exposure`, `Risk`, `Record`, then `Signal Cycle`, `Entry Path`, `Orders`, and `Management`.
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx` now uses smaller overview wrapper gaps/padding and slightly narrower metric grid tracks.
- `artifacts/pyrus/src/screens/algo/AlgoOperationsPrimitives.jsx` now renders shorter metric cards and grouped phase buttons with reduced min-heights, padding, gaps, and count font size.
- The settled browser view renders the metric row at about `43px`, the grouped phase row at about `36px`, and the full overview section at about `132px` when the compact attention row is present.
- Safe browser screenshot: `/tmp/pyrus-algo-top-spacing-tightened-settled.png`.
- No Replit startup config was changed.

### Validation

- `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern "algo pipeline overview groups redundant stage counts into phases|algo live page upper area suppresses empty duplicate status strips" src/screens/algo/OperationsSignalRow.test.js`: pass, 2/2.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/algoHelpers.test.js --test-name-pattern "algo operations views|algo screen auto-runs|algo display surfaces"`: pass, 34/34 in file run.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- `git diff --check -- artifacts/pyrus/src/screens/algo/AlgoOperationsPrimitives.jsx artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`: pass.
- Safe Playwright QA at `http://127.0.0.1:18747/?pyrusQa=safe`: pass. Explicit selectors found the operations header, overview, pipeline strip, and settled `Management` phase; no console warnings/errors or page errors.

### Validation Caveat

- Full `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/OperationsSignalRow.test.js` currently fails 13/16 on unrelated signal-table assertions around `algo-signal-plan-cell`, `const PlanCell`, default dense action columns, and `SIGNAL_COLUMN_VISIBILITY_VERSION = 5`. The overview/pipeline tests in that same file pass.

### Remaining

1. Optionally tighten or redesign the lower compact `Attention` row as a separate pass.
2. Keep API/runtime pressure triage separate from this visual spacing work.

## Latest Update — 2026-06-01 17:38:28 MDT

### Signal Table Scan Wave

- Reused the existing `IbkrStatusWave` animated sine wave in `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`.
- The wave now sits beside the Algo signal table scan/freshness line and derives its state from the existing `freshness` object:
  - active scan: fast green wave,
  - pressure-queued action scan: slow amber wave,
  - stale scan: static amber wave,
  - recent quiet scan/data: slow cyan wave,
  - no scan/data yet: static muted wave.
- Added source-level regression assertions in `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`.
- No Replit startup config was changed.

### Validation

- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/OperationsSignalRow.test.js`: pass, 15/15.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- `pnpm --filter @workspace/pyrus run build`: pass.
- Safe dev-server source check on `http://127.0.0.1:18747/src/screens/algo/OperationsSignalTable.jsx?t=wave-check`: found `IbkrStatusWave`, `resolveSignalScanWave`, and `algo-signal-scan-wave`.
- `git diff --check -- artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`: pass.

### Remaining

1. Visually inspect the signal-table wave in the normal app session.
2. Continue the already noted API runtime-pressure triage separately.

## Latest Update — 2026-06-01 17:34:49 MDT

### Algo Top-Area Cleanup

- Continued the Algo page upper-area cleanup requested from the prior `019e84aa-c1d5-79e1-adba-5a743d03c8cc` UI slice.
- Removed the standalone `LazyAlgoStatusBar` mount from `artifacts/pyrus/src/screens/AlgoScreen.jsx`, so the Algo route no longer shows a separate top band above the live operations page.
- Consolidated account, deployment, data, running, and market-state context into the `Pyrus Signal-Options` operations header in `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`.
- Added compact deployment display so `Pyrus Signals Options Shadow Paper` renders as `Shadow` in the header selector.
- Removed noisy header metadata: raw watchlist UUIDs and latest skipped-event copy no longer appear in the top area.
- Converted header pause/scan actions to icon-only controls with accessible labels, removing visible `Refresh`, `Disable`, `Run scan`, `PAUSE`, and `SCAN NOW` text from the upper area.
- Kept the four overview metrics and four grouped pipeline phases from the earlier cleanup: `P&L`, `Exposure`, `Risk`, `Record`, then `Signal Cycle`, `Entry Path`, `Orders`, and `Management`.
- Updated focused source tests and platform shell expectations for the consolidated operations header.
- No Replit startup config was changed.

### Validation

- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/OperationsSignalRow.test.js`: pass, 15/15.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/algoHelpers.test.js --test-name-pattern "algo operations views|algo screen auto-runs|algo display surfaces"`: pass, 34/34 in file run.
- `pnpm --filter @workspace/pyrus run typecheck`: pass.
- Scoped `git diff --check` for touched UI/test files: pass.
- Safe Playwright QA at `http://127.0.0.1:18747/?pyrusQa=safe`: pass. Explicit readiness selectors found `algo-operations-header` and the four pipeline stages; no console warnings/errors or page errors.
- Browser QA confirmed no standalone `algo-status-bar`, no raw `wl <uuid>`, no old `Pyrus Signals Shadow`, no `Shadow scan`, no visible `Refresh`/`Disable`/`Run scan`/`Pause`/`Scan` in the header, and no `Candidate Skipped` in the header.
- QA screenshot: `/tmp/pyrus-algo-top-cleanup-final.png`.

### Remaining

1. Do a normal-session visual pass on the Algo page top area when convenient.
2. Consider a separate lower-area cleanup for the compact `Attention` list if it still feels too noisy after the header cleanup.
3. Triage API runtime pressure separately; the app was healthy during QA, but `/api/healthz` reported high pressure and the API process was resource-heavy.

## Latest Update — 2026-06-01 17:32:52 MDT

### Second Reload Check

- User restarted/reloaded again and asked to check before moving on.
- New app/API process was running from the normal artifact command, with API PID started at `2026-06-01 17:30:30 MDT`.
- Health check returned `200 OK`; route pressure headers reported `watch`.
- IBKR remained connected/authenticated/strict-ready with live market data available.
- Diagnostics remained degraded/warning overall, but API subsystem was `ok`; p95 was about `841ms`, RSS about `981MB` at the diagnostic snapshot. The API process was still CPU-heavy during checks.
- Forced paper Signal-Options scan completed successfully in about `2s`.
- Prior legacy `mtf_not_aligned` rows were fixed by the previous patch:
  - `ANET` re-emitted with `mtfSource: "signal_matrix"` and five directions.
  - `JOBY` re-emitted with `mtfSource: "signal_matrix"` and five directions.
- One legacy three-frame row remained: `GLD`, because its terminal reason was `greek_selector_no_candidates`, not `mtf_not_aligned`.
- Extended the forced-scan legacy retry policy to also retry `greek_selector_no_candidates` when the stored candidate lacks five-frame `signal_matrix` MTF. Existing five-frame failures remain terminal.
- Rebuilt `artifacts/api-server/dist/index.mjs`; the running process still needs one more normal Replit reload before this latest GLD fix is live.

### Validation

- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts --test-name-pattern "seen signal keys|five matrix MTF|MTF alignment|entry quality scores all five"`: pass, 125/125 in file run.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- `pnpm --filter @workspace/api-server run build`: pass.
- Scoped `git diff --check`: pass.

### Remaining

1. Restart/reload through Replit's normal Run Replit App path one more time so the GLD retry patch is live.
2. Force a paper Signal-Options scan.
3. Confirm candidate legacy MTF count is zero.

## Latest Update — 2026-06-01 17:27:40 MDT

### Post-Restart Five-Frame MTF Check

- User restarted/reloaded via the normal app path and asked for verification.
- Running app was up on artifact port `18747`; IBKR was connected/authenticated/strict-ready with live market data available.
- Diagnostics were degraded/warning, not critical. API p95 was about `687ms`; `/signal-monitor/matrix` p95 was about `1437ms`.
- API process remained hot after the manual check: `dist/index.mjs` around `1.8GB` RSS and roughly `60%` CPU.
- Forced paper Signal-Options scan completed in about `23s`.
- Fresh/retried rows such as `TDY`, `CCJ`, and `OKLO` showed `mtfSource: "signal_matrix"`, five `mtfTimeframes`, and five `mtfDirections`.
- Older terminal rows such as `JOBY`, `ANET`, and `NVDA` still showed legacy three-value MTF because prior `mtf_not_aligned` skips were considered seen and were not retried.
- Fixed the retry policy: a forced scan now retries `mtf_not_aligned` events only when the stored payload lacks five-frame `signal_matrix` MTF. Existing five-frame MTF failures remain terminal.
- Rebuilt `artifacts/api-server/dist/index.mjs`; the currently running API process still needs a normal Replit reload before this source change is live.

### Validation

- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts --test-name-pattern "seen signal keys|five matrix MTF|MTF alignment|entry quality scores all five"`: pass, 125/125 in file run.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- `pnpm --filter @workspace/api-server run build`: pass.
- Scoped `git diff --check`: pass.

### Remaining

1. Restart/reload through Replit's normal Run Replit App path again so the rebuilt API bundle is the running process.
2. Force a paper Signal-Options scan.
3. Confirm previously legacy `mtf_not_aligned` rows are re-emitted with `mtfSource: "signal_matrix"` and five-value `mtfDirections`.

## Latest Update — 2026-06-01 17:14:15 MDT

### Five-Frame Signal-Options MTF Pickup

- Picked up the active `019e8366-b25f-7921-bbd5-2bfc17403296` IBKR/diagnostics handoff, then continued the newer five-timeframe Signal-Options MTF work.
- Backend gate/read-model behavior now evaluates all available matrix frames in `1m`, `2m`, `5m`, `15m`, `1h` order instead of slicing to the legacy first three frames.
- `lib/backtest-core/src/signal-options.ts` normalizes `entryGate.mtfAlignment.requiredCount` up to `5`.
- `artifacts/api-server/src/services/signal-options-automation.ts` enriches candidates from the signal matrix and scores/blocks against the full MTF direction set.
- `artifacts/pyrus/src/screens/algo/algoHelpers.js`, `AlgoSettingsRegion.jsx`, and `algoSettingsFields.js` now align fallback scoring and settings copy with five-frame MTF.
- Focused API, Pyrus, and backtest-core tests/typechecks/builds passed; `pnpm run typecheck:libs` was blocked by the hot-runtime guard, so targeted backtest-core no-emit typecheck was used.
- The active pointer remains `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`, which now contains the detailed current status for this picked-up workstream.

### Remaining

1. Restart/reload through Replit's normal Run Replit App path before relying on the live bundle.
2. Force or wait for a fresh paper Signal-Options scan and verify candidate payloads show five-value `mtfDirections` and `x/5` diagnostics.
3. Continue API RSS/CPU and data-line pressure triage after the five-frame read model is confirmed live.

## Current User Request

please pick up this session:
  └ SESSION_HANDOFF_CURRENT.md (+20 -18)
     4
     5 -- Last Updated (MT): `2026-06-01 16:5
        3:15 MDT`
     6 -- Last Updated (UTC): `2026-06-01T22:
        53:15Z`
     7 -- Native Codex Session ID: `019e84aa-
        c1d5-79e1-adba-5a743d03c8cc`
     8 -- Summary: STA audit plus Algo page u
        pper-area UI cleanup.
     9 -- Handoff: `SESSION_HANDOFF_2026-06-0
        1_019e84aa-c1d5-79e1-adba-5a743d03c8c
        c.md`
     5 +- Last Updated (MT): `2026-06-01 16:5
        9:31 MDT`
     6 +- Last Updated (UTC): `2026-06-01T22:
        59:31Z`
     7 +- Native Codex Session ID: `019e8366-
        b25f-7921-bbd5-2bfc17403296`
     8 +- Summary: IBKR launch / diagnostics
        session, now focused on signal-matrix
         pressure handling.
     9 +- Handoff: `SESSION_HANDOFF_2026-06-0
        1_019e8366-b25f-7921-bbd5-2bfc1740329
        6.md`
    10  - Master Index: `SESSION_HANDOFF_MAST
        ER.md`
       ⋮
    13
    14 -- Algo page upper area now uses `Pyru
        s Signal-Options` header copy.
    15 -- Redundant Scan/Event/Signals/Flow o
        verview tiles were removed.
    16 -- Overview metrics now focus on `P&L`
        , `Exposure`, `Risk`, and `Record`.
    17 -- The eight pipeline stages now rende
        r as four grouped phases: `Signal Cyc
        le`, `Entry Path`, `Orders`, and `Man
        agement`.
    18 -- Empty activity/attention/transition
         filler is suppressed in the upper ar
        ea, so `Since ... no change`, `Attent
        ion All clear`, and `Last 60s Awaitin
        g next scan` no longer show there whe
        n no signal exists.
    19 -- Visible scan toast copy now says `S
        ignal-options scan ...` instead of ol
        d `Shadow scan ...`.
    14 +- Restart check confirmed the app is
        serving full five-timeframe matrix co
        de: `1m`, `2m`, `5m`, `15m`, `1h`.
    15 +- Fixed pressure visibility gap: gene
        rated API responses now dispatch `pyr
        us:api-pressure` from route-admission
         headers, including shed/error respon
        ses.
    16 +- Memory-pressure monitor consumes th
        ose headers and holds stricter header
         pressure for 15s so a critical shed
        signal cannot be immediately overwrit
        ten by a lower-pressure response.
    17 +- Matrix scheduling now reads live pr
        essure at dispatch time, recomputes t
        he active request task limit from tha
        t live pressure, and uses a browser-t
        ab global lease to avoid duplicate st
        artup/HMR/remount matrix POSTs.
    18 +- Browser QA under real `watch` press
        ure sent one full active Signals requ
        est: `30 symbols x 5 timeframes = 150
        ` tasks, completing in about `3189ms`
        .
    19 +- Browser QA with injected `critical`
         pressure sent exactly one clamped re
        quest: `2 symbols x 5 timeframes = 10
        ` tasks.
    20 +- API process remains resource-heavy
        after QA, around `1.2GB` RSS and `45%
        ` CPU. That is the next runtime risk.
    21  - No Replit startup config was change
        d.
       ⋮
    24
    24 -- `pnpm --filter @workspace/pyrus exe
        c node --import tsx src/screens/algo/
        OperationsSignalRow.test.js`: pass, 1
        5/15.
    25 -- `pnpm --filter @workspace/pyrus exe
        c node --import tsx src/screens/algo/
        algoHelpers.test.js`: pass, 33/33.
    25 +- `node --import tsx --test src/featu
        res/platform/useMemoryPressureSignal.
        test.js src/features/platform/platfor
        mRootSource.test.js src/features/plat
        form/signalMatrixScheduler.test.js` f
        rom `artifacts/pyrus`: pass, 92/92.
    26 +- `pnpm --filter @workspace/api-clien
        t-react run test:unit`: pass, 18/18.
    27 +- `pnpm --filter @workspace/api-clien
        t-react run typecheck`: pass.
    28  - `pnpm --filter @workspace/pyrus run
         typecheck`: pass.
    27 -- Scoped `git diff --check` for touch
        ed UI/test files: pass.
    28 -- `pnpm --filter @workspace/pyrus exe
        c node --import tsx src/features/plat
        form/platformRootSource.test.js`: fai
        led 56/57 on an unrelated `PlatformAp
        p` signal-matrix source assertion.
    29 +- `pnpm --filter @workspace/pyrus run
         build`: pass.
    30 +- Scoped `git diff --check`: pass.
    31
       ⋮
    33
    32 -1. Browser-dogfood the Algo page uppe
        r area with `?pyrusQa=safe` and expli
        cit readiness selectors.
    33 -2. If desired, separately fix or upda
        te the unrelated `platformRootSource.
        test.js` signal-matrix assertion.
    34 -3. Continue the regular-session STA/G
        reek diagnostics once fresh market-se
        ssion data is available.
    34 +1. Triage residual API RSS/CPU pressu
        re. The matrix critical clamp is fixe
        d, but the API process is still hot.
    35 +2. Decide whether active Signals `wat
        ch` state should keep the current `15
        0` cell foreground budget or step dow
        n below critical only after more evid
        ence.
    36 +3. Continue the next issue from this
        session once runtime resource pressur
        e is stable.

  └ SESSION_HANDOFF_MASTER.md (+1 -1)
    10  | 2026-06-01 15:14:53 MDT | `019e838b
        -6af5-7b72-b4aa-ee78a7bd3449` | Greek
        -selected entries, exit-policy sweep
        controls, non-enforcing Greek positio
        n diagnostics, and shadow readiness g
        ate. | `SESSION_HANDOFF_2026-06-01_01
        9e838b-6af5-7b72-b4aa-ee78a7bd3449.md
        ` | Diagnostics enabled on shadow onl
        y; wire trail/enforcement remains dis
        abled; readiness gate is pending regu
        lar-session marks; focused validation
        s passed. | Run Greek diagnostics `--
        require-ready` after next regular-ses
        sion position mark, then run manageme
        nt review and evaluate evidence befor
        e any enforcement. |
    11 -| 2026-06-01 16:52:05 MDT | `019e8366
        -b25f-7921-bbd5-2bfc17403296` | IBKR
        Gateway launch / line diagnostics plu
        s STA/algo signal-bubble foreground h
        ydration tuning. | `SESSION_HANDOFF_2
        026-06-01_019e8366-b25f-7921-bbd5-2bf
        c17403296.md` | Active Signals/Algo m
        atrix requests use foreground budget
        normal/watch 150 cells; live retry co
        nfirmed API/web up, profile MTF requi
        redCount=1, manual shadow scan comple
        ted, and current STA selectingCount=0
         with 8 terminal blocked candidates.
        | Browser-confirm STA bubbles/blocked
         option cells; inspect GLD Greek sele
        not contract-selection spin. |
    11 +| 2026-06-01 16:59:31 MDT | `019e8366
        -b25f-7921-bbd5-2bfc17403296` | IBKR
        Gateway launch / line diagnostics plu
        s signal-matrix pressure hardening. |
         `SESSION_HANDOFF_2026-06-01_019e8366
        -b25f-7921-bbd5-2bfc17403296.md` | Fu
        ll five-timeframe matrix retained; AP
        I route pressure headers now reach th
        e client, critical state clamps activ
        e Signals to 10 tasks, global lease p
        revents duplicate startup matrix POST
        s, and focused validations pass. API
        still hot around 1.2GB RSS / 45% CPU.
         | Triage residual API RSS/CPU pressu
        re; decide if `watch` active-screen 1
        ification. | `SESSION_HANDOFF_2026-06
        -01_019e84aa-83ed-7462-8cd5-1c29cc47f
        bd7.md` | Post-restart verified: sign
        al monitor `90/90`, paper STA `9` fre
        sh candidates, cockpit contract detai
        l says `9 candidates blocked before c
        ontract selection`, safe browser read
         shows no `Heavy deferred` or stale d
        eferred copy. | Watch next regular-se
        ssion 5m signal close for end-to-end
        STA timing; instrument Massive aggreg
        ate -> signal state -> STA candidate
        only if delays recur. |

─────────────────────────────────────────────

• Handoff is now aligned to this session. I’m
  doing a last consistency pass on the
  handoff files and diff status before I
  summarize the actual fix and remaining
  risk.

• Explored
  └ Read SESSION_HANDOFF_CURRENT.md

• Ran git status --short --
  │ SESSION_HANDOFF_CURRENT.md
  │ SESSION_HANDOFF_MASTER.md
  │ … +17 lines
  └  M SESSION_HANDOFF_CURRENT.md
     M SESSION_HANDOFF_MASTER.md
    … +16 lines (ctrl + t to view transcript)
    SESSION_HANDOFF_2026-06-01_019e8366-b25f-
    7921-bbd5-2bfc17403296.md

• Ran git diff --check --
  │ SESSION_HANDOFF_CURRENT.md
  │ SESSION_HANDOFF_MASTER.md
  │ … +17 lines
  └ (no output)

• Explored
  └ Read SESSION_HANDOFF_2026-06-01_019e8366-
         b25f-7921-bbd5-2bfc17403296.md
    Search 019e8366-b25f-7921-bbd5-
    2bfc17403296
           in SESSION_HANDOFF_MASTER.md

• Updated Plan
  └ ✔ Confirm restarted app is serving the
      intended matrix code
    ✔ Check API/runtime pressure and
      reproduce client behavior
    ✔ Fix matrix pressure handling and
      duplicate startup requests
    ✔ Validate tests, browser behavior, and
      update handoff

─────────────────────────────────────────────

• Checked after restart. The app did load the
  new full five-timeframe matrix code, but
  there were still real issues.

  Fixed:

  - API shed/pressure headers were not
    reaching the client, so diagnostics
    shedding made the frontend blind to
    critical pressure.

  - A later lower-pressure response could
    overwrite a stricter critical signal too
    quickly.

  - Matrix startup could double-fire under

  Changed:

  - lib/api-client-react/src/custom-fetch.ts
  - artifacts/pyrus/src/features/platform/
    useMemoryPressureSignal.js

  - artifacts/pyrus/src/features/platform/
    PlatformApp.jsx

  - related tests and handoff files

  Verified:

  - Real watch pressure: one active Signals
    request, 30 symbols x 5 timeframes = 150
    tasks, completed in ~3.2s.

  - Injected critical pressure: exactly one
    request, clamped to 2 symbols x 5
    timeframes = 10 tasks.

  - Full five timeframes remain intact.
  - App stayed up after the checks.

  Validation passed:

  - Pyrus platform tests: 92/92
  - @workspace/api-client-react unit tests:
    18/18

  - API client typecheck
  - Pyrus typecheck
  - Pyrus build
  - scoped git diff --check

  I also corrected SESSION_HANDOFF_CURRENT.md
  back to this session ID: 019e8366-b25f-
  7921-bbd5-2bfc17403296.

  Remaining issue: the API process is still
  hot after QA, roughly 1.2GB RSS and 45%
  CPU. The matrix critical clamp is fixed;

## Prior Handoffs

- `SESSION_HANDOFF_2026-06-01_75218067-d9b9-4264-8b7a-3243c1a06ca1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-d2bd-7103-91a9-a73c9fcfb9c1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-83ed-7462-8cd5-1c29cc47fbd7.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-1f90-7b41-b68e-5b0b7120b56c.md`
- `SESSION_HANDOFF_2026-06-01_019e8411-18fc-7911-9c4d-4aeecba402ac.md`
- `SESSION_HANDOFF_2026-06-01_019e83a8-59ca-7843-b17d-1eb1b26d5363.md`
- `SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md`
- `SESSION_HANDOFF_2026-06-01_019e8368-7762-7122-81b8-8a37bfbb0e60.md`
- `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`
- `SESSION_HANDOFF_2026-06-01_019e8361-9248-72a3-9743-ffd530b4d55e.md`
- `SESSION_HANDOFF_2026-05-31_019e80a2-9969-70a2-a92d-39cf6a379925.md`
- `SESSION_HANDOFF_2026-05-31_019e8076-ad60-7ee3-9c89-87f101b7545a.md`
- `SESSION_HANDOFF_2026-05-31_019e802e-8fc0-77a0-8857-7f3208f84734.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-7aa8-7832-9d3b-d9a1f55357d2.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-21e9-7bf1-961a-4c205f226e9e.md`
- `SESSION_HANDOFF_2026-05-31_019e7ff7-d9da-7333-9c5f-43f9156a8d45.md`
- `SESSION_HANDOFF_2026-05-31_019e7fc7-29fb-7991-9d61-98d6224fb6da.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa4-ed2e-70e1-ac7f-a54fee386518.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md`
- `SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md`
- `SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md`
- `SESSION_HANDOFF_2026-05-31_019e7e9b-e240-7c30-98d2-a1ad94723f11.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-c715-7200-b4a6-1bb0adf72b13.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-1f10-7e00-9474-efbb5051b670.md`
- `SESSION_HANDOFF_2026-05-30_019e7a9a-5ec9-7eb3-95f1-d0c5503ed8a0.md`
- `SESSION_HANDOFF_2026-05-30_019e7a20-0e2f-73f1-ae20-ddf1fb495be5.md`
- `SESSION_HANDOFF_2026-05-30_019e7995-e4a1-7bf2-b6a0-339a98d29317.md`
- `SESSION_HANDOFF_2026-05-30_019e7994-2d67-7883-840f-7d3c3d92d721.md`
- `SESSION_HANDOFF_2026-05-29_019e752f-259e-7553-9866-4b0c4544dd05.md`
- `SESSION_HANDOFF_2026-05-29_019e752d-9895-7653-936f-31f010b764d5.md`
- `SESSION_HANDOFF_2026-05-29_019e752a-b590-79a3-a82b-ee464537fd82.md`
- `SESSION_HANDOFF_2026-05-29_019e7529-c353-7b83-a39a-5f8a0fe69745.md`
- `SESSION_HANDOFF_2026-05-29_019e7499-013e-7c80-ad40-9c917f319149.md`
- `SESSION_HANDOFF_2026-05-29_019e7442-882b-7a13-b625-d886421780aa.md`
- `SESSION_HANDOFF_2026-05-29_019e742a-a3f1-71b3-8374-b51029016cbf.md`
- `SESSION_HANDOFF_2026-05-29_019e7426-9371-7430-9a71-6686f1347001.md`
- `SESSION_HANDOFF_2026-05-29_019e7421-ba22-78a1-a721-7446ea362dd7.md`
- `SESSION_HANDOFF_2026-05-28_019e6f40-5f2f-78f1-afca-4032e91e55db.md`
- `SESSION_HANDOFF_2026-05-28_019e6f32-5565-76d0-8ae0-06b4e2e30a0e.md`
- `SESSION_HANDOFF_2026-05-28_019e6ea4-f32b-7261-8ca3-9d57cc9d40b5.md`
- `SESSION_HANDOFF_2026-05-27_019e6bbb-f865-7563-96f6-ede09cfc4167.md`
- `SESSION_HANDOFF_2026-05-26_019e654e-1409-7621-bde7-f8c231fda8d0.md`
- `SESSION_HANDOFF_2026-05-26_019e6477-7493-7191-acfb-8aa632788e6c.md`
- `SESSION_HANDOFF_2026-05-25_019e6049-463f-7ab0-a520-95e909a2eff6.md`
- `SESSION_HANDOFF_2026-05-22_019e509e-5038-7b20-a757-cf053441bc8d.md`
- `SESSION_HANDOFF_2026-05-22_019e5096-b2ce-7881-83b4-84fd5ae9aea9.md`
- `SESSION_HANDOFF_2026-05-22_019e4fde-9151-7940-a16a-b90a6bf12517.md`
- `SESSION_HANDOFF_2026-05-22_019e4fdd-cf2f-77a2-84e7-35d48584074b.md`
- `SESSION_HANDOFF_2026-05-22_019e4fd1-20ef-7931-9b08-e4cc646ccb00.md`
- `SESSION_HANDOFF_2026-05-21_019e4e27-3e58-7c51-a2ee-431ce0637c44.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5e-ddaa-7d22-90ff-4b3b56c16ab1.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5d-d653-7702-86a8-c20a83ee23ff.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5c-a277-71d0-afd5-4a740991a8c6.md`
- `SESSION_HANDOFF_2026-05-21_019e4c7a-19cf-7740-84f6-5eb3a1f36fae.md`
- `SESSION_HANDOFF_2026-05-21_019e4c26-0d56-7120-b85e-bf5e18f14721.md`
- `SESSION_HANDOFF_2026-05-21_019e4c16-3a66-7302-8ada-1206e23e11df.md`
- `SESSION_HANDOFF_2026-05-21_019e4c15-88e9-7a42-aad0-86eed917c98a.md`
- `SESSION_HANDOFF_2026-05-21_019e4c14-fe5e-7802-970c-bae01f8b7212.md`
- `SESSION_HANDOFF_2026-05-21_019e4acb-958e-76f2-89fc-f534179f2902.md`
- `SESSION_HANDOFF_2026-05-20_019e46ed-0bc3-78f3-bad7-f7ca24065531.md`
- `SESSION_HANDOFF_2026-05-20_019e45cf-44f8-7fe2-87f5-7d055c00513f.md`
- `SESSION_HANDOFF_2026-05-20_019e45ab-830c-76d1-8f63-448f25c8f681.md`
- `SESSION_HANDOFF_2026-05-20_019e45a3-68ab-7160-ab80-038d09482d6a.md`
- `SESSION_HANDOFF_2026-05-19_019e4057-cc09-7610-9cd5-2b159d78b023.md`
- `SESSION_HANDOFF_2026-05-14_019e26f3-cc37-7351-94a3-c52aae3be0c7.md`
- `SESSION_HANDOFF_2026-05-13_019e21ab-042e-7d62-82c5-621bb214aaf4.md`
- `SESSION_HANDOFF_2026-05-13_019e219a-97c1-7c81-a23d-86233b1a8ccc.md`
- `SESSION_HANDOFF_2026-05-13_019e2194-a0c5-7fd1-8c6e-f3fd3869af34.md`
- `SESSION_HANDOFF_2026-05-13_019e2191-5255-7b50-9d9d-d66432f7cc23.md`
- `SESSION_HANDOFF_2026-05-13_019e2168-cce7-7f22-8a53-a394d6279949.md`
- `SESSION_HANDOFF_2026-05-11_019e1777-ea5d-7a03-aa38-a7da139985d7.md`
- `SESSION_HANDOFF_2026-05-08_019e0920-564f-78d0-8463-410e50e52b5d.md`
- `SESSION_HANDOFF_2026-05-08_019e0826-0850-7bf2-8100-0b3eada42e32.md`
- `SESSION_HANDOFF_2026-05-06_019dff8b-c488-7ec1-bab2-7eeca931697f.md`
- `SESSION_HANDOFF_2026-05-06_019dff88-574a-74f3-8ead-27ea141dfd2f.md`
- `SESSION_HANDOFF_2026-05-06_019dff6f-d657-70a2-bed9-7c3a2469bed7.md`
- `SESSION_HANDOFF_2026-05-06_019dff68-fd69-7fd1-84aa-f97b89d2efe8.md`
- `SESSION_HANDOFF_2026-05-06_019dff67-f5a1-7332-8624-585ac4cd1435.md`
- `SESSION_HANDOFF_2026-05-06_019dff66-df3f-7bc1-abe4-39b68ed2dcff.md`
- `SESSION_HANDOFF_2026-05-06_019dfe4d-4d96-7552-80ac-346c0646adb1.md`
- `SESSION_HANDOFF_2026-05-06_019dfe49-d18c-7bd1-97d1-7e004ff154f0.md`
- `SESSION_HANDOFF_2026-05-06_019dfe45-759c-77c0-b66f-9cc21addb43b.md`
- `SESSION_HANDOFF_2026-05-06_019dfe1c-e228-72b2-932c-6d9faa06df81.md`

## Recent User Messages

- `2026-06-01T23:05:21.801Z` please pick up this session:
  └ SESSION_HANDOFF_CURRENT.md (+20 -18)
     4
     5 -- Last Updated (MT): `2026-06-01 16:5
        3:15 MDT`
     6 -- Last Updated (UTC): `2026-06-01T22:
        53:15Z`
     7 -- Native Codex Session ID: `019e84aa-
        c1d5-79e1-adba-5a743d03c8cc`
     8 -- Summary: STA audit plus Algo page u
        pper-area UI cleanup.
     9 -- Handoff: `SESSION_HANDOFF_2026-06-0
        1_019e84aa-c1d5-79e1-adba-5a743d03c8c
        c.md`
     5 +- Last Updated (MT): `2026-06-01 16:5
        9:31 MDT`
     6 +- Last Updated (UTC): `2026-06-01T22:
        59:31Z`
     7 +- Native Codex Session ID: `019e8366-
        b25f-7921-bbd5-2bfc17403296`
     8 +- Summary: IBKR launch / diagnostics
        session, now focused on signal-matrix
         pressure handling.
     9 +- Handoff: `SESSION_HANDOFF_2026-06-0
        1_019e8366-b25f-7921-bbd5-2bfc1740329
        6.md`
    10  - Master Index: `SESSION_HANDOFF_MAST
        ER.md`
       ⋮
    13
    14 -- Algo page upper area now uses `Pyru
        s Signal-Options` header copy.
    15 -- Redundant Scan/Event/Signals/Flow o
        verview tiles were removed.
    16 -- Overview metrics now focus on `P&L`
        , `Exposure`, `Risk`, and `Record`.
    17 -- The eight pipeline stages now rende
        r as four grouped phases: `Signal Cyc
        le`, `Entry Path`, `Orders`, and `Man
        agement`.
    18 -- Empty activity/attention/transition
         filler is suppressed in the upper ar
        ea, so `Since ... no change`, `Attent
        ion All clear`, and `Last 60s Awaitin
        g next scan` no longer show there whe
        n no signal exists.
    19 -- Visible scan toast copy now says `S
        ignal-options scan ...` instead of ol
        d `Shadow scan ...`.
    14 +- Restart check confirmed the app is
        serving full five-timeframe matrix co
        de: `1m`, `2m`, `5m`, `15m`, `1h`.
    15 +- Fixed pressure visibility gap: gene
        rated API responses now dispatch `pyr
        us:api-pressure` from route-admission
         headers, including shed/error respon
        ses.
    16 +- Memory-pressure monitor consumes th
        ose headers and holds stricter header
         pressure for 15s so a critical shed
        signal cannot be immediately overwrit
        ten by a lower-pressure response.
    17 +- Matrix scheduling now reads live pr
        essure at dispatch time, recomputes t
        he active request task limit from tha
        t live pressure, and uses a browser-t
        ab global lease to avoid duplicate st
        artup/HMR/remount matrix POSTs.
    18 +- Browser QA under real `watch` press
        ure sent one full active Signals requ
        est: `30 symbols x 5 timeframes = 150
        ` tasks, completing in about `3189ms`
        .
    19 +- Browser QA with injected `critical`
         pressure sent exactly one clamped re
        quest: `2 symbols x 5 timeframes = 10
        ` tasks.
    20 +- API process remains resource-heavy
        after QA, around `1.2GB` RSS and `45%
        ` CPU. That is the next runtime risk.
    21  - No Replit startup config was change
        d.
       ⋮
    24
    24 -- `pnpm --filter @workspace/pyrus exe
        c node --import tsx src/screens/algo/
        OperationsSignalRow.test.js`: pass, 1
        5/15.
    25 -- `pnpm --filter @workspace/pyrus exe
        c node --import tsx src/screens/algo/
        algoHelpers.test.js`: pass, 33/33.
    25 +- `node --import tsx --test src/featu
        res/platform/useMemoryPressureSignal.
        test.js src/features/platform/platfor
        mRootSource.test.js src/features/plat
        form/signalMatrixScheduler.test.js` f
        rom `artifacts/pyrus`: pass, 92/92.
    26 +- `pnpm --filter @workspace/api-clien
        t-react run test:unit`: pass, 18/18.
    27 +- `pnpm --filter @workspace/api-clien
        t-react run typecheck`: pass.
    28  - `pnpm --filter @workspace/pyrus run
         typecheck`: pass.
    27 -- Scoped `git diff --check` for touch
        ed UI/test files: pass.
    28 -- `pnpm --filter @workspace/pyrus exe
        c node --import tsx src/features/plat
        form/platformRootSource.test.js`: fai
        led 56/57 on an unrelated `PlatformAp
        p` signal-matrix source assertion.
    29 +- `pnpm --filter @workspace/pyrus run
         build`: pass.
    30 +- Scoped `git diff --check`: pass.
    31
       ⋮
    33
    32 -1. Browser-dogfood the Algo page uppe
        r area with `?pyrusQa=safe` and expli
        cit readiness selectors.
    33 -2. If desired, separately fix or upda
        te the unrelated `platformRootSource.
        test.js` signal-matrix assertion.
    34 -3. Continue the regular-session STA/G
        reek diagnostics once fresh market-se
        ssion data is available.
    34 +1. Triage residual API RSS/CPU pressu
        re. The matrix critical clamp is fixe
        d, but the API process is still hot.
    35 +2. Decide whether active Signals `wat
        ch` state should keep the current `15
        0` cell foreground budget or step dow
        n below critical only after more evid
        ence.
    36 +3. Continue the next issue from this
        session once runtime resource pressur
        e is stable.

  └ SESSION_HANDOFF_MASTER.md (+1 -1)
    10  | 2026-06-01 15:14:53 MDT | `019e838b
        -6af5-7b72-b4aa-ee78a7bd3449` | Greek
        -selected entries, exit-policy sweep
        controls, non-enforcing Greek positio
        n diagnostics, and shadow readiness g
        ate. | `SESSION_HANDOFF_2026-06-01_01
        9e838b-6af5-7b72-b4aa-ee78a7bd3449.md
        ` | Diagnostics enabled on shadow onl
        y; wire trail/enforcement remains dis
        abled; readiness gate is pending regu
        lar-session marks; focused validation
        s passed. | Run Greek diagnostics `--
        require-ready` after next regular-ses
        sion position mark, then run manageme
        nt review and evaluate evidence befor
        e any enforcement. |
    11 -| 2026-06-01 16:52:05 MDT | `019e8366
        -b25f-7921-bbd5-2bfc17403296` | IBKR
        Gateway launch / line diagnostics plu
        s STA/algo signal-bubble foreground h
        ydration tuning. | `SESSION_HANDOFF_2
        026-06-01_019e8366-b25f-7921-bbd5-2bf
        c17403296.md` | Active Signals/Algo m
        atrix requests use foreground budget
        normal/watch 150 cells; live retry co
        nfirmed API/web up, profile MTF requi
        redCount=1, manual shadow scan comple
        ted, and current STA selectingCount=0
         with 8 terminal blocked candidates.
        | Browser-confirm STA bubbles/blocked
         option cells; inspect GLD Greek sele
        not contract-selection spin. |
    11 +| 2026-06-01 16:59:31 MDT | `019e8366
        -b25f-7921-bbd5-2bfc17403296` | IBKR
        Gateway launch / line diagnostics plu
        s signal-matrix pressure hardening. |
         `SESSION_HANDOFF_2026-06-01_019e8366
        -b25f-7921-bbd5-2bfc17403296.md` | Fu
        ll five-timeframe matrix retained; AP
        I route pressure headers now reach th
        e client, critical state clamps activ
        e Signals to 10 tasks, global lease p
        revents duplicate startup matrix POST
        s, and focused validations pass. API
        still hot around 1.2GB RSS / 45% CPU.
         | Triage residual API RSS/CPU pressu
        re; decide if `watch` active-screen 1
        ification. | `SESSION_HANDOFF_2026-06
        -01_019e84aa-83ed-7462-8cd5-1c29cc47f
        bd7.md` | Post-restart verified: sign
        al monitor `90/90`, paper STA `9` fre
        sh candidates, cockpit contract detai
        l says `9 candidates blocked before c
        ontract selection`, safe browser read
         shows no `Heavy deferred` or stale d
        eferred copy. | Watch next regular-se
        ssion 5m signal close for end-to-end
        STA timing; instrument Massive aggreg
        ate -> signal state -> STA candidate
        only if delays recur. |

─────────────────────────────────────────────

• Handoff is now aligned to this session. I’m
  doing a last consistency pass on the
  handoff files and diff status before I
  summarize the actual fix and remaining
  risk.

• Explored
  └ Read SESSION_HANDOFF_CURRENT.md

• Ran git status --short --
  │ SESSION_HANDOFF_CURRENT.md
  │ SESSION_HANDOFF_MASTER.md
  │ … +17 lines
  └  M SESSION_HANDOFF_CURRENT.md
     M SESSION_HANDOFF_MASTER.md
    … +16 lines (ctrl + t to view transcript)
    SESSION_HANDOFF_2026-06-01_019e8366-b25f-
    7921-bbd5-2bfc17403296.md

• Ran git diff --check --
  │ SESSION_HANDOFF_CURRENT.md
  │ SESSION_HANDOFF_MASTER.md
  │ … +17 lines
  └ (no output)

• Explored
  └ Read SESSION_HANDOFF_2026-06-01_019e8366-
         b25f-7921-bbd5-2bfc17403296.md
    Search 019e8366-b25f-7921-bbd5-
    2bfc17403296
           in SESSION_HANDOFF_MASTER.md

• Updated Plan
  └ ✔ Confirm restarted app is serving the
      intended matrix code
    ✔ Check API/runtime pressure and
      reproduce client behavior
    ✔ Fix matrix pressure handling and
      duplicate startup requests
    ✔ Validate tests, browser behavior, and
      update handoff

─────────────────────────────────────────────

• Checked after restart. The app did load the
  new full five-timeframe matrix code, but
  there were still real issues.

  Fixed:

  - API shed/pressure headers were not
    reaching the client, so diagnostics
    shedding made the frontend blind to
    critical pressure.

  - A later lower-pressure response could
    overwrite a stricter critical signal too
    quickly.

  - Matrix startup could double-fire under

  Changed:

  - lib/api-client-react/src/custom-fetch.ts
  - artifacts/pyrus/src/features/platform/
    useMemoryPressureSignal.js

  - artifacts/pyrus/src/features/platform/
    PlatformApp.jsx

  - related tests and handoff files

  Verified:

  - Real watch pressure: one active Signals
    request, 30 symbols x 5 timeframes = 150
    tasks, completed in ~3.2s.

  - Injected critical pressure: exactly one
    request, clamped to 2 symbols x 5
    timeframes = 10 tasks.

  - Full five timeframes remain intact.
  - App stayed up after the checks.

  Validation passed:

  - Pyrus platform tests: 92/92
  - @workspace/api-client-react unit tests:
    18/18

  - API client typecheck
  - Pyrus typecheck
  - Pyrus build
  - scoped git diff --check

  I also corrected SESSION_HANDOFF_CURRENT.md
  back to this session ID: 019e8366-b25f-
  7921-bbd5-2bfc17403296.

  Remaining issue: the API process is still
  hot after QA, roughly 1.2GB RSS and 45%
  CPU. The matrix critical clamp is fixed;

## Session Activity Summary

- `2026-06-01T23:05:21.801Z` User: please pick up this session: └ SESSION_HANDOFF_CURRENT.md (+20 -18) 4 5 -- Last Updated (MT): `2026-06-01 16:5 3:15 MDT` 6 -- Last Updated (UTC): `2026-06-01T22: 53:15Z` 7 -- Nati…
- `2026-06-01T23:05:31.514Z` Agent: Using `context-restore` to resume the handoff, then I’ll inspect the current repo state and continue from the listed runtime-pressure risk.
- `2026-06-01T23:05:33.223Z` Tool: exec_command sed -n '1,220p' /home/runner/workspace/.agents/skills/gstack/context-restore/SKILL.md && sed -n '1,220p' /home/runner/workspace/.agents/skills/session-handoff/SKILL.md
- `2026-06-01T23:06:09.038Z` Tool: exec_command _UPD=$(~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null || .claude/skills/gstack/bin/gstack-update-check 2>/dev/null || true) [ -n "$_UPD" ] && echo "$_UPD" || true mkd…
- `2026-06-01T23:06:24.933Z` Agent: I’m restoring from the repo handoff files first, then I’ll compare them against the live worktree. The pasted diff points at residual API pressure as the active thread, so I’ll ve…
- `2026-06-01T23:06:24.940Z` Tool: exec_command sed -n '1,220p' SESSION_HANDOFF_MASTER.md
- … 68 lower-signal transcript events omitted …
- `2026-06-01T23:11:03.321Z` Tool: exec_command pnpm exec node --import tsx --test lib/backtest-core/src/signal-options.test.ts
- `2026-06-01T23:11:20.300Z` Agent: The API and Pyrus focused suites are green. The direct backtest-core command is still using the wrong `tsx` resolution path, so I’m checking existing package scripts instead of in…
- `2026-06-01T23:11:20.310Z` Tool: exec_command cat package.json
- `2026-06-01T23:11:20.310Z` Tool: exec_command rg -n "tsx|backtest-core|signal-options.test|runUnitTests|test:unit|--import" package.json pnpm-workspace.yaml artifacts/*/package.json lib/*/package.json scripts/package.json -S
- `2026-06-01T23:11:20.348Z` Tool: exec_command find node_modules -path '*tsx*' -maxdepth 5 -type f 2>/dev/null | head -20
- `2026-06-01T23:11:20.349Z` Tool: exec_command find . -path '*node_modules/tsx*' -maxdepth 6 -type f 2>/dev/null | head -20
- `2026-06-01T23:11:28.520Z` Agent: Backtest-core has no local `tsx` dependency, so direct package/root `--import tsx` cannot resolve. I’m using a workspace that already carries `tsx` only as the loader host, while…
- `2026-06-01T23:11:29.798Z` Tool: exec_command pnpm --filter @workspace/api-server exec node --import tsx --test ../../lib/backtest-core/src/signal-options.test.ts
- `2026-06-01T23:11:40.436Z` Agent: The backtest-core test passes when run with a workspace loader. The MTF slice is now covered across API, core profile normalization, and Pyrus fallback UI; I’m refreshing the hand…
- `2026-06-01T23:11:41.969Z` Tool: exec_command node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --session 019e856e-bffa-7833-b2b7-da4c35f1f4ed

## High-Signal Changed Files

- `.gitignore`
- `.replit`
- `5-28 trading analysis.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md`
- `SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md`
- `SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md`
- `SESSION_HANDOFF_CURRENT.md`
- `SESSION_HANDOFF_MASTER.md`
- `artifacts/api-server/package.json`
- `artifacts/api-server/scripts/runUnitTests.mjs`
- `artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/runtime.test.ts`
- `artifacts/api-server/src/lib/runtime.ts`
- `artifacts/api-server/src/lib/values.ts`
- `artifacts/api-server/src/providers/ibkr/client.ts`
- `artifacts/api-server/src/providers/polygon/market-data.test.ts`
- `artifacts/api-server/src/providers/polygon/market-data.ts`
- `artifacts/api-server/src/routes/automation.ts`
- `artifacts/api-server/src/routes/platform-streams-source.test.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/account-positions.test.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/algo-deployment-account.ts`
- `artifacts/api-server/src/services/automation.test.ts`
- `artifacts/api-server/src/services/automation.ts`
- `artifacts/api-server/src/services/backend-settings.ts`
- `artifacts/api-server/src/services/backtesting.ts`

## Repo State Snapshot

```text
## main...origin/main
 M .gitignore
 M .replit
 M "5-28 trading analysis.md"
 M SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md
 M SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md
 M SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md
 M SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md
 M SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md
 M SESSION_HANDOFF_CURRENT.md
 M SESSION_HANDOFF_MASTER.md
 M artifacts/api-server/package.json
 M artifacts/api-server/scripts/runUnitTests.mjs
 M artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs
 M artifacts/api-server/src/index.ts
 M artifacts/api-server/src/lib/runtime.test.ts
 M artifacts/api-server/src/lib/runtime.ts
 M artifacts/api-server/src/lib/values.ts
 M artifacts/api-server/src/providers/ibkr/client.ts
 D artifacts/api-server/src/providers/polygon/market-data.test.ts
 D artifacts/api-server/src/providers/polygon/market-data.ts
 M artifacts/api-server/src/routes/automation.ts
 M artifacts/api-server/src/routes/platform-streams-source.test.ts
 M artifacts/api-server/src/routes/platform.ts
 M artifacts/api-server/src/services/account-positions.test.ts
 M artifacts/api-server/src/services/account.ts
 M artifacts/api-server/src/services/algo-deployment-account.ts
 M artifacts/api-server/src/services/automation.test.ts
 M artifacts/api-server/src/services/automation.ts
 M artifacts/api-server/src/services/backend-settings.ts
 M artifacts/api-server/src/services/backtesting.ts
 M artifacts/api-server/src/services/bridge-governor.test.ts
 M artifacts/api-server/src/services/bridge-governor.ts
 M artifacts/api-server/src/services/bridge-option-quote-stream.test.ts
 M artifacts/api-server/src/services/bridge-option-quote-stream.ts
 M artifacts/api-server/src/services/bridge-quote-stream.ts
 M artifacts/api-server/src/services/bridge-streams.ts
 M artifacts/api-server/src/services/diagnostics.test.ts
 M artifacts/api-server/src/services/flow-events-model.test.ts
 M artifacts/api-server/src/services/flow-events-model.ts
 M artifacts/api-server/src/services/flow-premium-distribution.test.ts
 M artifacts/api-server/src/services/gex.test.ts
 M artifacts/api-server/src/services/gex.ts
 M artifacts/api-server/src/services/historical-flow-events.test.ts
 M artifacts/api-server/src/services/historical-flow-events.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.test.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.ts
 M artifacts/api-server/src/services/ibkr-lanes.ts
 M artifacts/api-server/src/services/ibkr-line-usage.test.ts
 M artifacts/api-server/src/services/ibkr-line-usage.ts
 M artifacts/api-server/src/services/market-data-admission.test.ts
 M artifacts/api-server/src/services/market-data-admission.ts
 M artifacts/api-server/src/services/market-data-ingest.ts
 M artifacts/api-server/src/services/market-data-store.ts
 M artifacts/api-server/src/services/market-data-work-planner.test.ts
 M artifacts/api-server/src/services/market-data-work-planner.ts
 M artifacts/api-server/src/services/market-identity.ts
 M artifacts/api-server/src/services/massive-stock-quote-stream.test.ts
 M artifacts/api-server/src/services/massive-stock-quote-stream.ts
 M artifacts/api-server/src/services/nasdaq-symbol-directory.ts
 M artifacts/api-server/src/services/option-chain-batch.test.ts
 M artifacts/api-server/src/services/option-metadata-store.ts
 M artifacts/api-server/src/services/options-flow-scanner.test.ts
 M artifacts/api-server/src/services/options-flow-scanner.ts
 M artifacts/api-server/src/services/platform-massive-stock-routing.test.ts
 M artifacts/api-server/src/services/platform-quote-snapshot.test.ts
 M artifacts/api-server/src/services/platform-runtime-status.ts
 M artifacts/api-server/src/services/platform-ticker-search.test.ts
 M artifacts/api-server/src/services/platform.ts
 D artifacts/api-server/src/services/polygon-delayed-stream.test.ts
 D artifacts/api-server/src/services/polygon-delayed-stream.ts
 M artifacts/api-server/src/services/resource-pressure.test.ts
 M artifacts/api-server/src/services/resource-pressure.ts
 M artifacts/api-server/src/services/route-admission.test.ts
 M artifacts/api-server/src/services/route-admission.ts
 M artifacts/api-server/src/services/runtime-diagnostics.test.ts
 M artifacts/api-server/src/services/runtime-flight-recorder.test.ts
 M artifacts/api-server/src/services/shadow-account.test.ts
 M artifacts/api-server/src/services/shadow-account.ts
 M artifacts/api-server/src/services/signal-monitor.test.ts
 M artifacts/api-server/src/services/signal-monitor.ts
 M artifacts/api-server/src/services/signal-options-automation.test.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/api-server/src/services/signal-options-exit-policy.test.ts
 M artifacts/api-server/src/services/signal-options-exit-policy.ts
 M artifacts/api-server/src/services/signal-options-worker.test.ts
 M artifacts/api-server/src/services/signal-options-worker.ts
 M artifacts/api-server/src/services/sp500-constituents.ts
 M artifacts/api-server/src/services/stock-aggregate-stream.test.ts
 M artifacts/api-server/src/services/stock-aggregate-stream.ts
 M artifacts/api-server/src/services/trade-monitor-worker.test.ts
 M artifacts/api-server/src/services/trade-monitor-worker.ts
 M artifacts/api-server/src/services/volume-footprints.ts
 M artifacts/api-server/src/services/watchlist-prewarm.test.ts
 M artifacts/api-server/src/ws/options-quotes.ts
 M artifacts/backtest-worker/src/index.ts
 M artifacts/ibkr-bridge/src/tws-provider.test.ts
 M artifacts/ibkr-bridge/src/work-scheduler.ts
 M artifacts/pyrus/docs/architecture/market-data-ingest-worker.md
 M artifacts/pyrus/docs/architecture/modularization-tracker.md
 M artifacts/pyrus/e2e/algo-signal-row.spec.ts
 M artifacts/pyrus/e2e/chart-hydration-startup.spec.ts
 M artifacts/pyrus/e2e/diagnostics-chart-hydration.spec.ts
 M artifacts/pyrus/e2e/flow-layout.spec.ts
 M artifacts/pyrus/e2e/market-live-flow.spec.ts
 M artifacts/pyrus/e2e/market-premium-flow.spec.ts
 M artifacts/pyrus/e2e/market-responsive.spec.ts
 M artifacts/pyrus/e2e/memory-soak.spec.ts
 M artifacts/pyrus/e2e/platform-shell.spec.ts
 M artifacts/pyrus/e2e/render-policy.spec.ts
 M artifacts/pyrus/e2e/ticker-search.spec.ts
 M artifacts/pyrus/e2e/warmup-policy.spec.ts
 M artifacts/pyrus/package.json
 M artifacts/pyrus/scripts/runUnitTests.mjs
 M artifacts/pyrus/src/components/platform/BottomSheet.jsx
 M artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx
 M artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx
 M artifacts/pyrus/src/components/platform/signal-language/thresholds.js
 M artifacts/pyrus/src/features/account/positionDisplayModel.js
 M artifacts/pyrus/src/features/account/positionDisplayModel.test.js
 M artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx
 M artifacts/pyrus/src/features/charting/ChartParityLab.tsx
 M artifacts/pyrus/src/features/charting/ResearchChartFrame.tsx
 M artifacts/pyrus/src/features/charting/ResearchChartSurface.test.ts
 M artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx
 M artifacts/pyrus/src/features/charting/chartApiBars.js
 M artifacts/pyrus/src/features/charting/chartApiBars.test.js
 M artifacts/pyrus/src/features/charting/chartEvents.test.ts
 M artifacts/pyrus/src/features/charting/chartHydrationStats.test.ts
 M artifacts/pyrus/src/features/charting/flowChartEvents.test.ts
 M artifacts/pyrus/src/features/charting/marketSession.test.ts
 M artifacts/pyrus/src/features/charting/marketSession.ts
 M artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts
 M artifacts/pyrus/src/features/charting/useMassiveStreamedStockBars.test.ts
 M artifacts/pyrus/src/features/flow/ContractDetailInline.jsx
 M artifacts/pyrus/src/features/flow/FlowDistributionScannerPanel.jsx
 M artifacts/pyrus/src/features/flow/flowEventMapper.js
 M artifacts/pyrus/src/features/flow/flowEventMapper.test.js
 M artifacts/pyrus/src/features/flow/flowPresentation.js
 M artifacts/pyrus/src/features/gex/HeatmapColorLegend.jsx
 M artifacts/pyrus/src/features/gex/gexDataWiring.test.js
 M artifacts/pyrus/src/features/gex/gexGlossary.js
 M artifacts/pyrus/src/features/gex/gexModel.js
 M artifacts/pyrus/src/features/gex/gexModel.test.js
 M artifacts/pyrus/src/features/market/MarketActivityPanel.jsx
 M artifacts/pyrus/src/features/market/MarketChartCell.jsx
 M artifacts/pyrus/src/features/market/MultiChartGrid.jsx
 M artifacts/pyrus/src/features/market/marketChartWiring.test.js
 M artifacts/pyrus/src/features/platform/AppHeader.jsx
 M artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx
 M artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx
 M artifacts/pyrus/src/features/platform/IbkrConnectionStatus.test.js
 M artifacts/pyrus/src/features/platform/MobileMoreSheet.jsx
 M artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx
 M artifacts/pyrus/src/features/platform/PlatformApp.jsx
 M artifacts/pyrus/src/features/platform/PlatformScreenRouter.jsx
 M artifacts/pyrus/src/features/platform/PlatformShell.jsx
 M artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx
 M artifacts/pyrus/src/features/platform/appWorkScheduler.js
 M artifacts/pyrus/src/features/platform/appWorkScheduler.test.js
 M artifacts/pyrus/src/features/platform/headerBroadcastModel.js
 M artifacts/pyrus/src/features/platform/headerBroadcastModel.test.js
 M artifacts/pyrus/src/features/platform/ibkrPopoverModel.js
 M artifacts/pyrus/src/features/platform/marketFlowScannerConfig.js
 M artifacts/pyrus/src/features/platform/marketFlowScannerConfig.test.js
 M artifacts/pyrus/src/features/platform/marketFlowStore.js
 M artifacts/pyrus/src/features/platform/marketFlowStore.test.js
 M artifacts/pyrus/src/features/platform/memoryPressureModel.js
 M artifacts/pyrus/src/features/platform/memoryPressureModel.test.js
 M artifacts/pyrus/src/features/platform/memoryPressurePopoverModel.js
 M artifacts/pyrus/src/features/platform/platformRootSource.test.js
 M artifacts/pyrus/src/features/platform/runtimeControlModel.js
 M artifacts/pyrus/src/features/platform/runtimeControlModel.test.js
 M artifacts/pyrus/src/features/platform/screenRegistry.jsx
 M artifacts/pyrus/src/features/platform/signalMatrixScheduler.js
 M artifacts/pyrus/src/features/platform/signalMatrixScheduler.test.js
 M artifacts/pyrus/src/features/platform/tickerSearch/TickerSearch.jsx
 M artifacts/pyrus/src/features/platform/tradeFlowStore.test.js
 M artifacts/pyrus/src/features/platform/useLiveMarketFlow.js
 M artifacts/pyrus/src/features/platform/useMemoryPressureSignal.js
 M artifacts/pyrus/src/features/platform/useMemoryPressureSignal.test.js
 M artifacts/pyrus/src/features/platform/watchlistModel.js
 M artifacts/pyrus/src/features/platform/watchlistModel.test.js
 M artifacts/pyrus/src/features/research/lib/researchApi.js
 M artifacts/pyrus/src/features/signals/signalsRowModel.js
 M artifacts/pyrus/src/features/signals/signalsRowModel.test.js
 M artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx
 M artifacts/pyrus/src/features/workers/analyticsWorkerApi.test.js
 M artifacts/pyrus/src/screens/AlgoScreen.jsx
 M artifacts/pyrus/src/screens/FlowScreen.jsx
 M artifacts/pyrus/src/screens/GexScreen.jsx
 M artifacts/pyrus/src/screens/SettingsScreen.jsx
 M artifacts/pyrus/src/screens/SignalsScreen.jsx
 M artifacts/pyrus/src/screens/TradeScreen.jsx
 M artifacts/pyrus/src/screens/account/PositionsPanel.test.js
 M artifacts/pyrus/src/screens/algo/AlgoAuditPanel.test.js
 M artifacts/pyrus/src/screens/algo/AlgoDiagnosticsTab.jsx
 M artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx
 M artifacts/pyrus/src/screens/algo/AlgoOperationsPrimitives.jsx
 M artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx
 M artifacts/pyrus/src/screens/algo/OperationsAttentionStrip.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js
 M artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx
 M artifacts/pyrus/src/screens/algo/OperationsTransitionsStrip.jsx
 M artifacts/pyrus/src/screens/algo/algoAuditModel.js
 M artifacts/pyrus/src/screens/algo/algoHelpers.js
 M artifacts/pyrus/src/screens/algo/algoHelpers.test.js
 M artifacts/pyrus/src/screens/algo/algoSettingsFields.js
 M crates/market-data-worker/src/compute/gex.rs
 M crates/market-data-worker/src/config.rs
 M crates/market-data-worker/src/ingest.rs
 M crates/market-data-worker/src/main.rs
 M crates/market-data-worker/src/providers/massive.rs
 M crates/market-data-worker/src/providers/mod.rs
 D crates/market-data-worker/src/providers/polygon.rs
 M docs/plans/awesome-quant-pyrus-improvements.md
 M lib/api-client-react/src/custom-fetch.test.mjs
 M lib/api-client-react/src/custom-fetch.ts
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-client-react/src/generated/api.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/api-zod/src/generated/types/accountAllocationBucket.ts
 M lib/api-zod/src/generated/types/accountAllocationResponse.ts
 M lib/api-zod/src/generated/types/accountCashActivity.ts
 M lib/api-zod/src/generated/types/accountCashActivityResponse.ts
 M lib/api-zod/src/generated/types/accountCashEvent.ts
 M lib/api-zod/src/generated/types/accountClosedTradesResponse.ts
 M lib/api-zod/src/generated/types/accountDividend.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponse.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponseSourceScope.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponseTerminalPointSource.ts
 M lib/api-zod/src/generated/types/accountEquityPoint.ts
 M lib/api-zod/src/generated/types/accountEquityPointSource.ts
 M lib/api-zod/src/generated/types/accountExposureSummary.ts
 M lib/api-zod/src/generated/types/accountFx.ts
 M lib/api-zod/src/generated/types/accountFxRates.ts
 M lib/api-zod/src/generated/types/accountHistoryRange.ts
 M lib/api-zod/src/generated/types/accountMetric.ts
 M lib/api-zod/src/generated/types/accountMetricSource.ts
 M lib/api-zod/src/generated/types/accountOrder.ts
 M lib/api-zod/src/generated/types/accountOrderSourceType.ts
 M lib/api-zod/src/generated/types/accountOrdersResponse.ts
 M lib/api-zod/src/generated/types/accountOrdersResponseDebug.ts
 M lib/api-zod/src/generated/types/accountOrdersResponseTab.ts
 M lib/api-zod/src/generated/types/accountPositionDateActivity.ts
 M lib/api-zod/src/generated/types/accountPositionLot.ts
 M lib/api-zod/src/generated/types/accountPositionRiskOverlay.ts
 M lib/api-zod/src/generated/types/accountPositionRow.ts
 M lib/api-zod/src/generated/types/accountPositionRowAttributionStatus.ts
 M lib/api-zod/src/generated/types/accountPositionRowAutomationContext.ts
 M lib/api-zod/src/generated/types/accountPositionRowSourceType.ts
 M lib/api-zod/src/generated/types/accountPositionsAtDateResponse.ts
 M lib/api-zod/src/generated/types/accountPositionsAtDateResponseStatus.ts
 M lib/api-zod/src/generated/types/accountPositionsResponse.ts
 M lib/api-zod/src/generated/types/accountRiskResponse.ts
 M lib/api-zod/src/generated/types/accountSummaryAccount.ts
 M lib/api-zod/src/generated/types/accountSummaryMetrics.ts
 M lib/api-zod/src/generated/types/accountSummaryResponse.ts
 M lib/api-zod/src/generated/types/accountTrade.ts
 M lib/api-zod/src/generated/types/accountTradeFilterState.ts
 M lib/api-zod/src/generated/types/accountTradeMetadata.ts
 M lib/api-zod/src/generated/types/accountTradeOptionContract.ts
 M lib/api-zod/src/generated/types/accountTradeOptionRight.ts
 M lib/api-zod/src/generated/types/accountTradeSelectedContract.ts
 M lib/api-zod/src/generated/types/accountTradeSource.ts
 M lib/api-zod/src/generated/types/accountTradeSourceType.ts
 M lib/api-zod/src/generated/types/accountsResponse.ts
 M lib/api-zod/src/generated/types/algoCockpitAttentionItem.ts
 M lib/api-zod/src/generated/types/algoCockpitAttentionItemSeverity.ts
 M lib/api-zod/src/generated/types/algoCockpitFleetSummary.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStage.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStageActiveScanPhase.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStageId.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStageStatus.ts
 M lib/api-zod/src/generated/types/algoCockpitReadiness.ts
 M lib/api-zod/src/generated/types/algoCockpitSnapshotResponse.ts
 M lib/api-zod/src/generated/types/algoCockpitSourceBacktest.ts
 M lib/api-zod/src/generated/types/algoDeployment.ts
 M lib/api-zod/src/generated/types/algoDeploymentsResponse.ts
 M lib/api-zod/src/generated/types/assetClass.ts
 M lib/api-zod/src/generated/types/backtestChartBar.ts
 M lib/api-zod/src/generated/types/backtestChartBarRange.ts
 M lib/api-zod/src/generated/types/backtestChartMarker.ts
 M lib/api-zod/src/generated/types/backtestChartMarkerPosition.ts
 M lib/api-zod/src/generated/types/backtestChartMarkerShape.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadge.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadgeFormat.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadgeWinner.ts
 M lib/api-zod/src/generated/types/backtestDatasetRef.ts
 M lib/api-zod/src/generated/types/backtestDirectionMode.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategiesResponse.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategy.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategyConfig.ts
 M lib/api-zod/src/generated/types/backtestEquitySeriesPoint.ts
 M lib/api-zod/src/generated/types/backtestExecutionProfile.ts
 M lib/api-zod/src/generated/types/backtestIndicatorEvent.ts
 M lib/api-zod/src/generated/types/backtestIndicatorEventMeta.ts
 M lib/api-zod/src/generated/types/backtestIndicatorMarkerPayload.ts
 M lib/api-zod/src/generated/types/backtestIndicatorMarkerPayloadMarkersByTradeId.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindow.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindowDirection.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindowMeta.ts
 M lib/api-zod/src/generated/types/backtestIndicatorZone.ts
 M lib/api-zod/src/generated/types/backtestIndicatorZoneMeta.ts
 M lib/api-zod/src/generated/types/backtestJobStatus.ts
 M lib/api-zod/src/generated/types/backtestJobSummary.ts
 M lib/api-zod/src/generated/types/backtestJobsResponse.ts
 M lib/api-zod/src/generated/types/backtestMetrics.ts
 M lib/api-zod/src/generated/types/backtestOptimizerMode.ts
 M lib/api-zod/src/generated/types/backtestParameterDefinition.ts
 M lib/api-zod/src/generated/types/backtestParameterDefinitionType.ts
 M lib/api-zod/src/generated/types/backtestPoint.ts
 M lib/api-zod/src/generated/types/backtestPortfolioRules.ts
 M lib/api-zod/src/generated/types/backtestRunChart.ts
 M lib/api-zod/src/generated/types/backtestRunChartChartPriceContext.ts
 M lib/api-zod/src/generated/types/backtestRunChartDefaultVisibleLogicalRange.ts
 M lib/api-zod/src/generated/types/backtestRunDetail.ts
 M lib/api-zod/src/generated/types/backtestRunSummary.ts
 M lib/api-zod/src/generated/types/backtestRunsResponse.ts
 M lib/api-zod/src/generated/types/backtestStrategiesResponse.ts
 M lib/api-zod/src/generated/types/backtestStrategyCatalogItem.ts
 M lib/api-zod/src/generated/types/backtestStrategyCatalogItemDefaultParameters.ts
 M lib/api-zod/src/generated/types/backtestStrategyStatus.ts
 M lib/api-zod/src/generated/types/backtestStudiesResponse.ts
 M lib/api-zod/src/generated/types/backtestStudyInput.ts
 M lib/api-zod/src/generated/types/backtestStudyInputOptimizerConfig.ts
 M lib/api-zod/src/generated/types/backtestStudyInputParameters.ts
 M lib/api-zod/src/generated/types/backtestStudyPreviewChart.ts
 M lib/api-zod/src/generated/types/backtestStudyRecord.ts
 M lib/api-zod/src/generated/types/backtestStudyRecordOptimizerConfig.ts
 M lib/api-zod/src/generated/types/backtestStudyRecordParameters.ts
 M lib/api-zod/src/generated/types/backtestSweepDetail.ts
 M lib/api-zod/src/generated/types/backtestSweepDimension.ts
 M lib/api-zod/src/generated/types/backtestTimeToTradeIdsEntry.ts
 M lib/api-zod/src/generated/types/backtestTrade.ts
 M lib/api-zod/src/generated/types/backtestTradeDiagnostics.ts
 M lib/api-zod/src/generated/types/backtestTradeExitConsequences.ts
 M lib/api-zod/src/generated/types/backtestTradeInstrumentType.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroup.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroupDir.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroupKind.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroups.ts
 M lib/api-zod/src/generated/types/backtestTradeOptionContract.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlay.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlayChartPriceContext.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlayDir.ts
 M lib/api-zod/src/generated/types/backtestTradePricingMode.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStep.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStepEmphasis.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStepKind.ts
 M lib/api-zod/src/generated/types/backtestTradeSelectionFocus.ts
 M lib/api-zod/src/generated/types/backtestTradeSelectionFocusVisibleLogicalRange.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdPath.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegment.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegmentKind.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegmentStyle.ts
 M lib/api-zod/src/generated/types/bar.ts
 M lib/api-zod/src/generated/types/barDataSource.ts
 M lib/api-zod/src/generated/types/barMarketDataMode.ts
 M lib/api-zod/src/generated/types/barTimeframe.ts
 M lib/api-zod/src/generated/types/barsHistoryPage.ts
 M lib/api-zod/src/generated/types/barsHistoryPageCacheStatus.ts
 M lib/api-zod/src/generated/types/barsHistoryPageHydrationStatus.ts
 M lib/api-zod/src/generated/types/barsResponse.ts
 M lib/api-zod/src/generated/types/barsResponseMarketDataMode.ts
 M lib/api-zod/src/generated/types/benchmarkFlowScannerBody.ts
 M lib/api-zod/src/generated/types/benchmarkFlowScannerBodyStrikeCoverage.ts
 M lib/api-zod/src/generated/types/brokerAccount.ts
 M lib/api-zod/src/generated/types/brokerConnection.ts
 M lib/api-zod/src/generated/types/brokerConnectionProvider.ts
 M lib/api-zod/src/generated/types/brokerConnectionsResponse.ts
 M lib/api-zod/src/generated/types/brokerProvider.ts
 M lib/api-zod/src/generated/types/brokerTradingReadinessState.ts
 M lib/api-zod/src/generated/types/cancelAccountOrderRequest.ts
 M lib/api-zod/src/generated/types/cancelOrderRequest.ts
 M lib/api-zod/src/generated/types/cancelOrderResponse.ts
 M lib/api-zod/src/generated/types/chartBarTimeframe.ts
 M lib/api-zod/src/generated/types/connectionStatus.ts
 M lib/api-zod/src/generated/types/createAlgoDeploymentRequest.ts
 M lib/api-zod/src/generated/types/createBacktestRunRequest.ts
 M lib/api-zod/src/generated/types/createBacktestRunRequestParameters.ts
 M lib/api-zod/src/generated/types/createBacktestSweepRequest.ts
 M lib/api-zod/src/generated/types/createBacktestSweepRequestBaseParameters.ts
 M lib/api-zod/src/generated/types/createPineScriptRequest.ts
 M lib/api-zod/src/generated/types/createPineScriptRequestMetadata.ts
 M lib/api-zod/src/generated/types/createWatchlistRequest.ts
 M lib/api-zod/src/generated/types/diagnosticClientEventRequest.ts
 M lib/api-zod/src/generated/types/diagnosticEvent.ts
 M lib/api-zod/src/generated/types/diagnosticEventDetailResponse.ts
 M lib/api-zod/src/generated/types/diagnosticEventRecordResponse.ts
 M lib/api-zod/src/generated/types/diagnosticEventStatus.ts
 M lib/api-zod/src/generated/types/diagnosticEventsResponse.ts
 M lib/api-zod/src/generated/types/diagnosticExportResponse.ts
 M lib/api-zod/src/generated/types/diagnosticHistoryPoint.ts
 M lib/api-zod/src/generated/types/diagnosticHistoryResponse.ts
 M lib/api-zod/src/generated/types/diagnosticSeverity.ts
 M lib/api-zod/src/generated/types/diagnosticSnapshot.ts
 M lib/api-zod/src/generated/types/diagnosticStatus.ts
 M lib/api-zod/src/generated/types/diagnosticThreshold.ts
 M lib/api-zod/src/generated/types/diagnosticThresholdsResponse.ts
 M lib/api-zod/src/generated/types/diagnosticThresholdsUpdateRequest.ts
 M lib/api-zod/src/generated/types/diagnosticThresholdsUpdateRequestThresholdsItem.ts
 M lib/api-zod/src/generated/types/diagnosticsLatestResponse.ts
 M lib/api-zod/src/generated/types/enableAlgoDeploymentParams.ts
 M lib/api-zod/src/generated/types/enableAlgoDeploymentView.ts
 M lib/api-zod/src/generated/types/ensureDefaultSignalOptionsPaperDeploymentBody.ts
 M lib/api-zod/src/generated/types/environmentMode.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorMatrixRequest.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorMatrixRequestClientRole.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorMatrixRequestRequestOrigin.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorRequest.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorRequestMode.ts
 M lib/api-zod/src/generated/types/executionEvent.ts
 M lib/api-zod/src/generated/types/executionEventsResponse.ts
 M lib/api-zod/src/generated/types/exportDiagnosticsParams.ts
 M lib/api-zod/src/generated/types/flexHealthResponse.ts
 M lib/api-zod/src/generated/types/flexTestResponse.ts
 M lib/api-zod/src/generated/types/flowDataProvider.ts
 M lib/api-zod/src/generated/types/flowEvent.ts
 M lib/api-zod/src/generated/types/flowEventBasis.ts
 M lib/api-zod/src/generated/types/flowEventConfidence.ts
 M lib/api-zod/src/generated/types/flowEventMoneyness.ts
 M lib/api-zod/src/generated/types/flowEventSourceBasis.ts
 M lib/api-zod/src/generated/types/flowEventsResponse.ts
 M lib/api-zod/src/generated/types/flowEventsSource.ts
 M lib/api-zod/src/generated/types/flowEventsSourceIbkrStatus.ts
 M lib/api-zod/src/generated/types/flowEventsSourceProvider.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerCoverage.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerCoverageLastScannedAt.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerCoverageMode.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerPhase.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerStrikeCoverage.ts
 M lib/api-zod/src/generated/types/flowEventsSourceStatus.ts
 M lib/api-zod/src/generated/types/flowEventsSourceUnderlyingSpotSource.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionBucket.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionBucketThresholds.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionBuckets.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionClassificationConfidence.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionHydrationDiagnostics.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionHydrationDiagnosticsQuoteProbeStatus.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionResponse.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionResponseStatus.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionResponseTimeframe.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSource.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceCache.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceCoverageMode.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceHydrationStatus.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceProvider.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceQuoteAccess.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceSideBasis.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceTimeframe.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceTradeAccess.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidget.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetConfidence.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetMarketCapTier.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetQuoteAccess.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetSideBasis.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetSource.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetTimeframe.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetTradeAccess.ts
 M lib/api-zod/src/generated/types/flowSentiment.ts
 M lib/api-zod/src/generated/types/flowUniverseCoverage.ts
 M lib/api-zod/src/generated/types/flowUniverseCoverageLastScannedAt.ts
 M lib/api-zod/src/generated/types/flowUniverseCoverageMode.ts
 M lib/api-zod/src/generated/types/flowUniverseResponse.ts
 M lib/api-zod/src/generated/types/flowUniverseSources.ts
 M lib/api-zod/src/generated/types/footprintCandle.ts
 M lib/api-zod/src/generated/types/footprintDiagnostics.ts
 M lib/api-zod/src/generated/types/footprintDiagnosticsClassificationMethod.ts
 M lib/api-zod/src/generated/types/footprintDiagnosticsMinTickSource.ts
 M lib/api-zod/src/generated/types/footprintDiagnosticsSourceProvider.ts
 M lib/api-zod/src/generated/types/footprintLevel.ts
 M lib/api-zod/src/generated/types/footprintPartialReason.ts
 M lib/api-zod/src/generated/types/footprintResponse.ts
 M lib/api-zod/src/generated/types/footprintSourcePreference.ts
 M lib/api-zod/src/generated/types/footprintTimeframe.ts
 M lib/api-zod/src/generated/types/getAccountAllocationParams.ts
 M lib/api-zod/src/generated/types/getAccountCashActivityParams.ts
 M lib/api-zod/src/generated/types/getAccountClosedTradesParams.ts
 M lib/api-zod/src/generated/types/getAccountClosedTradesPnlSign.ts
 M lib/api-zod/src/generated/types/getAccountEquityHistoryParams.ts
 M lib/api-zod/src/generated/types/getAccountOrdersParams.ts
 M lib/api-zod/src/generated/types/getAccountOrdersTab.ts
 M lib/api-zod/src/generated/types/getAccountPositionsAtDateParams.ts
 M lib/api-zod/src/generated/types/getAccountPositionsParams.ts
 M lib/api-zod/src/generated/types/getAccountRiskParams.ts
 M lib/api-zod/src/generated/types/getAccountSummaryParams.ts
 M lib/api-zod/src/generated/types/getBacktestRunChartParams.ts
 M lib/api-zod/src/generated/types/getBarsParams.ts
 M lib/api-zod/src/generated/types/getFlowPremiumDistributionCoverageMode.ts
 M lib/api-zod/src/generated/types/getFlowPremiumDistributionParams.ts
 M lib/api-zod/src/generated/types/getFlowPremiumDistributionTimeframe.ts
 M lib/api-zod/src/generated/types/getFootprintsParams.ts
 M lib/api-zod/src/generated/types/getMarketDepth200.ts
 M lib/api-zod/src/generated/types/getMarketDepthParams.ts
 M lib/api-zod/src/generated/types/getNewsParams.ts
 M lib/api-zod/src/generated/types/getOptionChainParams.ts
 M lib/api-zod/src/generated/types/getOptionChartBarsParams.ts
 M lib/api-zod/src/generated/types/getOptionExpirationsParams.ts
 M lib/api-zod/src/generated/types/getQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/getResearchEarningsCalendarParams.ts
 M lib/api-zod/src/generated/types/getResearchFinancialsParams.ts
 M lib/api-zod/src/generated/types/getResearchFundamentalsParams.ts
 M lib/api-zod/src/generated/types/getResearchSecFilingsParams.ts
 M lib/api-zod/src/generated/types/getResearchSnapshotsParams.ts
 M lib/api-zod/src/generated/types/getResearchTranscriptParams.ts
 M lib/api-zod/src/generated/types/getResearchTranscriptsParams.ts
 M lib/api-zod/src/generated/types/getSignalMonitorProfileParams.ts
 M lib/api-zod/src/generated/types/getSignalMonitorStateParams.ts
 M lib/api-zod/src/generated/types/getUniverseLogosParams.ts
 M lib/api-zod/src/generated/types/gexDashboardResponse.ts
 M lib/api-zod/src/generated/types/gexDashboardResponseFlowContextStatus.ts
 M lib/api-zod/src/generated/types/gexFlowClassificationBasisCounts.ts
 M lib/api-zod/src/generated/types/gexFlowClassificationConfidenceCounts.ts
 M lib/api-zod/src/generated/types/gexFlowContext.ts
 M lib/api-zod/src/generated/types/gexOptionRow.ts
 M lib/api-zod/src/generated/types/gexOptionRowCp.ts
 M lib/api-zod/src/generated/types/gexProfile.ts
 M lib/api-zod/src/generated/types/gexSnapshot.ts
 M lib/api-zod/src/generated/types/gexSource.ts
 M lib/api-zod/src/generated/types/gexSourceFlowStatus.ts
 M lib/api-zod/src/generated/types/gexSourceProvider.ts
 M lib/api-zod/src/generated/types/gexSourceStatus.ts
 M lib/api-zod/src/generated/types/gexTickerDetails.ts
 M lib/api-zod/src/generated/types/healthStatus.ts
 M lib/api-zod/src/generated/types/healthStatusStatus.ts
 M lib/api-zod/src/generated/types/ibkrBridgeActivationCancelResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeActivationProgress.ts
 M lib/api-zod/src/generated/types/ibkrBridgeActivationStatusResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeAttachResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthMarketDataMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthRole.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthStreamState.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthTransport.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionsHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeCredentialHandoff.ts
 M lib/api-zod/src/generated/types/ibkrBridgeCredentialHandoffAlgorithm.ts
 M lib/api-zod/src/generated/types/ibkrBridgeCredentialHandoffMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeDetachResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthMarketDataMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthStreamState.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthTransport.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLauncherResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLauncherResponseAutoLoginMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginEnvelopeClaimResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginEnvelopeClaimResponseEnvelope.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginEnvelopeClaimResponseEnvelopeAlgorithm.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginKeyReadResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginKeyReadResponseAlgorithm.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteLaunch.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteLaunchMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteLauncherResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdown.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdownAction.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdownMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdownResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktop.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopHeartbeatResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopJobStatusResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopJobStatusResponseAction.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopJobStatusResponseState.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopLaunchClaimResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopLaunchClaimResponseAction.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopRegisterResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopsResponse.ts
 M lib/api-zod/src/generated/types/index.ts
 M lib/api-zod/src/generated/types/jsonObject.ts
 M lib/api-zod/src/generated/types/listAccountsParams.ts
 M lib/api-zod/src/generated/types/listAggregateFlowEventsParams.ts
 M lib/api-zod/src/generated/types/listAggregateFlowEventsScope.ts
 M lib/api-zod/src/generated/types/listAlgoDeploymentsParams.ts
 M lib/api-zod/src/generated/types/listBacktestRunsParams.ts
 M lib/api-zod/src/generated/types/listDiagnosticEventsParams.ts
 M lib/api-zod/src/generated/types/listDiagnosticHistoryParams.ts
 M lib/api-zod/src/generated/types/listExecutionEventsParams.ts
 M lib/api-zod/src/generated/types/listExecutions200.ts
 M lib/api-zod/src/generated/types/listExecutionsParams.ts
 M lib/api-zod/src/generated/types/listFlowEventsParams.ts
 M lib/api-zod/src/generated/types/listFlowEventsScope.ts
 M lib/api-zod/src/generated/types/listOrdersParams.ts
 M lib/api-zod/src/generated/types/listPositionsParams.ts
 M lib/api-zod/src/generated/types/listSignalMonitorEventsParams.ts
 M lib/api-zod/src/generated/types/marketDataFreshness.ts
 M lib/api-zod/src/generated/types/marketDataProvider.ts
 M lib/api-zod/src/generated/types/newsArticle.ts
 M lib/api-zod/src/generated/types/newsPublisher.ts
 M lib/api-zod/src/generated/types/newsResponse.ts
 M lib/api-zod/src/generated/types/okResponse.ts
 M lib/api-zod/src/generated/types/optionChainBatchRequest.ts
 M lib/api-zod/src/generated/types/optionChainBatchResponse.ts
 M lib/api-zod/src/generated/types/optionChainBatchResult.ts
 M lib/api-zod/src/generated/types/optionChainBatchResultStatus.ts
 M lib/api-zod/src/generated/types/optionChainQuote.ts
 M lib/api-zod/src/generated/types/optionChainQuoteHydration.ts
 M lib/api-zod/src/generated/types/optionChainQuoteMarketDataMode.ts
 M lib/api-zod/src/generated/types/optionChainResponse.ts
 M lib/api-zod/src/generated/types/optionChainStrikeCoverage.ts
 M lib/api-zod/src/generated/types/optionChartBarsDataSource.ts
 M lib/api-zod/src/generated/types/optionChartBarsResolutionSource.ts
 M lib/api-zod/src/generated/types/optionChartBarsResponse.ts
 M lib/api-zod/src/generated/types/optionContract.ts
 M lib/api-zod/src/generated/types/optionContractResolutionResponse.ts
 M lib/api-zod/src/generated/types/optionContractResolutionStatus.ts
 M lib/api-zod/src/generated/types/optionExpirationSummary.ts
 M lib/api-zod/src/generated/types/optionExpirationsResponse.ts
 M lib/api-zod/src/generated/types/optionOrderPositionEffect.ts
 M lib/api-zod/src/generated/types/optionOrderStrategyIntent.ts
 M lib/api-zod/src/generated/types/optionQuoteSnapshotsRequest.ts
 M lib/api-zod/src/generated/types/optionQuoteSnapshotsRequestIntent.ts
 M lib/api-zod/src/generated/types/optionQuoteSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/optionRight.ts
 M lib/api-zod/src/generated/types/order.ts
 M lib/api-zod/src/generated/types/orderPreview.ts
 M lib/api-zod/src/generated/types/orderSide.ts
 M lib/api-zod/src/generated/types/orderStatus.ts
 M lib/api-zod/src/generated/types/orderType.ts
 M lib/api-zod/src/generated/types/ordersResponse.ts
 M lib/api-zod/src/generated/types/ordersResponseDebug.ts
 M lib/api-zod/src/generated/types/pauseAlgoDeploymentParams.ts
 M lib/api-zod/src/generated/types/pauseAlgoDeploymentView.ts
 M lib/api-zod/src/generated/types/pineScriptPaneType.ts
 M lib/api-zod/src/generated/types/pineScriptRecord.ts
 M lib/api-zod/src/generated/types/pineScriptRecordMetadata.ts
 M lib/api-zod/src/generated/types/pineScriptStatus.ts
 M lib/api-zod/src/generated/types/pineScriptsResponse.ts
 M lib/api-zod/src/generated/types/placeOrderRequest.ts
 M lib/api-zod/src/generated/types/placeOrderRequestSource.ts
 M lib/api-zod/src/generated/types/position.ts
 M lib/api-zod/src/generated/types/positionOpenedAtSource.ts
 M lib/api-zod/src/generated/types/positionQuote.ts
 M lib/api-zod/src/generated/types/positionQuoteSource.ts
 M lib/api-zod/src/generated/types/positionsResponse.ts
 M lib/api-zod/src/generated/types/promoteBacktestRunRequest.ts
 M lib/api-zod/src/generated/types/proxyUniverseLogoParams.ts
 M lib/api-zod/src/generated/types/quoteSnapshot.ts
 M lib/api-zod/src/generated/types/quoteSnapshotLatency.ts
 M lib/api-zod/src/generated/types/quoteSnapshotMarketDataMode.ts
 M lib/api-zod/src/generated/types/quoteSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/quoteSource.ts
 M lib/api-zod/src/generated/types/readinessState.ts
 M lib/api-zod/src/generated/types/readinessStatus.ts
 M lib/api-zod/src/generated/types/readinessStatusAppReadiness.ts
 M lib/api-zod/src/generated/types/readinessStatusAppReadinessDiagnosticsSeverity.ts
 M lib/api-zod/src/generated/types/readinessStatusAppReadinessDiagnosticsStatus.ts
 M lib/api-zod/src/generated/types/readinessStatusBrokerTradingReadiness.ts
 M lib/api-zod/src/generated/types/readinessStatusBrokerTradingReadinessChecks.ts
 M lib/api-zod/src/generated/types/readinessStatusLiveness.ts
 M lib/api-zod/src/generated/types/readinessStatusLivenessStatus.ts
 M lib/api-zod/src/generated/types/readinessStatusPressureLevel.ts
 M lib/api-zod/src/generated/types/recordIbkrBridgeActivationProgress200.ts
 M lib/api-zod/src/generated/types/reorderWatchlistItemsRequest.ts
 M lib/api-zod/src/generated/types/replaceOrderRequest.ts
 M lib/api-zod/src/generated/types/requestDebug.ts
 M lib/api-zod/src/generated/types/requestDebugCacheStatus.ts
 M lib/api-zod/src/generated/types/researchAnnualEarningsPoint.ts
 M lib/api-zod/src/generated/types/researchBalanceSheetPeriod.ts
 M lib/api-zod/src/generated/types/researchCalendarEntry.ts
 M lib/api-zod/src/generated/types/researchCalendarResponse.ts
 M lib/api-zod/src/generated/types/researchCashFlowPeriod.ts
 M lib/api-zod/src/generated/types/researchFiling.ts
 M lib/api-zod/src/generated/types/researchFilingsResponse.ts
 M lib/api-zod/src/generated/types/researchFinancials.ts
 M lib/api-zod/src/generated/types/researchFinancialsResponse.ts
 M lib/api-zod/src/generated/types/researchFundamentals.ts
 M lib/api-zod/src/generated/types/researchFundamentalsResponse.ts
 M lib/api-zod/src/generated/types/researchIncomeStatementPeriod.ts
 M lib/api-zod/src/generated/types/researchProvider.ts
 M lib/api-zod/src/generated/types/researchQuarterlyEpsPoint.ts
 M lib/api-zod/src/generated/types/researchRatiosPeriod.ts
 M lib/api-zod/src/generated/types/researchSnapshot.ts
 M lib/api-zod/src/generated/types/researchSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/researchStatus.ts
 M lib/api-zod/src/generated/types/researchTranscriptResponse.ts
 M lib/api-zod/src/generated/types/researchTranscriptsResponse.ts
 M lib/api-zod/src/generated/types/resolveBacktestOptionContract200.ts
 M lib/api-zod/src/generated/types/resolveBacktestOptionContractBody.ts
 M lib/api-zod/src/generated/types/resolveBacktestOptionContractBodyRight.ts
 M lib/api-zod/src/generated/types/resolveOptionContractParams.ts
 M lib/api-zod/src/generated/types/runSignalOptionsShadowBackfillBody.ts
 M lib/api-zod/src/generated/types/runtimeApiDiagnostics.ts
 M lib/api-zod/src/generated/types/runtimeDiagnosticsResponse.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnostics.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnosticsMarketDataMode.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnosticsStreamState.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnosticsTransport.ts
 M lib/api-zod/src/generated/types/runtimeMemoryDiagnostics.ts
 M lib/api-zod/src/generated/types/runtimeOrderCapabilityDiagnostics.ts
 M lib/api-zod/src/generated/types/searchUniverseTickersMode.ts
 M lib/api-zod/src/generated/types/searchUniverseTickersParams.ts
 M lib/api-zod/src/generated/types/sessionIbkrRuntime.ts
 M lib/api-zod/src/generated/types/sessionInfo.ts
 M lib/api-zod/src/generated/types/sessionInfoConfigured.ts
 M lib/api-zod/src/generated/types/sessionMarketDataProviders.ts
 M lib/api-zod/src/generated/types/sessionMarketDataProvidersResearch.ts
 M lib/api-zod/src/generated/types/sessionRuntime.ts
 M lib/api-zod/src/generated/types/signalMonitorDirection.ts
 M lib/api-zod/src/generated/types/signalMonitorEvent.ts
 M lib/api-zod/src/generated/types/signalMonitorEventsResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCacheStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverage.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverageCacheStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverageSourceStrategy.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixState.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixTimeframe.ts
 M lib/api-zod/src/generated/types/signalMonitorProfile.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponseCacheStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponseStateSource.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolState.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorTimeframe.ts
 M lib/api-zod/src/generated/types/signalMonitorUniverseSummary.ts
 M lib/api-zod/src/generated/types/signalMonitorUniverseSummaryMode.ts
 M lib/api-zod/src/generated/types/signalMonitorUniverseSummarySource.ts
 M lib/api-zod/src/generated/types/signalOptionsAutomationState.ts
 M lib/api-zod/src/generated/types/signalOptionsAutomationStateMode.ts
 M lib/api-zod/src/generated/types/signalOptionsExecutionProfile.ts
 M lib/api-zod/src/generated/types/signalOptionsExecutionProfileMode.ts
 M lib/api-zod/src/generated/types/signalOptionsExecutionProfileVersion.ts
 M lib/api-zod/src/generated/types/signalOptionsManualDeviationRequest.ts
 M lib/api-zod/src/generated/types/signalOptionsManualDeviationRequestSource.ts
 M lib/api-zod/src/generated/types/signalOptionsManualDeviationResponse.ts
 M lib/api-zod/src/generated/types/signalOptionsPerformanceResponse.ts
 M lib/api-zod/src/generated/types/sseStream.ts
 M lib/api-zod/src/generated/types/stockAggregateStreamSessionResponse.ts
 M lib/api-zod/src/generated/types/streamAccountPageOrderTab.ts
 M lib/api-zod/src/generated/types/streamAccountPageParams.ts
 M lib/api-zod/src/generated/types/streamAccountPagePnlSign.ts
 M lib/api-zod/src/generated/types/streamAccountsParams.ts
 M lib/api-zod/src/generated/types/streamBarsParams.ts
 M lib/api-zod/src/generated/types/streamExecutionsParams.ts
 M lib/api-zod/src/generated/types/streamFootprintsParams.ts
 M lib/api-zod/src/generated/types/streamMarketDepthParams.ts
 M lib/api-zod/src/generated/types/streamOptionChainsParams.ts
 M lib/api-zod/src/generated/types/streamOptionQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/streamOrdersParams.ts
 M lib/api-zod/src/generated/types/streamQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/streamStockAggregatesParams.ts
 M lib/api-zod/src/generated/types/submitIbkrOrdersRequest.ts
 M lib/api-zod/src/generated/types/submitIbkrOrdersResponse.ts
 M lib/api-zod/src/generated/types/timeInForce.ts
 M lib/api-zod/src/generated/types/transcriptDateEntry.ts
 M lib/api-zod/src/generated/types/transcriptEntry.ts
 M lib/api-zod/src/generated/types/universeMarket.ts
 M lib/api-zod/src/generated/types/universeTicker.ts
 M lib/api-zod/src/generated/types/universeTickerContractMeta.ts
 M lib/api-zod/src/generated/types/universeTickersResponse.ts
 M lib/api-zod/src/generated/types/updateAlgoDeploymentStrategySettingsRequest.ts
 M lib/api-zod/src/generated/types/updateAlgoDeploymentStrategySettingsRequestBosConfirmation.ts
 M lib/api-zod/src/generated/types/updateAlgoDeploymentStrategySettingsResponse.ts
 M lib/api-zod/src/generated/types/updatePineScriptRequest.ts
 M lib/api-zod/src/generated/types/updatePineScriptRequestMetadata.ts
 M lib/api-zod/src/generated/types/updateSignalMonitorProfileRequest.ts
 M lib/api-zod/src/generated/types/updateSignalOptionsExecutionProfileResponse.ts
 M lib/api-zod/src/generated/types/updateStockAggregateStreamSymbolsBody.ts
 M lib/api-zod/src/generated/types/updateWatchlistRequest.ts
 M lib/api-zod/src/generated/types/watchlist.ts
 M lib/api-zod/src/generated/types/watchlistItem.ts
 M lib/api-zod/src/generated/types/watchlistSymbolRequest.ts
 M lib/api-zod/src/generated/types/watchlistsResponse.ts
 M lib/backtest-core/src/index.ts
 M lib/backtest-core/src/signal-options.test.ts
 M lib/backtest-core/src/signal-options.ts
 M lib/db/migrations/20260529_market_data_ingest.sql
 M lib/db/src/index.ts
 M lib/db/src/pool-error-handler.test.ts
 M lib/db/src/pool-error-handler.ts
 M lib/db/src/schema/enums.ts
 M lib/db/src/schema/flow.ts
 M lib/db/src/schema/instruments.ts
 M lib/db/src/schema/market-data.ts
 M lib/ibkr-contracts/src/client.ts
 M lib/ibkr-contracts/src/runtime.ts
 M pnpm-lock.yaml
 M scripts/README.md
 M scripts/package.json
 M scripts/src/hydrate-universe-catalog-ibkr.ts
 M scripts/src/market-data-schema-audit.ts
 M scripts/src/shadow-options-management-review.test.ts
 M scripts/src/shadow-options-management-review.ts
 D scripts/src/shadow-polygon-options-audit.ts
 M scripts/src/signal-options-exit-policy-sweep.test.ts
 M scripts/src/signal-options-exit-policy-sweep.ts
 M scripts/src/sync-listed-universe.ts
 M scripts/src/sync-nasdaq-listed-universe.ts
 M scripts/src/sync-sp500-universe.ts
 M scripts/src/sync-universe-catalog.ts
 M scripts/windows/pyrus-ibkr-helper.ps1
 M tsconfig.json
?? 'executionMode'
?? 'expirationCoverage'
?? 'greekSelector'
?? 'optionSelection'-
?? 'parameters'-
?? SESSION_HANDOFF_2026-05-31_019e7fa4-ed2e-70e1-ac7f-a54fee386518.md
?? SESSION_HANDOFF_2026-05-31_019e7fc7-29fb-7991-9d61-98d6224fb6da.md
?? SESSION_HANDOFF_2026-05-31_019e7ff7-d9da-7333-9c5f-43f9156a8d45.md
?? SESSION_HANDOFF_2026-05-31_019e802d-21e9-7bf1-961a-4c205f226e9e.md
?? SESSION_HANDOFF_2026-05-31_019e802d-7aa8-7832-9d3b-d9a1f55357d2.md
?? SESSION_HANDOFF_2026-05-31_019e802e-8fc0-77a0-8857-7f3208f84734.md
?? SESSION_HANDOFF_2026-05-31_019e8076-ad60-7ee3-9c89-87f101b7545a.md
?? SESSION_HANDOFF_2026-05-31_019e80a2-9969-70a2-a92d-39cf6a379925.md
?? SESSION_HANDOFF_2026-06-01_019e8361-9248-72a3-9743-ffd530b4d55e.md
?? SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md
?? SESSION_HANDOFF_2026-06-01_019e8368-7762-7122-81b8-8a37bfbb0e60.md
?? SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md
?? SESSION_HANDOFF_2026-06-01_019e83a8-59ca-7843-b17d-1eb1b26d5363.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-1f90-7b41-b68e-5b0b7120b56c.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-83ed-7462-8cd5-1c29cc47fbd7.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-d2bd-7103-91a9-a73c9fcfb9c1.md
?? SESSION_HANDOFF_2026-06-01_019e856e-bffa-7833-b2b7-da4c35f1f4ed.md
?? SESSION_HANDOFF_2026-06-01_75218067-d9b9-4264-8b7a-3243c1a06ca1.md
?? SESSION_HANDOFF_LIVE_2026-05-31_gex-projection-cone.md
?? artifacts/api-server/src/providers/massive/
?? artifacts/api-server/src/services/gex-projection-api.test.ts
?? artifacts/api-server/src/services/gex-projection.test.ts
?? artifacts/api-server/src/services/gex-projection.ts
?? artifacts/api-server/src/services/ibkr-live-demand-coordinator.test.ts
?? artifacts/api-server/src/services/ibkr-live-demand-coordinator.ts
?? artifacts/api-server/src/services/massive-stock-aggregate-stream.test.ts
?? artifacts/api-server/src/services/massive-stock-aggregate-stream.ts
?? artifacts/api-server/src/services/massive-stock-websocket.test.ts
?? artifacts/api-server/src/services/massive-stock-websocket.ts
?? artifacts/api-server/src/services/option-metadata-store.test.ts
?? artifacts/api-server/src/services/signal-options-position-tick-manager.test.ts
?? artifacts/api-server/src/services/signal-options-position-tick-manager.ts
?? artifacts/api-server/src/services/treasury-yield-curve.test.ts
?? artifacts/api-server/src/services/treasury-yield-curve.ts
?? artifacts/pyrus/src/features/backtesting/backtestValidationWarnings.test.ts
?? artifacts/pyrus/src/features/backtesting/backtestValidationWarnings.ts
?? artifacts/pyrus/src/features/gex/gexDate.js
?? artifacts/pyrus/src/features/gex/gexHeatmapModel.js
?? artifacts/pyrus/src/features/gex/gexHeatmapModel.test.js
?? artifacts/pyrus/src/features/gex/gexProjectionChartWiring.test.js
?? artifacts/pyrus/src/features/gex/useGexProjection.js
?? artifacts/pyrus/src/features/gex/useGexProjection.test.js
?? artifacts/pyrus/src/features/platform/userFacingRuntimeError.d.ts
?? artifacts/pyrus/src/features/platform/userFacingRuntimeError.js
?? artifacts/pyrus/src/features/platform/userFacingRuntimeError.test.js
?? artifacts/pyrus/src/features/signals/signalStateFreshness.js
?? artifacts/pyrus/src/features/signals/signalStateFreshness.test.js
?? artifacts/pyrus/src/features/signals/signalsMatrixHydration.js
?? artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.js
?? docs/analytics/
?? docs/audits/
?? docs/plans/ibkr-data-line-architecture-plan.md
?? docs/plans/live-ibkr-signal-options-rollout.md
?? docs/plans/signals-row-drilldown.md
?? lib/api-zod/src/generated/types/accountPositionRiskOverlayActiveStopKind.ts
?? lib/api-zod/src/generated/types/gexExpirationCoverage.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorDirection.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorMtfSnapshot.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorSnapshot.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorStrength.ts
?? lib/api-zod/src/generated/types/signalMonitorTrendAgeBucket.ts
?? lib/backtest-core/src/option-greek-selector.test.ts
?? lib/backtest-core/src/option-greek-selector.ts
?? lib/backtest-core/src/signal-forward-returns.test.ts
?? lib/backtest-core/src/signal-forward-returns.ts
?? lib/db/migrations/20260531_option_chain_snapshot_latest_per_contract_idx.sql
?? lib/db/migrations/20260601_massive_provider_rename.sql
?? lib/market-calendar/
?? scripts/reports/shadow-options-management-review/greek-diagnostics-2026-06-01/
?? scripts/reports/signal-options-exit-policy-sweeps/control-fixed-floor-9-symbols-2026-05-04-through-2026-05-21/
?? scripts/reports/signal-options-exit-policy-sweeps/current-greek-control-9-symbols-2026-05-04-through-2026-05-21/
?? scripts/reports/signal-options-exit-policy-sweeps/wire-trail-phase1a-9-symbols-2026-05-04-through-2026-05-21/
?? scripts/reports/signal-options-greek-position-diagnostics/
?? scripts/src/shadow-massive-options-audit.ts
?? scripts/src/signal-options-greek-position-diagnostics.test.ts
?? scripts/src/signal-options-greek-position-diagnostics.ts
?? scripts/src/signal-options-greek-selector-smoke.test.ts
?? scripts/src/signal-options-greek-selector-smoke.ts
```

## Diff Summary

```text
 .gitignore                                         |    1 +
 .replit                                            |   40 +
 5-28 trading analysis.md                           |  159 +-
 ...6-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md |  517 +--
 ...6-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md |  607 +--
 ...6-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md |  299 +-
 ...6-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md |  257 +-
 ...6-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md |  386 +-
 SESSION_HANDOFF_CURRENT.md                         |   39 +-
 SESSION_HANDOFF_MASTER.md                          |   13 +-
 artifacts/api-server/package.json                  |    1 +
 artifacts/api-server/scripts/runUnitTests.mjs      |    6 +-
 .../scripts/sampleFlowPremiumDistribution.mjs      |   16 +-
 artifacts/api-server/src/index.ts                  |    2 +
 artifacts/api-server/src/lib/runtime.test.ts       |   32 +-
 artifacts/api-server/src/lib/runtime.ts            |   52 +-
 artifacts/api-server/src/lib/values.ts             |    2 +-
 artifacts/api-server/src/providers/ibkr/client.ts  |    4 +-
 .../src/providers/polygon/market-data.test.ts      | 1025 -----
 .../src/providers/polygon/market-data.ts           | 4615 --------------------
 artifacts/api-server/src/routes/automation.ts      |   71 +-
 .../src/routes/platform-streams-source.test.ts     |   25 +
 artifacts/api-server/src/routes/platform.ts        |   84 +-
 .../src/services/account-positions.test.ts         |   46 +-
 artifacts/api-server/src/services/account.ts       |  206 +-
 .../src/services/algo-deployment-account.ts        |    3 +-
 .../api-server/src/services/automation.test.ts     |   10 +
 artifacts/api-server/src/services/automation.ts    |    2 +
 .../api-server/src/services/backend-settings.ts    |    2 +-
 artifacts/api-server/src/services/backtesting.ts   |   20 +-
 .../src/services/bridge-governor.test.ts           |   24 +-
 .../api-server/src/services/bridge-governor.ts     |    4 +-
 .../services/bridge-option-quote-stream.test.ts    |  391 +-
 .../src/services/bridge-option-quote-stream.ts     |  272 +-
 .../api-server/src/services/bridge-quote-stream.ts |   23 +-
 .../api-server/src/services/bridge-streams.ts      |   55 +-
 .../api-server/src/services/diagnostics.test.ts    |    6 +-
 .../src/services/flow-events-model.test.ts         |    6 +-
 .../api-server/src/services/flow-events-model.ts   |   12 +-
 .../src/services/flow-premium-distribution.test.ts |   57 +-
 artifacts/api-server/src/services/gex.test.ts      |  200 +-
 artifacts/api-server/src/services/gex.ts           |  617 ++-
 .../src/services/historical-flow-events.test.ts    |   10 +-
 .../src/services/historical-flow-events.ts         |   14 +-
 .../src/services/ibkr-bridge-runtime.test.ts       |   16 +-
 .../api-server/src/services/ibkr-bridge-runtime.ts |    2 +-
 artifacts/api-server/src/services/ibkr-lanes.ts    |    8 +-
 .../src/services/ibkr-line-usage.test.ts           |  105 +-
 .../api-server/src/services/ibkr-line-usage.ts     |   77 +-
 .../src/services/market-data-admission.test.ts     |   59 +
 .../src/services/market-data-admission.ts          |   71 +-
 .../api-server/src/services/market-data-ingest.ts  |   26 +-
 .../api-server/src/services/market-data-store.ts   |    2 +-
 .../src/services/market-data-work-planner.test.ts  |   85 +-
 .../src/services/market-data-work-planner.ts       |  160 +-
 .../api-server/src/services/market-identity.ts     |    2 +-
 .../services/massive-stock-quote-stream.test.ts    |   47 +-
 .../src/services/massive-stock-quote-stream.ts     |  215 +-
 .../src/services/nasdaq-symbol-directory.ts        |    2 +-
 .../src/services/option-chain-batch.test.ts        |  467 +-
 .../src/services/option-metadata-store.ts          |   45 +-
 .../src/services/options-flow-scanner.test.ts      |  301 +-
 .../src/services/options-flow-scanner.ts           |    2 +-
 .../platform-massive-stock-routing.test.ts         |   96 +-
 .../src/services/platform-quote-snapshot.test.ts   |   12 +-
 .../src/services/platform-runtime-status.ts        |   68 +-
 .../src/services/platform-ticker-search.test.ts    |   20 +-
 artifacts/api-server/src/services/platform.ts      | 1024 +++--
 .../src/services/polygon-delayed-stream.test.ts    |   22 -
 .../src/services/polygon-delayed-stream.ts         |  435 --
 .../src/services/resource-pressure.test.ts         |   22 +-
 .../api-server/src/services/resource-pressure.ts   |    4 +-
 .../src/services/route-admission.test.ts           |   54 +-
 .../api-server/src/services/route-admission.ts     |   32 +-
 .../src/services/runtime-diagnostics.test.ts       |  132 +-
 .../src/services/runtime-flight-recorder.test.ts   |    4 +-
 .../api-server/src/services/shadow-account.test.ts |   25 +-
 .../api-server/src/services/shadow-account.ts      |   67 +-
 .../api-server/src/services/signal-monitor.test.ts |  934 ++--
 .../api-server/src/services/signal-monitor.ts      | 1436 ++++--
 .../src/services/signal-options-automation.test.ts |  853 +++-
 .../src/services/signal-options-automation.ts      | 1187 ++++-
 .../services/signal-options-exit-policy.test.ts    |   90 +
 .../src/services/signal-options-exit-policy.ts     |   38 +
 .../src/services/signal-options-worker.test.ts     |   58 +
 .../src/services/signal-options-worker.ts          |   70 +-
 .../api-server/src/services/sp500-constituents.ts  |    2 +-
 .../src/services/stock-aggregate-stream.test.ts    |  100 +-
 .../src/services/stock-aggregate-stream.ts         |  124 +-
 .../src/services/trade-monitor-worker.test.ts      |  213 +-
 .../src/services/trade-monitor-worker.ts           |  377 +-
 .../api-server/src/services/volume-footprints.ts   |   14 +-
 .../src/services/watchlist-prewarm.test.ts         |   12 +-
 artifacts/api-server/src/ws/options-quotes.ts      |   45 +-
 artifacts/backtest-worker/src/index.ts             |    1 -
 artifacts/ibkr-bridge/src/tws-provider.test.ts     |    6 +
 artifacts/ibkr-bridge/src/work-scheduler.ts        |   12 +-
 .../docs/architecture/market-data-ingest-worker.md |   17 +-
 .../docs/architecture/modularization-tracker.md    |    2 +-
 artifacts/pyrus/e2e/algo-signal-row.spec.ts        |  103 +-
 .../pyrus/e2e/chart-hydration-startup.spec.ts      |    2 +-
 .../pyrus/e2e/diagnostics-chart-hydration.spec.ts  |    4 +-
 artifacts/pyrus/e2e/flow-layout.spec.ts            |   10 +-
 artifacts/pyrus/e2e/market-live-flow.spec.ts       |    6 +-
 artifacts/pyrus/e2e/market-premium-flow.spec.ts    |   18 +-
 artifacts/pyrus/e2e/market-responsive.spec.ts      |    8 +-
 artifacts/pyrus/e2e/memory-soak.spec.ts            |    2 +-
 artifacts/pyrus/e2e/platform-shell.spec.ts         |   16 +-
 artifacts/pyrus/e2e/render-policy.spec.ts          |    2 +-
 artifacts/pyrus/e2e/ticker-search.spec.ts          |    2 +-
 artifacts/pyrus/e2e/warmup-policy.spec.ts          |    2 +-
 artifacts/pyrus/package.json                       |    1 +
 artifacts/pyrus/scripts/runUnitTests.mjs           |    3 +
 .../pyrus/src/components/platform/BottomSheet.jsx  |    4 +-
 .../src/components/platform/DenseVirtualTable.jsx  |  136 +-
 .../platform/signal-language/SignalDots.jsx        |    7 +-
 .../platform/signal-language/thresholds.js         |    2 +-
 .../src/features/account/positionDisplayModel.js   |    2 +-
 .../features/account/positionDisplayModel.test.js  |    4 +-
 .../src/features/backtesting/BacktestingPanels.tsx |  201 +-
 .../pyrus/src/features/charting/ChartParityLab.tsx |   12 +-
 .../src/features/charting/ResearchChartFrame.tsx   |    6 +-
 .../features/charting/ResearchChartSurface.test.ts |  155 +
 .../src/features/charting/ResearchChartSurface.tsx | 1040 ++++-
 .../pyrus/src/features/charting/chartApiBars.js    |   24 +-
 .../src/features/charting/chartApiBars.test.js     |    8 +-
 .../src/features/charting/chartEvents.test.ts      |   22 +-
 .../features/charting/chartHydrationStats.test.ts  |    6 +-
 .../src/features/charting/flowChartEvents.test.ts  |    6 +-
 .../src/features/charting/marketSession.test.ts    |  162 +
 .../pyrus/src/features/charting/marketSession.ts   |  302 +-
 .../charting/useMassiveStockAggregateStream.ts     |    2 +-
 .../charting/useMassiveStreamedStockBars.test.ts   |   12 +-
 .../src/features/flow/ContractDetailInline.jsx     |    6 +-
 .../features/flow/FlowDistributionScannerPanel.jsx |    2 +-
 .../pyrus/src/features/flow/flowEventMapper.js     |    2 +-
 .../src/features/flow/flowEventMapper.test.js      |    2 +-
 .../pyrus/src/features/flow/flowPresentation.js    |    2 +-
 .../pyrus/src/features/gex/HeatmapColorLegend.jsx  |   38 +-
 .../pyrus/src/features/gex/gexDataWiring.test.js   |   43 +-
 artifacts/pyrus/src/features/gex/gexGlossary.js    |    2 +-
 artifacts/pyrus/src/features/gex/gexModel.js       |   19 +-
 artifacts/pyrus/src/features/gex/gexModel.test.js  |   10 +
 .../src/features/market/MarketActivityPanel.jsx    |    2 +-
 .../pyrus/src/features/market/MarketChartCell.jsx  |    1 +
 .../pyrus/src/features/market/MultiChartGrid.jsx   |    2 +-
 .../src/features/market/marketChartWiring.test.js  |    2 +-
 .../pyrus/src/features/platform/AppHeader.jsx      |    6 +-
 .../platform/HeaderBroadcastScrollerStack.jsx      |   31 +-
 .../src/features/platform/HeaderStatusCluster.jsx  |    3 +-
 .../features/platform/IbkrConnectionStatus.test.js |   14 +-
 .../src/features/platform/MobileMoreSheet.jsx      |    4 +-
 .../platform/PlatformAlgoMonitorSidebar.jsx        |    8 +-
 .../pyrus/src/features/platform/PlatformApp.jsx    |  643 ++-
 .../src/features/platform/PlatformScreenRouter.jsx |   13 +-
 .../pyrus/src/features/platform/PlatformShell.jsx  |   53 +-
 .../src/features/platform/PlatformWatchlist.jsx    |    2 +-
 .../src/features/platform/appWorkScheduler.js      |   69 +-
 .../src/features/platform/appWorkScheduler.test.js |   38 +-
 .../src/features/platform/headerBroadcastModel.js  |    3 +-
 .../features/platform/headerBroadcastModel.test.js |   23 +-
 .../src/features/platform/ibkrPopoverModel.js      |   58 +-
 .../features/platform/marketFlowScannerConfig.js   |    6 +-
 .../platform/marketFlowScannerConfig.test.js       |    6 +-
 .../pyrus/src/features/platform/marketFlowStore.js |   41 +-
 .../src/features/platform/marketFlowStore.test.js  |   61 +-
 .../src/features/platform/memoryPressureModel.js   |   24 +-
 .../features/platform/memoryPressureModel.test.js  |   63 +-
 .../platform/memoryPressurePopoverModel.js         |   11 +-
 .../features/platform/platformRootSource.test.js   |  211 +-
 .../src/features/platform/runtimeControlModel.js   |  111 +-
 .../features/platform/runtimeControlModel.test.js  |   51 +
 .../pyrus/src/features/platform/screenRegistry.jsx |   42 +-
 .../src/features/platform/signalMatrixScheduler.js |  198 +-
 .../platform/signalMatrixScheduler.test.js         |  500 ++-
 .../platform/tickerSearch/TickerSearch.jsx         |   23 +-
 .../src/features/platform/tradeFlowStore.test.js   |    4 +-
 .../src/features/platform/useLiveMarketFlow.js     |    6 +-
 .../features/platform/useMemoryPressureSignal.js   |   84 +-
 .../platform/useMemoryPressureSignal.test.js       |   57 +
 .../pyrus/src/features/platform/watchlistModel.js  |   16 +-
 .../src/features/platform/watchlistModel.test.js   |   47 +-
 .../pyrus/src/features/research/lib/researchApi.js |    2 +-
 .../pyrus/src/features/signals/signalsRowModel.js  |  292 +-
 .../src/features/signals/signalsRowModel.test.js   |  186 +-
 .../pyrus/src/features/trade/TradeEquityPanel.jsx  |    6 +
 .../features/workers/analyticsWorkerApi.test.js    |    2 +-
 artifacts/pyrus/src/screens/AlgoScreen.jsx         |  189 +-
 artifacts/pyrus/src/screens/FlowScreen.jsx         |    4 +-
 artifacts/pyrus/src/screens/GexScreen.jsx          |  677 ++-
 artifacts/pyrus/src/screens/SettingsScreen.jsx     |   15 +-
 artifacts/pyrus/src/screens/SignalsScreen.jsx      | 1997 ++++++++-
 artifacts/pyrus/src/screens/TradeScreen.jsx        |   20 +-
 .../src/screens/account/PositionsPanel.test.js     |    2 +-
 .../pyrus/src/screens/algo/AlgoAuditPanel.test.js  |   79 +
 .../pyrus/src/screens/algo/AlgoDiagnosticsTab.jsx  |    4 +-
 artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx  |  602 +--
 .../src/screens/algo/AlgoOperationsPrimitives.jsx  |  224 +-
 .../pyrus/src/screens/algo/AlgoSettingsRegion.jsx  |    2 +-
 .../src/screens/algo/OperationsAttentionStrip.jsx  |    2 +
 .../pyrus/src/screens/algo/OperationsSignalRow.jsx |  396 +-
 .../src/screens/algo/OperationsSignalRow.test.js   |  308 +-
 .../src/screens/algo/OperationsSignalTable.jsx     |  216 +-
 .../screens/algo/OperationsTransitionsStrip.jsx    |    2 +
 artifacts/pyrus/src/screens/algo/algoAuditModel.js |  179 +
 artifacts/pyrus/src/screens/algo/algoHelpers.js    |   55 +-
 .../pyrus/src/screens/algo/algoHelpers.test.js     |  107 +-
 .../pyrus/src/screens/algo/algoSettingsFields.js   |    2 +-
 crates/market-data-worker/src/compute/gex.rs       |  202 +-
 crates/market-data-worker/src/config.rs            |    8 +-
 crates/market-data-worker/src/ingest.rs            |   22 +-
 crates/market-data-worker/src/main.rs              |   14 +-
 crates/market-data-worker/src/providers/massive.rs |  612 ++-
 crates/market-data-worker/src/providers/mod.rs     |    1 -
 crates/market-data-worker/src/providers/polygon.rs |  604 ---
 docs/plans/awesome-quant-pyrus-improvements.md     |   48 +-
 lib/api-client-react/src/custom-fetch.test.mjs     |   84 +
 lib/api-client-react/src/custom-fetch.ts           |   35 +
 lib/api-client-react/src/generated/api.schemas.ts  |  101 +-
 lib/api-client-react/src/generated/api.ts          |    6 +-
 lib/api-spec/openapi.yaml                          |  143 +-
 lib/api-zod/src/generated/api.ts                   |  109 +-
 .../src/generated/types/accountAllocationBucket.ts |    2 +-
 .../generated/types/accountAllocationResponse.ts   |    2 +-
 .../src/generated/types/accountCashActivity.ts     |    2 +-
 .../generated/types/accountCashActivityResponse.ts |    2 +-
 .../src/generated/types/accountCashEvent.ts        |    2 +-
 .../generated/types/accountClosedTradesResponse.ts |    2 +-
 lib/api-zod/src/generated/types/accountDividend.ts |    2 +-
 .../types/accountEquityHistoryResponse.ts          |    2 +-
 .../accountEquityHistoryResponseSourceScope.ts     |    2 +-
 ...ountEquityHistoryResponseTerminalPointSource.ts |    2 +-
 .../src/generated/types/accountEquityPoint.ts      |    2 +-
 .../generated/types/accountEquityPointSource.ts    |    2 +-
 .../src/generated/types/accountExposureSummary.ts  |    2 +-
 lib/api-zod/src/generated/types/accountFx.ts       |    2 +-
 lib/api-zod/src/generated/types/accountFxRates.ts  |    2 +-
 .../src/generated/types/accountHistoryRange.ts     |    2 +-
 lib/api-zod/src/generated/types/accountMetric.ts   |    2 +-
 .../src/generated/types/accountMetricSource.ts     |    2 +-
 lib/api-zod/src/generated/types/accountOrder.ts    |    2 +-
 .../src/generated/types/accountOrderSourceType.ts  |    2 +-
 .../src/generated/types/accountOrdersResponse.ts   |    2 +-
 .../generated/types/accountOrdersResponseDebug.ts  |    2 +-
 .../generated/types/accountOrdersResponseTab.ts    |    2 +-
 .../generated/types/accountPositionDateActivity.ts |    2 +-
 .../src/generated/types/accountPositionLot.ts      |    2 +-
 .../generated/types/accountPositionRiskOverlay.ts  |    5 +-
 .../src/generated/types/accountPositionRow.ts      |    2 +-
 .../types/accountPositionRowAttributionStatus.ts   |    2 +-
 .../types/accountPositionRowAutomationContext.ts   |    2 +-
 .../types/accountPositionRowSourceType.ts          |    2 +-
 .../types/accountPositionsAtDateResponse.ts        |    2 +-
 .../types/accountPositionsAtDateResponseStatus.ts  |    2 +-
 .../generated/types/accountPositionsResponse.ts    |    2 +-
 .../src/generated/types/accountRiskResponse.ts     |    2 +-
 .../src/generated/types/accountSummaryAccount.ts   |    2 +-
 .../src/generated/types/accountSummaryMetrics.ts   |    2 +-
 .../src/generated/types/accountSummaryResponse.ts  |    2 +-
 lib/api-zod/src/generated/types/accountTrade.ts    |    2 +-
 .../src/generated/types/accountTradeFilterState.ts |    2 +-
 .../src/generated/types/accountTradeMetadata.ts    |    2 +-
 .../generated/types/accountTradeOptionContract.ts  |    2 +-
 .../src/generated/types/accountTradeOptionRight.ts |    2 +-
 .../types/accountTradeSelectedContract.ts          |    2 +-
 .../src/generated/types/accountTradeSource.ts      |    2 +-
 .../src/generated/types/accountTradeSourceType.ts  |    2 +-
 .../src/generated/types/accountsResponse.ts        |    2 +-
 .../generated/types/algoCockpitAttentionItem.ts    |    2 +-
 .../types/algoCockpitAttentionItemSeverity.ts      |    2 +-
 .../src/generated/types/algoCockpitFleetSummary.ts |    2 +-
 .../generated/types/algoCockpitPipelineStage.ts    |    2 +-
 .../algoCockpitPipelineStageActiveScanPhase.ts     |    2 +-
 .../generated/types/algoCockpitPipelineStageId.ts  |    2 +-
 .../types/algoCockpitPipelineStageStatus.ts        |    2 +-
 .../src/generated/types/algoCockpitReadiness.ts    |    2 +-
 .../generated/types/algoCockpitSnapshotResponse.ts |    2 +-
 .../generated/types/algoCockpitSourceBacktest.ts   |    2 +-
 lib/api-zod/src/generated/types/algoDeployment.ts  |    2 +-
 .../src/generated/types/algoDeploymentsResponse.ts |    2 +-
 lib/api-zod/src/generated/types/assetClass.ts      |    2 +-
 .../src/generated/types/backtestChartBar.ts        |    2 +-
 .../src/generated/types/backtestChartBarRange.ts   |    2 +-
 .../src/generated/types/backtestChartMarker.ts     |    2 +-
 .../generated/types/backtestChartMarkerPosition.ts |    2 +-
 .../generated/types/backtestChartMarkerShape.ts    |    2 +-
 .../src/generated/types/backtestComparisonBadge.ts |    2 +-
 .../types/backtestComparisonBadgeFormat.ts         |    2 +-
 .../types/backtestComparisonBadgeWinner.ts         |    2 +-
 .../src/generated/types/backtestDatasetRef.ts      |    2 +-
 .../src/generated/types/backtestDirectionMode.ts   |    2 +-
 .../types/backtestDraftStrategiesResponse.ts       |    2 +-
 .../src/generated/types/backtestDraftStrategy.ts   |    2 +-
 .../generated/types/backtestDraftStrategyConfig.ts |    2 +-
 .../generated/types/backtestEquitySeriesPoint.ts   |    2 +-
 .../generated/types/backtestExecutionProfile.ts    |    2 +-
 .../src/generated/types/backtestIndicatorEvent.ts  |    2 +-
 .../generated/types/backtestIndicatorEventMeta.ts  |    2 +-
 .../types/backtestIndicatorMarkerPayload.ts        |    2 +-
 ...cktestIndicatorMarkerPayloadMarkersByTradeId.ts |    2 +-
 .../src/generated/types/backtestIndicatorWindow.ts |    2 +-
 .../types/backtestIndicatorWindowDirection.ts      |    2 +-
 .../generated/types/backtestIndicatorWindowMeta.ts |    2 +-
 .../src/generated/types/backtestIndicatorZone.ts   |    2 +-
 .../generated/types/backtestIndicatorZoneMeta.ts   |    2 +-
 .../src/generated/types/backtestJobStatus.ts       |    2 +-
 .../src/generated/types/backtestJobSummary.ts      |    2 +-
 .../src/generated/types/backtestJobsResponse.ts    |    2 +-
 lib/api-zod/src/generated/types/backtestMetrics.ts |    2 +-
 .../src/generated/types/backtestOptimizerMode.ts   |    2 +-
 .../generated/types/backtestParameterDefinition.ts |    2 +-
 .../types/backtestParameterDefinitionType.ts       |    2 +-
 lib/api-zod/src/generated/types/backtestPoint.ts   |    2 +-
 .../src/generated/types/backtestPortfolioRules.ts  |    2 +-
 .../src/generated/types/backtestRunChart.ts        |    2 +-
 .../types/backtestRunChartChartPriceContext.ts     |    2 +-
 .../backtestRunChartDefaultVisibleLogicalRange.ts  |    2 +-
 .../src/generated/types/backtestRunDetail.ts       |    2 +-
 .../src/generated/types/backtestRunSummary.ts      |    2 +-
 .../src/generated/types/backtestRunsResponse.ts    |    2 +-
 .../generated/types/backtestStrategiesResponse.ts  |    2 +-
 .../generated/types/backtestStrategyCatalogItem.ts |    2 +-
 ...backtestStrategyCatalogItemDefaultParameters.ts |    2 +-
 .../src/generated/types/backtestStrategyStatus.ts  |    2 +-
 .../src/generated/types/backtestStudiesResponse.ts |    2 +-
 .../src/generated/types/backtestStudyInput.ts      |    2 +-
 .../types/backtestStudyInputOptimizerConfig.ts     |    2 +-
 .../types/backtestStudyInputParameters.ts          |    2 +-
 .../generated/types/backtestStudyPreviewChart.ts   |    2 +-
 .../src/generated/types/backtestStudyRecord.ts     |    2 +-
 .../types/backtestStudyRecordOptimizerConfig.ts    |    2 +-
 .../types/backtestStudyRecordParameters.ts         |    2 +-
 .../src/generated/types/backtestSweepDetail.ts     |    2 +-
 .../src/generated/types/backtestSweepDimension.ts  |    2 +-
 .../generated/types/backtestTimeToTradeIdsEntry.ts |    2 +-
 lib/api-zod/src/generated/types/backtestTrade.ts   |    2 +-
 .../generated/types/backtestTradeDiagnostics.ts    |    2 +-
 .../types/backtestTradeExitConsequences.ts         |    2 +-
 .../generated/types/backtestTradeInstrumentType.ts |    2 +-
 .../generated/types/backtestTradeMarkerGroup.ts    |    2 +-
 .../generated/types/backtestTradeMarkerGroupDir.ts |    2 +-
 .../types/backtestTradeMarkerGroupKind.ts          |    2 +-
 .../generated/types/backtestTradeMarkerGroups.ts   |    2 +-
 .../generated/types/backtestTradeOptionContract.ts |    2 +-
 .../src/generated/types/backtestTradeOverlay.ts    |    2 +-
 .../types/backtestTradeOverlayChartPriceContext.ts |    2 +-
 .../src/generated/types/backtestTradeOverlayDir.ts |    2 +-
 .../generated/types/backtestTradePricingMode.ts    |    2 +-
 .../types/backtestTradeReasonTraceStep.ts          |    2 +-
 .../types/backtestTradeReasonTraceStepEmphasis.ts  |    2 +-
 .../types/backtestTradeReasonTraceStepKind.ts      |    2 +-
 .../generated/types/backtestTradeSelectionFocus.ts |    2 +-
 ...cktestTradeSelectionFocusVisibleLogicalRange.ts |    2 +-
 .../generated/types/backtestTradeThresholdPath.ts  |    2 +-
 .../types/backtestTradeThresholdSegment.ts         |    2 +-
 .../types/backtestTradeThresholdSegmentKind.ts     |    2 +-
 .../types/backtestTradeThresholdSegmentStyle.ts    |    2 +-
 lib/api-zod/src/generated/types/bar.ts             |    2 +-
 lib/api-zod/src/generated/types/barDataSource.ts   |    2 +-
 .../src/generated/types/barMarketDataMode.ts       |    2 +-
 lib/api-zod/src/generated/types/barTimeframe.ts    |    2 +-
 lib/api-zod/src/generated/types/barsHistoryPage.ts |    2 +-
 .../generated/types/barsHistoryPageCacheStatus.ts  |    2 +-
 .../types/barsHistoryPageHydrationStatus.ts        |    2 +-
 lib/api-zod/src/generated/types/barsResponse.ts    |    2 +-
 .../generated/types/barsResponseMarketDataMode.ts  |    2 +-
 .../generated/types/benchmarkFlowScannerBody.ts    |    2 +-
 .../benchmarkFlowScannerBodyStrikeCoverage.ts      |    2 +-
 lib/api-zod/src/generated/types/brokerAccount.ts   |    2 +-
 .../src/generated/types/brokerConnection.ts        |    2 +-
 .../generated/types/brokerConnectionProvider.ts    |    2 +-
 .../generated/types/brokerConnectionsResponse.ts   |    2 +-
 lib/api-zod/src/generated/types/brokerProvider.ts  |    2 +-
 .../generated/types/brokerTradingReadinessState.ts |    2 +-
 .../generated/types/cancelAccountOrderRequest.ts   |    2 +-
 .../src/generated/types/cancelOrderRequest.ts      |    2 +-
 .../src/generated/types/cancelOrderResponse.ts     |    2 +-
 .../src/generated/types/chartBarTimeframe.ts       |    2 +-
 .../src/generated/types/connectionStatus.ts        |    2 +-
 .../generated/types/createAlgoDeploymentRequest.ts |    2 +-
 .../generated/types/createBacktestRunRequest.ts    |    2 +-
 .../types/createBacktestRunRequestParameters.ts    |    2 +-
 .../generated/types/createBacktestSweepRequest.ts  |    2 +-
 .../createBacktestSweepRequestBaseParameters.ts    |    2 +-
 .../src/generated/types/createPineScriptRequest.ts |    2 +-
 .../types/createPineScriptRequestMetadata.ts       |    2 +-
 .../src/generated/types/createWatchlistRequest.ts  |    2 +-
 .../types/diagnosticClientEventRequest.ts          |    2 +-
 lib/api-zod/src/generated/types/diagnosticEvent.ts |    2 +-
 .../types/diagnosticEventDetailResponse.ts         |    2 +-
 .../types/diagnosticEventRecordResponse.ts         |    2 +-
 .../src/generated/types/diagnosticEventStatus.ts   |    2 +-
 .../generated/types/diagnosticEventsResponse.ts    |    2 +-
 .../generated/types/diagnosticExportResponse.ts    |    2 +-
 .../src/generated/types/diagnosticHistoryPoint.ts  |    2 +-
 .../generated/types/diagnosticHistoryResponse.ts   |    2 +-
 .../src/generated/types/diagnosticSeverity.ts      |    2 +-
 .../src/generated/types/diagnosticSnapshot.ts      |    2 +-
 .../src/generated/types/diagnosticStatus.ts        |    2 +-
 .../src/generated/types/diagnosticThreshold.ts     |    2 +-
 .../types/diagnosticThresholdsResponse.ts          |    2 +-
 .../types/diagnosticThresholdsUpdateRequest.ts     |    2 +-
 ...gnosticThresholdsUpdateRequestThresholdsItem.ts |    2 +-
 .../generated/types/diagnosticsLatestResponse.ts   |    2 +-
 .../generated/types/enableAlgoDeploymentParams.ts  |    2 +-
 .../generated/types/enableAlgoDeploymentView.ts    |    2 +-
 ...nsureDefaultSignalOptionsPaperDeploymentBody.ts |    2 +-
 lib/api-zod/src/generated/types/environmentMode.ts |    2 +-
 .../types/evaluateSignalMonitorMatrixRequest.ts    |    2 +-
 ...evaluateSignalMonitorMatrixRequestClientRole.ts |    2 +-
 ...luateSignalMonitorMatrixRequestRequestOrigin.ts |    2 +-
 .../types/evaluateSignalMonitorRequest.ts          |    2 +-
 .../types/evaluateSignalMonitorRequestMode.ts      |    2 +-
 lib/api-zod/src/generated/types/executionEvent.ts  |    2 +-
 .../src/generated/types/executionEventsResponse.ts |    2 +-
 .../src/generated/types/exportDiagnosticsParams.ts |    2 +-
 .../src/generated/types/flexHealthResponse.ts      |    2 +-
 .../src/generated/types/flexTestResponse.ts        |    2 +-
 .../src/generated/types/flowDataProvider.ts        |    4 +-
 lib/api-zod/src/generated/types/flowEvent.ts       |    2 +-
 lib/api-zod/src/generated/types/flowEventBasis.ts  |    2 +-
 .../src/generated/types/flowEventConfidence.ts     |    2 +-
 .../src/generated/types/flowEventMoneyness.ts      |    2 +-
 .../src/generated/types/flowEventSourceBasis.ts    |    2 +-
 .../src/generated/types/flowEventsResponse.ts      |    2 +-
 .../src/generated/types/flowEventsSource.ts        |    2 +-
 .../generated/types/flowEventsSourceIbkrStatus.ts  |    2 +-
 .../generated/types/flowEventsSourceProvider.ts    |    4 +-
 .../types/flowEventsSourceScannerCoverage.ts       |    2 +-
 ...flowEventsSourceScannerCoverageLastScannedAt.ts |    2 +-
 .../types/flowEventsSourceScannerCoverageMode.ts   |    2 +-
 .../types/flowEventsSourceScannerPhase.ts          |    2 +-
 .../types/flowEventsSourceScannerStrikeCoverage.ts |    2 +-
 .../src/generated/types/flowEventsSourceStatus.ts  |    2 +-
 .../types/flowEventsSourceUnderlyingSpotSource.ts  |    2 +-
 .../types/flowPremiumDistributionBucket.ts         |    2 +-
 .../flowPremiumDistributionBucketThresholds.ts     |    2 +-
 .../types/flowPremiumDistributionBuckets.ts        |    2 +-
 ...wPremiumDistributionClassificationConfidence.ts |    2 +-
 .../flowPremiumDistributionHydrationDiagnostics.ts |    2 +-
 ...ributionHydrationDiagnosticsQuoteProbeStatus.ts |    2 +-
 .../types/flowPremiumDistributionResponse.ts       |    2 +-
 .../types/flowPremiumDistributionResponseStatus.ts |    2 +-
 .../flowPremiumDistributionResponseTimeframe.ts    |    2 +-
 .../types/flowPremiumDistributionSource.ts         |    2 +-
 .../types/flowPremiumDistributionSourceCache.ts    |    2 +-
 .../flowPremiumDistributionSourceCoverageMode.ts   |    2 +-
 ...flowPremiumDistributionSourceHydrationStatus.ts |    2 +-
 .../types/flowPremiumDistributionSourceProvider.ts |    4 +-
 .../flowPremiumDistributionSourceQuoteAccess.ts    |    2 +-
 .../flowPremiumDistributionSourceSideBasis.ts      |    2 +-
 .../flowPremiumDistributionSourceTimeframe.ts      |    2 +-
 .../flowPremiumDistributionSourceTradeAccess.ts    |    2 +-
 .../types/flowPremiumDistributionWidget.ts         |    2 +-
 .../flowPremiumDistributionWidgetConfidence.ts     |    2 +-
 .../flowPremiumDistributionWidgetMarketCapTier.ts  |    2 +-
 .../flowPremiumDistributionWidgetQuoteAccess.ts    |    2 +-
 .../flowPremiumDistributionWidgetSideBasis.ts      |    2 +-
 .../types/flowPremiumDistributionWidgetSource.ts   |    4 +-
 .../flowPremiumDistributionWidgetTimeframe.ts      |    2 +-
 .../flowPremiumDistributionWidgetTradeAccess.ts    |    2 +-
 lib/api-zod/src/generated/types/flowSentiment.ts   |    2 +-
 .../src/generated/types/flowUniverseCoverage.ts    |    2 +-
 .../types/flowUniverseCoverageLastScannedAt.ts     |    2 +-
 .../generated/types/flowUniverseCoverageMode.ts    |    2 +-
 .../src/generated/types/flowUniverseResponse.ts    |    2 +-
 .../src/generated/types/flowUniverseSources.ts     |    2 +-
 lib/api-zod/src/generated/types/footprintCandle.ts |    2 +-
 .../src/generated/types/footprintDiagnostics.ts    |    2 +-
 .../footprintDiagnosticsClassificationMethod.ts    |    2 +-
 .../types/footprintDiagnosticsMinTickSource.ts     |    2 +-
 .../types/footprintDiagnosticsSourceProvider.ts    |    3 +-
 lib/api-zod/src/generated/types/footprintLevel.ts  |    2 +-
 .../src/generated/types/footprintPartialReason.ts  |    2 +-
 .../src/generated/types/footprintResponse.ts       |    2 +-
 .../generated/types/footprintSourcePreference.ts   |    2 +-
 .../src/generated/types/footprintTimeframe.ts      |    2 +-
 .../generated/types/getAccountAllocationParams.ts  |    2 +-
 .../types/getAccountCashActivityParams.ts          |    2 +-
 .../types/getAccountClosedTradesParams.ts          |    2 +-
 .../types/getAccountClosedTradesPnlSign.ts         |    2 +-
 .../types/getAccountEquityHistoryParams.ts         |    2 +-
 .../src/generated/types/getAccountOrdersParams.ts  |    2 +-
 .../src/generated/types/getAccountOrdersTab.ts     |    2 +-
 .../types/getAccountPositionsAtDateParams.ts       |    2 +-
 .../generated/types/getAccountPositionsParams.ts   |    2 +-
 .../src/generated/types/getAccountRiskParams.ts    |    2 +-
 .../src/generated/types/getAccountSummaryParams.ts |    2 +-
 .../generated/types/getBacktestRunChartParams.ts   |    2 +-
 lib/api-zod/src/generated/types/getBarsParams.ts   |    8 +-
 .../getFlowPremiumDistributionCoverageMode.ts      |    2 +-
 .../types/getFlowPremiumDistributionParams.ts      |    4 +-
 .../types/getFlowPremiumDistributionTimeframe.ts   |    2 +-
 .../src/generated/types/getFootprintsParams.ts     |    2 +-
 .../src/generated/types/getMarketDepth200.ts       |    2 +-
 .../src/generated/types/getMarketDepthParams.ts    |    2 +-
 lib/api-zod/src/generated/types/getNewsParams.ts   |    2 +-
 .../src/generated/types/getOptionChainParams.ts    |    2 +-
 .../generated/types/getOptionChartBarsParams.ts    |    2 +-
 .../generated/types/getOptionExpirationsParams.ts  |    2 +-
 .../src/generated/types/getQuoteSnapshotsParams.ts |    2 +-
 .../types/getResearchEarningsCalendarParams.ts     |    2 +-
 .../generated/types/getResearchFinancialsParams.ts |    2 +-
 .../types/getResearchFundamentalsParams.ts         |    2 +-
 .../generated/types/getResearchSecFilingsParams.ts |    2 +-
 .../generated/types/getResearchSnapshotsParams.ts  |    2 +-
 .../generated/types/getResearchTranscriptParams.ts |    2 +-
 .../types/getResearchTranscriptsParams.ts          |    2 +-
 .../types/getSignalMonitorProfileParams.ts         |    2 +-
 .../generated/types/getSignalMonitorStateParams.ts |    2 +-
 .../src/generated/types/getUniverseLogosParams.ts  |    2 +-
 .../src/generated/types/gexDashboardResponse.ts    |    2 +-
 .../types/gexDashboardResponseFlowContextStatus.ts |    2 +-
 .../types/gexFlowClassificationBasisCounts.ts      |    2 +-
 .../types/gexFlowClassificationConfidenceCounts.ts |    2 +-
 lib/api-zod/src/generated/types/gexFlowContext.ts  |    2 +-
 lib/api-zod/src/generated/types/gexOptionRow.ts    |    2 +-
 lib/api-zod/src/generated/types/gexOptionRowCp.ts  |    2 +-
 lib/api-zod/src/generated/types/gexProfile.ts      |    2 +-
 lib/api-zod/src/generated/types/gexSnapshot.ts     |    2 +-
 lib/api-zod/src/generated/types/gexSource.ts       |    4 +-
 .../src/generated/types/gexSourceFlowStatus.ts     |    2 +-
 .../src/generated/types/gexSourceProvider.ts       |    3 +-
 lib/api-zod/src/generated/types/gexSourceStatus.ts |    2 +-
 .../src/generated/types/gexTickerDetails.ts        |    2 +-
 lib/api-zod/src/generated/types/healthStatus.ts    |    2 +-
 .../src/generated/types/healthStatusStatus.ts      |    2 +-
 .../types/ibkrBridgeActivationCancelResponse.ts    |    2 +-
 .../types/ibkrBridgeActivationProgress.ts          |    2 +-
 .../types/ibkrBridgeActivationStatusResponse.ts    |    2 +-
 .../generated/types/ibkrBridgeAttachResponse.ts    |    2 +-
 .../generated/types/ibkrBridgeConnectionHealth.ts  |    2 +-
 .../ibkrBridgeConnectionHealthMarketDataMode.ts    |    2 +-
 .../types/ibkrBridgeConnectionHealthRole.ts        |    2 +-
 .../types/ibkrBridgeConnectionHealthStreamState.ts |    2 +-
 .../types/ibkrBridgeConnectionHealthTransport.ts   |    2 +-
 .../generated/types/ibkrBridgeConnectionsHealth.ts |    2 +-
 .../generated/types/ibkrBridgeCredentialHandoff.ts |    2 +-
 .../types/ibkrBridgeCredentialHandoffAlgorithm.ts  |    2 +-
 .../types/ibkrBridgeCredentialHandoffMode.ts       |    2 +-
 .../generated/types/ibkrBridgeDetachResponse.ts    |    2 +-
 .../src/generated/types/ibkrBridgeHealth.ts        |    2 +-
 .../types/ibkrBridgeHealthMarketDataMode.ts        |    2 +-
 .../generated/types/ibkrBridgeHealthStreamState.ts |    2 +-
 .../generated/types/ibkrBridgeHealthTransport.ts   |    2 +-
 .../generated/types/ibkrBridgeLauncherResponse.ts  |    2 +-
 .../ibkrBridgeLauncherResponseAutoLoginMode.ts     |    2 +-
 .../types/ibkrBridgeLoginEnvelopeClaimResponse.ts  |    2 +-
 ...ibkrBridgeLoginEnvelopeClaimResponseEnvelope.ts |    2 +-
 ...eLoginEnvelopeClaimResponseEnvelopeAlgorithm.ts |    2 +-
 .../types/ibkrBridgeLoginKeyReadResponse.ts        |    2 +-
 .../ibkrBridgeLoginKeyReadResponseAlgorithm.ts     |    2 +-
 .../src/generated/types/ibkrBridgeRemoteLaunch.ts  |    2 +-
 .../generated/types/ibkrBridgeRemoteLaunchMode.ts  |    2 +-
 .../types/ibkrBridgeRemoteLauncherResponse.ts      |    2 +-
 .../generated/types/ibkrBridgeRemoteShutdown.ts    |    2 +-
 .../types/ibkrBridgeRemoteShutdownAction.ts        |    2 +-
 .../types/ibkrBridgeRemoteShutdownMode.ts          |    2 +-
 .../types/ibkrBridgeRemoteShutdownResponse.ts      |    2 +-
 .../src/generated/types/ibkrRemoteDesktop.ts       |    2 +-
 .../types/ibkrRemoteDesktopHeartbeatResponse.ts    |    2 +-
 .../types/ibkrRemoteDesktopJobStatusResponse.ts    |    2 +-
 .../ibkrRemoteDesktopJobStatusResponseAction.ts    |    2 +-
 .../ibkrRemoteDesktopJobStatusResponseState.ts     |    2 +-
 .../types/ibkrRemoteDesktopLaunchClaimResponse.ts  |    2 +-
 .../ibkrRemoteDesktopLaunchClaimResponseAction.ts  |    2 +-
 .../types/ibkrRemoteDesktopRegisterResponse.ts     |    2 +-
 .../generated/types/ibkrRemoteDesktopsResponse.ts  |    2 +-
 lib/api-zod/src/generated/types/index.ts           |    9 +-
 lib/api-zod/src/generated/types/jsonObject.ts      |    2 +-
 .../src/generated/types/listAccountsParams.ts      |    2 +-
 .../types/listAggregateFlowEventsParams.ts         |    2 +-
 .../types/listAggregateFlowEventsScope.ts          |    2 +-
 .../generated/types/listAlgoDeploymentsParams.ts   |    2 +-
 .../src/generated/types/listBacktestRunsParams.ts  |    2 +-
 .../generated/types/listDiagnosticEventsParams.ts  |    2 +-
 .../generated/types/listDiagnosticHistoryParams.ts |    2 +-
 .../generated/types/listExecutionEventsParams.ts   |    2 +-
 .../src/generated/types/listExecutions200.ts       |    2 +-
 .../src/generated/types/listExecutionsParams.ts    |    2 +-
 .../src/generated/types/listFlowEventsParams.ts    |    6 +-
 .../src/generated/types/listFlowEventsScope.ts     |    2 +-
 .../src/generated/types/listOrdersParams.ts        |    2 +-
 .../src/generated/types/listPositionsParams.ts     |    2 +-
 .../types/listSignalMonitorEventsParams.ts         |    2 +-
 .../src/generated/types/marketDataFreshness.ts     |    2 +-
 .../src/generated/types/marketDataProvider.ts      |    3 +-
 lib/api-zod/src/generated/types/newsArticle.ts     |    2 +-
 lib/api-zod/src/generated/types/newsPublisher.ts   |    2 +-
 lib/api-zod/src/generated/types/newsResponse.ts    |    2 +-
 lib/api-zod/src/generated/types/okResponse.ts      |    2 +-
 .../src/generated/types/optionChainBatchRequest.ts |    2 +-
 .../generated/types/optionChainBatchResponse.ts    |    2 +-
 .../src/generated/types/optionChainBatchResult.ts  |    2 +-
 .../types/optionChainBatchResultStatus.ts          |    2 +-
 .../src/generated/types/optionChainQuote.ts        |    2 +-
 .../generated/types/optionChainQuoteHydration.ts   |    2 +-
 .../types/optionChainQuoteMarketDataMode.ts        |    2 +-
 .../src/generated/types/optionChainResponse.ts     |    2 +-
 .../generated/types/optionChainStrikeCoverage.ts   |    2 +-
 .../generated/types/optionChartBarsDataSource.ts   |    4 +-
 .../types/optionChartBarsResolutionSource.ts       |    2 +-
 .../src/generated/types/optionChartBarsResponse.ts |    2 +-
 lib/api-zod/src/generated/types/optionContract.ts  |    2 +-
 .../types/optionContractResolutionResponse.ts      |    2 +-
 .../types/optionContractResolutionStatus.ts        |    2 +-
 .../src/generated/types/optionExpirationSummary.ts |    2 +-
 .../generated/types/optionExpirationsResponse.ts   |    2 +-
 .../generated/types/optionOrderPositionEffect.ts   |    2 +-
 .../generated/types/optionOrderStrategyIntent.ts   |    2 +-
 .../generated/types/optionQuoteSnapshotsRequest.ts |    2 +-
 .../types/optionQuoteSnapshotsRequestIntent.ts     |    2 +-
 .../types/optionQuoteSnapshotsResponse.ts          |    2 +-
 lib/api-zod/src/generated/types/optionRight.ts     |    2 +-
 lib/api-zod/src/generated/types/order.ts           |    2 +-
 lib/api-zod/src/generated/types/orderPreview.ts    |    2 +-
 lib/api-zod/src/generated/types/orderSide.ts       |    2 +-
 lib/api-zod/src/generated/types/orderStatus.ts     |    2 +-
 lib/api-zod/src/generated/types/orderType.ts       |    2 +-
 lib/api-zod/src/generated/types/ordersResponse.ts  |    2 +-
 .../src/generated/types/ordersResponseDebug.ts     |    2 +-
 .../generated/types/pauseAlgoDeploymentParams.ts   |    2 +-
 .../src/generated/types/pauseAlgoDeploymentView.ts |    2 +-
 .../src/generated/types/pineScriptPaneType.ts      |    2 +-
 .../src/generated/types/pineScriptRecord.ts        |    2 +-
 .../generated/types/pineScriptRecordMetadata.ts    |    2 +-
 .../src/generated/types/pineScriptStatus.ts        |    2 +-
 .../src/generated/types/pineScriptsResponse.ts     |    2 +-
 .../src/generated/types/placeOrderRequest.ts       |    2 +-
 .../src/generated/types/placeOrderRequestSource.ts |    2 +-
 lib/api-zod/src/generated/types/position.ts        |    2 +-
 .../src/generated/types/positionOpenedAtSource.ts  |    2 +-
 lib/api-zod/src/generated/types/positionQuote.ts   |    2 +-
 .../src/generated/types/positionQuoteSource.ts     |    2 +-
 .../src/generated/types/positionsResponse.ts       |    2 +-
 .../generated/types/promoteBacktestRunRequest.ts   |    2 +-
 .../src/generated/types/proxyUniverseLogoParams.ts |    2 +-
 lib/api-zod/src/generated/types/quoteSnapshot.ts   |    2 +-
 .../src/generated/types/quoteSnapshotLatency.ts    |    2 +-
 .../generated/types/quoteSnapshotMarketDataMode.ts |    2 +-
 .../src/generated/types/quoteSnapshotsResponse.ts  |    2 +-
 lib/api-zod/src/generated/types/quoteSource.ts     |    3 +-
 lib/api-zod/src/generated/types/readinessState.ts  |    2 +-
 lib/api-zod/src/generated/types/readinessStatus.ts |    2 +-
 .../generated/types/readinessStatusAppReadiness.ts |    2 +-
 ...adinessStatusAppReadinessDiagnosticsSeverity.ts |    2 +-
 ...readinessStatusAppReadinessDiagnosticsStatus.ts |    2 +-
 .../types/readinessStatusBrokerTradingReadiness.ts |    2 +-
 .../readinessStatusBrokerTradingReadinessChecks.ts |    2 +-
 .../src/generated/types/readinessStatusLiveness.ts |    2 +-
 .../types/readinessStatusLivenessStatus.ts         |    2 +-
 .../types/readinessStatusPressureLevel.ts          |    2 +-
 .../types/recordIbkrBridgeActivationProgress200.ts |    2 +-
 .../types/reorderWatchlistItemsRequest.ts          |    2 +-
 .../src/generated/types/replaceOrderRequest.ts     |    2 +-
 lib/api-zod/src/generated/types/requestDebug.ts    |    2 +-
 .../src/generated/types/requestDebugCacheStatus.ts |    2 +-
 .../generated/types/researchAnnualEarningsPoint.ts |    2 +-
 .../generated/types/researchBalanceSheetPeriod.ts  |    2 +-
 .../src/generated/types/researchCalendarEntry.ts   |    2 +-
 .../generated/types/researchCalendarResponse.ts    |    2 +-
 .../src/generated/types/researchCashFlowPeriod.ts  |    2 +-
 lib/api-zod/src/generated/types/researchFiling.ts  |    2 +-
 .../src/generated/types/researchFilingsResponse.ts |    2 +-
 .../src/generated/types/researchFinancials.ts      |    2 +-
 .../generated/types/researchFinancialsResponse.ts  |    2 +-
 .../src/generated/types/researchFundamentals.ts    |    2 +-
 .../types/researchFundamentalsResponse.ts          |    2 +-
 .../types/researchIncomeStatementPeriod.ts         |    2 +-
 .../src/generated/types/researchProvider.ts        |    2 +-
 .../generated/types/researchQuarterlyEpsPoint.ts   |    2 +-
 .../src/generated/types/researchRatiosPeriod.ts    |    2 +-
 .../src/generated/types/researchSnapshot.ts        |    2 +-
 .../generated/types/researchSnapshotsResponse.ts   |    2 +-
 lib/api-zod/src/generated/types/researchStatus.ts  |    2 +-
 .../generated/types/researchTranscriptResponse.ts  |    2 +-
 .../generated/types/researchTranscriptsResponse.ts |    2 +-
 .../types/resolveBacktestOptionContract200.ts      |    2 +-
 .../types/resolveBacktestOptionContractBody.ts     |    2 +-
 .../resolveBacktestOptionContractBodyRight.ts      |    2 +-
 .../generated/types/resolveOptionContractParams.ts |    2 +-
 .../types/runSignalOptionsShadowBackfillBody.ts    |    2 +-
 .../src/generated/types/runtimeApiDiagnostics.ts   |    2 +-
 .../generated/types/runtimeDiagnosticsResponse.ts  |    2 +-
 .../src/generated/types/runtimeIbkrDiagnostics.ts  |    2 +-
 .../types/runtimeIbkrDiagnosticsMarketDataMode.ts  |    2 +-
 .../types/runtimeIbkrDiagnosticsStreamState.ts     |    2 +-
 .../types/runtimeIbkrDiagnosticsTransport.ts       |    2 +-
 .../generated/types/runtimeMemoryDiagnostics.ts    |    2 +-
 .../types/runtimeOrderCapabilityDiagnostics.ts     |    2 +-
 .../generated/types/searchUniverseTickersMode.ts   |    2 +-
 .../generated/types/searchUniverseTickersParams.ts |    4 +-
 .../src/generated/types/sessionIbkrRuntime.ts      |    2 +-
 lib/api-zod/src/generated/types/sessionInfo.ts     |    2 +-
 .../src/generated/types/sessionInfoConfigured.ts   |    4 +-
 .../generated/types/sessionMarketDataProviders.ts  |    2 +-
 .../types/sessionMarketDataProvidersResearch.ts    |    2 +-
 lib/api-zod/src/generated/types/sessionRuntime.ts  |    2 +-
 .../src/generated/types/signalMonitorDirection.ts  |    2 +-
 .../src/generated/types/signalMonitorEvent.ts      |    2 +-
 .../generated/types/signalMonitorEventsResponse.ts |    2 +-
 .../generated/types/signalMonitorMatrixResponse.ts |    2 +-
 .../signalMonitorMatrixResponseCacheStatus.ts      |    2 +-
 .../types/signalMonitorMatrixResponseCoverage.ts   |    2 +-
 ...gnalMonitorMatrixResponseCoverageCacheStatus.ts |    2 +-
 ...lMonitorMatrixResponseCoverageSourceStrategy.ts |    2 +-
 .../generated/types/signalMonitorMatrixState.ts    |    4 +-
 .../types/signalMonitorMatrixTimeframe.ts          |    4 +-
 .../src/generated/types/signalMonitorProfile.ts    |    2 +-
 .../generated/types/signalMonitorStateResponse.ts  |    3 +-
 .../types/signalMonitorStateResponseCacheStatus.ts |    2 +-
 .../types/signalMonitorStateResponseStateSource.ts |    2 +-
 .../generated/types/signalMonitorSymbolState.ts    |    2 +-
 .../generated/types/signalMonitorSymbolStatus.ts   |    2 +-
 .../src/generated/types/signalMonitorTimeframe.ts  |    2 +-
 .../types/signalMonitorUniverseSummary.ts          |    2 +-
 .../types/signalMonitorUniverseSummaryMode.ts      |    2 +-
 .../types/signalMonitorUniverseSummarySource.ts    |    2 +-
 .../types/signalOptionsAutomationState.ts          |    2 +-
 .../types/signalOptionsAutomationStateMode.ts      |    2 +-
 .../types/signalOptionsExecutionProfile.ts         |    2 +-
 .../types/signalOptionsExecutionProfileMode.ts     |    2 +-
 .../types/signalOptionsExecutionProfileVersion.ts  |    2 +-
 .../types/signalOptionsManualDeviationRequest.ts   |    2 +-
 .../signalOptionsManualDeviationRequestSource.ts   |    2 +-
 .../types/signalOptionsManualDeviationResponse.ts  |    2 +-
 .../types/signalOptionsPerformanceResponse.ts      |    2 +-
 lib/api-zod/src/generated/types/sseStream.ts       |    2 +-
 .../types/stockAggregateStreamSessionResponse.ts   |    2 +-
 .../generated/types/streamAccountPageOrderTab.ts   |    2 +-
 .../src/generated/types/streamAccountPageParams.ts |    2 +-
 .../generated/types/streamAccountPagePnlSign.ts    |    2 +-
 .../src/generated/types/streamAccountsParams.ts    |    2 +-
 .../src/generated/types/streamBarsParams.ts        |    2 +-
 .../src/generated/types/streamExecutionsParams.ts  |    2 +-
 .../src/generated/types/streamFootprintsParams.ts  |    2 +-
 .../src/generated/types/streamMarketDepthParams.ts |    2 +-
 .../generated/types/streamOptionChainsParams.ts    |    2 +-
 .../types/streamOptionQuoteSnapshotsParams.ts      |    2 +-
 .../src/generated/types/streamOrdersParams.ts      |    2 +-
 .../generated/types/streamQuoteSnapshotsParams.ts  |    2 +-
 .../generated/types/streamStockAggregatesParams.ts |    2 +-
 .../src/generated/types/submitIbkrOrdersRequest.ts |    2 +-
 .../generated/types/submitIbkrOrdersResponse.ts    |    2 +-
 lib/api-zod/src/generated/types/timeInForce.ts     |    2 +-
 .../src/generated/types/transcriptDateEntry.ts     |    2 +-
 lib/api-zod/src/generated/types/transcriptEntry.ts |    2 +-
 lib/api-zod/src/generated/types/universeMarket.ts  |    2 +-
 lib/api-zod/src/generated/types/universeTicker.ts  |    2 +-
 .../generated/types/universeTickerContractMeta.ts  |    2 +-
 .../src/generated/types/universeTickersResponse.ts |    2 +-
 .../updateAlgoDeploymentStrategySettingsRequest.ts |    2 +-
 ...oymentStrategySettingsRequestBosConfirmation.ts |    2 +-
 ...updateAlgoDeploymentStrategySettingsResponse.ts |    2 +-
 .../src/generated/types/updatePineScriptRequest.ts |    2 +-
 .../types/updatePineScriptRequestMetadata.ts       |    2 +-
 .../types/updateSignalMonitorProfileRequest.ts     |    2 +-
 .../updateSignalOptionsExecutionProfileResponse.ts |    2 +-
 .../types/updateStockAggregateStreamSymbolsBody.ts |    2 +-
 .../src/generated/types/updateWatchlistRequest.ts  |    2 +-
 lib/api-zod/src/generated/types/watchlist.ts       |    2 +-
 lib/api-zod/src/generated/types/watchlistItem.ts   |    2 +-
 .../src/generated/types/watchlistSymbolRequest.ts  |    2 +-
 .../src/generated/types/watchlistsResponse.ts      |    2 +-
 lib/backtest-core/src/index.ts                     |    2 +
 lib/backtest-core/src/signal-options.test.ts       |   95 +
 lib/backtest-core/src/signal-options.ts            |  121 +-
 lib/db/migrations/20260529_market_data_ingest.sql  |   12 +-
 lib/db/src/index.ts                                |    4 +
 lib/db/src/pool-error-handler.test.ts              |   40 +
 lib/db/src/pool-error-handler.ts                   |   71 +
 lib/db/src/schema/enums.ts                         |    2 +-
 lib/db/src/schema/flow.ts                          |    4 +-
 lib/db/src/schema/instruments.ts                   |    4 +-
 lib/db/src/schema/market-data.ts                   |   11 +-
 lib/ibkr-contracts/src/client.ts                   |    4 +-
 lib/ibkr-contracts/src/runtime.ts                  |    2 +-
 pnpm-lock.yaml                                     |   12 +
 scripts/README.md                                  |   16 +-
 scripts/package.json                               |    6 +-
 scripts/src/hydrate-universe-catalog-ibkr.ts       |    2 +-
 scripts/src/market-data-schema-audit.ts            |    1 +
 .../src/shadow-options-management-review.test.ts   |   46 +
 scripts/src/shadow-options-management-review.ts    |  101 +-
 scripts/src/shadow-polygon-options-audit.ts        |  958 ----
 .../src/signal-options-exit-policy-sweep.test.ts   |  155 +
 scripts/src/signal-options-exit-policy-sweep.ts    |  212 +-
 scripts/src/sync-listed-universe.ts                |    2 +-
 scripts/src/sync-nasdaq-listed-universe.ts         |    2 +-
 scripts/src/sync-sp500-universe.ts                 |    2 +-
 scripts/src/sync-universe-catalog.ts               |   12 +-
 scripts/windows/pyrus-ibkr-helper.ps1              |   83 +-
 tsconfig.json                                      |    3 +
 793 files changed, 21382 insertions(+), 13781 deletions(-)
```

## Validations Detected In Transcript

- `pnpm --filter @workspace/pyrus exec node --input-type=module -e '...'` using `@playwright/test` against `http://127.0.0.1:18747/?pyrusQa=safe`: pass.
- Browser QA screenshots written outside the repo: `/tmp/pyrus-algo-upper-desktop-settled.png`, `/tmp/pyrus-algo-upper-mobile-settled.png`.

## What Changed This Session

- Resumed prior handoff `SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md`, whose product work was the Algo page upper-area UI cleanup.
- Verified the Replit-owned Pyrus app on port `18747` with safe QA mode; no startup config was changed.
- Browser QA confirmed the upper area renders `Pyrus Signal-Options`, four overview metrics (`P&L`, `Exposure`, `Risk`, `Record`), and four grouped pipeline phases (`Signal Cycle`, `Entry Path`, `Orders`, `Management`) on desktop and mobile.
- Browser QA confirmed stale upper-area filler/copy is absent: `Pyrus Signals Shadow`, `Shadow scan`, `Since ... no change`, `Attention All clear`, and `Last 60s Awaiting next scan` did not appear.
- No product source code was changed in this pickup turn.

## Current Status

- Algo upper-area browser QA is complete for the resumed `019e84aa...` workstream.
- Playwright observed no console warnings/errors and no page errors.
- API/session were responsive. Before QA the older API process was under `watch` pressure at roughly `1.09GB` RSS / `30%` CPU; after QA the app had restarted under Replit-owned PIDs and `/api/healthz` plus `/api/session` returned `200` with `x-pyrus-pressure-level: normal`.
- A separate Codex terminal was running an API `signal-options-automation.test.ts` pattern during final process inspection; this pickup did not start or stop it.
- Full prior focused validation remains as recorded in `019e84aa...`: Pyrus row test pass, algo helpers test pass, Pyrus typecheck pass, scoped diff check pass.

## Next Recommended Steps

1. Separately triage the residual API RSS/CPU pressure from the `019e8366...` signal-matrix handoff.
2. Address the unrelated `platformRootSource.test.js` signal-matrix assertion only if that path becomes the current workstream again.
3. Continue regular-session STA/Greek diagnostics once fresh market-session data is available.
