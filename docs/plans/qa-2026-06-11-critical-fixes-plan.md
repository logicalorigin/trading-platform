# Implementation Plan: QA 2026-06-11 — Critical & High Availability Fixes

**Source report:** `.gstack/qa-reports/qa-report-pyrus-localhost-2026-06-11.md` (report-only QA watch, ~07:30–07:44 today).
**Scope of this plan:** the **Critical** issue first, then the two **High** issues, then the two **Medium** issues. Functional core works; *availability under load* is the problem.

## Overview

The API node process (`dist/index.mjs`) runs at 99–101% CPU continuously and the event loop starves during spikes, producing intermittent `/api/healthz` timeouts and cascading load-shed (429s) and stream rejections. The single highest-leverage fix is **ISSUE-001 (event-loop saturation)** — most other symptoms are downstream of it. ISSUE-002 is an independent, deterministic contract bug that can land in parallel.

## Severity ledger (from the report)

| ID | Sev | Symptom | Root-cause status |
|----|-----|---------|-------------------|
| ISSUE-001 | **Critical** | API ~100% CPU; `/healthz` 5s timeouts during spikes; loadavg 12→35 | **Unknown — needs profiling first** |
| ISSUE-002 | High | `/signal-monitor/matrix/stream` → 400 every load | **Known & deterministic** (enum mismatch) |
| ISSUE-003 | High | `/api/bars` shed with 429 under pressure | **Partly fixed**; residual is symptom of ISSUE-001 |
| ISSUE-004 | Medium | Memory 15Gi/15Gi, ~145Mi free, **no swap** | Env/config + possible leak |
| ISSUE-005 | Medium | Oversized payloads (`/signal-monitor/state` = 1.2MB/load) | Known; likely **feeds ISSUE-001** |

## Architecture decisions

- **ISSUE-001 is the spine.** ISSUE-003's residual 429s and much of ISSUE-004's pressure are consequences of a starved event loop. We profile and fix ISSUE-001 before declaring 003/004 resolved, to avoid chasing symptoms.
- **ISSUE-002 is independent and low-risk** — it can be implemented and shipped in parallel with the ISSUE-001 diagnosis (different files, no shared state). It also *reduces* steady-state load (push stream replaces some REST polling), so it weakly helps ISSUE-001.
- **No code is written until the ISSUE-001 root cause is identified.** Task 1 is a diagnosis task whose output (a named hot path) is the acceptance gate for Task 2.

---

## Task list

### Phase 0 — Critical diagnosis (fail-fast, do first)

#### Task 1: Profile the API event loop and identify the hot path
**Description:** Determine *what* keeps the API node process at ~100% CPU even at idle. The report shows saturation "before any heavy testing," so this is a constant hot path (busy timer, sync serialization, regex, or unbounded loop), not just load. Use the existing pressure instrumentation (`resource-pressure.ts` already samples `eventLoopDelayP95Ms`) plus a CPU profile.

**Acceptance criteria:**
- [ ] A CPU profile of the running API captured under steady state (e.g. `node --cpu-prof` on a dev boot, or `0x`/`clinic flame`, or `--prof` + `--prof-process`).
- [ ] The dominant on-CPU stack(s) named with file:line, accounting for the bulk of self-time.
- [ ] A one-paragraph root-cause statement: "observed" hot path + "inferred" mechanism, written into this plan under Task 2.

**Verification:**
- [ ] Profile artifact saved under `.pyrus-runtime/` or `scripts/reports/`.
- [ ] Re-sampling `eventLoopDelayP95Ms` confirms the named path correlates with the lag.

**Dependencies:** None.
**Files likely touched:** none (read-only profiling) — possibly a throwaway profiling launch script.
**Estimated scope:** S (investigation, no product code).

> **Checkpoint A — after Task 1:** root cause is named with profile evidence. Do **not** start Task 2 until this is true. If the hot path turns out to be `/signal-monitor/state` serialization, Task 5 is promoted ahead of Task 2.

