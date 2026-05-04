import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const liveFlowEnabled = process.env.RAYALGO_LIVE_MARKET_FLOW === "1";
const liveSymbols = (process.env.RAYALGO_LIVE_MARKET_FLOW_SYMBOLS || "SPY,QQQ,AAPL")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean)
  .slice(0, 6);

type JsonRecord = Record<string, any>;

async function fetchJsonOrNull(request: APIRequestContext, path: string) {
  try {
    const response = await request.get(path, {
      headers: { Accept: "application/json" },
      timeout: 20_000,
    });
    if (!response.ok()) {
      return null;
    }
    return (await response.json()) as JsonRecord;
  } catch {
    return null;
  }
}

async function seedMarketWorkspace(page: Page) {
  await page.addInitScript((symbols) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: symbols[0] || "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        marketUnusualThreshold: 2,
        marketGridLayout: symbols.length >= 4 ? "2x2" : "1x1",
        marketGridSlots: symbols.map((ticker: string) => ({
          ticker,
          tf: "15m",
          market: "stocks",
          provider: "ibkr",
          tradeProvider: "ibkr",
          studies: ["ema21", "vwap", "rayReplica"],
        })),
      }),
    );
  }, liveSymbols);
}

test.describe("live Market unusual-flow validation", () => {
  test.skip(
    !liveFlowEnabled,
    "Set RAYALGO_LIVE_MARKET_FLOW=1 to run read-only live IBKR flow validation.",
  );

  test("Market charts request IBKR unusual flow without Polygon fallback", async ({
    page,
    request,
  }) => {
    test.skip(liveSymbols.length === 0, "No live flow symbols configured.");

    const lineUsageBefore = await fetchJsonOrNull(
      request,
      "/api/settings/ibkr-line-usage",
    );
    const flowResponses: Array<{ url: string; body: JsonRecord }> = [];

    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (url.pathname !== "/api/flow/events" || !response.ok()) {
        return;
      }
      try {
        flowResponses.push({
          url: response.url(),
          body: (await response.json()) as JsonRecord,
        });
      } catch {
        // Ignore non-JSON failures; the assertions below fail if no usable response arrives.
      }
    });

    await seedMarketWorkspace(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("market-chart-grid")).toBeVisible({
      timeout: 45_000,
    });

    await expect
      .poll(
        () =>
          flowResponses.filter((entry) => {
            const params = new URL(entry.url).searchParams;
            return (
              params.get("scope") === "unusual" &&
              Number(params.get("limit") || "0") >= 80
            );
          }).length,
        { timeout: 75_000, message: "chart unusual-flow responses" },
      )
      .toBeGreaterThan(0);

    const chartFlowResponses = flowResponses.filter((entry) => {
      const params = new URL(entry.url).searchParams;
      return (
        params.get("scope") === "unusual" &&
        Number(params.get("limit") || "0") >= 80
      );
    });
    const fallbackResponses = chartFlowResponses.filter(
      ({ body }) => body?.source?.provider === "polygon" || body?.source?.fallbackUsed,
    );
    expect(fallbackResponses, "Market chart flow must not use Polygon fallback").toEqual([]);
    expect(
      chartFlowResponses.some(({ body }) => body?.source?.provider === "ibkr"),
      "at least one chart flow response should be sourced from IBKR",
    ).toBe(true);

    const firstStrip = page.getByTestId("market-premium-flow-strip").first();
    await expect(firstStrip).toBeVisible();
    await expect
      .poll(() => firstStrip.getAttribute("data-flow-source-provider"), {
        timeout: 45_000,
      })
      .toBe("IBKR");
    await expect(firstStrip).toHaveAttribute("data-flow-fallback-used", "false");

    const returnedEventCount = chartFlowResponses.reduce(
      (sum, { body }) => sum + (Array.isArray(body?.events) ? body.events.length : 0),
      0,
    );
    if (returnedEventCount > 0) {
      await expect(page.locator('[data-testid*="surface-chart-event"]').first()).toBeVisible({
        timeout: 30_000,
      });
    }

    const lineUsageAfter = await fetchJsonOrNull(
      request,
      "/api/settings/ibkr-line-usage",
    );
    const admission = lineUsageAfter?.admission;
    const flowUsed = Number(admission?.flowScannerLineCount);
    const flowCap = Number(admission?.budget?.flowScannerLineCap);
    if (Number.isFinite(flowUsed) && Number.isFinite(flowCap)) {
      expect(flowUsed, "flow scanner line usage should stay within its pool").toBeLessThanOrEqual(
        flowCap,
      );
    }

    test.info().attach("live-flow-summary", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          symbols: liveSymbols,
          chartFlowRequestCount: chartFlowResponses.length,
          returnedEventCount,
          lineUsageBefore,
          lineUsageAfter,
        },
        null,
        2,
      ),
    });
  });
});
