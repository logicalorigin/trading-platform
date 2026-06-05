# DEBUG REPORT: PYRUS Runtime Pressure and Footer Readout

- Date: `2026-05-28`
- Status: `DONE_WITH_CONCERNS`

## Symptom

The app stayed under priority pressure while running. The user also reported that the lower-corner readout did not make the runtime problem visible. A 10-minute soak of the live pre-patch API showed app readiness blocked by a now-retired resource-pressure state, high endpoint latency/timeouts, and stale signal/bar data.

## Root Cause

The API was not primarily blocked by IBKR market-data line exhaustion. Runtime diagnostics showed the Massive stock universe stream was active for about 550 symbols, with one active quote consumer and roughly 967k quote events produced within minutes. That full-universe quote/aggregate stream saturated the Node API main thread and RSS, which then pushed app readiness to priority pressure.

The lower-corner footer readout used the client memory-pressure hook but did not propagate server dominant drivers such as `api-rss` into the footer pressure driver state. The compact API mini bar also preferred API heap metrics over API RSS, so the visible control could miss the actual backend pressure cause.

Follow-up correction after the user challenged the OOM assumption: the live container had materially more memory headroom than the API pressure model assumed. The cgroup limit was 16GB, `memory.current` was about 7.4GB, `memory.peak` was about 10.4GB, `memory.events` showed `oom 0` and `oom_kill 0`, and memory PSI was `0.00`. The remaining flow scanner degradation at about 2GB API RSS was therefore artificial: hardcoded RSS thresholds (`watch 900MB`, `high 1200MB`, `priority 1600MB`, hard block 3000MB) were forcing `scanner-throttled-high-pressure` even though the container was not close to OOM.

## Fix

API:

- `artifacts/api-server/src/services/platform.ts` now reads the API resource-pressure snapshot before refreshing Massive full-universe stock streams.
- Under `high` or `priority` pressure it closes/skips those full-universe streams with status `resource_pressure`.
- The Massive full-universe startup path no longer opens a raw Massive quote snapshot websocket subscription. It keeps only the lower-rate stock aggregate subscription.
- The Massive aggregate universe symbol cap remains configurable through `MASSIVE_STOCK_UNIVERSE_STREAM_SYMBOL_CAP`, but the default is now `1000` so the observed 550-symbol universe is not artificially constrained by default.
- `artifacts/api-server/src/services/bridge-streams.ts` now keeps foreground `/streams/quotes` on the IBKR bridge stream instead of switching visible SSE quote clients to the Massive quote websocket.
- `artifacts/api-server/src/services/resource-pressure.ts` now scales RSS pressure thresholds from the actual cgroup memory limit unless explicit env overrides are set. On the current 16GB container, RSS watch/high resolves to `4096/5734/8192 MB`, and hard block resolves to `11469 MB`.
- Heap pressure remains a separate strict driver; this correction only prevents container RSS from being treated as priority far below the actual memory limit.
- Runtime diagnostics now expose the current pressure level and whether the Massive universe stream is pressure-blocked.

Pyrus UI:

- `artifacts/pyrus/src/features/platform/useMemoryPressureSignal.js` now merges server dominant pressure drivers into the footer runtime state and carries `apiRssMb`/`apiP95LatencyMs`.
- `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx` now prefers `api-rss` over `api-heap` for the API mini bar and shows an `API RSS` label when RSS is the dominant driver.

## Evidence

Live soak on the pre-patch build:

- 40 samples from `2026-05-28T19:31:54Z` to `2026-05-28T19:41:40Z`.
- API CPU avg `95.57%`, max `97.6%`.
- API RSS avg `1822.5 MB`, max `1930 MB`.
- App readiness `not_ready` and readiness pressure `priority` in 37/40 samples.
- Scanner fill `pressure-throttled`; `scannerBlocked` stayed `null`.
- `flowScanner` line usage stayed `0`, which rules against IBKR line exhaustion as the active blocker.
- Signal latest-bar lag avg `11.19` minutes; latest-signal lag avg `26.19` minutes.

Focused diagnostics:

- `massiveStockUniverse.status`: `active`.
- `massiveStockUniverse.symbolCount`: `550`.
- `massiveStockQuotes.subscribedSymbolCount`: `550`.
- `massiveStockQuotes.eventCount`: about `967455`.
- `stockAggregates.unionSymbolCount`: `550`.

Post-restart soak after the first source fix:

