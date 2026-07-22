# Codex Fix Plan — IBKR-bridge / python-compute / GEX migration audit

**Date:** 2026-07-02 · **Author:** Claude (audit workflow `wf_4c2c649b-493`) · **For:** Codex execution
**Scope:** fix the defects found auditing the "move compute off the IBKR bridge → python-compute + GEX/Massive/Rust" work.

---

## 0. How to use this document

This is a self-contained work order. Each fix below gives you: exact files+lines, the current
(buggy) behavior, the root cause, the concrete change, and how to verify. **Read the cited code
before editing** — line numbers are accurate as of HEAD `28314c4` but may drift; anchor on the
named symbols. Keep every change surgical (see `CLAUDE.md` §3). Do not refactor adjacent code.

**Findings were adversarially verified** — an independent skeptic pass confirmed each one against
source (verdicts noted). Severities below are the *post-verification* severities.

### Priority order (do them in this order)
1. **H1** — python signal-matrix trend-direction parity (🔴 the only trading-impacting bug; live now)
2. **M1** — full-pipeline JS↔Python parity test (guards H1 and its neighbors from regressing)
3. **M2** — python-compute double-spawn / orphan race
4. **M3** — request-path 15s cold-start block ignores caller budget
5. **L1** — python cell `status:"unavailable"` suppresses JS fallback
6. **L2–L7, I1–I4** — GEX + bridge hygiene (batch into one cleanup PR)

### Verification toolbox (commands, from repo root `/home/runner/workspace`)
| What | Command |
|------|---------|
| Python compute tests | `pnpm run python-compute:test`  (or `cd python/pyrus_compute && uv run pytest -q`) |
| Python compute typecheck | `pnpm run python-compute:typecheck` |
| api-server typecheck | `pnpm --filter @workspace/api-server run typecheck` |
| api-server unit test (vitest) | `pnpm --filter @workspace/api-server exec vitest run src/services/<file>.test.ts` — *(no `test` npm script; vitest is invoked directly)* |
| Rust worker build | `pnpm run build:market-data-worker` |
| Rust worker fmt check | `pnpm run fmt:market-data-worker` |
| Full monorepo typecheck | `pnpm run typecheck` |
| Runtime verification | Use Replit's managed workflow restart action, then `curl -s localhost:8080/api/healthz`, `curl -s localhost:18768/health`, `curl -s localhost:18770/health` |

> The API runs a **built bundle** (`node dist/index.mjs`), so backend changes need a managed
> workflow restart to be visible at runtime (see `CLAUDE.md`). For these fixes the targeted tests +
> typecheck are the fast path; only reload for the live smoke checks noted per-fix.

---

## 🔴 H1 — Python `_signal_trend_direction` returns a bullish default where JS returns neutral

- **Severity:** HIGH · **Verdict:** CONFIRMED · **Live now** (`PYRUS_PYTHON_SIGNAL_MATRIX_ENABLED=1`)
- **File:** `python/pyrus_compute/src/pyrus_compute/jobs.py:445-456`
- **Reference (authoritative):** `lib/pyrus-signals-core/src/index.ts:774-808` (`resolvePyrusSignalsTrendDirection`)

### Symptom
When a higher-timeframe (HTF) cell has too little history for the WMA basis to be computable, the
Python port returns `1` (bullish). The JS reference returns `0` (neutral / non-confirming). Because
`signal-monitor.ts:11682` merges `pythonStates.get(key) ?? evaluateSignalMonitorMatrixStateFromCompletedBars(...)`
— **Python wins whenever it returns a cell** — the Python path can emit a `buy_signal` that the JS
reference deliberately suppresses.

### Failure scenario
Cell with `mtf3="D"`, `requireMtf3=true`, `basisLength≈80`, only a few days of 5m bars → aggregated
daily basis is all-NaN → no finite comparison. JS: `mtfDirections[2]=0` → `0===+1` false → `mtfPass=false`
→ signal suppressed. Python: `direction=1` → `1==1` true → `mtfPass=true` → **spurious long signal**.
It also mislabels the indicator-snapshot HTF trend ("bullish" vs JS `null`) and perturbs
`directionalFeatures.mtfAlignment`, which feeds score models.

