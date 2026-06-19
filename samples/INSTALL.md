# Pyrus Brand Kit — neural cloud + logo mark + wordmark, with animations

A self-contained drop-in of the Pyrus visual identity, ported from the marketing
site. Everything here is **verified to be import-closed**: every `@/...` import
in these files resolves to another file in this kit. Nothing else from the
marketing repo is required.

This is a **handoff package for a one-shot install** into the platform app
(`trading-platform` / Pyrus). Read this whole file before installing.

> **Handing this to an agent?** Paste `AGENT_INSTALL_PROMPT.md` to it — that's the
> ordered procedure (discover stack → copy → deps → CSS → wire → verify). This
> file is the spec it references.

---

## 1. What's in the kit (three surfaces)

| Surface | Entry component | What it is |
|---|---|---|
| **Neural cloud** | `NeuralBackdrop`, `NeuralStage` | The WebGL particle sphere. `NeuralBackdrop` = ambient fixed-viewport drift behind the whole page. `NeuralStage` = the first-load opener where the dots fly in and **form the logo**, then disperse and hand off to the backdrop. |
| **Logo mark** | `PyrusMark` (2D SVG), `PyrusMark3D` (3D) | The concentric-ring mark with the blue→violet→red gradient. `PyrusMark` is dependency-free vector; `PyrusMark3D` is the lazy R3F version that falls back to the SVG. |
| **Wordmark + resolve** | `BrandResolve`, `BrandLoader`, `NeuralLoader` | "Logo resolves out of the sphere" moment. `BrandLoader` = transient route loader; `NeuralLoader` = looping full-page loader; `BrandResolve` = the reusable primitive (header logo, splash, etc.). The PYRUS wordmark is the `pyrus-wordmark-tight.png` asset. |

All animation engines share **one** module: `components/marketing/neural-core/`
(the `NeuralCore` WebGL particle system + GLSL shaders + the sampled logo/
wordmark point clouds).

---

## 2. Install steps (do all of these)

### 2a. Copy files
Copy the kit's `src/**` into the app's `src/**`, preserving paths:

```
src/components/marketing/neural-core/*        (7 files — the engine)
src/components/marketing/neural-core-scene.tsx
src/components/marketing/neural-stage.tsx
src/components/marketing/neural-backdrop.tsx
src/components/marketing/neural-loader.tsx
src/components/marketing/brand-resolve.tsx
src/components/marketing/brand-loader.tsx
src/components/marketing/pyrus-mark.tsx
src/components/marketing/pyrus-mark-shared.tsx
src/components/marketing/pyrus-mark-3d.tsx
src/components/marketing/pyrus-mark-3d-scene.tsx
src/components/marketing/pyrus-logo.standalone.tsx   (optional — see §6)
src/lib/pyrus-mark-geometry.ts
src/lib/observe-visibility.ts
src/lib/utils.ts                              (the `cn()` helper — MERGE, see §2e)
```

Copy the public assets to the app's static/public root:
```
public/brand/pyrus-wordmark-tight.png   (REQUIRED — the PYRUS wordmark in BrandLoader/BrandResolve)
public/brand/pyrus-mark.svg             (optional static favicon-style mark)
public/brand/pyrus-mark-dark.svg        (optional)
```
> The components reference the wordmark by absolute URL `"/brand/pyrus-wordmark-tight.png"`.
> Keep that path, or grep for it in `brand-loader.tsx` + `brand-resolve.tsx` and update.

### 2b. Install npm dependencies
Exact versions used by the source (React 19 is **required** — `@react-three/fiber` v9 needs it):

```
react@19.1.0  react-dom@19.1.0
three@^0.184.0
@react-three/fiber@^9.6.1
@react-three/postprocessing@^3.0.4   (only pyrus-mark-3d-scene uses this)
clsx@^2.1.1
tailwind-merge@^3.3.1
# dev
@types/three@^0.184.1
```
`@react-three/drei` is **not** needed. `react-dom` is only the app peer, not imported by the kit.

### 2c. The `@/` path alias — REQUIRED
Every import uses `@/` to mean the app's `src/` root (e.g. `@/components/marketing/...`,
`@/lib/utils`). The app must already resolve `@/` → `src/`. Verify in `tsconfig.json`:
```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```
and in `vite.config.ts`:
```ts
resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } }
```
If the app uses a different alias, find-and-replace `@/` in the kit's files.

