import assert from "node:assert/strict";
import test from "node:test";

import { fetchHist } from "./researchApi.js";

const dailyBar = (timestamp, close = 100) => ({
  timestamp,
  close,
  source: "ibkr-history",
});

test("daily history refetches when the cached request covered fewer bars", async () => {
  const limits = [];
  const requestBars = async ({ limit }) => {
    limits.push(limit);
    return { bars: [dailyBar("2026-01-02T00:00:00.000Z")] };
  };
  const ticker = `CACHE-COVERAGE-${Date.now()}`;

  await fetchHist(ticker, "3M", requestBars);
  await fetchHist(ticker, "5Y", requestBars);

  assert.deepEqual(limits, [66, 1300]);
});

test("YTD history begins on January 1 in UTC when reusing daily cache", async () => {
  const year = new Date().getUTCFullYear();
  let requestCount = 0;
  const requestBars = async () => {
    requestCount += 1;
    return {
      bars: [
        dailyBar(new Date(Date.UTC(year - 1, 11, 31, 23, 59)).toISOString(), 90),
        dailyBar(new Date(Date.UTC(year, 0, 1)).toISOString(), 100),
        dailyBar(new Date(Date.UTC(year, 1, 1)).toISOString(), 110),
      ],
    };
  };
  const ticker = `YTD-UTC-${Date.now()}`;

  await fetchHist(ticker, "1Y", requestBars);
  const result = await fetchHist(ticker, "YTD", requestBars);

  assert.equal(requestCount, 1);
  assert.deepEqual(
    result.hist.map((bar) => bar.fullDate),
    [`${year}-01-01`, `${year}-02-01`],
  );
});
