# Backend Data Machine — Wiring Matrix

Source-traced contract for the Diagnostics → Overview "Backend Data Machine"
panel. Every bubble is backed by a named sensor; every edge is a verified code
path. The contract test (`machineStateDiagram.contract.test.mjs`) pins the
vocabularies and constants below — update this doc and the model together.

Locked with Riley in the Phase 0 walkthrough (8 rounds + follow-ups), 2026-06-12.

## Truth-bias rules

1. **Own-telemetry bubbles.** A bubble colors by its OWN sensor only. Upstream
   trouble travels on edges (worst-of-endpoints), never by cascading into
   downstream bubbles. The panel summary still aggregates everything.
2. **No healthy zeros.** Missing/malformed numeric telemetry is `n/a`, never 0
   (`firstFiniteNumber` rejects `null`/`''`/`false`/arrays).
3. **No fabricated timestamps.** `observedAt` is a real payload time or `null`
   ("waiting"). "observed" evidence means a payload actually carried it.
4. **Snapshot decay.** Nodes sourced from the diagnostics SSE payload decay as
   it ages: > `SNAPSHOT_STALE_MS` (30s) demotes `observed`→`inferred` and stops
   edge animation; > `SNAPSHOT_EXPIRED_MS` (60s) demotes `healthy`/`idle`→
   `unknown` with an age suffix. **Degraded/down/checking never wash out.**
5. **Idle is honest quiet.** `idle` ranks between `unknown` and `healthy`:
   never alarms, never masks problems, never animates. Used for the Massive
   provider's declared idle and the session-quiet flow scanner.
6. **Coerced booleans need corroboration.** The runtime-control hook coerces
   missing broker freshness to `fresh:false`; the model treats `fresh:false`
   as observed-stale only when `lastEventAt` exists. `lineUsage.available ===
   false` means "not observed", not "zero lines".

## Vocabulary pins

- Node/edge status: `unknown | idle | healthy | checking | degraded | down`
- Evidence: `unknown | inferred | observed`
- Backend snapshot status: `ok | degraded` (diagnostics.ts:2952 — `down` is
  synthesized frontend-side, e.g. `ibkr.connected === false`)
- Backend severity: `info | warning`; event status: `open | resolved`
- Frontend streamState: `paused | polling | connecting | live | reconnecting | error`
  (`paused` → unknown: an intentionally idle transport must not look healthy)
- Massive provider status: `ok | idle | unconfigured | degraded | unknown`
  (`unconfigured` → unknown)

## Mirrored backend constants

| Constant | Value | Source of truth |
|---|---|---|
| `DIAGNOSTICS_COLLECTION_INTERVAL_MS` | 15_000 | api-server/src/services/diagnostics.ts:203 |
| `IBKR_HEARTBEAT_WARNING_MS` | 30_000 | diagnostics.ts:298 |
| `MARKET_DATA_FRESHNESS_WARNING_MS` | 2_000 | diagnostics.ts:308 |
| `MARKET_DATA_STREAM_GAP_WARNING_MS` | 5_000 | diagnostics.ts:318 |
| `BROWSER_MEMORY_WATCH_PERCENT` | 60 | diagnostics.ts:247 |
| `BROWSER_MEMORY_HIGH_PERCENT` | 75 | diagnostics.ts:248 |
| `SNAPSHOT_STALE_MS` | 2 × collector interval | derived |
| `SNAPSHOT_EXPIRED_MS` | 4 × collector interval | derived |

Other relevant cadences: runtime-control React Query poll 5s
(useRuntimeControlSnapshot.js:38-40, enabled on Overview per
DiagnosticsScreen.jsx:724-731); backend line-usage refresh 2s
(ibkr-line-usage.ts:78).

## Master model groups (12) and child sensors (24) — visual structure

