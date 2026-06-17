# Plan: Decouple Signal Generation from Deployment Environment

- **Created:** 2026-06-16 (MT)
- **Author session:** `2b331249-f38b-40d0-b8bc-5379c6f1e5ec`
- **Status:** PLAN ONLY — no code changed by this doc. Awaiting user go-ahead per stage.
- **Builds on:** the just-landed (uncommitted) backfill restore in `signal-monitor.ts` (drives the deep-history backfill from the server-owned producer so all 6 frames generate with the legacy scan flag off). That fix is the *foundation* — it makes a single source viable. This plan removes the *environment* coupling on top of it.

## Problem (verified)

Signal generation is **upstream and universal** — it's just the pyrus indicator firing on market data + settings. Shadow/paper/live is a **downstream execution** concern (how a deployment acts on signals). But today the signal-monitor is **environment-scoped end to end**, so signals are duplicated per env and consumers can read the wrong (stale/disabled) copy.

Evidence:
- **Two redundant profiles, same watchlist.** `signal_monitor_profiles`: `paper` (enabled, generating) and `live` (disabled, last evaluated 2026-06-01) — identical watchlist `4a26296d…`, 5m, 500 symbols. `live` is a stale duplicate.
- **Generation runs off enabled profiles** (`listEnabledSignalMonitorProfiles`, `signal-monitor.ts:7160/:7382`) → only `paper` generates.
- **Reads default to runtime mode** — `resolveEnvironment()` → `getRuntimeMode()` (`signal-monitor.ts:391`; `runtime.ts:445` returns `live` only if `TRADING_MODE=live`, else `paper`).
- **Deployments read signals scoped to their own mode** at **9 sites** in `signal-options-automation.ts`: `:2380, :4996, :5011, :5029, :5141, :12194, :14632, :15970, :16172` (`environment: deployment.mode` / `input.deployment.mode`), plus a direct profile query `eq(signalMonitorProfilesTable.environment, input.deployment.mode)` (`:4669`).
- **`getOrCreateProfile(env)` silently creates an empty profile** for any env handed in (`signal-monitor.ts:2331`) → a non-`paper` read yields a dormant, never-generated profile.
- **The signals page only looks healthy because it hard-codes `environment="paper"`** (`SignalsScreen.jsx:3475`); the frontend otherwise threads a central `signalMonitorEnvironment` (`PlatformApp.jsx`, ~12 sites).

**Net impact:** a `live`-runtime deployment (and any read that resolves to a non-generating env) sees stale/empty signals while `paper` generates fresh ones. Signals are not one upstream feed.

## Coupling map (blast radius)

| Layer | Locations | Coupling |
|---|---|---|
| Generation | `signal-monitor.ts:7160/:7382` (producer), `:2331` getOrCreateProfile | per-`environment` profiles |
| Resolution | `signal-monitor.ts:391` resolveEnvironment → `runtime.ts:445` getRuntimeMode | read env = runtime mode |
| Backend reads | `signal-monitor.ts:9829` getSignalMonitorState, `:9765` getSignalMonitorStoredState, `:9657` readSignalMonitorStateFresh, `:9539` passive | all take `environment` |
| Deployment consumption | `signal-options-automation.ts:2380,4669,4996,5011,5029,5141,12194,14632,15970,16172` | `environment: deployment.mode` |
| API routes | `routes/signal-monitor.ts` profile/state/events/breadth/matrix-stream | `environment` query param (zod) |
| Frontend | `PlatformApp.jsx` `signalMonitorEnvironment` (~12 sites), `SignalsScreen.jsx:3475/:3559`, `SettingsScreen.jsx:949/987/1003`, `AlgoScreen.jsx:1179`, `live-streams.ts:6387/:6469` | passes env to reads/stream |
| DB schema | `lib/db/src/schema/signal-monitor.ts` profiles/states/events carry `environment` (shared `environment_mode` enum, `enums.ts:3`); unique index per env (`:40`) | env in schema |

## Target architecture

- **One universal signal source.** Generation + storage + reads are keyed by `symbol`/`timeframe` only (no deployment env).
- **Deployment mode = execution only.** Shadow/paper/live decide *whether/how to trade*; every deployment reads the **same** signal feed.
- **`environment_mode` enum stays** (deployments/trading/broker legitimately use `mode`). Only the **signal-monitor's** use of it is removed.

