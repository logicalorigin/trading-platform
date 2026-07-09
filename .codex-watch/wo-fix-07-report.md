# WO-FIX-07 Report

## Status

Implemented. The STA frontend mirror now honors the configured MTF `requiredCount` and falls back to full selected-frame alignment only when the count is unset. The backend runtime gate was already using the configured count in the dirty source; I reconciled the stale backend test expectation for the verified unset default.

No git commands were used.

## Config-Flow Trace

Observed storage:
- `lib/db/src/schema/automation.ts:52-64`: `algo_deployments.config` is the deployment JSONB config field.

Observed control-panel fields:
- `artifacts/pyrus/src/screens/algo/algoSettingsFields.js:208-216`: numeric control path is `entryGate.mtfAlignment.requiredCount`.
- `artifacts/pyrus/src/screens/algo/algoSettingsFields.js:227-233`: MTF timeframe chips are tied to `entryGate.mtfAlignment.requiredCount`.
- `artifacts/pyrus/src/screens/algo/algoSettingsFields.js:51-60`: preset changes write `entryGate.mtfAlignment.requiredCount` with the preset count clamped to selected frames.
- `artifacts/pyrus/src/screens/algo/AlgoTimeframeControlBand.jsx:168-190`: timeframe-control edits patch `entryGate.mtfAlignment.timeframes`, `.preset`, and `.requiredCount`.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx:1118-1124`: the live draft publishes `profileDraft.entryGate.mtfAlignment` to STA consumers.

Observed backend flow:
- `artifacts/api-server/src/services/signal-options-automation.ts:2544-2545`: deployment config is normalized through `resolveSignalOptionsExecutionProfile(deployment.config)`.
- `lib/backtest-core/src/signal-options.ts:829-835`: resolver reads `entryGate.mtfAlignment` and selected MTF timeframes.
- `lib/backtest-core/src/signal-options.ts:929-948`: resolver clamps explicit `requiredCount`; if unset, fallback is `mtfTimeframes.length`.
- `artifacts/api-server/src/services/signal-options-automation.ts:5374-5381`: `requiredSignalOptionsMtfCount` returns full frame count only when the value is absent, otherwise clamps the configured value.
- `artifacts/api-server/src/services/signal-options-automation.ts:5438-5473`: entry gate computes `requiredMtfCount` from `mtfGate.requiredCount` and blocks only when `mtfMatches < requiredMtfCount`.

Observed frontend mirror flow:
- `artifacts/pyrus/src/screens/algo/algoHelpers.js:80-155`: frontend default MTF profile and presets default `requiredCount` to the selected frame count.
- `artifacts/pyrus/src/screens/algo/algoHelpers.js:761-768`: STA row MTF gate now passes the configured `requiredCount`, with unset fallback to selected-frame count.

## Verified Default When Unset

Backend and frontend agree.

Observed default:
- Default MTF timeframes are 5 frames (`1m`, `2m`, `5m`, `15m`, `1h`) in `lib/backtest-core/src/signal-options.ts:207-213`.
- Backend default profile sets `requiredCount: signalOptionsDefaultMtfTimeframes.length` in `lib/backtest-core/src/signal-options.ts:253-260`.
- Backend resolver defaults an unset count to `mtfTimeframes.length` in `lib/backtest-core/src/signal-options.ts:937-947`.
- Frontend default profile sets `requiredCount: SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES.length` in `artifacts/pyrus/src/screens/algo/algoHelpers.js:151-155`.

Result: unset config still behaves like unanimity over the selected frames. Configured `requiredCount` is authoritative when present.

## What Changed

- `artifacts/pyrus/src/screens/algo/algoHelpers.js`: replaced the STA display gate's forced `timeframes.length` threshold with `mtfAlignmentConfig?.requiredCount ?? timeframes.length`.
- `artifacts/api-server/src/services/signal-options-automation.test.ts`: reconciled the unset-default assertion from old 2-of-3 behavior to full selected-frame alignment.
- `artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs`: reconciled the directly adjacent stale helper test so it asserts configured 2-of-3 passes.

## Unified Diff Of My Hunks

```diff
--- artifacts/pyrus/src/screens/algo/algoHelpers.js
+++ artifacts/pyrus/src/screens/algo/algoHelpers.js
@@ -762,13 +762,9 @@
     matrixStatesByTimeframe: signalMatrixBySymbol?.[symbolUpper] || {},
     signalDirection: normalizeStaRowSignalDirection(signalRecord.direction),
     timeframes,
-    // Owner requirement 2026-07-08: the STA table shows ONLY fully-aligned rows —
-    // EVERY configured MTF frame must agree, regardless of the panel's requiredCount
-    // dial. A stored dial (e.g. 2-of-3) was still surfacing rows with a divergent
-    // frame (mixed buy/sell arrows), so the display gate FORCES full alignment over
-    // the configured frames here. resolveConfiguredMtfAlignment clamps to
-    // [1, frames.length].
-    requiredCount: timeframes.length,
+    // The panel's configured count is authoritative; when absent, keep the
+    // profile resolver's default of full alignment over the selected frames.
+    requiredCount: mtfAlignmentConfig?.requiredCount ?? timeframes.length,
     enabled: mtfAlignmentConfig?.enabled !== false,
   });
   return !(result.applicable && !result.aligned);
