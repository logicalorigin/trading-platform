# Migration Plan: JS Proxy Colors → CSS Variables (Single Source of Truth)

> Hand-off for Codex. Read sections in order. Each phase is one PR. Each PR has acceptance criteria. Do not skip Phase 0.

---

## 1. Context

`artifacts/pyrus` currently resolves theme-varying colors through two parallel paths:

- **JS proxy `T`** in `artifacts/pyrus/src/lib/uiTokens.jsx` — reads the current theme from a JS global (`CURRENT_THEME`) and returns a hex string. Consumed by ~85 files as inline style props (`style={{ background: T.bg0 }}`).
- **CSS variables** in `artifacts/pyrus/src/index.css` — declared under `:root` (dark default) and `:root[data-pyrus-theme="light"]` override. Consumed by CSS classes and some inline styles (~17 files already).

When the theme is toggled, the JS path flips with the React re-render tick; the CSS path flips when a `useEffect` mutates `document.documentElement.dataset.pyrusTheme`. The two paths land on different frames, producing visible staggered "clunky" transitions. Memoized components on the JS path also cache stale hex values until a re-render is forced.

**Goal:** make CSS variables the single source of truth for all theme-varying colors. All inline-style consumers read `var(--ra-*)` strings. The JS proxy retains typography/density helpers but stops returning hex strings for color tokens.

**Result:** theme swaps become a single browser repaint driven by one selector match. No staggered updates, no stale colors, no re-renders required.

---

## 2. Scope & non-goals

**In scope:**
- All inline-style color reads from `T.<colorKey>` in `artifacts/pyrus/src/`
- All hex+alpha string concatenations (` `${T.X}14` `) used in inline styles
- Helper functions whose return value is a `T.<color>` tone (e.g., `spreadGaugeTone`, `getTone`, `pressureTone`, `automationStopTone`, `bridgeRuntimeModel` tones)
- Tests that pin specific hex values returned by `T` or by tone helpers

**Out of scope — DO NOT change:**
- Typography keys on `T`: `T.sans`, `T.display`, `T.data`, `T.code`, `T.mono` — these are font-family stacks, leave alone
- Scale/density helpers: `fs()`, `dim()`, `sp()`, `textSize()` — not colors
- Other artifacts in the workspace (`api-server`, `ibkr-bridge`, etc.) — backend, no UI colors
- Backend handoff docs, scripts, migrations — colors only live in `artifacts/pyrus`
- Tailwind directives — no theme palette overrides

---

## 3. Vocabulary & conventions

### 3.1 Naming convention

CSS variables already follow `--ra-<category>-<modifier>`. **Use existing variable names — do not invent new ones unless filling a gap (see Phase 0).**

Authoritative mapping `T.<key>` → CSS variable (verified in `index.css`):

| T key | CSS variable |
|---|---|
| `T.bg0` | `var(--ra-surface-0)` |
| `T.bg1` | `var(--ra-surface-1)` |
| `T.bg2` | `var(--ra-surface-2)` |
| `T.bg3` | `var(--ra-surface-3)` |
| `T.bg4` | `var(--ra-surface-4)` |
| `T.border` | `var(--ra-border-default)` |
| `T.borderLight` | `var(--ra-border-light)` |
| `T.borderFocus` | `var(--ra-border-focus)` |
| `T.text` | `var(--ra-text-primary)` |
| `T.textSec` | `var(--ra-text-secondary)` |
| `T.textDim` | `var(--ra-text-dim)` |
| `T.textMuted` | `var(--ra-text-muted)` |
| `T.accent` | `var(--ra-color-accent)` |
| `T.blue` | `var(--ra-blue-500)` |
| `T.purple` | `var(--ra-purple-500)` |
| `T.cyan` | `var(--ra-cyan-500)` |
| `T.pink` | `var(--ra-pink-500)` |
| `T.green` | `var(--ra-green-500)` |
| `T.red` | `var(--ra-red-500)` |
| `T.amber` | `var(--ra-amber-500)` |
| `T.pulseLive` | `var(--ra-green-500)` |
| `T.pulseAlert` | `var(--ra-amber-500)` |
| `T.pulseLoss` | `var(--ra-red-500)` |

Tokens missing a CSS variable (added in Phase 0):

