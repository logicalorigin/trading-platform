# WO-LOGIN-01 — split-panel login redesign with neural cloud (login lane, worker 3 of 3)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, executing the approved
login-redesign plan (2026-07-08). All paths relative to `artifacts/pyrus/`.

**Prime directive:** redesign the login screen into a split panel — brand stage left (ambient
neural cloud + animated PYRUS lockup + wordmark + tagline), form column right — THEME-FOLLOWING
(no forced dark). **Zero change to auth behavior**: endpoints, validators, submit flow, error
handling, firstrun mode, `data-testid="login-gate-submit"`, form `aria-label`, input
ids/types/autocomplete all stay byte-identical in behavior. Visual redesign of the login screen
is the point of this order. Ponytail discipline binds (`.claude/skills/ponytail/SKILL.md`, full).

## Gate (check-and-abort)

1. `.codex-watch/wo-login-01-report.md` does not already exist.
2. `.codex-watch/wo-boot-02-report.md` EXISTS (predecessor landed). Because of it,
   `src/features/auth/LoginGate.jsx`, `src/app/bootProgress.ts`, `src/app/AppContent.tsx` are
   ALREADY DIRTY in git status — that is THIS lane's predecessor work (z-index 110, no
   `className="dark"`, a `skipBootProgressTasks` effect). Build ON TOP of it; do not revert it.
3. `pnpm --filter @workspace/pyrus run typecheck` green before starting.
4. Clean-check the OTHER files you own: `src/components/neural/neuralOpenerState.ts`,
   `src/components/neural/NeuralLoader.tsx`, `src/components/ui/button.tsx`. Files dirty from the
   boot lane (`index.html`, `vite.config.ts`, `src/main.tsx`, `src/app/App.tsx`,
   `src/components/neural/NeuralBootOverlay.tsx`, `src/features/platform/*`, deleted
   `boot-neural*.tsx` / marketing files) are EXPECTED and not yours — leave them exactly as-is.

## Ownership + tree rules

- Touch ONLY: `src/features/auth/LoginGate.jsx`, `src/components/neural/neuralOpenerState.ts`,
  `src/components/neural/NeuralLoader.tsx`, and DELETE `src/components/ui/button.tsx` (Slice C).
- Do NOT `git commit` / `git add` / push. Do NOT run the app / browsers / `pnpm shot`.
  Gates: typecheck + `rg` + targeted `node --test` only.
- **Supersession:** `docs/plans/workorders-2026-07-07/wo-cr-02-pyrus-formatter-consolidation.md`
  Slice E planned the same shadcn→house Button migration with a "login looks unchanged" visual
  gate. This order supersedes Slice E (the login is being redesigned on purpose; that baseline
  screenshot is stale). Do not run its visual gate.

## Pre-existing failures ledger

`loadingFallbackTheme.test.mjs` fails at HEAD on a favicon `/brand/` assertion — not yours.

## Slice A — tiny prerequisites

1. `src/components/neural/neuralOpenerState.ts` (currently 15 lines: module flag +
   `setNeuralOpenerActive` + `isNeuralOpenerActive`): add change-notification. A module-level
   `Set<() => void>`; `setNeuralOpenerActive(value)` assigns and notifies listeners ONLY when the
   value actually changed; add `export function subscribeNeuralOpenerActive(listener: () => void): () => void`
   returning an unsubscribe. Keep the file free of `three`/react imports (docstring contract).
2. `src/components/neural/NeuralLoader.tsx` line ~28: `const LOADER_CLOUD_PROPS` →
   `export const LOADER_CLOUD_PROPS`. No other change to this file.

## Slice B — LoginGate split-panel redesign (single file: `src/features/auth/LoginGate.jsx`)

### New imports (match the file's existing relative-import style)

