# Fix: Restore Logo Ring on Container Loaders + Stop Double Boot Loader

## Context

Two loader problems on the Pyrus app (`artifacts/pyrus/`):
1. **Container loaders lost the logo ring.** The branded animated ring still exists and works, but
   in-app container loaders no longer show it — they show a bare spinner.
2. **The loader "surfaces multiple things."** During cold boot the branded loader appears, unmounts,
   then appears again — two loaders in sequence.

Plus leftover migration cruft to tidy.

## Root causes (verified)

- **Ring missing on containers:** the generic `Panel` (`components/platform/primitives.jsx`) renders
  a plain `<LoadingSpinner>` in its `loading` state (`:883` def, `:979–987` use). Every in-app
  container loader goes through `Panel loading=…` (PositionsPanel, EquityCurvePanel, TradesOrdersPanel,
  Flow, etc.), so they all show the bare spinner. The branded animated ring is intact and
  **self-contained** in `public/brand/pyrus-loader-mark-dark.svg` (own `pyrus-grad` gradient +
  `pyrus-glow` filter + `.pyrus-ring` spin; **no external `var()`**, so it renders inside an `<img>`),
  but it's only wired to Suspense **chunk** fallbacks (`BrandLoader`/`LogoLoader tone="panel"` in
  `ScreenLoadingFallback`, `MarketScreen`, `ResearchScreen`) — not to `Panel`'s loading state.
- **Two boot loaders in sequence:** `App.tsx:50` outer `<Suspense fallback={RootBootFallback →
  BrandLoader}>` covers the lazy **AppContent** chunk; once AppContent mounts, `AppContent.tsx:158`
  has an **inner** `<Suspense fallback={<LogoLoader testId="app-loading-fallback">}>` covering the
  lazy **PlatformApp** chunk. So loader #1 (AppContent) → unmount → loader #2 (PlatformApp). Both use
  `testId="app-loading-fallback"`.
- **Cruft:** orphan `.pyrus-loader-lockup` (`index.css:5`, no renderer). NOTE: the `.pyrus-loader-*`
  family is **not** pure duplication — it's used by the static header logo (`PyrusLogo`/`PyrusMark`,
  `.pyrus-loader-instrument`/`.pyrus-loader-wordmark`/`.pyrus-mark-image`) and `pyrus-mark-dark.svg`
  is the static mark — so only verified-dead rules get removed.

## Decisions (locked)

- Container loaders show the **branded ring mark on big panels only**; small/inline panels keep `LoadingSpinner`.
- Boot fix targets the confirmed **two-in-sequence** double Suspense → show a **single** continuous boot loader.
- **Fold in cleanup** of verified-dead loader CSS/assets, updating `LogoLoader.validation.ts`.

## Fix

### A. Container ring loader on big panels — `primitives.jsx`
- Add `PanelRingLoader` (mark-only, no wordmark): a centered `role="status"` wrapper rendering the
  ring SVG via the existing `PyrusLoaderMark` (`components/brand/pyrus-loader-mark.tsx`) sized ~`48px`
  (`h-[48px] w-[48px]`), transparent background, `aria-label="Loading"`. Reuses the self-contained
  SVG (ring + glow + spin; already honors `prefers-reduced-motion`).
- In `Panel`'s loading branch (`:979–987`), pick the loader by the panel's resolved `minHeight`:
  **≥ 160px → `PanelRingLoader`; otherwise → existing `LoadingSpinner`** (unchanged for small/inline).
  Add an optional `loaderVariant?: "ring" | "spinner"` prop to force either, defaulting to the
  height rule. Keep the spinner color/tone behavior for the spinner path.
- Threshold (160px) chosen so substantial data panels (PositionsPanel `minHeight={136}`→spinner;
  EquityCurve/Trades/larger →ring) get the brand mark while tiny inline panels stay light; tunable.

### B. Single boot loader — `App.tsx` + `AppContent.tsx`
Eliminate the second loader by making the two lazy chunks load under **one** visible loader:
- **Eager-preload `PlatformApp`** at AppContent module-eval, mirroring App.tsx's AppContent preload
  (`App.tsx:14–28` pattern: a `loadPlatformApp()` that kicks off `import("PlatformApp")` on
  `window`). Because the preload starts while the *first* boot loader is already on screen, the
  inner Suspense resolves without a visible second loader in the normal path.
- Make the inner Suspense fallback **continuous, not a re-flash**: render the **same** `BrandLoader`
  treatment and, to avoid the unmount→remount flash entirely, gate the inner fallback so it only
  shows a loader if PlatformApp is genuinely not yet loaded (otherwise `null`). Net effect: one
  branded loader from boot until the shell is interactive.
- Collapse the duplicate `testId="app-loading-fallback"` to a single canonical boot loader id (keep
  it on the outer; the inner, if it ever shows, uses a distinct id or none) so the two are no longer
  conflated.

### C. Cleanup (verified-dead only)
- Remove orphan `.pyrus-loader-lockup` (`index.css:5`) after confirming no renderer references it.
- Sweep for any other loader rule/`@keyframes` with zero usage; **keep** all classes still used by
  `PyrusLogo`/`PyrusMark`/`BrandLoader` and the static `pyrus-mark-dark.svg`.
- Do **not** remove the `.pyrus-loader-*` family or `pyrus-mark-dark.svg` (in use by the static logo).

## Files to modify

- `artifacts/pyrus/src/components/platform/primitives.jsx` — `PanelRingLoader` + Panel loading branch + `loaderVariant`.
- `artifacts/pyrus/src/app/App.tsx` and `app/AppContent.tsx` — single-boot-loader (preload PlatformApp, continuous inner fallback, dedupe testId).
- `artifacts/pyrus/src/index.css` — remove verified-dead loader rules.
- `artifacts/pyrus/src/components/LogoLoader.validation.ts` — update assertions: the boot-loader wiring
  (single loader / testId change), the new Panel ring-loader path, and any removed CSS class
  assertions (e.g. `.pyrus-loader-lockup`). `lib/uiTokens.validation.js` if it asserts removed rules.

No backend/schema changes. The ring SVG itself is unchanged (already correct).

## Verification

1. `pnpm --filter @workspace/pyrus typecheck`.
2. `pnpm --filter @workspace/pyrus run test` — update `LogoLoader.validation.ts` to the new wiring; add a
   test that `Panel` with `minHeight ≥ 160` (or `loaderVariant="ring"`) renders the ring mark and a
   small panel renders `LoadingSpinner`. Keep `uiTokens.validation.js` green.
3. **Manual (key checks):**
   - Container ring: open the Account page and trigger a panel `loading` state (e.g. switch
     accounts / refetch) on a large panel → it shows the **animated logo ring**, not a bare spinner;
     a small/inline panel still shows the spinner.
   - Single boot loader: hard-reload with cold cache (DevTools → Disable cache, throttle) → the
     branded boot loader appears **once** and stays until the shell is interactive — no second loader
     flash. Verify with normal (warm) load too.
   - `prefers-reduced-motion`: ring stops animating (SVG already handles this); confirm no regression.
4. If any Replit startup file is touched (it won't be), run `pnpm run audit:replit-startup`.
