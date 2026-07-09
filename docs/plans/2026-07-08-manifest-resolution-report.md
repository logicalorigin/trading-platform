<!-- Produced by Codex (gpt-5.5, reasoning=high) under work order A from Claude session
647f6c8d, 2026-07-08. Evidence basis: inlined git diff HEAD per-file sections; no shell.
Companion to docs/plans/2026-07-07-time-semantics-landing-manifest.md — resolves its ⚠ items.
Claude verification annotations at the bottom. -->

# Manifest resolution report — 2026-07-08

Observed evidence source: inlined manifest, `git log origin/main..HEAD`, `git status --short`, and per-file `git diff HEAD -- <file>` sections. No shell commands were run.

## Checklist Coverage

Observed `⚠` markers in manifest: **6 glyphs**. They resolve to **5 audit checklist groups**: A1, A2, A3, A4, A5. The extra marker is the general “verify before staging” instruction, not a separate file item.

| Item | Verdict | Evidence |
|---|---:|---|
| A1 `signal-options-automation.ts` split | CONFIRMED with added reassignment detail | Time lane hunks quote `Wave-2 C1/C2/C4`, `Wave-2 C5`; sibling hunks quote `Wave-2 D1`, `oppositeSignal`, `reEntryWatch`, `scaleOut`. |
| A2 `shadow-account.ts` split | CONFIRMED | Time lane hunks quote `Holiday-aware`, `rthBarsBack`; exit-dedup hunks quote `Partial scale-outs have their own identity`. |
| A3 `signal-monitor.ts` split | CONFIRMED with events-cache residue reassigned | Prior-session hunks quote `Prior-session entry block`; census hunks quote `B1`, `B2`, `B3`, `B4`, `Census S9`; events-cache residue is Commit 5 by cache/firehose evidence. |
| A4 unattributed Commit 5 list | PARTLY CONFIRMED / PARTLY REASSIGNED / UNKNOWN | See A4 table below. |
| A5 DO-NOT-STAGE owner confirmations | CONFIRMED except `robinhood.ts` clean | `signal-options-worker.ts` quotes `Entries never pause under pressure`; exit-dedup test quotes `partial scale-outs`; `robinhood.ts` has no diff body. |

## A1 — `signal-options-automation.ts` Hunk Attribution

