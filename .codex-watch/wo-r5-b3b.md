# WO-R5-B3B — Round 5 remediation, Batch 3b (single finding #13, FlowScreen)

PYRUS trading platform frontend (`artifacts/pyrus`). Read `DESIGN.md` (repo root) first — "calm workspace"
doctrine (no duplicate controls, one clear way to do a thing). Full issue text: `FRONTEND_AUDIT_ROUND5.md`
section `### #13`.

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY: `artifacts/pyrus/src/screens/FlowScreen.jsx`.
2. Do NOT run any git command. Leave the working tree for review.
3. Do NOT touch any other file (FORBIDDEN: `FlowDistributionScannerPanel.jsx`, `FlowScannerStatusPanel.jsx`,
   `PlatformAlgoMonitorSidebar.jsx`, any `*.test.*`, any other lane's files). If the fix needs a file outside
   FlowScreen.jsx, make NO change and record "blocked: needs <file>".
4. VERIFY-BEFORE-EDIT: confirm the defect exists in current source first; if not reproduced, no edit + evidence.
5. Surgical, minimal diff; existing tokens/patterns; no refactor; no new state source; preserve all filtering behavior.

## FINDING

### #13 — Flow preset chips duplicate the Filters panel with no active-state link (FlowScreen.jsx)
Issue: flow-type and premium-threshold controls are duplicated across two co-visible surfaces — the PRESET SCANS
chip row (Sweeps / Blocks / Repeats / Golden, $50K+ / $250K+) repeats the Filters panel directly below
(Sweep / Block / Repeat / Golden; $50K / $100K / $250K). Two overlapping ways to set the same filter, stacked,
with no indication of precedence or which is active.
Acceptance:
- Resolve the duplication so there is ONE coherent model. Preferred: make the PRESET SCANS chips reflect and drive
  the SAME filter state as the Filters panel, with a clear ACTIVE indicator (the chip matching the current filter
  is highlighted; clicking a preset visibly updates the Filters panel state). No third, disconnected state.
- If presets are genuinely a distinct concept from the filters, at minimum give them an active/selected state tied
  to the current filter values so the user can see the relationship. Do NOT silently leave two disconnected controls.
- Keep all existing filtering capability; this is about linking/deduping the controls, not removing filters.

## EXECUTION DISCIPLINE (fable-level — REQUIRED)
- STAGE 0 — Plan: read `DESIGN.md`, `FlowScreen.jsx`, and audit `### #13`. Locate BOTH the preset chip row and the
  Filters panel controls in FlowScreen.jsx; identify the shared filter state (the setter/handler both should use).
  Write the one-line plan: which state is authoritative, how the presets will read+write it, the active-state cue.
  If the Filters panel lives outside FlowScreen.jsx, STOP and record "blocked: needs <file>".
- STAGE 1 — Edit (smallest diff; wire presets to the existing filter state + add active styling).
- STAGE 2 — Verify (failable): (a) selecting a preset updates the same filter the panel uses; (b) the active preset
  reflects the current filter; (c) every identifier/token you introduced is in-scope in this .jsx (grep — tsc won't
  catch it); (d) no other file touched, no filter capability removed.
- STAGE 3 — Typecheck (failable gate): `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck` — clean.
- STAGE 4 — Skeptical self-review: re-read your diff as an adversary; note any runtime/behavior risk in the report.

## REPORT
Write `.codex-watch/wo-r5-b3b-report.md`: reproduced? (+evidence file:line), Stage-0 plan, files+line ranges,
change summary, Stage-2 verification (esp. import/scope grep), blocked/deferred notes, Stage-4 uncertainty, typecheck output.
Return a terse final message: changed or blocked, typecheck result, any low-confidence items.
