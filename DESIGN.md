# PYRUS Design Doctrine

PYRUS is a calm live trading workspace. Screens should help a trader scan market state, trust data freshness, and act on anomalies without decoding decorative UI.

## Source Of Truth

This document is the master design contract. When implementation, old audit notes, screenshots, or one-off screen styles disagree, use this order:

1. The semantic and interaction rules in this document.
2. Shared tokens in `src/lib/uiTokens.jsx`, CSS variables in `src/index.css`, and shared primitives in `src/components`.
3. The current production patterns on recently migrated Market, Trade, Signals, Account, and Algo surfaces.
4. A screen-specific exception recorded in this document or beside the implementation.

Old audit rounds are evidence, not authority. Reproduce a finding against the current app before changing it. A visual exception is intentional only when it protects trading meaning, data density, or a stable interaction—not because a legacy screen already does it.

The visual baseline is a neutral instrument panel: IBM Plex Sans for interface language and values, flat neutral surfaces, hairline separation, restrained elevation, and semantic color. Dark and light themes are equal products and must share the same hierarchy.

## Workspace Frame And Chrome

The shell is a persistent trust frame, not another dashboard:

- Desktop uses the app header, compact live-status rows, a left watchlist rail, one primary workspace, an optional right Algo monitor, and the narrow context footer.
- Tablet keeps desktop navigation, collapses the Algo monitor to its launcher, and must preserve the primary workspace without document-level horizontal overflow.
- Phone replaces side rails with drawers and a five-item bottom navigation. Status rows may stack, but screen content must remain the dominant vertical read.
- Account source selectors on phone use compact 64px single-row controls: broker mark and identity first, then NLV and Day when present. Missing metrics do not reserve empty space, and the selector must not push the primary account read below the fold.
- The watchlist stays available as cross-screen symbol context. Full rename, delete, sort, filter, selection, and add chrome is shown only where symbol curation is part of the screen job. Account, Research, Algo, Backtest, Diagnostics, and Settings use a passive watchlist rail until the user returns to a symbol workspace.
- The Algo monitor may remain visible as operational context. It must be user-collapsible and may not duplicate the primary Algo screen's status or action.

Chrome must never out-shout the primary read. At every supported width, allocate space in this order: primary decision surface, required context, optional management controls.

## Typography And Density

PYRUS is intentionally denser than a consumer app, but density is authored rather than achieved by shrinking everything equally.

- Interface labels and values use IBM Plex Sans. Prices, quantities, timestamps, ratios, and compact machine state retain their semantic data role and use tabular numerals.
- Screen title, section title, panel title, body, caption, label, table header, and micro roles remain visually distinct. Use the shared type scale; do not invent a local one.
- Small terminal labels are an intentional exception to general consumer sizing. Because many roles are 7–11px, every normal-sized text token must meet at least WCAG AA 4.5:1 contrast on every surface where it is allowed.
- Abbreviations require a tooltip, expanded label, or surrounding context. A row of equal-weight acronyms is not a primary summary.
- Values carry the strongest weight; labels and metadata recede without becoming illegible.

## Surfaces And Elevation

- `surface-0` is the page/workspace, `surface-1` is a panel, and `surface-2` is a focused or nested tool surface. Higher tiers are reserved for interaction states, not arbitrary section nesting.
- Prefer full-width bands, dividers, and whitespace over card mosaics. Never place a decorative card inside an already framed card.
- Borders are hairlines. Shadows communicate true elevation: menus, dialogs, drawers, tooltips, floating inspectors, or a focused tool. Static page sections do not need shadows.
- Chart frames, repeated records, dialogs, and genuinely bounded tools may be cards. A section that exists only to promise future content must not render.
- Loading and empty content is flat inside its owning frame. Do not float a second bordered placeholder over a bordered chart.

## Interaction And Motion

- Reuse canonical Button, Badge/StatusPill, StatTile, tabs, form controls, dialogs, and loading primitives before adding screen-local variants.
- Every clickable element is a native control where practical. Otherwise it needs the correct role, keyboard activation, accessible name, and visible focus state.
- Desktop controls meet the 24px minimum target. Touch layouts use 44px targets where space allows; dense chart controls may group into an overflow menu instead of shrinking below the floor.
- A width change must not convert an open desktop management panel into a blocking tablet/phone sheet. Narrow-layout drawers and sheets start closed and open only from an explicit user action.
- Motion is brief and causal: hover/focus feedback, a one-shot panel entrance, value-change feedback, or a direct state transition. Use the shared fast/standard/slow tokens.
- Continuous motion is reserved for explicit loading or a live process whose progress is otherwise invisible. Data-visualization decoration does not loop. Selection or hover may temporarily animate a relationship, and all motion respects both reduced-motion channels.
- Tooltips explain icons and abbreviations; they do not carry information required to complete the task.

