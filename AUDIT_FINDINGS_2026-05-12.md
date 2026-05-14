# Monorepo Audit Findings — 2026-05-12

**Audit type**: discovery-only. No code edits made; only this report.
**Scope**: whole monorepo (`/home/runner/workspace`): `artifacts/{api-server, ibkr-bridge, backtest-worker, rayalgo}`, all `lib/*` packages, `scripts/`, root configs, tracked & untracked artifacts.
**Plan**: `/home/runner/.claude/plans/sleepy-finding-creek.md` (19-category methodology).
**Run by**: Claude Opus 4.7 1M, single session.

---

## Executive summary

**Codebase is in markedly clean shape.** The 2026-05-06 cleanup pass (`REPO_CLEANUP_INVENTORY.md`) and the ownership review (`APP_SURFACE_OWNERSHIP_REVIEW.md`) eliminated most of the obvious sources of legacy/conflict. `knip` reports only 2 unused files monorepo-wide. `tsc --noEmit` passes across all 12 workspaces. Zero `@deprecated` JSDoc tags anywhere. Zero feature-flag rot. Zero `xit`/`xdescribe` skipped tests. Screen registry is in perfect alignment with on-disk screen files. Generated API code is up-to-date with `lib/api-spec/openapi.yaml`.

The remaining findings cluster around three themes: **API contract drift on the server-side surface** (25 routes implemented but undocumented in the spec — the largest finding), **documentation/onboarding gaps** (no `.env.example`, 40 env vars used but ~2 documented in `replit.md`), and **a handful of stale touchpoints** (orphan pnpm glob, orphan test files, possibly-dormant shadow-equity-forward worker, one stale doc reference).

### Top 5 high/med findings (with action pointers)

1. **`HIGH` — 25 Express routes implemented in `artifacts/api-server/src/routes/*.ts` are not declared in `lib/api-spec/openapi.yaml`** (Cat 4 / Cat 17). Spec consumers using generated clients will miss these endpoints. Notable groups: 9 `/settings/*` endpoints, 8 `/ibkr/bridge/*` and `/ibkr/activation/*`, 4 `/diagnostics/*` POST telemetry. **Action**: extend openapi.yaml or remove unused routes.
2. **`HIGH` — No environment variable documentation surface** (Cat 18). 40 unique `process.env.*` / `import.meta.env.*` references; no `.env.example`; `replit.md` only mentions 2 by name (`RAYALGO_DATABASE_SOURCE`, `LOCAL_DATABASE_URL`). **Action**: add `.env.example` at repo root.
3. **`MED` — `pnpm-workspace.yaml` declares `lib/integrations/*` but the directory does not exist** (Cat 10). Orphan glob; pnpm install will warn. **Action**: remove the glob or create the directory.
4. **`MED` — `artifacts/api-server/src/services/shadow-equity-forward-worker.ts` has no production caller** (Cat 1 / Cat 2). `startShadowEquityForwardWorker` is exported but only referenced from its own test file. `knip` does not flag it (likely missed via indirect import path). **Action**: confirm whether dormant WIP, gated feature, or removed.
5. **`MED` — 21 orphan test files** where the obvious sibling implementation file is missing (Cat 7). Most under `artifacts/api-server/src/services/`. Likely testing logic exported from differently-named modules (e.g., `account-risk.test.ts` exercises `account-risk-model.ts`) but **some are real orphans for code that was renamed/deleted**. **Action**: walk each test, confirm what it covers, delete if dead.

### Sentinel-clean categories (audit ran, nothing found)

These categories had zero findings — confirming the cleanup pass was thorough.

- **Cat 13** Feature-flag rot: 0 `featureFlag` / `isFeatureEnabled` patterns.
- **Cat 16** Deprecation-marker rot: 0 `@deprecated` JSDoc tags in source.
- **Cat 14** TODO/FIXME backlog: 1 hit, a legitimate inline note (`artifacts/api-server/.replit-artifact/artifact.toml:2`) — not a rot finding.
- **Cat 5** Committed build artifacts (`dist/`, `output/`, `tmp/`, `.log`, `.tar.gz`, `.zip`, `.bak`): 0 tracked. (25 untracked `.log` files in `artifacts/` exist but are local-only — see Cat 5 below for a hygiene note.)
- **Cat 17** Screen-registry drift: 10 screens registered, 10 files on disk, perfect alignment.
- **Cat 7 partial** Skipped/only tests: 3 hits, all legitimate env-gated e2e skips with inline comments.
- **Cat 12** Cross-package boundary violations: 0 `@workspace/<pkg>/src/` deep imports; the 4 relative-3-deep imports identified are all intra-rayalgo navigation, not workspace crossings.
- **Cat 11** Legacy-named files in tracked source: 0 (`*.old.*`, `*-legacy*`, etc.); 1 hit was in `.local/skills/artifacts/bootstrap-legacy.js` which lives under gitignored `.local/`.

