# Pyrus Loading Policy — Assessment & Fix Plan

## Context

The goal is "better" app loading, not brute-force "faster": fix *what the app waits on* before it considers itself loaded, and the speed follows. Live profiling showed the app **shell paints fast** (DOMContentLoaded ~386ms, header ~432ms, right rail visible ~1369ms) but the full-screen boot loader stays up for many more seconds. The cause is not slow rendering — it is an **over-coupled boot-completion policy**: the loader blocks on data and code the screen you actually land on does not need, and the backend serving that data is currently slow (API p95 ~13s; several routes 4–12s).

Intended outcome: "boot complete" should mean **the active screen is usable**, not "everything everywhere is loaded." The app already has a mature post-first-paint readiness + scheduler system designed to pull secondary/cross-screen work in gracefully after first paint; the boot loader is duplicating and blocking on that work.

## Assessment (verified in code)

The full-screen loader dismisses only when **every `blocking: true` task settles** (`src/app/bootProgress.ts` — `complete = settledBlockingTaskCount === totalBlockingTaskCount`). The blocking set today:

| Task | Weight | Needed for first paint? |
| --- | --- | --- |
| static-html, react-root, app-content-chunk, workspace-route-chunk | 3/4/8/10 | Yes — infra/chunks |
| **session** | 10 | Yes — universal |
| **first-screen** | 15 | Yes — the active screen mounts |
| **watchlists** | 8 | Only some screens |
| **accounts** | 8 | Only Account/Algo |
| **signal-profile** | 7 | Only Algo monitor |
| **screen-preload-flow / trade / algo / backtest** | 5/5/6/6 | **No — these are *other* screens' JS chunks** |

Key code paths:
- `src/features/platform/PlatformApp.jsx:467-476` starts `session/watchlists/accounts/signal-profile/signal-state/first-screen` **unconditionally at mount**, before prioritizing the active screen. They complete on query resolution (session ~1102, watchlists ~1116, accounts ~1140, signal-profile ~2357) against the slow backend.
- `src/features/platform/screenRegistry.jsx:45-65` drives the 4 `screen-preload-*` blocking tasks as those code chunks load. On desktop they are only skipped on phone or when the preload gate never opens (`PlatformApp.jsx:1686-1717`) — so a normal desktop boot **waits for 4 other screens' JS** before showing the app.
- `src/app/AppProviders.tsx:6-15` — QueryClient defaults are reasonable (staleTime 30s, gcTime 10m, retry 1, no refetch-on-focus); not the problem.

**Net effect:** land on Market and the loader still waits on the slowest of `accounts`/`signal-profile` (which Market never renders) **plus** 4 unrelated screen chunks.

**Reusable machinery already present (do not reinvent):**
- Per-screen readiness state machine `handleScreenReadiness` (`PlatformApp.jsx:575-619`): `frameReady → criticalReady → derivedReady → backgroundAllowed`.
- `firstScreenReady` + `SCREEN_READY_EVENT` (`PlatformApp.jsx:629-662`).
- `appWorkScheduler` + `STARTUP_PROTECTION_COOLDOWN_MS` (8000), `SIGNAL_MONITOR_BACKGROUND_RESUME_DELAY_MS` (3000), `SIGNAL_MATRIX_BACKGROUND_RESUME_DELAY_MS` (6000) — already defer background data/code work until after first paint, and already preload hidden screens.
- The initial screen id is available **synchronously** at mount: `_initialState.screen` (from `lib/workspaceState`, `unusual`→`flow`), readable before the line-467 effect.

## Fix Plan (recommended: phased)

### Phase 1 — stop the loader waiting on unrelated work (small, low-risk, biggest single win)
In `src/app/bootProgress.ts`, flip these `TASKS` entries to `blocking: false`:
- `accounts`, `signal-profile`, and all four `screen-preload-flow/trade/algo/backtest`.

They keep being fetched/preloaded exactly as today (the mount effects and the post-paint `appWorkScheduler` preload still run) — they just no longer **gate** the loader. The loader then dismisses on: infra chunks + `session` + `watchlists` + `first-screen`.

Update the intentional expectations in `src/app/bootProgress.test.ts` (the hard-coded `percent` 13/31 and `skippedCount` assertions change once the blocking-weight total shrinks).

