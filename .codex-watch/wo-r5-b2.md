# WO-R5-B2 — Round 5 remediation, Batch 2 (HIGH·moderate, clean-file subset)

PYRUS trading platform frontend (`artifacts/pyrus`). Read `DESIGN.md` (repo root) first — obey the
"calm workspace" doctrine: one primary read per surface, quiet hierarchy, semantic color only, no
redundant chrome. Full issue text per finding is in `FRONTEND_AUDIT_ROUND5.md` (read the matching
`### #NN` section for each).

## HARD CONSTRAINTS (violating any = failure)
1. Edit ONLY these files:
   - #03: `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`,
          `artifacts/pyrus/src/screens/algo/HaltStrip.jsx`,
          `artifacts/pyrus/src/screens/algo/OperationsAttentionStrip.jsx`,
          `artifacts/pyrus/src/screens/algo/OperationsStatusOrb.jsx`,
          `artifacts/pyrus/src/screens/algo/OperationsTransitionsStrip.jsx`
   - #04: `artifacts/pyrus/src/screens/FlowScreen.jsx`,
          `artifacts/pyrus/src/features/flow/FlowScannerStatusPanel.jsx`
   - #05: `artifacts/pyrus/src/screens/SettingsScreen.jsx`
   - #07: `artifacts/pyrus/src/screens/account/AccountHeroBlock.jsx`
2. Do NOT run any git command. Leave the working tree for review.
3. Do NOT touch ANY other file. Explicitly FORBIDDEN (other lanes' uncommitted work):
   `PlatformAlgoMonitorSidebar.jsx`, `BacktestingPanels.tsx`, `SignalsScreen.jsx`,
   `OperationsSignalRow.jsx`, `algoHelpers.js`, `algoSettingsFields.js`, `algoTimeframeControls.js`,
   and any `*.test.*`. If a fix needs a forbidden file, DO NOT edit it — make no change for that
   finding and record "blocked: needs <file>" in the report.
4. VERIFY-BEFORE-EDIT: confirm each described defect exists in current source before changing anything.
   If it does not reproduce, make no edit and record "not reproduced" + evidence.
5. Surgical, minimal diffs. Match existing tokens/patterns. No refactors, no dependencies, no removal
   of any surface/metric that conveys UNIQUE information — this is trading UI; hiding a real state is a bug.

## FINDINGS

### #03 — One broker-down fact re-announced ~5x on the Algo screen (HIGHEST care)
Issue: when the broker bridge is down, the same fact is broadcast by 4+ competing surfaces at once:
WARNING + BROKER OFF + OFFLINE header pills (per the audit, WARNING and OFFLINE express the SAME derived
state; BROKER OFF is its cause), the left status strip (NO SIGNAL DATA / NO ALGO EVENTS), the WIRE TRAIL
"ARMED" pill, and the center GATEWAY "Start the broker bridge" callout. A trader scanning for the one
actionable state sees a cluster of red/amber chips that all mean one thing.
Acceptance (CONSERVATIVE):
- First map, from source, exactly which surfaces render for the broker-down state (list them in the report).
- Collapse ONLY the strictly-redundant duplicates: the WARNING and OFFLINE header pills that express the
  identical derived state → a single pill. Keep the causal "BROKER OFF" indicator and keep the actionable
  GATEWAY "Start the broker bridge" callout as the single primary read.
- You MAY de-emphasize (not delete) a secondary echo only when it is unambiguously the same message.
- Do NOT remove any surface that conveys unique info (e.g. NO SIGNAL DATA vs NO ALGO EVENTS are distinct;
  the WIRE TRAIL/ARMED pill is a distinct concept). If unsure a surface is redundant, LEAVE it and note it.
- Net goal: one clear "broker is down + here's the action" primary read; fewer duplicate red/amber chips.

### #04 — Flow Scanner clips live status mid-word while the empty Algo Monitor hogs equal width
Issue: during scanning the Flow Scanner truncates the exact content a trader watches ("SCANNIN", "warmi…",
ticker pills clipped to "ASML scan..", "Q..", "M..") because the equally-wide Algo Monitor beside it sits
empty ("No algo deployment"). Space is misallocated so the primary live read is unreadable.
Acceptance:
- Reallocate horizontal space in the FlowScreen layout so the live Flow Scanner content is not clipped
  mid-word (let it breathe / wrap / take more of the row). Do this in `FlowScreen.jsx` and/or
  `FlowScannerStatusPanel.jsx` ONLY.
- You are FORBIDDEN from editing `PlatformAlgoMonitorSidebar.jsx`. If the ONLY viable fix requires editing
  that sidebar, make no change and record "blocked: needs PlatformAlgoMonitorSidebar.jsx" for #04.

### #05 — Theme setting exposed twice with two paradigms showing conflicting values (SettingsScreen.jsx)
Issue: theme is controlled by two widgets that disagree — a segmented Dark/Light toggle in "App Preferences"
(shows LIGHT) and a System/Dark/Light dropdown in "Appearance" (shows System). Same setting reported as both
"Light" and "System"; user can't tell which is authoritative.
Acceptance:
- Make theme controlled by a SINGLE authoritative control so the two can never disagree. Prefer keeping the
  richer System/Dark/Light control (it includes System) and removing/converting the duplicate segmented toggle.
- CRITICAL: preserve live theme-switching behavior. Trace the wiring first (which control actually drives the
  applied theme — e.g. onToggleTheme vs the appearance-pref patch). The remaining single control MUST still
  apply the theme correctly for every option it exposes. If unifying risks breaking theme application, instead
  make both controls read/write the SAME source of truth (so they always agree) and note that in the report.

### #07 — Account performance summary is a cryptic single-line ticker of ~13 equal-weight KPIs (AccountHeroBlock.jsx)
Issue: the Account screen's primary read is one thin line of ~13 uppercase abbreviated metrics at equal weight
("ADJ RETURN — · P&L Δ — · TRADES 0 · … PF — · EXP — · CURDD — · DEV — · INT —"), most values em-dashes. The
two truly primary numbers read the same size as 11 tertiary ratios; abbreviations are cryptic.
Acceptance:
- Establish hierarchy: give the 1–2 primary account-health numbers (e.g. account value / day P&L — pick the
  genuinely primary ones from the data) clear visual dominance (size + weight); demote the ~11 tertiary ratios
  to a clearly secondary tier. Keep ALL metrics (do not drop data) — this is a re-rank, not a removal.
- Improve legibility of the cryptic abbreviations (fuller labels where space allows, or accessible tooltips).

## PROCESS
1. Read `DESIGN.md`, the target files, and the matching `### #NN` sections of `FRONTEND_AUDIT_ROUND5.md`.
2. Per finding: verify → map surfaces (esp. #03) → surgical edit.
3. Typecheck: `cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck` — must be clean.
4. Write `.codex-watch/wo-r5-b2-report.md`: per finding — reproduced? (+evidence), the surface map for #03,
   files+line ranges changed, one-line change summary, any "blocked/deferred" note. End with typecheck output.
Return a terse final message: findings changed, findings skipped/blocked, typecheck result.
