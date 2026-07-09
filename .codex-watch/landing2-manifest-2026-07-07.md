# PYRUS landing2 manifest - 2026-07-07

Mapper: `codex-worker` for `claude-lead`  
Repo HEAD observed: `cd1e3eb2004aaa243a7e1a847ef3f01bf558b3aa` (`main`, `origin/main`)  
Scope: read-only mapping of the actual dirty tree for landing today's verified fix set as 8 themed commits. This manifest is the only repo write made by this worker.

## Reconciliation basis

Observed facts:

- `git rev-parse HEAD` returned `cd1e3eb2004aaa243a7e1a847ef3f01bf558b3aa`.
- Recent sibling commits through HEAD include `929fcb94 feat(signal-options): ... seen-signal store` and `cd1e3eb2 fix(signal-options): daily-pnl ...`.
- Initial expanded dirty path set from `(git diff --name-only; git ls-files --others --exclude-standard) | sort` was 64 paths before this manifest write.
- Final verification after this manifest write showed 70 expanded dirty paths: 69 excluding this manifest, plus `.codex-watch/landing2-manifest-2026-07-07.md`.
- Five tracked UI files appeared after the initial 64-path inventory and are classified as late-arriving HOLD/UI polish below.
- `artifacts/pyrus/.replit-artifact/artifact.toml` has only the two reconcile-on-startup env-line hunks.
- `artifacts/pyrus/package.json` has only two login dependency hunks: `class-variance-authority` and `radix-ui`.
- `pnpm-lock.yaml` differs only for the `class-variance-authority` / `radix-ui` dependency graph; no dirty `three` / neural dependency hunk was observed in the diff.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx` is not dirty; the deployment `placeholderData: retainPreviousData` line is already present in clean HEAD.

Inference:

- The morning HOLD inventory is stale. The HOLD list below is re-derived from the actual current dirty set.
- The signal-monitor events-list cache residue did not land via the sibling commits. It is still dirty in `artifacts/api-server/src/services/signal-monitor.ts` and remains HOLD.

## Deterministic staging method

Use the same patch-based index-only staging method as the morning manifest:

1. For mixed tracked files, write a temporary patch outside the repo, for example `/tmp/landing2-commit-N.patch`, from `git diff --unified=0 -- <files>`, then prune it to the exact hunk headers listed below.
2. Apply with `git apply --cached --unidiff-zero /tmp/landing2-commit-N.patch`.
3. For mixed new files, first run `git add -N <file>`, then produce/prune the new-file patch and apply it cached. Do not add the whole new file unless this manifest says `NEW/WHOLE`.
4. For whole files, use normal `git add <file>`.
5. Before each commit, verify with `git diff --cached --name-status`, `git diff --cached --check`, and the focused tests/typecheck for that commit when feasible.
6. Commit with the fixed title shown for that commit, then continue to the next patch. Do not stage HOLD hunks.

## Commit order and dependencies

Use the fixed order requested:

1. `fix(signals): breadth history from exact snapshots`
2. `fix(signals): decouple display freshness from automation trigger freshness`
3. `perf(signals): bypass UI-delta work for server-owned matrix producer`
4. `perf(api): cache + SQL-bucket breadth hydration`
5. `fix(web): algo screen no longer flashes stale-then-empty control panel`
6. `fix(web): honest Age column, idle-aware hydration strip, scope indicator`
7. `fix(web): STA table recovers from pressure shedding and stream drops`
8. `feat(web): shadcn login-03 gate`

Dependency notes:

- Commit 4 should follow commit 1 because both split the new `signal-monitor-breadth-history.test.ts`; commit 1 creates it without the SQL bucket-reduction test, commit 4 adds that test.
- Commit 3 should follow commit 2 because the stream producer bypass works alongside the commit-2 display/latched-state separation.
- In `signal-monitor-stream.test.ts`, do not stage the `withTestDb` / `sql` imports until commit 3. Stage the `as any` helper-return edits with commit 2 if commit 2 stages the display freshness tests first.
- `AlgoScreen.jsx` has no dirty hunk to stage for commit 5; only the test that pins the already-landed `retainPreviousData` behavior remains dirty.
- Commit 8 can stage the current `pnpm-lock.yaml` whole. The expected unsplittable lockfile warning does not apply to the current tree because the lockfile diff is login-dependency-only.

## Commit 1 - breadth history from exact snapshots

Message: `fix(signals): breadth history from exact snapshots`

Stage:

- HUNKS: `artifacts/api-server/src/services/signal-monitor.ts`
  - `@@ -1940,2 +1968,3 @@` snapshot builder comment: start at first real snapshot bucket.
  - `@@ -1976 +2005 @@` initialize snapshot carry-forward `last` as `null`.
  - `@@ -1982,0 +2012,3 @@` skip emitted buckets until first real snapshot is consumed.
  - `@@ -10246,0 +10344 @@` add `eventAnchorsInserted` to `SignalMonitorStateReconciliationCounts`.
  - `@@ -11269,0 +11368 @@` initialize `eventAnchorsInserted: 0`.
  - `@@ -11287,0 +11387,4 @@` create `firstResultByEnvironment`.
  - `@@ -11290,2 +11393,3 @@`, `@@ -11292,0 +11397,4 @@` capture counts per profile/environment.
  - `@@ -11299,0 +11408,18 @@` reconciliation startup hook calls `buildSignalMonitorEventAnchorBackfillPlan({ apply: true })` and records inserted count.
  - `@@ -14213,10 +14443,6 @@` prefer snapshot rows whenever any in-window snapshots exist.
  - Do not stage event-list cache residue hunks in this file.
- SPLIT NEW: `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`
  - Stage helper `alignBucketIso`.
  - Stage tests:
    - `breadth history uses available snapshots instead of incomplete event replay`
    - `breadth history accepts all range contracts and keeps day exact when snapshots cover it`
    - `recorded breadth snapshots include aged directional state rows`
    - `state-anchor-backfill metadata cannot make aged signals actionable`
  - Do not stage `breadth history snapshot reduction keeps the latest snapshot per bucket` here; commit 4 owns it.
- HUNKS/WHOLE: `artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts`
  - `@@ -37,0 +38 @@` add `eventAnchorsInserted` to `COUNT_KEYS`.
  - `@@ -1089,0 +1091,83 @@` add reconciliation inserts event anchors/idempotency test.
- HUNKS/WHOLE: `artifacts/pyrus/.replit-artifact/artifact.toml`
  - `@@ -34,0 +35 @@` add `PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP = "1"`.
  - `@@ -41,0 +43 @@` add the same env line for the second env block.

Report evidence: `.codex-watch/breadth-fix-report-2026-07-07.md` plus its Truncation Amendment. Mapper did not rerun tests.

## Commit 2 - display freshness decoupling

Message: `fix(signals): decouple display freshness from automation trigger freshness`

Stage:

- HUNKS: `artifacts/api-server/src/services/signal-monitor.ts`
  - `@@ -1205 +1207,17 @@` add `signalMonitorResponseFresh` and pass `freshWindowBars` into `stateToResponse`.
  - `@@ -1266 +1284,10 @@` response `fresh` derives from display bar-window semantics, not stored automation `fresh`.
  - `@@ -1283,0 +1311 @@`, `@@ -1288 +1316 @@` thread `freshWindowBars` through `stateToResponseForSnapshot`.
  - `@@ -9276,2 +9311,0 @@`, `@@ -9284,0 +9319,6 @@` stream display mapper derives UI `fresh`.
  - `@@ -11599 +11725,5 @@`, `@@ -11786 +11916,5 @@`, `@@ -12464,0 +12599 @@`, `@@ -13458,0 +13675 @@`, `@@ -13566,0 +13784 @@`, `@@ -13776,0 +13995 @@` response mapper call sites pass owning profile `freshWindowBars`.
  - `@@ -13137,0 +13273,3 @@`, `@@ -13169,0 +13308 @@`, `@@ -13206 +13344,0 @@` test-internal exports for the new mapper helpers.
- HUNKS: `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - Stage display freshness tests:
    - `response display freshness is derived from bar-window age`
    - `matrix stream display freshness matches REST response freshness`
  - Stage helper return edits `@@ -204 +438 @@`, `@@ -224 +458 @@`, and `@@ -580 +814 @@` (`as never` to `as any`) with this commit if these tests are staged before commit 3.
  - Do not stage `withTestDb`/`sql` imports or server-owned-producer tests here.
