# Loading, Rendering & Launch Audit — 2026-06-11

Scope: why PYRUS pages/containers take long to load, the app's **launch/boot-loader sequence**, what's **errantly waiting**, and what (if anything) **should be lazy-loaded**. Companion to `APP_RESPONSIVENESS_AUDIT_2026-06-09.md` (still largely valid for the *rendering* side). Every claim has a `file:line`. Findings gathered against `main`; a few earlier hypotheses were disproven during the investigation and are flagged as **CORRECTED** so they aren't re-chased.

---

## 1. Launch / boot-loader sequence (as it actually runs)

1. **Dev orchestration** (`artifacts/pyrus/scripts/runDevApp.mjs`): starts API (`pnpm run build && node dist/index.mjs`), then market-data worker, then Vite web. The API `dev` does a full `esbuild` build on every (re)start (no watch); observed respawns up to ~126s under load.
2. **`index.html`** ships a static HTML/CSS **boot loader** (`.pyrus-boot-loader`, progress bar `.pyrus-boot-progress-fill`/`-percent`) rendered before any JS, records `__PYRUS_BOOT_LOADER_STARTED_AT__`, and installs a **crash guard** ("React did not mount…", `__PYRUS_BOOT_CRASH_DIAGNOSTICS__`, `index.html:382,454-465`).
3. **`main.tsx`** mounts React into `#root` (which *replaces* the static loader), renders `<App>`, completes the `static-html` + `react-root` boot tasks, and dismisses the crash guard (`main.tsx:42-53`). React mount does **not** wait for any data.
4. **Lazy chunk chain:** `App` → `AppContent` → `PlatformApp`, each code-split via `lazyWithRetry` with Suspense fallbacks (`app/App.tsx`, `app/AppContent.tsx:221`, `loadPlatformApp`). The shell appears as fast as these chunks load.
5. **`PlatformApp`** starts the data boot tasks on mount — `session, watchlists, accounts, signal-profile, signal-state, first-screen` (`PlatformApp.jsx:937-945`) — and completes/skips them as data arrives (`:1368` first-screen).
6. **`bootProgress.ts`** computes `percent` (capped at 99 until all *blocking* tasks settle, then 100) and `complete` (`bootProgress.ts:144-204`). This does not prevent the React shell tree from rendering, but it does keep the full-screen workspace boot overlay visible until the runtime blocking set settles (`PlatformApp.jsx:5831-5843`).

### Static boot-task defaults (`bootProgress.ts:65-79`)
| Task | Weight | Blocking? |
|---|---|---|
| static-html | 3 | ✅ |
| react-root | 4 | ✅ |
| app-content-chunk | 8 | ✅ |
| workspace-route-chunk (PlatformApp) | 10 | ✅ |
| **session** | 10 | ✅ |
| watchlists | 8 | ✅ static default; runtime depends on screen |
| **first-screen** | 15 | ✅ |
| accounts | 8 | ❌ non-blocking |
| signal-profile | 7 | ❌ non-blocking |
| signal-state | 5 | ❌ non-blocking |
| screen-preload-{flow,trade,algo,backtest} | 5–6 | ❌ non-blocking |

**Runtime override (verified 2026-06-11):** current source builds `initialBootBlockingTaskIds` via `useMemo` (`PlatformApp.jsx:857`) and calls `reclassifyBootBlocking(initialBootBlockingTaskIds)` on mount (`PlatformApp.jsx:929`; `reclassifyBootBlocking` defined `bootProgress.ts:282`). The screen dependency matrix lives in `SCREEN_BOOT_DATA_DEPS` (`bootPolicy.js:9-20`, re-exported via `screenRegistry.jsx:11`): Market / Research / Backtest / Diagnostics / Settings → `[session]`; Signals → `[session, signal-profile]`; Flow / GEX / Trade → `[session, watchlists]`; Account → `[session, accounts]`; Algo → `[session, accounts, signal-profile]`.

---

## 2. Lazy-loading status — **already in good shape** (low remaining upside)

**CORRECTED:** an earlier note ("no route code-splitting / 21K lines parsed at startup") was **stale**. Current reality:
- Screens are lazy via `features/platform/screenRegistry.jsx` + `screenModulePreloader` + `lazyWithRetry`; `PlatformApp` itself is lazy (`AppContent.tsx:221`).
- The initial screen is preloaded, and `account` is also priority-preloaded if it is not already the initial screen (`AppContent.tsx:42`, `:193-195`). These preloads are not boot blockers.
- The heaviest modules are **not** pulled into the shell/header, so they load only with their screen: `ResearchChartSurface.tsx` (13,884 lines), `BacktestingPanels.tsx` (7,279), `PhotonicsObservatory.jsx` (4,832), `BloombergLiveDock.jsx` (3,157) — none statically imported by `PlatformApp.jsx`/`AppHeader.jsx`/`PlatformScreenRouter.jsx`.

→ There is little "should be lazy but isn't." Don't spend effort re-splitting; the win is elsewhere.

---

## 3. Errant waiting — the real launch levers

