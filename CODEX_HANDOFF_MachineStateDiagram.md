# Codex Handoff — MachineStateDiagram.jsx WIP

**Date:** 2026-06-12
**File:** `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx`
**Status:** Crash fixed, screen renders, and the latest Codex pickup completed
the main data machine plus right-side observability rail refinement.

## Context

This view file is **untracked WIP that had never been runnable**. It appears in no
commit, branch, or stash, and the three constants below have never existed anywhere
in git history. The data model it consumes (`machineStateDiagramModel.js`) is
complete and contract-tested; only this view was unfinished.

The PYRUS root crash was `ReferenceError: GROUP_RECTS is not defined`. That was the
first of a cascade: clearing it would have surfaced `LANE_BANDS`, then
`STATUS_GLYPH` — all referenced but never defined. (The earlier
`CARD_TITLE_SIZE has already been declared` parse error was a separate duplicate
block, also fixed.)

## What was changed

| Constant | Resolution | Confidence |
|---|---|---|
| `GROUP_RECTS` | Removed the phantom global. Now `const groupRects = useMemo(() => buildRects(masters), [masters])` in the component; threaded the rect map through `hasCardBetween` / `edgePath` / `edgeLabelPosition` as a param. Card widths fit content, so rects are inherently per-render — they cannot be a module constant. | **Fact-based** — `buildRects` already existed; `useMemo` already imported. |
| `LANE_BANDS` | Codex split the placeholder four-band layout into the five user-confirmed funnel stages from `MACHINE_STATE_WIRING.md`: sources, process lanes, signals & algo, account & trading, serve & consume. The labels are now pinned by `machineStateDiagram.contract.test.mjs`. | **Source-backed** from the wiring doc; visual browser QA still recommended. |
| `STATUS_GLYPH` | Codex replaced the guessed dot map with the user-confirmed glyph vocabulary from `MACHINE_STATE_WIRING.md`: `✓`, `◌`, `!`, `✕`, `–`, `?`. The legend also shows the glyph beside each status count. | **Source-backed** from the wiring doc and pinned by contract test. |
| `CARD_TITLE_SIZE` dup block | Removed duplicate font-size declarations (lines ~404–407); kept the rationale comment on the surviving block. | Fact-based. |
| `STATUS_ICON` / `StatusIcon` dead code | Codex removed the unused lucide status-icon precursor and its `lucide-react` imports after choosing the documented text glyph vocabulary. | Fact-based — no remaining references. |

## Latest pickup — observability rail

User correction: Client should not be a standalone card. The current approach
keeps Client in the model because it owns real sensors, but removes it from
card positioning and renders those sensors as compact rail sections:

- `Diagnostics` moved to the right-side `OBSERVABILITY & CLIENTS` rail.
- `Client` is no longer in `GROUP_XY` and no longer renders through
  `MasterCard`.
- Client children render as rail sections: `API Boundary` and
  `Browser Signals`.
- Normal master edges to/from Diagnostics/Client are hidden from the main
  pipeline.
- View-only alert overlays draw into the rail only when the main source master
  is `checking`, `degraded`, or `down`.
- `MACHINE_STATE_WIRING.md` now documents the 27-edge truth graph separately
  from the rendered alert-only rail edge rule.
- `index.css` now carries the scoped edge animation/reduced-motion rules and a
  phone-only horizontal workspace so the SVG stays readable on mobile.

## Open items for Codex

1. File is still **untracked** — not committed.
2. Files are not committed; keep this WIP isolated from unrelated dirty
   worktree changes.

## Verification (all passing as of this handoff)

```bash
# from repo root
node --test artifacts/pyrus/src/screens/diagnostics/machineStateDiagram.contract.test.mjs   # 10/10 pass
node --test artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs       # 33/33 pass
pnpm --filter @workspace/pyrus run typecheck                                               # pass
pnpm --filter @workspace/pyrus run build                                                   # pass
```

Latest rail refinement validation so far:

```bash
node --test artifacts/pyrus/src/screens/diagnostics/machineStateDiagram.contract.test.mjs   # 10/10 pass
node --test artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs       # 33/33 pass
pnpm --filter @workspace/pyrus run typecheck                                               # pass
pnpm --filter @workspace/pyrus run build                                                   # pass
```

Latest screenshots:

- Before: `/tmp/pyrus-machine-visual-review/before-desktop-panel.png`,
  `/tmp/pyrus-machine-visual-review/before-mobile-panel.png`
- After: `/tmp/pyrus-machine-visual-review/after-desktop-panel.png`,
  `/tmp/pyrus-machine-visual-review/after-mobile-panel.png`
- Report: `/tmp/pyrus-machine-visual-review/after-report.json` (no console
  messages; mobile reports a horizontal diagram workspace)
