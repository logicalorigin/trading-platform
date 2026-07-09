# WO-BOOT-01 Report

Date: 2026-07-08
Worker: boot-consolidation lane, worker 1 of 3

## Preflight

- Report gate: `.codex-watch/wo-boot-01-report.md` was absent.
- Named-file dirtiness gate: clean before start for `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/app/App.tsx`, `src/components/neural/NeuralBootOverlay.tsx`, `src/features/platform/loadingFallbackTheme.test.mjs`.
- Typecheck before start: passed.

Tail:

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

## Slice A1

Files touched:

- `index.html`
- `vite.config.ts`
- `src/main.tsx`
- `src/features/platform/loadingFallbackTheme.test.mjs`
- Deleted `src/boot-neural.tsx`
- Deleted `src/boot-neural-scene.tsx`

What changed:

- Removed the pre-React boot-neural root from static HTML.
- Removed `.pyrus-boot-neural-root` and `pyrus-boot-loader--webgl` styling while preserving `.pyrus-boot-neural-fallback`.
- Removed Vite's boot-neural HTML entry plugin and rollup inputs.
- Removed `__PYRUS_DISPOSE_BOOT_NEURAL__` handoff disposal from `src/main.tsx`.
- Updated `loadingFallbackTheme.test.mjs` to assert absence of `pyrus-boot-neural-root` and `boot-neural` in `vite.config.ts`.

Gate results:

`pnpm --filter @workspace/pyrus run typecheck`: passed.

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

`node --test src/features/platform/loadingFallbackTheme.test.mjs`: expected ledger failure only.

```text
✔ React boot loader uses theme tokens instead of forcing dark mode
✔ static boot loader has a light default and an explicit dark override
✔ launch and header brand surfaces use neural resolve animation
✖ React loaders use the current Pyrus brand kit assets
✔ PyrusWordmark stays owned by the wordmark module
✔ lazy screen fallbacks use the platform theme variables
ℹ pass 5
ℹ fail 1
AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /\/brand\//.
<link rel="icon" type="image/svg+xml" href="/brand/pyrus-mark.svg" />
```

`rg -n "boot-neural|__PYRUS_BOOT_NEURAL|__PYRUS_DISPOSE_BOOT_NEURAL|pyrus-boot-loader--webgl" src vite.config.ts index.html`: completed with expected crash-diagnostics and inverse-guard hits, plus preserved fallback-class hits.

```text
index.html:248:          pathname.endsWith("/src/boot-neural.tsx") ||
index.html:249:          pathname.endsWith("/src/boot-neural-scene.tsx") ||
index.html:250:          /\/assets\/boot-neural(?:-scene)?-[^/]+\.js$/.test(pathname);
index.html:508:      .pyrus-boot-neural-fallback {
index.html:514:      .pyrus-boot-neural-fallback {
index.html:526:      html[data-pyrus-theme="dark"] .pyrus-boot-neural-fallback {
index.html:627:        .pyrus-boot-neural-fallback {
index.html:646:        <div class="pyrus-boot-neural-fallback" aria-hidden="true"></div>
src/features/platform/loadingFallbackTheme.test.mjs:39:  assert.doesNotMatch(indexHtml, /pyrus-boot-neural-root/);
src/features/platform/loadingFallbackTheme.test.mjs:40:  assert.doesNotMatch(viteConfig, /boot-neural/);
```

Deviation note:

- The literal A1 grep expectation conflicts with the order to keep `.pyrus-boot-neural-fallback`; the fallback class necessarily matches `boot-neural`. I preserved it because A1 explicitly says to keep it untouched and A2 reuses it.

## Slice A2

Files touched:

- `src/components/neural/NeuralBootOverlay.tsx`
- `src/app/App.tsx`
- `index.html` comment coupling to the React replica styles

What changed:

- Replaced per-mount opener decision with module-level `BOOT_MODE` of `opener`, `static`, or `off`.
- Started `./NeuralCanvas` import at module scope for opener mode.
- Marked neural opener active at module scope for opener/static modes.
- Replaced the Suspense fallback with `BootShellScreen`, a React replica of the static boot loader classes and structure.
- Added static mode overlay with `data-testid="neural-boot-static"`, live progress, session key write on mount, and 12000 ms backstop.
- Dropped `bootLoaderElapsedMs` from `NeuralBootOverlay` and its App call site.

Gate results:

`pnpm --filter @workspace/pyrus run typecheck`: passed.

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

`node --test src/features/platform/loadingFallbackTheme.test.mjs`: expected ledger failure only.

