import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __RAYALGO_BLOOMBERG_STARTUP_TIMEOUT_MS__?: number;
    __RAYALGO_BLOOMBERG_SOURCE_COOLDOWN_MS__?: number;
    __RAYALGO_BLOOMBERG_DIAGNOSTICS__?: () => Record<string, unknown>;
  }
}

test.setTimeout(45_000);
test.describe.configure({ mode: "serial" });

const quote = {
  symbol: "SPY",
  price: 500,
  prevClose: 498,
  change: 2,
  changePercent: 0.4,
  open: 499,
  high: 503,
  low: 496,
  volume: 50_000_000,
  delayed: false,
};

async function mockPlatformApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname === "/api/session") {
      body = {
        configured: { ibkr: false, research: false },
        ibkrBridge: {
          authenticated: false,
          connected: false,
          liveMarketDataAvailable: false,
          transport: "gateway",
        },
        environment: "paper",
        marketDataProviders: {},
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [{ id: "default", name: "Default", isDefault: true, symbols: ["SPY"] }],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      body = { quotes: [quote] };
    } else if (url.pathname === "/api/bars") {
      body = { bars: [] };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/flow/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = { profile: { enabled: false, timeframe: "15m", watchlistId: null } };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { states: [] };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openBloombergDock(page: Page) {
  await page.addInitScript(() => {
    window.__RAYALGO_BLOOMBERG_STARTUP_TIMEOUT_MS__ = 2_000;
    window.__RAYALGO_BLOOMBERG_SOURCE_COOLDOWN_MS__ = 30_000;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
      }),
    );
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /STANDBY\s+Bloomberg/i }).click();
  await expect(page.locator("video")).toBeAttached();
  await expect(page.getByRole("button", { name: "More Bloomberg controls" })).toBeVisible();
}

async function getBloombergDiagnostics(page: Page) {
  return page.evaluate(() => window.__RAYALGO_BLOOMBERG_DIAGNOSTICS__?.() ?? null);
}

function livePlaylist(segmentName: string) {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:4",
    "#EXT-X-MEDIA-SEQUENCE:1",
    "#EXTINF:4.0,",
    `/bloomberg-test/${segmentName}.ts`,
    "",
  ].join("\n");
}

test("shows diagnostics when Bloomberg playlists cannot load", async ({ page }) => {
  await mockPlatformApi(page);
  await page.route(/bloomberg\.com\/media-manifest\/streams\/.*\.m3u8(?:\?.*)?$/, (route) =>
    route.abort("blockedbyclient"),
  );

  await openBloombergDock(page);

  await expect(page.getByText("Unable to reach Bloomberg stream.")).toBeVisible({
    timeout: 8_000,
  });
  await expect(
    page.getByText(/manifestLoadError|Timed out reaching Bloomberg stream/).first(),
  ).toBeVisible();
  await expect.poll(async () => (await getBloombergDiagnostics(page))?.lastErrorKind).toBe(
    "manifest",
  );
  await expect.poll(async () => (await getBloombergDiagnostics(page))?.failoverCount).toBe(1);
  const diagnostics = await getBloombergDiagnostics(page);
  expect(diagnostics?.activeSourceId).toBe("us");
  expect(diagnostics?.status).toBe("error");
});

test("falls back to the secondary Bloomberg source when primary fails", async ({ page }) => {
  await mockPlatformApi(page);
  let primaryRequests = 0;
  let secondaryRequests = 0;

  await page.route(/bloomberg\.com\/media-manifest\/streams\/phoenix-us\.m3u8(?:\?.*)?$/, (route) => {
    primaryRequests += 1;
    return route.abort("blockedbyclient");
  });
  await page.route(/bloomberg\.com\/media-manifest\/streams\/us\.m3u8(?:\?.*)?$/, (route) => {
    secondaryRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/vnd.apple.mpegurl",
      headers: { "access-control-allow-origin": "*" },
      body: livePlaylist("secondary-fallback"),
    });
  });
  await page.route(/bloomberg-test\/.*\.ts(?:\?.*)?$/, (route) =>
    route.abort("blockedbyclient"),
  );

  await openBloombergDock(page);

  await expect.poll(async () => (await getBloombergDiagnostics(page))?.activeSourceId).toBe(
    "us",
  );
  await expect.poll(async () => (await getBloombergDiagnostics(page))?.failoverCount).toBe(1);
  await expect.poll(() => primaryRequests).toBeGreaterThan(0);
  await expect.poll(() => secondaryRequests).toBeGreaterThan(0);
});

test("surfaces a segment error when no Bloomberg video segments become playable", async ({
  page,
}) => {
  await mockPlatformApi(page);
  await page.route(/bloomberg\.com\/media-manifest\/streams\/phoenix-us\.m3u8(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/vnd.apple.mpegurl",
      headers: { "access-control-allow-origin": "*" },
      body: livePlaylist("primary-segment"),
    }),
  );
  await page.route(/bloomberg\.com\/media-manifest\/streams\/us\.m3u8(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/vnd.apple.mpegurl",
      headers: { "access-control-allow-origin": "*" },
      body: livePlaylist("secondary-segment"),
    }),
  );
  await page.route(/bloomberg-test\/.*\.ts(?:\?.*)?$/, (route) =>
    route.abort("blockedbyclient"),
  );

  await openBloombergDock(page);

  await expect(page.getByText("Unable to reach Bloomberg stream.")).toBeVisible({
    timeout: 12_000,
  });
  await expect(page.getByText(/fragLoadError/).first()).toBeVisible();
  await expect.poll(async () => (await getBloombergDiagnostics(page))?.lastErrorKind).toBe(
    "segments",
  );
});

test("manual source selection reloads the chosen Bloomberg source", async ({ page }) => {
  await mockPlatformApi(page);
  let secondaryRequests = 0;

  await page.route(/bloomberg\.com\/media-manifest\/streams\/.*\.m3u8(?:\?.*)?$/, (route) => {
    if (route.request().url().includes("/us.m3u8")) {
      secondaryRequests += 1;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/vnd.apple.mpegurl",
      headers: { "access-control-allow-origin": "*" },
      body: livePlaylist("manual-source"),
    });
  });
  await page.route(/bloomberg-test\/.*\.ts(?:\?.*)?$/, (route) =>
    route.abort("blockedbyclient"),
  );

  await openBloombergDock(page);

  await page.getByRole("button", { name: "More Bloomberg controls" }).click();
  await page.getByRole("button", { name: "Select U.S. BTV Bloomberg source" }).click();

  await expect.poll(async () => (await getBloombergDiagnostics(page))?.mode).toBe("manual");
  await expect.poll(async () => (await getBloombergDiagnostics(page))?.activeSourceId).toBe(
    "us",
  );
  await expect.poll(() => secondaryRequests).toBeGreaterThan(0);
});
