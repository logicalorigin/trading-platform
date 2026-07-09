# WO-R5-B1 Report

## #22 - GEX primary symbol selector

- Reproduced: yes. Evidence: `GexTickerInput` was a transparent borderless input at `GexScreen.jsx:142-165`, and the header controls were right-aligned without a left screen/symbol anchor at `GexScreen.jsx:1678-1744`.
- Changed: `artifacts/pyrus/src/screens/GexScreen.jsx:15`, `artifacts/pyrus/src/screens/GexScreen.jsx:142-165`, `artifacts/pyrus/src/screens/GexScreen.jsx:1598-1624`, `artifacts/pyrus/src/screens/GexScreen.jsx:1678-1744`.
- Summary: added the existing chevron affordance, visible text-field chrome, wider ticker input, and a top-left `GEX` / active-symbol title anchor.

## #15 tail - Trade spot-feed empty/loading state

- Reproduced: yes. Evidence: `TradeEquityPanel.jsx:1098-1101` passed a custom `Spot feed` eyebrow and status copy into the chart empty state, while `TradeChainPanel.jsx:1047-1078` uses the normalized centered loading treatment.
- Changed: `artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx:914-919`, `artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx:1098-1101`.
- Summary: normalized the spot chart empty/loading copy to the chain panel language by removing the custom `Spot feed` eyebrow and using sentence-case `Loading spot chart` copy for loading.

## #16 - Watchlist editor chrome

- Reproduced: yes. Evidence: `PlatformWatchlist.jsx:1300-1338` constrained the active watchlist selector inside a crowded one-line header with ellipsis-only fallback, and adjacent controls used 32px targets.
- Changed: `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1291-1338`, `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1422-1468`, `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1492-1552`, `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1638-1656`, `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1661-1704`.
- Summary: gave the active watchlist selector more flexible width, added a `title` fallback for the full name, allowed header wrapping, and increased nearby target heights.
- Deferred owner proposal: resolve the Account-screen duplication by hiding management chrome there or replacing it with a passive account-context list; not implemented because the work order marks this structural concern out of scope.

## Typecheck

Command: `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck`

Output:

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Result: pass.
