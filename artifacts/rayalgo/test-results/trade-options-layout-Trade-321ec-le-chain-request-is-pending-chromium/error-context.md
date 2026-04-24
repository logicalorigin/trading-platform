# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: trade-options-layout.spec.ts >> Trade option chain loading state shows a spinner while chain request is pending
- Location: e2e/trade-options-layout.spec.ts:196:1

# Error details

```
Error: "page.waitForTimeout: Test ended." while running route callback.
Consider awaiting `await page.unrouteAll({ behavior: 'ignoreErrors' })`
before the end of the test to ignore remaining routes in flight.
```

# Test source

```ts
  10  |   return Array.from({ length: 80 }, (_, index) => {
  11  |     const close = basePrice + Math.sin(index / 5) * 2 + index * 0.05;
  12  |     const open = close - Math.cos(index / 3) * 0.8;
  13  |     return {
  14  |       timestamp: new Date(now - (79 - index) * 5 * 60_000).toISOString(),
  15  |       open,
  16  |       high: Math.max(open, close) + 1,
  17  |       low: Math.min(open, close) - 1,
  18  |       close,
  19  |       volume: 100_000 + index * 1_000,
  20  |       source: symbol.endsWith("C") || symbol.endsWith("P") ? "mock-option" : "mock",
  21  |     };
  22  |   });
  23  | }
  24  | 
  25  | function makeOptionContracts(expirationDate: string) {
  26  |   const expirationIndex = expirations.indexOf(expirationDate);
  27  |   const offset = expirationIndex >= 0 ? expirationIndex * 5 : 0;
  28  |   const strikes = [490 + offset, 495 + offset, 500 + offset, 505 + offset, 510 + offset];
  29  | 
  30  |   return strikes.flatMap((strike) =>
  31  |     (["call", "put"] as const).map((right) => {
  32  |       const cp = right === "call" ? "C" : "P";
  33  |       const distance = Math.abs(strike - basePrice);
  34  |       const mark = Math.max(0.35, 8 - distance * 0.4 + expirationIndex);
  35  |       return {
  36  |         contract: {
  37  |           ticker: `SPY-${expirationDate}-${strike}-${cp}`,
  38  |           underlying: "SPY",
  39  |           expirationDate,
  40  |           strike,
  41  |           right,
  42  |           multiplier: 100,
  43  |           sharesPerContract: 100,
  44  |           providerContractId: `${expirationDate}-${strike}-${cp}`,
  45  |         },
  46  |         bid: mark - 0.05,
  47  |         ask: mark + 0.05,
  48  |         last: mark,
  49  |         mark,
  50  |         impliedVolatility: 0.22 + expirationIndex * 0.01,
  51  |         delta: right === "call" ? 0.48 : -0.48,
  52  |         gamma: 0.02,
  53  |         theta: -0.03,
  54  |         vega: 0.11,
  55  |         openInterest: 1_000 + strike,
  56  |         volume: 100 + strike,
  57  |         updatedAt: new Date().toISOString(),
  58  |       };
  59  |     }),
  60  |   );
  61  | }
  62  | 
  63  | async function mockTradeApi(page: Page, { delayChainMs = 0 } = {}) {
  64  |   await page.route("**/api/**", async (route) => {
  65  |     const url = new URL(route.request().url());
  66  |     let body: unknown = {};
  67  | 
  68  |     if (url.pathname === "/api/session") {
  69  |       body = {
  70  |         configured: { ibkr: false, research: false },
  71  |         ibkrBridge: {
  72  |           authenticated: false,
  73  |           connected: false,
  74  |           liveMarketDataAvailable: false,
  75  |           transport: "client-portal",
  76  |         },
  77  |         environment: "paper",
  78  |         marketDataProviders: {},
  79  |       };
  80  |     } else if (url.pathname === "/api/watchlists") {
  81  |       body = {
  82  |         watchlists: [{ id: "default", name: "Default", isDefault: true, symbols: ["SPY"] }],
  83  |       };
  84  |     } else if (url.pathname === "/api/quotes/snapshot") {
  85  |       const requested = (url.searchParams.get("symbols") || "SPY")
  86  |         .split(",")
  87  |         .map((symbol) => symbol.trim().toUpperCase())
  88  |         .filter(Boolean);
  89  |       body = {
  90  |         quotes: requested.map((symbol) => ({
  91  |           symbol,
  92  |           price: basePrice,
  93  |           prevClose: basePrice - 2,
  94  |           change: 2,
  95  |           changePercent: 0.4,
  96  |           open: basePrice - 1,
  97  |           high: basePrice + 3,
  98  |           low: basePrice - 4,
  99  |           volume: 50_000_000,
  100 |           delayed: false,
  101 |         })),
  102 |       };
  103 |     } else if (url.pathname === "/api/options/expirations") {
  104 |       body = {
  105 |         underlying: "SPY",
  106 |         expirations: expirations.map((expirationDate) => ({ expirationDate })),
  107 |       };
  108 |     } else if (url.pathname === "/api/options/chains") {
  109 |       if (delayChainMs > 0) {
> 110 |         await page.waitForTimeout(delayChainMs);
      |                    ^ Error: "page.waitForTimeout: Test ended." while running route callback.
  111 |       }
  112 |       const expirationDate = url.searchParams.get("expirationDate") || expirations[0];
  113 |       body = {
  114 |         underlying: "SPY",
  115 |         expirationDate,
  116 |         contracts: makeOptionContracts(expirationDate),
  117 |       };
  118 |     } else if (url.pathname === "/api/bars") {
  119 |       body = { bars: makeBars(url.searchParams.get("symbol") || "SPY") };
  120 |     } else if (url.pathname === "/api/flow/events") {
  121 |       body = { events: [] };
  122 |     } else if (url.pathname === "/api/news") {
  123 |       body = { articles: [] };
  124 |     } else if (url.pathname === "/api/research/earnings-calendar") {
  125 |       body = { entries: [] };
  126 |     } else if (url.pathname === "/api/signal-monitor/profile") {
  127 |       body = { profile: { enabled: false, timeframe: "15m", watchlistId: null } };
  128 |     } else if (url.pathname === "/api/signal-monitor/state") {
  129 |       body = { states: [] };
  130 |     } else if (url.pathname === "/api/signal-monitor/events") {
  131 |       body = { events: [] };
  132 |     } else if (url.pathname === "/api/charting/pine-scripts") {
  133 |       body = { scripts: [] };
  134 |     } else if (url.pathname.includes("/streams/")) {
  135 |       await route.fulfill({ status: 204, body: "" });
  136 |       return;
  137 |     }
  138 | 
  139 |     await route.fulfill({
  140 |       status: 200,
  141 |       contentType: "application/json",
  142 |       body: JSON.stringify(body),
  143 |     });
  144 |   });
  145 | }
  146 | 
  147 | async function openTrade(page: Page) {
  148 |   await page.addInitScript(() => {
  149 |     window.localStorage.clear();
  150 |     window.sessionStorage.clear();
  151 |     window.localStorage.setItem(
  152 |       "rayalgo:state:v1",
  153 |       JSON.stringify({
  154 |         screen: "trade",
  155 |         sym: "SPY",
  156 |         theme: "dark",
  157 |         sidebarCollapsed: true,
  158 |         tradeActiveTicker: "SPY",
  159 |         tradeContracts: {
  160 |           SPY: { strike: 500, cp: "C", exp: "" },
  161 |         },
  162 |       }),
  163 |     );
  164 |   });
  165 |   await page.goto("/", { waitUntil: "domcontentloaded" });
  166 |   await expect(page.getByTestId("trade-top-zone")).toBeVisible({ timeout: 30_000 });
  167 |   await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
  168 | }
  169 | 
  170 | test("Trade swaps contract chart above options chain and removes placeholder copy", async ({ page }) => {
  171 |   await page.setViewportSize({ width: 1440, height: 1000 });
  172 |   await mockTradeApi(page);
  173 |   await openTrade(page);
  174 | 
  175 |   const topBox = await page.getByTestId("trade-top-zone").boundingBox();
  176 |   const middleBox = await page.getByTestId("trade-middle-zone").boundingBox();
  177 |   const contractBox = await page.getByTestId("trade-contract-chart-panel").boundingBox();
  178 |   const chainBox = await page.getByTestId("trade-options-chain-panel").boundingBox();
  179 | 
  180 |   expect(topBox).not.toBeNull();
  181 |   expect(middleBox).not.toBeNull();
  182 |   expect(contractBox).not.toBeNull();
  183 |   expect(chainBox).not.toBeNull();
  184 |   expect(contractBox!.y).toBeGreaterThanOrEqual(topBox!.y - 1);
  185 |   expect(contractBox!.y + contractBox!.height).toBeLessThanOrEqual(topBox!.y + topBox!.height + 1);
  186 |   expect(chainBox!.y).toBeGreaterThanOrEqual(middleBox!.y - 1);
  187 |   expect(chainBox!.y + chainBox!.height).toBeLessThanOrEqual(middleBox!.y + middleBox!.height + 1);
  188 | 
  189 |   await expect(page.getByTestId("trade-options-chain-panel").getByText("OPTIONS CHAIN")).toBeVisible();
  190 |   await expect(page.getByTestId("trade-contract-chart-panel").getByText("CONTRACT")).toBeVisible();
  191 | 
  192 |   const bodyText = await page.locator("body").innerText();
  193 |   expect(bodyText).not.toMatch(/spaceholder|schema-pending|placeholder panel|under construction|Coming Soon/i);
  194 | });
  195 | 
  196 | test("Trade option chain loading state shows a spinner while chain request is pending", async ({
  197 |   page,
  198 | }) => {
  199 |   await page.setViewportSize({ width: 1440, height: 1000 });
  200 |   await mockTradeApi(page, { delayChainMs: 1500 });
  201 |   await openTrade(page);
  202 | 
  203 |   await expect(
  204 |     page.getByTestId("trade-options-chain-panel").getByTestId("loading-spinner"),
  205 |   ).toBeVisible({ timeout: 10_000 });
  206 | });
  207 | 
```