### Root cause
The port dropped JS's `basisComputable` flag: it initializes `direction = 1` and returns it even when
the guarded branch never executes; and it returns `1` (not `0`) for empty bars.

### Fix — mirror the JS exactly
Replace `jobs.py:445-456` with:
```python
def _signal_trend_direction(bars: list[SignalMatrixBarInput], basis_length: int) -> int:
    # Mirror lib/pyrus-signals-core/src/index.ts resolvePyrusSignalsTrendDirection:
    # return 0 (neutral / non-confirming) when the WMA basis is never computable —
    # empty bars, or fewer than basis_length bars so no finite basis comparison is
    # ever evaluable. Consumers must treat 0 as non-confirming, never a bullish default.
    if not bars:
        return 0
    basis = _signal_wma([bar.c for bar in bars], basis_length)
    trend_direction = 1
    basis_computable = False
    for index in range(len(bars)):
        if index >= 5 and math.isfinite(basis[index]) and math.isfinite(basis[index - 5]):
            basis_computable = True
            if basis[index] > basis[index - 5]:
                trend_direction = 1
            elif basis[index] < basis[index - 5]:
                trend_direction = -1
    return trend_direction if basis_computable else 0
```

**No consumer changes needed** — they already handle `0` correctly:
- Gate `jobs.py:664-666` `mtf_directions[i] == direction` (direction ∈ {−1,+1}) → `0` never confirms. Matches JS `index.ts:1091-1093`.
- `mtf_alignment` `jobs.py:607-610` counts `0` as neither aligned nor opposed (contributes 0).
- Indicator snapshot `jobs.py:930-936`: `_normalized_indicator_direction(0)` → `None` (neutral, `jobs.py:867-872`); `pass` uses `direction == current_direction` → `0` can't falsely pass.

### Verify
- `pnpm run python-compute:test` stays green.
- Add the differential test in **M1** (this is the real proof).
- Optional runtime: managed workflow restart, then confirm `:18770/health` 200 and no new spurious signals on short-history HTF symbols.

---

## 🟠 M1 — Full-pipeline JS↔Python parity test (close the gap that hid H1)

- **Severity:** MEDIUM · **Verdict:** CONFIRMED
- **Files:** `python/pyrus_compute/tests/fixtures/generate-directional-features-parity.mts`,
  `python/pyrus_compute/tests/test_signal_matrix_directional_features.py`
- **JS reference entry:** `lib/pyrus-signals-core/src/index.ts:1126` (`evaluatePyrusSignalsSignals`)
- **Python entry:** `python/pyrus_compute/src/pyrus_compute/jobs.py:951` (`run_signal_matrix`) → `_evaluate_signal_cell` (`:699`)

### Symptom
The only cross-language golden fixture pins the **isolated** helper `_signal_directional_features`
with *constant* `mtfDirections/adx/atr` inputs. It never drives `_signal_trend_direction`,
`_signal_adx/_atr/_volatility_score`, `_aggregate_signal_bars`, or the CHoCH/BOS loop — so H1 passed
every existing test. Any drift in those un-pinned ports ships silently.

### Fix — add a full-pipeline differential fixture + test
1. **Extend the generator** (`generate-directional-features-parity.mts`) to also emit golden outputs
   from the *full* JS evaluator `evaluatePyrusSignalsSignals` over the seeded bars. Add a new fixture
   file (e.g. `signal-matrix-pipeline-parity.json`) capturing, per case: the input bars + settings, and
   the JS-produced `signals[].filterState.mtfDirections`, `.mtfPass`, emitted signal
   (direction/barIndex), and `indicatorSnapshot`. **Include a data-starved-HTF case** that reproduces
   H1: settings `requireMtf3=true`, `mtf3="D"`, `basisLength≈80`, and a bar series only a few days long
   that produces a long CHoCH on the live edge. Read `evaluatePyrusSignalsSignals`'s input/return shape
   to wire the settings and read the fields to serialize.
2. **Add a Python test** in `test_signal_matrix_directional_features.py` that loads the new fixture,
   runs `run_signal_matrix` on the same cells, and asserts equality of `state.status`, the emitted
   `state.signal` (direction/barIndex/null-ness), and `filterState.mtfDirections` / `.mtfPass` for
   every case (exact for ints/bools; `abs(diff) <= 1e-6` for floats). This test **must fail before H1**
   and pass after.
