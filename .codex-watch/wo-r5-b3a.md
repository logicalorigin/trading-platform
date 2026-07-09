# WO-R5-B3A — Round 5 remediation, Batch 3a (MED·moderate, files disjoint from Batch 2)

PYRUS trading platform frontend (`artifacts/pyrus`). Read `DESIGN.md` (repo root) first — "calm workspace"
doctrine (one primary read per surface, quiet hierarchy, semantic color only). Full issue text per finding
is in `FRONTEND_AUDIT_ROUND5.md` — read the matching `### #NN` section.

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY these files:
   - #11: `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx`
   - #17: `artifacts/pyrus/src/screens/GexScreen.jsx`
   - #19: `artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx`
   - #20 (account half only): `artifacts/pyrus/src/screens/account/PositionsPanel.jsx`
2. Do NOT run any git command. Leave the working tree for review.
3. Do NOT touch ANY other file. Explicitly FORBIDDEN (other lanes' uncommitted work / other batch in flight):
   `SignalsScreen.jsx`, `algoSettingsFields.js`, `algoHelpers.js`, `algoTimeframeControls.js`,
   `OperationsSignalRow.jsx`, `FlowScreen.jsx`, `AlgoLivePage.jsx`, `SettingsScreen.jsx`,
   `AccountHeroBlock.jsx`, `BacktestingPanels.tsx`, `PlatformAlgoMonitorSidebar.jsx`, and any `*.test.*`.
   If a fix needs a forbidden file, make NO change for that finding and record "blocked: needs <file>".
4. VERIFY-BEFORE-EDIT: confirm each defect exists in current source first. If not reproduced, no edit + note evidence.
5. Surgical, minimal diffs; match existing tokens/patterns; no refactors, no deps, no removal of data/metrics.

## FINDINGS

### #11 — Research bubbles carry two conflicting red/green encodings (PhotonicsObservatory.jsx)
Issue: each node uses red/green TWICE for different meanings — fill = categorical sector ("Vertical": NVDA green,
AMD red) while a separate outer ring = profitability (green profitable / red unprofitable). So red/green means
sector on the fill but P&L on the ring, colliding with the app palette (blue=buy, red=sell, green=P&L). A giant
green NVDA beside a red AMD reads as bullish-vs-bearish when it's neither. The ring legend only appears in
non-default color modes, so the default view's rings are unexplained.
Acceptance:
- Eliminate the double meaning of red/green in the DEFAULT view. Preferred: give the categorical SECTOR fill a
  distinct non-semantic categorical palette (NOT red/green), leaving red/green free for P&L only — OR, if the
  sector fill must stay, make the profitability ring clearly legended in the default view and visually distinct
  from sector color. Keep all encoded data; just stop the collision.
- Do not break the non-default color modes that already work.

### #17 — GEX 13-panel stack: inconsistent/incomplete section headings + shifting grid widths (GexScreen.jsx)
Issue: the primary gamma family (Strike Profile, DEX, Heatmap, Gamma-by-Expiry) gets NO group heading while
secondary Greeks get full-width heading bands; "Open Interest Analysis" is nested inside a grid column at a
different indent and wrongly files Volume Profile under it; independent auto-fit grids give charts different
column counts row to row (3-up → full-width → 2-up), reading as a shifting mosaic.
Acceptance:
- Consistent section-heading treatment across all chart groups (give the primary gamma family a heading band
  matching the secondary Greeks; fix the "Open Interest Analysis" indent and re-file Volume Profile correctly).
- Make the grid column behavior steady (consistent column counts / alignment) so it reads as one workspace, not
  a shifting mosaic. Reuse existing grid/section primitives; do not restructure the charts themselves.
- NOTE: GexScreen was just edited for #22 (header selector) — do NOT undo that; your change is additive to it.

### #19 — Algo settings panel mixes control paradigms with sub-44px cramped targets (AlgoSettingsRegion.jsx)
Issue: mixes label+toggle rows with label+toggle+number-field rows where the toggle floats between label and
value (ambiguous: does it enable the field or gate the limit?); toggle/value columns don't align across rows;
rows are tightly packed with decorative icons and switches well under 44px.
Acceptance:
- Give the rows a consistent structure with aligned toggle/value columns, so the toggle's relationship to the
  number field is unambiguous. Increase cramped interactive targets toward the app's standard (≥ existing
  minimum; aim 44px where feasible). Reduce decorative noise only where it doesn't remove meaning.
- Edit ONLY AlgoSettingsRegion.jsx. If the row config lives in the forbidden `algoSettingsFields.js`, do the
  presentational/layout fixes in AlgoSettingsRegion.jsx and record any field-config-dependent part as
  "blocked: needs algoSettingsFields.js".

### #20 (account half only) — Account filter band: unlabeled chip groups over empty data (PositionsPanel.jsx)
Issue (account portion ONLY): the Account screen stacks two unlabeled chip groups
(ALL·EQUITY·STOCK·ETF·OPTION running into ALL SOURCES·MANUAL·AUTOMATION·…) with two different "All" pills and
no separator, louder than the empty data they filter. (The Signals-screen portion of this finding is OUT OF
SCOPE — SignalsScreen.jsx is forbidden.)
Acceptance:
- Visually separate the two chip groups and label them (e.g. asset-type vs source), so the two "All" pills are
  no longer ambiguous/adjacent. Tone the band down so it doesn't out-shout the (often empty) data below.

## EXECUTION DISCIPLINE (fable-level — REQUIRED, do not skip a stage)
Work in explicit stages and gate each one; do not batch-edit blindly.
- STAGE 0 — Plan: read `DESIGN.md`, the 4 target files, and the matching `### #NN` audit sections. For EACH
  finding write a one-line plan: the exact defect location (file:line), the minimal change, and the concrete
  acceptance check you'll use to prove it's fixed. If a finding does not reproduce, say so and stop on it.
- STAGE 1 — Edit one finding at a time (smallest diff; existing tokens/patterns only).
- STAGE 2 — Verify that finding before moving on, with a FAILABLE check, not a vibe:
    (a) the described defect is actually gone in the source you changed;
    (b) every identifier/token/style key you introduced is imported/in-scope in THAT file — this is `.jsx`, so
        `tsc` will NOT catch an undefined name; a missing import = runtime blank screen. Grep to confirm.
    (c) you touched no forbidden file and no data/metric/behavior was removed.
  If a check fails, fix it before continuing.
- STAGE 3 — Typecheck (failable gate): `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck`.
  Must exit clean. If not, resolve or revert the offending change.
- STAGE 4 — Skeptical self-review before you finish: re-read your own full diff as an adversary. For each hunk
  ask "could this throw at runtime, misalign layout, or change behavior the finding didn't ask for?" List in the
  report anything you're less than confident about (do not hide uncertainty).

## REPORT
Write `.codex-watch/wo-r5-b3a-report.md`: per finding — reproduced? (+evidence file:line), the Stage-0 plan,
files+line ranges changed, one-line change summary, the Stage-2 verification you ran (esp. the import/scope grep),
any blocked/deferred note, and any Stage-4 uncertainty. End with the exact typecheck command output (pass/fail).
Return a terse final message: findings changed, findings skipped/blocked, typecheck result, any low-confidence items.