### 2d. CSS — append `src/styles/brand.css`
`@import "./styles/brand.css";` from the app's global CSS, or paste its contents in.
It carries the keyframes the components reference by class name (`.pyrus-ring`,
`.brand-resolve-sphere`, `.brand-loader-word`, etc.) **plus the required theme tokens**.

> **Tailwind version matters.** `brand.css` ends with a `@theme` block (Tailwind v4).
> If the app is on **Tailwind v3**, follow the inline instructions at the bottom of
> `brand.css` (move the `:root` vars over, register the colors in `tailwind.config`,
> delete the `@theme` block). If the app already defines `background` / `foreground`
> / `muted-foreground` color tokens, you can delete the token section entirely.

### 2e. Reconcile `lib/utils.ts` (`cn()`)
Most apps already have a `cn()` helper. If so, **do not overwrite it** — just make
sure `cn` is importable from `@/lib/utils`. The kit's version registers three
custom `text-fluid-*` font-size groups with tailwind-merge; those classes don't
exist in this kit, so a plain `cn = (...a) => twMerge(clsx(a))` works fine. Keep
whichever `cn` the app already trusts.

### 2f. Tailwind v4 ONLY — exclude the 2.2 MB point cloud from scanning
`neural-core/pyrus-logo-points.ts` is a **2.2 MB** file of raw number arrays (a
sampled point cloud — no class names). Tailwind v4's content scanner stalls on it.
Add to the app's global CSS (next to the other `@source` lines):
```css
@source not "./components/marketing/neural-core/pyrus-logo-points.ts";
```
(Path is relative to the CSS file. On Tailwind v3, add it to `content`'s ignore /
just confirm your `content` globs don't force-parse it.)

---

## 3. Usage

```tsx
import { NeuralBackdrop } from "@/components/marketing/neural-backdrop";
import { NeuralStage } from "@/components/marketing/neural-stage";
import { BrandLoader } from "@/components/marketing/brand-loader";
import { NeuralLoader } from "@/components/marketing/neural-loader";
import { BrandResolve } from "@/components/marketing/brand-resolve";
import { PyrusMark } from "@/components/marketing/pyrus-mark";
import { PyrusMark3D } from "@/components/marketing/pyrus-mark-3d";
```

**Ambient cloud behind everything** (mount once, high in the tree):
```tsx
<div className="relative min-h-screen bg-background">
  <NeuralBackdrop />                {/* fixed inset-0 z-0 */}
  <div className="relative z-10">{children}</div>
</div>
```

**First-load opener** (cloud → forms logo → disperses → reveals app):
```tsx
const [revealed, setRevealed] = useState(false);
<>
  <NeuralStage onReveal={() => setRevealed(true)} />
  {revealed && <App />}
</>
```
> ⚠️ `NeuralStage` only plays on paths in its `ENTRY_PATHS` set (`"/"`, `"/app/login"`)
> and once per tab session (`sessionStorage["pyrus_loader_seen"]`). **Edit
> `ENTRY_PATHS` in `neural-stage.tsx`** to match the platform's entry routes, or it
> will no-op everywhere and just call `onReveal()` immediately.

**Loaders:**
```tsx
<BrandLoader />                          {/* transient — route Suspense fallback */}
<NeuralLoader caption="Loading your dashboard…" />   {/* looping — data fetches */}
```

**Header / nav logo** (looping resolve):
```tsx
<BrandResolve loop morph logoVariant="svg" className="h-9 w-9" />
```

**Static mark** (cheap, no WebGL — nav, footer, favicons):
```tsx
<PyrusMark className="h-10 w-10" />
<PyrusMark3D className="h-10 w-10" />   {/* 3D, auto-falls back to PyrusMark */}
```

---

## 4. Behavior / fallbacks (don't "fix" these — they're intentional)

- **No WebGL or `prefers-reduced-motion`** → every neural surface degrades to the
  crisp SVG `PyrusMark` (or renders nothing for the ambient backdrop). The reduced-
  motion CSS in `brand.css` freezes the ring spin + resolve animations.
- **Code-splitting:** `three` + fiber + postprocessing are `lazy()`-loaded via
  `neural-core-scene.tsx` and `pyrus-mark-3d-scene.tsx`, so they land in their own
  chunks and never block first paint. Keep those lazy boundaries intact.
- **`observe-visibility.ts`** pauses the rAF loop when the cloud scrolls off-screen
  or the tab is hidden — leave it wired.
- `NeuralStage` / `BrandResolve` read DEV-only `window.__stageMorph` / `__morphForce`
  pins for tuning; these are `import.meta.env.DEV`-gated and tree-shaken in prod.

## 4b. Build environment + runtime hooks (read this — it's the only non-code dependency)

**Vite-ism:** `neural-stage.tsx` and `brand-resolve.tsx` reference
`import.meta.env.DEV` (only to gate DEV-only morph-tuning pins that tree-shake
out of prod builds).
- On **Vite** this Just Works.
- On a **non-Vite bundler** (Next.js/webpack/etc.), `import.meta.env` may not
  exist and the bundler can choke on `import.meta`. Fix by replacing every
  `import.meta.env.DEV` with `process.env.NODE_ENV !== "production"` (or just
  `false`) in those two files. There are ~4 occurrences total; grep for
  `import.meta.env.DEV`.

**`window.__*` runtime hooks** — all optional, but one matters for timing:

| Global | Who touches it | What to do |
|---|---|---|
| `window.__contentReady` | `NeuralStage` **reads** it | **Set `window.__contentReady = true` when the app is ready to be shown.** The opener holds the formed logo until this is true, then disperses + reveals. If you never set it, the opener still completes via a `MAX_WAIT_MS` (12s) backstop — just on a fixed timer instead of synced to your app. |
| `window.__hideSplash` | `NeuralStage` **calls** it if present | Only needed if you wire a pre-React splash element to hide. No-op if absent — safe to ignore. |
| `window.__splashHiding` | `NeuralStage` **sets** it | A signal for the marketing hero; harmless on the platform. Ignore. |
| `window.__stageMorph` / `__morphForce` / `__scatterForce` | DEV-only tuning pins | Tree-shaken from prod. Ignore. |

Nothing else reads from globals. No env vars, no API calls, no fonts, no data
fetches — the kit is pure client-side rendering.

## 5. One change already applied vs. the source
`pyrus-mark-3d.tsx` originally imported `PyrusMark` from `@/components/marketing/chrome`
(the marketing site's nav/footer shell, which just re-exports it). The kit copy
imports it directly from `@/components/marketing/pyrus-mark` so **`chrome.tsx` is
not needed**. No other edits — these are the marketing site's files verbatim.

## 6. `pyrus-logo.standalone.tsx` (optional)
A fully self-contained SVG lockup (mark + "PYRUS" wordmark drawn as vector, no
PNG, no deps). Include it if you want a wordmark that doesn't depend on the PNG
asset or any CSS. It is independent of the neural system.

---

## Verified
These files were typechecked in isolation (`tsc --strict`, `moduleResolution:
Bundler`, `@/*` → `src/*`) against the exact dep versions in §2b and compile
**clean with zero errors** — provided the app supplies `vite/client` types (the
one-line `/// <reference types="vite/client" />` in `src/vite-env.d.ts` that
every Vite app already has; it's what types `import.meta.env`). No other type
shims are needed.

## Quick verification checklist for the installing agent
- [ ] `@/` resolves to `src/` (tsconfig **and** vite/bundler).
- [ ] Deps installed; React is **19.x**.
- [ ] `brand.css` imported; theme tokens present (or app already defines them).
- [ ] Tailwind v4: `@source not` line added for `pyrus-logo-points.ts`.
- [ ] `public/brand/pyrus-wordmark-tight.png` reachable at `/brand/pyrus-wordmark-tight.png`.
- [ ] `ENTRY_PATHS` in `neural-stage.tsx` updated to the platform's entry routes.
- [ ] If NOT on Vite: `import.meta.env.DEV` swapped out (§4b).
- [ ] App sets `window.__contentReady = true` when ready (only if using `NeuralStage`, §4b).
- [ ] Typecheck passes; a page mounting `<NeuralBackdrop/>` shows the drifting cloud;
      `<BrandLoader/>` shows the sphere condensing into the ring mark + PYRUS wordmark.