## Trade-safety invariants (MUST preserve — do not regress)

1. Execution refuses non-actionable signals: `actionEligible` gates on `data_stale` (`status !== "ok"`) — `signal-options-automation.ts:2481/:2487`, `signal-monitor-actionability.ts:56`. Decoupling reads must NOT make stale signals actionable.
2. Stable-only selector: no provisional/unstable signals leak into canonical events (`selectStableSignalMonitorSignalEvent`).
3. Producer flag-independence + pressure backoff (from the backfill fix) stay intact.
4. Restarts are USER-controlled; runtime changes take effect only on api-server restart.

## Staged migration (each stage independently verifiable + reversible; signals never go dark)

### Stage 0 — Define the canonical source (no behavior change)
- Add `CANONICAL_SIGNAL_ENVIRONMENT` (= the single enabled profile; today `paper`, reused as the canonical key to avoid any data move) and a `resolveSignalSourceEnvironment()` helper that returns it, ignoring `deployment.mode` / runtime mode.
- Add the Stage-1 verification query (below).
- **Accept:** helper exists; no read yet routed through it; typecheck green.

### Stage 1 — Decouple backend READS (core; reversible) ← recommended first实施
- Route the 9 deployment-consumption sites and `getSignalMonitorState/StoredState` through `resolveSignalSourceEnvironment()` instead of `deployment.mode`. Replace the direct `eq(...environment, deployment.mode)` at `:4669` with the canonical env.
- Generation stays on the enabled profile (`paper` = canonical) — no producer change needed.
- **Accept:** a `live`-mode AND a `shadow`-execution deployment both read the *same* fresh states as `paper`; trade-safety chain unchanged (verify `actionEligible` still gates a stale signal); api-server typecheck green; after a user restart, DB query shows every deployment mode resolving to the same `paper` states.

### Stage 2 — Decouple the API + frontend
- Read endpoints (`/signal-monitor/state|events|breadth|matrix/stream`) resolve `environment` to canonical server-side (accept the param for compat, ignore it for source selection).
- Frontend: pin `signalMonitorEnvironment` (PlatformApp) to canonical; drop the per-mode derivation. SignalsScreen/Settings/Algo/live-streams then read one source.
- **Accept:** page + all consumers read one feed regardless of app/deployment mode; browser QA shows fresh signals; no "unavailable" from a wrong-env read.

### Stage 3 — Collapse the DB profiles (OPTIONAL, later; gated, higher-risk)
- Once reads are canonical, `live` is dead weight. Prefer **leaving it dormant** (reads no longer touch it). Full removal = a **SQL migration under `lib/db/migrations/`** (NOT drizzle-kit push — shared dev DB, push disabled after prior data loss) dropping `environment` from signal tables + collapsing to one profile.
- **Accept:** explicit user review; backup; reversible migration; all suites green.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| A consumer legitimately needed per-env signals | None found — `live` is a stale duplicate of `paper`; confirm during Stage 1 |
| Trade-safety regression (stale → actionable) | actionability is downstream of the read and untouched; add a test asserting a stale signal stays `actionEligible=false` |
| Schema migration data loss (Stage 3) | Defer; SQL migration only; gated on user review + backup |
| Changing the shared `environment_mode` enum | DO NOT — deployments/trading/broker still use `mode`; only signal-monitor's use is removed |
| Verifying needs a restart | User-controlled restart after each backend stage; verify via DB before proceeding |

## Verification harness (per stage)
- **DB:** for each deployment mode, the resolved signal read returns the same fresh `paper` states (no stale/empty); all 6 frames generating (the Stage-0/restore query).
- **typecheck:** `PYRUS_ALLOW_HOT_VALIDATION=1 pnpm --filter @workspace/api-server run typecheck` (note: currently red on another agent's `automation.ts` WIP — unrelated).
- **Browser QA:** signals page + Algo STA table render the single feed.
- **Trade-safety test:** stale signal stays non-actionable.

## Open questions
1. Reuse `paper` as the canonical key (zero data migration) vs introduce a neutral sentinel? Recommend reuse for now; rename in Stage 3 if desired.
2. Are any deployments actually running `live` runtime today, or is the breakage latent? (Confirm; fix regardless.)
3. Sequence vs the in-flight signal-audit agent (rename/vocab) and the pool-contention agent (automation.ts) — coordinate file ownership before Stage 1 touches `signal-options-automation.ts`.
