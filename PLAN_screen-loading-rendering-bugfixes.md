# Implementation Plan: Screen Loading / Rendering Policy Bugfixes

## Overview
A read-only bug hunt across the platform's screen mount / warm-up / readiness / lazy-loading policy
(`PlatformApp.jsx`, `PlatformShell.jsx`, `PlatformScreenRouter.jsx`, `screenRegistry.jsx`,
`screenReadinessPolicy.js`, `appWorkScheduler.js`, `app/AppContent.tsx`) surfaced three confirmed defects
and four lower-confidence robustness items. This plan turns each finding into a small, independently
verifiable task. Per-screen data-active gating (queries/streams pausing when hidden) was audited and
came back clean — it is **not** in scope here except for one dead-param cleanup.

All paths below are relative to `artifacts/pyrus/`.

## Architecture Decisions
- **Contain, don't centralize.** Auxiliary/lazy surfaces (the live dock) get their own local error
  boundary rather than relying on the workspace-level boundary, so an optional feature can never take
  down the whole terminal.
- **One-shot refs flip *after* the work they guard, not before.** Deferred/idle work must set its
  "complete" sentinel inside the callback that actually performs the work (matching the existing
  correct pattern at `PlatformApp.jsx:2375-2377`), so a teardown during the idle delay doesn't
  permanently disable the path.
- **Audit before changing the readiness state machine.** The `contentReady` stickiness item is only a
  bug if a screen actually re-emits `contentReady:false`; confirm that first to avoid a speculative
  change to shared boot logic.