3. Keep the existing directional-features fixture/tests as-is.

### Verify
- Before applying H1: the new test **fails** on the data-starved case (Python emits a signal JS suppresses).
- After H1: `pnpm run python-compute:test` fully green.
- Document the regenerate command in the test docstring (mirrors the existing one):
  `pnpm --filter @workspace/api-server exec tsx python/pyrus_compute/tests/fixtures/generate-directional-features-parity.mts`.

---

## 🟠 M2 — Concurrent `start()` double-spawns / orphans a python lane child

- **Severity:** MEDIUM (finder said HIGH; verifier downgraded — self-heals, cannot accumulate) · **Verdict:** CONFIRMED
- **File:** `artifacts/api-server/src/services/python-compute.ts:361-448`

### Symptom / root cause
`start()` guards only `if (this.child)` (`:365`), then **awaits twice** (`probeHealthOnce` `:369`,
`probePortOpenFn` `:378`) before spawning (`:395`) and assigning `this.child = child` (`:411`). Two
concurrent `start()`s during a crash window both pass the guard (child is null), both spawn, and the
second assignment orphans the first process (which `stop()` can no longer kill). The `exit`/`error`
handlers (`:433-448`) also set `this.child = null` unconditionally, so a stale child's exit can null a
freshly-spawned child's slot.

### Fix — coalesce concurrent starts + guard handler identity
1. Add a field: `private startPromise: Promise<PythonComputeDiagnostics> | null = null;`
2. Split the public `start()` from the body. Keep the cheap guards in the public method and coalesce:
```ts
async start(): Promise<PythonComputeDiagnostics> {
  if (!this.config.enabled) return this.getDiagnostics();
  if (this.child) return this.getDiagnostics();
  if (this.startPromise) return this.startPromise;            // coalesce concurrent starts
  this.startPromise = this.startInner().finally(() => { this.startPromise = null; });
  return this.startPromise;
}
```
   Rename the current body (the probe→spawn→waitForHealth logic, `:369-463`) to
   `private async startInner(): Promise<PythonComputeDiagnostics>`.
3. Make the child handlers identity-checked so a stale child can't null a new slot:
```ts
child.once("error", (error) => {
  if (this.child !== child) return;
  this.child = null;
  this.markDegraded(error.message);
});
child.once("exit", (code, signal) => {
  if (this.child !== child) return;                            // a newer child owns the slot
  this.child = null;
  this.diagnostics.pid = null;
  if (this.stopping) { this.diagnostics.status = "stopped"; return; }
  this.markDegraded(`Python compute exited with code ${code ?? "null"} signal ${signal ?? "null"}.`);
  this.scheduleRestart();
});
```

### Verify
- `pnpm --filter @workspace/api-server exec vitest run src/services/python-compute.test.ts` green (add a case: fire N concurrent `runJob`s against a not-yet-started lane using the injectable `spawnProcess` mock; assert `spawnProcess` is called **once**).
- Runtime: kill the risk lane (`pkill -f pyrus_compute` on `:18768`) while firing several concurrent shadow-account reads; after recovery confirm **exactly one** `pyrus_compute` process serves `:18768` (`pgrep -af pyrus_compute`).

---

## 🟠 M3 — Request-path cold start blocks ~15s, ignoring the caller's timeout budget

- **Severity:** MEDIUM · **Verdict:** CONFIRMED
- **File:** `artifacts/api-server/src/services/python-compute.ts` — `runJob` (`:503`), `submitJob` (`:466`), `ensureHealthy` (`:540`), `waitForHealth` (`:621`)

### Symptom / root cause
`runJob` computes its deadline from `options.timeoutMs` (callers pass ~2500ms) and calls
`submitJob(request, timeoutMs)`. But `submitJob` calls `await this.ensureHealthy()` **with no budget**
(`:470`); `ensureHealthy` → `start()` → `waitForHealth()` loops to `config.startupTimeoutMs` (default
**15_000**, `:622`). So a cold or crash-looping lane blocks the request ~15s even though the caller's
budget was 2.5s. `waitForHealth` also never observes child exit, so a fast-crashing spawn still burns
the full 15s.

