# Signals Calm Live Terminal Notes

The Signals page should read as a market-bias command deck first and an execution table second. Keep top-level hierarchy in this order: current bias KPIs, timeframe bias, breadth history, controls, dense table, row drilldown.

## Visual Rules

- Signal direction uses blue for buy and red for sell. Do not use green for signal-direction sparklines, breadth history, row rails, timeframe bars, or drilldown direction echoes.
- Green is reserved for non-directional operational states such as monitor enabled, cache hit, or freshness status.
- Prefer integrated surfaces: compact strips, row rails, table states, and drilldown echoes. Avoid decorative glow layers, large hero styling, or floating cards inside cards.
- Keep the tone calm: one-shot highlights for signal flips, subtle refresh/pulse states, and no looping directional animation.

## Interaction Rules

- The breadth history defaults to Day and offers Day/Week as a segmented control.
- Table rows keep all-row sparkline hydration behavior. Do not regress to visible-row-only sparkline hydration.
- Row selection should carry the same direction language into the drilldown with the same blue/red rail.
- Respect reduced-motion settings; live highlights must degrade to static state changes.

## Responsive And Accessibility Rules

- Header surfaces must wrap cleanly on phone widths without text overlap.
- Segmented controls and icon buttons should meet the 44px touch target where practical.
- Charts need an `aria-label`, stable dimensions, and loading/empty/error states that keep layout stable.
