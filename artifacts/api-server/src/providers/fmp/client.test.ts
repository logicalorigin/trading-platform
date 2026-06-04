import assert from "node:assert/strict";
import test from "node:test";
import { FmpResearchClient } from "./client";

test("FMP high-beta screener maps, dedupes, and sorts company candidates", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    const exchange = url.searchParams.get("exchange");
    return Response.json(
      exchange === "NYSE"
        ? [
            {
              symbol: "abc",
              companyName: "ABC Corp",
              beta: 2.4,
              price: 12.5,
              volume: 2_000_000,
              marketCap: 1_000_000_000,
              exchangeShortName: "NYSE",
              country: "US",
              isEtf: false,
              isActivelyTrading: true,
            },
            {
              symbol: "DUP",
              companyName: "Duplicate Low Beta",
              beta: 1.8,
              price: 20,
              volume: 1_000_000,
              marketCap: 900_000_000,
              exchangeShortName: "NYSE",
              country: "US",
              isEtf: false,
              isActivelyTrading: true,
            },
          ]
        : [
            {
              symbol: "dup",
              companyName: "Duplicate High Beta",
              beta: 3.1,
              price: 22,
              volume: 1_500_000,
              marketCap: 1_100_000_000,
              exchangeShortName: "NASDAQ",
              country: "US",
              isEtf: false,
              isActivelyTrading: true,
            },
            {
              symbol: "BAD",
              companyName: "Bad Beta",
              beta: null,
              price: 10,
              volume: 1_000_000,
              marketCap: 300_000_000,
              exchangeShortName: "NASDAQ",
              country: "US",
              isEtf: false,
              isActivelyTrading: true,
            },
          ],
    );
  }) as typeof fetch;

  try {
    const client = new FmpResearchClient({
      apiKey: "test-key",
      baseUrl: "https://financialmodelingprep.com/stable",
    });
    const candidates = await client.getHighBetaScreenerCandidates({
      exchanges: ["NYSE", "NASDAQ"],
      limit: 50,
      betaMoreThan: 1,
      priceMoreThan: 5,
      volumeMoreThan: 100_000,
      marketCapMoreThan: 250_000_000,
      country: "US",
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.symbol),
      ["DUP", "ABC"],
    );
    assert.equal(candidates[0]?.beta, 3.1);
    assert.equal(candidates[0]?.name, "Duplicate High Beta");
    assert.equal(candidates[0]?.source, "fmp-company-screener");
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0]?.pathname, "/stable/company-screener");
    assert.equal(requestedUrls[0]?.searchParams.get("exchange"), "NYSE");
    assert.equal(requestedUrls[0]?.searchParams.get("country"), "US");
    assert.equal(requestedUrls[0]?.searchParams.get("betaMoreThan"), "1");
    assert.equal(requestedUrls[0]?.searchParams.get("priceMoreThan"), "5");
    assert.equal(requestedUrls[0]?.searchParams.get("volumeMoreThan"), "100000");
    assert.equal(
      requestedUrls[0]?.searchParams.get("marketCapMoreThan"),
      "250000000",
    );
    assert.equal(requestedUrls[0]?.searchParams.get("isActivelyTrading"), "true");
    assert.equal(requestedUrls[0]?.searchParams.get("limit"), "50");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