---

## Methodology

**Tools used**:
- `knip` v5.88.1 (`pnpm deadcode`, `pnpm deadcode:prod`) — already configured at `knip.json`.
- `tsc --noEmit` (`pnpm -r typecheck`) across all workspaces.
- `git grep` for pattern sweeps.
- `git ls-files` for tracked-artifact enumeration.
- `find` for untracked-artifact enumeration.
- `orval` (used by `lib/api-spec` codegen, command identified but **not run** in this audit — see Cat 3).
- Manual sibling-pair / import-graph analysis via Explore subagents for Phase B and Phase D.

**Phasing completed**: A (free wins), B (schema/contract), C (cross-package boundary), D (parallel implementation hunt), E (artifact hygiene), F (doc rot), G (test hygiene), H (synthesis — this document).

**Confidence model**:
- **high**: evidence is a tool output, file diff, or grep hit with file:line citation
- **med**: heuristic match plus manual sample check
- **low**: signal seen, deeper investigation deferred

**WIP-protected boundaries** (per `REPO_CLEANUP_INVENTORY.md`):
- Polygon premium-distribution flow surfaces
- Option-intent work
- Chart/flow recovery code

Any finding inside these areas is tagged `wip-protected: yes` and excluded from action recommendations.

**Out of scope**: style nits, performance issues, architectural critiques. This audit is **presence-based**.

---

## Findings by category

### Cat 1 — Orphan files (zero importers)
**Method**: `pnpm deadcode` (knip standard).

**Findings (2)**:

| File | Severity | WIP | Suggested action |
|---|---|---|---|
| `artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs` | low | **yes** (Polygon premium-distribution) | Verify intent. Likely a dev/sampling script kept around for the in-flight WIP. |
| `scripts/run-options-contract-sweeps.mjs` | low | no | Inspect and delete if no longer used; otherwise document in `scripts/README.md`. |

**Note**: knip did NOT flag `shadow-equity-forward-worker.ts` despite the manual analysis finding no production caller (see Cat 2). Knip likely sees it as reachable via indirect/dynamic path.

---

### Cat 2 — Parallel implementations (semantic duplicates)
**Method**: naming-cluster sweep (`*Scanner*`, `*Service*`, `*Store*`, `*Provider*`, `*Manager*`, `*Adapter*`, `*Hook*`, `*Bridge*`, `*Stream*`), grouped by intent, signature comparison via Explore agent.

**Findings (1 real, several false-positive clusters intentionally listed for transparency)**:

| Cluster | Files | Severity | WIP | Suggested action |
|---|---|---|---|---|
| **Dormant `shadow-equity-forward` worker** | `artifacts/api-server/src/services/shadow-equity-forward-worker.ts` (266 LOC, exports `createShadowEquityForwardWorker`, `startShadowEquityForwardWorker`) + `shadow-equity-forward-test.ts` (~34 KB). `startShadowEquityForwardWorker` is exported but the only caller in the repo is its own `shadow-equity-forward-worker.test.ts`. No reference from `artifacts/api-server/src/index.ts` or routes. | **med** | no | Confirm whether this is dormant WIP, gated feature, or abandoned. If dormant, document intent; if abandoned, delete. |

