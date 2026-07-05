# LIVE Recovery Note — Codex Signal Calibration Takeover

- Session ID: pending (Codex current thread)
- Created (MT): 2026-07-02 16:11 MT
- CWD: `/home/runner/workspace`
- User intent: rerun Phase 4 after Claude's completed Phase 3 backfill; if calibration still fails, continue into the smallest source-backed fix and verify.

## Observed Starting State

- Relevant Claude session: `7ef83d19-c55c-49d4-8ad9-e26dd0290f69`.
- Claude Phase 3 run 2 completed after the saved handoff:
  - 15m pass: `237` total, `235` persisted, `2` skipped.
  - 5m pass: `1537` total, `1537` persisted, `PHASE3_DONE`.
- Claude Phase 4 poll completed before 5m backfill finished, so its saved KPI result is stale for the final backfill state.
- Current local API health check at `127.0.0.1:8080/healthz` failed: nothing listening on port `8080`.
- Confirmed sanctioned app bring-up command from repo docs/package scripts:
  `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit`.
- Sanctioned app start attempted at ~16:11 MT and failed before API health because
  existing unrelated build errors in `artifacts/api-server/src/routes/platform.ts`
  import missing exports from `artifacts/api-server/src/services/bridge-streams.ts`.
  This takeover did not edit those files.
- Direct service probe via `pnpm --filter @workspace/api-server exec tsx -e ...`
  succeeded at 2026-07-02T22:12:50Z and wrote
  `/tmp/codex-kpis-phase4-post-backfill.json`.
- Probe result: resolvedTimeframe=`15m`, evaluated=1999, symbolsWithBars=1977,
  symbolsTimedOut=20, coverageRatio=0.98899, timeoutRatio=0.010005,
  calibration.state=`uncalibrated`, reasons=[`coverage_degraded`],
  candidateModelKey=`evidence-weighted-v2`.

## Codex Fix

Observed after post-backfill probe:

- The failed 15m chunk symbols all had `bar_cache` rows for the KPI window; the
  remaining failure was not missing Phase 3 backfill data.
- The live `bar_cache` table had the intended
  `bar_cache_symbol_timeframe_source_starts_at_idx` index.
- The isolated timed-out 15m chunk completed under a 15s statement timeout when
  rerun, which pointed to load/cold-cache timeout sensitivity.
- A fresh Phase 4 probe showed Drizzle wraps PostgreSQL timeout code `57014`
  under `error.cause`, so timeout detection must inspect nested causes.

Applied the smallest read-path reliability fix in
`artifacts/api-server/src/services/signal-quality-kpis-service.ts`:

- Kept the normal 20-symbol indexed lateral query path unchanged.
- On PostgreSQL statement-timeout chunks only, retry the failed chunk as
  sequential 5-symbol subchunks before marking symbols timed out.
- Preserve the hard bar-fetch deadline and keep retries sequential so recovery
  does not increase DB fanout.
- Added a latest-bar preflight per fallback timeframe. If the candidate
  timeframe is already stale, skip its full 2,000-symbol load and move to the
  next fallback. This avoids the stale `5m` sweep before the fresh `15m` load.

Added focused coverage in
`artifacts/api-server/src/services/signal-quality-kpis-service.test.ts`:

- Nested `cause.code = "57014"` statement-timeout errors retry as
  `[20, 5, 5, 5, 5]`.
- Non-timeout DB errors do not retry and still mark the original chunk timed out.

## Validation Status

- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-quality-kpis-service.test.ts`
  passed: 11 tests.
- `pnpm --filter @workspace/api-server run typecheck` failed on unrelated
  existing IBKR bridge/platform type errors; no errors were reported in the
  touched signal KPI files.
- Fresh post-fix Phase 4 direct service probe wrote
  `/tmp/codex-kpis-phase4-after-retry.json` and passed calibration:
  - resolvedTimeframe=`15m`
  - evaluated=`1999`
  - symbolsWithBars=`1997`
  - symbolsTimedOut=`0`
  - calibration.state=`calibrated`
  - recommendedModelKey=`evidence-weighted-v2`
  - supportedModelCount=`4`
  - reasons=`[]`
- Rebuilt/restarted the app through the sanctioned Replit workflow command so
  `dist/index.mjs` contained the retry and stale-timeframe preflight code.
- First rebuilt live endpoint run confirmed retry logs but still failed under
  concurrent live app DB pressure; this exposed the avoidable stale `5m`
  full-universe load.
- Final live endpoint run after the preflight fix wrote
  `/tmp/codex-kpis-phase4-live-endpoint-after-preflight.json` and passed:
  - HTTP `200`
  - elapsedMs=`143689`
  - headers: routeClass=`background-maintenance`, pressureLevel=`normal`,
    admissionAction=`allow`
  - resolvedTimeframe=`15m`
  - evaluated=`2000`
  - symbolsWithBars=`1998`
  - symbolsTimedOut=`0`
  - calibration.state=`calibrated`
  - recommendedModelKey=`evidence-weighted-v2`
  - supportedModelCount=`4`
  - reasons=`[]`
- Post-validation health check returned `200 OK` at `/api/healthz`.

## Remaining Work

- Superseded by the 2026-07-02T23:26Z update below.

## Update 2026-07-02T23:26Z

User asked whether the 2,000-ticker score-calibration data is fully backfilled
and why live recomputes were timing out.

Observed:

- Targeted one-off `15m` backfill for the two missing deployment symbols
  completed:
  - `ZURA`: `720` fetched, persisted.
  - `WST`: `720` fetched, persisted.
- Direct DB check confirmed:
  - `WST|15m|massive-history|720|2026-05-27 15:30:00+00|2026-07-02 19:45:00+00`
  - `ZURA|15m|massive-history|720|2026-05-29 19:45:00+00|2026-07-02 21:30:00+00`
- Exact deployment-universe coverage audit over the current 90-day KPI window
  returned:
  - `5m`: `2000/2000` symbols with `massive-history` bars.
  - `15m`: `2000/2000` symbols with `massive-history` bars.
  - `1h`: `621/2000` symbols with `massive-history` bars.
- Live HTTP KPI route was shed under resource pressure:
  - HTTP `429`
  - routeClass=`background-maintenance`
  - pressureLevel=`high`
  - admissionAction=`shed`
  - reason=`api-resource-pressure-high`
- A direct service recompute bypassed route admission and reproduced the
  footgun: cold request-time calibration runs full-universe bar-cache sweeps
  (`2000` symbols x up to `720` bars per symbol) against the hot `bar_cache`
  table. PostgreSQL returned `57014` statement timeouts on several chunks.
- `EXPLAIN` showed the intended
  `bar_cache_symbol_timeframe_source_starts_at_idx` backward index scan is used;
  the remaining cost is volume/heap access from a 16.3M-row, ~6.6GB hot table,
  not a missing basic predicate index.

Applied additional guardrail:

- Changed `signalQualityBarWindowFresh` so strict live-edge freshness is required
  only during regular trading hours (`session.key === "rth"`). After-hours and
  closed sessions now use the existing wider stale window. This prevents a
  harmless after-hours `5m`/`15m` lag from causing a fallback to `1h`, which is
  both expensive and under-backfilled for this universe.
- Added regression test:
  `signal-quality KPI freshness tolerates after-hours lag inside the stale window`.

Validation:

- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-quality-kpis-service.test.ts`
  passed: `12` tests.
- Direct freshness probe:
  - `5m` latest `2026-07-02T23:00:00Z` at `2026-07-02T23:16:53Z` => fresh.
  - `15m` latest `2026-07-02T22:45:00Z` at `2026-07-02T23:16:53Z` => fresh.
  - RTH `1m` 15-minute lag remains not fresh.

Current conclusion:

- Backfill needed for the 2,000-symbol `5m`/`15m` calibration window is complete.
- The remaining footgun is architectural: KPI calibration still should not be a
  cold user/request-time compute over `bar_cache`. The next durable step is a
  background/materialized calibration snapshot that the route reads cheaply with
  coverage/freshness metadata.

## Update 2026-07-02T23:58Z

Implemented the materialized snapshot boundary.

Code changes:

- Added `signal_quality_kpi_snapshots` in
  `lib/db/src/schema/automation.ts`.
  - Unique key: `(deployment_id, settings_hash, as_of_day)`.
  - Read indexes:
    - `(deployment_id, generated_at DESC)`.
    - `(deployment_id, as_of_day, generated_at DESC)`.
  - Stores summary columns plus the full `SignalQualityKpiResponse` JSON.
- Added migration
  `lib/db/migrations/20260702_signal_quality_kpi_snapshots.sql`.
- Added schema regression test
  `lib/db/src/schema/signal-quality-snapshots.test.ts`.
- Changed `getDeploymentSignalQualityKpis` so the normal GET path reads stored
  snapshots only. If none exists, it returns a cheap same-shape
  `needs_more_data` response and does not enter the bar-cache compute queue.
- Added `refreshDeploymentSignalQualityKpiSnapshot` for explicit heavy refresh
  work. It uses the existing single-flight compute queue and upserts the
  materialized snapshot.
