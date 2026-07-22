import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMassiveProviderUrl,
  MassiveMarketDataClient,
} from "./market-data";

const config = {
  apiKey: "dont-log-me",
  baseUrl: "https://api.massive.com/proxy",
};

test("Massive URLs stay on the configured origin", () => {
  const url = buildMassiveProviderUrl(config, "/v2/aggs", { cursor: "next" });
  assert.equal(url.pathname, "/proxy/v2/aggs");
  assert.equal(url.searchParams.get("apiKey"), config.apiKey);
  assert.throws(
    () => buildMassiveProviderUrl(config, "https://evil.invalid/page"),
    /changed origin/,
  );
  assert.throws(
    () => buildMassiveProviderUrl(config, "http://api.massive.com/page"),
    /changed origin/,
  );
  assert.throws(
    () => buildMassiveProviderUrl(config, "../admin"),
    /left configured base path/,
  );
  assert.throws(
    () => buildMassiveProviderUrl(config, "https://api.massive.com/admin"),
    /left configured base path/,
  );
});

test("Massive failures do not expose the API key", async (t) => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.redirect, "error");
    return new Response(`request URL contained apiKey=${config.apiKey}`, {
      status: 400,
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  await assert.rejects(
    new MassiveMarketDataClient(config).getQuoteSnapshots(["SPY"]),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.doesNotMatch(`${error}\n${JSON.stringify(error)}`, /dont-log-me/);
      return true;
    },
  );
});

test("Massive request cancellation remains an AbortError", async (t) => {
  const priorFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => {
    throw new DOMException(`aborted ${config.apiKey}`, "AbortError");
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  await assert.rejects(
    new MassiveMarketDataClient(config).getUniverseTickerByTicker(
      "SPY",
      controller.signal,
    ),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "AbortError");
      assert.doesNotMatch(error.message, /dont-log-me/);
      return true;
    },
  );
});

test("Massive keeps the premium multiplier separate from an adjusted deliverable", async (t) => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      results: {
        details: {
          ticker: "O:BMNG1260717P00011000",
          underlying_ticker: "BMNG",
          expiration_date: "2026-07-17",
          strike_price: 11,
          contract_type: "put",
          shares_per_contract: 5,
        },
        last_quote: {
          bid: 9.7,
          ask: 11.2,
          bid_size: 273,
          ask_size: 13,
        },
      },
    });
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  const contract = await new MassiveMarketDataClient(
    config,
  ).getOptionContractSnapshot({
    underlying: "BMNG",
    optionTicker: "O:BMNG1260717P00011000",
  });

  assert.equal(contract?.contract.multiplier, 100);
  assert.equal(contract?.contract.sharesPerContract, 5);
  assert.equal(contract?.bidSize, 273);
  assert.equal(contract?.askSize, 13);
});

