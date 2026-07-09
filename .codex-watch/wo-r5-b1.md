# WO-R5-B1 — Round 5 frontend design-audit remediation, Batch 1 (clean-file, lower-risk)

You are a frontend remediation worker on the PYRUS trading platform (`artifacts/pyrus`, React/JSX + some TSX).
The design system is `DESIGN.md` at the repo root — read it first; obey the "calm workspace" doctrine
(quiet hierarchy, one primary read per surface, no decorative noise, semantic color only).

The full audit with detailed issue text is `FRONTEND_AUDIT_ROUND5.md` (repo root). Read the specific
finding sections named below for the complete issue/fix rationale. This WO gives you the authoritative
scope + acceptance criteria.

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY these files:
   - `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx`   (#16)
   - `artifacts/pyrus/src/screens/GexScreen.jsx`                     (#22)
   - `artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx`       (#15 tail)
   If a fix truly requires a shared primitive, STOP and note it in the report instead of editing it.
2. Do NOT run any git command (no add/commit/checkout/stash/restore). Leave the working tree for review.
3. Do NOT touch any other file. Specifically do NOT touch `PlatformAlgoMonitorSidebar.jsx`,
   `BacktestingPanels.tsx`, or `SignalsScreen.jsx` — they hold other teams' uncommitted work.
4. VERIFY-BEFORE-EDIT: the audit sometimes misattributes source lines. For each finding, first confirm
   the described defect actually exists in the current source. If it does NOT reproduce (already fixed or
   misattributed), make NO edit and record "not reproduced" in the report with the evidence you checked.
5. Surgical changes only: match the file's existing style, tokens, and component patterns. No refactors,
   no reformatting untouched lines, no new dependencies. Smallest diff that resolves the finding.

## FINDINGS

### #22 — GEX primary symbol selector is the weakest-looking control (file: GexScreen.jsx)
Issue: the underlying-symbol input is an ~82px borderless transparent text field with only a 14px glyph,
left of two loud SegmentedControls; reads as static text, no editable/searchable affordance, no dropdown
cue; the row is right-aligned leaving the prime top-left empty with no "GEX" screen/symbol title anchor.
Acceptance:
- The symbol selector reads as an editable/searchable control: visible border/background using existing
  DESIGN tokens, adequate width, and a search/dropdown affordance consistent with other selectors in the app.
- A clear screen/symbol title anchors the top-left (e.g. "GEX" + active symbol), so the primary control
  isn't floating right with an empty prime corner.
- Use existing shared input/selector primitives if one exists in the codebase; do not invent a new widget.

### #15 (tail) — Trade spot-feed empty/loading paradigm is inconsistent (file: TradeEquityPanel.jsx)
Context: Round-5 batch B already normalized `TradeChainPanel.jsx` loading states to the shared kit.
This finding is the remaining sibling: the trade spot chart empty/loading state uses a different paradigm
(left-aligned solid gray card, uppercase-mono, no spinner; an opaque card bleeding over ghost candles that
reads like a render glitch) than the option chart/chain beside it.
Acceptance:
- TradeEquityPanel's empty/loading state matches the shared empty-state kit already used by TradeChainPanel
  (same alignment, casing, container treatment, spinner rule) so the three adjacent chart/chain panels read
  as one calm system. Reuse the shared primitive TradeChainPanel now uses; do not fork a new style.

### #16 — Watchlist editor chrome is cramped + active-list name truncated (file: PlatformWatchlist.jsx)
Issue: the watchlist-management rail crowds a truncated selector ("W…" so the active list name is unreadable),
RENAME/DEFAULT/DELETE, MANUAL/SIGNAL/%CHG/A-Z tabs, Filter, DESC, +ADD into a narrow rail with sub-target
controls. (A second structural concern — that this rail also appears on the Account screen where it has no job
— is OUT OF SCOPE for this batch; see below.)
Acceptance (mechanical readability only):
- The active watchlist name is legible (not truncated to "W…") — allow it to show, or give a tooltip/title +
  more room, using existing layout tokens.
- Tighten/clarify the control targets where trivially possible without restructuring (respect ≥ existing
  patterns; do not force a full redesign).
- DO NOT remove the watchlist rail from any screen. If you see how the Account-screen duplication should be
  resolved, WRITE IT IN THE REPORT as a proposal — do not implement it (needs owner sign-off).

## PROCESS
1. Read `DESIGN.md`, then the three target files, then the matching finding sections of `FRONTEND_AUDIT_ROUND5.md`.
2. For each finding: verify → edit (surgical) → note what changed.
3. Typecheck: `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck`. Must be clean.
4. Write a report to `.codex-watch/wo-r5-b1-report.md` with, per finding: reproduced? (yes/no + evidence),
   files+line ranges changed, one-line summary of the change, and any proposal deferred to owner.
   End the report with the exact typecheck command output (pass/fail).
Return a terse final message: which findings you changed, which you skipped (not reproduced), typecheck result.