```js
import { Suspense, lazy, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BrandResolve } from "../../components/marketing/brand-resolve";
import { PyrusMark } from "../../components/marketing/pyrus-mark";
import { PyrusWordmark } from "../../components/brand/pyrus-wordmark";
import { usePrefersReducedMotion } from "../../components/marketing/pyrus-mark-3d";
import { isWebglAvailable } from "../../lib/webglCapability";
import { isNeuralOpenerActive, subscribeNeuralOpenerActive } from "../../components/neural/neuralOpenerState";
import { LOADER_CLOUD_PROPS } from "../../components/neural/NeuralLoader";
import { useViewportBelow } from "../../lib/responsive";
const NeuralCoreScene = lazy(() => import("../../components/marketing/neural-core-scene"));
```

(`GLOW`/`G` etc. only if actually used. Keep existing uiTokens imports; extend as needed.)

### Structure

Replace `FullScreenCenter` with a module-private `LoginShell({ children })` used by BOTH the
`isLoading` state (`<LoginShell>{null}</LoginShell>` — kills today's blank-void frame by showing
the brand stage while auth resolves) and the signed-out state (`<LoginShell>{form}</LoginShell>`).

`LoginShell` layout (all inline styles via uiTokens, THEME-FOLLOWING — use `CSS_COLOR.*`
everywhere, never hex):

- Outer div: `position: "fixed", inset: 0, zIndex: 110, display: "grid", background:
  CSS_COLOR.bg0, overflowY: "auto"`, `gridTemplateColumns` = `"minmax(0, 1.2fr) minmax(360px, 1fr)"`
  desktop / `"1fr"` stacked, `gridTemplateRows` stacked = `"minmax(220px, 34vh) 1fr"`.
  Collapse: `const stacked = useViewportBelow(880);`.
- **Brand stage** (first grid cell): `position: "relative", overflow: "hidden", display: "flex",
  flexDirection: "column", alignItems: "center", justifyContent: "center", gap: sp(12),
  padding: sp(24)`, `data-testid="login-brand-stage"`. Contains:
  1. `<AmbientCloud />` — module-private, the NeuralLoader cloud recipe:
     ```jsx
     function AmbientCloud() {
       const reducedMotion = usePrefersReducedMotion();
       const openerActive = useNeuralOpenerActiveState();
       if (reducedMotion || openerActive || !isWebglAvailable()) return null;
       return (
         <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: 0.6, pointerEvents: "none" }}>
           <div style={{
             height: "100%", width: "100%",
             maskImage: "radial-gradient(125% 125% at 50% 45%, #000 55%, transparent 100%)",
             WebkitMaskImage: "radial-gradient(125% 125% at 50% 45%, #000 55%, transparent 100%)",
           }}>
             <Suspense fallback={null}>
               <NeuralCoreScene {...LOADER_CLOUD_PROPS} />
             </Suspense>
           </div>
         </div>
       );
     }
     ```
  2. Lockup block (`position: "relative", zIndex: 1`, `aria-hidden="true"`, centered column,
     gap sp(10)):
     - While the boot opener owns WebGL: static `<PyrusMark className={stacked ? "h-[72px] w-[72px]" : "h-[140px] w-[140px]"} />`;
       otherwise `<BrandResolve loop morph logoVariant="svg" haloBlur={0.45} bloomBlur={1.8}
       webglPolicy="available" className={same sizing} />` (this is the proven NeuralLoader call,
       NeuralLoader.tsx ~148-156). Gate via:
       ```js
       function useNeuralOpenerActiveState() {
         return useSyncExternalStore(subscribeNeuralOpenerActive, isNeuralOpenerActive);
       }
       ```
     - `<PyrusWordmark title="PYRUS" width={stacked ? 150 : 200} />`
     - Tagline `<span>`: `color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize:
       textSize("body"), letterSpacing: "0.02em", textAlign: "center"` — copy (editable):
       `Real-time options flow & signal intelligence.`
- **Form panel** (second grid cell): `display: "flex", alignItems: "center", justifyContent:
  "center", padding: sp(24), background: CSS_COLOR.bg1`, plus on desktop only
  `borderLeft: \`1px solid ${CSS_COLOR.border}\`` (stacked: `borderTop` instead). Children render
  inside a column `width: "100%", maxWidth: dim(380)`.