**✅ Task 1 RESULT (2026-06-11, profile `.pyrus-runtime/api-cpu-377.cpuprofile`, 53,135 samples / 12s):**
Observed — API process (PID 377) event loop only **13.5% idle** (~86% busy) at steady state. Top self-time frames (excluding idle/GC):
- **`normalizeLegacyAlgoBranding` — 5.8%** (`services/algo-branding.ts:50`) — *dominant app cost.* A **recursive object walker** that rebuilds every object (`Object.fromEntries(Object.entries(...).map(...))`) and runs **14 regex replacements per key and per string value**, recursively. It's a cosmetic legacy "RayAlgo/RayReplica → Pyrus" rename, but it's invoked **per streaming event / per poll over full payloads**: `signal-monitor.ts:1301` (every signal event), `signal-options-automation.ts:1923` (every automation event), `automation.ts:432`, plus deployment configs in `shadow-account.ts`/`backtesting.ts`. The anonymous frames at `index.mjs:131089/131168/131300` are the regex-replace inner loops, so its true cost is higher than 5.8%.
- **`getOptionalEnv` — 3.8%** (`lib/runtime.ts:161`) — re-reads `process.env` in a loop on every IBKR bridge-override resolution; env is immutable at runtime → memoizable.
- **`_parseRowAsArray` — 4.1%** (`pg` row parsing) — indicates high DB query/row volume on the loop.
- **Signal-monitor minute-bar aggregation cluster — ~7%** (`signal-monitor.ts:3038 aggregateStockMinuteBarsForTimeframe`, `stockMinuteAggregateToSignalMonitorBar`, `resolveBucketStartMs`, `aggregateStockMinuteAggregatesForSignalMonitorBars`) — re-aggregates bars per evaluation tick.

Inferred: the saturation is **not one runaway loop** but constant per-event work dominated by the cosmetic brand-normalizer running over large streaming payloads, plus uncached env reads and per-tick bar re-aggregation. Highest-leverage / lowest-risk fix is to stop the brand-normalizer from rebuilding payloads that contain no legacy strings (and ideally remove it from the streaming hot path entirely) and to memoize the env/bridge-override resolution.

#### Task 2: Fix the identified event-loop hot paths (root cause now named — see Task 1 result)
**Description:** Apply surgical fixes to the named hot paths, in leverage order:
- **2a (primary) — stop `normalizeLegacyAlgoBranding` from rebuilding clean payloads.** Short-circuit with a cheap scan: if a value (or its serialized form) contains no legacy branding token, return it unchanged instead of recursively rebuilding every object and running 14 regexes per node. Best: lift it off the **streaming** hot path (`signal-monitor.ts:1301`, `signal-options-automation.ts:1923`, `automation.ts:432`) — branding is a legacy-data concern that does not belong on every emitted event. Confirm event payloads in practice contain no legacy strings (so skipping is a no-op behavior change).
- **2b — memoize env/bridge-override resolution** (`lib/runtime.ts:161` `getOptionalEnv` and its bridge-override callers); env is immutable at runtime.
- **2c (optional, larger) — memoize signal-monitor minute-bar aggregation** per `(symbol, timeframe, bucket)` within an evaluation tick.
Keep each change surgical and independently verifiable.

**✅ Task 2a DONE & verified (2026-06-11):** `algo-branding.ts` — added a `/ray/i` fast-guard to `normalizeLegacyAlgoBrandText` (every legacy pattern contains "ray", so clean strings skip all 14 regexes) and switched `normalizeLegacyAlgoBranding` to **structural sharing** (returns the original reference when a subtree has no legacy branding, instead of rebuilding every object). Output is byte-identical (callers only serialize the result; all hot call sites verified read-only). Verified: new `algo-branding.test.ts` 5/5 (incl. dirty-payload identity + clean-payload reference sharing), `signal-monitor-stream.test.ts` 8/8 regression, api-server typecheck clean, and a micro-benchmark on a representative clean signal payload: **94.5µs → 19.3µs/call (~4.9×, ~80% less CPU)**.

**✅ Task 2b DONE & verified (2026-06-11):** Re-profiling the rebuilt+restarted API (with 2a live) showed `getOptionalEnv` was the #1 app frame at 6.0%; call-tree analysis named the caller precisely — **`getMassiveRuntimeConfig` / `getFmpRuntimeConfig`** re-reading provider env on **every stock-aggregate fetch** (`getCurrentStockMinuteAggregates` → `getPreferredStockAggregateStreamSource` → `getProviderConfiguration`/`isMassiveStockWebSocketConfigured`/`isMassiveStocksRealtimeConfigured`/`massiveStocksUrl`). These configs derive only from immutable provider env, and no test mutates those vars, so both getters were given a lazy per-process memo (`lib/runtime.ts`) with a `__resetProviderRuntimeConfigCacheForTests()` hook. Verified: `runtime-provider-config.test.ts` 3/3, api-server typecheck clean.

**✅ Verified live impact (profiles of the running API, `.pyrus-runtime/api-cpu-*.cpuprofile`):**

| Frame | Baseline (PID 377) | After 2a | After 2a+2b |
|---|---|---|---|
| idle | 13.5% | 48.8% | **67.1%** |
| `normalizeLegacyAlgoBranding` | **5.8%** | absent | absent |
| `getOptionalEnv` | 3.8% | 6.0% | **absent** |

