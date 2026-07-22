# PYRUS known-issues report — 2026-07-21

**Release status:** HOLD  
**Snapshot:** `main@f5d60cc52a353a8cef467d45de53bd28e52b194a` at 2026-07-21 15:11 UTC  
**Remote baseline:** `origin/main@d5b9f00637310ed189aeae780584566efea6053f` (`main` is ahead by 3 commits)  
**Evidence scope:** current source, retained audits/handoffs, targeted TypeScript and guard checks, runtime diagnostics, and read-only browser QA of the unauthenticated surface  
**No app/code fixes were made during this audit.**

## How to read this report

- **Observed** means reproduced from current source, command output, runtime output, browser output, or a retained evidence artifact.
- **Inferred** means the impact follows from current source but was not reproduced in a live authenticated workflow.
- **Unknown** means the available evidence cannot establish current behavior.
- “Known” means supported by the evidence above. It does not mean exhaustive: authenticated app screens, broker workflows, and live/shadow trading controls were not exercised, and a separate full-code review is still in progress.

At audit start, the shared worktree was highly volatile: 612 modified/added paths, 35 deleted paths, and 350 untracked paths (997 total), before this report and its QA artifacts were added. The unstaged diff then spanned 647 tracked files with about 91,898 insertions and 36,632 deletions. Findings below describe that in-flight snapshot, not a clean releasable commit.

## Executive summary

The current snapshot is not releasable for four independent reasons:

1. A previously exposed credential is still reachable through five non-main Git refs.
2. The repository-wide TypeScript gate fails, with additional API-contract and test-fixture drift in downstream workspaces.
3. `signalSettingsRevision`, a trading-signal generation boundary, is inconsistent between handler output, error/unavailable states, and the published API schema.
4. The running API process predates its current bundle, so current backend source has not been loaded into the attached Replit runtime.

No new defect was found on the public sign-in/setup surface. That surface loaded cleanly on desktop and phone, but it still has no self-service password-recovery or support path. Authenticated product behavior remains unknown in this pass.

## Freshly confirmed open issues

### KI-001 — High — Historical credential remains reachable through five Git refs

**Classification:** security / publication blocker  
**Evidence:** observed, independently reconfirmed in this audit

Commit `ce7173dfe39cd50bf54b413437b3ec3a37046356` remains reachable through exactly:

- `refs/heads/replit-agent`
- `refs/remotes/gitsafe-backup/HEAD`
- `refs/remotes/gitsafe-backup/main`
- `refs/replit/agent-ledger`
- `refs/tags/replit-fiasco-20260610`

`main` is not one of the containing refs. The retained security workstream records one verified HIGH finding and keeps publication on HOLD; 12 other findings from that audit were reported resolved. The credential value is intentionally omitted here. History rewriting remains a coordinated destructive operation and was not performed.

Evidence: [security handoff](../../SESSION_HANDOFF_2026-07-21_019f851c-947e-73c1-9dc6-0d1c5f415d59.md).

### KI-002 — High — The TypeScript/build release gate is broken

**Classification:** build / CI blocker  
**Evidence:** observed

`pnpm run typecheck` exits 2 in `typecheck:libs` with five errors in [`lib/db/src/pool-diagnostics.test.ts`](../../lib/db/src/pool-diagnostics.test.ts):

- lines 128, 134, 139, and 174 dereference a possibly undefined `admission.interactive` lane;
- line 143 supplies a callback that requires `FakePoolClient`, while the declared pool callback permits `PoolClient | undefined`.

Because the composite DB build stops before refreshing declarations, current source exports in `lib/db/src/schema/diagnostics.ts` are absent from the older emitted declaration file. Direct downstream checks therefore also report missing diagnostic provenance exports in API and MCP. This is a cascade from stale project-reference output, not a missing source barrel export: current [`lib/db/src/index.ts`](../../lib/db/src/index.ts) does export `./schema`.

A serialized direct workspace check produced this matrix:

