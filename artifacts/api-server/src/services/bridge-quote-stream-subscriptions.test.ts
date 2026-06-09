import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getMarketDataAdmissionDiagnostics,
  __resetMarketDataAdmissionForTests,
} from "./market-data-admission";
import {
  getBridgeQuoteStreamDiagnostics,
  subscribeBridgeQuoteSnapshots,
  __resetBridgeQuoteStreamForTests,
  __setBridgeQuoteRuntimeConfiguredForTests,
} from "./bridge-quote-stream";

afterEach(() => {
  __resetBridgeQuoteStreamForTests();
  __resetMarketDataAdmissionForTests();
});

test("bridge quote subscriptions can carry account-monitor admission priority", () => {
  __resetBridgeQuoteStreamForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeQuoteRuntimeConfiguredForTests(true);

  const unsubscribe = subscribeBridgeQuoteSnapshots(["FCEL"], () => {}, {
    ownerPrefix: "account-position-quote-stream",
    intent: "account-monitor-live",
    fallbackProvider: "none",
  });

  const admission = getMarketDataAdmissionDiagnostics();
  const lease = admission.leases.find(
    (entry) => entry.instrumentKey === "equity:FCEL",
  );

  assert.ok(lease, "Expected FCEL account-monitor lease");
  assert.match(lease.owner, /^account-position-quote-stream:/);
  assert.equal(lease.intent, "account-monitor-live");
  assert.equal(lease.pool, "account-monitor");
  assert.equal(lease.priority, 90);
  assert.equal(lease.fallbackProvider, "none");
  assert.deepEqual(getBridgeQuoteStreamDiagnostics().desiredSymbols, ["FCEL"]);

  unsubscribe();
});
