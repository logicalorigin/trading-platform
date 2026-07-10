# WO Fix HaltStrip Report

Status: **DONE**

## Outcome

`HaltStrip` now receives `AlgoRightRail`'s inclusive `pending` state and folds it into
the shared `controlsDisabled` gate. Its toggle and numeric profile-draft writers are
disabled from the save click through stream drain, mutations, and reconciliation.

## Root cause and fix

- Observed at `AlgoRightRail.jsx:343-346`: `pending` already combines
  `saveAllPending` with both mutation pending states.
- Observed before the fix at `AlgoRightRail.jsx:435-443`: the sole `HaltStrip` call
  did not receive that aggregate gate.
- Observed before the fix at `HaltStrip.jsx:580-581`: `controlsDisabled` only covered
  deployment readiness and the profile mutation's later pending state.
- Fixed at `AlgoRightRail.jsx:442`: pass `saveInProgress={pending}`.
- Fixed at `HaltStrip.jsx:566,581-582`: default the prop to `false` and include it in
  `controlsDisabled`, matching the pattern introduced for `AlgoSettingsRegion` by
  `1fe3fba8`.
- Existing handoffs at `HaltStrip.jsx:735,745` route the shared gate to both current
  writer-cell families, including the risk-cap mappings in
  `algoSettingsFields.js:627-638`.

Production diff: two files, three inserted lines, one replaced line. No helper,
dependency, or adjacent refactor was added.

## Regression and validation evidence

TDD RED, before the production edit:

- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/HaltStrip.test.mjs`
- Result: **0 pass / 1 fail**; the missing `saveInProgress={pending}` assertion failed.

GREEN, after the production edit:

- `pnpm --filter @workspace/pyrus exec tsx --test src/screens/AlgoScreen.test.mjs src/screens/algo/HaltStrip.test.mjs`
- Result: **16 pass / 0 fail**.
- The new direct HaltStrip suite locks the parent prop, safe default, aggregate gate,
  and both `disabled={controlsDisabled}` writer-family handoffs.
- No shared-validation-lock exit 75 occurred.

Supplemental existing-suite observation:

- No direct `HaltStrip` suite existed at HEAD; `algoHelpers.test.mjs` is the closest
  existing halt-state suite.
- Running it separately produced **60 pass / 1 fail** at the pre-existing
  `STA MTF filter honors the stored requiredCount dial` assertion. Both
  `algoHelpers.js` and `algoHelpers.test.mjs` are clean at HEAD and neither imports
  the changed components, so this is outside the HaltStrip save-drain diff.

Review evidence:

- Scoped `git diff --check`: **PASS**.
- Independent review: **APPROVE**; no correctness, test, readability, architecture,
  security, performance, or scope findings.

## Scope discipline

- `artifacts/pyrus/src/screens/algo/saveAllAlgoAdjustments.test.mjs` remained a
  pre-existing modified file and was not edited, reverted, or staged.
- No restart, signal, push, database write, Replit control-plane action, or
  `SESSION_HANDOFF` file write was performed.

## Commit

`fix(algo): HaltStrip honors the save-drain gate — risk-cap edits can no longer race a pending save (QA-HALTSTRIP P1)`
