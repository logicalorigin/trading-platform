import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildOptionChartBarsRequest,
  normalizeBrokerProviderContractId,
  shouldPatchOptionChartWithLiveQuote,
} from "./useOptionChartBars.js";

const source = readFileSync(new URL("./useOptionChartBars.js", import.meta.url), "utf8");

const sliceSourceBetween = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
};

test("option chart requests only pass OPRA provider ids to Massive", () => {
  assert.equal(normalizeBrokerProviderContractId("12345"), null);
  assert.equal(normalizeBrokerProviderContractId("twsopt:nvda"), null);
  assert.equal(
    normalizeBrokerProviderContractId("O:NVDA260612C00145000"),
    "O:NVDA260612C00145000",
  );
  assert.equal(
    normalizeBrokerProviderContractId("o:nvda260612c00145000"),
    "O:NVDA260612C00145000",
  );

  const request = buildOptionChartBarsRequest({
    underlying: "NVDA",
    expirationDate: "2026-06-12",
    right: "call",
    strike: 145,
    optionTicker: null,
    providerContractId: "twsopt:nvda",
    timeframe: "1m",
    limit: 100,
  });

  assert.equal(request.providerContractId, undefined);
  assert.equal(
    shouldPatchOptionChartWithLiveQuote({
      liveEnabled: true,
      providerContractId: "12345",
    }),
    false,
  );
  assert.equal(
    shouldPatchOptionChartWithLiveQuote({
      liveEnabled: true,
      providerContractId: "O:NVDA260612C00145000",
    }),
    true,
  );
});

test("option chart cache keys separate regular and extended-hours bars", () => {
  const baseQueryKey = sliceSourceBetween(
    "const queryKey = useMemo",
    "const runtimeCacheKey = useMemo",
  );
  const prependQueryKey = sliceSourceBetween(
    '"option-chart-bars-prepend"',
    "queryFn:",
  );
  const historicalBarsScopeKey = sliceSourceBetween(
    "const baseBarsScopeKey = useMemo",
    "const prependableBars =",
  );
  const prewarmQueryKey = sliceSourceBetween(
    "const favoriteKey = [",
    "queryClient.prefetchQuery",
  );

  for (const keySource of [
    baseQueryKey,
    prependQueryKey,
    historicalBarsScopeKey,
    prewarmQueryKey,
  ]) {
    assert.match(keySource, /outsideRth\s*\?\s*"extended"\s*:\s*"regular"/);
  }
});
