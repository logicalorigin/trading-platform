# WO-LOGIN-01 Report

## Files touched

- `artifacts/pyrus/src/components/neural/neuralOpenerState.ts`
- `artifacts/pyrus/src/components/neural/NeuralLoader.tsx`
- `artifacts/pyrus/src/features/auth/LoginGate.jsx`
- Deleted `artifacts/pyrus/src/components/ui/button.tsx`

## Layout summary

- Replaced the full-screen centered login wrapper with `LoginShell`.
- `isLoading` now renders `<LoginShell>{null}</LoginShell>` so the brand stage is visible while auth resolves.
- Signed-out login renders a split panel: theme-following brand stage on the left/top, flattened auth card on the right/bottom.
- Brand stage includes `data-testid="login-brand-stage"`, ambient neural cloud, opener-aware static `PyrusMark` fallback, `BrandResolve`, `PyrusWordmark`, and tagline.
- Auth submit flow, endpoints, validators, firstrun mode, form `aria-label`, input ids/types/autocomplete, and the boot-lane `skipBootProgressTasks` effect were preserved.

## Button prop mapping

- Source observed: `src/components/ui/Button.jsx` exports named `Button`; no default export exists.
- Used `import { Button } from "../../components/ui/Button.jsx";`.
- Used house props `variant="primary"` and `size="lg"`.
- Used `dataTestId="login-gate-submit"` because the house Button maps that prop to DOM `data-testid`.
- Preserved submit DOM selector intent with exactly one `login-gate-submit` source hit.

## Gate results

Workspace-root report gate:

```text
test ! -e /home/runner/workspace/.codex-watch/wo-login-01-report.md; printf 'root_report_absent=%s\n' $?
root_report_absent=0
```

Workspace-root predecessor report gate:

```text
test -e /home/runner/workspace/.codex-watch/wo-boot-02-report.md; printf 'root_boot_report_exists=%s\n' $?
root_boot_report_exists=0
```

Owned clean-check before edits:

```text
git status --short -- src/components/neural/neuralOpenerState.ts src/components/neural/NeuralLoader.tsx src/components/ui/button.tsx
```

No output.

Pre-start typecheck note:

```text
pnpm --filter @workspace/pyrus run typecheck

> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit

error TS6053: File '/home/runner/workspace/artifacts/pyrus/src/components/LogoLoader.tsx' not found.
error TS6053: File '/home/runner/workspace/artifacts/pyrus/src/components/marketing/brand-loader.tsx' not found.
error TS6053: File '/home/runner/workspace/artifacts/pyrus/src/components/marketing/neural-loader.tsx' not found.
error TS6053: File '/home/runner/workspace/artifacts/pyrus/src/components/marketing/neural-stage.tsx' not found.
```

Observed cause was stale ignored `.tsbuildinfo`; `pnpm --filter @workspace/pyrus exec tsc -p tsconfig.json --noEmit --incremental false` exited 0. After removing the ignored cache, the exact gate passed:

```text
pnpm --filter @workspace/pyrus run typecheck

> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Final typecheck:

```text
pnpm --filter @workspace/pyrus run typecheck

> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Dark/z-index gate:

```text
rg -n "className=\"dark\"|zIndex: 130" src/features/auth/LoginGate.jsx
```

No output.

Submit selector gate:

```text
rg -n "login-gate-submit" src/features/auth/LoginGate.jsx
433:              dataTestId="login-gate-submit"
```

Lowercase button importer gate:

```text
rg -n "components/ui/button\b|ui/button\.tsx|from \"../../components/ui/button" src e2e
```

No output.

E2E selector check:

```text
rg -n "LoginGate|login-gate" e2e
```

No output. No e2e specs depend on changed LoginGate markup.

Auth sibling node tests:

```text
find src/features/auth -maxdepth 1 -name '*.test.mjs' -print
```

No output; no basename sibling auth `.test.mjs` files exist, so `node --test src/features/auth/*.test.mjs` was not run.

## Deviations

- Used named Button import instead of default import because the house file has no default export and existing repo imports all use the named export.
- Used `dataTestId` instead of literal `data-testid` on the house Button because `Button.jsx` consumes `dataTestId` and renders DOM `data-testid`.
- Cleared ignored local `.tsbuildinfo` before starting after proving it was the cause of the exact pre-start typecheck failure.