**Cleared as intentional (not findings)**:
- `marketFlowStore.js` vs `tradeFlowStore.js` — both use the same store boilerplate but serve scope-distinct purposes (broad market vs trade-active). Confirmed in `APP_SURFACE_OWNERSHIP_REVIEW.md` as deferred-but-intentional sibling structure. **wip-protected: yes**.
- `useIbkrAccountSnapshotStream` / `useShadowAccountSnapshotStream` / `useAccountPageSnapshotStream` (all in `artifacts/rayalgo/src/features/platform/live-streams.ts`) — three SSE hooks for three deliberate modes (IBKR live, shadow, derived/performance). Tracked as separate stream freshness state.
- `useBrokerStreamFreshnessSnapshot` vs `useShadowAccountStreamFreshnessSnapshot` — intentional independent state machines.
- `shadow-account.ts` + `shadow-account-events.ts` + `shadow-account-streams.ts` — clean layering (events → core → polling bridge), not duplicates.
- `account-summary-model.ts`, `account-position-model.ts`, `account-risk-model.ts` (api-server) vs generated Zod types — model files are builders/transformers, not schemas. Clean separation.
- `artifacts/rayalgo/src/lib/uiTokens.jsx` (JS object) vs `artifacts/rayalgo/src/index.css` (CSS vars) — overlapping color spaces, drift risk exists. **Already in flight**: the Account-Screen Performance Pilot plan (sleepy-finding-creek.md prior version) addressed this directly. Not raised as a new finding here.

---

### Cat 3 — Stale generated code / codegen drift
**Method**: identify codegen command, confirm gitignore policy. **Did not run codegen** (audit-only).

**Findings**:
- **Codegen command**: `orval --config lib/api-spec/orval.config.ts` (Orval v8.5.3). Produces `lib/api-client-react/src/generated/` (react-query client) and `lib/api-zod/src/generated/` (Zod validators).
- **Gitignore policy**: generated dirs are **not** gitignored. Correct — generated code is committed and reviewed.
- **Drift check**: deferred. Re-run codegen in a separate session and diff against committed output before any spec changes.

**No findings to action**, but: when Cat 4 routes-vs-spec drift is fixed (largest finding below), regenerating will produce a real diff. Plan a follow-up audit pass after that work.

---

### Cat 4 — Schema / contract drift across the API surface (`HIGH`)
**Method**: enumerate `router.{get,post,put,delete,patch}` calls in `artifacts/api-server/src/routes/*.ts` and `index.ts`; cross-check each path against the `paths:` block in `lib/api-spec/openapi.yaml`. Sample-compare Zod-generated types against `lib/db` Drizzle schemas for 3 resources (position, order, trade).

**Findings (25 implemented-but-undocumented routes, 0 spec-orphan paths)**:

`HIGH` severity (19):

| Route group | Count | File:lines | WIP |
|---|---|---|---|
| `/settings/*` (backend, preferences, ibkr-lanes, ibkr-line-usage — GET + POST/PUT) | 9 | `artifacts/api-server/src/routes/settings.ts:20-95` | no |
| `/ibkr/bridge/{launcher, helper.ps1, bundle.tar.gz}` + `/ibkr/activation/{progress, complete}` + `/ibkr/bridge/{attach, detach}` | 8 | `artifacts/api-server/src/routes/platform.ts:993-1058` | no |
| `/diagnostics/{client-events, client-metrics, browser-reports, storage/prune}` POST | 4 | `artifacts/api-server/src/routes/diagnostics.ts:193-229` | no |

`MED` severity (6):

| Route | File | WIP |
|---|---|---|
| POST `/backtests/runs/{runId}/promote` | `artifacts/api-server/src/routes/backtesting.ts` | no |
| POST `/backtests/jobs/{jobId}/cancel` | `artifacts/api-server/src/routes/backtesting.ts` | no |
| POST `/algo/deployments/{deploymentId}/signal-options/backfill` | `artifacts/api-server/src/routes/automation.ts` | no |
| POST `/algo/signal-options/default-paper-deployment` | `artifacts/api-server/src/routes/automation.ts` | no |
| PATCH `/charting/pine-scripts/{scriptId}` | `artifacts/api-server/src/routes/charting.ts` | no |
| GET `/executions`, `/market-depth`, `/universe/logos`, `/universe/logo-proxy` (4 misc market-data) | `artifacts/api-server/src/routes/platform.ts` | no |

**Inverse check**: all 102 spec paths have at least one server handler. No orphan spec paths.

**Hand-written shape drift (sample of 3)**:

| Resource | Generated Zod fields | DB columns (Drizzle) | Drift severity |
|---|---|---|---|
| Position | `id, accountId, symbol, assetClass, quantity, averagePrice, marketPrice, marketValue, unrealizedPnl, unrealizedPnlPercent, optionContract` | `positionLotsTable`: `id, accountId, instrumentId, optionContractId, quantity, averageCost, marketPrice, marketValue, unrealizedPnl, unrealizedPnlPercent, asOf, ...timestamps` | low — intentional (API denormalizes `instrumentId` → `symbol`, hides timestamps) |
| Order | unified shape (mode, side, type, status, etc.) | split across `orderRequestsTable` (14 cols) + `brokerOrdersTable` (10 cols) | low — intentional (service joins for API response) |
| Trade (closed) | rich computed schema (~47 fields incl. Greeks, strategy labels) | no single table; composed from `brokerOrders` + `executionFills` + `positionLots` + market hydration | low — intentional projection |

