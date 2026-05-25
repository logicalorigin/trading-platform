# Chart Indicator Pipeline

How the **Pyrus Signals (SMC Pro v3)** indicator — and any other Pine-style study — gets from a `.pine` source file onto a user's chart in the Pyrus app.

## TL;DR

We do **not** publish to TradingView and we do **not** evaluate Pine Script at runtime. The `.pine` file is a **specification artifact** (kept in sync with our marketing claim that "your TradingView indicators come with you"). The actual rendering is done by a **hand-written JS runtime adapter** that produces overlay specs for `lightweight-charts`.

Pipeline shape:

```
.pine file (spec)
    └─► bundled seed on disk
          └─► api-server persists to pine_scripts table (or JSON fallback)
                └─► GET /api/charting/pine-scripts
                      └─► useIndicatorLibrary() builds catalog
                            └─► JS runtime adapter (pyrusSignalsPineAdapter.ts)
                                  └─► compute() returns StudySpec[]
                                        └─► ResearchChartSurface paints onto lightweight-charts
```

## 1. The Pine source (specification only)

- `pyrus-signals-smc-pro-v3.pine` — canonical source at repo root.
- `artifacts/api-server/data/pine-seeds/pyrus-signals-smc-pro-v3.pine` — bundled seed shipped with the api-server.

The source describes inputs, groups, and plot intent. It is **not executed**. It exists so:
- We can show the source to users / paste into TradingView for parity checks.
- The same `scriptKey` (`pyrus-signals-smc-pro-v3`) ties together the seed file, the DB record, and the JS adapter.

## 2. Backend: serve scripts as data

**Schema** — `lib/db/src/schema/charting.ts`
- Table `pine_scripts` with `scriptKey` (unique), `name`, `sourceCode`, `status` (`draft` | `ready`), `defaultPaneType` (`price` | `lower`), `chartAccessEnabled`, `tags`, `metadata`.

**Service** — `artifacts/api-server/src/services/pine-scripts.ts`
- `PYRUS_SIGNALS_PINE_SCRIPT_KEY = "pyrus-signals-smc-pro-v3"` (line 52).
- `PYRUS_SIGNALS_PINE_SOURCE_PATH` (lines 70-74) points at the bundled seed.
- `loadBundledPineSeeds()` reads the seed from disk and assembles a `CreatePineScriptInput` (status `ready`, `chartAccessEnabled: true`).
- `ensureBundledPineScriptsStored()` writes the seed to Postgres on boot; on transient Postgres failure it falls back to `data/pine-scripts.json`. Backoff is controlled by `pineScriptsDbBackoff`.

**Route** — `artifacts/api-server/src/routes/charting.ts`
- `GET /charting/pine-scripts` → list (used by the client).
- `POST /charting/pine-scripts`, `PATCH /charting/pine-scripts/:scriptId` → admin/editor flows.

The response includes the full record (source code, status, paneType, chartAccessEnabled, metadata).

## 3. Frontend: assemble the indicator library

**`artifacts/pyrus/src/features/charting/pineScripts.ts`**

Three responsibilities:

1. **Adapter registry** (lines 24-26): a `scriptKey → factory` map. Pyrus Signals is the only entry today:
   ```ts
   const pineRuntimeAdapterRegistry = {
     [PYRUS_SIGNALS_PINE_SCRIPT_KEY]: createPyrusSignalsPineRuntimeAdapter,
   };
   ```

2. **Chart-readiness gate** — `resolvePineScriptChartState()` (lines 39-75). A script can only land on the chart when **all three** are true:
   - `status === "ready"`
   - `chartAccessEnabled === true`
   - A runtime adapter is registered for its `scriptKey`.

3. **Library assembly** — `buildIndicatorLibrary()` (lines 95-141):
   - Fetches Pine records, ensures a Pyrus Signals fallback record exists even if the API list is empty.
   - Filters down to chart-ready scripts.
   - Maps each to an `IndicatorCatalogEntry` (used by the picker UI).
   - Merges with `defaultIndicatorRegistry` (EMA, SMA, BB, RSI, ATR, MACD, VWAP — see `indicators.ts`).
   - For each chart-ready Pine script, calls its factory to produce an `IndicatorPlugin` and inserts it into the registry under `scriptKey`.

`useIndicatorLibrary()` (lines 143-164) is the React hook the chart surface consumes. It uses `useListPineScripts()` with a 5-minute `staleTime`, so the catalog is effectively cached per session.

## 4. The runtime adapter (where Pine becomes JS)

**`artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts`**

- Exports `PYRUS_SIGNALS_PINE_SCRIPT_KEY` and `createPyrusSignalsPineRuntimeAdapter(script): IndicatorPlugin`.
- Pulls SMC primitives from the shared core package `@workspace/pyrus-signals-core` (`lib/pyrus-signals-core/src/index.ts`):
  - `aggregatePyrus SignalsBarsForTimeframe` — MTF aggregation.
  - `computePyrus SignalsVolatilityScore`, `computePyrus SignalsWma`.
  - `evaluatePyrus SignalsSignals` — BOS / CHOCH / order-block detection.
  - `resolvePyrus SignalsTrendDirection`, `resolvePyrus SignalsSessionKey`.