| Hunk | Description | Attribution | Conf. | Evidence |
|---|---|---:|---:|---|
| `@@ -26,6 +26,13 @@` | market-calendar imports | Commit 2 | high | `Wave-2 C1/C2/C4`, `tradingDaysBetween` |
| `@@ -65,6 +72,7 @@` | monitor session helper import | Commit 3 | high | `signalMonitorCurrentSessionOpenAtNow` |
| `@@ -151,6 +159,15 @@` | scale-out/opposite/re-entry constants | signal-options lane | high | `SCALE_OUT`, `OPPOSITE_SIGNAL`, `RE_ENTRY_WATCH` |
| `@@ -501,6 +518,11 @@` | entryGate passthrough | Commit 4 | high | `Wave-2 D1 (MTF display truth)` |
| `@@ -512,6 +534,7 @@` | `sourceSignalKey` on position | signal-options lane | high | `sourceSignalKey` with `reEntryWatch` family |
| `@@ -526,6 +549,31 @@` | opposite confirm/re-entry types | signal-options lane | high | `SignalOptionsOppositeSignalPendingConfirm`, `SignalOptionsReEntryWatch` |
| `@@ -890,7 +938,7 @@` | remainingPosition support | signal-options lane | high | `payload.remainingPosition ?? payload.position` |
| `@@ -2580,6 +2628,12 @@` | sessionOpenAt snapshot | Commit 3 | high | `Wave-2 C5 (prior-session entry block)` |
| `@@ -3375,7 +3429,11 @@` | DTE trading days | Commit 2 | high | `Wave-2 C1`, `tradingDaysBetween` |
| `@@ -6471,6 +6529,11 @@` | entryGate candidate payload | Commit 4 | high | `Wave-2 D1 (MTF display truth)` |
| `@@ -6577,9 +6640,296 @@` | entryGate merge plus opposite/re-entry helpers | mixed: Commit 4 first 4 lines, rest signal-options lane | high | `Wave-2 D1` then `signalOptionsOppositeSignalPendingConfirmFromPayload` / `signalOptionsReEntryWatchFromPayload` |
| `@@ -6612,6 +6962,13 @@` | re-entry position source | signal-options lane | high | `reEntryWatch`, `sourceSignalKey` |
| `@@ -6633,6 +6990,7 @@` | store `sourceSignalKey` | signal-options lane | high | `sourceSignalKey` |
| `@@ -6659,6 +7017,11 @@` | position opposite/re-entry fields | signal-options lane | high | `oppositeSignalPendingConfirm`, `reEntryWatch` |
| `@@ -6671,6 +7034,7 @@` | fold state re-entry map | signal-options lane | high | `reEntryWatches` |
| `@@ -6678,18 +7042,84 @@` | partial exits and re-entry fold | signal-options lane | high | `partial`, `scaleOutId`, `reEntryWatches` |
| `@@ -6700,6 +7130,9 @@` | persist re-entry watch on entry | signal-options lane | high | `position.reEntryWatch` |
| `@@ -6708,7 +7141,20 @@` | partial exit fold | signal-options lane | high | `signalOptionsExitPayloadIsPartial` |
| `@@ -6720,15 +7166,19 @@` | opposite confirm clear skip | signal-options lane | high | `SIGNAL_OPTIONS_OPPOSITE_SIGNAL_PENDING_CONFIRM_CLEARED_REASON` |
| `@@ -6762,10 +7212,11 @@` | apply opposite confirm patch | signal-options lane | high | `applyOppositeSignalPendingConfirmPositionPatch` |
| `@@ -6780,6 +7231,36 @@` | scale-out already fired helper | signal-options lane | high | `signalOptionsPositionScaleOutAlreadyFired` |
| `@@ -6803,6 +7284,20 @@` | derived position state with watches | signal-options lane | high | `deriveSignalOptionsPositionState`, `reEntryWatches` |
| `@@ -7684,14 +8179,6 @@` | remove UTC same-date helper | Commit 2 | high | paired with `Wave-2 C3` below |
| `@@ -7705,7 +8192,10 @@` | daily loss NY market date | Commit 2 | high | `Wave-2 C3`, `marketDateKeyFromDate` |
| `@@ -7715,12 +8205,15 @@` | partial-exit PnL dedup key | signal-options lane | high | `partial`, `scaleOutId`, `:final` |
| `@@ -7881,16 +8374,28 @@` | 24h closed link rescue | signal-options lane | med | `closed within the last 24h`, row-to-position link rescue |
| `@@ -7934,8 +8439,9 @@` | comment update for rescue set | signal-options lane | med | `rescue-set position key` |
| `@@ -11873,6 +12379,10 @@` | state payload re-entry watches | signal-options lane | high | `reEntryWatches`, `exitPolicy.reEntryWatch` |
| `@@ -11909,6 +12419,9 @@` | expose reEntryWatches | signal-options lane | high | `{ reEntryWatches }` |
| `@@ -12922,6 +13435,7 @@` | manage result scaledOut | signal-options lane | high | `scaledOut` |
| `@@ -12944,6 +13458,7 @@` | refresh result scaledOut | signal-options lane | high | `scaledOut` |
| `@@ -13276,11 +13791,18 @@` | compute stop with scale-out | signal-options lane | high | `scaleOutAlreadyFired`, `quantity` |
| `@@ -13327,6 +13849,12 @@` | detect scale-out exit | signal-options lane | high | `scaleOutExit` |
| `@@ -13369,7 +13897,7 @@` | allow scale-out exit | signal-options lane | high | `(exitReason || scaleOutExit)` |
| `@@ -13409,7 +13937,7 @@` | scale-out quote unavailable reason | signal-options lane | high | `scale_out_first_trail_arm` |
| `@@ -13423,17 +13951,31 @@` | fallback bid fill model | signal-options lane | med | `delayed quote`, `mid->bid gap` |
| `@@ -13441,15 +13983,102 @@` | scale-out event payload/re-entry watch | signal-options lane | high | `partial`, `remainingPosition`, `reEntryWatch` |
| `@@ -13486,9 +14118,10 @@` | scaled-out return result | signal-options lane | high | `scaledOut: scaleOutExit` |
| `@@ -14788,6 +15421,7 @@` | process entry reEntryWatch input | signal-options lane | high | `reEntryWatch` |
| `@@ -15244,6 +15878,13 @@` | consume re-entry watch on entry | signal-options lane | high | `consumeSignalOptionsReEntryWatch` |
| `@@ -15252,6 +15893,12 @@` | sourceSignalKey on entry | signal-options lane | high | `sourceSignalKey` |
| `@@ -15262,6 +15909,7 @@` | position reEntryWatch | signal-options lane | high | `reEntryWatch` |
| `@@ -15308,6 +15956,9 @@` | entry payload reEntry marker | signal-options lane | high | `reEntry: true` |
| `@@ -15326,6 +15977,130 @@` | opposite-signal dual confirm helpers | signal-options lane | high | `OppositeSignalDualConfirmAction` |
| `@@ -15333,6 +16108,17 @@` | close opposite signal action | signal-options lane | high | `resolveOppositeSignalDualConfirmAction` |
| `@@ -15345,6 +16131,11 @@` | intended partial quantity | signal-options lane | high | `intendedExitQuantity`, `oppositeSignalDualConfirm` |
| `@@ -15354,11 +16145,12 @@` | partial exit claim key | signal-options lane | high | `scale-out`, `OPPOSITE_SIGNAL_FIRST_CONFIRM` |
| `@@ -15370,31 +16162,83 @@` | partial opposite-signal exit event | signal-options lane | high | `shadow partial opposite-signal exit` |
| `@@ -15945,10 +16789,6 @@` | remove weekday helper | Commit 2 | high | paired with `Wave-2 C4` |
| `@@ -15997,23 +16837,15 @@` | holiday-aware backfill date | Commit 2 | high | `Wave-2 C4`, `previousTradingDayOrSame` |
| `@@ -16073,15 +16905,25 @@` | market session predicates helper | Commit 2 | high | `Wave-2 C2`, `resolveNyseCalendarDay` |
| `@@ -16099,27 +16941,29 @@` | live option/overnight sessions | Commit 2 | high | `C2: extended-close`, `C2: final 15m` |
| `@@ -16648,15 +17492,28 @@` | exported post-exit outcome bars | signal-options lane | med | `computeSignalOptionsPostExitOutcomeFromBars` |
| `@@ -16686,9 +17543,9 @@` | post-exit bar price helper | signal-options lane | med | `postExitOutcomeBarPrice` |
| `@@ -16725,16 +17582,30 @@` | post-exit outcome wrapper | signal-options lane | med | `entryPrice`, `nextBarIndex` |
| `@@ -17661,6 +18532,7 @@` | backfill sourceSignalKey input | signal-options lane | high | `sourceSignalKey` |
| `@@ -17686,6 +18558,9 @@` | backfill position source key | signal-options lane | high | `exitPolicy.reEntryWatch.enabled` |
| `@@ -17732,6 +18607,10 @@` | backfill payload re-entry fields | signal-options lane | high | `sourceSignalKey`, `reEntryWatch` |
| `@@ -17821,6 +18700,13 @@` | backfill close reEntryWatch | signal-options lane | high | `buildSignalOptionsReEntryWatchFromExit` |
| `@@ -17869,6 +18755,7 @@` | write reEntryWatch | signal-options lane | high | `{ reEntryWatch }` |
| `@@ -19156,6 +20043,7 @@` | source signal key in backfill | signal-options lane | high | `sourceSignalKey: signalKey` |
| `@@ -20033,6 +20921,9 @@` | runtime reEntry watches | signal-options lane | high | `deriveSignalOptionsPositionState` |
| `@@ -20080,7 +20971,13 @@` | seen-signal bypass for re-entry | signal-options lane | high | `seenSignals.has(signalKey) && !reEntryWatch` |
| `@@ -20123,13 +21020,28 @@` | clear opposite confirm on resumed direction | signal-options lane | high | `shouldClearOppositeSignalPendingConfirm` |
| `@@ -20184,6 +21096,7 @@` | pass reEntryWatch to entry | signal-options lane | high | `reEntryWatch` |
| `@@ -20371,6 +21284,9 @@` | test exports opposite/scale-out | signal-options lane | high | `resolveOppositeSignalDualConfirmAction` |
| `@@ -20397,6 +21313,10 @@` | test exports re-entry | signal-options lane | high | `selectSignalOptionsReEntryWatchForState` |
| `@@ -20432,6 +21352,8 @@` | test exports market-time helpers | Commit 2 | high | `isRegularMarketSession`, `latestCompletedBackfillMarketDate` |

