# GEX Page — Audit, Diagnosis & Fix Plan

## Context

The user reports that some areas of the GEX (gamma exposure) page aren't hydrating. An audit of `src/screens/GexScreen.jsx`, the data hook `src/features/gex/useGexZeroGamma.js`, the backend `artifacts/api-server/src/services/gex.ts`, and prior handoff/audit notes shows the page is ~95% healthy. There is **one genuine dead region** (the Gamma Squeeze Screener), **one intermittent whole-page failure mode** (the `dataReady` cascade under backend data pressure), and **several intentional empty states** that look like — but are not — hydration bugs. This document records all three and proposes a surgical fix for the real defect.

## Diagnosis

### A. PRIMARY DEFECT — "Gamma Squeeze Screener" never hydrates
- The backend **hardcodes flow context as unavailable**: `artifacts/api-server/src/services/gex.ts:774-775` returns `flowContext: null`, `flowContextStatus: "unavailable"`, and the `source.flow*` counts are placeholders set to `0` (`gex.ts:743-792`).
- The frontend correctly gates on it: `src/screens/GexScreen.jsx:1270-1282` sets `flowContext = flowContextStatus === "ok" ? gexData.flowContext : null` and only runs `computeSqueeze` when `metrics && spot != null && flowContext`. So `SqueezeCard` always renders the "Flow context unavailable" state.
- This was **deliberately deferred**: `gex.validation.ts` (~304-305) asserts `flowContextStatus === "unavailable"`; the 2026-05-22 GEX audit handoff explicitly noted "the Squeeze card is honest but currently unavailable because backend `flowContext` is not wired to real flow context yet."
- `computeSqueeze` (`src/features/gex/gexModel.js:575-631`) needs: `bullishShare` (0..1), `netDelta`, `refDelta`, `todayVol`, `avg30dVol`, `volumeBaselineReady`, `eventCount`.

### B. SECONDARY — whole-page blanking via the `dataReady` cascade
- `GexScreen.jsx:1566-1598` is a strict guard cascade (`chainError` → `noExpirations` → `loading` → `spot == null` → `!filteredRows.length` → `!dataReady`). If any trips, the **entire** metrics + charts region (regions 6–12) is replaced by one message.
- The backend throws `503` and trips this cascade when: spot can't be resolved from any of 3 fallbacks (`gex.ts:700-706`), no rows survive the `gamma != null && openInterest != null` filter (`gex.ts:708-714`), no expirations, or the ~10s `GEX_DASHBOARD_LOAD_TIMEOUT_MS` is exceeded. Under the constrained ~200-line IBKR option-quote budget with scanner shedding, `batchOptionChains()` can return partial/empty → 503 → page blanks. This is the most likely cause if the user sees the *whole* page fail to hydrate intermittently.

### C. WORKING AS DESIGNED (not bugs — do not "fix")
- **Gamma Price Profile** "Provider IV unavailable" — intentional after the 2026-05-22 audit (no longer estimates missing IV).
- **Intraday ΔGEX** "Awaiting a second snapshot" — needs ≥2 same-session snapshots.
- **Signals** "No active signals" — honest empty when `computeSignals` returns `[]`.
- Spot card / metadata render `—` for missing fields rather than blanking.

### D. MINOR
- `source.status === "partial"` health is only lightly surfaced in the UI; a few unnamed controls / small touch targets (per APP_DEFICIENCY_REPORT) — cosmetic, out of scope here.

## Recommended Fix (Phase 1): wire `flowContext` from data GEX already has

Derive the squeeze flow context synchronously from the option chain GEX already loads — **no new upstream calls, no extra option-quote leases, no added latency** (keeps within the 10s timeout and the 200-line budget). The per-contract rows already carry what's needed: `GexOptionRow` has `gamma`, `delta`, `openInterest`, `volume` (`gex.ts:29-37`, populated at `gex.ts:376,383`), and `yearBarsPage.bars` (already fetched in the same `Promise.all`) gives a 30d underlying volume baseline.