| T key | New CSS variable |
|---|---|
| `T.accentDim` | `var(--ra-accent-dim)` |
| `T.accentHoverBg` | `var(--ra-accent-hover-bg)` |
| `T.accentActiveBg` | `var(--ra-accent-active-bg)` |
| `T.greenDim` | `var(--ra-green-dim)` |
| `T.greenBg` | `var(--ra-green-bg)` |
| `T.redDim` | `var(--ra-red-dim)` |
| `T.redBg` | `var(--ra-red-bg)` |
| `T.amberDim` | `var(--ra-amber-dim)` |
| `T.amberBg` | `var(--ra-amber-bg)` |
| `T.onAccent` | `var(--ra-on-accent)` |

### 3.2 Pattern catalog

**Pattern A — plain color swap (most common, ~70% of sites):**

```jsx
// Before
style={{ background: T.bg0, color: T.text, border: `1px solid ${T.border}` }}

// After
style={{
  background: "var(--ra-surface-0)",
  color: "var(--ra-text-primary)",
  border: "1px solid var(--ra-border-default)",
}}
```

**Pattern B — hex + alpha string concatenation:**

`color-mix(in srgb, <color> <alpha>%, transparent)` is already in use in the codebase (30+ CSS rules, 11+ JSX sites). Use it consistently.

```jsx
// Before
background: `${T.accent}14`              // 14 hex = 8% alpha
border: `1px solid ${T.green}28`         // 28 hex = 16% alpha
boxShadow: `inset 0 0 0 1px ${T.amber}24`  // 24 hex = 14% alpha

// After
background: "color-mix(in srgb, var(--ra-color-accent) 8%, transparent)"
border: "1px solid color-mix(in srgb, var(--ra-green-500) 16%, transparent)"
boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--ra-amber-500) 14%, transparent)"
```

Hex-alpha → percent conversion (common values):

| Hex | Percent |
|---|---|
| `0d` | 5% |
| `12` | 7% |
| `14` | 8% |
| `18` | 10% |
| `1c` | 11% |
| `1f` | 12% |
| `24` | 14% |
| `28` | 16% |
| `2e` | 18% |
| `32` | 20% |
| `36` | 21% |
| `40` | 25% |
| `4d` | 30% |
| `66` | 40% |
| `80` | 50% |
| `99` | 60% |
| `b3` | 70% |
| `cc` | 80% |

General formula: `percent = round(parseInt(hex, 16) / 2.55)`.

**Pattern C — `colorWithAlpha(color, alpha)` helper call:**

The helper is currently defined locally in some files (e.g., `HeaderBroadcastScrollerStack.jsx`). Replace inline calls with `color-mix()`. If a file calls `colorWithAlpha` many times, extract a tiny local utility that returns the `color-mix()` string; otherwise inline it.

```jsx
// Before
border: `1px solid ${colorWithAlpha(tone, 0.36)}`,
background: colorWithAlpha(T.textSec, 0.08),

// After
border: `1px solid color-mix(in srgb, ${tone} 36%, transparent)`,
background: "color-mix(in srgb, var(--ra-text-secondary) 8%, transparent)",
```

Note: `tone` can be a `var(...)` string — `color-mix` works fine with CSS variable arguments. This is the migration path for dynamic tones (Pattern D).

After the final phase, delete unused `colorWithAlpha` declarations.

**Pattern D — dynamic / semantic colors (branched in JS):**

```jsx
// Before
const tone = isSell ? T.red : T.green;
<Icon color={tone} />

// After
const tone = isSell ? "var(--ra-red-500)" : "var(--ra-green-500)";
<Icon color={tone} />
```

If the tone is later used in a `color-mix()` (Pattern C), it stays a `var(...)` string — works identically.

For helpers (`spreadGaugeTone`, `getTone`, `pressureTone`, `automationStopTone`, etc.):

```js
// Before (src/components/platform/signal-language/tones.js)
export const getTone = (kind) => {
  if (kind === "buy") return T.green;
  if (kind === "sell") return T.red;
  if (kind === "warn") return T.amber;
  return T.textSec;
};

// After
export const getTone = (kind) => {
  if (kind === "buy") return "var(--ra-green-500)";
  if (kind === "sell") return "var(--ra-red-500)";
  if (kind === "warn") return "var(--ra-amber-500)";
  return "var(--ra-text-secondary)";
};
```

Update any test that asserts `getTone("buy") === T.green` to assert against the new string.

**Pattern E — SVG `fill` / `stroke` props:**

These work with `var()` directly. No special handling.