## A2 — `shadow-account.ts` Hunk Attribution

| Hunk | Description | Attribution | Conf. | Evidence |
|---|---|---:|---:|---|
| `@@ -14,6 +14,11 @@` | market-calendar imports | Commit 2 | high | `addTradingDays`, `previousTradingDayOrSame`, `rthBarsBack` |
| `@@ -4904,13 +4909,14 @@` | exit row payload + partial-safe dedup | signal-options lane | high | `Partial scale-outs have their own identity` |
| `@@ -4918,6 +4924,7 @@` | ignore partial exit in duplicate test | signal-options lane | high | `readRecord(event.payload)?.partial !== true` |
| `@@ -4934,6 +4941,7 @@` | select payload | signal-options lane | high | `payload: executionEventsTable.payload` |
| `@@ -4942,6 +4950,7 @@` | SQL excludes partial exits | signal-options lane | high | `payload->>'partial' is distinct from 'true'` |
| `@@ -12028,17 +12037,13 @@` | holiday-aware previous weekday | Commit 2 | high | `Holiday-aware now`, `previousTradingDayOrSame` |
| `@@ -12064,17 +12069,11 @@` | add trading days | Commit 2 | high | `Holiday-aware trading-day step`, `addTradingDays` |
| `@@ -12551,13 +12550,26 @@` | RTH-bar warmup start | Commit 2 | high | `Warm up N bars means N session bars`, `rthBarsBack` |
| `@@ -14585,6 +14597,9 @@` | expose helpers for tests | Commit 2 | high | `watchlistBacktestHydrationStart`, `previousWeekdayOrSame`, `addWeekdaysToMarketDate` |

