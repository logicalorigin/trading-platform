# WO-R5-B4 — Round 5 remediation, Batch 4 (significant restructures #02, #08 — owner-approved approaches)

PYRUS trading platform frontend (`artifacts/pyrus`). Read `DESIGN.md` (repo root) first. Full issue text:
`FRONTEND_AUDIT_ROUND5.md` sections `### #02` and `### #08`. The owner has APPROVED the specific approaches below —
implement those approaches, not alternatives.

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY these files:
   - #02: `artifacts/pyrus/src/features/market/MarketChartCell.jsx`,
          `artifacts/pyrus/src/features/market/MultiChartGrid.jsx`,
          `artifacts/pyrus/src/features/charting/chartFrameDensity.tsx`,
          and (ONLY IF unavoidable, under the scoping rule below) `ResearchChartSurface.tsx` /
          `ResearchChartFrame.tsx` / `chartWidgetShared.tsx`.
   - #08: `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx`
2. Do NOT run any git command. Leave the working tree for review.
3. Do NOT touch any `*.test.*` or any file not listed above.
4. VERIFY-BEFORE-EDIT; surgical diffs; existing tokens/patterns; preserve all functionality (every control still works,
   every node/label still reachable).

## FINDING #02 — Market grid chrome dominates price (APPROVED approach: "quieter, still visible")
Issue: each of the 6 MarketChartCell price panels is wrapped in ~25 unlabeled icon controls (top toolbar, 7-icon
left rail, bottom-right cluster, footer), tiled 6×, so tiny affordances dominate and price action is the quietest thing.
APPROVED approach — keep ALL controls visible (hide NOTHING), but de-emphasize so price dominates:
- Make the market-cell chrome visually quieter: smaller icons, lower-contrast/muted color, and GROUP the scattered
  clusters into fewer strips (the audit notes 4 separate clusters — consolidate toward one). Give the price chart the
  visual weight (it should read as the primary element of each cell).
- ⚠️ SCOPING (critical): `ResearchChartSurface`/frame chrome is SHARED by trade, research, and account charts (6+
  consumers). Your change MUST affect ONLY the market grid's compact cells. Prefer scoping via the existing density
  mechanism (`chartFrameDensity.tsx` — there is already a compact/density concept) or a market/compact variant prop
  threaded from MarketChartCell/MultiChartGrid. If you must edit a shared file, GATE every change behind the
  market/compact density/variant so full-size charts are byte-for-byte unchanged.
- Stage-2 MUST verify: trade chart, research chart, and account equity chart chrome render UNCHANGED (state in the
  report exactly how you scoped the change and how you confirmed non-market charts are unaffected). If you cannot
  scope it safely to the market grid, make NO change and report "blocked: cannot scope without regressing shared charts".
Acceptance: in the market grid, price action is the primary read and the control field is quiet/grouped; NO control is
removed; NO other chart context changes.

## FINDING #08 — Research force graph is an illegible pile (APPROVED approach: "declutter labels + tune forces")
Issue: the d3 force-directed graph collapses its dense center — 2-letter node codes stack, company labels collide
("PANW 50 NOVT / SBGSY / CRWD / COIN"), while the right third sits empty.
APPROVED approach — BOTH levers:
- Tune the d3 forces so dense nodes spread out and use the full canvas (raise collision radius so circles don't overlap;
  strengthen charge/repulsion; check centering/x-y forces) — the empty right third should fill in.
- Declutter labels: show labels only for prominent nodes by default (e.g. above a size/importance threshold), and
  reveal the rest on hover/selection (and/or zoom). Node codes/labels must remain REACHABLE (hover/select), just not
  all rendered at once in the dense center.
- ⚠️ DO NOT undo the #11 work already committed in this file: `GRAPH_VERTICAL_COLORS` (non-semantic sector palette)
  and the always-visible profitability ring legend must remain. Your change is ADDITIVE to those.
Acceptance: the dense center is legible (no colliding text pile), nodes use the full width, all labels remain reachable,
and #11's color/legend behavior is intact.

## EXECUTION DISCIPLINE (fable-level — REQUIRED, do not skip a stage)
- STAGE 0 — Plan: read `DESIGN.md`, the target files, and audit `### #02` / `### #08`. For #02, first MAP how the market
  cell renders its chrome and whether it flows through a shared surface + density; write the exact scoping lever you'll
  use. For #08, locate the force simulation setup and the label-render path. Write a one-line plan + acceptance check each.
- STAGE 1 — Implement one finding at a time (smallest diff that meets the approved approach).
- STAGE 2 — Verify each finding with a FAILABLE check: #02 → non-market charts unchanged (say how you proved it);
  #08 → labels reachable + #11 color/legend intact (grep GRAPH_VERTICAL_COLORS + ring legend still present). For both:
  every identifier/token you introduce is in-scope in that file (grep — tsc won't catch a bad name in .jsx).
- STAGE 3 — Typecheck (failable gate): `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck` — clean.
- STAGE 4 — Skeptical self-review: re-read your full diff as an adversary; for #02 the top risk is regressing a shared
  chart, for #08 it's breaking the simulation or hiding a needed label. List any uncertainty in the report.

## REPORT
Write `.codex-watch/wo-r5-b4-report.md`: per finding — reproduced? (+evidence file:line), Stage-0 plan (incl. #02 scoping
lever), files+line ranges changed, change summary, Stage-2 verification (incl. #02 non-market-unchanged proof + #08
#11-intact grep), blocked/deferred notes, Stage-4 uncertainty. End with typecheck output.
Return a terse final message: findings changed/blocked, typecheck result, any low-confidence items.