- Declares the full settings surface (`PyrusSignalsRuntimeSettings`, lines 71+): structure timeframe, BOS confirmation mode, ATR buffers, basis/ATR lengths, MTF, session filters, plot overrides, dashboard placement.
- The returned `IndicatorPlugin` exposes a `compute()` method. Given the current bar window, it produces `StudySpec[]` (lines, zones, markers) plus optional `IndicatorWindow`/`IndicatorZone`/`IndicatorEvent` records.

Built-in studies follow the same plugin shape — see `artifacts/pyrus/src/features/charting/indicators.ts` (compute functions lines 88-254; default registry lines 486-563). Pyrus Signals is just a "fancier" plugin in the same registry.

## 5. Rendering

**`artifacts/pyrus/src/features/charting/ResearchChartFrame.tsx`** — the chart shell. Owns:
- `selectedStudies`, `studySpecs`, `onToggleStudy` props.
- The indicator picker sheet (mobile + desktop) at lines 1604-1670 — drives selection.
- Legend rendering for active studies (lines 1153-1288).

**`artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx`** — the actual canvas:
- Constructs the chart via `createChart()` from `lightweight-charts` (lines 233-250).
- Renders indicator windows/zones from the `ChartModel` (lines 3560-3670) by translating `StudySpec` (lines, areas, histograms, boxes, markers) into native lightweight-charts series.

**`artifacts/pyrus/src/features/charting/chartHydrationRuntime.js`** — incremental bar pipeline. As bars stream in, it invokes each active plugin's `compute()` and merges the results into the chart model that the surface paints.

**`artifacts/pyrus/src/features/charting/PyrusSignalsSettingsMenu.tsx`** — TradingView-style per-indicator settings dialog with `inputs` / `style` / `visibility` tabs. Edits flow back into the adapter settings and re-trigger `compute()`.

## 6. End-to-end: user clicks "Indicators" on a chart

1. Chart frame mounts → `useIndicatorLibrary()` runs.
2. React-Query calls `GET /api/charting/pine-scripts`.
3. API loads bundled seed via `ensureBundledPineScriptsStored()` (Postgres or JSON fallback) and returns the list.
4. `buildIndicatorLibrary()` runs `resolvePineScriptChartState()` on each record. Pyrus Signals passes (status `ready`, `chartAccessEnabled`, adapter present).
5. `createPyrusSignalsPineRuntimeAdapter(script)` returns an `IndicatorPlugin`; it lands in `indicatorRegistry["pyrus-signals-smc-pro-v3"]`.
6. The catalog entry shows up in the indicator picker sheet.
7. User toggles "Pyrus Signals" → `onToggleStudy(scriptKey)` adds it to `selectedStudies`.
8. On every new bar, `chartHydrationRuntime` calls the plugin's `compute()`; results flow into `studySpecs`.
9. `ResearchChartSurface` paints lines, boxes, and markers onto the lightweight-charts instance.
10. Opening `PyrusSignalsSettingsMenu` mutates `PyrusSignalsRuntimeSettings`; the next `compute()` reflects the change.

## 7. What this means for adding a new indicator

To add a second Pine-style study:

1. Drop a `.pine` source into `artifacts/api-server/data/pine-seeds/<key>.pine`.
2. Register a seed in `pine-scripts.ts` (`loadBundledPineSeeds()` / `ensureBundledPineScriptsStored()`) with a unique `scriptKey`, `status: "ready"`, `chartAccessEnabled: true`.
3. Write a `create<Name>PineRuntimeAdapter(script): IndicatorPlugin` in `artifacts/pyrus/src/features/charting/` that returns a plugin with a `compute()` method producing `StudySpec[]`.
4. Register the factory in `pineRuntimeAdapterRegistry` (`pineScripts.ts` line 24).
5. (Optional) Build a settings menu mirroring `PyrusSignalsSettingsMenu.tsx`.

No frontend deploy of Pine source is required; the catalog is data-driven, but the runtime is code-driven. Until step 4 lands, the script will appear with `chartReady: false` and the reason "No JS runtime adapter is registered for this Pine script yet."

## 8. Key files (quick index)

| Path | Role |
|------|------|
| `pyrus-signals-smc-pro-v3.pine` | Pine spec (root) |
| `artifacts/api-server/data/pine-seeds/pyrus-signals-smc-pro-v3.pine` | Bundled seed |
| `lib/db/src/schema/charting.ts` | `pine_scripts` table |
| `artifacts/api-server/src/services/pine-scripts.ts` | Seed + storage + backoff |
| `artifacts/api-server/src/routes/charting.ts` | REST endpoints |
| `artifacts/pyrus/src/features/charting/pineScripts.ts` | Catalog assembly + adapter registry |
| `artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts` | JS runtime for Pyrus Signals |
| `lib/pyrus-signals-core/src/index.ts` | SMC primitives (BOS/CHOCH/OB) |
| `artifacts/pyrus/src/features/charting/indicators.ts` | Built-in studies + plugin shape |
| `artifacts/pyrus/src/features/charting/ResearchChartFrame.tsx` | Picker + legend |
| `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx` | `lightweight-charts` rendering |
| `artifacts/pyrus/src/features/charting/chartHydrationRuntime.js` | Incremental compute loop |
| `artifacts/pyrus/src/features/charting/PyrusSignalsSettingsMenu.tsx` | Per-indicator settings UI |
