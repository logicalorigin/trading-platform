import assert from "node:assert/strict";
import test from "node:test";

import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  __resetHistoricalFlowEventsForTests,
  __setHistoricalFlowStoreDisabledForTests,
} from "./historical-flow-events";
import {
  __resetOptionChainCachesForTests,
  __setMassiveMarketDataClientFactoryForTests,
  getPlatformResourceDiagnostics,
  listFlowEvents,
} from "./platform";

const waitTurn = () => new Promise((resolve) => setImmediate(resolve));

test("nonblocking historical flow reads single-flight by normalized key", async () => {
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const requests: Array<Promise<unknown>> = [];
  let providerCalls = 0;

  process.env["MASSIVE_API_KEY"] = "historical-singleflight-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __setHistoricalFlowStoreDisabledForTests(true);
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionFlowEvents() {
          providerCalls += 1;
          await providerGate;
          return { events: [], contractCount: 0, contractsScanned: 0 };
        },
      }) as never,
  );

  try {
    const window = {
      from: "2026-07-01T13:30:00.000Z",
      to: "2026-07-01T20:00:00.000Z",
      blocking: false,
    } as const;
    requests.push(
      listFlowEvents({ underlying: " spy ", ...window }),
      listFlowEvents({ underlying: "SPY", ...window }),
      listFlowEvents({ underlying: "QQQ", ...window }),
    );
    await waitTurn();

    const diagnostics = getPlatformResourceDiagnostics().flowEvents;
    assert.equal(providerCalls, 2);
    assert.equal(diagnostics.inFlight, 2);
    assert.equal(diagnostics.historicalLaunches, 2);
    assert.equal(diagnostics.historicalJoins, 1);

    releaseProvider();
    await Promise.all(requests);
    assert.equal(getPlatformResourceDiagnostics().flowEvents.inFlight, 0);
  } finally {
    releaseProvider();
    await Promise.allSettled(requests);
    __setMassiveMarketDataClientFactoryForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
    __resetHistoricalFlowEventsForTests();
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    __resetProviderRuntimeConfigCacheForTests();
  }
});
