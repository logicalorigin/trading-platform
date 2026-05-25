# Footer Pressure Indicator — Replace Compact Tail With Mini Bar Cluster

## Context

The bottom-of-app pressure widget lives in `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`. It's anchored at the right edge of the desktop footer (`PlatformShell.jsx:1278`) and re-rendered in `MobileMoreSheet.jsx:306` on mobile.

Today, when `preferences.showCompactLabel === true`, the trigger button reads:

```
[ Memory   ████████░░░░  92%   Browser 412M · API 38% · API heap ]
```

The trailing text (`Browser {MB} · API {%} · {top driver}`) is information-dense but hard to scan. User wants it replaced with a **mini bar cluster** — three thin vertical bars (Browser RAM / API heap / Workload) colored by level — that **expands inline on hover** to reveal the same labels and values. The main `Memory + horizontal bar + %` portion stays unchanged, and the trigger button still opens the existing popover on click.

Intended outcome: a calm, system-tray-style indicator that reads at a glance and reveals detail on hover. Power users see three colored bars; hovering lifts the labels in place; clicking still opens the full popover.

---

## UI specification

### Where the change lands

Inside the existing `PopoverTrigger`'s `<button>` in `FooterMemoryPressureIndicator.jsx`. Today the children are:

1. `<span>Memory</span>` (label, line 316–327) — **keep**
2. `<span>` horizontal bar + fill (lines 328–353) — **keep**
3. `<span>{fillPercent}%</span>` (lines 354–364) — **keep**
4. `<span>` compact tail text (lines 365–380) — **replace** with `<MiniPressureBars>` (new sub-component, co-located)

Element #4 still gates on `preferences.showCompactLabel === true`. When the preference is OFF, no cluster renders, exactly like today's text tail.

### The new `<MiniPressureBars>` sub-component

Define inside `FooterMemoryPressureIndicator.jsx`, above `FooterMemoryPressureIndicator` (so it sits near `pressureTone` and the other module-private helpers).

**Signature:**
```jsx
const MiniPressureBars = ({ signal }) => { /* ... */ }
```

`signal` is the same object passed to `FooterMemoryPressureIndicator` (the memory-pressure signal with `pressureDrivers`, `browserMemoryMb`, `apiHeapUsedPercent`, `activeWorkloadCount`).

**Driver selection (fixed slots):**

Pick three drivers by `kind` from `signal.pressureDrivers` (full unfiltered list per `memoryPressureModel.js:378–403`):

| Slot | Driver kind         | Short label | Detail when expanded                                   |
|------|---------------------|-------------|--------------------------------------------------------|
| 1    | `"browser-memory"`  | `B`         | `Browser ${formatMetric(signal.browserMemoryMb, "M")}` |
| 2    | `"api-heap"`        | `A`         | `API ${formatMetric(signal.apiHeapUsedPercent, "%")}`  |
| 3    | `"workload"`        | `W`         | `Workload ${signal.activeWorkloadCount ?? 0}`          |

If a driver isn't present (shouldn't happen — they're always built), substitute `{ level: "normal", score: 0 }` so the bar still renders as a dim empty bar.

**Bar fill computation:**

```js
const barFillPercent = (driver) => {
  const score = Number(driver?.score);
  if (Number.isFinite(score)) {
    return Math.round(Math.min(100, Math.max(0, score)));
  }
  // Same fallback ladder as memoryPressureFillPercent (lines 36–49)
  return FALLBACK_SCORE_BY_LEVEL[driver?.level] ?? 0;
};
```

For Browser and API, prefer the underlying raw metric so the bar reads as a real percentage even at "normal" level:
- Browser: if `signal.browserMemoryMb` is finite, render as `Math.min(100, signal.browserMemoryMb / 600 * 100)` — 600 MB is the "watch" threshold reference; tune later if it feels off. Otherwise fall back to the driver's `score`.
- API: if `signal.apiHeapUsedPercent` is finite, use it directly (already 0–100). Otherwise driver `score`.
- Workload: always use driver `score`.

### DOM structure of the cluster

