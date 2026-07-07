# WO-51 Round-5 Batch A Report

Worker: codex-worker  
Lead session: f68a9158  
Date: 2026-07-07

## Per-Item Changes

1. `artifacts/pyrus/src/features/market/MarketActivityPanel.jsx:760`
   - Before: signal-row buy direction used `CSS_COLOR.green`; sell used `CSS_COLOR.red`.
   - After: buy uses `toneForDirectionalIntent("buy")`; sell remains `CSS_COLOR.red`.

2. `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1399`
   - Before: watchlist menu `Default` label used `CSS_COLOR.green`.
   - After: label uses `CSS_COLOR.accent`.

3. `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx:724`
   - Before: footer abbreviation rewrote `not observed` to `n/o`.
   - After: footer keeps plain `not observed`.

4. `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx:200-208`
   - Before: unknown status glyph and fallback used `?`, which read as help.
   - After: unknown uses the legend-backed `·` marker via `UNKNOWN_STATUS_GLYPH`; generic fallbacks use the same marker.

5. `artifacts/pyrus/src/screens/algo/PipelineStrip.jsx:10,255`
   - Before: compact pipeline count used raw `fontWeight: 600`.
   - After: imports `FONT_WEIGHTS` and uses `FONT_WEIGHTS.label`.

## Skips

None. All five requested sites were still present and were updated.

## Verification

- `pnpm --filter @workspace/pyrus test`: passed, exit 0; command produced no output. Observed `@workspace/pyrus` has no explicit `test` script in `artifacts/pyrus/package.json`.
- `pnpm --filter @workspace/pyrus typecheck`: passed (`tsc -p tsconfig.json --noEmit`).
- Scope check: staged diff limited to the four requested source files plus this report. The broader worktree contains many unrelated pre-existing changes and was not cleaned or staged.

## Commit

83e22983