test("Massive option snapshots preserve stable eligible last-trade provenance", async (t) => {
  const priorFetch = globalThis.fetch;
  let conditionRequests = 0;
  let snapshotRequests = 0;
  const timestamps = [
    "1784177000123456000",
    "1784177000123456000",
    "1784177001123456000",
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    if (url.pathname.endsWith("/v3/reference/conditions")) {
      conditionRequests += 1;
      return Response.json({
        results: [
          {
            id: 209,
            name: "Automatic Execution",
            update_rules: {
              consolidated: {
                updates_high_low: true,
                updates_open_close: true,
                updates_volume: true,
              },
            },
          },
        ],
      });
    }
    const sipTimestamp = timestamps[snapshotRequests] ?? timestamps.at(-1);
    snapshotRequests += 1;
    return Response.json({
      results: {
        details: {
          ticker: "O:SPY260717P00620000",
          underlying_ticker: "SPY",
          expiration_date: "2026-07-17",
          strike_price: 620,
          contract_type: "put",
          shares_per_contract: 100,
        },
        last_quote: { bid: 0.9, ask: 1.1 },
        last_trade: {
          price: 0.95,
          size: 2,
          exchange: 316,
          sip_timestamp: sipTimestamp,
          conditions: [209],
        },
      },
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  const client = new MassiveMarketDataClient(config);
  const input = {
    underlying: "SPY",
    optionTicker: "O:SPY260717P00620000",
  };
  const [first, repeated] = await Promise.all([
    client.getOptionContractSnapshot(input),
    client.getOptionContractSnapshot(input),
  ]);
  const changed = await client.getOptionContractSnapshot(input);

  assert.equal(first?.lastTrade?.provider, "massive");
  assert.equal(first?.lastTrade?.price, 0.95);
  assert.equal(first?.lastTrade?.size, 2);
  assert.equal(
    first?.lastTrade?.occurredAt.toISOString(),
    "2026-07-16T04:43:20.123Z",
  );
  assert.equal(first?.lastTrade?.eligible, true);
  assert.deepEqual(first?.lastTrade?.conditionCodes, ["209"]);
  assert.ok(first?.lastTrade?.identity);
  assert.equal(repeated?.lastTrade?.identity, first?.lastTrade?.identity);
  assert.notEqual(changed?.lastTrade?.identity, first?.lastTrade?.identity);
  assert.equal(conditionRequests, 1, "condition metadata should be cached");
});

test("Massive keeps a known non-regular trade ineligible alongside an unknown code", async (t) => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    if (url.pathname.endsWith("/v3/reference/conditions")) {
      return Response.json({
        results: [
          {
            id: 248,
            name: "Extended Hours Trade",
            update_rules: {
              consolidated: {
                updates_high_low: false,
                updates_open_close: false,
                updates_volume: true,
              },
            },
          },
        ],
      });
    }
    return Response.json({
      results: {
        details: {
          ticker: "O:SPY260717P00620000",
          underlying_ticker: "SPY",
          expiration_date: "2026-07-17",
          strike_price: 620,
          contract_type: "put",
        },
        last_quote: { bid: 0.9, ask: 1.1 },
        last_trade: {
          price: 0.95,
          size: 2,
          sip_timestamp: "1784177000123456000",
          conditions: [248, 999],
        },
      },
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  const contract = await new MassiveMarketDataClient(
    config,
  ).getOptionContractSnapshot({
    underlying: "SPY",
    optionTicker: "O:SPY260717P00620000",
  });

  assert.equal(contract?.lastTrade?.eligible, false);
  assert.deepEqual(contract?.lastTrade?.conditionCodes, ["248", "999"]);
});

test("Massive preserves unavailable condition eligibility as unknown", async (t) => {
  const priorFetch = globalThis.fetch;
  let conditionRequests = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    if (url.pathname.endsWith("/v3/reference/conditions")) {
      conditionRequests += 1;
      throw new Error("condition metadata unavailable");
    }
    return Response.json({
      results: {
        details: {
          ticker: "O:SPY260717P00620000",
          underlying_ticker: "SPY",
          expiration_date: "2026-07-17",
          strike_price: 620,
          contract_type: "put",
        },
        last_quote: { bid: 0.9, ask: 1.1 },
        last_trade: {
          price: 0.95,
          size: 2,
          sip_timestamp: "1784177000123456000",
          conditions: [209],
        },
      },
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  const client = new MassiveMarketDataClient(config);
  const input = {
    underlying: "SPY",
    optionTicker: "O:SPY260717P00620000",
  };
  const contract = await client.getOptionContractSnapshot(input);
  const repeated = await client.getOptionContractSnapshot(input);

  assert.equal(contract?.lastTrade?.eligible, null);
  assert.equal(repeated?.lastTrade?.eligible, null);
  assert.equal(conditionRequests, 1, "metadata failures should be backoff-cached");
});

test("Massive logos are capped by streamed bytes", async (t) => {
  const priorFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    assert.equal(init?.redirect, "error");
    if (requests === 1) {
      return Response.json({
        results: {
          branding: {
            logo_url: "https://api.massive.com/proxy/v1/reference/logo",
          },
        },
      });
    }
    return new Response(new Uint8Array(250_001), {
      headers: { "content-type": "image/png" },
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  assert.equal(
    await new MassiveMarketDataClient(config).getTickerLogoUrl("SPY"),
    null,
  );
  assert.equal(requests, 2);
});