```
<span                                    // cluster root
  className="ra-pressure-mini-cluster"   // class drives hover-expand CSS
  data-cluster-expanded={hovered ? "true" : "false"}
  style={{ ...rootStyle }}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  onFocus={() => setHovered(true)}
  onBlur={() => setHovered(false)}
>
  {bars.map((bar) => (
    <AppTooltip key={bar.key} content={bar.detail}>
      <span                              // slot wrapper — sits in the row, holds bar + label
        className="ra-pressure-mini-slot"
        style={{ ...slotStyle }}
      >
        <span                            // the bar track (rounded rect, full height)
          aria-hidden="true"
          style={{ ...trackStyle(bar) }}
        >
          <span                          // the fill (bottom-up, animated)
            style={{ ...fillStyle(bar) }}
          />
        </span>
        <span                            // the label, hidden until expanded
          className="ra-pressure-mini-label"
          style={{ ...labelStyle(bar) }}
        >
          {bar.detail}
        </span>
      </span>
    </AppTooltip>
  ))}
</span>
```

Three slots, in order: Browser, API, Workload.

### Exact styles

All `dim()` / `sp()` / `textSize()` calls use the existing helpers from `uiTokens.jsx`. `pressureTone(level)` returns the CSS variable string (line 22–23 of the existing file).

```js
const CLUSTER_BAR_HEIGHT = 14;   // dim() applied
const CLUSTER_BAR_WIDTH = 3;
const CLUSTER_BAR_GAP = 3;
const CLUSTER_LABEL_GAP = 6;
const CLUSTER_PADDING_X = 4;

const rootStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: dim(CLUSTER_BAR_GAP),
  paddingLeft: dim(CLUSTER_PADDING_X),
  paddingRight: dim(CLUSTER_PADDING_X),
  marginLeft: sp(2),
  borderRadius: dim(RADII.sm),
  // Reserve enough width for the expanded form so the footer doesn't reflow
  // siblings on hover. Use min-width = collapsed width, max-width grows on hover.
  minWidth: dim(CLUSTER_BAR_WIDTH * 3 + CLUSTER_BAR_GAP * 2 + CLUSTER_PADDING_X * 2),
  height: dim(CLUSTER_BAR_HEIGHT + 4),
  alignSelf: "center",
  overflow: "hidden",
  whiteSpace: "nowrap",
};

const slotStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: dim(CLUSTER_LABEL_GAP),
  height: "100%",
};

const trackStyle = (bar) => ({
  position: "relative",
  display: "inline-block",
  width: dim(CLUSTER_BAR_WIDTH),
  height: dim(CLUSTER_BAR_HEIGHT),
  borderRadius: dim(RADII.xs),
  background: `${T.textMuted}1f`,         // same dim track as the main bar (line 336)
  overflow: "hidden",
  flexShrink: 0,
});

const fillStyle = (bar) => {
  const tone = pressureTone(bar.level);
  return {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: `${bar.fillPercent}%`,
    minHeight: bar.fillPercent > 0 ? 1 : 0,
    background: tone,
    opacity: 0.92,
    transition: "height 180ms ease, opacity 180ms ease",
  };
};

const labelStyle = (bar) => ({
  color: pressureTone(bar.level),
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: FONT_WEIGHTS.medium,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: 0,
  whiteSpace: "nowrap",
  // Label visibility is controlled by the parent cluster's [data-cluster-expanded]
  // attribute via CSS (see hover behavior). Inline default: hidden.
});
```

Levels feed `pressureTone` which already returns the four pressure CSS vars:
- `--ra-pressure-normal` (green-ish)
- `--ra-pressure-watch` (yellow)
- `--ra-pressure-high` (orange)
- `--ra-pressure-critical` (red)

### Hover-expand mechanics

Two-layer approach: React state for the `data-cluster-expanded` attribute (for testing + accessibility), CSS for the visual transition (so we get hardware acceleration and reduced-motion handling).

Add to `artifacts/pyrus/src/index.css` (near the existing `.ra-segmented-indicator` block, lines ~1184–1204):

