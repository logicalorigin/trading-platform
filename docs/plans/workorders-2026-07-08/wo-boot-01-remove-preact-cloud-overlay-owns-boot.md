# WO-BOOT-01 — remove pre-React neural cloud; NeuralBootOverlay owns the whole boot (boot-consolidation lane, worker 1 of 3)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, executing the approved
boot-sequence consolidation plan (2026-07-08). All paths below are relative to
`artifacts/pyrus/` unless prefixed with `/`.

**Prime directive:** kill the multi-iteration boot visuals. Cold load today shows: grid-like CSS
dot tile → pre-React 36k-particle WebGL cloud → hard `#root` wipe → static ring-logo interstitial
→ a DIFFERENT 22k opener cloud (restart). After this WO: static dot shell → (pixel-identical
React replica across the handoff) → ONE opener cloud → logo forms → disperses → app.
**Intentional visual change to the BOOT sequence is the point of this order** — but zero
behavior change to auth, routing, data loading, or the app itself.
Ponytail discipline binds (`.claude/skills/ponytail/SKILL.md`, level full).

## Gate (check-and-abort)

1. `.codex-watch/wo-boot-01-report.md` does not already exist.
2. `pnpm --filter @workspace/pyrus run typecheck` green before starting.
3. These files are clean in `git status --porcelain` before you start: `index.html`,
   `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/app/App.tsx`,
   `src/components/neural/NeuralBootOverlay.tsx`,
   `src/features/platform/loadingFallbackTheme.test.mjs`. If any is dirty, ABORT and report.

## Ownership + tree rules

- Touch ONLY the files this order names. Any OTHER file listed by
  `git status --porcelain | cut -c4-` belongs to another lane (an IBKR OAuth lane is running
  concurrently in api-server) — never touch those.
- Do NOT `git commit`, `git add`, or push anything. Leave edits in the working tree; the
  orchestrator reviews and commits.
- Do NOT start, stop, restart, or build the dev app; do NOT run `pnpm shot` or any browser.
  Your gates are typecheck + targeted `node --test` + `rg` only (sandbox has no network).
- **Supersession note:** the code-reduction lane order (`docs/plans/workorders-2026-07-07/
  wo-cr-02-pyrus-formatter-consolidation.md`) lists `boot-neural*.tsx`, `components/marketing/*`,
  and `components/LogoLoader.tsx` as never-touch *for that lane*. That rule does NOT bind this
  lane: this order deletes them WITH the guard-test update in the same change. That is by design
  and approved.

## Pre-existing failures ledger

`src/features/platform/loadingFallbackTheme.test.mjs` test "React loaders use the current Pyrus
brand kit assets" FAILS at HEAD: index.html's favicon `<link href="/brand/pyrus-mark.svg">` trips
a `doesNotMatch(/\/brand\//)` assertion. This failure is NOT yours — do not fix it, do not touch
that assertion, and your acceptance gate tolerates exactly this one pre-existing failure
(it must remain the ONLY failure in that file after your edits).

## Slice A1 — delete the pre-React boot-neural pipeline

1. `index.html`:
   - Delete the line `<div id="pyrus-boot-neural-root" class="pyrus-boot-neural-root" aria-hidden="true"></div>`
     (inside the `data-testid="pyrus-boot-loader"` static loader markup, ~line 660).
   - In the inline `<style>` block: the shared selector
     `.pyrus-boot-neural-fallback, .pyrus-boot-neural-root { inset: 0; pointer-events: none; position: absolute; }`
     → keep those declarations for `.pyrus-boot-neural-fallback` ONLY (drop the
     `.pyrus-boot-neural-root` selector). Delete these rules entirely:
     `.pyrus-boot-loader--webgl .pyrus-boot-neural-fallback { opacity: 0; }`,
     `.pyrus-boot-neural-root { mask-image: ...; opacity: 0.72; }`,
     `.pyrus-boot-neural-root canvas { display: block; }`.
   - KEEP UNTOUCHED: the `.pyrus-boot-neural-fallback` dot-pattern rule and its dark variant
     (it remains the sole pre-React visual and Slice A2 reuses it), the theme/anti-FOUC script,
     the benign-error script, the ENTIRE crash-diagnostics script (yes it still references
     boot-neural paths in `isOptionalBootNeuralScriptPath` — leave that helper alone, it is
     deliberate defensive listing), `__PYRUS_BOOT_LOADER_STARTED_AT__`, the light/dark
     `.pyrus-boot-loader` color rules, `data-testid="pyrus-boot-loader"`, the progress markup.