### Fix — bound the startup wait by the caller's budget; fail fast on child exit
1. Give `ensureHealthy` an optional budget and race it (composes with M2's coalesced start — the
   background start keeps running for the next call):
```ts
private async ensureHealthy(maxWaitMs?: number): Promise<void> {
  const startPromise = this.start();                 // coalesced; continues in background
  if (maxWaitMs != null && this.diagnostics.status !== "healthy") {
    const outcome = await Promise.race([
      startPromise.then(() => "settled" as const),
      this.delayFn(maxWaitMs).then(() => "timeout" as const),
    ]);
    if (outcome === "timeout") {
      throw new Error(`Python compute not healthy within ${maxWaitMs}ms`);
    }
  } else {
    await startPromise;
  }
  if (this.diagnostics.status !== "healthy") {
    throw new Error(
      `Python compute service is ${this.diagnostics.status}: ${this.diagnostics.lastError ?? "unavailable"}`,
    );
  }
}
```
2. Thread the budget from `submitJob` (`:470`): `await this.ensureHealthy(timeoutMs);` (and, for
   consistency, `getJob`/`cancelJob` at `:486`/`:495` may pass their own `timeoutMs`).
3. Make `waitForHealth` fail fast when the child dies during startup — inside the loop (`:624`):
```ts
while (Date.now() < deadline) {
  if (!this.stopping && !this.child && this.diagnostics.startedAt) {
    throw new Error(`Python compute exited during startup: ${this.diagnostics.lastError ?? "unknown"}`);
  }
  const probe = await this.probeHealthOnce();
  ...
}
```
   (Boot-time `startPythonComputeRuntime` still calls `start()` with no budget → keeps the full 15s.)

### Verify
- Callers already fall back to JS on throw (e.g. `account-portfolio-risk.ts`, `account-greek-scenarios.ts`) — confirm each caller's try/catch degrades rather than surfacing the error.
- Runtime: kill the risk lane, fire 3+ concurrent shadow-account portfolio-risk/greek reads → each returns the JS-fallback payload within ~budget (≈3s), **not** 15–17s.
- `pnpm --filter @workspace/api-server exec vitest run src/services/python-compute.test.ts` green (add: a `start` that never becomes healthy + `ensureHealthy(2500)` rejects within ~2.5s using the injectable `delayFn`).

---

## 🟡 L1 — Python cell `status:"unavailable"` is ignored, suppressing the JS fallback

- **Severity:** LOW · **Verdict:** CONFIRMED
- **File:** `artifacts/api-server/src/services/signal-monitor.ts` — `normalizePythonSignalMatrixState` (`:8189`), `signalMonitorMatrixStateFromPython` (`:8200`), merge (`:11682`)

### Symptom / root cause
`normalizePythonSignalMatrixState` parses `status: "ok" | "unavailable"` (`:8189`), but
`signalMonitorMatrixStateFromPython` never reads `pythonState.status`. An `unavailable` cell with
`signal:null` still produces a full present "no signal" state (`:8253-8268`), which the merge
(`pythonStates.get(key) ?? evaluateSignalMonitorMatrixStateFromCompletedBars`, `:11682`) treats as
authoritative — so the JS fallback never runs for that cell.

### Fix
In `signalMonitorMatrixStateFromPython`, after the `latestBar` guard (~`:8213-8215`), bail so the
caller falls back to the JS evaluation:
```ts
if (input.pythonState.status === "unavailable") {
  return null; // defer to evaluateSignalMonitorMatrixStateFromCompletedBars for this cell
}
```

### Verify
`pnpm --filter @workspace/api-server exec vitest run src/services/signal-monitor*.test.ts` green; add a
case: python state `{status:"unavailable", signal:null}` → `signalMonitorMatrixStateFromPython` returns
`null` and the merged result equals the JS-computed state.

---

## 🟡🔵 L2–L7 / I1–I4 — GEX + bridge hygiene (single cleanup PR)

All LOW/INFO, all CONFIRMED. None block trading; group them.

