# WO-P1-T1 PhotonicsObservatory Force Graph

## What changed

- Observed the reported issue in `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx`: the graph build effect created `forceSimulation(nodes)` and depended on `liveData`/`liveFund`, so live quote/fundamental ticks rebuilt the whole SVG graph and simulation.
- Split live data handling from graph structure:
  - the simulation build effect now depends on structural inputs only: `[cos, tSet, theme]`;
  - latest live data and selected ticker state are held in refs for graph event handlers;
  - a separate `[liveData, liveFund]` effect mutates existing bound nodes, updates radius/text/tooltip fields, refreshes collision radii, and restarts the existing simulation without recreating it.
- Preserved authored revenue fallback separately as `_authoredRev` so d3 radius updates do not corrupt revenue values.

## Why

Live market data should change node values and sizing, not node/link identity. Keeping the simulation stable avoids tearing down SVG nodes, event handlers, force links, and layout state on every live tick.

## Diff

`git diff --stat -- artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx .codex-watch/wo-p1-t1-report.md`

```text
.../src/features/research/PhotonicsObservatory.jsx | 117 +++++++++++++++++----
1 file changed, 96 insertions(+), 21 deletions(-)
```

## Test output

Lightweight source-level Node assertion for the touched module:

```text
PASS artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx: force simulation deps [cos, tSet, theme], live ticks mutate existing nodes
```

## Notes

- Initial `git status --porcelain --` showed a dirty shared tree, but the target source file was not already modified before this work.
- No browser, Playwright, e2e, project-wide typecheck, or full-suite tests were run per work-order constraints.
