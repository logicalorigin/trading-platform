# WO-FIX-14 Report

## Observed

- Worktree status was already dirty before edits, including `artifacts/pyrus/src/features/auth/LoginGate.jsx` and `artifacts/pyrus/src/components/neural/NeuralBootOverlay.tsx`.
- `readAuthSession` now creates an 8000ms timeout signal and merges it with the React Query cancellation signal before fetching `/api/auth/session`.
- Added `artifacts/pyrus/src/features/auth/authSession.test.mjs`.
- Added an opener-mode boot overlay backstop that releases the opener after the same 12000ms window used by static mode.

## Inferred

- A hung `/api/auth/session` fetch was keeping the auth query in `isLoading`, which kept `LoginGate` on the loading wall.
- Rejecting the hung fetch lets React Query enter `isError` with `retry: false`; `LoginGate` treats that as not signed in and falls through to the sign-in wall.

## Unknown

- I did not run browser QA against the full app runtime.
- I did not inspect or modify unrelated dirty worktree files.

## Files Changed

- `artifacts/pyrus/src/features/auth/authSession.jsx`
- `artifacts/pyrus/src/features/auth/authSession.test.mjs`
- `artifacts/pyrus/src/components/neural/NeuralBootOverlay.tsx`
- `.codex-watch/wo-fix-14-report.md`

## Verification

- `pnpm exec tsx --test src/features/auth/authSession.test.mjs` passed.
- `pnpm exec tsx --test src/components/neural/neural-core/morphMachine.test.ts` passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.

## Status

DONE