- HUNKS: `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts`
  - Stage `@@ -840,0 +841 @@`, `@@ -885,0 +887 @@`, `@@ -928,0 +931 @@`, `@@ -971,0 +975 @@` adding explicit `freshWindowBars`.
  - Do not stage `@@ -1341 +1345 @@` (`loadSignalMonitorEventRows`); that belongs to events-cache HOLD.
- HUNK: `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - `@@ -3013 +3016 @@` relabel hydration strip from freshness wording to `${missing} cells awaiting data`.

Report evidence: `.codex-watch/fix-wave-2026-07-07.md` Item 1. Mapper did not rerun tests.

## Commit 3 - server-owned producer bypass

Message: `perf(signals): bypass UI-delta work for server-owned matrix producer`

Stage:

- HUNKS: `artifacts/api-server/src/services/signal-monitor.ts`
  - `@@ -351,0 +353 @@` add `lastPersistDirtyKeys` to stream subscriber state.
  - `@@ -9386,0 +9427,31 @@` add cheap persist dirty-key helpers.
  - `@@ -9779,8 +9850,4 @@`, `@@ -9788,0 +9856,22 @@`, `@@ -9791 +9880 @@`, `@@ -9797,0 +9887,3 @@`, `@@ -9802 +9894,5 @@` bypass UI signature/delta/onEvent work for `serverOwnedProducer`, while persisting latched states.
  - `@@ -10006,0 +10103 @@` initialize `lastPersistDirtyKeys` in test subscription helper.
- HUNKS: `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
  - `@@ -5,0 +6,2 @@` add `withTestDb` and `sql` imports.
  - Stage tests:
    - `server-owned producer persists direction flips through the canonical path`
    - `server-owned producer bypasses stream signature and delta event work`
  - If the commit-2 helper `as any` edits were not already staged, include the helper edits needed by these tests.