```jsx
// Before
<polygon fill={T.green} />
<line stroke={colorWithAlpha(T.textSec, 0.36)} />

// After
<polygon fill="var(--ra-green-500)" />
<line stroke="color-mix(in srgb, var(--ra-text-secondary) 36%, transparent)" />
```

If you need a single hex for compatibility (e.g., a canvas 2D context), keep the JS hex — but call this out in the PR description.

### 3.3 What NOT to change

- Inline `style={{ fontFamily: T.sans }}` — typography, not a color
- `motionVars({ accent: T.green })` — leave the JS call signature; if `accent` is then used inside a string template that goes into a style, that's where the migration happens (the template should produce a `var()` reference)
- Existing `var(--ra-*)` references in CSS or inline — they're already correct
- `@keyframes` in `index.css` — already CSS-only
- Storybook/test fixtures that exist for visual snapshots (none found, but if present in future, treat with care)

---

## 4. Phase 0 — Pre-flight (1 PR)

**Goal:** prepare infrastructure. No JSX changes.

### 4.1 Add missing CSS variables

In `artifacts/pyrus/src/index.css`, both the `:root` block (~line 5) and the `:root[data-pyrus-theme="light"]` block (~line 199), add:

Dark mode (in `:root`):
```css
--ra-accent-dim: #08284D;
--ra-accent-hover-bg: rgba(22, 139, 255, 0.12);
--ra-accent-active-bg: rgba(22, 139, 255, 0.22);
--ra-green-dim: #173A2A;
--ra-green-bg: rgba(46, 216, 137, 0.11);
--ra-red-dim: #451522;
--ra-red-bg: rgba(255, 48, 72, 0.12);
--ra-amber-dim: #42321A;
--ra-amber-bg: rgba(233, 185, 73, 0.12);
--ra-on-accent: #FFFFFF;
```

Light mode (in `:root[data-pyrus-theme="light"], :root[data-pyrus-theme="light"]`):
```css
--ra-accent-dim: #DCEBFF;
--ra-accent-hover-bg: rgba(11, 102, 216, 0.08);
--ra-accent-active-bg: rgba(11, 102, 216, 0.16);
--ra-green-dim: #D4EDE3;
--ra-green-bg: rgba(7, 128, 95, 0.09);
--ra-red-dim: #F7D7DD;
--ra-red-bg: rgba(217, 40, 64, 0.10);
--ra-amber-dim: #F4E6C7;
--ra-amber-bg: rgba(184, 117, 7, 0.10);
--ra-on-accent: #FFFFFF;
```

(Both accent presets — `pyrus`, `coral`, `amber`, `green`, `aurora` — override `--ra-color-accent` and a few related variables at the `:root[data-pyrus-accent-preset="..."]` selectors. If `--ra-accent-dim`/`--ra-accent-hover-bg`/`--ra-accent-active-bg`/`--ra-on-accent` should differ per accent preset, audit the preset blocks and add overrides. Default behavior: leave preset blocks unchanged — the new variables fall back to the `:root` values, which is acceptable as a starting point.)

### 4.2 Source guard

The repo currently has no ESLint config. Use the existing source-audit style in
`artifacts/pyrus/src/lib/uiTokens.test.js` instead:

- Count production `T.<colorKey>` reads under `artifacts/pyrus/src`.
- Exclude tests and generated research data.
- Pin the current migration baseline as an upper bound.

This lets each migration PR reduce the count without maintaining a huge
allowlist, while preventing the legacy color path from expanding during routine
work. After Phase 5, replace the upper-bound guard with a zero-read assertion.

### 4.3 Optional safety net (recommended)

Add a "snap-during-swap" workaround so the partially-migrated codebase still feels OK during migration:

```jsx
// In PlatformApp.jsx, near toggleTheme
const toggleTheme = useCallback(() => {
  const next = theme === "dark" ? "light" : "dark";
  document.documentElement.classList.add("ra-theme-swapping");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("ra-theme-swapping");
    });
  });
  setCurrentTheme(next);
  setTheme(next);
  userPreferences.patch({ appearance: { theme: next } });
}, [theme, userPreferences]);
```

In `index.css`:

```css
:root.ra-theme-swapping,
:root.ra-theme-swapping *,
:root.ra-theme-swapping *::before,
:root.ra-theme-swapping *::after {
  transition: none !important;
}
```

Remove in Phase 5 cleanup.

### 4.4 Acceptance criteria (Phase 0)

