# Broker-Connection UI Audit — Header chip / popover "lines not used properly"

**Date:** 2026-06-16
**Scope:** `artifacts/pyrus` IBKR broker-connection indicator (header chip + popover/panel)
**Status:** Investigation only — no code changed.
**Trigger:** "broker connection ui/header/popover … looks like we're not using all of the lines properly."

---

## Summary

The clearest matches for "not using all the lines properly" are **Finding 1** — a whole designed second line of the header chip (status word + Data/Stream/Lines tiles) is unreachable because the header always renders in `compressed` mode — and **Finding 2** — the chip always renders a "Lines" slot that degrades to a bare `L —` when line-usage is unavailable. Backing those up, the popover computes several data structures it never displays (badges, an IBKR provider row), repeats the same latency/freshness across multiple lines, can show an inconsistent status word in the title vs. the chip, and truncates detail rows that had room to wrap.

---

## Component map

| Role | File | Key lines |
|---|---|---|
| Header indicator (chip / trigger button) | `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx` | trigger button `4662–4705`; summary `HeaderIbkrTriggerSummary` `688–902` |
| Popover / panel (the dropdown) | `HeaderStatusCluster.jsx` | portal + dialog `4707–4938`; header row `4764–4842`; body `4844–4935` |
| Popover data model | `artifacts/pyrus/src/features/platform/ibkrPopoverModel.js` | `buildHeaderIbkrTriggerModel` `629–683`; `buildHeaderIbkrPopoverModel` `685–1304` |
| Connection tone / health resolver | `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx` | `getIbkrConnectionTone` `563–753`; `resolveIbkrGatewayHealth` `777–975`; `getIbkrGatewayBadges` `1118–1182` |
| Detail-row primitive | `HeaderStatusCluster.jsx` | `HeaderIbkrDetailRow` `499–549` |
| Popover sub-sections | `HeaderStatusCluster.jsx` | `HeaderIbkrMetricRail` (tiles) `562–639`; `HeaderMarketDataLineUsage` `980–1318`; `HeaderIbkrConnectionSummary` `1320–1365`; `HeaderIbkrProviderRows` `1778–1807`; `HeaderIbkrAdvancedDetails` `1809–1989` |
| Line-usage hook / policy | `artifacts/pyrus/src/features/platform/useIbkrLineUsageSnapshot.js`; `headerIbkrLineUsagePolicy.js` | — |
| Mount points | `artifacts/pyrus/src/features/platform/AppHeader.jsx` | desktop `685–696`, mobile `392–402` |
| Breakpoint flags | `artifacts/pyrus/src/features/platform/PlatformShell.jsx` | `763–775` |

A separate "lane" presentation (`IbkrConnectionLane` / `IbkrConnectionStatusPair`, `IbkrConnectionStatus.jsx:1439–1587`) exists but is **not** what the header renders.

---

## Line / row inventory

**Header trigger chip** (always `compressed === true` in production — see Finding 1): a single inline grid row (`762–880`) of status icon, "IBKR", ping-wave, inline line-usage (`L <used/cap>`), ping value. The designed *second* row of metric tiles (Data/Stream/Lines, `881–899`) and the inline status label (`800–813`) live behind `compressed === false` and never render.

**Popover panel, top to bottom:**
- Header row (`4764–4842`): "IB Gateway · `<status>`" + latency + close button.
- Deactivate/Detach button (`4844–4879`, conditional).
- Credential form (`4881–4896`, conditional).
- Launcher message (`4898–4919`, conditional).
- Operation stepper (`4921–4924`, conditional).
- Connection summary (`4926`): issue banner (if unhealthy) + 4-tile rail `Gateway / Auth / Data / Stream` (`ibkrPopoverModel.js:894–988`) + provider rows.
- Market-data line-usage bar + `Lane/Active/Usable/Headroom` table (`4927–4930`).
- Advanced "Details" disclosure (`4932–4935`): `Connection` (~22 rows, `ibkrPopoverModel.js:1001–1150`), optional `Massive`, `Stream` (~14 rows, `1151–1227`), optional `Launch`.

---

## Findings

### 1. The chip's entire second line + inline status label are dead in the shipped header *(observed)* — strongest match
`HeaderIbkrTriggerSummary` builds a second metrics row (`HeaderStatusCluster.jsx:736–748`, rendered `881–899`) and an inline status label (`800–813`), both gated on `!compressed`. `compressed = compact || dense || minimal` (`697`). The header mounts only twice — desktop always passes `dense` (`AppHeader.jsx:695`), mobile passes `compact` (`:399`) — so `compressed` is **always true** (`isDense = dense && !compact`, `3822–3823`). Result: the status word ("Ready"/"Offline"…) and the Data/Stream/Lines tiles never appear; the chip only ever shows icon + "IBKR" + wave + `L …` + ping.
**Fix:** either render a status label/tiles in the compressed layout, or delete the unreachable `!compressed` branches (`736–748`, `800–813`, `881–899`) and their now-dead helpers (`dataTile`, `streamTile`, `statusLabel`, `metrics`).