Report evidence: `.codex-watch/fix-wave-2026-07-07.md` Item 3 and `.codex-watch/elu-profile-2026-07-07.md`. Mapper did not rerun tests.

## Commit 4 - breadth hydration cache + SQL bucket reduction

Message: `perf(api): cache + SQL-bucket breadth hydration`

Stage:

- HUNKS/WHOLE: `artifacts/api-server/src/routes/signal-monitor.ts`
  - `@@ -261,0 +262,53 @@` add 5s serialized breadth-history route cache and reset helper.
  - `@@ -307,6 +360,14 @@`, `@@ -314 +375 @@` serve `/signal-monitor/breadth-history` through cached serialized `RawJson`.
- NEW/WHOLE: `artifacts/api-server/src/routes/signal-monitor-route-cache.test.ts`
  - Concurrent miss dedupe and TTL recompute tests.
- HUNK: `artifacts/api-server/src/services/signal-monitor.ts`
  - `@@ -14188,16 +14407,27 @@` replace full snapshot read with `SELECT DISTINCT ON (timeframe, bucket)` latest-per-bucket SQL reduction and sort result rows by captured time.
- SPLIT HUNK: `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`
  - Stage only `breadth history snapshot reduction keeps the latest snapshot per bucket`.
  - This is the only commit-4 test in the otherwise commit-1 new file.

Report evidence: `.codex-watch/fix-wave-2026-07-07.md` Item 2. Mapper did not rerun tests.

## Commit 5 - algo stale-then-empty flash

