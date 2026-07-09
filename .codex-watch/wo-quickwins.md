# WO-QUICKWINS — small high-confidence design fixes (clean-file subset)

PYRUS trading platform frontend (`artifacts/pyrus`). Read `DESIGN.md` (repo root) first — "calm workspace",
semantic color only. These are small, high-confidence fixes on live screens.

## ⛔ NO REFORMATTING (your previous run FAILED this — read carefully)
Your previous attempt ran a width-80 formatter over the whole file (collapsing imports, re-wrapping arrow
functions, expanding objects) and produced a 400+-line diff for a ~6-line fix. That is a FAILURE. This repo
has NO prettier config and INTENTIONALLY uses long lines. THEREFORE:
- Do NOT run prettier, eslint --fix, or ANY formatter. Do NOT re-wrap, re-indent, reflow, or "tidy" ANY line.
- Change ONLY the exact character ranges needed for each finding. Leave every other line byte-for-byte identical.
- Preserve the file's existing line lengths and wrapping style even if they exceed 80 columns.
- Self-check before finishing: `git diff --stat` on your files must be SMALL (each file well under ~40 lines).
  If any file shows 100+ changed lines, you reformatted — REVERT and redo touching only the target lines.

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY these files (#14 is DROPPED — the model exposes no asset-type data, confirmed blocked):
   - #5 (header only): `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`
   - #17: `artifacts/pyrus/src/screens/algo/AlgoRightRail.jsx`, `artifacts/pyrus/src/screens/algo/HaltStrip.jsx`,
          `artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx`
2. Do NOT run any git command. Leave the working tree for review.
3. Do NOT touch any other file. FORBIDDEN (other lanes' dirty work / out of scope): `OperationsSignalRow.jsx`,
   `algoHelpers.js`, `algoSettingsFields.js`, `algoTimeframeControls.js`, any `*.test.*`, any market/*, any other screen.
   If a fix needs a forbidden file, make NO change for that part and record "blocked: needs <file>".
4. VERIFY-BEFORE-EDIT; surgical diffs; existing tokens/patterns; preserve all functionality.

## FINDINGS

### #14 — Broker cards missing tradable asset-type line (SnapTradeConnectPanel.jsx)
Add a concise per-broker tradable asset-type line (e.g. "Stocks · Options · Futures") to the broker choice cards so
users can see what each broker supports before connecting. Derive the asset types from existing broker metadata if
present in the model (check `snapTradeConnectModel.js`, READ-ONLY, for a capabilities/asset-type field); if no such
field exists, record "blocked: no asset-type data in model" and make no guess. Use existing tokens/typography.

### #5 (header only) — Algo STA table shows "ready to scan" after-hours (OperationsSignalTable.jsx)
The table header still reads "ready to scan" after-hours when no scan will actually run. Fix ONLY the header wording in
OperationsSignalTable.jsx so it reflects the true state (e.g. "market closed" / "idle after-hours") when scanning is not
active. Use the same market-session/scan-active signal the component already has. (The per-ROW "Awaiting scan" wording
lives in OperationsSignalRow.jsx, which is FORBIDDEN — leave it; note it as deferred.)

### #17 — Algo control-panel micro-typography (AlgoRightRail.jsx, HaltStrip.jsx, AlgoSettingsRegion.jsx)
Upgrade the tiny pocket/category labels and clarify the WIRE TRAIL micro-stats so the dense control panel reads cleanly:
- Bump sub-minimum micro-label sizes to the design system's smallest legible token (no raw sub-8px), keep hierarchy.
- Clarify any cramped/ambiguous WIRE TRAIL micro-stat labels (labels, spacing) without changing their meaning or values.
- Do NOT change any control behavior. This is typography/label legibility only.
- (The "DOM-probe the INFRA/gateway red state" part is a runtime check, NOT a code edit — skip it here.)

## EXECUTION DISCIPLINE (fable-level — REQUIRED)
- STAGE 0 — Plan: read `DESIGN.md`, the target files, `snapTradeConnectModel.js` (read-only) for #14. Per finding write
  the exact location (file:line), the minimal change, and the failable acceptance check.
- STAGE 1 — Edit one finding at a time (smallest diff).
- STAGE 2 — Verify each (failable): the defect is addressed; every identifier/token introduced is in-scope in that file
  (grep — tsc won't catch a bad name in .jsx); no forbidden file touched; no behavior/value changed.
- STAGE 3 — Typecheck (failable gate): `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck` — clean.
- STAGE 4 — Skeptical self-review: re-read your diff as an adversary; note any risk.

## REPORT
Write `.codex-watch/wo-quickwins-report.md`: per finding — reproduced/applicable? (+evidence), plan, files+line ranges,
change summary, Stage-2 verification, blocked/deferred notes, Stage-4 uncertainty. End with typecheck output.
Return a terse final message: findings changed/blocked, typecheck result, low-confidence items.