### 2. The chip always renders an inline "Lines" slot that collapses to a bare dash *(observed)*
`showInlineLineUsage = compressed` (`726`) — gated on layout only, not on data. When line usage is off/unloaded, `compactLineUsage` is null and `lineUsage.available` is false, so `lineValue = MISSING_VALUE` and the chip shows `L —` (`815–845`, value `716–721`). Line usage is frequently inactive: it only activates via `shouldActivateHeaderIbkrLineUsage` when `lineUsageAvailable` is true (`headerIbkrLineUsagePolicy.js:1–5`; gated by `gatewayBrokerSnapshot.lineUsageEnabled`, `HeaderStatusCluster.jsx:2977–2984`).
**Fix:** gate `showInlineLineUsage` on `lineUsage?.available` (or a finite value) so the slot is omitted rather than showing `L —`.

### 3. `model.badges` is computed but never rendered *(observed)*
`getIbkrGatewayBadges` runs and the popover model carries `badges` (`ibkrPopoverModel.js:844–849`, `1293`), but no component reads `model.badges`. Stream-state / "GAPS n" badges are computed each open and dropped.
**Fix:** render `badges` near the popover header/tiles, or stop computing them.

### 4. The "IBKR" provider row is built but filtered out of every render path *(observed)*
`buildProviderRows` always pushes an `IBKR` row first (`ibkrPopoverModel.js:417–424`), but both consumers strip it: `HeaderIbkrProviderRows` filters `row.label !== "IBKR"` (`HeaderStatusCluster.jsx:1780`) and the Connection detail group filters `row.label !== "IBKR"` (`ibkrPopoverModel.js:1098`). IBKR health/label is already shown via the tiles, so the row is dead weight (and `HeaderIbkrProviderRows` renders nothing at all when Massive is absent — `1782–1784`).
**Fix:** don't build the IBKR providerRow, or render it.

### 5. Popover header status uses a different tone source than the chip and tiles *(inferred)*
The popover title uses `displayedBridgeTone = bridgeRuntimeTone(session)` (`HeaderStatusCluster.jsx:4796–4808`, `3164`; origin `PlatformApp.jsx:2228`). The trigger uses `displayedGatewayTone = getIbkrConnectionTone(gatewayConnection)` (`2896–2899`, `3165`) and the tiles use `resolveIbkrGatewayHealth` (`ibkrPopoverModel.js:698`). Three resolvers for one connection → the chip can read "online" while the popover title reads something else.
**Fix:** drive the popover title from the same `gatewayPopoverModel.health` / `gatewayTone` used elsewhere.

### 6. Latency/ping is shown in three places at once *(observed)*
Ping renders in the trigger (`846–879`), again as "latency" in the popover header (`4810–4821`, value `popoverLatencyMs` `3195–3198`), and again as a "Ping" row in the Stream detail group (`ibkrPopoverModel.js:1154`). Header latency and trigger ping draw from the same `resolveHeaderIbkrPingMs` chain — the same number repeated.
**Fix:** drop "Ping" from the Stream group, or differentiate (e.g., header = live ping, group = p95).

### 7. Stream group shows two near-duplicate "last event age" rows *(inferred)*
`Strict age` (`runtime.lastStreamEventAgeMs`, `ibkrPopoverModel.js:1183–1193`) and `Last quote event` (`stream.lastEventAgeMs`, `1194–1199`) are both "…ago" freshness rows; with `Current` (`streamFresh`, `1178–1182`) that's three overlapping freshness lines that read as redundant when the sources agree.
**Fix:** collapse to one freshness row; show the second only when the two sources diverge.

### 8. Detail rows truncate long values to one ellipsized line unless `wrap` is set *(observed)*
`HeaderIbkrDetailRow` is a fixed 2-col grid (`0.74fr / 1.26fr`) with `whiteSpace: nowrap` + ellipsis by default (`499–548`). Rows like `Target`, `Mode`, `Account`, `Ready reason`, `State reason` pass no `wrap` (`ibkrPopoverModel.js:1092–1096`, `1054–1062`, `1169–1177`), so a long target/host/reason is silently clipped even though vertical space is available. Only `Last error` / `Health status` opt into `wrap`.
**Fix:** allow wrapping (or a title tooltip) for the free-text value rows so detail isn't lost.

### 9. Dead `popoverOpen` parameters in the line-usage policy *(observed, minor)*
`shouldActivateHeaderIbkrLineUsage` and `selectHeaderIbkrLineUsageSnapshot` both accept `popoverOpen` but ignore it (`headerIbkrLineUsagePolicy.js:1–10`) — line usage runs whenever available regardless of popover state. This is why the chip's `L …` line is populated/empty independent of the popover.
**Fix:** drop the unused params, or use them to gate fetching.