### Phase 2 — per-screen correctness + active-screen prioritization
Make "what blocks the loader" depend on the active screen, restoring correctness for Account/Algo entries without re-coupling everything else.

1. **Declare per-screen boot-data dependencies** in `screenRegistry.jsx`:
   ```
   SCREEN_BOOT_DATA_DEPS = {
     market:[session,watchlists], flow:[session,watchlists], gex:[session,watchlists],
     trade:[session,watchlists], account:[session,accounts],
     algo:[session,accounts,signal-profile], research:[session],
     backtest:[session], diagnostics:[session], settings:[session],
   }
   ```
   Always-blocking infra: `static-html, react-root, app-content-chunk, workspace-route-chunk, session, first-screen`.

2. **Add `reclassifyBootBlocking(blockingIds)` to `bootProgress.ts`** (preferred over overloading the readiness callback): mutate each task's `blocking` flag + recompute the derived `BLOCKING_TASKS`/`TOTAL_BLOCKING_WEIGHT` (make them `let`), then `emit()`. Make it idempotent and require it to run **before any blocking task settles** (so the monotonic `lastPercent` clamp can't regress). Extend `resetBootProgressForTests` to restore static defaults. Add a focused test.

3. **Call it once at mount** in `PlatformApp.jsx` (at/above the line-467 effect): resolve `initialScreen` from `_initialState.screen` (reuse the existing `unusual→flow` logic), then `reclassifyBootBlocking([...INFRA, ...SCREEN_BOOT_DATA_DEPS[initialScreen]])`. Keep starting all data tasks (still fetched), but only the active screen's declared deps gate.

4. **Prioritize the active screen's fetch:** defer the secondary cross-cutting fanout (`accounts/signal-profile/signal-state` + cross-screen prefetch) behind `firstScreenReady`/critical-ready via the existing `appWorkScheduler` path, so it stops contending with the active screen's critical queries on the pressured backend.

### Out of scope (optional follow-up, not included here)
Refining the post-first-paint readiness windows (e.g. skipping the 6s signal-matrix delay when Algo *is* the active screen; letting cheap code-preload start before the blanket 8s). These are "better policy" too but sit outside the boot-loader gate; flag separately if wanted.

## Critical files
- `src/app/bootProgress.ts` — task `blocking` flags; new `reclassifyBootBlocking`; reset helper.
- `src/app/bootProgress.test.ts` — update intentional percent/skip expectations; add reclassify test.
- `src/features/platform/screenRegistry.jsx` — `SCREEN_BOOT_DATA_DEPS`.
- `src/features/platform/PlatformApp.jsx` — call reclassify at mount; defer secondary fanout.
- `src/features/platform/appWorkScheduler.js` — reuse for deferred secondary fetch.

## Risks
- **Loader dismissing before needed data** — mitigated: `first-screen` + the active screen's declared deps stay blocking; anything lazy after mount is covered by the screen's own panel loaders / readiness.
- **Account/Algo entry** — Phase 2 restores `accounts`/`signal-profile` to blocking *only* when those are the initial screen.
- **`accounts` skip-without-session path** (`PlatformApp.jsx:1123-1140`) — non-blocking tasks never gate, so a skipped/failed one can't stick the loader.
- **Tests** — `bootProgress.test.ts` percent assertions change in Phase 1 (intentional); `platformRootSource.test.js` unaffected.

## Verification
- **Unit:** `pnpm --filter @workspace/pyrus exec node --import tsx --test src/app/bootProgress.test.ts` — updated percents; new `reclassifyBootBlocking` cases (e.g. `account` keeps `accounts` blocking + makes `signal-profile` non-blocking; `market` completes on infra+session+watchlists). Then `pnpm --filter @workspace/pyrus run typecheck`.
- **In-browser** (`window.__PYRUS_GET_BOOT_PROGRESS__()`): on a Market start, confirm the loader dismisses once session+watchlists+first-screen settle without waiting on accounts/signal-profile/the 4 preloads (compare dismissal timestamps before vs after); confirm Account/Algo initial loads still wait on their deps; watch for empty flashes on the active screen (should be none); confirm hidden screens still reach `ready` via `getScreenModulePreloadSnapshot()` post-paint.
