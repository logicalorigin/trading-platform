import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import {
  buildMassiveDirectUrl,
  fetchMassiveDirectJson,
  resolveOptionContractForSignal,
} from "./index";

function configureMassive(
  t: TestContext,
  baseUrl = "https://api.massive.com",
): void {
  const priorKey = process.env.MASSIVE_API_KEY;
  const priorFallbackKey = process.env.MASSIVE_MARKET_DATA_API_KEY;
  const priorBaseUrl = process.env.MASSIVE_API_BASE_URL;
  process.env.MASSIVE_API_KEY = "secret";
  delete process.env.MASSIVE_MARKET_DATA_API_KEY;
  process.env.MASSIVE_API_BASE_URL = baseUrl;
  t.after(() => {
    if (priorKey === undefined) delete process.env.MASSIVE_API_KEY;
    else process.env.MASSIVE_API_KEY = priorKey;
    if (priorFallbackKey === undefined) {
      delete process.env.MASSIVE_MARKET_DATA_API_KEY;
    } else {
      process.env.MASSIVE_MARKET_DATA_API_KEY = priorFallbackKey;
    }
    if (priorBaseUrl === undefined) delete process.env.MASSIVE_API_BASE_URL;
    else process.env.MASSIVE_API_BASE_URL = priorBaseUrl;
  });
}

function replaceFetch(
  t: TestContext,
  implementation: typeof globalThis.fetch,
): void {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = priorFetch;
  });
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function isoDatePlusDays(value: Date, days: number): string {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) +
      days * 24 * 60 * 60 * 1_000,
  )
    .toISOString()
    .slice(0, 10);
}

test("Massive pagination stays on the configured origin and base path", (t) => {
  configureMassive(t);

  const url = buildMassiveDirectUrl(
    "https://api.massive.com/v2/aggs?cursor=next",
    {},
  );
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.throws(
    () => buildMassiveDirectUrl("https://evil.invalid/page", {}),
    /changed origin/,
  );
  assert.throws(
    () => buildMassiveDirectUrl("http://api.massive.com/page", {}),
    /changed origin/,
  );

  process.env.MASSIVE_API_BASE_URL = "https://api.massive.com/proxy";
  assert.equal(
    buildMassiveDirectUrl("/v2/aggs", {}).pathname,
    "/proxy/v2/aggs",
  );
  assert.equal(
    buildMassiveDirectUrl(
      "https://api.massive.com/proxy/v3/reference/options/contracts?cursor=next",
      {},
    ).pathname,
    "/proxy/v3/reference/options/contracts",
  );
  assert.throws(
    () => buildMassiveDirectUrl("https://api.massive.com/outside", {}),
    /left configured base path/,
  );
  assert.throws(
    () => buildMassiveDirectUrl("https://api.massive.com/proxy-escape", {}),
    /left configured base path/,
  );
});

