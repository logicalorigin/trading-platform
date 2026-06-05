# Algo Monitor Sidebar — Rebuild the "Activity" Section as Signals → Actions

## Context

The Algo Monitor sidebar (`artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx`) is a five-section card that lives on the right of the platform shell:

1. Deployment badge (name, mode, account, status orb)
2. Overview metrics grid (Scan / Event / Intake / Risk / Exposure / P&L / Record)
3. **Intake** — pipeline stages + attention strip
4. **Positions** — 5 most recent open algo positions
5. **Performance** — Realized / Win / Expect
6. **Activity** — 6-event horizontal strip via `OperationsTransitionsStrip` (lines 621–637)

The **Activity** section is the user-visible "Signals to Actions" surface today, but it's a strip of small one-liners — `HH:MM:SS  SPY entry_executed` — fed only from execution events. It hides the actual signal→action causality the section is supposed to convey: which signal fired, what action was mapped, what state that action is in, whether it filled. The richer signal+candidate data is already loaded into the sidebar (`automationStateQuery.data.candidates`) but unused. The full `OperationsSignalRow.jsx` (1849 lines) in `AlgoLivePage` renders this perfectly but is far too dense for a sidebar.

Intended outcome: rename "Activity" to **"Signals → Actions"** and replace the 6-event strip with a vertical stack of ~4 **mini-cards**, one per recent signal candidate. Each card shows: symbol + direction glyph (left rail), action label + status pill (right), signal age + freshness tone (left rail tint), and a secondary line with contract/premium. Clicking a card navigates to the Algo Live page (with the signal pre-focused if the navigation contract supports it).

---

## UI specification

### Section title and meta

Replace `<Section title="Activity" meta={...}>` (line 621) with:

```jsx
<Section title="Signals → Actions" meta={`${rows.length}/${candidates.length}`}>
```

Meta reads as "4/27" — "we're showing 4 of 27 candidates". Reuses the existing `Section` component (lines 105–125), no changes there.

### Row data: pair signal + candidate

Source: `automationState?.candidates` (already loaded at `automationStateQuery.data`, referenced at line 355). Pair as `{ signal: candidate.signal, candidate }` (matching the existing convention in `OperationsSignalTable.jsx:108–117`).

Sort by `rowActivityTimestampMs(row)` descending (reuse the helper from `OperationsSignalTable.jsx:111–117` — import it or inline the equivalent). Take the first **4** rows. If the candidates list is empty, fall back to a `DataUnavailableState` with `title="No active signals"` matching the empty-state pattern already in the file.

### Card layout (per row)

```
┌────────────────────────────────────────────────────────┐
│ ▎  ▲   SPY                  LONG_CALL  [PENDING]       │
│ ▎          2m · 0DTE 580C   $2.5K · spread 4.2%        │
└────────────────────────────────────────────────────────┘
 ^   ^   ^                    ^          ^
 │   │   │                    │          └─ status pill
 │   │   │                    └─ action label (uppercase)
 │   │   └─ symbol (T.text, label weight)
 │   └─ BigDirectionGlyph (existing primitive)
 └─ freshness rail (1.5px wide, tinted by age)
```

- **Card root:** `<button>` element so click navigates and keyboard focus works.
  - `display: grid; gridTemplateColumns: 6px auto 1fr auto; gap: sp(4); padding: sp("6px 8px"); minHeight: dim(52); maxHeight: dim(64); borderRadius: dim(RADII.sm); border: 1px solid T.border; background: T.bg2; cursor: pointer;` with the `ra-interactive` className for the hover affordance and `ra-focus-rail` for keyboard focus ring.
  - Width: 100% of the section's content area.

- **Freshness rail (column 1):** 1.5px-wide vertical span, full card height, tinted by age:
  - `age < 60s` → `T.green`
  - `60s ≤ age < 5m` → `T.cyan`
  - `5m ≤ age < 30m` → `T.textSec`
  - `age ≥ 30m` → `T.textDim`
  - Use `rowActivityTimestampMs(row)` for "age" reference, comparing to `Date.now()`.

- **Direction glyph (column 2):** `<BigDirectionGlyph direction={signal.direction} size={14} />` from `artifacts/pyrus/src/screens/algo/BigDirectionGlyph.jsx`. Tone follows direction; reuse without changes.