Both targeted frames are eliminated (<0.05%); event loop went from ~86% busy → ~33% busy. (Caveat: each profile is a freshly-restarted process so absolute idle% carries load-variance noise; the *controlled, attributable* result is the disappearance of the two specific targeted frames.) New top app frame is `getMassiveStocksRecency` (2.4%, same hot path, reads `MASSIVE_STOCKS_RECENCY` directly) — a candidate cheap follow-up, out of scope for 2a/2b.

**Acceptance criteria:**
- [ ] The named hot path no longer dominates a fresh CPU profile.
- [ ] Steady-state API CPU drops materially below ~100% at idle (capture `ps` before/after).
- [ ] `/api/healthz` stays 200 with sub-150ms latency across a 5-minute observation under the same load that previously stalled it.

**Verification:**
- [ ] `pnpm --filter @workspace/api-server run typecheck` green.
- [ ] Re-run the QA watch (or `browse`/curl loop) for 5 min: no `/healthz` 000 timeouts; loadavg stable.
- [ ] Relevant unit tests pass (`resource-pressure.test.ts`, plus any added regression).

**Dependencies:** Task 1.
**Files likely touched:** root-cause-dependent (target ≤5 files; if larger, re-slice).
**Estimated scope:** M (will be re-scoped once Task 1 lands).

> **Checkpoint B — after Tasks 1–2:** API idles well under saturation; `/healthz` stable for 5 min. Review before moving on — 003/004 are re-measured against this new baseline.

---

### Phase 1 — High issues

#### Task 3: Fix `/signal-monitor/matrix/stream` 400 (requestOrigin contract mismatch)
**Description:** The frontend stream builder sends `requestOrigin: "signal-matrix-stream"` (`artifacts/pyrus/src/features/platform/live-streams.ts:6320`), but the generated query schema `StreamSignalMonitorMatrixQueryParams` (`lib/api-zod/src/generated/api.ts:5019`) only accepts `['startup','poll','manual','test']`, so every stream request is rejected 400 — deterministic, not load-related.

**Approach (decided — 3a):** omit `requestOrigin` for the stream (the field is optional in the schema) so the SSE stream is **not** treated as a foreground-leader poll. The enum gates foreground-leader exact-cell work in `signal-monitor.ts` (`:770`, `:804`, `:897`); the stream runs *alongside* the REST poll, so adding foreground-leader exact-cell work would aggravate ISSUE-001. Frontend-only, no contract regen.

**Acceptance criteria:**
- [ ] `/signal-monitor/matrix/stream` returns a live SSE stream (not 400) for a normal multi-symbol page load.
- [ ] The signal matrix populates via push (verify a bootstrap event arrives) with the REST poll still working as fallback.
- [ ] No new foreground-leader exact-cell evaluation is triggered by the stream (confirm against `signal-monitor.ts` gates).

**Verification:**
- [ ] Direct repro from the report no longer 400s (single-symbol curl to the stream URL).
- [ ] `pnpm --filter @workspace/pyrus run typecheck` green.
- [ ] `signal-monitor-stream.test.ts` passes (add a case asserting a stream request with no `requestOrigin` is accepted and not classified as foreground-leader).

**Dependencies:** None (independent of Phase 0 — safe to parallelize).
**Files likely touched:** `artifacts/pyrus/src/features/platform/live-streams.ts` (drop the `requestOrigin` line in the matrix/stream URL builder, ~`:6320`) + test.
**Estimated scope:** XS.

#### Task 4: Re-measure and close `/api/bars` 429s
**Description:** The pressure-aware `sparklineHydrationGate` is already wired (`MarketDataSubscriptionProvider.jsx:477`), and admission shedding of `deferred-analytics` sparklines (`route-admission.ts:180`) is *intended* under pressure. The open question is whether residual 429s seen in the QA run are (a) the gate not fully holding, or (b) simply correct shedding because pressure was high due to ISSUE-001. Re-measure against the post-Task-2 baseline before changing admission policy.

**Acceptance criteria:**
- [ ] After Task 2, a 5-min watch shows no `/api/bars` 429s at `normal`/`watch` pressure (shedding at `high` is acceptable by design).
- [ ] If 429s persist at `normal` pressure, the gate gap is identified at file:line and fixed; otherwise close as "resolved by ISSUE-001."

**Verification:**
- [ ] Flight-recorder (`.pyrus-runtime/flight-recorder/api-current.json`) shows no `sparkline` 429s in the recent-failure window at sub-`high` pressure.

**Dependencies:** Task 2 (must measure against the fixed baseline).
**Files likely touched:** likely none; if a gap is found, `MarketDataSubscriptionProvider.jsx` and/or `route-admission.ts`.
**Estimated scope:** S (mostly measurement).