### Form content changes (inside the existing Card markup)

- Keep the shadcn `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` structure and
  ALL form fields/handlers, but flatten the card visually onto the panel:
  `<Card style={{ width: "100%", background: "transparent", border: "none", boxShadow: "none" }}>`
  (the panel's `bg1` is the surface; `bg-card` is an unregistered no-op anyway).
- `CardTitle`: text becomes the mode heading — `{isFirstRun ? "First-time setup" : "Sign in"}`
  (the wordmark now carries the brand). Style: keep `fontFamily: T.sans`, set
  `fontSize: textSize("screenTitle")`, `fontWeight: FONT_WEIGHTS.emphasis`,
  `color: CSS_COLOR.text`, and REMOVE `letterSpacing: "0.14em"`.
- `CardDescription`: signin copy → `"Welcome back. Sign in to continue."`; firstrun copy
  unchanged; style unchanged.
- Inputs/labels/error block/toggle button: unchanged (they already use tokens).

### Slice C — house Button migration (supersedes WO-CR-02 Slice E)

- Replace `import { Button } from "../../components/ui/button.tsx"` with the house
  `import Button from "../../components/ui/Button.jsx"` (check its default vs named export —
  `src/components/ui/Button.jsx` is a forwardRef component with `SIZES` xs/sm/md/lg and variants
  primary/danger/ghost/soft; read the bottom of the file for the export form and exact prop
  names before writing the call).
- Submit button becomes: house Button with `variant="primary"` `size="lg"`,
  `type="submit"`, `disabled={pending}`, `data-testid="login-gate-submit"`,
  `style={{ width: "100%", opacity: pending ? 0.7 : 1 }}` — DELETE the manual
  `background/color/fontFamily/padding/cursor` overrides (house primary = accent bg +
  onAccent text, which is the approved restyle).
- Then delete the file `src/components/ui/button.tsx` and verify zero remaining importers:
  `rg -n "components/ui/button" src e2e` → zero hits (the house file is `Button.jsx`,
  capital B — do not delete it). If ANY other importer of lowercase `button.tsx` exists, STOP
  the deletion, keep the file, and record it.
- Do NOT touch the shadcn `card.tsx`/`input.tsx`/`label.tsx` files.

### Behavior invariants (re-check before finishing)

- `isLoading` → `<LoginShell>{null}</LoginShell>`; `signedIn` → `children`; else the form.
- The WO-BOOT-02 `skipBootProgressTasks` effect stays exactly as it is.
- At most ONE WebGL context at any moment: while `openerActive` the login renders static
  `PyrusMark` and NO `AmbientCloud`; both flip on reactively via `useSyncExternalStore` when the
  overlay unmounts. BrandResolve self-degrades on reduced-motion/no-WebGL (its own gate +
  error boundary) — no extra gating needed around it beyond the opener guard.
- No layout shift when the cloud chunk resolves (the cloud layer is absolute + paints nothing
  until loaded).

## Acceptance gate

1. `pnpm --filter @workspace/pyrus run typecheck` green.
2. `rg -n "className=\"dark\"|zIndex: 130" src/features/auth/LoginGate.jsx` → zero hits.
3. `rg -n "login-gate-submit" src/features/auth/LoginGate.jsx` → exactly one hit (the submit).
4. `rg -n "components/ui/button\b|ui/button\.tsx|from \"../../components/ui/button" src e2e` →
   zero hits after the deletion.
5. `rg -n "LoginGate|login-gate" e2e` — read any hits and confirm the selectors they use still
   exist in your redesigned markup; if a spec depends on markup you changed, record it in the
   report (do NOT edit e2e specs).
6. `node --test src/features/auth/*.test.mjs` if such files exist (basename siblings only).

## Deliverable

`.codex-watch/wo-login-01-report.md`: files touched, layout summary, Button prop mapping used,
gate results verbatim, any deviations. Do NOT commit. Do NOT dispatch other work orders.