2. `vite.config.ts`: delete the consts `BOOT_NEURAL_SOURCE_MODULE` and
   `BOOT_NEURAL_SCENE_SOURCE_MODULE` (~lines 147-148), the whole `bootNeuralHtmlEntryPlugin`
   function (~154-231), its entry in the `plugins` array (~line 325), and the `"boot-neural"` +
   `"boot-neural-scene"` keys from `rollupOptions.input` (~404-408, keep `app`). KEEP
   `basePrefixFor` (used by `criticalChunkModulePreloadPlugin`).
3. `src/main.tsx`: delete the `disposeBootNeural` const (~26-33) and its call site (~line 63).
   Keep `readBootLoaderElapsedMs`, all boot-progress task calls, and
   `dismissBootCrashDiagnostics` exactly as-is.
4. Delete files `src/boot-neural.tsx` and `src/boot-neural-scene.tsx` (`rm`, they are tracked —
   deletion shows in git status; that is fine, do not commit).
5. `src/features/platform/loadingFallbackTheme.test.mjs`: remove the file-reads of
   `boot-neural.tsx` / `boot-neural-scene.tsx` (~lines 11-12) and every assertion about them and
   about `pyrus-boot-neural-root` / `bootNeuralHtmlEntryPlugin` / boot-neural rollup inputs
   (inside the test at ~34-69). Keep the light/dark token assertions and the `pyrus-boot-word`
   assertion. Add two inverse guards in the same test:
   `assert.doesNotMatch(indexHtml, /pyrus-boot-neural-root/);` and
   `assert.doesNotMatch(viteConfig, /boot-neural/);`
   (IMPORTANT: the index.html guard is on `pyrus-boot-neural-root`, NOT on `boot-neural` — the
   crash-diagnostics script legitimately keeps `/src/boot-neural.tsx` path strings.)

## Slice A2 — NeuralBootOverlay owns the whole boot (after A1)

All in `src/components/neural/NeuralBootOverlay.tsx` plus one call-site line in `src/app/App.tsx`.

1. Replace the per-mount `readShouldPlay()` decision with a module-level const computed once at
   import time: mode `"opener"` when `shouldPlayNeuralOpener()` is true AND sessionStorage
   `pyrus_loader_seen` is unset; `"static"` when the key is unset but the opener gates fail;
   `"off"` when the key is set. Preserve the existing try/catch semantics around sessionStorage
   reads (see current `readShouldPlay`, lines ~25-38). Keep the `SESSION_KEY` name.
2. At module scope: if mode is `"opener"`, run `void import("./NeuralCanvas");` (kicks the
   neural + vendor-three chunk fetch in parallel with AppContent; Vite dedupes with the existing
   `lazy(() => import("./NeuralCanvas"))`). If mode is NOT `"off"`, call
   `setNeuralOpenerActive(true)` at module scope so loaders underneath degrade to cheap static
   renders in the very first commit. The existing unmount cleanup (`setNeuralOpenerActive(false)`)
   stays.
3. Replace the `Suspense fallback={<BrandLoader .../>}` (~lines 92-100) with a module-private
   `BootShellScreen({ progress })` component that replicates the static index.html loader
   EXACTLY, reusing the classes already styled by index.html's inline `<style>` (those styles
   live in `<head>` and survive the `#root` wipe): a wrapper div with class `pyrus-boot-loader`
   but `data-testid="neural-stage-fallback"` (NOT `pyrus-boot-loader` — main.tsx and e2e key on
   that testid), containing `<div class="pyrus-boot-neural-fallback" aria-hidden="true"/>`, the
   `.pyrus-boot-lockup` > `.pyrus-boot-word` ("PYRUS") markup, and the `.pyrus-boot-progress`
   row rendering LIVE `progress.label` / `progress.percent` (match the static markup's structure
   and class names 1:1 — copy them from index.html). Add a one-line comment on BOTH sides
   (index.html style block AND this component) noting the shared-class coupling.
