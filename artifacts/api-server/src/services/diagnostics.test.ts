import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

const diagnosticsModule = await import("./diagnostics");
const {
  collectDiagnosticSnapshot,
  getDiagnosticThresholds,
  listDiagnosticHistory,
  listDiagnosticEvents,
  recordBrowserReports,
  recordApiRequest,
  recordBrowserDiagnosticEvent,
  recordClientDiagnosticsMetrics,
} = diagnosticsModule;

test("diagnostics do not page on low-sample startup latency", async () => {
  recordApiRequest({
    method: "GET",
    path: "/api/startup",
    statusCode: 200,
    durationMs: 5_000,
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 5_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        accountCount: 1,
        lastTickleAt: new Date().toISOString(),
        liveMarketDataAvailable: true,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 2 },
      orders: { ok: true, count: 3 },
    },
  });

  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");

  assert.equal(api?.status, "ok");
  assert.equal(api?.metrics.p95LatencyMs, 5_000);
  assert.equal(api?.metrics.p95_latency_ms, null);
  assert.equal(api?.metrics.latencyAlertMinSamples, 20);
});

test("diagnostics collect API latency and runtime snapshots without broker mutations", async () => {
  recordApiRequest({
    method: "GET",
    path: "/api/example",
    statusCode: 200,
    durationMs: 42,
  });
  recordApiRequest({
    method: "GET",
    path: "/api/slow",
    statusCode: 500,
    durationMs: 1_250,
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        accountCount: 1,
        lastTickleAt: new Date().toISOString(),
        liveMarketDataAvailable: true,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 2 },
      orders: { ok: true, count: 3 },
    },
  });

  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const marketData = collected.snapshots.find((snapshot) => snapshot.subsystem === "market-data");
  const browser = collected.snapshots.find((snapshot) => snapshot.subsystem === "browser");
  const orders = collected.snapshots.find((snapshot) => snapshot.subsystem === "orders");

  assert.equal((api?.metrics.requestCount5m as number) >= 2, true);
  assert.equal(api?.metrics.errorCount5m, 1);
  assert.equal(ibkr?.status, "ok");
  assert.equal(marketData?.status, "ok");
  assert.equal(browser?.metrics.warningCount5m, 0);
  assert.equal(orders?.metrics.orderCount, 3);
});

test("diagnostics expose defaults, browser events, and memory-backed history", async () => {
  const thresholds = await getDiagnosticThresholds();
  assert.ok(thresholds.some((threshold) => threshold.metricKey === "api.p95_latency_ms"));
  assert.ok(
    thresholds.some(
      (threshold) =>
        threshold.metricKey === "chart_hydration.prepend_p95_ms",
    ),
  );

  const event = await recordBrowserDiagnosticEvent({
    category: "unit-test",
    severity: "warning",
    message: "Client event test",
    raw: { ok: true },
  });
  assert.equal(event.subsystem, "browser");
  assert.equal(event.category, "unit-test");

  const history = await listDiagnosticHistory({
    from: new Date(Date.now() - 60_000),
    to: new Date(Date.now() + 60_000),
  });
  assert.ok(history.snapshots.length > 0);
  assert.ok(history.points.length > 0);
});

test("diagnostics classify stale IB Gateway tunnels and market-data gaps", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        competing: false,
        healthError: "Upstream request failed.",
        healthErrorCode: "upstream_request_failed",
        healthErrorStatusCode: 502,
        healthErrorDetail: "getaddrinfo ENOTFOUND stale.trycloudflare.com",
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 2,
        cachedQuoteCount: 1,
        eventCount: 8,
        lastEventAgeMs: 12_500,
        freshnessAgeMs: 12_500,
        streamGapCount: 1,
        maxGapMs: 12_500,
        reconnectCount: 1,
      },
      accounts: { ok: true, count: 0 },
      positions: { ok: true, count: 0 },
      orders: { ok: true, count: 0 },
    },
  });

  const ibkrEvent = collected.events.find(
    (event) => event.code === "ibkr_bridge_stale_tunnel",
  );
  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );

  assert.equal(ibkrEvent?.severity, "critical");
  assert.match(ibkrEvent?.message ?? "", /stale|unreachable/i);
  assert.equal(marketData?.status, "down");
  assert.equal(marketData?.metrics.freshness_age_ms, 12_500);
});

