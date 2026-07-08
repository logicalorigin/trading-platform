# WO-FIX-07 — MTF entry gate honors the configured alignment (owner decision 2026-07-08)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, implementing ONE
owner-decided behavior reconciliation. Working-tree edits ONLY — NO git commands (both files dirty).

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml.

## Owner decision (verbatim intent)
"We want whatever alignment is set in the algo control panel. We do NOT want a certain number
n-of-N hardcoded." I.e., the MTF entry gate must honor the deployment's CONFIGURED alignment
requirement (requiredCount from the algo control panel settings), not force unanimity and not
hardcode any count. This supersedes the 2026-07-02 note about the unanimity hardcode.

## Current state (triage-verified)
- artifacts/api-server/src/services/signal-options-automation.ts (DIRTY, in-flight calibration
  workstream): gate currently forces unanimity; the workstream added `requiredCount` plumbing
  (present 3×) but impl and tests are unreconciled. Failing test: signal-options-automation.test.ts
  "MTF entry gate honors configured requiredCount instead of forcing unanimity" (expects 2-of-3
  honored; impl returns 3).
- artifacts/pyrus/src/screens/algo/algoHelpers.js + OperationsSignalTable.test.mjs (DIRTY): frontend
  mirror — "STA MTF alignment 2-of-3 passes" fails the same way.

## Operating discipline (binding)
Ponytail; fact-first — trace where the control panel's alignment setting is stored (deployment
config field), how it flows to the gate, and what default applies when unset (VERIFY the intended
default from the config schema/UI: if the control panel defaults to all-timeframes, unset config
still behaves like unanimity — do not invent a different default). LIVE trading gate: the change
must make config authoritative, nothing else. Surgical.

## Fix shape
1. api: make the MTF entry gate use the deployment's configured required alignment count wherever
   the workstream plumbed `requiredCount` (respecting the verified default for unset config).
   Remove/bypass the unanimity forcing ONLY where it overrides config.
2. pyrus: reconcile algoHelpers.js STA alignment logic the same way so the mirror test passes —
   the frontend must render gate state consistent with the backend rule.
3. If backend and frontend disagree on the default-when-unset, STOP and report.

## Tests (run, paste output)
`pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-mtf-alignment.test.ts`
`pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/OperationsSignalTable.test.mjs src/screens/algo/AlgoScreen.test.mjs`
All must pass (the two MTF tests flip to green; nothing else regresses).

## Deliverable
EXACTLY ONE file: .codex-watch/wo-fix-07-report.md — the config-flow trace (where the control-panel
setting lives, file:line), what changed, unified diff of YOUR hunks only, test output, and the
verified default-when-unset behavior.