Message: `fix(web): algo screen no longer flashes stale-then-empty control panel`

Stage:

- OBSERVED ALREADY LANDED: `artifacts/pyrus/src/screens/AlgoScreen.jsx`
  - No dirty diff exists. Clean HEAD already contains `placeholderData: retainPreviousData` in the deployments query.
- HUNK/WHOLE: `artifacts/pyrus/src/screens/AlgoScreen.test.mjs`
  - `@@ -100,0 +101,8 @@` pin deployments query `placeholderData: retainPreviousData`.
- HUNKS/WHOLE: `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
  - `@@ -834 +834,4 @@` compute `emptyOperationsSetupSettled = setupDataSettled && !refreshPending` and make empty branch depend only on no deployments.
  - `@@ -839 +842 @@` pass `emptyOperationsSetupSettled` to `EmptyOperationsState`.
- HUNK/WHOLE: `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`
  - `@@ -151,0 +152,16 @@` pin refetch gaps as loading, not settled no-deployment.

Report evidence: `.codex-watch/algo-flicker-2026-07-07.md`. Mapper did not rerun tests.

## Commit 6 - honest Age column, idle hydration, scope indicator

Message: `fix(web): honest Age column, idle-aware hydration strip, scope indicator`

Stage:

- HUNKS: `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - `@@ -455 +457 @@`, `@@ -457 +459,2 @@`, `@@ -460 +463 @@` format display age from `displayAgeBars` and mark signal-bars fallback with ` sig`.
  - `@@ -4306,12 +4317,17 @@` rename column to `Trend age`, widen it, and add fallback title/muted styling.
  - `@@ -4555,0 +4572,11 @@` compute scope coverage label from `signalMatrixUniverse.resolvedSymbols` and `signalMatrixCoverage.activeScopeSymbols`.
  - `@@ -4668,0 +4696,5 @@` render scope indicator pill.
  - Do not stage the hydration strip label hunk here; commit 2 owns it.
  - Do not stage retry import/query hunks here; commit 7 owns them.
- HUNKS/WHOLE: `artifacts/pyrus/src/features/signals/signalsRowModel.js`
  - All observed hunks: `resolveDashboardSummary(snapshotEntry, fallbackAgeBars)`, `displayAgeBars`/`displayAgeSource`, derive `displayBarsSinceSignal`, pass it into dashboard summary, use it for row `barsSinceSignal`, and sort Age by `displayAgeBars`.
- HUNK/WHOLE: `artifacts/pyrus/src/features/signals/signalsRowModel.test.mjs`
  - `@@ -481,0 +482,62 @@` trend age fallback/source/sort test.
- HUNKS/WHOLE: `artifacts/pyrus/src/features/signals/signalsMatrixHydration.js`
  - `@@ -23 +23 @@` treat `idle` matrix state as renderable/hydrated when otherwise valid.
- HUNK/WHOLE: `artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.mjs`
  - `@@ -88,0 +89,19 @@` idle cells covered/not awaiting data test.
- SPLIT HUNKS: `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs`
  - Stage tests:
    - `Signals age column labels trend age and marks signal-bars fallback`
    - `Signals screen surfaces scope truncation from existing matrix metadata`
  - Do not stage `Signals fallback REST queries keep stale data and retry 429 pressure sheds`; commit 7 owns it.

Report evidence: `.codex-watch/age-honesty-2026-07-07.md`. Mapper did not rerun tests.

## Commit 7 - STA pressure/drop recovery

Message: `fix(web): STA table recovers from pressure shedding and stream drops`

Stage:

- HUNKS/WHOLE: `artifacts/pyrus/src/features/platform/queryDefaults.js`
  - `@@ -16,0 +17,19 @@` add `parseRetryAfterMs` and `retryDelayWithRetryAfter`.
  - `@@ -21 +40,3 @@`, `@@ -32 +53,3 @@` wrap default retry delays with Retry-After support.
