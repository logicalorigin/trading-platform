import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  getResearchCalendar,
  getResearchEarningsEvents,
  resetResearchEarningsEventCacheForTests,
} from "./research";

const originalFetch = globalThis.fetch;
const originalFmpApiKey = process.env.FMP_API_KEY;
const originalFmpBaseUrl = process.env.FMP_BASE_URL;

const currentMonthIsoDate = (dayPreference: number) => {
  const now = new Date();
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.max(1, Math.min(lastDay, dayPreference));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day))
    .toISOString()
    .slice(0, 10);
};

beforeEach(() => {
  resetResearchEarningsEventCacheForTests();
  process.env.FMP_API_KEY = "test-fmp-key";
  process.env.FMP_BASE_URL = "https://fmp.test/stable";
});

afterEach(() => {
  resetResearchEarningsEventCacheForTests();
  globalThis.fetch = originalFetch;
  if (originalFmpApiKey === undefined) {
    delete process.env.FMP_API_KEY;
  } else {
    process.env.FMP_API_KEY = originalFmpApiKey;
  }
  if (originalFmpBaseUrl === undefined) {
    delete process.env.FMP_BASE_URL;
  } else {
    process.env.FMP_BASE_URL = originalFmpBaseUrl;
  }
});

test("getResearchEarningsEvents fetches and caches monthly FMP chunks", async () => {
  const eventDate = currentMonthIsoDate(18);
  const calls: URL[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(input.toString());
    calls.push(url);
    assert.equal(url.pathname, "/stable/earnings-calendar");
    assert.equal(url.searchParams.get("from")?.slice(0, 7), eventDate.slice(0, 7));
    assert.equal(url.searchParams.get("to")?.slice(0, 7), eventDate.slice(0, 7));

    return new Response(
      JSON.stringify([
        {
          symbol: "NVDA",
          date: eventDate,
          time: "amc",
          epsEstimated: 5.22,
          eps: 5.48,
          revenueEstimated: 38_000_000_000,
          revenue: 39_300_000_000,
          fiscalDateEnding: eventDate,
          period: "Q1",
        },
        {
          symbol: "AAPL",
          date: eventDate,
          time: "bmo",
          epsEstimated: 1.45,
          revenueEstimated: 94_000_000_000,
          fiscalDateEnding: eventDate,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const first = await getResearchEarningsEvents({
    symbol: "NVDA",
    from: new Date(`${eventDate}T00:00:00Z`),
    to: new Date(`${eventDate}T00:00:00Z`),
  });
  const second = await getResearchEarningsEvents({
    symbol: "NVDA",
    from: new Date(`${eventDate}T00:00:00Z`),
    to: new Date(`${eventDate}T00:00:00Z`),
  });

  assert.equal(calls.length, 1);
  assert.equal(first.symbol, "NVDA");
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].symbol, "NVDA");
  assert.equal(first.events[0].reportingTime, "amc");
  assert.equal(first.events[0].epsActual, 5.48);
  assert.equal(first.events[0].revenueActual, 39_300_000_000);
  assert.equal(first.events[0].fiscalPeriod, "Q1");
  assert.equal(first.events[0].status, "confirmed");
  assert.equal(first.events[0].provider, "fmp");
  assert.equal(second.events.length, 1);
});

test("getResearchEarningsEvents returns estimated events without actuals", async () => {
  const eventDate = currentMonthIsoDate(12);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify([
        {
          symbol: "MSFT",
          date: eventDate,
          time: "Before Market Open",
          epsEstimated: 3.2,
          revenueEstimated: 66_000_000_000,
          fiscalDateEnding: eventDate,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  const result = await getResearchEarningsEvents({
    symbol: "MSFT",
    from: new Date(`${eventDate}T00:00:00Z`),
    to: new Date(`${eventDate}T00:00:00Z`),
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].reportingTime, "bmo");
  assert.equal(result.events[0].epsActual, null);
  assert.equal(result.events[0].revenueActual, null);
  assert.equal(result.events[0].status, "estimated");
});

test("getResearchCalendar preserves legacy estimate fallback", async () => {
  const eventDate = currentMonthIsoDate(22);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify([
        {
          symbol: "TSLA",
          date: eventDate,
          time: "After Market Close",
          eps: 0.42,
          revenue: 25_000_000_000,
          fiscalDateEnding: eventDate,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  const result = await getResearchCalendar({
    from: new Date(`${eventDate}T00:00:00Z`),
    to: new Date(`${eventDate}T00:00:00Z`),
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].symbol, "TSLA");
  assert.equal(result.entries[0].time, "amc");
  assert.equal(result.entries[0].epsEstimated, 0.42);
  assert.equal(result.entries[0].revenueEstimated, 25_000_000_000);
});
