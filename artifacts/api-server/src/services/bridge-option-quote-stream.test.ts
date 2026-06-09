import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  __resetBridgeGovernorForTests,
  getBridgeGovernorSnapshot,
} from "./bridge-governor";
import {
  __resetMarketDataAdmissionForTests,
} from "./market-data-admission";
import {
  __getBridgeOptionQuoteLastErrorForTests,
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
  __setBridgeOptionQuoteStreamNowForTests,
  fetchBridgeOptionQuoteSnapshots,
} from "./bridge-option-quote-stream";
import { HttpError } from "../lib/errors";

afterEach(() => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteClientForTests(null);
  __setBridgeOptionQuoteStreamNowForTests(null);
});

test("algo operations automation live quote snapshots use the quote bridge lane", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [
        {
          symbol: "SPY",
          providerContractId: "contract-1",
          bid: 1,
          ask: 1.1,
          price: 1.05,
          delayed: false,
          freshness: "live",
          transport: "tws",
          updatedAt: new Date("2026-06-08T18:00:01.000Z"),
          delta: 0.5,
        },
      ] as never;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["contract-1"],
    owner: "algo-operations:SPY",
    intent: "automation-live",
    requiresGreeks: true,
  });

  assert.equal(payload.quotes.length, 1);
  const snapshot = getBridgeGovernorSnapshot();
  assert.ok(snapshot.quotes.lastSuccessAt);
  assert.equal(snapshot.options.lastSuccessAt, null);
});

function makeThrowingOptionQuoteClient(error: unknown) {
  return {
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(): Promise<never> {
      throw error;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  };
}

test("off-hours upstream-unavailable option fetch does not record a connection error", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-08T23:30:00.000Z"));
  __setBridgeOptionQuoteClientForTests(
    makeThrowingOptionQuoteClient(
      new HttpError(502, "Upstream request failed.", {
        code: "upstream_request_failed",
      }),
    ),
  );

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["contract-1"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.equal(
    __getBridgeOptionQuoteLastErrorForTests(),
    null,
    "upstream-unavailable must not surface as option-stream lastError",
  );
});

test("a genuine upstream error still records a connection error", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));
  __setBridgeOptionQuoteClientForTests(
    makeThrowingOptionQuoteClient(new Error("tws auth rejected")),
  );

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["contract-1"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.match(
    __getBridgeOptionQuoteLastErrorForTests() ?? "",
    /tws auth rejected/,
    "non-upstream errors must still surface as option-stream lastError",
  );
});