## A3 — `signal-monitor.ts` Hunk Attribution

| Hunk | Description | Attribution | Conf. | Evidence |
|---|---|---:|---:|---|
| `@@ -11,6 +11,7 @@` | `SQL` type import | Commit 5 | high | used by `loadSignalMonitorEventRows` cache |
| `@@ -37,7 +38,11 @@` | NYSE calendar imports | mixed Commit 2/3 | med | `isNyseFullHoliday`, `resolveNyseCalendarDay` |
| `@@ -1250,6 +1255,7 @@` | response `sessionOpenAt` | Commit 3 | high | `signalMonitorCurrentSessionOpenAtNow()` |
| `@@ -1355,6 +1361,9 @@` | quiet-only comment | Commit 3 | high | `action-paused here would stomp it` |
| `@@ -2395,6 +2404,9 @@` | bust events cache after backfill insert | Commit 5 | med | `bustSignalMonitorEventsListCache()` |
| `@@ -3836,22 +3848,52 @@` | catalog expansion memo | Commit 5 | high | `B1 (census S1)` |
| `@@ -3886,7 +3928,40 @@` | memo write and load symbols wrapper | Commit 5 | high | `signalMonitorCatalogExpansionMemo` |
| `@@ -4145,6 +4220,16 @@` | action-paused session helper | Commit 3 | high | `Action paused`, `market_idle blocker` |
| `@@ -4157,6 +4242,8 @@` | quiet now semantic comment | Commit 3 | high | `action-paused (quiet OR idle)` |
| `@@ -4165,12 +4252,41 @@` | current session open helper | Commit 3 | high | `Prior-session entry block` |
| `@@ -6267,6 +6383,7 @@` | bust events cache on insert | Commit 5 | med | `bustSignalMonitorEventsListCache()` |
| `@@ -6546,13 +6663,20 @@` | prefetched event anchor map | Commit 5 | high | `B2` |
| `@@ -6736,14 +6860,50 @@` | batch event signalAt query | Commit 5 | high | `B2 (census S2)` |
| `@@ -6764,16 +6924,9 @@` | use prefetched map | Commit 5 | high | `prefetchedEventSignalAtByKey` |
| `@@ -6876,6 +7029,93 @@` | completed bars superset cache | Commit 5 | high | `Census S9` |
| `@@ -7123,6 +7363,33 @@` | serve completed bars from superset | Commit 5 | high | `Census S9` |
| `@@ -7681,13 +7948,13 @@` | daily holiday-aware comment | Commit 2 | high | `NYSE trading-day`, `full market holidays` |
| `@@ -7701,18 +7968,76 @@` | holiday-aware 1d and intraday RTH bars | Commit 2 | high | `intradaySessionBarsBetween`, `resolveNyseCalendarDay` |
| `@@ -7738,11 +8063,10 @@` | use session bar age | Commit 2 | high | `intradaySessionBarsBetween` |
| `@@ -8829,6 +9153,24 @@` | persist cell signalAt helper | Commit 5 | high | `Single source of truth`, `B2 batch` |
| `@@ -8868,6 +9210,32 @@` | batch event-key pre-pass | Commit 5 | high | `B2: collect every directional cell's event-anchor lookup keys` |
| `@@ -8886,13 +9254,8 @@` | reuse helper | Commit 5 | high | `resolveSignalMonitorPersistCellDirectionSignalAt` |
| `@@ -8940,6 +9303,7 @@` | pass eventSignalAtByKey | Commit 5 | high | `eventSignalAtByKey` |
| `@@ -9030,11 +9394,52 @@` | persist schedule stats/test idle | Commit 5 | high | `B3` |
| `@@ -9303,6 +9708,7 @@` | stream `sessionOpenAt` | Commit 3 | high | `signalMonitorCurrentSessionOpenAtNow()` |
| `@@ -9879,15 +10285,25 @@` | subscriber persist gating | Commit 5 | high | `B3/D1`, `persist dirty-key` |
| `@@ -11552,6 +11968,54 @@` | profile heartbeat gate | Commit 5 | high | `B4 (census S8)` |
| `@@ -11565,6 +12029,20 @@` | skip metadata write | Commit 5 | high | `shouldWriteSignalMonitorProfileEvaluationMetadata` |
| `@@ -11575,6 +12053,13 @@` | invalidate cache and record write | Commit 5 | high | `invalidateSignalMonitorProfileCache` |
| `@@ -13105,10 +13590,25 @@` | profile cache | Commit 5 | high | `cockpit stream tick re-reads the profile every ~5s` |
| `@@ -13124,6 +13624,29 @@` | cached `getSignalMonitorProfile` | Commit 5 | high | `SIGNAL_MONITOR_PROFILE_CACHE_TTL_MS` |
| `@@ -13205,6 +13728,7 @@` | invalidate profile cache on update | Commit 5 | high | `invalidateSignalMonitorProfileCache()` |
| `@@ -13224,6 +13748,7 @@` | invalidate fallback profile cache | Commit 5 | high | `invalidateSignalMonitorProfileCache()` |
| `@@ -13256,6 +13781,9 @@` | expose superset helpers | Commit 5 | high | `Census S9` |
| `@@ -13350,6 +13878,22 @@` | expose B1/B2/B3/B4 test helpers | Commit 5 | high | `B1`, `B2`, `B3`, `B4` |
| `@@ -13453,11 +13997,37 @@` | events list cache types | Commit 5 | med | `SignalMonitorEventsListRow`, cache |
| `@@ -13507,6 +14077,58 @@` | events list cached loader | Commit 5 | med | `loadSignalMonitorEventRows` |
| `@@ -14461,27 +15083,20 @@` | list events uses cached loader | Commit 5 | med | `loadSignalMonitorEventRows` |