- `pnpm -F @workspace/pyrus typecheck` passes
- `pnpm -F @workspace/pyrus test:unit` passes
- New CSS variables resolve to documented values in both `:root` and light override (eyeball in DevTools)
- Source guard fails if production `T.<color>` debt expands

---

## 5. Phase 1 — Shared primitives (1 PR)

**Goal:** migrate the most leveraged primitive components. Every screen pulls from these.

### 5.1 Files

```
artifacts/pyrus/src/components/platform/primitives.jsx
artifacts/pyrus/src/components/platform/BottomSheet.jsx
artifacts/pyrus/src/components/platform/Drawer.jsx
artifacts/pyrus/src/components/platform/signal-language/ConfluenceChip.jsx
artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx
artifacts/pyrus/src/components/platform/signal-language/SpreadGauge.jsx
artifacts/pyrus/src/components/platform/signal-language/VerdictGlyph.jsx
artifacts/pyrus/src/components/platform/signal-language/tones.js
artifacts/pyrus/src/components/ui/Button.jsx
artifacts/pyrus/src/components/ui/tabs.jsx
artifacts/pyrus/src/components/ui/CockpitHeader.jsx
artifacts/pyrus/src/components/ui/Stat.jsx
artifacts/pyrus/src/components/ui/SectionHeader.jsx
artifacts/pyrus/src/components/ui/InfoTooltipIcon.jsx
artifacts/pyrus/src/components/ui/TablePagination.jsx
artifacts/pyrus/src/components/ui/PulseDot.jsx
```

### 5.2 Procedure

1. Apply Patterns A–E throughout each file.
2. For `signal-language/tones.js` — update `getTone` to return `var()` strings (Pattern D). Update its test in the same PR.
3. For each local `colorWithAlpha` definition that becomes dead code, delete it. If still used, keep it but update its callers to pass `var()` strings (it still produces a hex+alpha output — change its implementation to emit `color-mix()` for var inputs, or replace inline at call sites).
4. Leave non-color `T.*` reads (`T.sans`, etc.) alone.

### 5.3 Acceptance criteria

- All `T.<color>` reads in Phase 1 file list removed (grep returns zero)
- `pnpm -F @workspace/pyrus typecheck` passes
- `pnpm -F @workspace/pyrus test:unit` passes (update `tones.test.js` and any test asserting on these primitives)
- Manual visual smoke test: dark and light mode, key primitives render identically to baseline
- Theme toggle on a screen using primarily these primitives: no clunk on the migrated surfaces

---

## 6. Phase 2 — Cockpit shell & header (1 PR)

### 6.1 Files

```
artifacts/pyrus/src/features/platform/PlatformShell.jsx
artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx
artifacts/pyrus/src/features/platform/HeaderKpiStrip.jsx
artifacts/pyrus/src/features/platform/HeaderAccountStrip.jsx
artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx
artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx
artifacts/pyrus/src/features/platform/BloombergLiveDock.jsx
artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx
artifacts/pyrus/src/features/platform/LatencyDebugStrip.jsx
artifacts/pyrus/src/features/platform/MobileWatchlistDrawer.jsx
artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx
artifacts/pyrus/src/features/platform/marketIdentity.jsx
artifacts/pyrus/src/features/platform/bridgeRuntimeModel.js
```

### 6.2 Special notes

- `HeaderBroadcastScrollerStack.jsx` has many `${tone}0d`-style template literals (Pattern B) and a local `colorWithAlpha` (Pattern C). It's the densest file in the codebase for these patterns — budget time accordingly.
- `bridgeRuntimeModel.js` exports tone helpers consumed by `IbkrConnectionStatus.test.js`. Update both.
- `BloombergLiveDock.jsx` already uses `color-mix(in srgb, var(--ra-text-primary) ...)` in one place — mirror that style.
- The `motionVars({ accent })` calls pass colors into a helper that produces CSS custom property declarations (e.g. `--ra-motion-accent`). Pass `var(--ra-*)` strings instead of `T.*` hex; verify the resulting CSS custom-property values resolve correctly in DevTools.

### 6.3 Acceptance criteria

- All `T.<color>` reads in Phase 2 file list removed
- `IbkrConnectionStatus.test.js` updated and passing
- Theme toggle on the cockpit (header + lanes + watchlist + footer) is visually unified — no staggered flash
- Typecheck + tests pass

---

## 7. Phase 3 — Feature folders (3–5 PRs, one per feature)

Split by feature folder to keep PR scope reviewable.

### 7.1 Feature: `features/account/` (1 PR)

