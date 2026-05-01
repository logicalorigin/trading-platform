import assert from "node:assert/strict";
import test from "node:test";

const API_BASE_URL = stripTrailingSlash(
  process.env["TICKER_SEARCH_API_BASE_URL"] ?? "http://127.0.0.1:8080/api",
);
const BRIDGE_BASE_URL = stripTrailingSlash(
  process.env["TICKER_SEARCH_BRIDGE_BASE_URL"] ?? "http://127.0.0.1:3002",
);
const REQUEST_TIMEOUT_MS = Number(
  process.env["TICKER_SEARCH_LIVE_TEST_TIMEOUT_MS"] ?? "30000",
);

const MARKET_CASES = [
  { market: "stocks", search: "AAPL", ticker: "AAPL" },
  { market: "etf", search: "SPY", ticker: "SPY" },
  { market: "indices", search: "SPX", ticker: "SPX" },
  { market: "futures", search: "ES", ticker: "ES" },
  { market: "fx", search: "EUR", ticker: "EUR" },
  { market: "crypto", search: "BTC", ticker: "BTC" },
  { market: "otc", search: "TCEHY", ticker: "TCEHY" },
];
const FAST_BROAD_TICKER_CASES = [
  { search: "AAPL", ticker: "AAPL", market: "stocks" },
  { search: "SPY", ticker: "SPY", market: "etf" },
  { search: "SPX", ticker: "SPX", market: "indices" },
  { search: "ES", ticker: "ES", market: "futures" },
  { search: "EUR", ticker: "EUR", market: "fx" },
  { search: "BTC", ticker: "BTC", market: "crypto" },
  { search: "TCEHY", ticker: "TCEHY", market: "otc" },
  { search: "CAR", ticker: "CAR", market: "stocks" },
  { search: "OPTX", ticker: "OPTX", market: "stocks" },
];
const SMART_INPUT_CASES = [
  { search: "$SPX", ticker: "SPX", market: "indices", markets: "indices" },
  { search: "^VIX", ticker: "VIX", market: "indices", markets: "indices" },
  { search: "EURUSD", ticker: "EUR", market: "fx", markets: "fx" },
  { search: "EUR.USD", ticker: "EUR", market: "fx", markets: "fx" },
  { search: "BTCUSD", ticker: "BTC", market: "crypto", markets: "crypto" },
  { search: "BRK.B", ticker: "BRK.B", market: "stocks", markets: "stocks" },
];

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function searchUrl(baseUrl, path, params) {
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchJson(label, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${label} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function searchApi(params) {
  return fetchJson(
    `api search ${JSON.stringify(params)}`,
    searchUrl(API_BASE_URL, "/universe/tickers", params),
  );
}

async function timedSearchApi(params) {
  const startedAt = performance.now();
  const payload = await searchApi(params);
  return {
    elapsedMs: performance.now() - startedAt,
    payload,
  };
}

async function searchBridge(params) {
  return fetchJson(
    `bridge search ${JSON.stringify(params)}`,
    searchUrl(BRIDGE_BASE_URL, "/universe/search", params),
  );
}

function requireTicker(
  payload,
  expected,
) {
  const row = payload.results.find(
    (candidate) =>
      candidate.ticker === expected.ticker && candidate.market === expected.market,
  );

  assert.ok(
    row,
    `expected ${expected.ticker} ${expected.market}; got ${payload.results
      .map((candidate) => `${candidate.ticker}:${candidate.market}`)
      .join(", ")}`,
  );
  return row;
}

function assertIbkrTradable(row) {
  assert.ok(row.providers?.includes("ibkr"), `${row.ticker} should include IBKR provider`);
  assert.equal(row.tradeProvider, "ibkr", `${row.ticker} should prefer IBKR for trading`);
  assert.ok(row.providerContractId, `${row.ticker} should include an IBKR providerContractId`);
}

function assertNoEmbeddedLogos(payload) {
  for (const row of payload.results) {
    assert.ok(
      !row.logoUrl?.startsWith("data:"),
      `${row.ticker} should not embed base64/data URL logos in search responses`,
    );
  }
}

function assertTopTicker(payload, expected) {
  const [first] = payload.results;
  assert.ok(first, `expected ${expected.ticker} ${expected.market} to be the top result`);
  assert.equal(
    first.ticker,
    expected.ticker,
    `expected top ticker ${expected.ticker}; got ${first.ticker}:${first.market}`,
  );
  assert.equal(
    first.market,
    expected.market,
    `expected top market ${expected.market}; got ${first.ticker}:${first.market}`,
  );
}

test("live IBKR bridge search returns every supported ticker market", { timeout: 180_000 }, async () => {
  for (const testcase of MARKET_CASES) {
    const payload = await searchBridge({
      search: testcase.search,
      markets: testcase.market,
      limit: 20,
    });
    const row = requireTicker(payload, testcase);
    assertIbkrTradable(row);
  }
});

test("live API search returns every market and preserves IBKR trade context", { timeout: 180_000 }, async () => {
  for (const testcase of MARKET_CASES) {
    const payload = await searchApi({
      search: testcase.search,
      markets: testcase.market,
      active: true,
      limit: 20,
    });
    const row = requireTicker(payload, testcase);
    assertIbkrTradable(row);
  }
});

test("live API ticker search keeps no-filter exact searches fast across the searchable universe", { timeout: 180_000 }, async () => {
  for (const testcase of FAST_BROAD_TICKER_CASES) {
    const { elapsedMs, payload } = await timedSearchApi({
      search: testcase.search,
      active: true,
      limit: 12,
    });
    assertNoEmbeddedLogos(payload);
    const row = requireTicker(payload, testcase);
    assertIbkrTradable(row);
    assertTopTicker(payload, testcase);
    assert.ok(
      elapsedMs <= 2_500,
      `${testcase.search} should return first selectable rows within 2500ms; got ${Math.round(elapsedMs)}ms`,
    );
  }
});

test("live API ticker search normalizes smart input variants", { timeout: 180_000 }, async () => {
  for (const testcase of SMART_INPUT_CASES) {
    const payload = await searchApi({
      search: testcase.search,
      markets: testcase.markets,
      active: true,
      limit: 12,
    });
    const row = requireTicker(payload, testcase);
    assertIbkrTradable(row);
    assertNoEmbeddedLogos(payload);
  }
});

test("live API ticker search keeps shared equities IBKR-tradable", { timeout: 60_000 }, async () => {
  const payload = await searchApi({
    search: "AAPL",
    markets: "stocks",
    active: true,
    limit: 10,
  });
  const row = requireTicker(payload, { ticker: "AAPL", market: "stocks" });

  assert.ok(row.providers?.includes("ibkr"), "AAPL should include IBKR");
  assert.equal(row.tradeProvider, "ibkr");
  assert.ok(row.providerContractId);
  assertNoEmbeddedLogos(payload);
});

test("live API strict trade resolution rejects fuzzy ticker substitutions", { timeout: 120_000 }, async () => {
  for (const testcase of [
    { search: "BITF", forbidden: ["FUFU", "FUFUW"] },
    { search: "X", forbidden: ["OPTX", "XBIO"] },
  ]) {
    const payload = await searchApi({
      search: testcase.search,
      markets: "stocks,etf,otc",
      active: true,
      limit: 8,
      mode: "trade-resolve",
      strictTrade: true,
    });

    for (const row of payload.results) {
      assert.equal(
        row.ticker,
        testcase.search,
        `strict ${testcase.search} should only return exact matches; got ${row.ticker}`,
      );
      assertIbkrTradable(row);
      assert.ok(
        !testcase.forbidden.includes(row.ticker),
        `strict ${testcase.search} should not return fuzzy ${row.ticker}`,
      );
    }
  }
});

test("live API ticker search resolves ticker, company name, ISIN, and IBKR conid", { timeout: 120_000 }, async () => {
  const tickerPayload = await searchApi({
    search: "AAPL",
    markets: "stocks",
    active: true,
    limit: 10,
  });
  requireTicker(tickerPayload, { ticker: "AAPL", market: "stocks" });

  const companyPayload = await searchApi({
    search: "Apple",
    markets: "stocks",
    active: true,
    limit: 10,
  });
  requireTicker(companyPayload, { ticker: "AAPL", market: "stocks" });
  assertTopTicker(companyPayload, { ticker: "AAPL", market: "stocks" });

  const isinPayload = await searchApi({
    search: "US0378331005",
    markets: "stocks",
    active: true,
    limit: 10,
  });
  const isinRow = requireTicker(isinPayload, { ticker: "AAPL", market: "stocks" });
  assert.equal(isinRow.contractMeta?.["identifierMatch"], true);

  const conidPayload = await searchApi({
    search: "265598",
    markets: "stocks",
    active: true,
    limit: 10,
  });
  const conidRow = requireTicker(conidPayload, { ticker: "AAPL", market: "stocks" });
  assert.equal(conidRow.contractMeta?.["identifierMatch"], true);
  assert.equal(conidRow.providerContractId, "265598");
});
