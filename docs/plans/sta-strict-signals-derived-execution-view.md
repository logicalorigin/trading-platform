# STA Strict Signals-Derived Execution View

## Problem

The STA table and algo monitor can currently show execution rows before the corresponding Signals matrix bubbles are hydrated, and some rows can be sourced from Signal Options candidate state instead of the Signals table/matrix route. That creates UI fever symptoms:

- STA rows with no hydrated bubbles.
- Rows appearing briefly at startup from broad or stale signal state before narrowing to the active execution timeframe.
- Bubble hydration mismatches between STA, algo monitor, watchlist, and the Signals table.
- Rows whose selected timeframe bubbles do not match the algo execution controls.
- Misleading alignment status, stale metadata age, empty signal cells, and other surface symptoms of deeper data routing drift.

The intended model is stricter:

- Signal Options does not create display candidates.
- Signal Options receives candidates from the Signals matrix/table/page, based on the signal fired and the algo execution timeframe selection.
- The STA table and algo monitor are execution views of those canonical Signals-derived candidates.
- If the algo execution control is looking at `5m`, STA should only receive `5m` Signals-derived candidates.
- If the algo execution control is looking at `1m`, `2m`, and `5m`, STA and the algo monitor should only display those bubbles.
- A normal STA row must at minimum have hydrated bubbles for every algo-selected timeframe being considered for trading.
- Any empty selected-timeframe bubble in STA/algo monitor is a diagnostic symptom, not a cosmetic loading state to handwave.

## Goal

Make the STA table and algo monitor a strict execution view derived from the Signals matrix route, while quarantining and surfacing any invalid rows that arrive from stale, partial, or incorrect routes.

## Non-Goals

- Do not change watchlist behavior; it can continue showing all six timeframes.
- Do not make Signal Options a row creator.
- Do not mask missing hydration with placeholder bubbles.
- Do not add a second fever panel; upgrade the existing top-of-algo diagnostic area.
- Do not add cheap UI filters that hide symptoms without fixing or diagnosing the routing source.

## Core Invariants

1. There is one normal route into the STA table: Signals matrix/table/page derived candidates.
2. Signal Options only consumes canonical candidates and may attach execution/action metadata to them.
3. STA and algo monitor rows only display the timeframes selected in algo execution controls.
4. A row cannot enter the normal STA display unless all selected execution timeframe bubbles are hydrated.
5. Rows that violate invariant 4 go to diagnostic quarantine, not normal display.
6. The execution timeframe selected for trading is prioritized by signal workers before non-execution timeframes.
7. Empty selected-timeframe bubbles are fever symptoms and must be visible in diagnostics.

## Implementation Plan

### 1. Define the canonical execution candidate shape

Create one shared row/candidate contract for STA and algo monitor.

The shape should include:

- `symbol`
- `primaryTimeframe`
- `selectedTimeframes`
- `matrixCellsByTimeframe`
- `sourceSignalId` or equivalent event identity
- `signalTimestamp`
- `direction`
- `alignmentState`
- `metadataAge`
- `sourceRoute: "signals-matrix"`
- optional `signalOptions` execution/action metadata
- optional `quarantineReason`

Acceptance criteria:

- The contract can represent every normal STA row without falling back to Signal Options candidate shape.
- Selected timeframe hydration can be validated from this shape alone.
- The same shape can feed the STA table and algo monitor sidebar.

### 2. Build canonical candidates from Signals matrix data

Move row creation to the Signals-derived path.

For each candidate:

- Start from the Signals matrix/table/page source.
- Filter by the algo execution control timeframe selection.
- Require the primary execution timeframe to be present and hydrated.
- Require every selected display/execution timeframe bubble to be hydrated before normal display.
- Preserve all metadata needed for action evaluation and diagnostics.

Acceptance criteria:

- New STA rows cannot be born from Signal Options-only candidate state.
- A `5m` execution setting yields only `5m` Signals-derived rows.
- A `1m/2m/5m` setting yields rows with hydrated `1m`, `2m`, and `5m` cells.

### 3. Remove Signal Options as a normal STA row source

Refactor the current visible row builder so it no longer treats Signal Options signals or candidates as normal display row creators.

Signal Options data can still:

- Attach action state to an existing canonical Signals-derived row.
- Add execution diagnostics to an existing row.
- Produce quarantine diagnostics if it references a row that is absent from the canonical Signals source.

Acceptance criteria:

- No normal STA row can be created solely from `signalOptionsCandidates`.
- No normal STA row can be created solely from Signal Options state snapshots.
- Startup cannot briefly show all Signal Options rows before the execution timeframe filter applies.

### 4. Wire AlgoScreen and AlgoLivePage to the canonical source

Update the page-level data flow so STA table and algo monitor both consume the canonical execution candidates.

Work items:

- Identify the current `visibleSignalRows` creation path.
- Replace it with the canonical Signals-derived candidate path.
- Pass the selected algo execution timeframes into the builder.
- Attach Signal Options metadata by symbol/timeframe/event identity after canonical row creation.
- Keep strict matrix fallback behavior for bubbles.

Acceptance criteria:

- STA table and algo monitor show the same symbols and selected timeframe bubbles.
- Matrix table columns respect algo control changes wherever the STA execution view depends on them.
- Other areas that are not execution views still show their full timeframe set.

### 5. Add backend quarantine for invalid Signal Options consumption

Signal Options should reject or quarantine any candidate/action record that does not match a canonical Signals-derived candidate.

Quarantine examples:

- Signal Options references a symbol/timeframe that is not in the current canonical Signals candidate set.
- Required selected timeframe matrix cells are missing.
- Primary execution timeframe is missing.
- Signal timestamp is stale beyond the accepted candidate window.
- Filter/action metadata is missing for a candidate that is being considered for execution.

