import { expect, test, type Page } from "@playwright/test";

const now = "2026-04-30T12:00:00.000Z";

function buildDiagnosticsLatest() {
  const chartHydrationSnapshot = {
    id: "chart-hydration-snapshot",
    observedAt: now,
    subsystem: "chart-hydration",
    status: "degraded",
    severity: "warning",
    summary: "Chart hydration needs attention",
    dimensions: {},
    metrics: {
      activeScopeCount: 1,
      prependingScopeCount: 1,
      exhaustedScopeCount: 0,
      prependP95Ms: 2250,
      payloadShapeErrors: 1,
      cursorFallbackCount: 4,
      cacheEntries: 8,
      cacheMaxEntries: 256,
      inFlight: 1,
      historyCursorEntries: 2,
      historyCursorMaxEntries: 512,
      historyCursorTtlMs: 600000,
      cursorEnabled: true,
      dedupeEnabled: true,
      backgroundEnabled: true,
      cacheHit: 12,
      cacheMiss: 3,
      inFlightJoin: 4,
      providerFetch: 5,
      providerPage: 7,
      cursorContinuation: 2,
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
          olderHistoryPageCount: 1,
          olderHistoryProvider: "polygon-history",
          olderHistoryProviderPageCount: 2,
          olderHistoryProviderPageLimitReached: true,
          hasProviderCursor: true,
          hasHistoryCursor: true,
        },
      ],
    },
    raw: {},
  };

  return {
    timestamp: now,
    status: "degraded",
    severity: "warning",
    summary: "One or more diagnostics need attention",
    snapshots: [
      {
        id: "browser-snapshot",
        observedAt: now,
        subsystem: "browser",
        status: "ok",
        severity: "info",
        summary: "Browser diagnostics are quiet",
        dimensions: {},
        metrics: {
          eventCount5m: 0,
          warningCount5m: 0,
          criticalCount5m: 0,
        },
        raw: {},
      },
      chartHydrationSnapshot,
    ],
    events: [
      {
        id: "chart-event",
        incidentKey:
          "chart-hydration:cursor:chart_hydration_cursor_fallbacks",
        subsystem: "chart-hydration",
        category: "cursor",
        code: "chart_hydration_cursor_fallbacks",
        severity: "warning",
        status: "open",
        message:
          "Chart history cursors are falling back to windowed provider fetches.",
        firstSeenAt: now,
        lastSeenAt: now,
        eventCount: 1,
        dimensions: { cursorFallbackCount: 4 },
        raw: {},
      },
    ],
    thresholds: [],
  };
}

async function mockDiagnosticsApi(page: Page) {
  const latest = buildDiagnosticsLatest();
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};

    if (url.pathname === "/api/session") {
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        configured: { polygon: false, ibkr: false, research: false },
        ibkrBridge: null,
        timestamp: now,
      };
    } else if (url.pathname === "/api/user-preferences") {
      body = {};
    } else if (url.pathname === "/api/diagnostics/latest") {
      body = latest;
    } else if (url.pathname === "/api/diagnostics/history") {
      body = {
        points: [
          {
            at: now,
            subsystem: "chart-hydration",
            severity: "warning",
            status: "degraded",
            count: 1,
            metrics: latest.snapshots[1].metrics,
          },
        ],
        snapshots: latest.snapshots,
      };
    } else if (url.pathname === "/api/diagnostics/events") {
      body = { events: latest.events };
    } else if (url.pathname === "/api/diagnostics/thresholds") {
      body = { thresholds: [] };
    } else if (url.pathname === "/api/diagnostics/client-events") {
      body = { event: latest.events[0] };
    } else if (url.pathname === "/api/diagnostics/client-metrics") {
      body = { accepted: true, id: "client-metrics" };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("Diagnostics renders chart hydration observability", async ({ page }) => {
  await mockDiagnosticsApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /Diagnostics/i }).click();

  await expect(page.getByText("Chart Hydration").first()).toBeVisible();
  await page.getByRole("button", { name: "Browser", exact: true }).click();

  await expect(page.getByText("Chart Hydration").first()).toBeVisible();
  await expect(page.getByText("Chart Backend", { exact: true })).toBeVisible();
  await expect(page.getByText("Chart Scopes", { exact: true })).toBeVisible();
  await expect(page.getByText("SPY:1m:test")).toBeVisible();
  await expect(page.getByText("Cursor fallbacks")).toBeVisible();
});