## Semantic Color Rules

Color must describe meaning, not mood.

- Directional market intent uses blue for buy, call-side, bullish, long, inflow pressure, and red for sell, put-side, bearish, short, outflow pressure.
- Financial outcome uses green for positive P&L, positive return, gain, and red for negative P&L, negative return, loss.
- Operational health uses green for healthy, live, connected, configured, synced; amber for stale, pending, delayed, degraded, limited; red for error, unavailable, failed, blocked, offline.
- Risk and attention use amber for watch/elevated and red for priority/danger.
- Neutral metadata uses muted text and border tones.

Semantic foregrounds and visualization hues are related but not interchangeable. Text-safe light-theme foregrounds must keep 4.5:1 contrast; a chart may use a brighter companion hue when it is not carrying text. Color always has a word, sign, shape, position, or icon cue.

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

Trading Analysis is an Account performance brief, not a KPI-card mosaic. Net P&L and its cumulative closed-trade curve are the primary read; expectancy, win rate, profit factor, and max drawdown are the decision set; activity, cost, and risk ratios form a compact secondary ledger. Evidence notes and asymmetric pattern analysis follow that hierarchy, while the Patterns/Trades switch, range, and phone filter entry stay together in the scope toolbar.

On phone, the complete performance read must fit before secondary pattern detail, range selection remains interactive, secondary evidence can use a closed native disclosure, and all primary controls use 44px touch targets. Missing or privacy-masked financial values must not leak through chart axes, tooltips, labels, or accessible summaries.

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

Normal use does not need a long storyboard. Trust-priority anomalies do:

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

## Responsive Authority

Phone, tablet, and desktop are semantic viewport classes. Their canonical conditions come from `src/lib/responsive.ts`:

| Class | Canonical viewport condition |
|-------|------------------------------|
| Phone | `width > 0 && width < 768` |
| Tablet | `width >= 768 && width < 1024` |
| Desktop | `width >= 1024` |

A viewport width of 0 or less is unknown or not yet measured, so all semantic flags are false. `BREAKPOINTS` and `responsiveFlags` implement the shared boundaries; `useViewport().flags` and named `useViewportBelow` calls apply them to the viewport. Routes that need a semantic device class must consume those viewport results instead of inventing phone, tablet, or desktop boundaries.

Measured-container exceptions are local layout adaptations. A component may use its measured content width to tighten a header, collapse a rail, reduce chart density, or change grid columns. Even when `responsiveFlags` reuses the shared boundary math for that width, its result describes only the local layout and must never redefine the semantic phone, tablet, or desktop flags. Route-specific thresholds must be named and consumed for their local effect and must not create a competing device class or drive global shell, navigation, or input semantics.

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

Supported conformance widths are 390×844, 768×1024, and 1440×900. A screen is not responsive merely because the document has no overflow: its primary read must remain visible, controls must keep meaningful labels, and persistent chrome must not consume the useful workspace.

## Conformance Review

Every design-conformance pass must:

1. Inspect Login, boot/loading, every registered product screen, and at least one error boundary.
2. Cover dark and light themes at phone, tablet, and desktop widths.
3. Wait for the requested screen host and route-level loading boundaries to resolve before capturing evidence.
4. Check hierarchy, typography, semantic color, surface nesting, spacing, responsive allocation, keyboard access, focus, touch targets, loading/empty/error/stale states, and reduced motion.
5. Record confirmed gaps, resolved/stale audit findings, and intentional exceptions. Do not carry old findings forward without reproduction.
6. Fix shared causes before local symptoms, add a deterministic guard where the rule can be expressed in code, and capture before/after evidence.

The automated design guard verifies CSS/JavaScript theme parity, normal-text contrast, accent foreground contrast, and the required doctrine sections. Browser QA remains required for relationships that cannot be reduced to tokens.

## Not In Scope For The V1 Rollout

- Backend route, database, or API schema changes.
- Replit startup configuration changes.
- A full visual redesign of every screen.
- A global ban on green.
- A shared KPI/strip abstraction before repeated usage is proven across at least two screens.
