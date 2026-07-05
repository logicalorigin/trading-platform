import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { HttpError } from "../lib/errors";
import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
  __resetOptionChainCachesForTests,
  __runOptionsFlowScannerOnceForTests,
  __resolveOptionsFlowScannerTargetTickerSlotsForTests,
  __setMassiveMarketDataClientFactoryForTests,
  getOptionsFlowRuntimeConfig,
  getOptionsFlowScannerDiagnostics,
  resetOptionsFlowRuntimeOverrides,
  setOptionsFlowRuntimeOverrides,
} from "./platform";
import {
  __resetBridgeGovernorForTests,
} from "./bridge-governor";

const ORIGINAL_MASSIVE_API_KEY = process.env["MASSIVE_API_KEY"];

afterEach(() => {
  __setMassiveMarketDataClientFactoryForTests(null);
  if (ORIGINAL_MASSIVE_API_KEY === undefined) {
    delete process.env["MASSIVE_API_KEY"];
  } else {
    process.env["MASSIVE_API_KEY"] = ORIGINAL_MASSIVE_API_KEY;
  }
  __resetProviderRuntimeConfigCacheForTests();
  resetOptionsFlowRuntimeOverrides();
  __resetBridgeGovernorForTests();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
});

test("options flow scanner defaults scan each worker's budget", () => {
  resetOptionsFlowRuntimeOverrides();

  const runtimeConfig = getOptionsFlowRuntimeConfig();
  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(
    runtimeConfig.scannerMetadataTimeoutMs,
    OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
  );
  assert.equal(runtimeConfig.scannerBatchSize, 4);
  assert.equal(diagnostics.lineBudget, 100);
  assert.equal(diagnostics.lineUtilization.scannerTargetLineBudget, 100);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 2);
  assert.equal(diagnostics.seedLineBudget, 50);
  assert.equal(diagnostics.expandedLineBudget, 50);
  assert.equal(diagnostics.lineUtilization.effectiveDeepLineBudget, 50);
  assert.equal(diagnostics.lineUtilization.perTickerLiveContractLimit, 50);
  assert.equal(
    __resolveOptionsFlowScannerTargetTickerSlotsForTests({
      scannerTargetLineBudget: 100,
      perTickerLineBudget: 50,
      eligibleOptionableTickerCount: 741,
    }),
    2,
  );
});

test("options flow scanner metadata timeouts abort Massive requests", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-options-test-key";
  __resetProviderRuntimeConfigCacheForTests();

  const observedAbortReasons: unknown[] = [];

  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionContracts(input: { signal?: AbortSignal }) {
          if (!input.signal) {
            throw new Error("expected Massive option metadata signal");
          }
          return await new Promise<never>((_resolve, reject) => {
            input.signal?.addEventListener("abort", () => {
              observedAbortReasons.push(input.signal?.reason);
              reject(input.signal?.reason);
            }, {
              once: true,
            });
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

  assert.equal(observedAbortReasons.length, 3);
  for (const reason of observedAbortReasons) {
    assert.ok(reason instanceof HttpError);
    assert.equal(reason.statusCode, 504);
    assert.equal(reason.code, "massive_options_request_timeout");
  }
});