- NEW/WHOLE: `artifacts/pyrus/src/features/platform/queryDefaults.test.mjs`
  - Tests for seconds/date parsing and Retry-After delay precedence.
- HUNKS/WHOLE: `artifacts/pyrus/src/features/platform/platformJsonRequest.js`
  - `@@ -0,0 +1,2 @@` import `parseRetryAfterMs`.
  - `@@ -61,0 +64,3 @@` attach `retryAfterMs` to non-2xx errors.
- HUNK/WHOLE: `artifacts/pyrus/src/features/platform/platformJsonRequest.test.mjs`
  - `@@ -141,0 +142,20 @@` Retry-After error propagation test.
- HUNKS/WHOLE: `artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx`
  - `@@ -21,0 +22 @@` import shared `parseRetryAfterMs`.
  - `@@ -248,11 +248,0 @@` remove local parser.
- HUNKS: `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
  - `@@ -7,0 +8 @@` import `startTransition`.
  - `@@ -127 +128 @@` import `retryUnlessTimeout`.
  - `@@ -3188 +3189,3 @@` signal monitor profile query retries, Retry-After delay, previous data.
  - `@@ -3324 +3327,2 @@` signal events query retries and Retry-After delay; previous data already exists in HEAD.
  - `@@ -3608 +3612 @@`, `@@ -3621 +3625 @@` wrap matrix snapshot commits in `startTransition`.
- HUNK/WHOLE: `artifacts/pyrus/src/app/AppContent.preloadContention.test.mjs`
  - `@@ -126,0 +127,30 @@` tests for non-urgent matrix stream commits and signal monitor query retry/previous-data behavior.
- HUNK/WHOLE: `artifacts/pyrus/src/features/platform/live-streams.test.mjs`
  - `@@ -864,0 +865,10 @@` terminal reconnect creates fresh EventSource/bootstrap test.
- HUNKS: `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - `@@ -67,0 +68 @@`, `@@ -68,0 +70 @@` import `QUERY_DEFAULTS` and `retryUnlessTimeout`.
  - `@@ -3440 +3443,3 @@`, `@@ -3448 +3453,3 @@`, `@@ -3456 +3463,3 @@`, `@@ -3466 +3475,3 @@` fallback profile/state/events/breadth queries retry pressure sheds and retain previous data.
  - Do not stage age/scope or strip-label hunks here.
- SPLIT HUNK: `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs`
  - Stage only `Signals fallback REST queries keep stale data and retry 429 pressure sheds`.

Report evidence: `.codex-watch/sta-freeze-2026-07-07.md`. Mapper did not rerun tests.

## Commit 8 - shadcn login gate

Message: `feat(web): shadcn login-03 gate`

Stage:

- NEW/WHOLE:
  - `artifacts/pyrus/src/components/ui/button.tsx`
  - `artifacts/pyrus/src/components/ui/card.tsx`
  - `artifacts/pyrus/src/components/ui/field.tsx`
  - `artifacts/pyrus/src/components/ui/input.tsx`
  - `artifacts/pyrus/src/components/ui/label.tsx`
  - `artifacts/pyrus/src/components/ui/separator.tsx`
- HUNKS/WHOLE: `artifacts/pyrus/src/features/auth/LoginGate.jsx`
  - Stage all observed hunks: import shadcn components, remove local `Field`, add `className="dark"`, refactor form into `Card`/`CardHeader`/`CardContent`, use shadcn `Input`/`Label`/`Button`.
- OBSERVED UNCHANGED: `artifacts/pyrus/src/features/auth/LoginGate.d.ts`
  - Not dirty; do not stage.
- HUNKS/WHOLE: `artifacts/pyrus/package.json`
  - `@@ -61,0 +62 @@` add `class-variance-authority`.
  - `@@ -63,0 +65 @@` add `radix-ui`.
- WHOLE: `pnpm-lock.yaml`
  - Stage whole current lockfile. Actual diff is purely the CVA/Radix graph required by the two package hunks. No neural package hunk was observed.

Lockfile recommendation:

