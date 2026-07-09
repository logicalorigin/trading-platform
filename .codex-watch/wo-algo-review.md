# WO-ALGO-REVIEW — design-conformance review of the ALGO CONTROL PANEL vs DESIGN.md

ANALYSIS ONLY. Do NOT modify any source file. Read the files below, review, and WRITE your findings to
`.codex-watch/wo-algo-review-report.md`. That report file is the ONLY file you create/modify.

## Read
- Doctrine: `DESIGN.md` (repo root).
- Intended design (skip any that don't exist): `ALGO_RIGHT_RAIL_REDESIGN.md`,
  `SESSION_HANDOFF_LIVE_2026-06-27_algo-control-panel-design-verify.md`,
  `SESSION_HANDOFF_LIVE_2026-06-27_algo-kpi-table-density.md`.
- The control panel components:
  `artifacts/pyrus/src/screens/algo/AlgoRightRail.jsx`,
  `artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx`,
  `artifacts/pyrus/src/screens/algo/HaltStrip.jsx`,
  and how they're composed on the screen: `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`.
Do NOT read anything under ~/.claude, ~/.agents, or .claude/skills.

## Grade against DESIGN.md (these rules)
- HIERARCHY (Algo row): PRIMARY read = operational readiness + blockers; SECONDARY = recent state changes +
  capacity; TERTIARY = configuration, logs, detail. **The user's core concern: does the panel LEAD with an
  operational-readiness / "am I ready, what's blocking me" primary read, or is it a config-dominated wall?**
- SEMANTIC COLOR: blue=buy/call/bullish/inflow, red=sell/put/bearish/outflow (direction); green=+P&L, red=−P&L
  (financial); green=healthy/live, amber=stale/pending/degraded, red=error/offline (operational); amber=watch,
  red=danger. Never green for directional intent. (All color should route through semanticToneModel helpers.)
- REJECTION RULES: no dashboard-card mosaic where a workspace fits; NO cards-inside-cards; no decorative
  gradient/orb/blob; icons = affordance/status not decoration; no vague mood copy; no looping/competing motion;
  NO section with no single job. Page sections = full-width bands / unframed workspace; cards only for repeated
  items, modals, or genuinely framed tools.
- STATE COVERAGE: loading / empty / error / success / partial-stale defined per feature; stable dimensions
  across states; empty states are product states (no bare "no items").
- ACCESSIBILITY: icon-only controls labeled + visible focus; 44px targets where space allows; color never the
  only cue; motion respects prefers-reduced-motion.

## Report contract (`.codex-watch/wo-algo-review-report.md`)
1. **Verdict** — one line: does the algo control panel adhere to DESIGN.md?
2. **Hierarchy assessment** — the core question above, with evidence (which sections dominate; is there a clear
   operational-readiness primary read; file:line).
3. **Prioritized findings** (most-severe first) — each: severity (high/med/low) · which rule · the finding ·
   where (file:line/section) · a concrete fix.
4. **Plan vs implementation** — gaps between the redesign plan's intent and what shipped.
Be specific and honest; cite file:line; do not invent violations. Return a terse final message summarizing the
verdict + top 3 findings.
