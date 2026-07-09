# WO-R5-DEFER — Round 5 remediation, previously-deferred findings (#21, #09, #10, #20-signals)

PYRUS trading platform frontend (`artifacts/pyrus`). Read `DESIGN.md` (repo root) first — "calm workspace"
doctrine. Full issue text: `FRONTEND_AUDIT_ROUND5.md` sections `### #21 #09 #10 #20`. NOTE: these two files were
just reset to clean HEAD (another lane's WIP is parked in a git stash), so you see the committed baseline.

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY these files:
   - #21, #09: `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx`
   - #10, #20 (signals half): `artifacts/pyrus/src/screens/SignalsScreen.jsx`
2. Do NOT run any git command. Leave the working tree for review.
3. Do NOT touch any other file (no `*.test.*`, no other screens/components).
4. VERIFY-BEFORE-EDIT; surgical diffs; existing tokens/patterns; preserve all functionality (every study can still be
   created, every filter/interval still works, no metric or control removed — only reorganized/relabeled/de-emphasized).

## FINDINGS

### #21 — Backtest bands carry design-doc prose instead of concrete status (BacktestingPanels.tsx)
Issue: every band opens with a paragraph of internal layout-rationale narration ("This keeps the main page
analysis-first while still putting the warning inputs above the chart workspace.", "The spot chart is the primary
visual truth surface.") — four+ such paragraphs stack down the page, leaking design language into the product.
Acceptance: remove the design-rationale prose paragraphs from the bands (they narrate layout intent, not product
status). Keep genuine functional/status copy and all controls. The page should read analysis-first without the essays.

### #09 — Backtest leads with an empty section + duplicates the "create study" action (BacktestingPanels.tsx)
Issue: the configure→run→inspect screen leads with an empty "Promoted Drafts" band ("No promoted draft strategies
yet"), pushing the actual work below it. Then TWO stacked surfaces both create a study — Research Workbench's empty
state [Create study] and the Backtest Inputs form's [Save Study] (both call handleCreateStudy) — so the user can't
tell which is authoritative.
Acceptance:
- Do not LEAD with the empty Promoted Drafts band: hide/collapse it when empty, or move it below the primary work.
- Resolve the duplicate create-study: consolidate to ONE clear create-study affordance (or clearly differentiate the
  two if they truly differ). Study creation must still work. State in the report how you deduped handleCreateStudy.

### #10 — Signals screen has no single primary read; interval/idle state echoed 3+ times (SignalsScreen.jsx)
Issue: the identical 1M/2M/5M/15M/1H/1D idle set is rendered THREE times on one screen — interval tiles ("idle / B 0
— S 0"), the hydration-strip chips ("1M idle 2M idle …"), and the header "Intervals idle" pill — plus a summary stat
row (BUY/SELL/NET 0) that overlaps the per-interval tiles. Everything reads "0" at equal weight; no authoritative surface.
Acceptance: establish ONE primary read for interval state. Keep the most useful single surface (e.g. the interval tiles),
and de-emphasize or remove the redundant echoes (hydration-strip duplicate chips and/or the header "Intervals idle" pill,
and/or fold the summary stat row so it doesn't restate the per-interval B/S/NET). Preserve all data — this is a re-rank
/ dedup of surfaces, not a data removal.

### #20 (signals half) — Signals filter band: unlabeled icon buttons over empty data (SignalsScreen.jsx)
Issue: the Signals filter band packs eight dropdowns then four icon-only buttons (filter / power / expand / refresh)
with no labels — the power-toggle is indistinguishable from refresh — crowded above a zero-row table.
Acceptance: make the four icon buttons legible/distinguishable — accessible labels + tooltips (aria-label/title), and a
clearer active/pressed state for the power toggle so it's not mistaken for refresh. Reduce the band's visual shout over
the (often empty) data. Do NOT remove any control.

## EXECUTION DISCIPLINE (fable-level — REQUIRED)
- STAGE 0 — Plan: read `DESIGN.md`, both files, and the audit `### #NN` sections. For each finding write the exact
  location (file:line), minimal change, and the failable acceptance check.
- STAGE 1 — Edit one finding at a time (smallest diff).
- STAGE 2 — Verify each (failable): the defect is gone; study-create / filters / intervals still function; every
  identifier/token introduced is in-scope in that file (grep — tsc won't catch a bad name in .jsx/.tsx); no other file touched.
- STAGE 3 — Typecheck (failable gate): `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck` — clean.
- STAGE 4 — Skeptical self-review: re-read your diff as an adversary; note any runtime/behavior risk.

## REPORT
Write `.codex-watch/wo-r5-defer-report.md`: per finding — reproduced? (+evidence file:line), Stage-0 plan, files+line
ranges, change summary, Stage-2 verification (esp. import/scope grep + "still functions" check), Stage-4 uncertainty.
End with typecheck output. Return a terse final message: findings changed/blocked, typecheck result, low-confidence items.