test("diagnostics preserve stale tunnel root cause while bridge health is backed off", async () => {
  const rootFailure =
    "HTTP 502 Bad Gateway: 502 Bad Gateway\nUnable to reach the origin service. The service may be down or it may not be responding to traffic from cloudflared";
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        competing: false,
        healthFresh: false,
        healthError: "IBKR bridge health is temporarily backed off.",
        healthErrorCode: "ibkr_bridge_health_backoff",
        healthErrorStatusCode: 503,
        healthErrorDetail: "Bridge health checks are backed off for 5716ms.",
        governor: {
          health: {
            lastFailure: rootFailure,
          },
        },
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 0,
        unionSymbolCount: 0,
        cachedQuoteCount: 0,
        eventCount: 0,
      },
      accounts: { ok: false },
      positions: { ok: false },
      orders: { ok: false },
    },
  });

  const staleTunnel = collected.events.find(
    (event) => event.code === "ibkr_bridge_stale_tunnel",
  );
  const backoffOnly = collected.events.find(
    (event) => event.code === "ibkr_bridge_health_backoff",
  );

  assert.equal(staleTunnel?.severity, "critical");
  assert.match(staleTunnel?.message ?? "", /Unable to reach the origin service/);
  assert.match(staleTunnel?.message ?? "", /cloudflared/);
  assert.equal(backoffOnly, undefined);
});

test("diagnostics keep recovered market-data gaps visible without alerting current health", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 78,
        cachedQuoteCount: 79,
        eventCount: 750_000,
        lastEventAgeMs: 120,
        freshnessAgeMs: 120,
        streamGapCount: 9,
        maxGapMs: 64_075,
        recentGapCount: 0,
        recentMaxGapMs: null,
        reconnectCount: 9,
        lastError: "IBKR bridge quote stream ended.",
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );

  assert.equal(marketData?.status, "ok");
  assert.equal(marketData?.metrics.stream_gap_ms, null);
  assert.equal(marketData?.metrics.lastError, null);
  assert.equal(marketData?.metrics.rawLastError, "IBKR bridge quote stream ended.");
  assert.equal(marketData?.metrics.rawMaxGapMs, 64_075);
  assert.equal(marketData?.metrics.rawStreamGapCount, 9);
});

test("diagnostics treat quiet market stream as healthy", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: false,
        strictReady: false,
        strictReason: "stream_not_fresh",
        streamState: "quiet",
        streamStateReason: "market_session_quiet",
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 1,
        cachedQuoteCount: 19,
        eventCount: 20,
        lastEventAgeMs: 31_000,
        freshnessAgeMs: 31_000,
        streamGapCount: 0,
        maxGapMs: 3_229,
        reconnectCount: 2,
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );
  const streamFreshnessEvent = collected.events.find(
    (event) =>
      event.category === "stream-freshness" &&
      event.raw &&
      typeof event.raw === "object" &&
      "streamState" in event.raw &&
      event.raw.streamState === "quiet",
  );

  assert.equal(ibkr?.status, "ok");
  assert.equal(marketData?.status, "ok");
  assert.equal(marketData?.metrics.freshness_age_ms, null);
  assert.equal(marketData?.metrics.rawFreshnessAgeMs, 31_000);
  assert.equal(streamFreshnessEvent, undefined);

  const openEvents = await listDiagnosticEvents({
    from: new Date(Date.now() - 60_000),
    to: new Date(Date.now() + 60_000),
    status: "open",
  });
  assert.equal(
    openEvents.events.some(
      (event) => event.incidentKey === "ibkr:stale-tunnel:ibkr_bridge_stale_tunnel",
    ),
    false,
  );
  assert.equal(
    openEvents.events.some(
      (event) => event.incidentKey === "market-data:threshold:market_data.freshness_age_ms",
    ),
    false,
  );
});