- The isolated-worktree lockfile regeneration procedure from the warning is not required for the current tree. If the executor wants extra certainty, stage commit 8 in an isolated verification worktree and run `pnpm install --lockfile-only`; the expected output should match the current lockfile diff.

## HOLD inventory

### Events-cache residue - HOLD

Mixed file hunks to leave unstaged:

- `artifacts/api-server/src/services/signal-monitor.ts`
  - `@@ -13,0 +14 @@` `type SQL` import.
  - `@@ -2366,0 +2399,3 @@` cache bust in `insertSignalMonitorEventAnchorBackfillCandidates`.
  - `@@ -6238,0 +6274 @@` cache bust in `insertSignalEvent`.
  - `@@ -13326,0 +13465,22 @@` `SignalMonitorEventsListRow` type and cache/in-flight maps.
  - `@@ -13331,0 +13492,4 @@` `bustSignalMonitorEventsListCache`.
  - `@@ -13380,0 +13545,52 @@` `loadSignalMonitorEventRows`.
  - `@@ -14325,21 +14551,14 @@` `listSignalMonitorEvents` cache-key/use of `loadSignalMonitorEventRows`.
- `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts`
  - `@@ -1341 +1345 @@` event-list read-order test now looking for `loadSignalMonitorEventRows`.

### Signal-options / tally / sibling WIP - HOLD

- `artifacts/api-server/src/services/signal-options-automation.ts`
  - Position-marking detail composition and test export hunk.
- `artifacts/api-server/src/services/signal-options-automation.test.ts`
  - `position_marking rule composes detail from only nonzero clauses`.
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs`
  - MTF alignment expectation update from trend-direction counting to crossover-signal counting.
- `docs/reviews/2026-07-07-signal-options-system-review.md`
  - Generated multi-agent signal-options review.

### Ops/session/report churn - HOLD

- `.codex-watch-live-auth/auth-live-probe-summary.json`
- `.codex-watch-live/issue-10-visible-runtime-state.png`
- `.codex-watch-live/live-watch-summary.json`
- `.codex-watch/age-honesty-2026-07-07.md`
- `.codex-watch/algo-flicker-2026-07-07.md`
- `.codex-watch/breadth-fix-report-2026-07-07.md`
- `.codex-watch/breadth-investigation-2026-07-07.md`
- `.codex-watch/elu-profile-2026-07-07.md`
- `.codex-watch/fix-wave-2026-07-07.md`
- `.codex-watch/freshness-hydration-investigation-2026-07-07.md`
- `.codex-watch/landing-execution-report-2026-07-07.md`
- `.codex-watch/landing-manifest-2026-07-07.md`
- `.codex-watch/landing2-manifest-2026-07-07.md`
- `.codex-watch/signals-restrictions-audit-2026-07-07.md`
- `.codex-watch/sta-freeze-2026-07-07.md`
- `.codex-watch/task3-completion-report-2026-07-07.md`
- `.codex-watch/watch-038.png`
- `.codex-watch/watch-291.png`
- `.codex-watch/watch-300.png`
- `.codex-watch/watch-summary.json`
- `SESSION_HANDOFF_2026-07-07_5360980c-fbf6-464f-9218-7740228e4d2f.md`
- `SESSION_HANDOFF_2026-07-07_68e08ab5-bcaa-4f77-aa9e-84bbd6e754a2.md`
- `SESSION_HANDOFF_2026-07-07_e61dae50-84a9-4daa-83f1-6130b28bed55.md`
- `SESSION_HANDOFF_CURRENT.md`
- `SESSION_HANDOFF_MASTER.md`
- `lib/db/src/index.ts`
  - Test seam for raw `pool.query(...)` override; not mentioned in verified fix reports.
- `lib/db/src/testing.ts`
  - PGlite `pool.query` routing through the new test seam; not mentioned in verified fix reports.

### Late-arriving UI polish/churn - HOLD

These paths appeared dirty during final verification after the initial 64-path inventory. They are not in the six source reports for the eight requested commits.

- `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx`
  - Removes explanatory copy blocks from the backtest workspace.
- `artifacts/pyrus/src/features/flow/FlowDistributionScannerPanel.jsx`
  - Adds a `Premium Distribution` label.
- `artifacts/pyrus/src/features/market/MultiChartGrid.jsx`
  - Changes visible-chart copy to include hydrated count.
- `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
  - Maps `error`/`critical` to error tone and `unknown`/`degraded` to warning tone.
