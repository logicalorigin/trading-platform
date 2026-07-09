# WO-QUICKWINS report

## Execution note

- Observed: `DESIGN.md` was read first. It defines PYRUS as a calm live trading workspace and requires semantic color/state cues.
- Observed: the worktree was already heavily dirty before edits, including forbidden files from other lanes. I did not revert or modify those pre-existing changes.
- Observed: the allowed-source diff is small: `AlgoRightRail.jsx` 8 lines, `HaltStrip.jsx` 4 lines, `OperationsSignalTable.jsx` 3 lines.

## #14 - Broker cards missing tradable asset-type line

- Reproduced/applicable: blocked.
- Evidence: `artifacts/pyrus/src/screens/settings/snapTradeConnectModel.js:3-19` defines fallback broker choices with `value`, `label`, and `detail` only. `artifacts/pyrus/src/screens/settings/snapTradeConnectModel.js:34-60` maps live brokerages to `value`, `label`, `detail`, `logoUrl`, and `impaired` only. No capability or asset-type field is exposed there.
- Plan: add a card line only if existing broker metadata exposes asset-type/capability data.
- Files/ranges: no code change.
- Change summary: none.
- Stage-2 verification: no guessed asset-type copy was added.
- Blocked/deferred: blocked: no asset-type data in model.
- Stage-4 uncertainty: SnapTrade's raw API may expose richer capability data elsewhere, but this work order made the model read-only and required no guesswork.

## #5 - STA table header after-hours/closed scan wording

- Reproduced/applicable: applicable.
- Evidence: `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx:1647-1650` already computes `marketSessionQuiet`; `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx:1697-1705` builds the header freshness scan text.
- Plan: use the component's existing scan-active and market-session signals; when no scan is running and the market session is quiet, show `Market closed` before falling back to any scan detail such as "ready to scan".
- Files/ranges: `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx:1667-1680`, `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx:1697-1705`.
- Change summary: carried `marketSessionQuiet` through the freshness object and made the header freshness item prefer `Market closed` when scanning is inactive during a quiet market session.
- Stage-2 verification: `rg -n "marketSessionQuiet|Market closed" artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx` confirms the boolean is defined, returned, and consumed. `scanActive` remains `freshness.scanRunning` at `OperationsSignalTable.jsx:2182`.
- Blocked/deferred: per-row "Awaiting scan" wording remains deferred because it lives in forbidden `OperationsSignalRow.jsx`.
- Stage-4 uncertainty: this labels the fully closed/non-trading quiet state. It does not add a separate "idle after-hours" branch for extended sessions because the file's existing quiet rule treats only `closed` or non-trading days as quiet.

## #17 - Algo control-panel micro-typography

- Reproduced/applicable: applicable.
- Evidence: `artifacts/pyrus/src/lib/uiTokens.jsx:162-168` defines `micro: 7` and `label: 8`; `AlgoRightRail.jsx` and `HaltStrip.jsx` had visible `textSize("micro")` labels in the control panel. `AlgoSettingsRegion.jsx` was inspected and has no `textSize("micro")` occurrences.
- Plan: promote visible sub-8px micro labels to `textSize("label")`; clarify WIRE TRAIL stat labels and give them enough cell width without changing any values or controls.
- Files/ranges: `artifacts/pyrus/src/screens/algo/AlgoRightRail.jsx:54-59`, `artifacts/pyrus/src/screens/algo/AlgoRightRail.jsx:111-140`, `artifacts/pyrus/src/screens/algo/HaltStrip.jsx:190-200`, `artifacts/pyrus/src/screens/algo/HaltStrip.jsx:633-641`.
- Change summary: WIRE TRAIL `GREEKS` now reads `GREEK GATE`, `STRUCT` now reads `STRUCTURE`, the WIRE TRAIL stat grid minimum increased from 56px to 64px, and visible micro labels in `AlgoRightRail.jsx` and `HaltStrip.jsx` now use `textSize("label")`.
- Stage-2 verification: `rg -n "textSize\\(\"micro\"\\)|GREEK GATE|STRUCTURE|gridTemplateColumns: \"repeat\\(auto-fit, minmax\\(64px" ...` confirms the changed labels/grid and no remaining `textSize("micro")` in the #17 target files.
- Blocked/deferred: the DOM-probe for INFRA/gateway red state was skipped because the work order marked it runtime-only and not a code edit.
- Stage-4 uncertainty: no browser screenshot was taken, so visual fit is source-verified and typechecked, not runtime-verified.

## Stage-2 forbidden-file check

- Observed: patch operations changed only `OperationsSignalTable.jsx`, `AlgoRightRail.jsx`, `HaltStrip.jsx`, and this required report.
- Observed: a broader `git diff --name-only` includes forbidden files, but those files were already dirty in the initial `git status --short` before this work order was read.

## Stage-3 typecheck output

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Result: clean exit code 0.