| Workspace | Result | Current blockers |
|---|---:|---|
| `@workspace/backtest-worker` | Pass | None observed |
| `@workspace/api-server` | Fail | signal revision contract/constructor drift; stale DB declaration exports; outdated test fixtures; one unsafe test cast |
| `@workspace/mcp-server` | Fail | stale DB diagnostic declaration exports |
| `@workspace/pyrus` | Fail | two `ChartBar` test fixtures omit required `ts` and `date` fields |
| `@workspace/scripts` | Fail | imported API errors plus a nullable diagnostic value comparison |

Additional directly observed compile problems:

- [`chartPositionOverlays.test.ts:7`](../../artifacts/pyrus/src/features/charting/chartPositionOverlays.test.ts) and [`flowChartEvents.test.ts:12`](../../artifacts/pyrus/src/features/charting/flowChartEvents.test.ts) construct `ChartBar` values without the required `ts` and `date` fields declared in [`types.ts:40`](../../artifacts/pyrus/src/features/charting/types.ts).
- [`platform.ts:2566`](../../artifacts/api-server/src/services/platform.ts) compares every diagnostic value with `> 0` even though the type permits `null`.
- [`signal-options-automation.test.ts:1541`](../../artifacts/api-server/src/services/signal-options-automation.test.ts) directly casts an intentionally incomplete fixture to `SignalOptionsPosition`.

The API code-generation drift guard could not reach its drift comparison because the same library build errors interrupted codegen. Generated Zod tests themselves passed 8/8. Do not interpret this guard result as proof of generated-client drift.

### KI-003 — High — Signal settings revision is inconsistent across runtime state and the public contract

**Classification:** trading correctness / API contract  
**Evidence:** observed in current source and compiler output

The signal monitor now uses `signalSettingsRevision` as a generation boundary in storage and evaluation. The normal response mapper emits it at [`signal-monitor.ts:1368`](../../artifacts/api-server/src/services/signal-monitor.ts), but:

- the OpenAPI and generated API/Zod contracts contain no `signalSettingsRevision` field;
- [`buildUnavailableSignalMonitorSnapshotState`](../../artifacts/api-server/src/services/signal-monitor.ts) omits it at line 1514;
- [`buildSignalMonitorMatrixErrorState`](../../artifacts/api-server/src/services/signal-monitor.ts) omits it at line 13818;
- the compile-time handler/schema tie in [`signal-monitor-state-serialize.test.ts:20`](../../artifacts/api-server/src/routes/signal-monitor-state-serialize.test.ts) fails with `handler key missing from schema: signalSettingsRevision`;
- several current test fixtures and DB-demand calls omit the now-required revision.

The route deliberately serializes handler output without a schema parse for event-loop performance. Therefore the current handler can leak an undocumented key while error/unavailable states can omit the same generation marker. The precise authenticated-client impact is **unknown** until the contract is aligned, the constructors are completed, typecheck passes, and the current runtime is reloaded.

### KI-004 — Resolved during follow-up — The attached API runtime was stale

**Classification:** runtime / validation blocker  
**Evidence:** observed

The initial audit found API PID 283 predating the rebuilt bundle by about 3.6 seconds. The user subsequently restarted through Replit Stop/Run. The replacement API PID `96389`, instance token `62df385f-0c62-4790-80ee-d446db1b37f8`, and bundle timestamp were stable through a matched five-minute watch, so the original stale-runtime condition is no longer open.

All 21 direct and 21 proxied health checks passed after that restart. Replit remained the sole lifecycle owner; no shell restart or signal was attempted.

### KI-005 — Resolved during follow-up — `.env.example` omitted three environment variables read by current source

**Classification:** operations / configuration documentation  
**Evidence:** observed by `audit:env`

The checked-in environment template omits:

- `PYRUS_DB_BACKGROUND_BORROWING_ENABLED` — read in [`lib/db/src/admission.ts:201`](../../lib/db/src/admission.ts)
- `PYRUS_DB_INTERACTIVE_RESERVE` — read in [`lib/db/src/admission.ts:207`](../../lib/db/src/admission.ts)
- `PYRUS_ROLE_EXEC_SNAPSHOT` — read in [`artifacts/pyrus/scripts/runDevApp.mjs:378`](../../artifacts/pyrus/scripts/runDevApp.mjs)