## A4 — Unattributed Files

| File | Verdict | Target | Evidence |
|---|---:|---|---|
| `platform.ts` | REASSIGNED mixed | Commit 5 plus Commit 2 pressure-gate removal | Commit 5: `BARS_BACKGROUND_PERSIST_QUEUE_MAX_ENTRIES`, `buildBarsScopeKey`; Commit 2/time lane: `shouldYieldOptionChainBatchForPressure` deleted, manifest lane vocab says pressure-gate removal belongs here. |
| `routes/platform.ts` | CONFIRMED | Commit 5 | `SPARKLINE_SEED_DB_BATCH_SIZE = 64`, `requireFreshHistorical` request flag |
| `platform-sparkline-seed.test.ts` | CONFIRMED | Commit 5 | test title `sparkline seed DB batch size turns 96 symbols into 2 chunks` |
| `market-data-store.ts` | CONFIRMED | Commit 5 | `PersistMarketDataBarsResult = boolean | "skipped"`, contention skip/backoff |
| `background-worker-pressure.test.ts` | REASSIGNED | Commit 2 / pressure-gate removal | `Owner directive 2026-07-07: entries never pause under pressure`, `no pressure gate` |
| `diagnostics-ibkr-metrics.test.ts` | UNKNOWN | UNKNOWN | Evidence says retired bridge: `retired IBKR bridge emits zero diagnostic events`; no linked diff for `diagnostics.ts` or manifest theme marker. Single resolving check: inspect sibling `diagnostics.ts` hunk. |
| `platform-bars-background-persist.test.ts` | CONFIRMED | Commit 5 | tests `contention skips`, `replaces duplicate pending windows`, `drops oldest entry at the cap` |
| `automation.merge-events.test.ts` | CONFIRMED | Commit 5 | `listExecutionEvents shares one read within the short TTL` |
| `signal-monitor-stream.test.ts` | CONFIRMED | Commit 5 | `B3: subscriber SSE delta persists only durability-relevant changes` |
| `signal-monitor-completed-bars.test.ts` | REASSIGNED mixed | Commit 2 plus Commit 5 | Commit 2: `intraday bar age counts only regular-session bars`; Commit 5: source assertion changed to `loadSignalMonitorEventRows` |
| `scripts/src/shadow-options-management-review.ts` | UNKNOWN | UNKNOWN | only evidence is `payload->>'exitReason'` fallback; no marker ties to Commit 5 or signal-options lane. Single resolving check: inspect lane handoff/test owner for `exitReason` schema drift. |