Latest visual refinement (user-confirmed, 2026-06-12): Diagnostics and Client
are **not** part of the normal bottom data pipeline. Diagnostics renders as a
card in a right-side **Observability & Clients** rail. Client remains a model
group because it owns real browser/API-boundary sensors, but it is **not
rendered as a standalone card**; its children render as compact rail sections
(`API Boundary`: API Link, Admission, Transport; `Browser Signals`: Browser
Events, Browser Memory). The main machine has four conceptual stages:
1 sources → 2 process lanes → 3 signals/algo → 4 account/trading. These stages
(and the observability rail) live in `LANE_BANDS` as the layout/viewBox
reference, but the lane **chrome is not drawn** — no dashed lane boxes and no
stage labels are rendered. Cards and edges float on the canvas; each card's own
title provides orientation.

View-only edge rule: the model still derives every verified master edge, but
the renderer draws ONLY the hand-authored pipeline flow. No connectors are
drawn into the observability rail at all (the earlier attention-status alert
overlay was removed). Trouble surfaces through the Diagnostics card status and
the bottom attention strip instead, so the pipeline never implies normal
telemetry/data flow into the rail.

Market Data fan-out is column-anchored: the rendered card is a 2-column table
(Equities | Options), and the three downstream edges leave from their actual
source column rather than a target-biased port. Equities (col 0) -> Signals;
Options (col 1) -> Flow and GEX. The two Options edges are spread by a small
`portBias` so they leave from within the Options column instead of overlapping.
`marketColumnPortX` shares the table geometry with `MarketDataCard`.

Transport lines + dots: every edge declares a `transports` array — the means by
which data moves along it. Each transport draws its OWN parallel line (laterally
offset by `TRANSPORT_LINE_GAP`) with a dot at the curve midpoint whose tooltip
names the means (`means: detail`). When an edge has more than one means it
becomes multiple parallel lines, so a realtime path and a delayed path are never
collapsed into one. A delayed/historical transport (`fresh: false`) is rendered
**dashed** and tooltip-tagged `· delayed`, so it reads as a DISTINCT source — the
canonical case is Flow, served by IBKR realtime (solid) AND Massive ≥15m delayed
(dashed) on two separate lines. The transport means are derived from the model's
verified edge graph (`machineStateDiagramModel.js`) and the Market Data provider
table; they are a visual architecture annotation, not a runtime probe.

Batch-4 retained: **Platform Edge dissolved** — API Link (api p95/req) and
Admission (action, with pressure level folded into its detail as the why) moved
to the Client model group ("can my app get data" in one place); API Pressure
moved to Diagnostics (resource sample). Per-lane connection metrics were
explicitly NOT faked: backend api/admission metrics are route-aggregates, so
they live once, on the boundary/consumer rail. **Bridge Governor embedded into
the Broker Feed card** as its second bubble; its budget edges now emanate from
the broker card. Status ICONS replace colored dots and corner status words:
healthy ✓, checking ◌, degraded !, down ✕, idle –, unknown ?. The
position-quotes bubble still carries a live/shadow split in the model, but the
card renders a single worst-of glyph; the live and shadow line counts are shown
in the card footer detail rather than as a doubled glyph.

Batch-3 (user-confirmed): the diagram is organized as SWIMLANES mirroring the
app's screens — data pours DOWN a funnel from the sources through the domain
lanes (Market/Trade, Flow, GEX, Signals), then RIGHT into Account & Trading
where decisions become positions. The old Market Data container was deleted
and redistributed into the lanes. Earlier batch-2 decisions retained: sources
as their own cards, Bridge Governor single merged readout below Broker Feed,
Equities/Options channel split, massive equity quote fallback into Account.

Lane additions: **Trade Chain** bubble (Trade Options Chain line pool — only
exposed at `lineUsage.pools.visible` in the live payload, NOT top-level;
same for `pools.automation` — the model reads pools-first to avoid the
phantom). **GEX Projection** bubble: sensor is the client-side React Query
cache state for `gex-dashboard`/`gex-projection`/`gex-zero-gamma` keys —
unknown when the cache was not observed, idle when observed with zero
requests (on-demand feature), degraded on fetch errors. NOTE: signal-monitor
computes its own gamma internally (contractGexForHydration) and does NOT
consume the gex feature — there is deliberately no gex→signals edge.