```css
.ra-pressure-mini-cluster {
  /* width transition - lets the cluster grow inline when expanded */
  transition: max-width var(--ra-motion-standard) var(--ra-motion-ease);
  max-width: 22px; /* collapsed width: 3 bars + 2 gaps + 2 * 4 padding */
}

.ra-pressure-mini-cluster[data-cluster-expanded="true"] {
  max-width: 240px; /* expanded width: bars + 3 labels */
}

.ra-pressure-mini-label {
  opacity: 0;
  max-width: 0;
  overflow: hidden;
  transition:
    opacity var(--ra-motion-fast) var(--ra-motion-ease),
    max-width var(--ra-motion-standard) var(--ra-motion-ease);
}

.ra-pressure-mini-cluster[data-cluster-expanded="true"] .ra-pressure-mini-label {
  opacity: 1;
  max-width: 80px;
}

@media (prefers-reduced-motion: reduce) {
  .ra-pressure-mini-cluster,
  .ra-pressure-mini-label {
    transition: opacity var(--ra-motion-fast) var(--ra-motion-ease);
  }
}

html[data-pyrus-reduced-motion="on"] .ra-pressure-mini-cluster,
html[data-pyrus-reduced-motion="on"] .ra-pressure-mini-cluster,
html[data-pyrus-reduced-motion="on"] .ra-pressure-mini-label,
html[data-pyrus-reduced-motion="on"] .ra-pressure-mini-label {
  transition: opacity var(--ra-motion-fast) var(--ra-motion-ease);
}
```

React side (inside `MiniPressureBars`):

```jsx
const [hovered, setHovered] = useState(false);
```

Wire `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` on the cluster root to flip `hovered`. The cluster itself does **not** capture clicks — clicks bubble up to the `PopoverTrigger`'s `<button>`, which still opens the popover (preserving the existing click semantics).

### AppTooltip per bar

Wrap each slot in `<AppTooltip content={bar.detail}>` (already imported in adjacent files; use `@/components/ui/tooltip`). This is the keyboard-accessible path: focus on a slot via tab → tooltip surfaces the label. The inline expand is the mouse path.

### Edge cases

| Case                                       | Behavior                                                                                              |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `signal` is `null`/`undefined`             | Cluster renders nothing. Match the existing guard pattern in `FooterMemoryPressureIndicator`.         |
| Driver missing from `pressureDrivers`      | Substitute `{ level: "normal", score: 0 }`. Bar renders empty with normal-toned (faint) track.        |
| Metric value `null` (e.g., browserMemoryMb)| Use driver `score` fallback; detail text shows `Browser --` via `formatMetric` (handles non-finite).  |
| `signal.pressureDrivers` is empty array    | All three slots substitute the normal/0 placeholder. Cluster still renders three faint empty bars.    |
| Reduced motion                             | CSS overrides above kill the width transition; only opacity fades.                                    |
| Focus then hover then leave hover          | `hovered` stays `true` while focused (focus drives expansion too); blur returns to collapsed.         |

### Data-testid hooks

For the updated/added test (see Tests section):

- Cluster root: `data-testid="footer-memory-pressure-mini-cluster"`
- Each slot: `data-testid="footer-memory-pressure-mini-slot-{browser|api|workload}"`
- Each bar fill: `data-testid="footer-memory-pressure-mini-fill-{browser|api|workload}"` (or read computed style if simpler)

---

## Files to modify

### 1. `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`

- Add `MiniPressureBars` sub-component near the existing helpers (after line ~85, before `sectionStyle`).
- Replace the compact-tail `<span>` block (lines 365–380) with `{preferences.showCompactLabel ? <MiniPressureBars signal={signal} /> : null}`.
- No other code paths change (`buildTitle`, `LevelPill`, the popover, the click→open behavior all stay).

### 2. `artifacts/pyrus/src/index.css`

- Add the four CSS blocks above (`.ra-pressure-mini-cluster`, `.ra-pressure-mini-label`, and the two reduced-motion overrides) near `.ra-segmented-indicator` (lines ~1184–1204).

### 3. Test file (new or updated)

- Look for existing tests touching this component:
  - `grep -rln "FooterMemoryPressureIndicator" artifacts/pyrus/src` to find the test file.
  - If a test exists that asserted the old `Browser … · API …` text: update those assertions. Search the test for `Browser ` and `· API` substrings.
  - If no test file exists yet, create `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.test.js`.