## A5 — DO-NOT-STAGE Confirmations

| Entry | Verdict | Evidence |
|---|---:|---|
| `signal-options-worker.ts` incl. starvation floor | CONFIRMED DO-NOT-STAGE, signal-options/pressure sibling | `Entries never pause under pressure per owner directive 2026-07-07`; no Commit 1-5 marker except pressure directive. |
| `signal-options-exit-policy.ts` | CONFIRMED DO-NOT-STAGE, signal-options lane | `scaleOut`, `highQualityOvernightRunnerGivebackPct`, `scaleOutAlreadyFired`. |
| `shadow-account-signal-options-exit-dedup.test.ts` | CONFIRMED DO-NOT-STAGE, signal-options lane | `partial scale-outs do not suppress the later final exit`. |
| `lib/db/src/schema/robinhood.ts` | REASSIGNED: no working-tree hunk present | Diff section is empty. `git log` shows 5 Robinhood commits including `feat(api,db): auto-backfill Robinhood realized-P&L history`, but current evidence shows no uncommitted hunk to stage or avoid. |
| Robinhood committed lane | CONFIRMED already committed | `dc5ca760`, `785beb45`, `b978f62d`, `d580b00c`, `01d8f0c6`, `bb752f69`, `a1e37dd4` in `origin/main..HEAD`. |

## Ordered Staging Recipes

### Commit 2 — market-time correctness

Stage these hunks:

`signal-options-automation.ts`: `@@ -26,6 +26,13 @@`, `@@ -3375,7 +3429,11 @@`, `@@ -7684,14 +8179,6 @@`, `@@ -7705,7 +8192,10 @@`, `@@ -15945,10 +16789,6 @@`, `@@ -15997,23 +16837,15 @@`, `@@ -16073,15 +16905,25 @@`, `@@ -16099,27 +16941,29 @@`, `@@ -20432,6 +21352,8 @@`

`shadow-account.ts`: `@@ -14,6 +14,11 @@`, `@@ -12028,17 +12037,13 @@`, `@@ -12064,17 +12069,11 @@`, `@@ -12551,13 +12550,26 @@`, `@@ -14585,6 +14597,9 @@`

`signal-monitor.ts`: `@@ -37,7 +38,11 @@` only if split to include `isNyseFullHoliday` / `resolveNyseCalendarDay`; `@@ -7681,13 +7948,13 @@`, `@@ -7701,18 +7968,76 @@`, `@@ -7738,11 +8063,10 @@`