```
artifacts/pyrus/src/features/account/**/*.jsx
artifacts/pyrus/src/features/account/**/*.js
```

### 7.2 Feature: `features/trade/` (1 PR)

```
artifacts/pyrus/src/features/trade/**/*.jsx
artifacts/pyrus/src/features/trade/**/*.js
```

### 7.3 Feature: `features/market/` (1 PR)

```
artifacts/pyrus/src/features/market/**/*.jsx
artifacts/pyrus/src/features/market/**/*.js
```

### 7.4 Feature: `features/research/` (1 PR)

```
artifacts/pyrus/src/features/research/**/*.jsx
artifacts/pyrus/src/features/research/**/*.js
```

### 7.5 Feature: `features/algo/` (1 PR)

```
artifacts/pyrus/src/features/algo/**/*.jsx
artifacts/pyrus/src/features/algo/**/*.js
```

### 7.6 Procedure per feature PR

1. `grep -rn "T\.\(bg\|text\|border\|accent\|green\|red\|amber\|blue\|purple\|cyan\|pink\|on\|pulse\)" <feature-dir>` to enumerate sites
2. Apply Patterns A–E
3. Update any feature-local tests that assert on `T` values
4. Visual smoke test of the feature in dark and light mode
5. Typecheck + tests pass

### 7.7 Acceptance per feature PR

- Zero `T.<color>` reads remain in the feature folder
- Feature visible behavior unchanged (screenshots match or human review)
- Tests pass

---

## 8. Phase 4 — Screens (1–2 PRs)

Convert the `screens/` tree. Split into two PRs if size demands — `screens/algo/` is the largest candidate to isolate.

### 8.1 Files (representative)

```
artifacts/pyrus/src/screens/MarketScreen.jsx
artifacts/pyrus/src/screens/SettingsScreen.jsx
artifacts/pyrus/src/screens/DiagnosticsScreen.jsx
artifacts/pyrus/src/screens/AccountScreen.jsx
artifacts/pyrus/src/screens/algo/**
artifacts/pyrus/src/screens/account/**
artifacts/pyrus/src/screens/flow/**
artifacts/pyrus/src/screens/market/**
artifacts/pyrus/src/screens/trade/**
artifacts/pyrus/src/screens/research/**
```

### 8.2 Special notes

- `PositionsPanel.test.js` and `OperationsSignalRow.test.js` assert `tone === T.<color>`. Update these alongside the helper they exercise.
- `AccountScreen.jsx` and `SettingsScreen.jsx` are very long; consider splitting if Codex hits context limits.

### 8.3 Acceptance criteria

- Zero `T.<color>` reads remain in `screens/`
- Theme toggle on every screen looks consistent — no clunk
- All `screens/**.test.*` pass

---

## 9. Phase 5 — Final cleanup (1 PR)

**Goal:** decommission JS color resolution. T proxy survives but as a thin re-export.

### 9.1 Steps

1. **Audit:** `grep -rn "T\.\(bg\|text\|border\|accent\|green\|red\|amber\|blue\|purple\|cyan\|pink\|on\|pulse\)" artifacts/pyrus/src` — expect zero hits. If any remain, file as bugs and migrate.
2. **Update T proxy:** in `artifacts/pyrus/src/lib/uiTokens.jsx`, change the `T` Proxy to return CSS var strings for color keys. Typography keys still pass through to `TYPOGRAPHY`. Pseudocode:

   ```js
   const COLOR_KEY_TO_CSS_VAR = {
     bg0: "var(--ra-surface-0)",
     bg1: "var(--ra-surface-1)",
     // ... full mapping from §3.1
   };

   export const T = new Proxy({}, {
     get(_t, prop) {
       if (typeof prop === "string" && prop in TYPOGRAPHY) return TYPOGRAPHY[prop];
       if (typeof prop === "string" && prop in COLOR_KEY_TO_CSS_VAR) {
         return COLOR_KEY_TO_CSS_VAR[prop];
       }
       if (typeof prop === "string") return THEMES[CURRENT_THEME]?.[prop];
       return undefined;
     },
   });
   ```

   This makes any stragglers automatically theme-aware via CSS.