`source` drives decay: `latest` = diagnostics SSE payload, `runtime` =
runtime-control poll (no payload timestamp — see Limitations), `client` =
observed directly in the browser.

### Broker Feed (IBKR) — `broker` (single readout)
| ibkr-bridge "Broker Feed" | `latest` ibkr snapshot (classifyIbkrSnapshot diagnostics.ts:1959; heartbeat warn 30s :298) | snapshot severity; `connected===false` → down. Strict 24/7 — infrastructure heartbeat, no idle | latest |

### Massive Feed — `massive` (single readout)
| massive-feed "Massive Feed" | `runtimeControl.massive` (merged provider diagnostics; fallback `latest` market-data raw.massive diagnostics.ts:3751) | declared `idle` wins over healthy REST and suppresses the message-age check; otherwise ws/rest/feed statuses + lastError + age > 5s → degraded | runtime |

### Bridge Governor — `governor` (single merged readout, below Broker Feed)
| bridge-governor "Bridge Governor" | `lineUsage` total/pools/pressure/warnings (ibkr-line-usage.ts:1667) + `runtimeControl.bridgeGovernor` lane circuits (runtimeControlModel.js:1517-1520) | worst of pool state / pressure / warnings>0 / any circuitOpen → degraded; `available:false` and no lanes → unknown. Detail always leads with line use/count | runtime |

### Account — `account`
| Bubble | Sensor | Status rule | Source |
|---|---|---|---|
| account-stream "Account State" | `runtimeControl.streams.account` (broker-stream freshness, runtimeControlModel.js:1521-1527) | fresh+lastEventAt → healthy/degraded; lastEventAt only → checking; neither → unknown (rule 6) | runtime |
| order-stream "Order State" | `runtimeControl.streams.order`; served by /api/streams/orders (platform.ts:2978) | same | runtime |
| position-quotes "Position Quotes" (SPLIT bubble) | `lineUsage.accountMonitor` (live half) + `lineUsage.shadowAccount` (shadow half, incl. massiveFallbackLineCount) | per-half pool status; bubble = worst half | runtime |
| account-view "Account View" | `latest` accounts/orders probe snapshots (visibility failures, diagnostics.ts:3826/3835) + `streams.tradingFresh` (rule 6 gated) | probe severity + failure counts + stale trading → degraded | latest |

### Market Data — `market`
Rendered as a single wide **2×2 provider table card** (`MarketDataCard`), not a
bubble-row card. Columns Equities | Options, rows Realtime | Historical. Each
cell shows the verified provider chain (primary → fallback); the Realtime row
also carries a live status glyph from its diagnostic child node (`market-equities`
for Realtime Equities, `market-options` for Realtime Options). The Historical row
has no live sensor, so its cells render muted provider labels with NO fabricated
health. Verified provider mapping: Realtime Equities = Massive → IBKR; Realtime
Options = IBKR → Massive; Historical Equities/Options = IBKR → Massive.

**Trade Chain folded in.** The former `trade` master group (Trade Chain line
pool, child `trade-chain`) is no longer rendered as a standalone card. It stays
in `MACHINE_STATE_GROUPS` so its child sensor and derived edges survive, but it
is not positioned in `GROUP_XY` and is folded conceptually into the Market Data
card. (`trade-mgmt` "Trade Mgmt" remains a distinct execution-layer card.)

