import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOptionChartBarsRequest,
  normalizeBrokerProviderContractId,
  shouldPatchOptionChartWithLiveQuote,
} from "./useOptionChartBars.js";

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