> **Checkpoint C — after Tasks 3–4:** stream is live, bars no longer shed at normal pressure. End-to-end live page loads clean.

---

### Phase 2 — Medium issues

#### Task 5: Trim oversized payloads (`/signal-monitor/state` = 1.2MB/load)
**Description:** `/signal-monitor/state` (`artifacts/api-server/src/routes/signal-monitor.ts:217`) returns ~1.2MB per page load. Large synchronous serialization on every request is both bandwidth and **event-loop cost** — it may be a contributor to ISSUE-001 (revisit ordering if Task 1 names it). Reduce via field projection, pagination, or omitting rarely-used sub-objects; confirm the frontend consumers tolerate the trimmed shape.

**Acceptance criteria:**
- [ ] `/signal-monitor/state` response is materially smaller (target: well under 1.2MB) for the same page.
- [ ] No frontend consumer breaks (identify consumers before trimming).

**Verification:**
- [ ] `curl` size before/after; `pnpm --filter @workspace/api-server run typecheck` + `pnpm --filter @workspace/pyrus run typecheck` green.
- [ ] Live page still renders signal state correctly.

**Dependencies:** None functionally; **sequence after Task 1** so we know whether it's also the ISSUE-001 hot path (in which case it merges into Task 2).
**Files likely touched:** `routes/signal-monitor.ts`, `services/signal-monitor.ts`, possibly api-zod response schema + a frontend consumer.
**Estimated scope:** M.

#### Task 6: Address memory headroom / no swap (code **and** infra — decided)
**Description:** `free -h` shows 15Gi/15Gi used, ~145Mi free, **0B swap** — one allocation from OOM. Largest consumers: Python compute (~4.6GB) and API (~1.8GB). Per decision, this covers **both** an infra change (add swap / raise the container memory limit) **and** code footprint (characterize RSS, fix any leak / cap a cache). Infra changes touch container/startup config — per CLAUDE.md, if `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, artifact `dev` scripts, db startup config, or `scripts/reap-dev-port.mjs` are touched, run `pnpm run audit:replit-startup` before handoff and do not remove `scripts/check-replit-startup-guards.mjs`.

**Acceptance criteria:**
- [ ] API RSS characterized over a 10-min run (steady vs. climbing); any identified leak/cache fixed in code.
- [ ] Swap and/or raised memory limit configured for the container; `free -h` shows non-zero headroom after the change.
- [ ] If startup/replit config was touched, `pnpm run audit:replit-startup` passes.

**Verification:**
- [ ] RSS sampling artifact (before/after); `free -h` shows swap/headroom present.
- [ ] App still boots via **Run Replit App** (full stack comes up) after any config change.

**Dependencies:** Task 2 (a hot-loop fix may itself reduce allocation churn).
**Files likely touched:** container/startup config (e.g. `.replit` / artifact `artifact.toml` / startup scripts — confirm which control swap/limits in this env); plus code if a leak/cache is found.
**Estimated scope:** M (diagnosis-led; spans code + infra).

> **Checkpoint D — complete:** API stable under a 5-min load watch; stream live; no normal-pressure shedding; payloads trimmed; memory characterized with a clear infra-vs-code recommendation.

---

## Parallelization

- **Parallel-safe now:** Task 3 (ISSUE-002) — fully independent, different files. Can be done by a second session while Task 1 profiling runs.
- **Strictly sequential:** Task 1 → Task 2 (fix needs the named cause); Task 2 → Task 4 and Task 6 (re-measure against fixed baseline).
- **Conditional:** Task 5 ordering depends on Task 1's outcome (promote ahead of Task 2 if `/signal-monitor/state` is the hot path).

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ISSUE-001 root cause not found in one profile pass | High | Time-box Task 1; capture under both idle and load; widen to GC/alloc profile if CPU profile is inconclusive |
| Trimming `/signal-monitor/state` breaks a hidden consumer | Med | Enumerate consumers (grep) before changing the shape; keep response schema in sync |
| "Fixing" 429s that are correct shedding | Low | Task 4 re-measures against the post-001 baseline before any admission change |
| Infra memory change destabilizes startup | Med | Per CLAUDE.md, run `pnpm run audit:replit-startup` after any startup/replit config edit; verify full app bring-up via **Run Replit App** |

## Resolved decisions

- **Q1 (ISSUE-002 semantics) → 3a.** Omit `requestOrigin` for the SSE stream; do not treat it as a foreground-leader poll. Frontend-only, no contract regen.
- **Q2 (ISSUE-004 infra) → in scope.** Adding swap / raising the container memory limit is part of Task 6, alongside the code-side RSS/leak work.