The template now documents both adaptive DB-admission controls and the
launcher-internal role snapshot as blank entries, without changing runtime
defaults or inviting operators to set the internal handoff. `pnpm run
audit:env`, the complete `audit:guards` chain, and the official
`build:pyrus-app` wrapper now pass.

### KI-006 — High — Signal Monitor hard-caps coverage at 2,000 symbols

**Classification:** product coverage / architecture limit  
**Evidence:** current source plus a 2026-07-16 read-only database audit

Current source still fixes `SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT` at 2,000 in [`signal-monitor.ts:520`](../../artifacts/api-server/src/services/signal-monitor.ts). The latest retained database audit counted 5,946 optionable symbols, so the active universe can omit roughly 3,946 eligible names before timeframe expansion.

The 5,946 population count was not refreshed in this pass. The source ceiling is current; the exact omitted count is a July 16 snapshot. Raising the number alone is unsafe because six timeframes would produce 35,676 cells against smaller current working sets. The documented architectural repair is paging/sharding with durable cursor and truncation diagnostics.

Evidence: [runtime pressure/rule audit](../plans/runtime-pressure-rule-audit-2026-07-16.md#signal-universe-ceiling-2000-symbols).

### KI-007 — Medium — Gap recovery is deliberately limited to two cells per second

**Classification:** recovery latency / capacity risk  
**Evidence:** current source; impact inferred

[`signal-monitor.ts:4856`](../../artifacts/api-server/src/services/signal-monitor.ts) limits completed-bar gap work to two cells per one-second drain. A backlog of 8,000 cells would therefore require at least 4,000 seconds, or about 66.7 minutes, with no failures or retries.

This is not the stale July 16 `4,096`-entry map issue: current source correctly sizes the last-attempt map to the 16,384-cell backfilled base. The remaining issue is recovery throughput under a large outage backlog.

### KI-008 — Medium — Retryable market-data state has no durable outage outbox

**Classification:** data durability / outage recovery  
**Evidence:** documented current gap; source search found no implementation

Retryable bar writes, option metadata writes, and Flow observation state remain process-memory concerns during a long database outage. Current source contains no atomic disk-backed outbox with startup replay, age/byte diagnostics, and disk-full inhibition. A process restart during a prolonged database outage can therefore lose queued state that never reached durable storage.

Evidence: [runtime pressure/rule audit](../plans/runtime-pressure-rule-audit-2026-07-16.md#durable-outage-storage).

### KI-009 — Medium — Live historical-bar streaming degrades after 64 browser EventSources

**Classification:** browser scale / transport architecture  
**Evidence:** current source

[`useMassiveStreamedStockBars.ts:166`](../../artifacts/pyrus/src/features/charting/useMassiveStreamedStockBars.ts) caps live bar connections at 64. Additional entries are marked `deferred` at line 773 and rely on throttled REST fallback. This is safer than opening unbounded sockets, but it makes stream freshness a product-visible capacity limit for sufficiently large chart grids/workspaces. The documented long-term repair is a multiplexed stream with per-subscriber reference counting.

### KI-010 — Watch — Background queues and normal cache fill can overstate runtime pressure

**Classification:** performance plus observability semantics  
**Evidence:** fresh Replit restart, matched five-minute watches, recorder slice, and PostgreSQL activity sampling

A fresh July 21 watch traced two independent ways the display enters `watch`. First, any caller waiting in the app's two-job background database lane is counted as DB-pool pressure even when the raw PostgreSQL queue is empty and only two to five of 12 connections are active. The queueing coincided with real WAL-heavy bar-cache, option-metadata, signal/trading, deployment, and diagnostic writes, so the underlying tail latency is actionable even though the “pool” label overstates connection exhaustion. The first confirmed write-amplification source is now fixed: after restart, 1,012 live-quote updates caused only two contract-metadata updates instead of the former one-for-one pattern. The largest remaining counter, signal-monitor state, was then traced: 4,570 of 4,729 post-startup touched rows (96.6%) carried a genuinely newer market bar, and PostgreSQL reported 97.6% HOT updates. It is a large intended workload, not another confirmed unchanged-row loop. Second, the options-flow scanner normally fills its 128-entry option-chain cache, while the generic cache rule turns yellow at 90% occupancy without measuring evictions or miss rate.

The marketing dashboard's required five-second SSE refresh was retained. A redundant account-history read inside its snapshot was removed; its longest recorded DB operation fell from 5.675 seconds in the first watch to 27 ms in the matched post-fix watch. Background pressure remained, confirming that marketing was not the primary producer. Neither window showed availability loss, a monotonic memory leak, raw-pool exhaustion, OOM activity, or sustained event-loop saturation.

A later rebuild showed a larger cold-start burst—up to 73 admission waiters, including 60-66 background jobs—but still zero raw node-postgres waiters. It drained in about 90 seconds and the same process returned to normal event-loop and queue metrics. This is genuine startup contention, not a steady-state pool outage. The 59 sparkline-seed HTTP samples seen during that window were chunked pending-history retries over a coalesced/serialized backend path, so they do not represent 59 independent database reads.

A separate option-contract correctness defect found during the trace is fixed, tested, and loaded: Drizzle wrapped broker-alias unique violations in `error.cause`, so the existing reconciliation fallback could be skipped and leave stale contract metadata. The classifier now follows the bounded cause chain and recognizes PostgreSQL `23505`; the focused option-metadata suite passes 10/10 and the next user-controlled Replit rebuild loaded the repaired bundle.

The earlier immediate marketing-stream errors were then reproduced on the Algo SSE route and classified. A normal browser disconnect aborts the pending DB admission request; diagnostics incorrectly emitted that one `AbortError` twice, as both an acquire and query failure, even though the scheduler already counted it as a cancellation. The central diagnostic guard now suppresses those false error records while preserving `canceledTotal`; its focused regression passes in an 11/11 suite. A later Replit-owned rebuild loaded the guard in a fresh healthy API process.

Evidence: [July 21 pressure trace](../../.gstack/qa-reports/qa-report-pyrus-pressure-2026-07-21.md), [July 16 runtime QA](../../.gstack/qa-reports/qa-report-pyrus-2026-07-16.md#third-post-fix-runtime-only-observation-174042z174542z).

## Current product and UX gaps

These items are source-confirmed in the current snapshot. Some are honestly labeled previews or unavailable capabilities rather than accidental failures; they remain incomplete user workflows.

### KI-011 — High/conditional — Sign-in has no password recovery or support path

The current public sign-in screen exposes email, password, Sign in, and a first-time setup toggle. First-time setup requires the operator bootstrap token. Current auth routes are session, bootstrap, login, launch, and logout only (`artifacts/api-server/src/routes/auth.ts:329-432`); there is no recovery/reset endpoint, and current LoginGate source has no recovery/support action.

This is High if PYRUS is customer-facing. It may be an intentional constraint for a self-hosted single-operator product, but the repository still does not establish that product decision. The missing decision is part of the issue.

### KI-012 — High — Research → Trade navigation is not durable

The Research action transfers a ticker and calls `activateScreen("trade")` at [`PlatformApp.jsx:5197`](../../artifacts/pyrus/src/features/platform/PlatformApp.jsx). `activateScreen` only updates React state at lines 995-1006. The URL query is read once on mount, but screen changes do not push or replace browser history.

**Inferred impact:** the address can remain `?screen=research`; reload/back cannot represent the Trade handoff. This reproduces the mechanism behind the July 15 browser finding, although authenticated browser replay was unavailable today.

### KI-013 — Medium — Backtest and Research expose incomplete modules as active workbench surfaces

- Backtest still displays “Option replay chart is reserved but not hydrated yet” at [`BacktestingPanels.tsx:3631`](../../artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx).
- Pattern Discovery still permanently disables “Promote pattern → algo gate” as “wired in Phase 3” at [`PatternDiscoveryPanel.tsx:924`](../../artifacts/pyrus/src/features/backtesting/PatternDiscoveryPanel.tsx).
- Research’s What-if panel still accepts input but only reports that browser model calls were removed and a server-side provider is required at [`PhotonicsObservatory.jsx:758`](../../artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx).
- Research still has Open in Trade and Copy Markdown but no source-visible durable Save thesis/idea or Add to watchlist workflow.

These surfaces now contain more honest copy than the original July 15 audit, but the workflows remain incomplete.

### KI-014 — Medium — Flow and Symbol Intel still expose partial integrations

- Flow displays `Dark pool · Not wired` and `Insider · Not wired` at [`FlowScreen.jsx:5813`](../../artifacts/pyrus/src/screens/FlowScreen.jsx).
- Symbol Intel still lacks touch → BottomSheet behavior, indicator overlays, and a light sector/relative-volume/halt context endpoint; the current TODOs are in [`SymbolHoverCard.jsx:17`](../../artifacts/pyrus/src/features/platform/SymbolHoverCard.jsx) and [`SymbolIntelPanel.jsx:187`](../../artifacts/pyrus/src/features/platform/SymbolIntelPanel.jsx).

### KI-015 — Medium — Tax exposes enabled controls for unfinished outcomes

[`TaxSettingsPanel.jsx`](../../artifacts/pyrus/src/screens/settings/TaxSettingsPanel.jsx) currently exposes:

- an enabled “Annualized income method” preference while stating visible-gains tax is “not computed” (lines 407-410);
- an enabled broker-reserve beta while the panel says “Virtual tracking now, broker purchase beta later” (lines 413-452);
- external accounts summarized as “Not modeled” (line 513).

The implementation is fail-closed, but the settings imply outcomes the current Tax Center cannot deliver.

### KI-016 — Medium — Several trading/order lifecycles remain intentionally fail-closed

Current source explicitly says Protect, Roll, bulk close, and direct row submission still lack preview, tax preflight, and prepared-order confirmation in [`positionOrderActions.js:1`](../../artifacts/pyrus/src/features/account/positionOrderActions.js). Single-position close review and exact SnapTrade cancellation have since been wired, but:

- the generic Account order blotter still refuses cancellation when it cannot verify app ownership;
- SnapTrade equity replacement has generated API support but no frontend caller outside generated code;
- the remaining unsupported position actions have no complete prepared-order lifecycle.

This is primarily incomplete scope, not a hidden unsafe mutation: current code fails closed and presents an explicit reason.

### KI-017 — Low — Type safety is suppressed across the JS/TS boundary

Current Pyrus source contains 39 `@ts-expect-error`/`@ts-ignore` directives across 21 files. Nearly all suppress missing declarations for `.jsx` modules imported into TypeScript, with one preload-state suppression in `AppContent.tsx`. This is not a current runtime failure, but it reduces the compiler’s ability to detect interface drift—the same class of drift currently breaking signal-monitor and chart fixtures.

## Delivery risk, not an app defect

### KI-018 — High — The audited snapshot is not attributable to a clean commit

The 997-path audit-start worktree contains concurrent work from multiple sessions. The current full-code Ponytail review is still in progress, and some recent runtime findings are actively being repaired or revalidated. Even after the listed code errors are fixed, a release candidate must be reconstructed from intentional changes, rechecked from a clean tree, rebuilt, loaded through the Replit-owned lifecycle, and then soaked.

`git diff --check` passes, and production dead-code analysis reports no unused production files/exports/types/duplicates. Those results do not make the aggregate dirty snapshot reviewable or releasable.

## Historical findings and current disposition

Older reports remain useful evidence, but they cannot all be carried forward as current defects after extensive uncommitted work.

| Prior finding set | Current disposition |
|---|---|
| July 16 runtime QA issues 001-005 | Reported fixed and post-fix verified. Current tail latency and pressure-label semantics remain KI-010; the change-only metadata, alias-cause, and disconnect-diagnostic repairs are loaded. |
| July 15 position handoff, inaccessible disabled reasons, SnapTrade cancel, and misleading Flow alert success | A later trading-trust tranche reports these repaired and validated. Remaining honest gaps are captured in KI-016. |
| July 15 first-run Connect Account flow | July 18 synthetic authenticated pilot passed 3/3 viewports. Password recovery/product-model ambiguity remains KI-011. |
| July 15 raw System settings payload | Current source places the raw backend payload behind a collapsed details control and a diagnostics preference; not carried as open. |
| July 16 gap-attempt map too small and cache diagnostics absent | Current source sizes the map to the 16,384-cell base and exposes packed bytes, miss reasons, and evictions; not carried as open. |
| July 21 Algo secondary workspace loader timeout | Fixed during follow-up. Mandatory `AlgoLivePage` content now resolves with `AlgoScreen` under the normal route loader instead of opening an Algo-only second Suspense/loading stage. Focused one-loader and module-import tests pass. |
| July 7 signal-options system review | Contains many then-verified real-money findings, but predates extensive trading repairs, audits, and the current 90k-line working diff. Treat it as a revalidation backlog, not current truth. |
| June audits/investigations | Superseded by later fixes or lack current-runtime proof; retained as historical evidence only. |

Historical sources:

- [July 15 UX completeness audit](../../.gstack/qa-reports/ux-completeness-2026-07-15/qa-report-pyrus-ux-completeness-2026-07-15.md)
- [July 16 runtime QA](../../.gstack/qa-reports/qa-report-pyrus-2026-07-16.md)
- [July 18 onboarding pilot](../../.gstack/qa-reports/qa-report-onboarding-pilot-2026-07-18.md)
- [July 7 signal-options system review](../reviews/2026-07-07-signal-options-system-review.md)
- [July 14-16 shadow-trading audit](./shadow-trading-2026-07-14_2026-07-16.md)

## Browser QA result and coverage boundary

The normal app URL was checked without `?pyrusQa=safe` at 1440×900 and 390×844. The session was unauthenticated, so only Sign in and First-time setup were reachable.

Observed on that surface:

- no console errors or page exceptions;
- all observed network responses were HTTP 200;
- load about 711 ms, DOM ready about 669 ms, TTFB about 54 ms;
- no phone horizontal overflow;
- email/password controls had linked labels, appropriate autocomplete, and 44 px control heights;
- setup toggle and keyboard focus order worked;
- no form was submitted and no side-effectful control was used.

The public-surface evidence is in [the scoped QA report](../../.gstack/qa-reports/qa-report-known-issues-2026-07-21.md). Authenticated screens, live broker state, account/order mutations, and trading behavior were not tested.

## Validation ledger

| Check | Result |
|---|---|
| `pnpm run typecheck` | **Fail** — five DB test typing errors; stops before app workspaces |
| Direct serialized artifact/script typechecks | **Fail** — API, MCP, Pyrus, scripts fail; backtest-worker passes |
| `pnpm run audit:guards` | **Fail** — `.env.example` missing three variables |
| Remaining guard scripts | Publish context, Replit startup, markdown paths, branding, canonical signal env, retired alert tier, and session-persistence security pass; API codegen check is blocked by TypeScript errors |
| API Zod generated tests | **Pass 8/8** during codegen attempt |
| Session-persistence security tests | **Pass 33/33** across four suites |
| `pnpm run deadcode:prod` | **Pass** |
| `git diff --check` | **Pass** |
| Runtime freshness | **Resolved by Replit Stop/Run** — fresh PID/token and rebuilt bundle stayed stable through the matched five-minute watch |
| `/api/healthz` | HTTP 200; admission allow; actionable resource normal; observed resource watch |
| Public desktop/mobile browser smoke | Pass with KI-011 product/recovery gap; authenticated coverage unavailable |

## Recommended order of work

1. Keep publication blocked; coordinate the five-ref credential purge only after other sessions are idle and the destructive procedure is explicitly authorized.
2. Stabilize the shared tree and fix the root DB test types so declarations can rebuild; then rerun the entire TypeScript chain from a clean candidate.
3. Align `signalSettingsRevision` across DB models, all state constructors, OpenAPI/Zod/client output, and serialization tests.
4. Add the three missing environment-template entries and rerun every guard, codegen drift check, typecheck, and production build.
5. Load the candidate through the Replit-owned restart path, then perform the pending market-active/backend soak and authenticated read-only QA.
6. Prioritize the 2,000-symbol coverage ceiling and durable outage outbox before treating the system as broad-universe resilient.
7. Close or explicitly product-gate the remaining UX/workflow gaps in KI-011 through KI-016.