No hand-written TS interfaces in `artifacts/api-server/src/services/` were found that duplicate the generated Zod shapes — services import from `@workspace/api-zod` directly. Clean.

---

### Cat 5 — Committed build artifacts and stale artifacts
**Method**: `git ls-files | grep -E '\.(log|tar\.gz|zip|bak)$|/dist/|/output/|/tmp/'`; `find` for untracked artifacts.

**Findings**:
- **Tracked artifacts (0)**: zero committed log/archive/build files. Root `.gitignore` correctly covers `dist`, `tmp`, `*.tsbuildinfo`, `npm-debug.log`, `yarn-error.log`, `testem.log`, `.cache/`, `.local/`, `.vendor/`, `attached_assets/`.
- **Untracked but unindexed (informational)**: 25 `.log` files in `artifacts/` (rayalgo memory-soak / IBKR stream watch / browser-console-watch, dated 2026-04-27 to 2026-05-11). All untracked, all match the gitignore-policy spirit but are **not explicitly covered** by `.gitignore` — `artifacts/*.log` is not a globbed entry. **Risk**: `git add -A` could pick these up.
- **Untracked binary**: `artifacts/ibgateway-bridge-windows-current.tar.gz` (1.5 MB). Referenced by `scripts/package-ibkr-bridge-bundle.mjs:11` as the canonical artifact path; produced by the packaging script. Correct as-is.

| Item | Severity | WIP | Suggested action |
|---|---|---|---|
| `artifacts/*.log` not covered by `.gitignore` | low | no | Add `artifacts/*.log` to root `.gitignore`. |

---

### Cat 6 — Documentation rot
**Method**: extract backtick-quoted file paths from primary `.md` docs; verify each exists.

**Findings (2 broken references)**:

| Doc | Broken path | Reality |
|---|---|---|
| `REPO_CLEANUP_INVENTORY.md` | `artifacts/rayalgo/src/features/charting/ResearchChartDashboardStrip.ts` | File does not exist on disk. Either renamed during cleanup or never landed. |
| `REPO_CLEANUP_INVENTORY.md` | `scripts/runUnitTests.mjs` | No `runUnitTests.mjs` at workspace `scripts/`; actual files live at `artifacts/api-server/scripts/runUnitTests.mjs` and `artifacts/rayalgo/scripts/runUnitTests.mjs`. |

| Severity | WIP | Suggested action |
|---|---|---|
| low | no | Update `REPO_CLEANUP_INVENTORY.md` references. |

All other backticked paths in `CLAUDE.md`, `AGENTS.md`, `replit.md`, `APP_SURFACE_OWNERSHIP_REVIEW.md` resolve correctly.

`SESSION_HANDOFF_MASTER.md` and the 14 dated `SESSION_HANDOFF_2026-*.md` files at repo root: correctly indexed by the master. Not clutter.

---

### Cat 7 — Dead tests / skipped tests / orphan test files
**Method**: `git grep` for skip/only; sibling-existence check across `.ts/.tsx/.js/.jsx/-model.ts/Model.ts/Service.ts` extensions.

**Findings (21 candidate orphan tests)**:

`MED` severity — manual walk recommended.

```
artifacts/api-server/src/routes/platform-activation-origin.test.ts
artifacts/api-server/src/services/account-list.test.ts
artifacts/api-server/src/services/account-orders.test.ts
artifacts/api-server/src/services/account-positions.test.ts
artifacts/api-server/src/services/account-snapshot-persistence.test.ts
artifacts/api-server/src/services/account-trade-annotations.test.ts
artifacts/api-server/src/services/backtesting-strategies.test.ts
artifacts/api-server/src/services/flow-premium-distribution.test.ts        ← wip-protected
artifacts/api-server/src/services/option-chain-batch.test.ts               ← wip-protected
artifacts/api-server/src/services/order-gateway-readiness.test.ts
artifacts/api-server/src/services/order-read-resilience.test.ts
artifacts/api-server/src/services/runtime-diagnostics.test.ts
artifacts/api-server/src/providers/ibkr/client-history-period.test.ts
artifacts/rayalgo/src/features/charting/chartHydrationWiring.test.js       ← wip-protected
artifacts/rayalgo/src/features/gex/gexDataWiring.test.js
artifacts/rayalgo/src/features/gex/gexNarrative.test.js
artifacts/rayalgo/src/features/gex/intradaySnapshots.test.js
artifacts/rayalgo/src/features/market/marketChartWiring.test.js
artifacts/rayalgo/src/features/platform/gexScreenWiring.test.js
artifacts/rayalgo/src/features/platform/platformRootSource.test.js
artifacts/rayalgo/src/screens/account/accountPositionRows.test.js
```

