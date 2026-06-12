# Live Session Handoff - Trade Option Chain UI Feed Check

- Session ID: pending
- Saved: 2026-06-11 13:35:21 MDT
- Repo root: `/home/runner/workspace`
- Workstream: Trade page option-chain UI feed and IBKR data-line realtime check
- Status: stopped at user request, read-only investigation only

## User Request

Verify that the Trade page option-chain UI is being fed properly through the IBKR data lines and updating in real time. Keep scope narrow. User then asked whether an IBKR data-line drop to 33/34 could mean old tests/assertions were surfacing, then asked to stop and write this markdown handoff.

## Actions Taken

- Opened the app in non-safe mode only after user approval, because `?pyrusQa=safe` disables the Trade live option quote subscriptions.
- Switched the mobile Trade screen to the Chain tab and observed the visible option-chain panel state.
- Sampled `/api/settings/ibkr-line-usage?detail=full`.
- Probed option expiration and option chain endpoints directly with and without Trade request-family headers.
- Searched relevant source for line-usage display/model paths and potential old caps/assertion wording.
- Navigated the browser back to `http://127.0.0.1:18747/?pyrusQa=safe` after stopping so the live Trade subscriptions are not left active.
- No code edits or fixes were made for this workstream.

## Observed Facts

- Source path:
  - `artifacts/pyrus/src/screens/TradeScreen.jsx` loads option expirations, then option-chain metadata, then publishes chain snapshots.
  - `TradeOptionQuoteRuntime` in the same file subscribes option quotes for execution and visible rows through `useIbkrOptionQuoteStream`.
  - Safe QA mode disables these live Trade streams, so non-safe mode was needed for a meaningful check.
  - `artifacts/pyrus/src/features/platform/live-streams.ts` uses a shared option-quote client by default, so backend owners may appear as `shared-option-quotes:*` instead of literal `trade-option-visible:*`.
- Route-admission source:
  - `artifacts/api-server/src/services/route-admission.ts` includes `trade-option-chain` and `trade-option-chain-batch` in the active request-family allowlist.
  - Built `artifacts/api-server/dist/index.mjs` also contains those families, so that specific allowlist fix was present in dist.
- Browser/runtime:
  - The Trade option-chain panel rendered but stayed in a loading state: `Loading option chain - waiting for expirations`.
  - Observed row count was 0.
  - Browser-side option quote cache size was 0 during the check.
  - Console errors were not observed.
- Endpoint probes:
  - Unheadered `/api/options/expirations?underlying=SPY` and `/api/options/chains?...` were shed under pressure as `deferred-analytics` with HTTP 429. That is expected for unclassified calls under pressure.
  - Headered Trade-family requests were admitted as active-screen, but expirations returned empty/degraded.
  - Repeated admitted expiration probes returned `reason: "options_backoff"` with empty expiration arrays.
  - Headered chain metadata returned status 200 but no contracts when no expiration was available.
- Latest line-usage sample before stop:
  - Option quote stream was active.
  - Active option quote consumers were 8 to 9.
  - Union provider contract count was 167 to 169.
  - Requested provider contract count was 212 to 214.
  - Desired provider contract IDs reported by the stream were 100.
  - Last quote event age was stale, roughly 344 to 349 seconds during the sample.
  - Option quote stream pressure reported `normal`.

## Inferred

- The Trade option-chain quote rows were not actually being fed in real time during this check because the chain never got past expiration metadata. With zero chain rows and an empty browser quote cache, the visible-row quote subscription has nothing useful to subscribe.
- The immediate blocker appears earlier than IBKR data-line allocation: admitted option expiration metadata is returning empty due `options_backoff`.
- The `33/34` UI line count may be a display/model issue, a different line-usage category, or an actual current budget state. I stopped before tracing that display all the way from backend snapshot to UI label.

## Unknowns

- Whether the user-observed `33/34` count is backed by a live backend snapshot, a stale frontend runtime-control model, or an old test/assertion fixture.
- Whether Trade metadata frontend calls are consistently sending the intended Trade request-family headers. Source inspection showed the backend supports those families, but the frontend client path still needs a focused trace.
- Why `options_backoff` is active for SPY expirations in the current runtime.
- Whether the live quote stream stale event age is caused by no fresh IBKR events, shared-client demand collapse, or another stream-level issue.

## Relevant Files To Inspect Next

- `artifacts/pyrus/src/screens/TradeScreen.jsx`
- `artifacts/pyrus/src/features/platform/live-streams.ts`
- `artifacts/pyrus/src/features/platform/runtimeControlModel.js`
- `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`
- `artifacts/pyrus/src/screens/SettingsScreen.jsx`
- `artifacts/api-server/src/services/route-admission.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/market-data-admission.ts`
- `artifacts/api-server/src/services/ibkr-line-usage.ts`
- `artifacts/api-server/src/routes/settings.ts`

## Next Step

If resumed, first trace the exact `33/34` display source from UI text to `runtimeControlModel` to backend `/api/settings/ibkr-line-usage` fields, then separately trace Trade expiration requests to confirm request-family headers and the source of `options_backoff`. Do not edit until those two facts are separated.
