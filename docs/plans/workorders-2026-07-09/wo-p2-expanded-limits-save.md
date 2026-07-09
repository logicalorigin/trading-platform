# WO-P2-EXPLIMITS — Expanded-Limits APPLY stays enabled during save-drain (lost-edit class)

> **HEADLESS FIX WORKER.** No SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/,
> agents/, AGENTS.md session sections. NEVER restart/reload/signal the app, never `git push`. 2-core
> live box: only listed validations. PRECONDITION: `git status --short -- artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx`
> clean; if dirty wait 60s ×10 then BLOCKED. Never `git add -A`. index.lock → sleep 10s, retry.
> Minimum diff. Note: pyrus tsc does NOT check .jsx — verify identifier changes with \b-exact grep +
> `@babel/parser` (repo memory: jsx-edits-not-covered-by-tsc).

## Defect (adversarial review, verified at source)

The algo save-drain fix disables the main settings controls via `saveInProgress`, but the
**Expanded Limits APPLY button stays enabled** during the pre-save drain window: clicking it
mid-save mutates the profile draft AFTER the save snapshot is taken — recreating the exact
dropped-edit / marked-clean bug the save-drain change was meant to close.

- `ExpandedLimitsSection` rendered with `disabled={!focusedDeployment}` — AlgoSettingsRegion.jsx
  ~:3268-3270 (verify by grep).
- The APPLY button only checks `disabled || updateProfileMutation?.isPending` ~:2266-2273.
- `saveInProgress` (the drain flag `AlgoRightRail` passes and the main disabled boolean already
  uses) is NOT threaded into the Expanded Limits section.

## Mandate

Thread the SAME `saveInProgress` (drain) signal the main controls use into `ExpandedLimitsSection`
so its APPLY button is disabled during the save-drain window exactly like the other settings
controls. Match the existing disabled pattern — do not invent a new one. Verify no OTHER
mid-save-mutable control in this file was missed (grep for APPLY/mutation buttons; report the
inventory).

## Tests

Extend the existing AlgoSettingsRegion/algo save test (find it: `rg -ln "saveInProgress|ExpandedLimits|save.*drain" artifacts/pyrus/src/**/*.test.*`):
- APPLY is disabled while saveInProgress is true; enabled when false (and focusedDeployment set).
- Existing save-drain tests still pass.

## Validation

1. `pnpm --filter @workspace/pyrus run typecheck` → EXIT 0.
2. `@babel/parser` parse of the edited .jsx (tsc doesn't cover jsx):
   `node -e 'require("./node_modules/.pnpm/@babel+parser@7.29.0/node_modules/@babel/parser").parse(require("fs").readFileSync("artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx","utf8"),{sourceType:"module",plugins:["jsx"]})'` → no throw.
3. `pnpm --filter @workspace/pyrus exec tsx --test --test-force-exit <the test file>` → 0 fail (if the test is .mjs node:test).

## Files you may touch
- `artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx` (+ possibly AlgoRightRail.jsx if the prop must be threaded) + ONE test file

## Commit
`fix(algo): disable Expanded-Limits APPLY during save-drain — closes remaining lost-edit path (WO-P2-EXPLIMITS)` + evidence lines + the control inventory.

Do NOT push. Report: `.codex-watch/wo-p2-explimits-report.md`; final message 3 lines.