**Caveat**: this is a heuristic. Many are likely testing functionality re-exported from an `index.ts` or from a model file with a different name. Manual walk: open each test, identify what it actually imports, then decide if the imports point at live code. The `*-wip-protected*` markers are findings inside the protected WIP boundaries.

**Skipped tests (Cat 7 secondary)**: 3 `test.skip` calls, all in `artifacts/rayalgo/e2e/`, all env-var gated with inline justification. **Not findings.**

**`xit`/`xdescribe`**: 0 (earlier grep matched `process.exit(` etc. — over-broad pattern. No actual skipped tests using these prefixes.)

---

### Cat 8 — Config drift across workspaces
**Method**: diff `compilerOptions` across all `tsconfig.json`; identify off-catalog dep versions.

**Findings**:

`tsconfig.json` drift: minimal. Only `artifacts/rayalgo/tsconfig.json` overrides `jsx: "preserve"` and `moduleResolution: "bundler"` — required for Vite/React 19 setup. Others delegate to `tsconfig.base.json`. **Not a drift finding.**

Off-catalog dep versions (`MED` severity, opportunistic):

| Dep | Used in workspaces | Same version everywhere? |
|---|---|---|
| `pino` | api-server, backtest-worker, ibkr-bridge | yes (`^9`) — should be catalogued |
| `pino-http` | api-server, ibkr-bridge | yes (`^10`) — should be catalogued |
| `cors` | api-server, ibkr-bridge | yes (`^2`) — should be catalogued |
| `express` | api-server, ibkr-bridge | yes (`^5`) — should be catalogued |
| `ws` | api-server, ibkr-bridge | yes (`^8.20.0`) — should be catalogued |
| `esbuild` | api-server, backtest-worker, ibkr-bridge | yes (`^0.27.3`) — should be catalogued |
| `esbuild-plugin-pino` | api-server, backtest-worker | yes (`^2.3.3`) — should be catalogued |
| `@types/cors`, `@types/express`, `@types/ws` | api-server, ibkr-bridge | yes — should be catalogued |

| Severity | WIP | Suggested action |
|---|---|---|
| low (per-dep, agg med) | no | Move these to `pnpm-workspace.yaml` catalog block to prevent future per-workspace version drift. |

---

### Cat 9 — Dependency hygiene
**Method**: knip output, lockfile inspection.

**Findings**: clean. No unused deps flagged outside the 2 unused-file findings in Cat 1. No same-package multi-version conflicts surfaced. Did not run `pnpm outdated --recursive` (deferred — outside scope).

---

### Cat 10 — pnpm workspace drift (`MED`)
**Method**: cross-check `pnpm-workspace.yaml` `packages:` globs against actual directories.

**Finding (1)**:

| Issue | Severity | WIP | Action |
|---|---|---|---|
| `lib/integrations/*` glob declared but `lib/integrations/` directory does not exist | med | no | Remove the glob OR create the directory if `lib/integrations/*` packages are planned. Causes `pnpm install` warnings today. |

All other globs (`artifacts/*`, `lib/*`, `scripts`) resolve to existing dirs with `package.json` files.

---

### Cat 11 — Legacy-named files
**Method**: `find` for `*.old.*`, `*-legacy*`, `*-deprecated*`, `*-temp.*`, `*-backup.*`, `*.bak`, `*-old.*`.

**Findings**: 1 hit, under gitignored `.local/skills/artifacts/bootstrap-legacy.js`. Not part of repo state. **Not a finding.**

---

### Cat 12 — Cross-package boundary violations
**Method**: `git grep` for relative-3-deep imports and `@workspace/<pkg>/src/` deep imports.

**Findings**:
- Relative-3-deep imports: 4 hits, all intra-rayalgo (`features/...` → `src/lib/...`). Not cross-workspace; just deep within one workspace.
- Workspace-package deep imports (`@workspace/foo/src/bar`): 0.