1. **Updated contract: the full-screen boot overlay is frame-only.** `session-not-ready` belongs to `resolveQuoteStreamGateReason` (`PlatformApp.jsx:689-705`), so it gates quote streams, not the shell render path. The user-visible boot overlay should clear once the static HTML, React root, app-content chunk, and workspace-route chunk are ready. Session, watchlists, accounts, signal profile/state, and `first-screen` are tracked for timing/work scheduling but no longer block the overlay.
2. **Screen data gates move inline.** Runtime screen modules should render their structural frame as soon as the route chunk is ready. Data-specific work then resolves through each screen's own loading, stale, empty, and error states. Do not reintroduce global "Loading route module" takeovers or screen data blockers without an explicit product decision.
3. **`first-screen` remains a metric/work-scheduler signal, not a boot overlay gate.** Several screens now intentionally report `primaryReady: Boolean(isVisible)` so users see the page frame immediately. Richer readiness booleans such as `accountPrimaryReady`, `accountDerivedReady`, and `algoDerivedReady` still matter for inline content readiness and background-work permission.
4. **NOT errant (verified):** `signal-state` is static-default non-blocking (`bootProgress.ts:74`) and should stay out of the launch gate unless a specific initial screen truly requires it. `accounts` and `signal-profile` should remain inline data readiness concerns, not full-screen overlay blockers.
5. **Backend latency still matters, but should not hide the app frame:** slow `session`, Account, Algo, or Flow dependencies should degrade the relevant inline screen content rather than trapping the user behind the boot overlay. Current source shows the bridge governor still has constrained account/orders/health lanes (`bridge-governor.ts:57-62`), and `fetchMarketingShadowDashboardSnapshot` is already `Promise.all`-parallel (`marketing-shadow-dashboard.ts:540`), so downstream slowness should not be misdiagnosed as a serial-await bug.

---

## 4. Rendering cost after load (see `APP_RESPONSIVENESS_AUDIT_2026-06-09.md` for detail)
- Monolithic screens re-render on 1s clocks (`FlowScreen.jsx`, `PlatformApp.jsx`, `BloombergLiveDock.jsx`).
- 78 `useQuery` sites; overlapping polls (partly remediated to 10–20s).
- Heavy synchronous compute on the render path (indicators, flow sort/reduce).
- Incomplete virtualization (positions/signals tables).
- Layout thrash (tooltips/charts `getBoundingClientRect` unmemoized).

## 5. Backend "each request is slow" (blocks the gated loads)
- DB pool default is now **12 on helium / 10 otherwise**, with a 30s helium acquire timeout (`lib/db/src/index.ts:35-64`). Older "6/10" notes are stale, but queueing remains a launch risk under concurrent dashboard fanout.
- Per-tick synchronous SSE serialization — **the `:1238` citation does NOT verify** (that line is an SSE drain-timeout, `SSE_DRAIN_TIMEOUT_MS`). Actual `JSON.stringify` sites in `routes/platform.ts` are `:462`, `:2849`, `:3132`; re-resolve the exact per-tick event-serialization line before acting (carried over from a stale earlier audit).
- Bridge defaults are currently quotes 8 / bars 4 / options 4, but account 2 / orders 1 / health 1 with category backoffs (`bridge-governor.ts:57-62`).
- Hot endpoint references from older audits need re-resolving before editing; current `routes/platform.ts` is 3,475 lines, so older `platform.ts:5045` / `:12488` citations are invalid.
- API event-loop saturation was separately found & fixed in `c6d8cac` (brand-normalizer + provider-config memoization).

---

## 6. Recommendations (highest launch-time gain first)
1. **Keep the boot policy test guard** around `reclassifyBootBlocking` + `SCREEN_BOOT_DATA_DEPS` so future audits do not regress the policy back to global data blockers.
2. **Preserve immediate frame readiness for Account/Algo.** Their page frames should become visible on navigation; account/algo data readiness should continue to drive inline loading states and background-work permission.
3. **Leave Market without watchlists** per the current product decision: Market is usable without watchlist hydration. Flow/GEX/Trade watchlist needs should be expressed through their own inline states, not the global boot overlay.
4. **Cut backend latency at the source** for routes that feed visible screen content; keep this separate from frontend boot policy so pressure fallbacks are not hidden by UI changes.
5. **Lazy-loading is already in good shape** — no broad re-splitting action; only measure bundle chunks if a new production build shows a concrete regression.

## 7. Caveats / honesty
- Frontend "load weight" here is from **source line counts + live API latency**, not measured prod-bundle KB (no prod build present; dev serves unbundled ESM). Build `pnpm --filter @workspace/pyrus run build` to get exact chunk sizes.
- I confirmed `session` participates in the boot overlay gate, not a hard shell render gate. I did **not** instrument a live boot timeline (DevTools Performance) — that would quantify which blocking task dominates wall-clock.
- Two earlier hypotheses were disproven mid-investigation and corrected above (no-code-splitting; signal-state gating boot).
- **Verification pass (2026-06-11, against `main`):** every symbol/line reference re-checked. Corrected three that were wrong — the `reclassifyBootBlocking` call site (`PlatformApp.jsx:929`, memo `:857`), the `SCREEN_BOOT_DATA_DEPS` location (`bootPolicy.js:9-20`, not `screenRegistry.jsx`), and the SSE-serialization citation (does not verify at `platform.ts:1238`). All other claims confirmed; a few remaining line numbers are within ±5 lines of the cited ranges and the underlying claims hold. One open item: the exact per-tick SSE event-serialization line still needs resolution.