Equities and options ride different upstream channels; buildMarketDataMetrics
(diagnostics.ts:1150-1290) keeps per-channel fields. Documented caveat
(user-accepted): the snapshot's `freshnessAgeMs` is a min-of-both blend, so a
Massive stall can amber the Options bubble — attribution stays readable because
the Equities bubble and Massive card amber simultaneously. Gap fields are
bridge-pure. `streamState: "quiet"` is the backend's session-aware idle.
| market-equities "Equities Stream" | massive* channel fields of the market-data snapshot (`massiveWebSocketStatus`, `massiveLastSocketMessageAgeMs`, `massiveSubscribedSymbolCount`) | quiet → idle; ws status (idle-aware); socket age > 5s → degraded | latest |
| market-options "Options Stream" | bridge-side fields (`recentMaxGapMs`/`maxGapMs`, `cachedQuoteCount`, `lastEventAgeMs`) + blended `freshnessAgeMs` + `streamState` | quiet → idle; freshness > 2s or gap > 5s → degraded; reconnectScheduled → checking | latest |
| flow-scanner "Flow Scanner" | `runtimeControl.flowScanner` + `lineUsage.flowScanner`; structured `sessionBlockedReason` (runtimeControlModel.js:1536-1556, added with this work) | session-quiet → idle; enabled-but-inactive → checking; pool state | runtime |

### Signals / Algo / Trade Mgmt — `signals`, `algo`, `trade-mgmt`
All three read the `latest` automation snapshot (classifyAutomationSnapshot
diagnostics.ts:2378) but different fields — same component cluster, distinct
sensors:
| Bubble | Sensor | Status rule | Source |
|---|---|---|---|
| signal-engine "Signals" | freshSignalCount / staleSignalCount / latestScanAgeMs | stale>0 → checking | latest |
| algo-engine "Algo Engine" | snapshot severity + candidateCount / scan duration / gatewayBlockedCount / failureCount + `lineUsage.automation` | blocked or failures > 0 → degraded | latest |
| trade-management "Trade Mgmt" | shadowExitCount / expirationMaintenanceDueCount / orders failureCount | order failures → degraded; expirations due → checking | latest |

### Diagnostics — `diagnostics`
Diagnostics renders as the only observability card in the right rail. API
Pressure lives here as a server resource sample, not as a normal pipeline hop.
| Bubble | Sensor | Status rule | Source |
|---|---|---|---|
| diagnostics-collector "Collector" | `latest.timestamp/status/severity` (collectDiagnosticSnapshot diagnostics.ts:3712, 15s) | top-level status/severity | latest |
| diagnostics-stream "Diagnostics SSE" | client-side EventSource state (/api/diagnostics/stream, routes/diagnostics.ts:321) | streamState mapping | client |
| diagnostics-incidents "Incidents" | `latest.events` open/resolved + severity | open events → ≥ degraded; malformed entries ignored | latest |
| api-pressure "API Pressure" | SERVER-only: memoryPressureState.server.pressureLevel + resource-pressure metrics + apiHeapUsedPercent | pressure level; heap ≥ 75% → degraded. Browser memory deliberately excluded (lives on Client) | latest |

### Client rail signals — `client`
Client is a model group, not a card. Its children render as rail sections so
the browser/API boundary remains observable without implying a normal machine
container.
| Bubble | Sensor | Status rule | Source |
|---|---|---|---|
| api-runtime "API Link" | `latest` api snapshot (classifyApiSnapshot diagnostics.ts:1108; p95 warn 1s :254) | snapshot severity | latest |
| route-admission "Route Admission" | admissionAction allow/cache-only/shed (route-admission.ts:18) via memoryPressureState.server + resource-pressure snapshot (diagnostics.ts:3801) | action observed → exact state; else pressure-level inference (evidence `inferred`) | latest |
| client-transport "Transport" | EventSource state (DiagnosticsScreen.jsx:961-991) | streamState mapping — error shows amber here, not green | client |
| browser-events "Browser Events" | `latest` browser snapshot (classifyBrowserSnapshot diagnostics.ts:1393), fed by the audit loop below | snapshot severity + event/warning counts | latest |
| browser-memory "Browser Memory" | performance.memory sampling (memoryPressureStore, 5–15s) via memoryPressureState/footerSignal | % of limit: ≥75 degraded, ≥60 checking (mirrors diagnostics.ts:247-248) | client |

## Master model edges (27)

Derived by deduping child edges across group boundaries; each traces to real
code. The renderer treats this as the truth graph, then applies the view-only
rail rule above before drawing.