- **Main content (column 3, two lines):**
  - Line 1: `<span>{symbol}</span>` + spacer + `<span>{actionLabel}</span>`.
    - `actionLabel = signalActionLabel(signal, candidate)` from `algoHelpers.js:289`.
    - Symbol style: `color: T.text; fontFamily: T.sans; fontSize: textSize("body"); fontWeight: FONT_WEIGHTS.medium;`
    - Action label style: `color: T.textSec; fontFamily: T.sans; fontSize: textSize("caption"); letterSpacing: "0.04em"; textTransform: "uppercase"; fontWeight: FONT_WEIGHTS.medium;`
  - Line 2 (detail): relative age + contract + premium/spread. Use small text:
    - `color: T.textDim; fontFamily: T.sans; fontSize: textSize("caption"); lineHeight: 1.3;`
    - Content: `${formatRelativeTimeShort(signalAt)} · ${contractLabel} · ${premium} · spread ${spreadPct}`
    - Source the contract via `formatOptionContractLabel` (already imported at line 26) on `candidate.selectedContract`. Premium via `candidate.orderPlan?.premiumAtRisk`. Spread via `candidate.liquidity?.spreadPctOfMid` or the fallback chain in `OperationsSignalTable.jsx:172–190`.
    - If any field is `null`, drop it from the joined string — no `MISSING_VALUE` placeholders cluttering the line.

- **Status pill (column 4):** Reuse the existing `Pill` from `accountUtils.jsx` or `primitives.jsx`. Tone derived from `candidate.actionStatus` via `signalOptionsActionColor(actionStatus)` (existing helper from `algoHelpers.js`). Label via `signalOptionsActionLabel(actionStatus)` (e.g., `PENDING`, `EXECUTED`, `FAILED`, `SKIPPED`).
  - Styles: keep the existing `Pill` defaults; just wire the tone.

### Click behavior — navigate to Algo Live with pre-focus

Extend the `onOpenAlgo` callback contract to optionally accept a focus payload:

```js
// Existing call (line 1185 in PlatformShell.jsx): onOpenAlgo={() => handleSetScreen("algo")}
// New: onOpenAlgo accepts an optional { signalKey, symbol } argument
onOpenAlgo={(focus) => handleSetScreen("algo", focus)}
```

In the sidebar, the card's `onClick` calls `onOpenAlgo?.({ signalKey: signal?.signalKey, symbol: signal?.symbol })`.

**Pre-focus wiring (best-effort):** if `handleSetScreen` and the Algo Live page support a focus prop or URL state, thread the payload through. If not, the row click still navigates (just without pre-focus); add a TODO comment and ship the navigation. Don't get stuck on the pre-focus plumbing.

### Empty / loading states

- **No candidates available:** `<DataUnavailableState title="No active signals" detail="Signal candidates appear after the next scan." minHeight={86} />` — mirrors the existing empty state in the Positions section (line 597–601).
- **Loading:** the parent already gates on `loading` (line 466) before rendering the sections, so no per-section skeleton needed.

### Row count + truncation

- Show up to **4 rows**. Beyond that, do not paginate — the section caps at 4. The `meta` chip surfaces the total candidate count for context (`"4/27"`).
- If fewer than 4 candidates exist, render only what's available; the section grows to fit its rows, not the other way around.

---

## Files to modify

### 1. `artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx` (the main change)

- **Remove:** the `eventTransitions` derivation (lines 458–464). Execution events stay loaded for the Event metric tile (`latestEvent` at line 336) — only the transitions mapping goes.
- **Remove:** the `<OperationsTransitionsStrip>` invocation inside the Activity section (lines 624–628). Keep the import only if used elsewhere; otherwise drop the `OperationsTransitionsStrip` import (line 45).
- **Add:** a `SignalActionRow` sub-component (inside this file, ~70 LOC) implementing the card spec above. Co-locate near `PositionTile` (line 203).
- **Add:** a memo'd `signalActionRows` derivation that:
  - Reads `automationState?.candidates`
  - Maps each to `{ signal, candidate }` matching the `OperationsSignalTable` row shape
  - Sorts by `rowActivityTimestampMs` desc
  - Slices to 4
- **Replace** the existing Activity section (lines 621–637) with:
  ```jsx
  <Section
    title="Signals → Actions"
    meta={`${signalActionRows.length}/${candidates.length}`}
  >
    {signalActionRows.length ? (
      <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
        {signalActionRows.map((row) => (
          <SignalActionRow
            key={row.candidate?.id || row.signal?.signalKey}
            row={row}
            onOpenAlgo={onOpenAlgo}
          />
        ))}
      </div>
    ) : (
      <DataUnavailableState
        title="No active signals"
        detail="Signal candidates appear after the next scan."
        minHeight={86}
      />
    )}
  </Section>
  ```

### 2. `artifacts/pyrus/src/features/platform/PlatformShell.jsx`