## Verification tooling (reference)
- Typecheck (TS only; does not cover `.jsx`): from `artifacts/pyrus/` → `pnpm run typecheck`
- JSX parse check: `node --input-type=module -e "import fs from 'node:fs'; import {transformWithEsbuild} from 'vite'; transformWithEsbuild(fs.readFileSync('<file>','utf8'),'<file>',{loader:'jsx'}).then(()=>console.log('PARSE_OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
- Unit tests (Node built-in runner): `node --test <path>.test.mjs`
- No app-level `test` script exists; screen logic is covered by colocated `*.test.mjs` files.

---

## Task List

### Phase 1: Confirmed surgical fixes (highest blast radius first)

## Task 1: Contain `BloombergLiveDock` failures with a local error boundary
**Description:** The live dock is lazy-loaded (`PlatformShell.jsx:112`, `lazyWithRetry`) and rendered at
`:309-311` and `:1148-1150` wrapped only in `<Suspense fallback={null}>`. There is no error boundary in
`PlatformShell`, so a terminal chunk-load failure (second failure in a session, after the one-time
reload guard in `dynamicImport.ts` is set) or any render-time throw in the dock bubbles to the
workspace-level `PlatformErrorBoundary` (`AppContent.tsx:480`) and replaces the entire workspace.

**Acceptance criteria:**
- [ ] Both dock render sites are wrapped in a local `PlatformErrorBoundary` (e.g. `label="Live dock"`, `reportCategory="bloomberg-live-dock"`) inside the `Suspense`.
- [ ] A thrown error inside `BloombergLiveDock` render (or a terminal chunk failure) no longer unmounts the workspace — only the dock area is affected.
- [ ] The contained fallback is non-intrusive for an optional overlay (no full-height takeover).

**Verification:**
- [ ] JSX parse check on `PlatformShell.jsx` → `PARSE_OK`
- [ ] `pnpm run typecheck` clean
- [ ] Manual: temporarily `throw` inside `BloombergLiveDock` render → workspace stays interactive, only dock shows fallback; revert the throw.

**Dependencies:** None
**Files likely touched:** `src/features/platform/PlatformShell.jsx`
**Estimated scope:** S (1 file)

## Task 2: Fix research preload "complete" ref ordering (code + data effects)
**Description:** `PlatformApp.jsx:2565` sets `researchWorkspaceCodePreloadCompleteRef.current = true`
immediately, then schedules the real `import()` ~2.5s later (`:2567`); cleanup (`:2578-2582`) cancels the
timer but never resets the ref, so a teardown within the window (navigation, `screenWarmupPhase` leaving
`"ready"`, or `memoryAllowsBackgroundWarmup` flipping false) permanently disables the preload for the
session via the gate at `:2542`. The sibling data-preload effect (`:2591+`, ref set ~`:2621`, 4–5.5s
window) has the identical defect. The screen-code preload at `:2375-2377` is the correct reference
pattern (resets its started-ref in cleanup).

**Acceptance criteria:**
- [ ] The "complete" ref for each effect is set only after the deferred import/data load is actually issued (inside the idle callback), OR reset in cleanup when `cancelled` and the work never fired.
- [ ] Both the code-preload and data-preload research effects are corrected.
- [ ] A teardown during the idle delay leaves the path eligible to re-run on the next qualifying render.

**Verification:**
- [ ] JSX parse check on `PlatformApp.jsx` → `PARSE_OK`
- [ ] `pnpm run typecheck` clean
- [ ] Manual reasoning trace: confirm gate (`:2542` / data equivalent) re-opens after an interrupted attempt; confirm a completed attempt still does not re-run.

**Dependencies:** None
**Files likely touched:** `src/features/platform/PlatformApp.jsx`
**Estimated scope:** S (1 file)

### Checkpoint: After Tasks 1–2
- [ ] `pnpm run typecheck` clean; both files `PARSE_OK`
- [ ] Workspace boots and the live dock opens normally
- [ ] No regression in research-screen warm-up timeline markers
- [ ] Review with human before proceeding

---

### Phase 2: Warm-mount policy (decision required — see Open Questions)

## Task 3: Resolve the inert hidden warm-mount path
**Description:** The render gate at `PlatformShell.jsx:280-284`
(`mountedScreens[id] && (active || retainedInactiveScreens.includes(id) || deferredInactiveScreens.includes(id))`)
never renders a screen that was warm-mounted but never visited, because `retained`/`deferred` are seeded
only on navigation away (`:200-242`). The warm-mount effects (`PlatformApp.jsx:2468-2533`), the
`hiddenScreenWarmMountAllowed` gating, and `marketScreenWarm` (`:1210`, computed but never read) form a
dead path that provides no warm-up benefit. This task picks ONE direction (see Open Question 1).

**Acceptance criteria (Option A — revive):**
- [ ] Warm-mounted screen ids actually mount hidden (`isVisible=false`) without becoming "active".
- [ ] Hidden warm-mounted screens do NOT start live data work (verify against the data-active gating, which keys off `isVisible`).
- [ ] A cap bounds how many screens stay warm-mounted at once.

**Acceptance criteria (Option B — remove):**
- [ ] Warm-mount effects, `hiddenScreenWarmMountAllowed` gating, and the unused `marketScreenWarm` binding are removed.
- [ ] No remaining references; `mountedScreens` is still correctly populated for active/visited screens.

**Verification:**
- [ ] `pnpm run typecheck` clean; affected files `PARSE_OK`
- [ ] Manual (Option A): navigate to a never-visited warm-mounted screen and confirm it renders instantly with no fresh mount cost; confirm its network is idle while hidden.
- [ ] Manual (Option B): full navigation across all screens works; no console references to removed bindings.

**Dependencies:** None (independent of Phase 1)
**Files likely touched:** `src/features/platform/PlatformShell.jsx`, `src/features/platform/PlatformApp.jsx`
**Estimated scope:** Option A: M (2–3 files) · Option B: S (1–2 files)

### Checkpoint: After Task 3
- [ ] Decision recorded; dead code either revived-and-working or fully removed
- [ ] Navigation across all screens verified

---

### Phase 3: Robustness / lower-confidence (audit-then-fix)

## Task 4: Audit `contentReady`/`primaryReady` stickiness, fix if confirmed
**Description:** In `screenReadinessPolicy.js:23-49` only `frameReady` latches; `contentReady`,
`primaryReady`, `derivedReady`, `backgroundAllowed` collapse to the raw patched boolean, and a patch with
`contentReady:false` cascades the rest to false (`:46-49`). If a screen re-emits `contentReady:false`
after going ready, it could thrash the signalDisplay/signalMatrix background-resume timers
(`PlatformApp.jsx:1379-1417`). **Audit first**: this is only a bug if some screen actually sends
`contentReady:false` after first-true.

**Acceptance criteria:**
- [ ] Every `onReadinessChange` / readiness-patch caller is enumerated; documented whether any emits `contentReady:false` after a true.
- [ ] If confirmed: `contentReady` latches like `frameReady` (sticky once true) unless an explicit reset/`error` arrives; covered by a unit test.
- [ ] If not reproducible: finding documented as latent (no code change) and closed.

**Verification:**
- [ ] `node --test src/features/platform/screenReadinessPolicy.test.mjs` (add file if missing) passes
- [ ] `pnpm run typecheck` clean

**Dependencies:** None
**Files likely touched:** `src/features/platform/screenReadinessPolicy.js`, `src/features/platform/screenReadinessPolicy.test.mjs`
**Estimated scope:** S (1–2 files)

## Task 5: Fail boot overlay fast on active-screen chunk load error
**Description:** `first-screen` is a blocking boot task completed only by `activeScreenFrameReady`
(`PlatformApp.jsx:1229-1239`); if the active initial screen's chunk fails, the overlay waits the full
`BOOT_OVERLAY_WATCHDOG_MS` (8s) before force-releasing. The error path in `screenRegistry.jsx:53-65`
reports `frameReady:true` on `loadError` only when `isVisible !== false` — verify it covers the active
initial screen, and additionally `failBootProgressTask("first-screen")` immediately on the active
screen's load error.

**Acceptance criteria:**
- [ ] On the active initial screen's `loadError`, the boot overlay releases immediately (not after 8s).
- [ ] No premature release when the screen is merely slow but still loading.

**Verification:**
- [ ] `pnpm run typecheck` clean; affected files `PARSE_OK`
- [ ] Manual: simulate a failed initial-screen chunk → overlay clears promptly to the screen's own error fallback.

**Dependencies:** None
**Files likely touched:** `src/features/platform/screenRegistry.jsx`, `src/features/platform/PlatformApp.jsx`
**Estimated scope:** S (1–2 files)

## Task 6: Decide overlay-dismissal gate (frameReady vs primaryReady)
**Description:** `createPreloadableScreen` emits `frameReady:true` the instant the chunk mounts
(`screenRegistry.jsx:45-51`), dismissing the boot overlay before screen data loads → brief flash of the
screen's own skeleton. Mostly minor because screens render their own skeletons. This is primarily a
design decision, not necessarily a code change.

**Acceptance criteria:**
- [ ] Documented decision: keep `frameReady` dismissal (accept skeleton hand-off) OR gate dismissal on `primaryReady`.
- [ ] If changed: overlay dismisses on `primaryReady`; no screen regresses into a longer blank.

**Verification:**
- [ ] Manual across 2–3 data-heavy screens: confirm no worse flash than today.

**Dependencies:** Task 4 (shares readiness semantics)
**Files likely touched:** `src/features/platform/screenRegistry.jsx`, `src/features/platform/PlatformApp.jsx` (only if changed)
**Estimated scope:** S (decision-led)

## Task 7: Add unmount cleanup for toast timers
**Description:** `dismissToast` (`PlatformApp.jsx:1852`) and `pushToast` (`:1863-1876`) schedule raw
`setTimeout`s calling `setToasts`; only manual-dismiss timers are tracked, with no teardown on unmount —
a `setState`-after-unmount risk (low, since `PlatformApp` is effectively root).

**Acceptance criteria:**
- [ ] An unmount cleanup clears all pending toast timers (auto-dismiss/remove and the 220ms dismiss timer).
- [ ] No behavior change to normal toast lifecycle.

**Verification:**
- [ ] `pnpm run typecheck` clean; `PARSE_OK`
- [ ] Manual: trigger toasts, navigate to a lab/remount path → no React unmounted-setState warning.

**Dependencies:** None
**Files likely touched:** `src/features/platform/PlatformApp.jsx`
**Estimated scope:** XS (1 file)

## Task 8: Remove dead `isRetained` param in TradeScreen
**Description:** `buildTradeRuntimeActivity` is called with `isRetained` (`TradeScreen.jsx:3561-3565`) but
only destructures `{ isVisible, searchOpen }` (`:3393`); the `isRetained` prop/arg/router wiring
(`PlatformScreenRouter.jsx:217`) is inert. Either use it or remove the dead path.

**Acceptance criteria:**
- [ ] `isRetained` is either consumed meaningfully or fully removed (arg, prop, router wiring).
- [ ] Trade screen behavior unchanged (it already pauses correctly on `!isVisible`).

**Verification:**
- [ ] `node --test src/screens/TradeScreen.tradeTickerSearch.test.mjs` passes
- [ ] `pnpm run typecheck` clean; `PARSE_OK`

**Dependencies:** None
**Files likely touched:** `src/screens/TradeScreen.jsx`, `src/features/platform/PlatformScreenRouter.jsx`
**Estimated scope:** XS (1–2 files)

### Checkpoint: Complete
- [ ] All confirmed defects (Tasks 1–3) fixed and reviewed
- [ ] Phase 3 items resolved or explicitly deferred with rationale
- [ ] `pnpm run typecheck` clean; all touched files `PARSE_OK`; relevant `*.test.mjs` pass
- [ ] Ready for review / ship

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Editing `PlatformApp.jsx` (~4,900 lines) introduces a subtle warm-up regression | High | Keep each edit surgical and ref-pattern-matched to existing correct code (`:2375`); verify warm-up timeline markers unchanged |
| Adding the dock error boundary changes layout/stacking of the overlay | Med | Use a non-intrusive `fallbackRender`; manual visual check |
| Task 3 Option A revives warm-mount but accidentally starts live data on hidden screens | High | Confirm data-active gating keys off `isVisible` (already audited) and that warm-mounted screens render with `isVisible=false` |
| Task 4 changes shared readiness semantics and stalls a screen | Med | Audit-first; gate the change behind reproduced evidence; add unit test |
| `.jsx` not covered by `tsc` — type regressions slip through | Med | Always run the esbuild `PARSE_OK` check on edited `.jsx`; rely on colocated `*.test.mjs` |

## Decisions (2026-06-15)
- **Task 3 direction:** REMOVE the dead warm-mount machinery (Option B).
- **Shipping scope:** Phases 1–2 (Tasks 1, 2, 3) in this round; Phase 3 deferred to a follow-up.
- **Execution:** implementing now.

## Status — Phase 1–2 COMPLETE (2026-06-15)
- **Task 1 ✅** — `PlatformShell.jsx`: added `renderBloombergLiveDock()` wrapping both dock sites in a local `PlatformErrorBoundary` (`fallbackRender={() => null}`). Dock failures now drop silently instead of crashing the workspace.
- **Task 2 ✅** — `PlatformApp.jsx`: both research preload effects now set the complete-ref up-front but roll it back in cleanup via a `completed` flag if the deferred work never fired. An interrupted attempt stays eligible to re-run.
- **Task 3 ✅** — removed the purely-dead hidden warm-mount effect, the dead `setMountedScreens` block inside the boot effect (kept its live boot-screen code preload, which is redundant-covered and tied to boot-progress), `screenShellWarmMountCompleteRef`, `marketScreenWarm`, the `SCREEN_SHELL_WARM_MOUNT_*` constants, the `screenRegistry` export, and the now-dead diagnostics fields. Left `hiddenScreenWarmMountAllowed`/`disableHiddenScreenWarmMount` in place — they now gate the still-live boot preloader (renaming would touch the public `__PYRUS_PERF_WARMUP_OVERRIDES__` test hook).
- **Verification:** `pnpm run typecheck` clean; esbuild `PARSE_OK` on all three files; `grep` confirms no dangling references to removed symbols.
- **Test-runner caveat:** the colocated `*.test.mjs` suites that import `.jsx` cannot run under bare `node --test` (no JSX loader configured in this workspace) — they fail with `ERR_UNKNOWN_FILE_EXTENSION` at import resolution, independent of these changes. The `.js/.mjs/.ts`-only suites pass (107/118). Confirm in the real test environment (with the project loader) before merge.

## Status — Phase 3 COMPLETE (2026-06-15)
- **Task 4 ✅ (audit, no code change)** — `contentReady` non-stickiness is NOT a live bug. Every screen emits `contentReady: Boolean(isVisible)`, and the three explicit `contentReady:false` emissions (MarketScreen/FlowScreen/AccountScreen) are all guarded by `if (!isVisible)`. `isVisible` for a screen is exactly `screen === "<id>"` (`PlatformScreenRouter.jsx:95-105`, not gated by tab `pageVisible`), so the **active** screen never emits `contentReady:false`, and `activeScreenReadiness = screenReadiness[screen]` only reads the visible screen — no thrash of the active screen's background timers. Making `contentReady` sticky would be wrong (a hidden screen *should* report not-ready so its work stops). Closed.
- **Task 5 ✅** — latency goal was already met by the error-readiness effect (`screenRegistry.jsx:53-65` emits `frameReady:true` on `loadError` for visible screens, releasing the overlay promptly, not via the 8s watchdog). Fixed the residual telemetry gap: the boot-completion effect (`PlatformApp.jsx:1223`) now branches on `activeScreenReadiness.error` and calls `failBootProgressTask("first-screen", …)` instead of `completeBootProgressTask` when the active screen errored (consistent with the watchdog path; `failed` is still a settled state so the overlay still clears).
- **Task 6 ✅ (decision: keep `frameReady` dismissal, no code change)** — gating overlay dismissal on `primaryReady` would couple global boot completion to per-screen data loading (a slow query would hold the overlay up) and lengthen perceived boot for data-heavy screens. Screens render their own skeletons after the frame mounts, so the brief hand-off is acceptable. Keeping `frameReady` dismissal.
- **Task 7 ✅** — `PlatformApp.jsx`: `dismissToast`'s 220ms removal timer is now tracked in `timeoutMapRef` (was a bare untracked `setTimeout`), and an unmount-cleanup effect clears every pending toast timer, eliminating the `setState`-after-unmount risk.
- **Task 8 ✅** — removed the dead `isRetained` param: the `<TradeScreen>` prop wiring (`PlatformScreenRouter.jsx:217`), the `TradeScreenInner` destructure (`TradeScreen.jsx:3420`), and the unused arg passed to `buildTradeRuntimeActivity` (`TradeScreen.jsx:3563`). `grep` confirms zero remaining references.
- **Verification:** `pnpm run typecheck` clean; esbuild `PARSE_OK` on all edited files; no dangling `isRetained` references.

## Follow-ups noted (not done)
- The boot effect and its `bootScreenShellWarmMount*` timeline/diagnostics keys are now misnamed (it is a code preloader, not a warm-mount). Optional rename later; left as-is to avoid churn and protect the public override hook name.

## Open Questions (deferred to Phase 3)
- **Task 6:** is the brief skeleton flash on boot acceptable, or should overlay dismissal wait for `primaryReady`?