- `artifacts/pyrus/src/screens/SettingsScreen.jsx`
  - Mirrors diagnostics severity tone mapping in the settings status strip.

### Tax lane - HOLD

- No tax-lane dirty paths were observed in the actual expanded dirty set at HEAD `cd1e3eb2`.

### Neural lane - HOLD

- No neural-lane dirty source paths were observed in the actual expanded dirty set.
- `artifacts/pyrus/package.json` and `pnpm-lock.yaml` are not neural HOLD in the current tree; their diffs are login dependency only.

## Completeness reconciliation

Expanded dirty paths at final verification, including this manifest:

1. `.codex-watch-live-auth/auth-live-probe-summary.json` - HOLD ops
2. `.codex-watch-live/issue-10-visible-runtime-state.png` - HOLD ops
3. `.codex-watch-live/live-watch-summary.json` - HOLD ops
4. `.codex-watch/age-honesty-2026-07-07.md` - HOLD ops
5. `.codex-watch/algo-flicker-2026-07-07.md` - HOLD ops
6. `.codex-watch/breadth-fix-report-2026-07-07.md` - HOLD ops
7. `.codex-watch/breadth-investigation-2026-07-07.md` - HOLD ops
8. `.codex-watch/elu-profile-2026-07-07.md` - HOLD ops
9. `.codex-watch/fix-wave-2026-07-07.md` - HOLD ops
10. `.codex-watch/freshness-hydration-investigation-2026-07-07.md` - HOLD ops
11. `.codex-watch/landing-execution-report-2026-07-07.md` - HOLD ops
12. `.codex-watch/landing-manifest-2026-07-07.md` - HOLD ops
13. `.codex-watch/signals-restrictions-audit-2026-07-07.md` - HOLD ops
14. `.codex-watch/sta-freeze-2026-07-07.md` - HOLD ops
15. `.codex-watch/task3-completion-report-2026-07-07.md` - HOLD ops
16. `.codex-watch/watch-038.png` - HOLD ops
17. `.codex-watch/watch-291.png` - HOLD ops
18. `.codex-watch/watch-300.png` - HOLD ops
19. `.codex-watch/watch-summary.json` - HOLD ops
20. `SESSION_HANDOFF_2026-07-07_5360980c-fbf6-464f-9218-7740228e4d2f.md` - HOLD ops
21. `SESSION_HANDOFF_2026-07-07_68e08ab5-bcaa-4f77-aa9e-84bbd6e754a2.md` - HOLD ops
22. `SESSION_HANDOFF_2026-07-07_e61dae50-84a9-4daa-83f1-6130b28bed55.md` - HOLD ops
23. `SESSION_HANDOFF_CURRENT.md` - HOLD ops
24. `SESSION_HANDOFF_MASTER.md` - HOLD ops
25. `artifacts/api-server/src/routes/signal-monitor-route-cache.test.ts` - commit 4
26. `artifacts/api-server/src/routes/signal-monitor.ts` - commit 4
27. `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts` - split commits 1 and 4
28. `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts` - commit 2 plus HOLD events-cache hunk
29. `artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts` - commit 1
30. `artifacts/api-server/src/services/signal-monitor-stream.test.ts` - split commits 2 and 3
31. `artifacts/api-server/src/services/signal-monitor.ts` - split commits 1, 2, 3, 4 plus HOLD events-cache hunks
32. `artifacts/api-server/src/services/signal-options-automation.test.ts` - HOLD sibling WIP
33. `artifacts/api-server/src/services/signal-options-automation.ts` - HOLD sibling WIP
34. `artifacts/pyrus/.replit-artifact/artifact.toml` - commit 1
35. `artifacts/pyrus/package.json` - commit 8
36. `artifacts/pyrus/src/app/AppContent.preloadContention.test.mjs` - commit 7
37. `artifacts/pyrus/src/components/ui/button.tsx` - commit 8
38. `artifacts/pyrus/src/components/ui/card.tsx` - commit 8
39. `artifacts/pyrus/src/components/ui/field.tsx` - commit 8
40. `artifacts/pyrus/src/components/ui/input.tsx` - commit 8
41. `artifacts/pyrus/src/components/ui/label.tsx` - commit 8
42. `artifacts/pyrus/src/components/ui/separator.tsx` - commit 8
43. `artifacts/pyrus/src/features/auth/LoginGate.jsx` - commit 8
44. `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx` - HOLD late UI polish
45. `artifacts/pyrus/src/features/flow/FlowDistributionScannerPanel.jsx` - HOLD late UI polish
46. `artifacts/pyrus/src/features/market/MultiChartGrid.jsx` - HOLD late UI polish
47. `artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx` - commit 7
48. `artifacts/pyrus/src/features/platform/PlatformApp.jsx` - commit 7
49. `artifacts/pyrus/src/features/platform/live-streams.test.mjs` - commit 7
50. `artifacts/pyrus/src/features/platform/platformJsonRequest.js` - commit 7
51. `artifacts/pyrus/src/features/platform/platformJsonRequest.test.mjs` - commit 7
52. `artifacts/pyrus/src/features/platform/queryDefaults.js` - commit 7
53. `artifacts/pyrus/src/features/platform/queryDefaults.test.mjs` - commit 7
54. `artifacts/pyrus/src/features/signals/signalsMatrixHydration.js` - commit 6
55. `artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.mjs` - commit 6
56. `artifacts/pyrus/src/features/signals/signalsRowModel.js` - commit 6
57. `artifacts/pyrus/src/features/signals/signalsRowModel.test.mjs` - commit 6
58. `artifacts/pyrus/src/screens/AlgoScreen.test.mjs` - commit 5
59. `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx` - HOLD late UI polish
60. `artifacts/pyrus/src/screens/SettingsScreen.jsx` - HOLD late UI polish
61. `artifacts/pyrus/src/screens/SignalsScreen.jsx` - split commits 2, 6, 7
62. `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs` - split commits 6 and 7
63. `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx` - commit 5
64. `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs` - commit 5
65. `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs` - HOLD sibling WIP
66. `docs/reviews/2026-07-07-signal-options-system-review.md` - HOLD sibling WIP/report
67. `lib/db/src/index.ts` - HOLD ops/test-harness
68. `lib/db/src/testing.ts` - HOLD ops/test-harness
69. `pnpm-lock.yaml` - commit 8
70. `.codex-watch/landing2-manifest-2026-07-07.md` - HOLD ops / this manifest

No UNKNOWN paths remain. Mixed files are explicitly partitioned at hunk level above.

## Final risk flags

- The hardest split remains `artifacts/api-server/src/services/signal-monitor.ts`; do not stage the events-cache residue with commits 1-4.
- `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts` is new and mixed; staging it whole would incorrectly pull the commit-4 SQL bucket test into commit 1.
- `artifacts/pyrus/src/screens/SignalsScreen.jsx` is mixed across commits 2, 6, and 7; use hunk staging.
- `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs` is mixed across commits 6 and 7.
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts` is mixed across commits 2 and 3; avoid unused `withTestDb`/`sql` imports in commit 2.
- `lib/db/src/index.ts` and `lib/db/src/testing.ts` are real dirty tracked files but are not in the verified fix reports; leaving them HOLD preserves the requested eight-commit scope.
- Five late-arriving UI polish files appeared during final verification; they are deliberately excluded from the eight commits.
