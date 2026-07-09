# WO-BOOT-02 Report

## Files Touched

- `artifacts/pyrus/src/app/bootProgress.ts`
- `artifacts/pyrus/src/app/AppContent.tsx`
- `artifacts/pyrus/src/features/auth/LoginGate.jsx`
- `.codex-watch/wo-boot-02-report.md`

## Diff Summary

- Moved `PLATFORM_BOOT_PROGRESS_TASK_IDS` from `AppContent.tsx` to `bootProgress.ts`, preserving the task list and `BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS` composition.
- Updated `AppContent.tsx` to import `PLATFORM_BOOT_PROGRESS_TASK_IDS` from `./bootProgress` and keep the existing lab-mode skip logic unchanged.
- Updated `LoginGate.jsx` to import `useEffect`, `PLATFORM_BOOT_PROGRESS_TASK_IDS`, and `skipBootProgressTasks`.
- Lowered the login wall from `zIndex: 130` to `zIndex: 110` and removed the dead `className="dark"`.
- Added the signed-out skip effect so platform boot tasks settle when `PlatformApp` never mounts.

## Gate Results

### Pre-start report gate

Command:

```sh
test ! -e .codex-watch/wo-boot-02-report.md && printf 'report_absent\n' || { printf 'report_exists\n'; exit 1; }
```

Output:

```text
report_absent
```

### Pre-start owned-file clean gate

Command:

```sh
git status --porcelain -- artifacts/pyrus/src/features/auth/LoginGate.jsx artifacts/pyrus/src/app/bootProgress.ts artifacts/pyrus/src/app/AppContent.tsx
```

Output:

```text
```

### Pre-start typecheck

Command:

```sh
pnpm --filter @workspace/pyrus run typecheck
```

Output:

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Exit code: 0

### Acceptance typecheck

Command:

```sh
pnpm --filter @workspace/pyrus run typecheck
```

Output:

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Exit code: 0

### Acceptance rg: platform task IDs

Command:

```sh
rg -n "PLATFORM_BOOT_PROGRESS_TASK_IDS" src
```

Output:

```text
src/features/auth/LoginGate.jsx:30:  PLATFORM_BOOT_PROGRESS_TASK_IDS,
src/features/auth/LoginGate.jsx:132:        PLATFORM_BOOT_PROGRESS_TASK_IDS,
src/app/AppContent.tsx:13:  PLATFORM_BOOT_PROGRESS_TASK_IDS,
src/app/AppContent.tsx:435:        PLATFORM_BOOT_PROGRESS_TASK_IDS,
src/app/bootProgress.ts:89:export const PLATFORM_BOOT_PROGRESS_TASK_IDS = [
```

Exit code: 0

### Acceptance rg: removed login wall markers

Command:

```sh
rg -n "zIndex: 130|className=\"dark\"" src/features/auth/LoginGate.jsx
```

Output:

```text
```

Exit code: 1 (zero hits)