test("diagnostics include reconnecting quote-stream errors without truncation", async () => {
  const lastError =
    "Error validating request.-'bO' : cause - Snapshot market data subscription is not applicable to generic ticks";
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: false,
        strictReady: false,
        strictReason: "stream_not_fresh",
        streamState: "reconnecting",
        streamStateReason: "quote_stream_error",
        lastError,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 1,
        cachedQuoteCount: 19,
        eventCount: 20,
        lastEventAgeMs: 31_000,
        freshnessAgeMs: 31_000,
        streamGapCount: 0,
        maxGapMs: 3_229,
        reconnectCount: 2,
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const streamFreshnessEvent = collected.events.find(
    (event) => event.category === "stream-freshness",
  );

  assert.equal(
    streamFreshnessEvent?.message,
    `IB Gateway is authenticated and the quote stream is reconnecting: ${lastError}`,
  );
  assert.doesNotMatch(streamFreshnessEvent?.message ?? "", /\.\.\.$/);
});

test("diagnostics classify degraded order reads without marking IBKR disconnected", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: {
        ok: true,
        count: 0,
        degraded: true,
        reason: "orders_timeout",
        stale: false,
      },
    },
  });

  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const orders = collected.snapshots.find((snapshot) => snapshot.subsystem === "orders");
  const orderEvent = collected.events.find(
    (event) => event.code === "read_probe_degraded",
  );

  assert.equal(ibkr?.status, "ok");
  assert.equal(orders?.status, "degraded");
  assert.equal(orders?.metrics.degraded, true);
  assert.equal(orderEvent?.severity, "warning");
});

test("diagnostics include resource pressure and browser isolation readiness", async () => {
  await recordClientDiagnosticsMetrics({
    memory: {
      source: "measureUserAgentSpecificMemory",
      confidence: "high",
      bytes: 256 * 1024 * 1024,
    },
    isolation: {
      crossOriginIsolated: true,
      memoryApiAvailable: true,
      memoryApiUsed: true,
    },
    workload: { chartScopeCount: 2 },
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
          arrayBuffers: 4,
        },
        resourceCaches: {
          bars: { entries: 2, maxEntries: 256, inFlight: 0 },
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const isolation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "isolation",
  );

  assert.equal(resourcePressure?.status, "ok");
  assert.equal(resourcePressure?.metrics.browserMemoryMb, 256);
  assert.equal(resourcePressure?.metrics.browserMemoryConfidence, "high");
  assert.equal(collected.footerMemoryPressure?.level, "normal");
  assert.equal(collected.footerMemoryPressure?.browserMemoryMb, 256);
  assert.equal(isolation?.metrics.crossOriginIsolated, true);
  assert.equal(isolation?.metrics.memoryApiUsed, true);
});

test("diagnostics treat full bounded caches as warning pressure, not outage", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
          arrayBuffers: 4,
        },
        resourceCaches: {
          optionChains: { entries: 128, maxEntries: 128, inFlight: 0 },
        },
      },
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: true,
        strictReason: null,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );

  assert.equal(resourcePressure?.status, "degraded");
  assert.equal(resourcePressure?.severity, "warning");
  assert.equal(resourcePressure?.metrics.pressureLevel, "watch");
  assert.notEqual(collected.status, "down");
});

test("diagnostics keep non-isolation browser reports out of isolation alerts", async () => {
  const result = await recordBrowserReports([
    {
      type: "threshold",
      url: "https://rayalgo.local/",
      body: {
        id: "layout-shift",
        message: "Browser threshold report",
      },
    },
  ]);

  assert.equal(result.accepted, 1);

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const isolation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "isolation",
  );
  const browser = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "browser",
  );

  assert.equal(isolation?.status, "ok");
  assert.equal(isolation?.metrics.reportCount5m, 0);
  assert.equal(
    Number((browser?.metrics as Record<string, unknown> | undefined)?.eventCount5m ?? 0) >= 1,
    true,
  );
});

