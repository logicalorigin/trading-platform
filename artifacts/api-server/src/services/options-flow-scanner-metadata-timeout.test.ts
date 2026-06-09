import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { HttpError } from "../lib/errors";
import {
  __resetOptionChainCachesForTests,
  __runOptionsFlowScannerOnceForTests,
  __setIbkrBridgeClientFactoryForTests,
  resetOptionsFlowRuntimeOverrides,
  setOptionsFlowRuntimeOverrides,
} from "./platform";
import {
  __resetBridgeGovernorForTests,
  getBridgeGovernorSnapshot,
} from "./bridge-governor";

afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  resetOptionsFlowRuntimeOverrides();
  __resetBridgeGovernorForTests();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
});

test("options flow scanner metadata failures trip the options circuit quickly", async () => {
  const observedTimeouts: number[] = [];

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          return {
            transport: "tws",
            configured: true,
            connected: true,
            authenticated: true,
            liveMarketDataAvailable: true,
            marketDataMode: "live",
          };
        },
        async getOptionExpirations(input: { timeoutMs?: number }) {
          observedTimeouts.push(input.timeoutMs ?? 0);
          throw new HttpError(504, "scanner metadata timeout", {
            code: "ibkr_bridge_request_timeout",
          });
        },
      }) as never,
  );

  setOptionsFlowRuntimeOverrides({ scannerMetadataTimeoutMs: 1_234 });

  await __runOptionsFlowScannerOnceForTests(["TSTAA"], {
    lineBudget: 1,
    limit: 1,
    phase: "seed",
  });
  await __runOptionsFlowScannerOnceForTests(["TSTBB"], {
    lineBudget: 1,
    limit: 1,
    phase: "seed",
  });
  await __runOptionsFlowScannerOnceForTests(["TSTCC"], {
    lineBudget: 1,
    limit: 1,
    phase: "seed",
  });

  assert.deepEqual(observedTimeouts, [1_234, 1_234, 1_234]);
  assert.equal(getBridgeGovernorSnapshot().options.circuitOpen, true);
});