test("Massive HTTP errors are not retried or allowed to expose the API key", async (t) => {
  let attempts = 0;
  replaceFetch(t, async (_input, init) => {
    attempts += 1;
    assert.equal(init?.redirect, "error");
    return new Response("request failed: apiKey=dont-log-me", { status: 400 });
  });

  await assert.rejects(
    fetchMassiveDirectJson(
      new URL("https://api.massive.com/?apiKey=dont-log-me"),
    ),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.doesNotMatch(error.message, /dont-log-me/);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("Massive retries a throttled request and preserves redirect denial", async (t) => {
  let attempts = 0;
  replaceFetch(t, async (_input, init) => {
    attempts += 1;
    assert.equal(init?.redirect, "error");
    return attempts === 1
      ? new Response(null, {
          status: 429,
          headers: { "retry-after": "0.001" },
        })
      : jsonResponse({ status: "ok" });
  });

  assert.deepEqual(
    await fetchMassiveDirectJson(
      new URL("https://api.massive.com/v3/reference"),
    ),
    { status: "ok" },
  );
  assert.equal(attempts, 2);
});

test("direct option resolution preserves Massive queries, pagination, mapping, and later deduplication", async (t) => {
  configureMassive(t);
  const requestedUrls: URL[] = [];
  const pages = [
    {
      results: [
        {
          details: {
            ticker: "O:BRK.B260615C00095000",
            underlying_ticker: "BRK-B",
            expiration_date: "2026-06-15",
            strike_price: 95,
            contract_type: "call",
          },
        },
        {
          expiration_date: "2026-06-15",
          strike_price: 100,
          contract_type: "call",
        },
        {
          ticker: "BAD_DATE",
          expiration_date: "not-a-date",
          strike_price: 100,
          contract_type: "call",
        },
        {
          ticker: "BAD_STRIKE",
          expiration_date: "2026-06-15",
          strike_price: "nope",
          contract_type: "call",
        },
        {
          ticker: "BAD_NULL_STRIKE",
          expiration_date: "2026-06-15",
          strike_price: null,
          contract_type: "call",
        },
        {
          ticker: "BAD_ARRAY_STRIKE",
          expiration_date: "2026-06-15",
          strike_price: [100],
          contract_type: "call",
        },
        {
          ticker: "BAD_ZERO_STRIKE",
          expiration_date: "2026-06-15",
          strike_price: 0,
          contract_type: "call",
        },
        {
          ticker: "BAD_RIGHT",
          expiration_date: "2026-06-15",
          strike_price: 100,
          contract_type: "future",
        },
      ],
      next_url:
        "https://api.massive.com/v3/reference/options/contracts?cursor=active-2",
    },
    {
      results: [
        {
          ticker: "O:BRK.B260615C00100000",
          underlying_ticker: "BRK.B",
          expiration_date: "2026-06-15",
          strike_price: "100",
          contract_type: "c",
          shares_per_contract: 100,
          provider_contract_id: "active-version",
        },
      ],
    },
    {
      results: [
        {
          details: {
            ticker: "O:BRK.B260615C00100000",
            underlying_ticker: "BRK B",
            expiration_date: "2026-06-15",
            strike_price: 100,
            contract_type: "call",
            shares_per_contract: "5",
            provider_contract_id: "expired-version",
          },
        },
      ],
      next_url:
        "https://api.massive.com/v3/reference/options/contracts?cursor=expired-2",
    },
    {
      results: [
        {
          ticker: "O:BRK.B260615C00110000",
          underlying_ticker: "BRK.B",
          expiration_date: "2026-06-15",
          strike_price: 110,
          contract_type: "call",
        },
      ],
    },
  ];
  replaceFetch(t, async (input, init) => {
    assert.equal(init?.redirect, "error");
    requestedUrls.push(new URL(String(input)));
    const page = pages[requestedUrls.length - 1];
    assert.ok(page, "unexpected Massive page request");
    return jsonResponse(page);
  });

  const occurredAt = new Date("2026-06-08T13:30:00.000Z");
  const resolved = await resolveOptionContractForSignal({
    underlying: " brk-b ",
    occurredAt,
    right: "call",
    spotPrice: 100,
    contractPresetId: "atm_weekly",
  });

  assert.equal(requestedUrls.length, 4);
  for (const [index, expired] of [false, true].entries()) {
    const url = requestedUrls[index * 2];
    assert.ok(url);
    assert.equal(url.pathname, "/v3/reference/options/contracts");
    assert.equal(url.searchParams.get("underlying_ticker"), "BRK.B");
    assert.equal(url.searchParams.get("as_of"), "2026-06-08");
    assert.equal(url.searchParams.get("contract_type"), "call");
    assert.equal(url.searchParams.get("expired"), String(expired));
    assert.equal(url.searchParams.get("order"), "asc");
    assert.equal(url.searchParams.get("sort"), "expiration_date");
    assert.equal(url.searchParams.get("limit"), "1000");
    assert.equal(url.searchParams.get("expiration_date.gte"), "2026-06-08");
    assert.equal(
      url.searchParams.get("expiration_date.lte"),
      isoDatePlusDays(occurredAt, 81),
    );
    assert.equal(url.searchParams.get("apiKey"), "secret");
  }
  assert.equal(requestedUrls[1]?.searchParams.get("cursor"), "active-2");
  assert.equal(requestedUrls[3]?.searchParams.get("cursor"), "expired-2");
  assert.equal(resolved?.ticker, "O:BRK.B260615C00100000");
  assert.equal(resolved?.underlying, "BRK.B");
  assert.equal(
    resolved?.expirationDate.toISOString(),
    "2026-06-15T00:00:00.000Z",
  );
  assert.equal(resolved?.strike, 100);
  assert.equal(resolved?.right, "call");
  assert.equal(resolved?.multiplier, 5);
  assert.equal(resolved?.sharesPerContract, 5);
  assert.equal(resolved?.providerContractId, "expired-version");
  assert.equal(resolved?.contractPresetId, "atm_weekly");
  assert.equal(resolved?.dte, 5);
});

test("direct option resolution uses the profile horizon and defaults its contract size", async (t) => {
  configureMassive(t);
  const requestedUrls: URL[] = [];
  replaceFetch(t, async (input) => {
    requestedUrls.push(new URL(String(input)));
    return jsonResponse({
      results:
        requestedUrls.length === 1
          ? [
              {
                ticker: "O:SPY260615P00600000",
                underlying_ticker: "SPY",
                expiration_date: "2026-06-15",
                strike_price: 600,
                contract_type: "put",
                shares_per_contract: null,
              },
            ]
          : [],
    });
  });
  const occurredAt = new Date("2026-06-08T13:30:00.000Z");

  const resolved = await resolveOptionContractForSignal({
    underlying: "SPY",
    occurredAt,
    right: "put",
    spotPrice: 600,
    signalOptionsProfile: resolveSignalOptionsExecutionProfile({
      optionSelection: {
        minDte: 1,
        targetDte: 40,
        maxDte: 45,
      },
    }),
  });

  assert.equal(requestedUrls.length, 2);
  assert.equal(
    requestedUrls[0]?.searchParams.get("expiration_date.lte"),
    isoDatePlusDays(occurredAt, 105),
  );
  assert.equal(resolved?.multiplier, 100);
  assert.equal(resolved?.sharesPerContract, 100);
});

test("direct option resolution returns null for empty provider results", async (t) => {
  configureMassive(t);
  let attempts = 0;
  replaceFetch(t, async () => {
    attempts += 1;
    return jsonResponse({ results: [] });
  });

  assert.equal(
    await resolveOptionContractForSignal({
      underlying: "SPY",
      occurredAt: new Date("2026-06-08T13:30:00.000Z"),
      right: "call",
      spotPrice: 600,
    }),
    null,
  );
  assert.equal(attempts, 2);
});

test("direct option resolution propagates provider failures", async (t) => {
  configureMassive(t);
  let attempts = 0;
  replaceFetch(t, async () => {
    attempts += 1;
    return new Response(null, { status: 400 });
  });

  await assert.rejects(
    resolveOptionContractForSignal({
      underlying: "SPY",
      occurredAt: new Date("2026-06-08T13:30:00.000Z"),
      right: "call",
      spotPrice: 600,
    }),
    /Massive request failed with 400/,
  );
  assert.equal(attempts, 1);
});

test("direct option resolution rejects invalid inputs before fetching", async (t) => {
  configureMassive(t);
  let attempts = 0;
  replaceFetch(t, async () => {
    attempts += 1;
    return jsonResponse({ results: [] });
  });
  const valid = {
    underlying: "SPY",
    occurredAt: new Date("2026-06-08T13:30:00.000Z"),
    right: "call" as const,
    spotPrice: 600,
  };

  for (const input of [
    { ...valid, underlying: "   " },
    { ...valid, occurredAt: new Date("invalid") },
    { ...valid, right: "other" as "call" },
    { ...valid, spotPrice: 0 },
    { ...valid, spotPrice: Number.NaN },
  ]) {
    await assert.rejects(
      resolveOptionContractForSignal(input),
      /valid|positive/,
    );
  }
  assert.equal(attempts, 0);
});