### L2 — Rust GEX coerces missing theta/vega/mark/volume to 0 (TS preserves null)
- **Files:** `crates/market-data-worker/src/compute/gex.rs:402-413` vs `artifacts/api-server/src/services/gex.ts:1342-1351`
- TS uses `finiteOrZero` for gamma/delta/openInterest/impliedVol/bid/ask, but **preserves theta/vega/mark/volume as `undefined`** (comment at `gex.ts:1350` — "Preserve missing as undefined … so coverage stays accurate"). Rust `unwrap_or_default()`s all of them to `0.0`, so the persisted snapshot reports fake 0-greeks and inflates coverage.
- **Fix:** in `gex.rs`, change only **theta (`:404`), vega (`:405`), mark (`:410`), volume (`:413`)** from `contract.<field>.unwrap_or_default()` to `contract.<field>` (serde serializes `Option::None` → `null`, matching TS). Leave gamma/delta/openInterest/impliedVol/bid/ask as `unwrap_or_default()` (TS coerces those to 0 too — parity holds).
- **Verify:** `pnpm run build:market-data-worker`; confirm a persisted `gex_snapshot` row now carries `null` (not `0`) for missing theta/vega. Cross-check one symbol's persisted payload vs the TS live recompute (see "invariants" below).

### L3 — Treasury yield-curve has no prior-month fallback; risk-free silently → 0, cached 6h
- **File:** `artifacts/api-server/src/services/treasury-yield-curve.ts` (URL month `:50`, `unavailableRates` `:31/:94`, TTL `:3` = 6h, cache write `:133`)
- Early-morning current-month fetch can return 0 rows → `rate=0` pinned for 6h (greeks use a 0 risk-free).
- **Fix:** (a) when the current-month fetch yields `unavailable`, retry once with the **previous** month before giving up; (b) cache an `unavailable` result with a **short** TTL (e.g. 5 min), not 6h — gate the `expiresAt` on availability. Keep the 6h TTL for successful fetches.
- **Verify:** unit test both paths (current-month empty → prior-month succeeds; both empty → short TTL). `pnpm --filter @workspace/api-server exec vitest run src/services/gex*.test.ts` + any treasury test.

### L4 — GEX staleness thresholds diverge across paths
- **Files:** `gex.rs:11` (`GEX_STALE_AFTER_SECS=120`), `gex.ts:204-207` (snapshot max-age 60_000ms), `gex.ts:1607` (live `isStale` = 15min)
- **Fix:** decide the intended contract. If the Rust 120s and TS 60s both mean "is this snapshot fresh enough to serve," unify them behind one shared constant/config. If they intentionally differ (worker-write staleness vs serve-gate vs live-recompute staleness), add a one-line comment at each site naming its role. (Judgment call — prefer documenting intent over changing behavior unless you can confirm they should match.)

### L5 — Zero-gamma reported by two methodologies with no discriminator
- **File:** `gex.ts:1813-1815` — `zeroGamma = simulation?.zeroGamma ?? legacyZeroGamma` (BS spot-sweep vs strike-cumulative interpolation), no field says which.
- **Fix:** add a served field `zeroGammaMethod: "simulation" | "legacy" | null` set alongside `zeroGamma`, so consumers/telemetry can tell the methods apart (and so an endpoint that must use one method can assert it). Default scan window is `spot*0.85..1.15` (`gex-zero-gamma-simulation.ts:317-326`) — leave as-is.

### I1 — python-compute restart loop has no give-up cap
- **File:** `python-compute.ts:675-689` (`scheduleRestart`)
- **Fix (optional hardening):** after a max consecutive `restartCount` (e.g. 10), stop rescheduling and stay `degraded` (keep the per-request JS fallbacks doing the work); reset `restartCount` on a healthy probe. Defensible as-is; low priority.

