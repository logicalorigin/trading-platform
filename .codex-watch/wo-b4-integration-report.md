# WO-B4 — Integration verification report (boot-consolidation + login-redesign)

Date: 2026-07-08. Orchestrator: Claude (Fable→Opus). All work in the working tree, NOT committed
(concurrent IBKR + code-reduction lanes are also uncommitted; the user commits).

## What shipped (working tree)

Three codex workers (`--dangerously-bypass-approvals-and-sandbox`, user-authorized — codex's own
bwrap sandbox is broken on this Replit box) + Claude fixes:

- **WO-BOOT-01** (index.html, vite.config.ts, main.tsx, App.tsx, NeuralBootOverlay.tsx,
  loadingFallbackTheme.test.mjs; deleted boot-neural{,-scene}.tsx + 4 dead marketing/LogoLoader
  files): removed the pre-React 36k-particle WebGL cloud + its Vite plugin + rollup inputs.
  NeuralBootOverlay now owns the whole boot with a module-scope BOOT_MODE (opener/static/off), a
  pixel-identical `BootShellScreen` replica of the static HTML loader (testid
  `neural-stage-fallback`), and a `neural-boot-static` curtain for no-WebGL/reduced-motion.
- **WO-BOOT-02** (bootProgress.ts, AppContent.tsx, LoginGate.jsx): moved
  `PLATFORM_BOOT_PROGRESS_TASK_IDS` to bootProgress.ts; LoginGate z-index 130→110, removed dead
  `className="dark"`, added `skipBootProgressTasks` for signed-out visitors (fixes the opener
  deadlock — signed-out boot now completes in seconds instead of the 12s backstop).
- **WO-LOGIN-01** (neuralOpenerState.ts, NeuralLoader.tsx, LoginGate.jsx; deleted ui/button.tsx):
  `subscribeNeuralOpenerActive`; exported `LOADER_CLOUD_PROPS`; split-panel login (brand stage
  left = ambient neural cloud + BrandResolve/PyrusMark lockup + wordmark + tagline; form right),
  theme-following, house-Button migration. Supersedes WO-CR-02 Slice E.
- **WO-A4** (Claude): PlatformApp boot overlay `bootHandoffElapsedMs` = `readCurrentBootHandoffElapsedMs(null)`.
- **Review fixes** (Claude, from adversarial review below): NeuralBootOverlay `onReveal` now resets
  `setNeuralOpenerActive(false)`; brandKitInstall.test.mjs requiredFiles drops the 3 deleted files;
  knip.json drops the 2 deleted boot-neural entry points.

## Adversarial review (11-agent workflow: 4 dimensions → per-finding verify → synthesize)

6 findings raised, **3 confirmed / 3 refuted**. Both confirmed defects were FIXED before finalizing:

1. **[confirmed→FIXED] openerActive stranded true on opener path.** The overlay returns null on
   reveal but never unmounts (App.tsx renders it unconditionally), so the line-104 unmount cleanup
   never fired → on a signed-out WebGL first load the redesigned login would render STATIC (no
   cloud). Fix: reset the flag in `onReveal`. (NeuralBootOverlay.tsx)
2. **[confirmed→FIXED] brandKitInstall.test.mjs required 3 deleted files** → 2 tests failed. Fix:
   removed lines. Now 4/4 pass.
3. **[refuted]** module-scope setNeuralOpenerActive SSR hazard (Node test env, no jsdom);
   signed-in reload brief double-WebGL (acceptable/brief); knip stale entries (below defect bar —
   cleaned up anyway).
4. **[clean]** chunk-perf: three.js does NOT land on the eager path — confirmed statically AND
   empirically (built index.html modulepreloads contain zero three; three stays in the lazy
   `neural` chunk).

## Verification results

- **Typecheck**: my 14 touched files produce ZERO errors. (The only tsc errors are in
  `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx` — a `UU` unresolved merge
  conflict owned by another lane, NOT mine.)
- **Guard tests**: brandKitInstall 4/4 pass; loadingFallbackTheme 5 pass / 1 fail — the 1 failure
  is the pre-existing `/brand/` favicon ledger failure (fails at HEAD too), not mine.
- **Prod build**: succeeds; `boot-neural` fully gone from the bundle; no three in eager chunks.
- **WO-A6 (17% stall)**: prod `app-content-chunk` = **318ms** vs dev **5.8s** → the stall is
  DEV-ONLY Vite transform cost. Per the plan gate, no code change. Prod login appears at ~2.6–4.5s.
- **Boot sequence (prod preview, frame-by-frame ×2)**: consistently clean — static dot shell →
  (identical React `BootShellScreen` replica) → single dot curtain / opener → split-panel login.
  NO grid-cloud iterations, NO ring-logo interstitial, NO blank void. (Dev runs occasionally show
  a `Retrying app shell` state when the box is loaded — a pre-existing dev chunk-retry artifact,
  absent in prod.)
- **Login shots**: light (system), dark (`--storage-state` pyrus:state:v1=dark), and stacked
  480px mobile — all render correctly, 0 console errors.
- **Behavior probes**: empty submit → validation `role="alert"` ("Enter a valid email address");
  inputs fillable; reduced-motion → no canvas, brand stage present, `neural-stage` count 0.
- **e2e neural-loader spec**: 3 fail — ALL are the `platform-screen-stack` assertion, which
  requires an AUTHENTICATED workspace with no login step. The spec has no auth setup, so it can't
  pass against the login-walled dev server (pre-existing environmental incompatibility, not a
  regression: boot-watch proves boot reaches `complete:true, 100%` and reveals the login wall —
  the app fully boots; only auth blocks the workspace). The `neural-stage` count-0 assertions the
  changes touch pass.
- **Live dev**: web 200 / api 200, preview pid2-attached, serving the redesigned login.

## NOT verifiable in this headless env (needs the user's real browser)

The **opener path** (`BOOT_MODE="opener"`) requires a hardware WebGL renderer;
`shouldPlayNeuralOpener()` rejects software GL, and this container has no GL context under any
flag. So the WebGL opener cloud → logo-form → disperse → reveal, and the `onReveal` openerActive
reset (review fix #1), are logic-verified + typecheck-clean but need a real-GPU browser to confirm
visually. To replay: clear `sessionStorage["pyrus_loader_seen"]`, reload signed-out → expect dots
→ ONE cloud → logo forms → disperses → split-panel login with animated BrandResolve + ambient
cloud; during the opener `document.querySelectorAll('canvas').length === 1`.
