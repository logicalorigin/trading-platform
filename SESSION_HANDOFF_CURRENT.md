# Current Session Handoff

This is a pointer to the active durable handoff. Do not use this file as the full session narrative.

- Last Updated (MT): `2026-06-03 09:21:24 MDT`
- Last Updated (UTC): `2026-06-03T15:21:24Z`
- Native Codex Session ID: `live-signals-table-matrix-audit`
- Summary: Signals matrix/API line audit, footer API-source pressure bars, Algo & Execution scan-overlap gating, STA timeout/pressure repair, shadow positions stale-cache repair, and account P&L/source-lineage repair.
- Handoff: `SESSION_HANDOFF_LIVE_2026-06-03_signals-table-matrix-audit.md`
- Master Index: `SESSION_HANDOFF_MASTER.md`

## Current Status

- Signals matrix wiring and Signal Options freshness repairs remain source/test complete.
- Full API-line audit found provider capacity was not saturated: IBKR lines were low, Massive aggregate WebSocket was connected, but route/payload pressure was high.
- New repairs are implemented for compact line-usage polling, raised RSS pressure thresholds, decorative-route pressure exclusion, and Massive-first watchlist quote streaming.
- Watchlist price root cause found: normal foreground quote SSE still used IBKR bridge while only position quote SSE used Massive; `/quotes/snapshot` also swallowed Massive REST empty/failure into empty quotes.
- Footer API-source pressure bars are implemented with separate `IBKR` utilization and `Massive` provider health/activity bars; the old compact Memory/API process bar is hidden from the footer so the visible API surface is source-only.
- Algo auto-initial scans now wait when the cockpit `scan_universe` stage reports the Algo & Execution worker already running; manual scan collisions use parent/child nomenclature and auto-scan collisions are quiet.
- New repair: summary Signal Options state now bypasses dashboard build and serves a cold shell plus stored signal-monitor rows; direct service validation returned 9 STA rows in 86 ms with latest bars at `2026-06-03T15:15:00.000Z`.
- New repair: Signal Options action work no longer defers on `high` pressure when caps allow action scans/position marks; only hard/cap-blocking pressure queues it.
- New repair: cockpit/table pressure display no longer treats stale prior `lastResourcePressureLevel: "high"` as current pressure; footer normal vs row high mismatch was caused by separate pressure sources plus stale worker summary pressure.
- New repair: shadow positions read cache now preserves non-empty positions when a refresh times out or returns an empty degraded payload, preventing 22 -> 0 -> 22 table flicker.
- New repair: account summary/calendar today P&L now derives from local ledger/equity-history market-day NAV movement, not position quote-change totals; suspicious `IBKR_POSITIONS` daily overrides are rejected by the calendar.
- New repair: account equity/spot position quotes use Massive fallback/detail context, options remain on the IBKR option-quote path, and missing previous-close/change context no longer produces false flat `0` day P&L.
- Validation passed: 102 targeted backend tests, 119 targeted PYRUS tests, API typecheck, PYRUS typecheck, API build, plus footer tests 8/8, runtime-control tests 42/42, and platform root source tests 64/64.
- Additional overlap validation passed: Algo focused tests 38/38 and PYRUS typecheck.
- Additional account validation passed: account positions tests 22/22, platform quote snapshot tests 7/7, shadow-account tests 113/113, account calendar tests 27/27, intraday P&L tests 4/4, position display tests 9/9, returns panel tests 9/9, account calendar data tests 11/11, AccountHeroBlock tests 6/6, API typecheck, and PYRUS typecheck.
- Full PYRUS unit suite is blocked by an unrelated `TradeScreen.search-handlers.test.mjs` source-regex assertion for `listFlowEventsRequest(...)`.
- Live runtime recheck shows the running API process still needs a default Run Replit App restart before the quote-stream repair is active.
- Live runtime recheck after the latest build: Replit-owned API PID `63153` is still the pre-fix hot child at about 90% CPU and 1.7-1.9 GB RSS; `/api/healthz` is fast, but the live `/signal-options/state?view=summary` route still 504s until the Replit runner recycles the rebuilt `dist/index.mjs`.
- Live account recheck after restart/hot reload: `/api/accounts/combined/summary?mode=live&source=account-page` returns `dayPnl.source: "LOCAL_LEDGER"` and field `EquityHistoryMarketDayPnl:2026-06-03`; `/api/accounts/combined/positions?mode=live&source=account-page` returns equity quote source `massive` with populated Massive-backed day-change values where previous-close context exists.

## Next Recommended Steps

1. Restart via the default Run Replit App entry so `artifacts/api-server/dist/index.mjs` reloads the rebuilt bundle.
2. Recheck `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary`; expected sub-second response with signal rows, not a 504.
3. Recheck Algo STA table: freshness should use seconds-level row timestamps and should not show `Pressure High` while diagnostics/footer pressure are normal.
4. Recheck account and shadow positions streams for no empty row collapse during transient reads.
5. Recheck watchlist prices with Massive streaming active; normal quote SSE should use Massive Q/T and snapshot fallback should preserve socket-backed prices.
6. Recheck Signal Options cockpit `scan_universe`: `lastBatchSize` should become bounded/non-zero when stored coverage is stale, and `latestSignalBarAt` should advance.
7. Recheck the Algo header: when the worker scan is active, the Scan control should show scanning/disabled instead of firing a duplicate POST and toast.
8. Re-run safe Signals browser QA with `?pyrusQa=safe` and confirm visible rows converge to full matrix hydration.
9. Triage the unrelated `TradeScreen.search-handlers.test.mjs` unit assertion before relying on a full `test:unit` pass.
10. Recheck Account P&L Calendar and positions in the UI after the next app reload: today should follow ledger/equity-history NAV P&L, equities/spot should be Massive-backed, and options should remain IBKR-backed.
