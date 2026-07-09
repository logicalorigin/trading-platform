# WO-FIX-10 Report

## Observed Facts

- Initial `git status --porcelain --` for the whole repo was not clean, but the touched target files were clean before edit.
- Frontend callers checked:
  - `artifacts/pyrus/src/app/crashDiagnostics.tsx` reads `/api/diagnostics/latest`.
  - `artifacts/pyrus/src/features/platform/useMemoryPressureSignal.js` opens `/api/diagnostics/stream`, but `PlatformApp` is behind `LoginGate`.
  - `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx` reads `history`, `events`, event detail, `stream`, and builds the `export` URL.
  - `artifacts/pyrus/src/app/AppContent.tsx`, `PlatformErrorBoundary.tsx`, `DiagnosticsScreen.jsx`, and `performanceMetrics.ts` post client telemetry.
  - No frontend caller was found for direct `/api/diagnostics/storage/prune`, `/api/diagnostics/market-data/gex-universe-refresh`, or `/api/diagnostics/market-data/price-trace`.
  - Settings uses `/api/settings/backend/actions/diagnostics.storage.prune`, which is already covered by the global admin settings prefix.

## Route Decision Table

| Method | Route | Classification | Guard | Decision |
|---|---|---|---|---|
| GET | `/diagnostics/latest` | Read-only cheap rollup | Anonymous | Kept public for crash diagnostics/latest pressure reads that can run outside the signed-in workspace. |
| GET | `/diagnostics/history` | Heavy read | `requireUser` | Gated before DB-backed historical snapshot listing. |
| GET | `/diagnostics/events` | Heavy read | `requireUser` | Gated before DB-backed event listing. |
| GET | `/diagnostics/events/:eventId` | Heavy/detail read | `requireUser` | Gated before diagnostic detail lookup. |
| GET | `/diagnostics/export` | Heavy/export read | `requireUser` | Gated raw diagnostics export. |
| GET | `/diagnostics/thresholds` | Read-only config | `requireUser` | No pre-auth caller observed, so gated. |
| PUT | `/diagnostics/thresholds` | State-changing config update | `requireAdminCsrf` | Admin+CSRF operator action. |
| POST | `/diagnostics/client-events` | State-changing telemetry write | `requireUser` | Gated all POSTs; no CSRF to preserve existing fire-and-forget browser callers after login. |
| POST | `/diagnostics/client-metrics` | State-changing telemetry write | `requireUser` | Gated all POSTs; no CSRF to preserve existing fire-and-forget browser callers after login. |
| POST | `/diagnostics/browser-reports` | State-changing browser report write | `requireUser` | Gated all POSTs; no CSRF because browser reporting endpoints cannot attach app CSRF headers. |
| POST | `/diagnostics/storage/prune` | State-changing storage maintenance | `requireAdminCsrf` | Admin+CSRF operator action. |
| POST | `/diagnostics/market-data/gex-universe-refresh` | Heavy refresh trigger | `requireAdminCsrf` | Admin+CSRF operator action, including dry-run requests. |
| GET | `/diagnostics/market-data/price-trace` | Heavy diagnostic trace | `requireUser` | Gated before serial DB freshness trace work. |
| GET | `/diagnostics/stream` | Long-lived diagnostic stream | `requireUser` | Gated; observed caller is inside the login-gated workspace. |

## Diff Summary

- `artifacts/api-server/src/routes/diagnostics.ts`
  - Imported `requireUser` and `requireAdminCsrf`.
  - Added per-handler guards for diagnostics history, events, detail, export, thresholds, telemetry posts, storage prune, GEX universe refresh, price trace, and stream.
  - Did not add `/diagnostics` to the global prefix auth lists.
- `artifacts/api-server/src/routes/automation-route-auth.test.ts`
  - Added diagnostics route samples mirroring the existing route-auth test pattern.
  - Added unauthenticated 401 coverage for all newly gated diagnostics routes.
  - Added authenticated non-admin 403 coverage for admin diagnostics routes.

## Tests

Command:

```text
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/routes/automation-route-auth.test.ts
```

Result:

```text
tests 9
suites 0
pass 9
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 97125.32029
```

Additional check attempted:

```text
pnpm --filter @workspace/api-server run typecheck
```

Result:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit

src/services/overnight-spot-execution.test.ts(61,9): error TS2322: Type '{ loadDeployment: ((deploymentId: string) => Promise<OvernightSpotDeployment>) | (() => Promise<{ id: string; name: string; mode: "shadow"; enabled: boolean; providerAccountId: string; symbolUniverse: string[]; config: { ...; }; }>); ... 10 more ...; notifyChanged: (input: { ...; }) => void; }' is not assignable to type 'OvernightSpotExecutionDependencies'.
  Types of property 'markLiveOrderIntent' are incompatible.
    Type '((input: OvernightSpotLiveOrderIntentUpdateInput) => Promise<Record<string, unknown> | null>) | undefined' is not assignable to type '(input: OvernightSpotLiveOrderIntentUpdateInput) => Promise<Record<string, unknown> | null>'.
      Type 'undefined' is not assignable to type '(input: OvernightSpotLiveOrderIntentUpdateInput) => Promise<Record<string, unknown> | null>'.
/home/runner/workspace/artifacts/api-server:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @workspace/api-server@0.0.0 typecheck: `node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit`
Exit status 2
```

Observed as outside this change set; neither `overnight-spot-execution.test.ts` nor the overnight spot execution dependencies were edited for WO-FIX-10.