- New assertions:
  1. When `signal.pressureDrivers` includes browser/api/workload entries and `preferences.showCompactLabel === true`, the trigger contains `data-testid="footer-memory-pressure-mini-cluster"`.
  2. Three slots render with `data-testid` of `…-mini-slot-browser`, `…-mini-slot-api`, `…-mini-slot-workload`.
  3. Each slot's fill height matches the computed `fillPercent` for that driver.
  4. Each slot's tooltip content matches the expected detail string (`Browser 412M`, `API 38%`, `Workload 4` for the seeded signal).
  5. When `preferences.showCompactLabel === false`, the cluster is not rendered.
  6. Hovering the cluster (simulate `mouseenter`) flips `data-cluster-expanded` from `"false"` to `"true"`.

---

## Reuse, don't reinvent

- `pressureTone(level)` / `pressureBorder` / `pressureBackground` — lines 22–29. Use for bar tone + (optional) ambient tinting.
- `formatMetric` — line 31–32. Use for detail text formatting (handles non-finite as `"--"`).
- `memoryPressureFillPercent` / `FALLBACK_SCORE_BY_LEVEL` — lines 36–49. Use the same fallback ladder so the cluster matches the main bar's behavior when score is missing.
- `useMemoryPressurePreferences` (already wired) — gates the cluster on `showCompactLabel`. **No new preference key.** Reuse the existing one so the user's existing toggle continues to control visibility.
- `AppTooltip` from `@/components/ui/tooltip` — for per-bar accessibility tooltip.
- `T` tokens (`T.textMuted`, `T.bg2`, etc.), `dim()`, `sp()`, `textSize()`, `RADII`, `FONT_WEIGHTS` — from `uiTokens.jsx`.

---

## Tradeoffs

- **Fixed three slots** (Browser / API / Workload) instead of dynamic top-3 keeps layout stable but hides `chart-hydration` / `query-cache` / `runtime-stores`. They remain visible in the popover. Acceptable: those three are diagnostic-grade, not at-a-glance signals.
- **Hover-expand uses local state, not a Radix popover.** The expanded text isn't a discrete focusable element; the per-bar `AppTooltip` covers keyboard access.
- **Cluster expands inline, growing the trigger's width.** Footer siblings to the left are flex with `marginLeft: "auto"` on this group (`PlatformShell.jsx:1266`), so the cluster grows leftward without reflowing the version label. Verify on small screens; the existing trigger already has `maxWidth: "min(58vw, 430px)"` (line 313) which still applies.
- **600 MB heuristic for the Browser bar's `%`** (when raw MB is available) is a guess. If the thresholds in `memoryPressureModel.js` are easily readable, prefer `browserThresholds.high` from there as the ceiling reference. Implementer should check before hard-coding.

---

## Verification

1. **Type + tests + build**
   - `pnpm --filter @workspace/pyrus typecheck`
   - `pnpm --filter @workspace/pyrus test:unit` — new/updated indicator test passes.
   - `pnpm --filter @workspace/pyrus build`

2. **Manual** (via Replit's Run Replit App entry, per CLAUDE.md)
   - Open the platform; locate the right edge of the footer.
   - With `showCompactLabel = true` (Settings → Memory pressure preferences): three thin vertical bars sit to the right of the `92%`. Hover the cluster — bars stay where they are; labels (`Browser 412M`, `API 38%`, `Workload 4`) fade in to the right of each bar over ~180ms.
   - Move cursor away — labels fade out; cluster collapses back to bare bars.
   - Tab into the cluster (keyboard focus) — `AppTooltip` reveals the same detail per bar.
   - With `showCompactLabel = false`: cluster does not render; main `Memory + bar + %` looks identical to before.
   - Click anywhere on the trigger — popover still opens with all six driver rows.
   - Trigger high pressure (open many heavy panels, or simulate via diagnostics): individual bars change color via `--ra-pressure-watch/high/critical` as their drivers cross thresholds.
   - Light + dark theme: confirm `pressureTone` tokens flow correctly in both.
   - `data-pyrus-reduced-motion="on"` on `<html>`: width transition disappears; opacity-only fade remains.

3. **Replit startup guard** — no `.replit` / artifact-dev-script changes, so `pnpm run audit:replit-startup` is not required.
