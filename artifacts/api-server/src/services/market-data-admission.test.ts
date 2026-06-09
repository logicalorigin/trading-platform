import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataLeasesSnapshot,
} from "./market-data-admission";

test("equity lease refresh preserves newly supplied provider contract id", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [
      {
        assetClass: "equity",
        symbol: "FCEL",
        providerContractId: "740517233",
      },
    ],
    fallbackProvider: "none",
  });

  const leases = getMarketDataLeasesSnapshot();
  assert.equal(leases.length, 1);
  assert.equal(leases[0].instrumentKey, "equity:FCEL");
  assert.equal(leases[0].lineIds[0], "equity:FCEL");
  assert.equal(leases[0].providerContractId, "740517233");
});
