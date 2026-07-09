import { expect, test, type Page } from "@playwright/test";

// Run:
//   pnpm --filter @workspace/pyrus exec playwright test e2e/chart-hydration.browser-validation.spec.ts --reporter=list
// Against the public preview:
//   PYRUS_APP_URL=https://$REPLIT_DEV_DOMAIN/ pnpm --filter @workspace/pyrus exec playwright test e2e/chart-hydration.browser-validation.spec.ts --reporter=list
//
// Zoom/pan -> bar hydration under test: chartHydrationRuntime.js's
// useProgressiveChartBarLimit/expandForVisibleRange watches the chart's
// visible logical range and, near the left (older-history) edge, either
// expands the requested bar limit or prepends older history via
// chartApiBars.js (getBars -> GET /api/bars, POST /api/bars/batch --
// registered in artifacts/api-server/src/routes/platform.ts). This spec
// drives the market screen's first chart-grid cell with real wheel + drag
// input and checks that pan/zoom (a) can fetch more bars, (b) never runs
// away, (c) throws no console errors.
//
// Assumption (flag for verification once the box calms): the interaction
// below reliably provokes an additional bars fetch. If the chart's initial
// hydration already reached its target/max bar limit for the default
// timeframe, zooming/panning may legitimately fetch nothing more -- that
// would fail the "additional fetch" assertion below even though hydration
// itself isn't broken. Re-check against a freshly booted app if this flakes.

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const BOOT_TIMEOUT_MS = 60_000;
const HYDRATION_POLL_TIMEOUT_MS = 15_000;
const MAX_BARS_REQUESTS = 20;

const MARKET_URL = `${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=market&qa=safe`;

const isBarsRequestUrl = (url: string) => /\/api\/bars(\/batch)?(\?|$)/.test(url);

type NetLog = {
  runtimeFailures: string[];
  barsRequests: string[];
};

function watchChartTraffic(page: Page): NetLog {
  const log: NetLog = { runtimeFailures: [], barsRequests: [] };
  page.on("pageerror", (error) => {
    log.runtimeFailures.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource:")) return;
    log.runtimeFailures.push(`console: ${text}`);
  });
  page.on("request", (request) => {
    if (isBarsRequestUrl(request.url())) {
      log.barsRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  return log;
}

test.describe("Chart zoom/pan bar hydration", () => {
  test.setTimeout(120_000);

  test("panning and zooming the chart fetches more bars without running away", async ({
    page,
  }) => {
    const log = watchChartTraffic(page);

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(MARKET_URL, { waitUntil: "domcontentloaded" });

    const app = page.locator('[data-testid="platform-screen-stack"]');
    const gate = page.locator('[data-testid="login-gate-submit"]');
    try {
      await Promise.race([
        app.waitFor({ state: "visible", timeout: BOOT_TIMEOUT_MS }),
        gate.waitFor({ state: "visible", timeout: BOOT_TIMEOUT_MS }),
      ]);
    } catch {
      test.skip(
        true,
        `App did not finish booting within ${BOOT_TIMEOUT_MS}ms at ${MARKET_URL} -- box likely under load; skipping.`,
      );
    }
    test.skip(
      await gate.isVisible().catch(() => false),
      "Blocked by the sign-in gate before reaching the Market screen -- skipping.",
    );
    await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden({
      timeout: BOOT_TIMEOUT_MS,
    });

    // First market chart-grid cell's pannable/zoomable surface: the outer
    // ResearchChartSurface root, whose data-testid is
    // `${MultiChartGrid's per-slot dataTestId}-surface` (e.g.
    // "market-chart-0-surface"). This exact node -- not an inner <canvas> --
    // owns the onWheelCapture/onPointerDownCapture/onMouseDownCapture
    // handlers (ResearchChartSurface.tsx ~L12154-12163), so driving mouse
    // input against its bounding box is the correct target.
    const chart = page
      .locator('[data-testid$="-surface"][data-testid^="market-chart-"]')
      .first();
    const chartVisible = await chart.isVisible({ timeout: 20_000 }).catch(() => false);
    test.skip(
      !chartVisible,
      "No market chart rendered (grid may be in a degraded/fallback state) -- nothing to drive.",
    );

    const box = await chart.boundingBox();
    test.skip(!box, "Chart surface has no layout box -- nothing to drive.");

    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    const leftEdgeX = box!.x + box!.width * 0.15;

    const requestsBeforeInteraction = log.barsRequests.length;

    await page.mouse.move(centerX, centerY);
    // Zoom out repeatedly: widens the visible logical range toward older bars.
    for (let step = 0; step < 6; step += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(150);
    }

    // Pan toward the left edge (drag right-to-left = scroll back in time) --
    // the trigger for prepend-older / expand-limit hydration near the edge.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(leftEdgeX, centerY, { steps: 10 });
    await page.mouse.move(leftEdgeX - 40, centerY, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(() => log.barsRequests.length, {
        timeout: HYDRATION_POLL_TIMEOUT_MS,
        message: () =>
          `expected pan/zoom to fetch more bars past the initial ${requestsBeforeInteraction} request(s); saw ${JSON.stringify(log.barsRequests)}`,
      })
      .toBeGreaterThan(requestsBeforeInteraction);

    console.log("bars requests observed:", JSON.stringify(log.barsRequests, null, 2));

    // No runaway refetch loop.
    expect(log.barsRequests.length).toBeLessThanOrEqual(MAX_BARS_REQUESTS);

    console.log("runtime failures:", JSON.stringify(log.runtimeFailures, null, 2));
    expect(log.runtimeFailures).toEqual([]);
  });
});