---

## Recommended sequencing

1. **Findings 1 + 2** — the actual "lines not used properly" in the chip. Highest visible payoff, smallest surface.
2. **Findings 3 + 4** — delete (or wire up) the computed-but-unrendered badges and IBKR provider row.
3. **Findings 6 + 7** — de-duplicate latency and stream-freshness lines.
4. **Finding 5** — unify the popover-title tone source with the chip/tiles.
5. **Finding 8** — wrapping/tooltips for truncated detail rows.
6. **Finding 9** — cleanup of dead policy params.

---

## Follow-up — why the chip's line count "flips yellow" (backend capacity oscillation)

**Date:** 2026-06-16 · **Scope:** `artifacts/api-server` IBKR market-data line admission · **Status:** Root-cause, read-only (no code changed).

**Symptom → color *(observed)*.** Yellow == stream state `capacity-limited`. The chip text color is `compactLineUsage.tone` (`HeaderStatusCluster.jsx:742`), built in `ibkrPopoverModel.js:388` (`buildCompactLineUsage`) as `source.tone || streamStateTokenVar(state)`, where `state` falls back to `capacity-limited` when `free <= 0`. `--ra-stream-capacity-limited: var(--ra-amber-600)` (`index.css:361`), label "LIMITED" (`streamSemantics.ts:33`). So the chip mirrors the bridge's reported stream state; the popover bar uses a separate `used/cap >= 0.85` rule (`runtimeControlModel.js:1133-1142`).

**Why it turns yellow — real IBKR rejection *(observed)*.** `capacity_limited` is set by `handleStreamError` when `isCapacityPressureError` matches an IBKR gateway error (`bridge-quote-stream.ts:399-408` + `:789-802`; `bridge-option-quote-stream.ts:1007-1020`): messages containing `market data line` / `max number of tickers` / `ticker limit` / `subscription limit` → `capacity_limited`; `lane queue is full` / `pacing violation` / `paced` → `backpressure`. This is IBKR (or the bridge lane) actively rejecting subscriptions, not an internal heuristic.

**Why we hit the ceiling *(observed)*.** App budget is `DEFAULT_MAX_LINES=200` (`market-data-admission.ts:195`), narrowed to the real IBKR allowance only when bridge diagnostics report `marketDataLineBudget` (`ibkr-line-usage.ts:1523-1525`), on a 30s TTL (`BRIDGE_LINE_BUDGET_TTL_MS`, `:206`). The flow-scanner pool defaults to the FULL usable budget (`resolveConfiguredFlowScannerLineCap` → `usableLines`, `:429-437`) unless `OPTIONS_FLOW_SCANNER_LINE_BUDGET` / concurrency runtime config constrains it (`platform.ts:11039`, `:11308-11315`). So the background options-flow scanner is a greedy consumer that fills lines toward the ceiling; when total demand exceeds what IBKR will actually serve, IBKR returns a capacity/pacing error.

**Why it FLIPS — no-hysteresis oscillation *(observed)*.** On each capacity error: `recordMarketDataAdmissionIbkrPressure` (`:543`) → `shedFlowScannerLeasesForIbkrPressure` (`:493`) demotes scanner leases to 50% (`IBKR_PRESSURE_SCANNER_REMAINING_RATIO=0.5`, `:207`), policy `"one-shot-scanner-shed"`, and the stream reconnects after `RECONNECT_DELAY_MIN_MS`. The shed has **no cooldown, no hysteresis, and does not lower the scanner's target/effective cap** — `recentIbkrPressureShed` is display-only (`:2500-2501`); `rebalanceFlowScannerLeasesAboveEffectiveCap` (`:1752`) only trims leases *above* the cap, which the post-shed scanner is not. The scanner re-acquires lines back to its effective cap and re-trips the same IBKR error → `used` saws across the threshold → `bridge.streamState` toggles `capacity-limited` ↔ `healthy` → chip flips amber ↔ normal.

**Fix direction (not implemented).** (1) Add a cooldown/backoff window to the scanner shed so it cannot re-fill-and-retrip immediately. (2) On pressure, lower the scanner's *effective cap* (target demand) for a damping window rather than a one-shot lease release. (3) Prefer the bridge-reported `marketDataLineBudget` as the hard cap and treat 200 as a ceiling only, so the scanner isn't sized against an optimistic budget.

**Live confirmation (not yet run).** Check `GET /api/settings/ibkr-line-usage` (`used`/`cap`/`bridge.streamState`) and the admission diagnostics `ibkrPressure` field + `recentIbkrPressureShed` flag during market hours with the bridge connected to confirm the sawtooth in runtime.