Acceptance criteria:

- Invalid candidates do not enter normal STA state.
- Quarantine records include enough evidence to debug the source route.
- Quarantine records identify creator path, reader path, symbol, timeframe, missing cells, timestamps, and reason.

### 6. Expose quarantine diagnostics to frontend state

Add a frontend-consumable diagnostic feed for quarantined or invalid execution candidates.

Each diagnostic should include:

- `symbol`
- `timeframe`
- `selectedTimeframes`
- missing hydrated cells
- source route
- reason code
- latest known signal timestamp
- latest matrix timestamp
- Signal Options candidate timestamp, when present
- worker or route identity, when available

Acceptance criteria:

- The top-of-algo diagnostic area can show why a row was withheld.
- Empty selected-timeframe bubbles become explicit fever diagnostics.
- Diagnostic records distinguish loading delay from route violation when possible.

### 7. Upgrade the existing top-of-algo fever area

Use the existing fever/diagnostics area at the top of the algo page and make it operationally useful.

Show concise diagnostics such as:

- `Withheld: AB 5m missing 2m/15m matrix cells`
- `Quarantined: Signal Options referenced MU 5m without canonical Signals row`
- `Delayed: VST selected 2m bubble pending worker hydration`
- `Stale: USO metadata age exceeds candidate window`

Acceptance criteria:

- The area explains why rows or bubbles are missing.
- It does not become a noisy second table.
- It links symptoms back to source route or worker responsibility where possible.

### 8. Prioritize execution timeframe hydration in signal workers

Adjust worker scheduling so the active execution timeframe is hydrated first, followed by the other selected algo-control timeframes, then non-execution timeframes.

Priority order:

1. Primary execution timeframe.
2. Other selected algo-control timeframes.
3. Remaining non-execution timeframes used elsewhere.

Acceptance criteria:

- A row entering STA should already have its selected execution bubbles hydrated.
- If hydration is delayed, diagnostics clearly show worker delay rather than allowing an empty normal row.
- Watchlist and other full-timeframe surfaces continue hydrating all timeframes.

### 9. Verify every STA cell against the canonical model

Audit all STA table cells for stale assumptions and backend contract drift.

Cells to verify:

- Symbol
- Direction/action
- Bid/ask
- Move
- Sparkline
- Signal bubbles
- Alignment label
- Metadata age
- Position/action status
- Reason/filter/status text
- Any empty placeholder cell

Acceptance criteria:

- No empty cells unless empty is the correct semantic value.
- Bid/ask fields hydrate from the same current source used by the row.
- Move and sparkline data are present or diagnostically explained.
- Metadata age uses the correct signal timestamp, not stale cached or mismatched event time.
- Alignment state is computed from the selected execution timeframes, not hidden full-timeframe state.

## Verification Plan

### Source-level checks

- Trace every normal row creation path into STA.
- Trace every normal row creation path into algo monitor.
- Confirm Signal Options cannot create normal display rows.
- Confirm selected timeframes flow from algo controls into candidate creation, row display, and alignment calculation.
- Confirm quarantine is the only path for malformed or partial candidates.

### Automated checks

Add or update tests covering:

- `5m` execution control only displays `5m` Signals-derived rows.
- Multi-timeframe execution control only displays selected bubbles.
- Missing selected bubble prevents normal display and creates diagnostic quarantine.
- Signal Options-only candidate does not create STA row.
- Algo monitor and STA table consume the same canonical source.
- Alignment is computed only from selected execution timeframes.
- Startup state does not briefly display unfiltered all-timeframe rows.

### Runtime QA

With the app running in safe QA mode:

- Load the algo page.
- Confirm STA starts empty or with valid canonical rows only.
- Confirm no row appears without selected-timeframe bubble hydration.
- Change algo execution timeframe controls and confirm STA/algo monitor update immediately and consistently.
- Check known symbols such as AB, BLDR, MU, MRVL, VST, USO/UWO when available in live state.
- Confirm diagnostics explain withheld or quarantined candidates.

## Files Likely Touched

Likely frontend files:

- `artifacts/pyrus/src/screens/algo/AlgoScreen.jsx`
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`
- `artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx`
- `artifacts/pyrus/src/features/signals/signalsRowModel.js`
- Related tests near those modules

Likely backend/data files:

- Signal Options state/candidate builders
- Signal monitor matrix route/client
- Signal worker scheduling or hydration queue code
- Diagnostics or cockpit state serializers

Exact files should be confirmed by `rg` before editing.

## Risks

- There may be multiple persisted caches that can reintroduce stale Signal Options rows after the UI is fixed.
- Worker scheduling changes could affect watchlist hydration if priority is implemented too globally.
- Alignment and display logic may currently depend on hidden full-timeframe data; switching to selected timeframe semantics may expose contract gaps.
- Existing tests may assert the old fallback behavior and need updating to match the stricter invariant.

## Open Questions

- What exact timestamp should define metadata age in STA: fired signal time, matrix cell time, or action evaluation time?
- Should quarantined candidates expire on the same window as normal candidates, or remain visible longer for debugging?
- Should diagnostics include worker queue depth or only route/candidate evidence available today?

## Definition of Done

- STA table normal rows are created only from Signals-derived canonical candidates.
- Algo monitor sidebar uses the same canonical source.
- Signal Options never creates normal STA rows.
- Selected algo execution timeframes control row eligibility, visible bubbles, and alignment semantics.
- Missing selected-timeframe bubble hydration prevents normal display and creates a diagnostic symptom.
- Startup does not briefly show broad unfiltered rows.
- Existing top-of-algo fever area shows actionable withheld/quarantine diagnostics.
- Targeted tests pass.