- Added POST route
  `/api/algo/deployments/:deploymentId/signal-quality-kpis/refresh`, guarded by
  `requireAdminCsrf`.
- Added same-day latest snapshot fallback for saved-settings GETs. Exact
  `(deployment, settingsHash, day)` is preferred, but the fallback prevents a
  harmless symbol-order/hash drift from making GET return pending. Draft previews
  do not use this fallback.
- Fresh snapshot calibration recommended `balanced-sot-v2`, so the active STA
  row scorer in `artifacts/pyrus/src/screens/algo/algoHelpers.js` was changed
  from `evidence-weighted-v2` to `balanced-sot-v2`, porting the backend formula:
  72% SOT reversion score, 28% trend-confirmation score, extension penalty, and
  volume-expansion support.

Live DB/data actions:

- Applied the snapshot migration to the live dev DB.
- Ran one explicit refresh for deployment
  `7e2e4e6f-749f-4e65-a011-87d3559a23b0`.
- Refresh result saved to:
  - `/tmp/codex-kpis-phase4-snapshot-refresh.json`
  - `/tmp/codex-kpis-phase4-snapshot-refresh-summary.json`

Refresh result:

- elapsedMs=`498996` (~8m19s)
- requestedTimeframe=`1m`
- resolvedTimeframe=`5m`
- evaluatedSymbolCount=`2000`
- symbolsWithBars=`2000`
- symbolsTimedOut=`0`
- totalBars=`1343552`
- observationCount=`7017`
- calibration.state=`calibrated`
- recommendedModelKey=`balanced-sot-v2`
- supportedModelCount=`4`
- reasons=`[]`

Validation:

- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-quality-kpis-service.test.ts`
  passed: `14` tests.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-quality-kpis.test.ts`
  passed: `17` tests.
- `pnpm --filter @workspace/db exec tsx --test src/schema/signal-quality-snapshots.test.ts`
  passed.
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/algoHelpers.test.mjs`
  passed: `56` tests.
- Rebuilt/restarted through sanctioned Replit workflow:
  `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit`.
- Live HTTP GET after restart returned HTTP `200` with normal pressure and the
  stored snapshot:
  - generatedAt=`2026-07-02T23:42:23.978Z`
  - resolvedTimeframe=`5m`
  - evaluatedSymbolCount=`2000`
  - symbolsWithBars=`2000`
  - symbolsTimedOut=`0`
  - recommendedModelKey=`balanced-sot-v2`
  - calibration.state=`calibrated`
- `/api/healthz` returned `200 OK`, pressure normal.

Remaining work:

- Refresh compute is still expensive (~8m19s and several retried chunks). The
  request-time footgun is removed, but the next performance slice should make
  refresh cheaper, likely by computing from persisted signal observations or by
  selecting a cheaper fully-covered timeframe/materialized bar subset.

## Update 2026-07-02T18:12 MT / 2026-07-03T00:12Z

User corrected scope: the main workstream is signal scoring calibration, not
only snapshot infrastructure. Refocused on whether the calibrated model is
actually driving live score surfaces.

Observed calibration evidence:

- Fresh snapshot file:
  `/tmp/codex-kpis-phase4-snapshot-refresh.json`.
- Summary file:
  `/tmp/codex-kpis-phase4-snapshot-refresh-summary.json`.
- Snapshot coverage:
  - requestedTimeframe=`1m`
  - resolvedTimeframe=`5m`
  - evaluatedSymbolCount=`2000`
  - symbolsWithBars=`2000`
  - symbolsTimedOut=`0`
  - totalBars=`1343552`
  - observationCount=`7017`
- Model comparison:
  - `balanced-sot-v2`: supported, alignmentScore=`0.664796`,
    topBucketLiftPercent=`0.414796`, inversionCount=`0`.
  - `sot-outcome-v1`: supported, alignmentScore=`0.406906`,
    topBucketLiftPercent=`0.274162`, inversionCount=`1`.
  - `evidence-weighted-v2`: supported, alignmentScore=`0.182232`,
    topBucketLiftPercent=`0.209498`, inversionCount=`4`.
  - `trend-confirmation-v2`: unsupported, reason=`min_alignment_score`.
- Calibration decision:
  - state=`calibrated`
  - recommendedModelKey=`balanced-sot-v2`
  - supportedModelCount=`4`
  - reasons=`[]`

Calibration wiring changes:

- `artifacts/pyrus/src/screens/algo/algoHelpers.js`:
  - Active STA score fallback is now `balanced-sot-v2`.
  - The client scorer uses the same 72% SOT reversion / 28%
    trend-confirmation formula with extension penalty and volume support.
- `artifacts/api-server/src/services/signal-options-automation.ts`:
  - `classifySignalOptionsEntryQuality` now uses calibrated
    `balanced-sot-v2` scoring when `signal.filterState.directionalFeatures`
    are present.
  - Existing MTF/trend/liquidity/risk-fit setup-quality score remains the
    fallback for older candidates without directional features.
  - The backend test compares the automation classifier against
    `scoreSignalWithModel(..., "balanced-sot-v2")` from the KPI calibration
    scorer to prevent future drift.
- `artifacts/api-server/src/services/signal-options-exit-policy.ts`:
  - `SignalOptionsEntryQuality.components` now allows calibrated components
    (`reversion`, `confirmation`, `extensionPenalty`, `volumeSupport`) in
    addition to the legacy setup-quality component names.

Snapshot read-path footgun fixed:

- After UTC rolled to 2026-07-03, live GET initially returned a fresh
  `needs_more_data` placeholder because the stored calibrated snapshot was keyed
  to `asOfDay=2026-07-02`.
- Current deployment settings also drifted from the snapshot hash
  (`1999` requested symbols on the miss vs `2000` in the calibrated snapshot).
- `readSignalQualityKpiSnapshot` now falls back, for saved settings only, from:
  exact `(deployment, settingsHash, day)` -> latest same-day deployment snapshot
  -> latest deployment snapshot.
- Draft overrides still do not use fallback snapshots.

Validation:

- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts`
  passed: `32` tests.
- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/algoHelpers.test.mjs`
  passed: `56` tests.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-quality-kpis.test.ts src/services/signal-quality-kpis-service.test.ts`
  passed: `31` tests.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-quality-kpis-service.test.ts`
  passed after the snapshot fallback change: `15` tests.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- `git diff --check` passed for touched calibration/snapshot files.
- Restarted app through sanctioned workflow:
  `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit`.
- Runtime after restart:
  - API health: `200 OK` at `http://127.0.0.1:8080/api/healthz`.
  - Web: `200 OK` at `http://127.0.0.1:18747/`.
  - Live KPI GET now returns the calibrated snapshot:
    - asOfDay=`2026-07-02`
    - generatedAt=`2026-07-02T23:42:23.978Z`
    - evaluatedSymbolCount=`2000`
    - symbolsWithBars=`2000`
    - symbolsTimedOut=`0`
    - observationCount=`7017`
    - recommendedModelKey=`balanced-sot-v2`
    - calibration.state=`calibrated`
- After the first restart terminal exited with `143`, Replit had already
  launched a replacement PYRUS supervisor. Final checks at ~18:14 MT:
  - API health: `200 OK`, pressure normal.
  - Web root: `200 OK`.
  - KPI GET still returns `asOfDay=2026-07-02`, evaluated=`2000`,
    symbolsWithBars=`2000`, symbolsTimedOut=`0`,
    recommendedModelKey=`balanced-sot-v2`, calibration.state=`calibrated`.

Current status:

- Backfill data needed for the 2,000-symbol 5m/15m calibration window is
  complete.
- The calibrated model is now wired into both the STA/frontend score fallback
  and the backend Signal Options entry-quality payload when directional features
  are present.
- The normal KPI GET path returns the stored calibrated snapshot across day/hash
  drift instead of a zero-observation placeholder.
- App is running in dev via the sanctioned Replit workflow. API/web ports:
  `8080` / `18747`.

Next recommended work:

- Reduce refresh cost. Snapshot GET is cheap now, but explicit refresh still
  costs about 8m19s for the 2,000-symbol 90-day window. Best next slice is to
  compute calibration from persisted signal observations or a materialized
  observation table instead of repeatedly scanning `bar_cache`.

## Update 2026-07-02T18:15 MT / 2026-07-03T00:15Z

User said "proceed" on the next calibration slice.

Current goal:

- Reduce explicit signal-quality calibration refresh cost while preserving the
  calibrated model semantics.

Starting assumptions to verify:

- Baseline performance problem is measured: latest explicit refresh took
  `498996ms` (~8m19s) and scanned `1,343,552` bars for `2,000` symbols.
- The bottleneck is the full-window `bar_cache` scan/re-evaluation path, not the
  cheap snapshot GET path.
- The safest first slice is to find or introduce a materialized observation
  source that can feed the existing `buildKpiResult`/model-comparison logic.

Immediate next steps:

- Inspect `signal-quality-kpis.ts` and service refresh path.
- Inspect persisted signal/event tables for existing signal observations with
  directional features and outcome fields.
- Add focused tests before wiring any new fast path.
