# WO-BOOT-02 — LoginGate layering + signed-out boot completion (boot-consolidation lane, worker 2 of 3)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, executing the approved
boot-sequence consolidation plan (2026-07-08). All paths relative to `artifacts/pyrus/`.

**Prime directive:** two small, surgical fixes. (1) On a signed-out cold load the boot opener
deadlocks: the blocking boot task `first-screen` only settles inside PlatformApp, which never
mounts signed-out, so the opener loops invisibly behind the login wall until its 12 s backstop.
(2) The login wall sits at z-index 130 ABOVE the opener overlay (z 120), and its
`className="dark"` is a dead no-op (theme tokens key off `:root[data-pyrus-theme]`, never a
`.dark` class — verified at runtime: it renders light).
Zero change to auth endpoints, validators, form markup, or testids.
Ponytail discipline binds (`.claude/skills/ponytail/SKILL.md`, level full).

## Gate (check-and-abort)

1. `.codex-watch/wo-boot-02-report.md` does not already exist.
2. `pnpm --filter @workspace/pyrus run typecheck` green before starting.
3. `src/features/auth/LoginGate.jsx`, `src/app/bootProgress.ts`, `src/app/AppContent.tsx` are
   clean in `git status --porcelain`. If dirty, ABORT and report (another lane owns them).

## Ownership + tree rules

- Touch ONLY the three files named above. Any other dirty file in `git status` belongs to
  another lane (an IBKR OAuth lane runs concurrently) — never touch it.
- Do NOT `git commit` / `git add` / push. Do NOT run the app, browsers, or `pnpm shot`.
  Gates: typecheck + `rg` only.

## Changes

1. `src/app/bootProgress.ts`: add an exported const `PLATFORM_BOOT_PROGRESS_TASK_IDS` — move the
   array VERBATIM from `src/app/AppContent.tsx` (~lines 28-36; it composes
   `BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS`, which already lives in bootProgress.ts). Place it near
   that existing export. Why the move: LoginGate needs it, and importing from AppContent would
   create a cycle (AppContent imports LoginGate).
2. `src/app/AppContent.tsx`: delete the local const, import `PLATFORM_BOOT_PROGRESS_TASK_IDS`
   from `./bootProgress` (it is used at ~line 445 in the lab-mode skip). No other change.
3. `src/features/auth/LoginGate.jsx`, in `FullScreenCenter` (~lines 38-57):
   - `zIndex: 130` → `zIndex: 110` (below the boot overlay/curtain at 120, above the workspace
     progress overlay at 80; nothing else renders while signed out).
   - Delete `className="dark"` (dead code — see prime directive).
4. `src/features/auth/LoginGate.jsx`, in the `LoginGate` component body (after the existing
   hooks): add

   ```jsx
   // Signed-out visitors never mount PlatformApp, so its blocking boot tasks
   // would never settle and the boot overlay would idle until its backstop.
   // Skip them so the opener forms, disperses, and reveals the sign-in wall.
   useEffect(() => {
     if (!isLoading && !signedIn) {
       skipBootProgressTasks(
         PLATFORM_BOOT_PROGRESS_TASK_IDS,
         "Signed-out visitor — showing sign-in",
       );
     }
   }, [isLoading, signedIn]);
   ```

   Imports: `useEffect` from react (extend the existing react import), and
   `import { PLATFORM_BOOT_PROGRESS_TASK_IDS, skipBootProgressTasks } from "../../app/bootProgress";`
   Precedent to mirror: the lab-mode skip in `src/app/AppContent.tsx` (~lines 442-449).
   `skipBootProgressTasks` is a no-op on already-settled tasks, so repeat/signed-in-later loads
   are unaffected.

## Do NOT touch

Anything else in LoginGate (form, card, endpoints, `data-testid="login-gate-submit"`,
`isLoading` early-return shape, signedIn return); bootProgress task list/weights/semantics
(you only ADD one exported const); AppContent's lab-mode logic.

## Acceptance gate

1. `pnpm --filter @workspace/pyrus run typecheck` green.
2. `rg -n "PLATFORM_BOOT_PROGRESS_TASK_IDS" src` → exactly: the export in bootProgress.ts, the
   import+use in AppContent.tsx, the import+use in LoginGate.jsx.
3. `rg -n "zIndex: 130|className=\"dark\"" src/features/auth/LoginGate.jsx` → zero hits.

## Deliverable

Write `.codex-watch/wo-boot-02-report.md`: files touched, the exact diff hunks (or summary),
gate results verbatim. Do NOT commit. Do NOT dispatch other work orders.