Add a pure helper `deriveGexFlowContext(rows, spot, underlyingBars)` in `gex.ts`:
- `callVol = Σ volume(C)`, `putVol = Σ volume(P)`; `bullishShare = callVol / max(1, callVol+putVol)`.
- `netDelta = Σ delta*volume*sharesPerContract` (put deltas already negative); `refDelta = Σ |delta|*volume*sharesPerContract`.
- `todayVol = callVol + putVol`; `eventCount = rows.filter(volume>0).length`.
- `avg30dVol` = mean of last ~30 `underlyingBars.volume`; `volumeBaselineReady = barCount >= ~20`.

Integrate after `netGex` (`gex.ts:722-725`) and replace `gex.ts:774-775`:
- `flowContextStatus = "ok"` when `todayVol >= ~500` and `eventCount >= ~20`; otherwise keep `flowContext: null` + `"unavailable"` so the card **honestly** degrades for thin names / off-hours.
- Populate `source.flow*` (`gex.ts:786-791`) honestly for a proxy: `flowStatus = status`, `flowEventCount = classifiedFlowEventCount = eventCount`, `flowClassificationCoverage = rowsWithVolume/usable`, basis counts `{quoteMatch:0, tickTest:0, none:eventCount}`, confidence `{high:0, medium:0, low:eventCount, none:0}` (signals a low-confidence, tape-unclassified proxy).
- Keep the existing `"ok"|"unavailable"` unions (gex.ts:81,92) — do **not** add `"partial"` in Phase 1 (would force zod-schema + frontend-gate churn for no user benefit).

Reject the heavier sources for Phase 1: `getVolumeFootprints` (`volume-footprints.ts`) does live intraday quote-match scans inside the GEX timeout and can starve the scanner; `historical-flow-events.ts` / `options-flow-scanner.ts` are DB/live-universe heavy. The richer classified-flow integration (quoteMatch/tickTest + confidence from `providers/polygon/market-data.ts`) is a **Phase 2** follow-up once the honest proxy ships.

## Optional follow-ups (not in Phase 1)
- **Phase 2**: replace the proxy with classified flow events (real bullish/bearish premium share, tape-based confidence). Requires widening `flowContextStatus`/`source.flowStatus` to include `"partial"` + zod schema + `GexScreen.jsx:1271` gate.
- **Resilience (finding B)**: degrade the `dataReady` cascade so a missing spot/usable-rows error shows a targeted region error while still rendering ticker metadata/profile, instead of blanking regions 6–12. Separate change; flag if wanted.

## Priority files
- `artifacts/api-server/src/services/gex.ts` — add `deriveGexFlowContext`; replace the hardcoded `flowContext`/status (~774-775); populate `source.flow*` (~786-791).
- `artifacts/api-server/src/services/gex.validation.ts` — keep the zero-volume "unavailable" case (~304-306); add a with-volume case asserting `flowContextStatus==="ok"`, correct `bullishShare`, `netDelta` sign, and populated `source.flow*`.
- Consumer contract (no change in Phase 1, used to validate output): `artifacts/pyrus/src/features/gex/gexModel.js:575-631`, `gexModel.validation.js:164`, gate at `GexScreen.jsx:1270-1282`.

## Verification
- **Unit:** `pnpm --filter @workspace/api-server exec node JS validation runner src/services/gex.validation.ts` (zero-volume → unavailable; with-volume → ok with correct `bullishShare`/`netDelta` sign/`volumeBaselineReady`). Re-run `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/gex/gexModel.validation.js`. Then API + Pyrus typechecks.
- **In-browser (running app):** SPY during market hours → Squeeze card hydrates with a real score/verdict/factors; a thin symbol or off-hours → honestly shows "Flow context unavailable". Confirm GEX load latency is unchanged (no new awaits / option leases) and the rest of the page (metrics, charts, heatmap) is unaffected.
