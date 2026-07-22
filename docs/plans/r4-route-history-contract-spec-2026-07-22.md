# R4 Route/History Contract — Implementation Spec (2026-07-22)

Prepared by the Units 25–39 campaign continuation session `aefad5fb-1de7-4341-8526-ec2bc0046391`
(read-only Plan-agent draft, verified against the in-flight working copy). Implements the
campaign roadmap Phase 1 (`SESSION_HANDOFF_2026-07-22_019f8b54-291f-76c1-8b07-e3a202f55798.md`).

**Key property: zero edits to Symbol-Intel-lane files.** The history write lives at the
`activateScreen` choke point in `PlatformApp.jsx`, so every caller (including the actively
edited `PlatformShell.jsx` navigation handlers) inherits history awareness with no edits.
Files edited: `initialPlatformScreen.ts`, `initialPlatformScreen.test.mjs` (test additions),
`PlatformApp.jsx`. All three are cold and unclaimed by the active lanes.

## 1. The RED contract (initialPlatformScreen.test.mjs)

- Test 1 (green): `normalizeInitialPlatformScreen`: `"unusual"`→`"flow"`, `"settings"`→
  `"settings"`, unknown/null→`"market"`.
- Test 2 (green, constrains): `readInitialPlatformScreen()` under a `window` mock with only
  `localStorage` (no `location`) — URL-first logic must optional-chain `window.location`.
- Test 3 (RED):
  - `readPlatformScreenFromSearch(search): string | null` — `"?screen=research"`→`"research"`;
    `"?screen=unusual"`→`"flow"` (reader normalizes legacy); `"?screen=unknown"`→**null**
    (deliberately distinct from the `"market"` fallback).
  - `writePlatformScreenHistory(screenId, { history, location }): boolean` — pushState called
    exactly once with (current `history.state` passed through, `""`,
    `pathname + updated-search + hash`); unrelated params keep original position
    (`URLSearchParams.set` in-place semantics); dedup on the **parsed** current screen returns
    `false` with no history call.
- Test 4 (source guard): must contain the literal `PYRUS_STORAGE_KEY` import from
  `../../lib/workspaceStorage`; must not contain `PYRUS_WORKSPACE_STATE_STORAGE_KEY` or
  `"pyrus:state:v1"`. File must stay Node-24 type-strippable TS (erasable syntax only).

## 2. initialPlatformScreen.ts design

Keep `PLATFORM_SCREEN_IDS` / `PLATFORM_SCREEN_ID_SET` / `normalizeInitialPlatformScreen`.
Add:

- `readPlatformScreenFromSearch(search)`: pure; `new URLSearchParams(search || "")`,
  `get("screen")`, map `"unusual"`→`"flow"`, return id if in `PLATFORM_SCREEN_ID_SET` else
  `null`; try/catch → null. (Hidden `market-demo` is in the set → deep links flow through.)
- `writePlatformScreenHistory(screenId, options? { history, location, replace })`: resolve
  `window.history`/`window.location` defaults (return false if unavailable); normalize id,
  return false if invalid; dedup on `readPlatformScreenFromSearch(location.search) ===
  normalized` (parsed-compare is load-bearing for popstate over legacy `?screen=unusual`
  URLs); build URL via `params.set("screen", normalized)` preserving pathname/params/hash;
  `history[replace ? "replaceState" : "pushState"](history.state ?? null, "", url)` in
  try/catch; return true.
- `readInitialPlatformScreen()` (modified): URL-first via
  `readPlatformScreenFromSearch(window.location?.search)`, else the existing
  `PYRUS_STORAGE_KEY` localStorage path. Side benefit: the boot chunk preloader
  (`AppContent.tsx:125-134`) becomes deep-link-correct with zero edits.

## 3. PlatformApp.jsx integration (line numbers from 2026-07-22 working copy)

a) Line 204 import: add `readPlatformScreenFromSearch`, `writePlatformScreenHistory`.
b) Lines 237–250: delete the private `readInitialUrlScreen` duplicate parser (keep
   `SCREEN_ID_SET`; note it must stay in sync with `PLATFORM_SCREEN_IDS` — both 12 ids).
c) Lines 940–944 `initialScreenRef`:
   `useRef((typeof window !== "undefined" ? readPlatformScreenFromSearch(window.location.search) : null) ?? normalizeInitialPlatformScreen(_initialState.screen))`.
d) Lines 994–1005 `activateScreen` = single history choke point: after the `SCREEN_ID_SET`
   guard, `writePlatformScreenHistory(normalizedScreen)`. Deps stay `[]`. Rationale: the
   canonical commit in `useVisibleScreenNavigation`/`visibleScreenStore.js:42-70` cancels
   superseded rapid-click commits — writing here yields exactly one entry per settled
   transition; dedup makes popstate/deep-link/repair invocations no-ops.
e) Lines 1006–1023, replace the one-shot deep-link effect with two mount effects:
   1. Canonicalization (`[]`): `writePlatformScreenHistory(initialScreenRef.current,
      { replace: true })` — rewrites bogus/bare URLs via replaceState, no extra entry.
      Accepted quirk: literal `?screen=unusual` dedups (parses to flow) and stays visible
      until the first real navigation.
   2. Popstate (`[activateScreen]`): `const restored =
      readPlatformScreenFromSearch(window.location.search); if (restored)
      activateScreen(restored);` with cleanup. No second entry (browser updates location
      before popstate; the write dedups). Null parse = deliberate no-op (restoring a
      fallback would push a forward entry mid-back-navigation). StrictMode-safe.
f) Lines 4705–4711 persist effect unchanged (`persistState({ screen })` still covers
   popstate restores; reload resolves URL-first anyway).

No changes to `PlatformScreenRouter.jsx`, `PlatformShell.jsx`, `visibleScreenStore.js`.

## 4. Caller inventory (verification only — no edits needed)

All transitions terminate in `activateScreen`: PlatformApp 5435/5517/4850/5161/5191/5210/5218;
PlatformShell 783-788/795/799-806/1071/1119/1136-1145/1156/1170-1175/1319-1325/1361;
AppHeader 548/730-735/774; MobileMoreSheet 130; MobileWatchlistDrawer 46; AppContent 125-134
(reader consumer). Shell/Header line numbers are from the in-flight working copy — re-verify
with `rg -n "handleSetScreen"` at implementation time.

## 5. Tests beyond the RED contract

Unit: replace-mode (replaceState once, dedup still false); SSR no-window → false, no throw;
invalid id → false + no calls; `"unusual"` writes `?screen=flow`; empty search/hash URL
building; reader tolerance (`""`/null/undefined → null, un-prefixed `"screen=trade"` works,
`market-demo` accepted); `readInitialPlatformScreen` URL-first over storage; optional source
guard that PlatformApp no longer contains `readInitialUrlScreen`.

E2E (Playwright, `e2e/app-header-navigation.browser-validation.spec.ts`): Research→Trade URL
updates; reload stays on Trade; Back restores Research without extra entries; deep-link
`?screen=unusual` renders Flow; `?screen=bogus` canonicalizes via replaceState; unrelated
params + hash survive.

## 6. Risks / collisions

- Zero edits to Symbol-Intel files (primary design constraint); their navigation inherits
  history awareness automatically.
- Watch in review: any new navigation that bypasses `activateScreen` silently skips history
  (none exists today).
- `scheduleCanonicalHandoff` defers the URL write by ~a frame after the visual switch; a Back
  press in that window is safe (generation bump cancels the pending handoff).
- Keep the file erasable-syntax TS and the exact `PYRUS_STORAGE_KEY` import line.