- Update the `onOpenAlgo` definition at line 1025 (and the sidebar invocation at line 1185) to accept the optional focus payload: `onOpenAlgo={(focus) => handleSetScreen("algo", focus)}`. If `handleSetScreen` already supports a second arg, this is a single-line change; if not, add the arg and thread it through to the next screen's state.

### 3. `artifacts/pyrus/src/features/platform/MobileActivitySheet.jsx`

- Same `onOpenAlgo` wiring update at line 34. No other changes — the sidebar component is shared, so the mobile sheet inherits the new section automatically.

### 4. Tests

- Look for `PlatformAlgoMonitorSidebar.validation.*`:
  ```
  grep -rln "PlatformAlgoMonitorSidebar" artifacts/pyrus/src
  ```
- If a test asserts on the old Activity section's strip content, update it.
- Add a new test (or extend) asserting:
  1. When `automationState.candidates` is non-empty, the sidebar renders `<Section title="Signals → Actions">` with up to 4 `SignalActionRow` instances.
  2. Each row's accessible name includes the symbol + action label.
  3. Clicking a row invokes `onOpenAlgo` with `{ signalKey, symbol }`.
  4. When candidates are empty, the `DataUnavailableState` with title `"No active signals"` renders.

---

## Reuse, don't reinvent

- **`BigDirectionGlyph`** — `artifacts/pyrus/src/screens/algo/BigDirectionGlyph.jsx`. Direction-aware glyph + tone. Drop it in the row's column-2.
- **`signalActionLabel(signal, candidate)`** — `algoHelpers.js:289`. The canonical action-label formatter. Reuse for the row's action span.
- **`signalOptionsActionLabel(status)` + `signalOptionsActionColor(status)`** — `algoHelpers.js:326` and adjacent. Drive the status pill's text + tone.
- **`rowActivityTimestampMs(row)`** — `OperationsSignalTable.jsx:111–117`. Reuse for sort + age. Export from `OperationsSignalTable.jsx` if it's not already exported, OR copy the 6-line helper into the sidebar file with a comment pointing to the source.
- **`formatRelativeTimeShort`** — already imported at line 27. Use for the line-2 age text.
- **`formatOptionContractLabel`** — already imported at line 26. Use for the contract chip.
- **`Pill`** — from `accountUtils.jsx` (existing primitive). Use for the status pill.
- **`DataUnavailableState`** — already imported at line 23. Use for the empty state.
- **`Section`** — defined locally at line 105. Reuse, just change the title + meta.

---

## Tradeoffs

- **Drops the execution-event strip entirely.** Users lose the "what just executed" timeline view in the sidebar. Mitigations: (1) the **Event** overview metric tile (line 386–393) already shows the latest event time; (2) the **Positions** section shows what's currently filled; (3) Open Algo → AlgoLivePage has the full event list. If users miss the strip we can add it back as a collapsed-by-default "Recent events" disclosure below "Signals → Actions" later.
- **Sidebar gains height.** Up to 4 mini-cards × ~58px = ~232px for this section (vs ~24px for today's strip). Verify the sidebar still scrolls cleanly with the rest of the content; the Card root already sets `overflowY: "auto"` (line 479), so no layout break expected.
- **Click-to-navigate requires `handleSetScreen` to accept a focus payload.** If it doesn't and the Algo Live page can't honor pre-focus, navigation still works (just lands on the page without pre-selection). Acceptable per user direction; flag for follow-up.
- **No drill popover.** Per user, drill = navigation. Loses some sidebar context but keeps the implementation small.

---

## Verification

1. **Type + tests + build**
   - `pnpm --filter @workspace/pyrus typecheck`
   - `pnpm --filter @workspace/pyrus unit validation`
   - `pnpm --filter @workspace/pyrus build`

2. **Manual** (per CLAUDE.md, use Replit's Run Replit App entry)
   - Open the platform with an enabled shadow algo deployment.
   - Confirm the sidebar's previously-titled "Activity" section now reads **"Signals → Actions"** with a `4/N` meta.
   - With candidates present: 4 mini-cards, each with direction glyph, symbol, action label, status pill, age + contract + premium line, and a colored freshness rail on the left edge.
   - Hover a card — `ra-interactive` hover affordance fires; click — navigates to Algo Live; if pre-focus wiring landed, that signal should be highlighted.
   - Trigger a stale state (no candidates): empty state renders.
   - Toggle light / dark theme: tones via `T.green`, `T.cyan`, `T.textSec`, `T.textDim` flow correctly.
   - Mobile: open `MobileActivitySheet` — the same section renders inside the sheet.

3. **Replit startup guard** — no `.replit` / artifact-dev-script changes; `pnpm run audit:replit-startup` not required.