- 18 samples from `2026-05-28T19:47:05Z` to `2026-05-28T19:52:10Z`.
- The pressure gate worked once pressure escalated: `massiveStockUniverse.status` was `resource_pressure`, `active: false`, and `symbolCount: 0` in 16/18 samples.
- The fix was incomplete: a smaller Massive quote stream stayed subscribed to 21 symbols and quote events climbed from `268945` to `497529` while API CPU remained near `90-95%` and RSS stayed near `1.6-1.7 GB`.
- One sample had all API probes time out at 6.5s, and the API process restarted under the Replit supervisor during the soak.
- After the supervisor restart, startup briefly returned to normal pressure and the stock universe reactivated before pressure had time to escalate. That confirmed startup must not open the raw Massive quote firehose at all.

Flow scanner degradation after the second source fix:

- The second fix was live: `massiveStockQuotes.subscribedSymbolCount: 0`, `activeConsumerCount: 0`, and `eventCount: 0`.
- Flow scanner still degraded because the remaining Massive aggregate universe stream expanded to `550` symbols on runtime resync while resource pressure was only `watch`.
- Within the 20-sample probe, API RSS rose from about `1427 MB` to `1995 MB`, API CPU averaged `86.72%`, readiness was `priority` in 15/20 samples, and one full probe sample timed out.
- Flow scanner was not IBKR-line exhausted: remaining lines stayed high, broker readiness stayed `ready`, and historical work continued. The scanner degraded because API pressure forced `scannerFillMode: pressure-throttled`, `topLimitingReason: scanner-throttled-high-pressure`, and effective concurrency `1`.
- `/api/flow/events?...blocking=false` returned empty rows with `ibkrReason: options_flow_scanner_queued`; aggregate flow returned `options_flow_scanner_no_cached_events`.
- Follow-up correction: this was not an OOM condition. The 16GB cgroup limit means the API should not mark 2GB RSS as high. The pressure model now scales RSS thresholds from container memory, and the aggregate universe default cap was raised to `1000` so the app is not artificially limited under normal headroom.

## Regression Tests

- `artifacts/api-server/src/services/platform-massive-stock-routing.validation.ts` checks that full-universe Massive refresh consults API pressure and closes the stream with `resource_pressure`.
- `artifacts/api-server/src/services/platform-massive-stock-routing.validation.ts` also checks that the full-universe refresh path no longer calls `subscribeMassiveStockQuoteSnapshots`.
- `artifacts/api-server/src/services/platform-massive-stock-routing.validation.ts` now checks that the Massive aggregate universe stream honors the configurable symbol cap before using the broad flow universe.
- `artifacts/api-server/src/services/resource-pressure.validation.ts` checks that RSS thresholds scale to `4096/5734/8192 MB` and hard block `11469 MB` on a 16GB container.
- `artifacts/api-server/src/services/options-flow-scanner.validation.ts` and `artifacts/api-server/src/services/ibkr-line-usage.validation.ts` now drive high RSS test cases from the resolved thresholds instead of stale 1.2GB/1.6GB assumptions.
- `artifacts/api-server/src/services/bridge-streams-source.validation.ts` checks that foreground equity quote SSE uses `subscribeBridgeQuoteSnapshots` and not the Massive quote stream.
- `artifacts/pyrus/src/features/platform/useMemoryPressureSignal.validation.js` checks that API RSS server drivers surface in footer state.
- `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.validation.js` checks that the compact footer API mini readout displays API RSS and uses its fill level.

## Validation

- Passed: `pnpm --filter @workspace/api-server exec node JS validation runner src/services/platform-massive-stock-routing.validation.ts src/services/bridge-streams-source.validation.ts`
- Passed: `pnpm --filter @workspace/api-server exec node JS validation runner src/services/massive-stock-quote-stream.validation.ts`
- Passed: `pnpm --filter @workspace/api-server exec node JS validation runner src/services/resource-pressure.validation.ts src/services/options-flow-scanner.validation.ts src/services/ibkr-line-usage.validation.ts src/services/platform-massive-stock-routing.validation.ts src/services/bridge-streams-source.validation.ts`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/useMemoryPressureSignal.validation.js src/features/platform/FooterMemoryPressureIndicator.validation.js`
- Passed: `pnpm --filter @workspace/api-server run typecheck`
- Passed: `pnpm --filter @workspace/pyrus run typecheck`
- Passed: `pnpm --filter @workspace/api-server run build`
- Passed: scoped `git diff --check`

## Remaining Verification

The live app still needs a normal Replit Run App restart/reload so the running API process uses the rebuilt pressure model. After restart, run a post-fix soak and verify API RSS around 2GB no longer maps to high pressure, `massiveStockQuotes.subscribedSymbolCount` stays `0` unless an intentional direct Massive quote consumer is added later, and flow scanner diagnostics no longer report `scanner-throttled-high-pressure` from false RSS pressure.
