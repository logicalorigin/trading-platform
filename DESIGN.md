# PYRUS Design Doctrine

PYRUS is a calm live trading workspace. Screens should help a trader scan market state, trust data freshness, and act on anomalies without decoding decorative UI.

## Semantic Color Rules

Color must describe meaning, not mood.

- Directional market intent uses blue for buy, call-side, bullish, long, inflow pressure, and red for sell, put-side, bearish, short, outflow pressure.
- Financial outcome uses green for positive P&L, positive return, gain, and red for negative P&L, negative return, loss.
- Operational health uses green for healthy, live, connected, configured, synced; amber for stale, pending, delayed, degraded, limited; red for error, unavailable, failed, blocked, offline.
- Risk and attention use amber for watch/elevated and red for critical/danger.
- Neutral metadata uses muted text and border tones.

Green is not banned. It is banned only when the user is reading directional market intent.

## Screen Hierarchy

Every migrated screen must define a hierarchy matrix before visual edits:

| Screen | Primary read | Secondary support | Tertiary controls/detail |
|--------|--------------|-------------------|--------------------------|
| Signals | Current buy/sell bias and breadth | Timeframe history and row rails | Filters, dense table, row drilldown |
| Flow / GEX | Directional pressure and concentration | Contract/expiry/source context | Filters, sort, raw rows, glossary |
| Account / Trade | Financial outcome and exposure | Orders, positions, execution context | Controls, drilldowns, automation detail |
| Algo / Diagnostics / Settings | Operational readiness and blockers | Recent state changes and capacity | Configuration, logs, detail rows |
| Research / Market | Market context and analysis conclusion | Supporting metrics and evidence | Filters, datasets, secondary panels |

## State Coverage

Every migrated screen and shared primitive must specify what users see for:

| Feature | Loading | Empty | Error | Success | Partial / stale |
|---------|---------|-------|-------|---------|-----------------|
| KPI strip | Stable skeleton or last-known muted values | Contextual zero state | Red/amber status with retry where available | Live values with compact labels | Timestamp/source label plus amber tone |
| Sparkline/chart | Stable fixed-height placeholder | Quiet "no history" state | Error text outside chart frame | Rendered data with accessible label | Amber freshness/source cue; no layout jump |
| Dense table | Preserved header and row skeleton | Context and next action | Inline failure row | Sorted/filterable rows | Row-level stale/data issue cue |
| Status pill | Pending/refreshing label | Neutral standby label | Error/blocked label | Live/ready label | Stale/degraded label |

Empty states are product states. Do not ship bare "No items found" copy without context or recovery.

## Live Trust Flow

Normal use does not need a long storyboard. Trust-critical anomalies do:

1. Stale data: show amber freshness/source context without moving the layout.
2. Missing data: state what is missing and whether the user can refresh, wait, or configure.
3. Conflicting direction: keep the blue/red direction language consistent across KPI, table, chart, and drilldown.
4. Refresh in progress: preserve last-known values when safer than blanking, and label them as refreshing.
5. Recovery: remove stale/error cues when fresh data returns; avoid celebratory motion.

## App UI Rejection Rules

Reject these patterns during implementation and review:

- Dashboard-card mosaics where layout should be a workspace.
- Cards inside cards.
- Decorative gradient/orb/blob layers.
- Icons used as decoration instead of affordance or status.
- Vague mood copy such as "insights at a glance" where a concrete status would work.
- Motion that loops or competes with live data.
- UI sections with no single job.

Cards are acceptable for repeated items, modals, and genuinely framed tools. Page sections should be full-width bands or unframed workspace layouts.

## Responsive And Accessibility

Every migrated screen must pass these checks:

- Desktop, tablet, and phone layouts are specified.
- Dense tables keep stable headers and readable cells on narrow widths.
- Icon-only controls have labels/tooltips and visible focus states.
- Controls are keyboard reachable.
- Practical touch targets are 44px where space allows.
- Charts and sparklines have `aria-label` or are explicitly hidden when decorative.
- Color is never the only cue for state or direction.
- Loading, empty, error, partial, and success states keep stable dimensions.
- Motion respects `prefers-reduced-motion` and the app reduced-motion setting.

## Not In Scope For The V1 Rollout

- Backend route, database, or API schema changes.
- Replit startup configuration changes.
- A full visual redesign of every screen.
- A global ban on green.
- A shared KPI/strip abstraction before repeated usage is proven across at least two screens.
