# Metadata-As-Rules Audit

Date: 2026-06-02

Scope: inspect application paths where descriptive metadata can accidentally become a hard rule, especially in trading, diagnostics, admission, hydration, and UI suppression.

## Rule Used For The Audit

Metadata is acceptable when it explains state, ranks display, or annotates quality. Metadata becomes risky when fields such as `status`, `severity`, `quality`, `source`, `freshness`, `count`, or `score` block trading, shed requests, suppress data, hide UI, or change runtime behavior without being backed by a measured resource, a hard business rule, or an explicit operator setting.

## Changes Implemented

### App Readiness Keeps Diagnostics Degradation Advisory

`artifacts/api-server/src/services/readiness.ts` no longer downgrades app readiness just because aggregate diagnostics report `status: "degraded"`. Diagnostics `down` still makes the app not ready, and measured API pressure still drives degraded/not-ready states.

Why: a warning-level diagnostics event such as a browser warning is useful context, but it should not make the whole app readiness degraded when broker readiness and measured pressure are healthy.

Regression coverage:

- `artifacts/api-server/src/services/readiness.test.ts` now covers degraded diagnostics metadata with normal pressure and ready broker state.
- The critical-pressure test now uses the configured RSS threshold instead of a stale fixed RSS value.

### Diagnostics Overview Memory Card Uses Memory-Only Signal

`artifacts/pyrus/src/screens/DiagnosticsScreen.jsx` now drives the overview `Memory` card from the footer memory signal instead of broad resource pressure. Broad route/resource/admission pressure remains visible in the Diagnostics memory detail section, but it no longer changes the top-level Memory card state.

Why: latency, scanner, cache, or admission pressure can be important operational metadata, but the Memory card should communicate memory pressure only.

Regression coverage:

- `artifacts/pyrus/src/screens/DiagnosticsScreen.test.js` guards the memory overview source selection.

### Existing Footer Pressure Bars Stay Consumption-Based

The prior footer update remains part of this audit outcome: worker counts, poll counts, and stream counts are metadata only. The fourth footer bar is `Runtime`, backed by runtime/store consumption, so the four horizontal bars represent consumption pressure rather than object count pressure.

## Remaining Ranked Suspects

### 1. Signal Options Automation Gates

Files:

- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-options-worker.ts`

Risk: quote freshness, skipped reasons, quality tags, multi-timeframe reasons, and stored candidate state can suppress retries or block candidates. Some are legitimate hard rules, but persisted descriptive reasons need clear expiry and revalidation.

Recommended next step: add tests around stale rejection metadata recovery, candidate retry eligibility, and live/paper separation before altering behavior.

### 2. Route Admission And Resource Pressure

Files:

- `artifacts/api-server/src/services/route-admission.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`

Risk: route classes and pressure labels can shed requests. Shedding is valid only when driven by measured server pressure or explicit route policy, not client-side or diagnostic metadata.

Recommended next step: verify pressure inputs and add guard tests that browser/client/advisory diagnostics cannot shed API routes.

### 3. IBKR Runtime And Gateway Readiness

Files:

- `artifacts/api-server/src/services/algo-gateway.ts`
- `artifacts/api-server/src/services/platform-runtime-status.ts`
- `artifacts/ibkr-bridge/src/work-scheduler.ts`

Risk: connection health, lane health, stream freshness, and request errors can become broad readiness gates. Request-scoped errors should not poison global lane pressure unless they indicate measured systemic failure.

Recommended next step: split request-scoped failures from global readiness counters and add tests for recovery after no-security-definition or subscription errors.

### 4. Flow Universe And Market Data Source State

Files:

- `artifacts/api-server/src/services/flow-universe.ts`
- `artifacts/pyrus/src/features/flow/flowSourceState.js`
- `artifacts/pyrus/src/screens/TradeScreen.jsx`

Risk: optionability, degraded source state, provider status, and retained-source reasons can hide or retain market data beyond the actual freshness contract.

Recommended next step: add expiry/reverification tests for rejected universe entries and UI source retention.

### 5. GEX Projection Quality And Source Selection

Files:

- `artifacts/api-server/src/services/gex-projection.ts`
- `artifacts/api-server/src/services/gex.ts`

Risk: quality/source labels are necessary for display, but usable persisted snapshots should not be hidden because lightweight live sampling is unavailable.

Recommended next step: keep compact projection tests focused on persisted-first fallback and ensure quality metadata never suppresses valid overlay points.

## Validation

Passed:

- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/readiness.test.ts`
- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/screens/DiagnosticsScreen.test.js src/features/platform/useMemoryPressureSignal.test.js src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/memoryPressureModel.test.js`