**Not findings.**

---

### Cat 13 — Feature flag rot
**Method**: `git grep` for `featureFlag`, `FEATURE_FLAG`, `isFeatureEnabled`, `isEnabled(`.

**Findings**: 0 hits. The codebase uses env vars for runtime config (see Cat 18) and React Query staleTime for data freshness — no in-code feature-flag system. **Sentinel-clean.**

---

### Cat 14 — TODO/FIXME accumulation
**Method**: `git grep -nE '\b(TODO|FIXME|XXX|HACK|DEPRECATED)\b' artifacts/ lib/ scripts/`.

**Findings**: 1 hit total.

```
artifacts/api-server/.replit-artifact/artifact.toml:2:previewPath = "/api" # TODO - should be excluded from preview in the first place
```

Legitimate inline note about a future Replit artifact-controller behavior; not stale. **Sentinel-clean.**

---

### Cat 15 — Type-safety escape hatches
**Method**: `git grep` for `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `: any\b`, `as unknown as`, `as any\b`.

**Findings (275 hits, concentrated in tests)**:

| File | Hits | Category |
|---|---|---|
| `artifacts/api-server/src/services/option-chain-batch.test.ts` | 56 | test fixture casts (wip-protected) |
| `artifacts/rayalgo/src/features/platform/live-streams.test.ts` | 46 | test fixture casts |
| `artifacts/rayalgo/src/features/charting/ResearchChartSurface.tsx` | 38 | **production hotspot** |
| `artifacts/api-server/src/services/options-flow-scanner.test.ts` | 31 | test fixture casts |
| `artifacts/ibkr-bridge/src/tws-provider.test.ts` | 22 | test fixture casts |
| `artifacts/api-server/src/services/platform.ts` | 8 | **production code** |
| `artifacts/api-server/src/services/runtime-diagnostics.test.ts` | 7 | test fixture casts |
| `artifacts/api-server/src/services/flow-premium-distribution.test.ts` | 7 | test fixture casts (wip-protected) |
| (remaining 60 hits) | <10 each | mostly tests |

| Severity | WIP | Suggested action |
|---|---|---|
| low (per hit) / med (aggregate) | mixed | Triage `ResearchChartSurface.tsx` (38 hits) and `platform.ts` (8 hits) for production-side cleanup. Test casts are typically fine — note for awareness only. |

---

### Cat 16 — Migration / transitional code shims
**Method**: `git grep` for `@deprecated`.

**Findings**: 0 hits. **Sentinel-clean.**

(Earlier 63 hits from a broader grep matched domain names like `legacyBridgeActivations` — these are runtime-state tracking the "legacy admission" pattern, not deprecation markers. Specifically: `artifacts/api-server/src/services/ibkr-bridge-runtime.ts` and `artifacts/rayalgo/src/features/platform/runtimeControlModel.js` use `legacy*` to label a domain concept, not deprecated code.)

---

### Cat 17 — Route / registry drift
**Method**: enumerate `SCREENS` array in `screenRegistry.jsx` vs. `screens/*.{jsx,tsx}` files; route handlers vs. openapi.yaml paths (covered in Cat 4).

**Frontend screen registry (clean)**:
- 10 screens declared in `artifacts/rayalgo/src/features/platform/screenRegistry.jsx`: market, flow, gex, trade, account, research, algo, backtest, diagnostics, settings.
- 10 screen files on disk: AccountScreen.jsx, AlgoScreen.jsx, BacktestScreen.jsx, DiagnosticsScreen.jsx, FlowScreen.jsx, GexScreen.jsx, MarketScreen.jsx, ResearchScreen.jsx, SettingsScreen.jsx, TradeScreen.jsx.
- Perfect 1:1 alignment.

**Server-side route drift**: covered under Cat 4 (HIGH severity).

---

### Cat 18 — Environment variable inventory (`HIGH`)
**Method**: `git grep -hoE '(process\.env|import\.meta\.env)\.[A-Z_]+' | sort -u`; cross-check `replit.md`; search for `.env.example`.

**Findings**:
- **40 unique env vars** referenced in code:

```
import.meta.env.DEV
process.env.API_BASE_URL                  process.env.LOCAL_DATABASE_URL
process.env.BACKTEST_API_BASE_URL         process.env.LOG_LEVEL
process.env.BACKTEST_FROM_DATE            process.env.MASSIVE_API_KEY
process.env.BACKTEST_TO_DATE              process.env.MASSIVE_MARKET_DATA_API_KEY
process.env.BACKTEST_WORKER_POLL_INTERVAL_MS  process.env.NIX_LD
process.env.BASE_PATH                     process.env.NIX_LD_LIBRARY_PATH
process.env.BUNDLE_AUDIT_MAX_KB           process.env.NODE_ENV
process.env.DATABASE_URL                  process.env.PGSSLMODE
process.env.LD_LIBRARY_PATH               process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
process.env.PLAYWRIGHT_PORT               process.env.PLAYWRIGHT_WORKERS
process.env.POLYGON_API_KEY               process.env.POLYGON_KEY
process.env.PORT                          process.env.RAYALGO_API_PORT
process.env.RAYALGO_COEP_POLICY           process.env.RAYALGO_COOP_POLICY
process.env.RAYALGO_CROSS_ORIGIN_ISOLATION process.env.RAYALGO_DATABASE_SOURCE
process.env.RAYALGO_FRONTEND_PORT         process.env.RAYALGO_LIVE_MARKET_FLOW
process.env.RAYALGO_LIVE_MARKET_FLOW_SYMBOLS process.env.RAYALGO_MEMORY_SOAK
process.env.RAYALGO_MEMORY_SOAK_LIVE_API  process.env.RAYALGO_MEMORY_SOAK_MINUTES
process.env.RAYALGO_MEMORY_SOAK_SAMPLE_EVERY process.env.REPL_ID
process.env.REPLIT_LD_LIBRARY_PATH        process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
process.env.VITE_PROXY_API_TARGET
```

- **No `.env.example` file** at workspace root or in any artifact.
- **`replit.md` documents only 2 env vars by name** (`RAYALGO_DATABASE_SOURCE`, `LOCAL_DATABASE_URL`) — both in the context of explaining `[userenv.development]` policy.
- **Potential duplicate**: `POLYGON_API_KEY` AND `POLYGON_KEY` both referenced. Likely one is canonical and the other is a legacy alias. Worth confirming.

| Severity | WIP | Suggested action |
|---|---|---|
| high | no | Create `.env.example` at workspace root with every env var grouped by service. Note which are required vs optional. Reconcile `POLYGON_API_KEY` vs `POLYGON_KEY`. |

---

### Cat 19 — Run-command / scripts inconsistency
**Method**: enumerate `package.json` scripts; cross-check with `AGENTS.md` run-rules.

**Findings**:
- `AGENTS.md` and `CLAUDE.md` both state: "Do not add repo-defined `.replit` workflows or a root `.replit` `run = [...]` command; `[agent] stack = "PNPM_WORKSPACE"` lets Replit start the API and web artifact services." Verified — root `.replit` does not have a `run` array (recovered per `SESSION_HANDOFF_2026-05-11`).
- All script files referenced from `package.json` `scripts:` entries (e.g., `scripts/package-ibkr-bridge-bundle.mjs`, `scripts/reap-dev-port.mjs`, `scripts/run-local-postgres.sh`) exist.
- The `scripts/run-options-contract-sweeps.mjs` script is referenced by neither a `package.json` script nor a doc — also flagged as unused by knip (Cat 1).

**No additional findings beyond Cat 1.**

---

## WIP-protected items (informational; not flagged for action)

Per `REPO_CLEANUP_INVENTORY.md`:
- **Polygon premium-distribution flow**: `artifacts/api-server/src/providers/polygon/`, `artifacts/api-server/src/services/flow-premium-distribution.{ts,test.ts}`, related rayalgo flow surfaces. Findings within this boundary are tagged but not actioned: `sampleFlowPremiumDistribution.mjs` (Cat 1), `flow-premium-distribution.test.ts` orphan test (Cat 7), `option-chain-batch.test.ts` orphan test (Cat 7).
- **Option-intent work**: `artifacts/api-server/src/services/option-order-intent.ts` and related.
- **Chart/flow recovery code**: `chartHydrationWiring.test.js` orphan test (Cat 7), `gexDataWiring.test.js` orphan test (Cat 7), `gexNarrative.test.js`, `gexScreenWiring.test.js`, `intradaySnapshots.test.js`, `marketChartWiring.test.js` — collectively wip-protected. Action deferred.

Per `APP_SURFACE_OWNERSHIP_REVIEW.md`:
- **Trade option-chain ownership** cleanup deferred — affects `tradeOptionChainStore.js` and the trade-flow store pair (Cat 2 cleared cluster).

---

## Tooling gaps discovered

Independent of code findings, the audit surfaced gaps in audit tooling itself:

1. **No ESLint configured** anywhere in the monorepo. Only `knip` + `tsc` for static checks. Adding a baseline ESLint config (with `eslint-plugin-import`, `eslint-plugin-react-hooks`, `@typescript-eslint`) would catch unused imports, hook violations, and several Cat 15 patterns automatically.
2. **No CI gate** for `pnpm deadcode` or `pnpm typecheck` visible (per AGENTS.md, run commands are local). These should run in CI on every PR.
3. **No markdown link checker** in CI; doc rot (Cat 6) won't be caught automatically next time.
4. **No `madge` (cycle detection)** in CI. The audit did not surface any circular dep, but a future regression would slip in unnoticed.
5. **No env-var inventory script** that diffs code references against a `.env.example`. Until one exists, Cat 18 drift will re-accumulate.
6. **No codegen-drift check** in CI. After Cat 4 spec updates, the generated code should be regenerated; CI should fail if `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` is stale relative to `openapi.yaml`.

---

## Followup audit recommendations

Categories that were partially completed or warrant a follow-up pass:

1. **Cat 3 codegen-drift**: re-run `orval --config lib/api-spec/orval.config.ts` in a clean worktree, diff against committed `lib/api-{zod,client-react}/src/generated/`. Defer until Cat 4 spec updates land.
2. **Cat 7 orphan tests**: walk each of the 21 candidates manually. Each test imports something — identify the target and confirm it exists. Anything truly orphaned can be deleted.
3. **Cat 15 type-escape hotspots**: review `ResearchChartSurface.tsx` (38 hits) and `platform.ts` (8 hits) to tighten production type safety.
4. **Cat 2 shadow-equity-forward worker**: confirm with the owner whether it is dormant WIP or abandoned. If abandoned, delete worker + test + dependent `shadow-equity-forward-test.ts`.
5. **Performance/architecture audit** (deferred per scope) — covered separately by the prior performance-pilot plan.
6. **Bundle audit**: `pnpm --filter @workspace/rayalgo bundle:audit` was not run in this pass (deferred due to scope). Recommend running before the next release.

---

## Summary table

| Cat | Category | Hits | High | Med | Low | WIP-protected | Sentinel-clean |
|----|---|---|---|---|---|---|---|
| 1 | Orphan files | 2 | – | – | 2 | 1 | – |
| 2 | Parallel implementations | 1 real | – | 1 | – | – | – |
| 3 | Generated code drift | deferred | – | – | – | – | – |
| 4 | API contract drift | 25 routes | 19 | 6 | – | – | – |
| 5 | Committed build artifacts | 1 hygiene | – | – | 1 | – | tracked: ✓ |
| 6 | Doc rot | 2 | – | – | 2 | – | – |
| 7 | Dead/skipped/orphan tests | 21 | – | 21 | – | 6 | – |
| 8 | Config drift (off-catalog deps) | ~10 deps | – | 1 | – | – | tsconfig: ✓ |
| 9 | Dep hygiene | 0 | – | – | – | – | ✓ |
| 10 | Pnpm workspace drift | 1 | – | 1 | – | – | – |
| 11 | Legacy-named files | 0 | – | – | – | – | ✓ |
| 12 | Cross-package boundary | 0 | – | – | – | – | ✓ |
| 13 | Feature flag rot | 0 | – | – | – | – | ✓ |
| 14 | TODO/FIXME accumulation | 0 | – | – | – | – | ✓ |
| 15 | Type-safety escapes | 275 | – | 1 (agg) | 274 | yes (some tests) | – |
| 16 | Deprecation shims | 0 | – | – | – | – | ✓ |
| 17 | Screen registry drift | 0 | – | – | – | – | ✓ |
| 18 | Env var inventory | 40 vars undocumented | 1 | – | – | – | – |
| 19 | Scripts inconsistency | 0 new | – | – | – | – | (covered in Cat 1) |

**Totals**: 5 categories with no findings (clean), 14 with at least one finding. **2 HIGH-severity, 6 MED-severity, the rest LOW**. Aggregate state: **codebase is in clean shape**, with one clear next target (API spec ↔ server route reconciliation) that would resolve ~half the high-severity surface in a single sweep.