Also stage `background-worker-pressure.test.ts` with pressure-gate removal if Commit 2 owns that theme; do not include signal-options-worker implementation unless operator intentionally lands the pressure sibling too.

### Commit 3 — prior-session actionability + C5

Stage these hunks:

`signal-options-automation.ts`: `@@ -65,6 +72,7 @@`, `@@ -2580,6 +2628,12 @@`

`signal-monitor.ts`: `@@ -1250,6 +1255,7 @@`, `@@ -1355,6 +1361,9 @@`, `@@ -4145,6 +4220,16 @@`, `@@ -4157,6 +4242,8 @@`, `@@ -4165,12 +4252,41 @@`, `@@ -9303,6 +9708,7 @@`

### Commit 4 — MTF truth

Stage these hunks from `signal-options-automation.ts`: `@@ -501,6 +518,11 @@`, `@@ -6471,6 +6529,11 @@`, and the first `entryGate` portion only of `@@ -6577,9 +6640,296 @@`.

### Commit 5 — census/pressure follow-ups

Stage these hunks:

`signal-monitor.ts`: `@@ -11,6 +11,7 @@`, Commit-5 portions of `@@ -37,7 +38,11 @@` if `resolveNyseCalendarDay` is already staged elsewhere, `@@ -2395,6 +2404,9 @@`, `@@ -3836,22 +3848,52 @@`, `@@ -3886,7 +3928,40 @@`, `@@ -6267,6 +6383,7 @@`, `@@ -6546,13 +6663,20 @@`, `@@ -6736,14 +6860,50 @@`, `@@ -6764,16 +6924,9 @@`, `@@ -6876,6 +7029,93 @@`, `@@ -7123,6 +7363,33 @@`, `@@ -8829,6 +9153,24 @@`, `@@ -8868,6 +9210,32 @@`, `@@ -8886,13 +9254,8 @@`, `@@ -8940,6 +9303,7 @@`, `@@ -9030,11 +9394,52 @@`, `@@ -9879,15 +10285,25 @@`, `@@ -11552,6 +11968,54 @@`, `@@ -11565,6 +12029,20 @@`, `@@ -11575,6 +12053,13 @@`, `@@ -13105,10 +13590,25 @@`, `@@ -13124,6 +13624,29 @@`, `@@ -13205,6 +13728,7 @@`, `@@ -13224,6 +13748,7 @@`, `@@ -13256,6 +13781,9 @@`, `@@ -13350,6 +13878,22 @@`, `@@ -13453,11 +13997,37 @@`, `@@ -13507,6 +14077,58 @@`, `@@ -14461,27 +15083,20 @@`

For A4 Commit 5 files, stage `routes/platform.ts`, `platform-sparkline-seed.test.ts`, `market-data-store.ts`, `platform-bars-background-persist.test.ts`, `automation.merge-events.test.ts`, `signal-monitor-stream.test.ts`, and the Commit-5 hunk in `signal-monitor-completed-bars.test.ts` referencing `loadSignalMonitorEventRows`.

## Corrected File Lists

Commit 2 changes versus manifest:
Add `signal-monitor.ts` bar-age hunks and `signal-monitor-completed-bars.test.ts` RTH/holiday bar-age tests. Add pressure-gate-removal test hunks in `background-worker-pressure.test.ts` if pressure-gate removal is intentionally in Commit 2.

Commit 3 changes versus manifest:
Confirmed only prior-session hunks in `signal-monitor.ts` and C5 seam hunks in `signal-options-automation.ts`.

Commit 4 changes versus manifest:
Add only `signal-options-automation.ts` `Wave-2 D1` hunks if the MTF truth commit wants the automation-side candidate payload passthrough.

Commit 5 changes versus manifest:
Confirmed A4 files except `diagnostics-ibkr-metrics.test.ts` and `scripts/src/shadow-options-management-review.ts`, which remain UNKNOWN. `platform.ts` is mixed: stage queue/cache/fresh-historical/scope-key hunks for Commit 5, but treat `shouldYieldOptionChainBatchForPressure` deletion as pressure-gate/time-lane unless the operator deliberately includes it in Commit 5.