4. `"static"` mode branch: render the same `.neural-overlay` wrapper div (background + z-index
   120 come from index.css `.neural-overlay` rules) with `data-testid="neural-boot-static"`,
   containing `BootShellScreen` with live progress; set the `pyrus_loader_seen` session key on
   mount (same one-shot semantics as the opener); unmount (return null permanently) when
   `progress.complete` OR after a hardcoded `12000` ms backstop timer. Do NOT import `TIMING`
   from `./neural-core/types` for the constant — that module belongs to the lazy `neural`
   manualChunk and a static import would drag `vendor-three` onto the eager path. Hardcode
   `12000` with a comment `// mirrors TIMING.maxWaitMs (neural-core/types) — do not import (chunk boundary)`.
5. Remove the now-unused `BrandLoader` and `useBootHandoffElapsedMs` imports and the
   `bootLoaderElapsedMs` prop from this file; in `src/app/App.tsx` drop that prop from the
   `<NeuralBootOverlay ... />` call (~line 132). Do NOT touch `AppShellFallback` (~lines
   101-113) — it keeps its own `bootLoaderElapsedMs` usage.
6. Do NOT change: `data-testid="neural-stage"` on the opener wrapper, the MorphMachine wiring,
   `OPENER_CORE_PROPS`, the `__contentReady`/`__splashHiding`/`__hideSplash` parity globals,
   the `onReveal`/`onDisperseStart` flow, `.neural-overlay--revealing` handling.

## Slice A5 — dead-code cleanup (after A1; disjoint vite.config.ts lines)

1. Re-verify zero importers before each deletion:
   `rg -n "marketing/neural-stage|marketing/neural-loader|marketing/brand-loader|components/LogoLoader|from \"./neural-stage\"|from \"./neural-loader\"|from \"./brand-loader\"" src e2e scripts ../..` scoped
   to `artifacts/pyrus` — the ONLY expected hits are the `data-testid="neural-stage"` string in
   `NeuralBootOverlay.tsx` (a testid, not an import) and the manualChunks path string in
   `vite.config.ts`. If you find a real import, SKIP that deletion and record it.
2. Delete: `src/components/marketing/neural-stage.tsx`, `src/components/marketing/neural-loader.tsx`,
   `src/components/marketing/brand-loader.tsx`, `src/components/LogoLoader.tsx`.
3. `vite.config.ts`: remove the `"/src/components/LogoLoader"` entry from the `ui-core`
   manualChunks block (~line 424).
4. Note: `loadingFallbackTheme.test.mjs` asserts LogoLoader is ABSENT from AppContent/PlatformApp
   — your deletions are consistent with it; leave those assertions alone.

## Acceptance gate (after EACH slice)

1. `pnpm --filter @workspace/pyrus run typecheck` green.
2. `node --test src/features/platform/loadingFallbackTheme.test.mjs` — the ONLY failure allowed
   is the ledger favicon failure ("React loaders use the current Pyrus brand kit assets").
3. After A1: `rg -n "boot-neural|__PYRUS_BOOT_NEURAL|__PYRUS_DISPOSE_BOOT_NEURAL|pyrus-boot-loader--webgl" src vite.config.ts index.html`
   → the only remaining hits are inside index.html's crash-diagnostics script
   (`isOptionalBootNeuralScriptPath` and its patterns) and the test file's inverse guard.
4. After A2: `node --test src/components/neural/*.test.mjs` if such tests exist (run
   basename-matching siblings of touched files only); plus
   `rg -n "neural-stage-fallback|neural-boot-static" src` shows your new testids only in
   NeuralBootOverlay.tsx.
5. After A5: repeat the rg of step A5.1 → zero import hits.

## Deliverable

Write `.codex-watch/wo-boot-01-report.md`: per slice — files touched, what was deleted, gate
command results with verbatim tails, any skips/deviations with reasons. Do NOT commit. Do NOT
dispatch other work orders.
