# Tooltip Redundancy Cleanup

## Symptom

The first tooltip cleanup still allowed redundant PYRUS tooltips that restated
visible UI content with different punctuation or boilerplate action words.

## Root Cause

`AppTooltip` only suppressed exact string matches between tooltip content and
visible trigger text. Label/value repeats such as `Label: Value`, and visible
controls with tooltip prefixes such as `Sort by`, survived that equality check.

## Fix

`artifacts/pyrus/src/components/ui/tooltip.tsx` now:

- Normalizes tooltip and trigger text into comparable tokens.
- Suppresses same-text tooltips when the trigger is not clipped.
- Suppresses tooltips whose content tokens are already visible in the trigger.
- Ignores boilerplate tokens like `sort`, `by`, `search`, and `open` when the
  visible trigger already names the object.
- Preserves tooltip display for clipped visible text, icon-only controls, and
  rich/non-string tooltip content.

Regression coverage was added to
`artifacts/pyrus/src/features/platform/platformRootSource.validation.js`.

Follow-up header-lane fix:

- Header broadcast pills no longer wrap the whole visible pill in a tooltip.
- Header provider chips/channels only keep a tooltip when `title` differs from
  the visible label.
- Header provider lane values, Massive provider details, and generic provider
  row value/detail text no longer have same-text wrappers when the same text is
  already rendered.
- Header account metrics only keep a tooltip when compact/dense mode displays a
  short label and the tooltip expands it to the full label.
- Header ticker KPI buttons in their dedicated lane no longer render
  `AppTooltip`; the visible symbol, price, and percent remain inline.

## Validation

- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/platformRootSource.validation.js`
- `pnpm --filter @workspace/pyrus typecheck`
- `git diff --check -- artifacts/pyrus/src/components/ui/tooltip.tsx artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx artifacts/pyrus/src/features/platform/HeaderAccountStrip.jsx artifacts/pyrus/src/features/platform/HeaderKpiStrip.jsx artifacts/pyrus/src/features/platform/platformRootSource.validation.js`