DO-NOT-STAGE correction:
Remove `lib/db/src/schema/robinhood.ts` from active working-tree do-not-stage list for this audit evidence, because its diff section is empty.

## Residual Risk

`signal-options-automation.ts` has several medium-confidence signal-options hunks around closed-position link rescue and post-exit outcome exports; evidence strongly names sibling feature symbols but not `ea30b14a` directly.

`diagnostics-ibkr-metrics.test.ts` is UNKNOWN without the paired `diagnostics.ts` diff.

`scripts/src/shadow-options-management-review.ts` is UNKNOWN; the `exitReason` fallback may belong to signal-options exit payload compatibility, not census.

`signal-monitor.ts @@ -37,7 +38,11 @@` is a mixed import hunk. It should be split manually or staged only when both Commit 2 and Commit 3/5 dependencies are already satisfied.

---

# Addendum — adversarial pre-landing challenge (Codex work order B) + Claude verification

Codex reviewed the same inlined diffs adversarially and returned verdict BLOCK on two [P1]s.
Claude re-verified each finding against source; the BLOCK does not survive verification.

| # | Codex finding | Claude verification verdict | Evidence |
|---|---|---|---|
| P1-1 | `signal-options-automation.ts:7218` — pending-confirm clear events ignored by the event fold; replay leaves stale `oppositeSignalPendingConfirm`, next opposite signal full-exits instead of partial | **REFUTED** | Emit site (`clearOppositeSignalPendingConfirmForResumedDirection`, ~line 16080) writes `oppositeSignalPendingConfirm: null` onto the event's position payload via `buildOppositeSignalPendingConfirmClearPosition`; `null` survives JSON round-trip; the fold applies `applyOppositeSignalPendingConfirmPositionPatch` at line 7215 whenever a tracked position exists (its `hasOwnProperty` check passes for explicit null). The early return at 7219 fires only with no tracked position — nothing to corrupt, and it correctly avoids resurrecting a position from a skip payload. Also: sibling signal-options lane's hunk, not this lane's. |
| P1-2 | `platform.ts:16322` — option-chain empty retries no longer yield under pressure; synchronized retry waves under saturation | **DOWNGRADED to accepted tradeoff (P2, record in commit message)** | Retry schedule is finite and small (`OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS = [250, 750]`, platform.ts:11379 — max 2 retries per empty expiration), retries run sequentially per batch call, initial fetches capped by `optionChainBatchConcurrency`, loop honors abort `signal`. Gate removal is the owner's explicit 2026-07-07 directive ("entries never pause under pressure", pinned by `background-worker-pressure.test.ts`); demand-reduction census fixes are the mitigation. Live RTH evidence 2026-07-08 ~10:00 ET: pool max=12 total=12 waiting=0, zero lock waiters. |
| P2-1 | `signal-monitor-local-bar-cache.ts:1289` — holiday/weekend reopen rollup widening starts at previous session close, excluding that session's afternoon bars from limit:3 hourly rollups | **PLAUSIBLE — open follow-up** | `rollupScanCutoffMs` widens to `min(plainCutoff, previousCloseMs)`; bars strictly before the close are excluded, so the widening admits only after-hours + reopen bars. Whether Codex's exact Tue-09:31 scenario triggers depends on whether pre-market counts as an open edge (open edges keep the tight 4h window). Needs a session-model check by the lane owner; sparse-rollup impact for the first hours after a holiday-gap reopen. |
| P2-2 | `flow-universe.ts:990` — queued observation batching can serialize on the 500ms debounce if callers await per symbol | **REFUTED at the only production call site** | Sole caller is `platform.ts:12102` inside `onResult` — invoked fire-and-forget (promise not awaited), so nothing serializes; observations accumulate and flush per 500ms window or at `OBSERVATION_FLUSH_MAX_ROWS`. |

Codex also reported held attacks (no findings) on: bar-fetch fresh/non-fresh directionality
(`platform.ts:9784/9840/10015/10069`), DB tx hygiene / in-flight cleanup / advisory-lock standalone
client, and trading-day/DST/RTH utilities incl. DTE adopters.

**Post-verification landing verdict: LAND** — with P2-1 tracked as a follow-up and the P1-2
tradeoff (no load-shedding on option-chain retries, by owner directive) recorded in the Commit 2/5
message that lands the pressure-gate removal.