test("diagnostics record COOP/COEP browser reports as isolation events", async () => {
  const result = await recordBrowserReports([
    {
      type: "coep",
      url: "https://rayalgo.local/",
      body: {
        blockedURL: "https://s3-symbol-logo.tradingview.com/aapl.svg",
        disposition: "reporting",
      },
    },
  ]);

  assert.equal(result.accepted, 1);

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const isolation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "isolation",
  );
  const event = collected.events.find(
    (item) => item.subsystem === "isolation" && item.code === "coep",
  );

  assert.equal(["degraded", "down"].includes(String(isolation?.status)), true);
  assert.equal(
    Number((isolation?.metrics as Record<string, unknown> | undefined)?.reportCount5m ?? 0) >= 1,
    true,
  );
  assert.equal(event?.severity, "warning");
});

test("diagnostics collect chart hydration metrics without leaking provider cursors", async () => {
  await recordClientDiagnosticsMetrics({
    chartHydration: {
      prependRequestMs: { p95: 2_250, count: 3 },
      modelBuildMs: { p95: 18, count: 3 },
      firstPaintMs: { p95: 75, count: 3 },
      counters: {
        payloadShapeError: 1,
        olderPageDuplicate: 4,
        olderPageFetch: 6,
        providerCursorPage: 2,
        historyCursorPage: 2,
      },
      activeScopeCount: 1,
      exhaustedScopeCount: 0,
      prependingScopeCount: 1,
      scopeRoles: { primary: 1 },
      scopes: [
        {
          scope: "SPY:1m:test",
          role: "primary",
          timeframe: "1m",
          hydratedBaseCount: 500,
          renderedBarCount: 500,
          livePatchedBarCount: 3,
          oldestLoadedAt: "2026-04-30T13:30:00.000Z",
          isPrependingOlder: true,
          hasExhaustedOlderHistory: false,
          olderHistoryProvider: "polygon-history",
          olderHistoryProviderCursor:
            "https://api.polygon.io/v2/aggs/ticker/SPY?apiKey=secret",
          olderHistoryProviderNextUrl:
            "https://api.polygon.io/v2/aggs/ticker/SPY?apiKey=secret",
          olderHistoryCursor: "opaque-history-cursor",
          olderHistoryProviderPageCount: 2,
          olderHistoryProviderPageLimitReached: true,
        },
      ],
    },
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        resourceCaches: {
          bars: {
            entries: 8,
            maxEntries: 256,
            inFlight: 1,
            historyCursorEntries: 2,
            historyCursorMaxEntries: 512,
            historyCursorTtlMs: 600_000,
            cursorEnabled: true,
            dedupeEnabled: true,
            backgroundEnabled: true,
            hydration: {
              cacheHit: 12,
              cacheMiss: 3,
              inFlightJoin: 4,
              staleServed: 1,
              providerFetch: 5,
              providerPage: 7,
              cursorContinuation: 2,
              cursorFallback: 4,
              backgroundRefresh: 1,
            },
          },
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const chartHydration = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "chart-hydration",
  );
  const rawText = JSON.stringify(chartHydration?.raw ?? {});

  assert.equal(chartHydration?.status, "degraded");
  assert.equal(chartHydration?.metrics.prependP95Ms, 2_250);
  assert.equal(chartHydration?.metrics.cursorFallbackCount, 4);
  assert.equal(chartHydration?.metrics.payloadShapeErrors, 1);
  assert.equal(chartHydration?.metrics.duplicateOlderPageCount, 4);
  assert.equal(rawText.includes("apiKey"), false);
  assert.equal(rawText.includes("opaque-history-cursor"), false);
  assert.ok(
    collected.events.some(
      (event) =>
        event.subsystem === "chart-hydration" &&
        event.code === "chart_hydration_cursor_fallbacks",
    ),
  );
  assert.ok(
    collected.events.some(
      (event) =>
        event.subsystem === "chart-hydration" &&
        event.code === "chart_hydration_payload_shape_error",
    ),
  );
});