```

```diff
--- artifacts/api-server/src/services/signal-options-automation.test.ts
+++ artifacts/api-server/src/services/signal-options-automation.test.ts
@@ -1346,9 +1346,8 @@
   assert.equal(partial.mtfMatches, 2);
   assert.equal(partial.reasons.includes("mtf_not_aligned"), false);
 
-  // Unconfigured count falls back to the confirmation default (2), never
-  // unanimity — a stricter requirement must come from the panel's saved
-  // settings (product ruling 2026-07-07).
+  // Unconfigured count falls back to full selected-frame alignment; a looser
+  // threshold must come from the panel's saved requiredCount.
   const strictProfile = resolveSignalOptionsExecutionProfile({
     signalOptions: {
       entryGate: {
@@ -1356,14 +1355,14 @@
       },
     },
   });
-  assert.equal(strictProfile.entryGate.mtfAlignment.requiredCount, 2);
+  assert.equal(strictProfile.entryGate.mtfAlignment.requiredCount, 3);
   const strict = evaluateSignalOptionsEntryGate({
     candidate,
     profile: strictProfile,
     mtfTimeframeDirections,
   });
-  assert.equal(strict.requiredMtfCount, 2);
-  assert.equal(strict.reasons.includes("mtf_not_aligned"), false);
+  assert.equal(strict.requiredMtfCount, 3);
+  assert.equal(strict.reasons.includes("mtf_not_aligned"), true);
 });
 
 const greekSlotQuote = (
```

```diff
--- artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs
+++ artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs
@@ -2018,10 +2018,9 @@
   );
 });
 
-test("STA MTF filter forces full alignment regardless of the stored requiredCount dial", () => {
-  // Owner requirement 2026-07-08: the STA table shows ONLY fully-aligned rows, so a
-  // stored dial of 2 does NOT let a 2-of-3 row (one divergent frame) through — the
-  // display gate forces 3-of-3 over the configured frames.
+test("STA MTF filter honors the stored requiredCount dial", () => {
+  // Owner decision 2026-07-08: the panel's configured requiredCount is
+  // authoritative, so a stored dial of 2 lets a 2-of-3 row through.
   const divergent = {
     MU: {
       "2m": { currentSignalDirection: "buy", status: "ok", active: true },
@@ -2035,9 +2034,9 @@
       divergent,
       { enabled: true, timeframes: ["2m", "5m", "15m"], requiredCount: 2 },
     ),
-    false,
+    true,
   );
-  // A fully-aligned 3-of-3 row passes even with the same stored dial of 2.
+  // A fully-aligned 3-of-3 row still passes with the same stored dial of 2.
   assert.equal(
     staRowPassesMtfAlignment(
       { symbol: "MU", timeframe: "15m", direction: "buy" },
```

## Test Output

Command:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-mtf-alignment.test.ts
```

Observed output:

```text
✔ MTF entry gate honors configured requiredCount instead of forcing unanimity (1.39516ms)
✔ matrix MTF: blocks a buy when a configured frame (1d) actually disagrees (0.828629ms)
✔ matrix MTF: passes a buy when all configured frames agree (0.139937ms)
✔ matrix MTF: a frame with no signal yet counts as not-aligned (cannot satisfy) (0.092269ms)
✔ legacy fallback (no matrix) wrongly passes — proves why the matrix source is needed (0.187923ms)
✔ effective MTF frames use only the configured MTF selection (1.203381ms)
✔ matrix MTF: every configured frame must align (0.25798ms)
✔ matrix MTF: passes only when every configured frame aligns (0.538202ms)
ℹ tests 54
ℹ suites 0
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5376.665222
```

Command:

```text
pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/OperationsSignalTable.test.mjs src/screens/algo/AlgoScreen.test.mjs
```

Observed output:

```text
✔ STA MTF alignment filter hides divergent and unconfirmed rows when enabled (0.359213ms)
✔ STA MTF alignment filter does not add execution frame to selected-frame checks (0.076332ms)
✔ STA MTF alignment filter honors the panel n-of-N (2-of-3 passes) (4.534949ms)
✔ STA MTF alignment does NOT count a selected frame without a fresh crossover (mirrors backend entry gate) (0.203897ms)
✔ all-selected MTF keeps 2m and 5m execution rows on the same aligned symbol set (0.27421ms)
✔ STA MTF alignment filter returns the configured aligned subset, not the universe cap (10.996461ms)
✔ STA MTF alignment filter includes all rows when the gate is disabled (0.137661ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2679.234727
```

Additional directly affected helper validation:

```text
pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/algoHelpers.test.mjs
```

Observed output:

```text
✔ STA MTF filter honors the stored requiredCount dial (1.575681ms)
✔ STA MTF gate defaults to full alignment (matches the bot) for an unconfigured profile (0.577581ms)
ℹ tests 61
ℹ suites 0
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2103.479854
```