| Edge | Label | Code path |
|---|---|---|
| broker→account | broker REST/SSE + quote lines | ibkr-account-bridge.ts:27; /api/streams/orders platform.ts:2978; lineUsage account/shadow quote pools |
| broker→market | quotes/chains | bridge-quote-stream.ts:9 (equities) + bridge-option-quote-stream.ts (options) |
| broker→flow | chains + line budget | options-flow-scanner.ts:36 plus broker line usage |
| broker→gex | option chains | GEX projection cache queries depend on option-chain fetches |
| broker→trade | chain line budget | Trade Options Chain pool (`lineUsage.pools.visible`) |
| broker→algo | algo budget | signal-options-automation.ts:104-106 admission leases |
| broker→client | pressure/backoff | route-admission inputs derived from broker/governor pressure; hidden unless broker needs attention |
| massive→market | Massive WS | massive-stock-quote-stream.ts:14 |
| massive→flow | spot fallback | flow scanner spot fallback from Massive provider diagnostics |
| massive→account | equity quote fallback | EQUITY marks only, live + shadow: live marks tagged source==="massive" (account.ts:2627, non-option branch only) + shadowAccount.massiveFallbackLineCount (ibkr-line-usage.ts:1632). NEVER options — option marks are always bridge option quotes (account.ts:2624-2630) |
| market→account | quote marks | account.ts:5-6 (stock + option quote snapshots → position marks) |
| market→signals | bars/quotes | signal-monitor.ts:49,73 |
| flow→signals | flow events | signal-monitor flow-event hydration |
| signals→algo | worker state | signal engine output consumed by signal-options automation |
| account→algo | risk/capital | signal-options-automation.ts:103; shadow-account.ts:26 |
| algo→trade-mgmt | decisions | algo-engine decisions feed trade-management state |
| account→trade-mgmt | positions/fills | order stream + account view feed exits/status/maintenance |
| market→client | market model | REST handlers serving market/options models; hidden unless market needs attention |
| trade→client | chain snapshots | API Link serves trade-chain snapshots; hidden unless trade chain needs attention |
| flow→client | flow model | API Link serves flow model; hidden unless flow needs attention |
| gex→client | gex model | API Link serves GEX projection model; hidden unless GEX needs attention |
| signals→client | signal model | API Link serves signal model; hidden unless signals need attention |
| account→client | account model | platform.ts account route handlers; hidden unless account needs attention |
| trade-mgmt→client | trade state | shadow-account events → REST; hidden unless trade management needs attention |
| diagnostics→client | EventSource + pressure gate | /api/diagnostics/stream → this screen; rail-internal and hidden as a normal pipeline edge |
| client→diagnostics | client events/metrics | POST /api/diagnostics/client-events routes/diagnostics.ts:248-259 plus request/resource metrics; rail-internal and hidden as a normal pipeline edge |
| trade-mgmt→diagnostics | events/probes | SIGNAL_OPTIONS_EVENT_PREFIX collection diagnostics.ts:50-54; hidden unless trade management needs attention |

Edge animation ⟺ evidence ≠ unknown ∧ status ∈ {healthy, checking} ∧ neither
endpoint idle ∧ neither endpoint stale.

## Documented limitations

- The runtime-control payload carries no per-payload timestamp, so
  `runtime`-sourced bubbles do not snapshot-decay; their freshness rides
  `lastEventAt` fields where available. Acceptable: the poll is 5s and React
  Query stops polling when the tab is hidden.
- The hook-level `Boolean()` freshness coercion (runtimeControlModel.js:
  1504-1505) and fabricated empty pools (normalizeAdmissionDiagnostics) are
  compensated in this model (rule 6) rather than changed at the hook — the
  hook is shared by five other screens.
- Intentionally omitted flows (internal/secondary): shadow stop-loss feedback
  loop (shadow-account.ts:4860), signal-options worker state recovery,
  overnight-spot event dedupe, client perf-metrics POST
  (routes/diagnostics.ts:261-280).