3. **Update `uiTokens.test.js`:**
   - Tests asserting `THEMES.dark.accent === "#168BFF"` stay — they're testing the palette source.
   - Tests asserting `T.green === "#XXX"` change to `T.green === "var(--ra-green-500)"` (or remove the test if it's redundant with palette tests).
4. **Remove `setCurrentTheme` callers' assumption that `T` re-resolves** — it now doesn't matter because CSS does the work. Leave `setCurrentTheme` and `CURRENT_THEME` in place for backwards-compat of any non-color JS that uses them (none currently identified, but cheap to keep).
5. **Delete the snap-during-swap workaround** from Phase 0.4 if it was added. Theme toggle is now naturally smooth.
6. **Flip ESLint guard severity** from `warn` to `error`.
7. **Delete any orphaned local `colorWithAlpha` declarations** that no consumers remain for.

### 9.2 Acceptance criteria

- `grep` produces zero `T.<color>` inline-style consumers
- Theme toggle is visually instant and consistent across all surfaces
- All tests pass
- ESLint flags any future `T.<color>` regression as an error

---

## 10. Verification (apply at every phase)

After each PR:

1. **Typecheck**: `pnpm -F @workspace/pyrus typecheck` — must be clean.
2. **Unit tests**: `pnpm -F @workspace/pyrus test:unit` — must pass. Update test assertions in the same PR as the helper/component change that broke them.
3. **Visual smoke test in Replit dev server**:
   - Open the changed surface in dark mode → screenshot.
   - Toggle to light mode → screenshot.
   - Toggle back to dark → confirm matches the first screenshot.
   - Pay attention to: backgrounds, borders, text colors, focused/hover states, semantic colors (PnL up/down, status pills, tone-tinted pills).
4. **Theme-swap consistency check**: open a screen mixing migrated and unmigrated content (during phases 1–4). Migrated regions should flip in unison; un-migrated regions still on JS may stagger. The Phase 0.4 workaround masks this during migration.
5. **DevTools sanity**: inspect a migrated element — its `style` attribute should show `var(--ra-...)` not a hex.

---

## 11. Known gotchas

- **`color-mix()` browser support**: Safari 16.4+, Chrome 111+, Firefox 113+. Confirm the target supports it (the codebase already ships `color-mix()` in `index.css`, so this is established).
- **Accent presets** (`pyrus`, `coral`, `amber`, `green`, `aurora` — `index.css` lines ~283–360): override `--ra-color-accent` and a few related variables. The new variables added in Phase 0.1 (`--ra-accent-dim`, `--ra-accent-hover-bg`, `--ra-accent-active-bg`, `--ra-on-accent`) may need per-preset overrides if accent-tinted backgrounds look off when a non-default preset is active. Audit after Phase 0 ships.
- **Canvas / WebGL contexts**: if any code passes a color to `<canvas>` 2D context's `fillStyle`, that needs a hex string, not a `var()` reference. None found in current sweep, but check feature folders during Phase 3.
- **Inline `style` typing**: TypeScript's `CSSProperties` accepts string values for color props; no type fixes needed for the swap itself.
- **Memoization**: components memoized on `T.*` props (rare) will stop seeing changes — they shouldn't have been memoizing on hex anyway. If a component re-render regresses, it's likely an unrelated memo prop issue.
- **Tests asserting exact `T.<color>` values** must be updated in the same PR that migrates the helper they exercise. Known sites:
  - `IbkrConnectionStatus.test.js`
  - `OperationsSignalRow.test.js`
  - `PositionsPanel.test.js`
  - `tones.test.js` (if present alongside `signal-language/tones.js`)

---

## 12. Recommended PR sequence summary

| PR | Phase | Scope | Approx LOC |
|---|---|---|---|
| 1 | 0 | CSS vars + lint + safety net | ~80 lines |
| 2 | 1 | Shared primitives + signal-language | ~600 lines |
| 3 | 2 | Cockpit shell + header lanes | ~800 lines |
| 4 | 3a | `features/account/` | ~400 lines |
| 5 | 3b | `features/trade/` | ~400 lines |
| 6 | 3c | `features/market/` | ~400 lines |
| 7 | 3d | `features/research/` | ~400 lines |
| 8 | 3e | `features/algo/` | ~400 lines |
| 9 | 4 | `screens/` | ~600 lines |
| 10 | 5 | T proxy update + cleanup | ~100 lines |

**Total estimate:** ~4,200 lines changed across 10 PRs, mostly mechanical. Codex can likely script Patterns A and B as codemods. Patterns C/D/E and the test updates need per-file judgment.

After PR 10, the codebase has one source of truth for theme-varying colors, theme toggles are instant and visually consistent, and the ESLint rule guards against regression.