### I2 — `deriveSpotFromOptionChain` picks middle of an **unsorted** array (not a median)
- **File:** `gex.ts:946-953` — `prices[Math.floor((prices.length-1)/2)]` on contract-order prices.
- **Fix:** sort a copy first: `const sorted = [...prices].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)];` (or rename to reflect it's a positional fallback). Negligible real impact — fallback path only.

### I3 — Dead duplicated provider branch in Rust
- **File:** `gex.rs:495-501` — two byte-identical `if normalized.contains("massive")` blocks; the second is unreachable.
- **Fix:** delete the second block (migration residue). `pnpm run fmt:market-data-worker` + build.

### L6 — Sidecar registry can park a failed-subscribe line in `"releasing"` (TOCTOU bookkeeping leak)
- **File:** `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/registry.py:129-151` (+ `_clear_task` `:149`, state set `:159`)
- A line whose subscribe failed (handle is None) gets stamped `"releasing"` with no release task and is skipped for deletion while its subscribe task is still tracked; `_clear_task` runs via a `call_soon`-scheduled callback. Leaks only bookkeeping (never a live IBKR line) and self-heals if re-desired.
- **Fix:** in the release path, a handle-less **failed** line should be deleted directly (or moved to a terminal state the next reconcile removes) rather than parked in `"releasing"`; ensure `_clear_task` removes it. Add a `pytest` case. Low priority.

### L7 — Bridge liveness defeated by a forward clock skew (half-open guard bypass)
- **File:** `platform-bridge-health.ts:413-420` — `lastTickleAgeMs = Math.max(0, now - lastTickleAtMs)` where `lastTickleAtMs` comes from the bridge's self-reported clock (`:614`). A bridge clock ≥ `livenessFreshMs` ahead clamps age to 0 → `livenessFresh` stays true forever, bypassing the half-open detector. (Code already comments this at `:413`.)
- **Fix:** prefer the **local receive time** (when the API ingested the tickle) as the liveness clock; or treat a future timestamp as not-fresh: `const raw = now - lastTickleAtMs; const lastTickleAgeMs = raw < 0 ? null : raw;` and let a `null` age count as **not** fresh. Display-only today (doesn't gate trading), so low priority — but it's the guard that's supposed to catch a half-open gateway.
- **Verify:** simulate a half-open gateway (socket connected+authed but tickle round-trips blocked) and confirm health flips `connectivityUp=false` with a liveness-stale reason within ~2 min.

### I4 — Quote stream reports "fresh" with zero quotes during the post-restart grace window
- **File:** `bridge-quote-stream.ts:444-455` (`resolveCurrentStreamDataAt` falls back to `streamStartedAt`), `:943` (`streamStartedAt = readyAt`), `:1253-1260` (feeds `streamFresh`/`streamVouchesForConnection`).
- **Fix (optional):** don't let the `streamStartedAt` fallback vouch for connection freshness until ≥1 real quote has arrived post-restart, or cap the grace window. Deliberate today; info-level.

---

## Confirmed-working invariants — DO NOT regress these

The audit verified these are correct; keep them intact while fixing the above:
- **Black-Scholes greeks** (`black_scholes.py`): d1/d2, signs, per-day theta (`/365`), vega per vol-point, dividend/rate carry, and the T=0/zero-vol branch.
- **`portfolio_risk`** math (`jobs.py`): notional/gross/net/delta-adjusted, per-shock PnL, covariance only with ≥2 symbols & ≥3 aligned observations.
- **Directional-features** parity to 1e-6 (the existing pinned fixture) — M1 must not weaken it.
- **GEX `contractGex` sign + scale is identical** between `gex.ts:1112-1123` and `gex.rs:140-152` — L2 only touches null-preservation of missing greeks, **not** the gamma-exposure formula. Keep them identical.
- **ETag encodes `isStale`** (`gex.ts:283-293`) and 304s require strict identity (`platform.ts:2428-2466`).
- **Lane/job-type gating** (`app.py:138-143`) and **clean failure of malformed payloads** (`app.py:203-209`, `failedJobs++`).
- **Compute stays off the bridge** — do not add numpy/scipy or greek/gex math to `python/ibkr_sidecar` or the `bridge-*.ts` services.

---

## Suggested PR breakdown
1. **PR-1 (H1 + M1):** the trend-direction fix + the full-pipeline parity test. Ship together — the test proves the fix and locks it. *(python only; `python-compute:test` + `python-compute:typecheck`.)*
2. **PR-2 (M2 + M3 + L1):** python-compute dispatch resilience + the unavailable-fallback. *(api-server; vitest + typecheck.)*
3. **PR-3 (L2–L7, I1–I4):** GEX + bridge hygiene. *(rust + api-server + sidecar; build + fmt + typecheck + targeted tests.)*

Post-fix, re-run the live smoke checks: managed workflow restart → `:8080/api/healthz`, `:18768/health`,
`:18770/health` all 200, and (H1) confirm short-history HTF symbols no longer emit signals the JS path
suppresses.