```text
✔ React boot loader uses theme tokens instead of forcing dark mode
✔ static boot loader has a light default and an explicit dark override
✔ launch and header brand surfaces use neural resolve animation
✖ React loaders use the current Pyrus brand kit assets
✔ PyrusWordmark stays owned by the wordmark module
✔ lazy screen fallbacks use the platform theme variables
ℹ pass 5
ℹ fail 1
AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /\/brand\//.
<link rel="icon" type="image/svg+xml" href="/brand/pyrus-mark.svg" />
```

`node --test src/components/neural/*.test.mjs`: skipped; no `*.test.mjs` files exist directly under `src/components/neural`.

`rg -n "neural-stage-fallback|neural-boot-static" src`: passed, both hits only in `NeuralBootOverlay.tsx`.

```text
src/components/neural/NeuralBootOverlay.tsx:62:      data-testid="neural-stage-fallback"
src/components/neural/NeuralBootOverlay.tsx:134:        data-testid="neural-boot-static"
```

## Slice A5

Files touched:

- Deleted `src/components/marketing/neural-stage.tsx`
- Deleted `src/components/marketing/neural-loader.tsx`
- Deleted `src/components/marketing/brand-loader.tsx`
- Deleted `src/components/LogoLoader.tsx`
- `vite.config.ts`

What changed:

- Removed the four dead loader files.
- Removed `"/src/components/LogoLoader"` from the `ui-core` manualChunks block.

Pre-delete importer verification:

- No live imports were found in app code.
- The mandated broad grep did find non-import path strings in `src/components/marketing/brandKitInstall.test.mjs` and historical docs/handoffs through `../..`.

Gate results:

`pnpm --filter @workspace/pyrus run typecheck`: passed.

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

`node --test src/features/platform/loadingFallbackTheme.test.mjs`: expected ledger failure only.

```text
✔ React boot loader uses theme tokens instead of forcing dark mode
✔ static boot loader has a light default and an explicit dark override
✔ launch and header brand surfaces use neural resolve animation
✖ React loaders use the current Pyrus brand kit assets
✔ PyrusWordmark stays owned by the wordmark module
✔ lazy screen fallbacks use the platform theme variables
ℹ pass 5
ℹ fail 1
AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /\/brand\//.
<link rel="icon" type="image/svg+xml" href="/brand/pyrus-mark.svg" />
```

Post-delete `rg -n "marketing/neural-stage|marketing/neural-loader|marketing/brand-loader|components/LogoLoader|from \"./neural-stage\"|from \"./neural-loader\"|from \"./brand-loader\"" src e2e scripts ../..`: no live app-code importers; remaining hits are non-import path strings or historical docs/handoffs.

Tail:

```text
../../samples/INSTALL.md:124:import { NeuralStage } from "@/components/marketing/neural-stage";
../../samples/INSTALL.md:125:import { BrandLoader } from "@/components/marketing/brand-loader";
../../samples/INSTALL.md:126:import { NeuralLoader } from "@/components/marketing/neural-loader";
../../artifacts/pyrus/src/components/marketing/brandKitInstall.test.mjs:20:  "src/components/marketing/neural-stage.tsx",
../../artifacts/pyrus/src/components/marketing/brandKitInstall.test.mjs:21:  "src/components/marketing/neural-loader.tsx",
../../artifacts/pyrus/src/components/marketing/brandKitInstall.test.mjs:22:  "src/components/marketing/brand-loader.tsx",
```

Deviation note:

- I did not edit `src/components/marketing/brandKitInstall.test.mjs` because it is not named in this work order's touch list. Its path-string references remain and are not importers.
- The mandated `../..` grep scope also includes historical docs, samples, and handoffs outside this lane's ownership.

## Final Working Tree Scope

Tracked changes left uncommitted as requested:

```text
 M artifacts/pyrus/index.html
 M artifacts/pyrus/src/app/App.tsx
 D artifacts/pyrus/src/boot-neural-scene.tsx
 D artifacts/pyrus/src/boot-neural.tsx
 D artifacts/pyrus/src/components/LogoLoader.tsx
 D artifacts/pyrus/src/components/marketing/brand-loader.tsx
 D artifacts/pyrus/src/components/marketing/neural-loader.tsx
 D artifacts/pyrus/src/components/marketing/neural-stage.tsx
 M artifacts/pyrus/src/components/neural/NeuralBootOverlay.tsx
 M artifacts/pyrus/src/features/platform/loadingFallbackTheme.test.mjs
 M artifacts/pyrus/src/main.tsx
 M artifacts/pyrus/vite.config.ts
?? .codex-watch/wo-boot-01-report.md
```

Additional check:

`git diff --check -- ...`: passed with no output.
