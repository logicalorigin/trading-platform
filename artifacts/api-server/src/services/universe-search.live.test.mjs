import assert from "node:assert/strict";
import test from "node:test";

const API_BASE_URL = stripTrailingSlash(
  process.env["TICKER_SEARCH_API_BASE_URL"] ?? "http://127.0.0.1:8080/api",
);
const BRIDGE_BASE_URL = stripTrailingSlash(
  process.env["TICKER_SEARCH_BRIDGE_BASE_URL"] ??
    process.env["IBKR_BRIDGE_URL"] ??
    "http://127.0.0.1:3002",
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

test("live API ticker search returns CAR and OPTX as fast IBKR-tradable rows", { timeout: 120_000 }, async () => {
  const cases = [
    { search: "CAR", ticker: "CAR", params: { search: "CAR", active: true, limit: 12 } },
    { search: "CAR stocks", ticker: "CAR", params: { search: "CAR", markets: "stocks", active: true, limit: 12 } },
    { search: "OPTX", ticker: "OPTX", params: { search: "OPTX", active: true, limit: 12 } },
    { search: "OPTX stocks", ticker: "OPTX", params: { search: "OPTX", markets: "stocks", active: true, limit: 12 } },
  ];

  for (const testcase of cases) {
    const { elapsedMs, payload } = await timedSearchApi(testcase.params);
    assertNoEmbeddedLogos(payload);
    const row = requireTicker(payload, { ticker: testcase.ticker, market: "stocks" });
    assertIbkrTradable(row);
    assert.ok(
      elapsedMs <= 2_500,
      `${testcase.search} should return first selectable rows within 2500ms; got ${Math.round(elapsedMs)}ms`,
    );
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
