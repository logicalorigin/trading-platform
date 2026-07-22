import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpError } from "../lib/errors";
import { __platformOptionChainAvailabilityTestInternals } from "./platform";

const debug = (reason: string | null, degraded = true) => ({
  cacheStatus: "miss" as const,
  totalMs: 1,
  upstreamMs: null,
  degraded,
  reason,
});

test("strict option-chain reads preserve a legitimate empty result", () => {
  const result = {
    underlying: "SPY",
    expirationDate: null,
    contracts: [],
    debug: debug("options_successful_empty"),
  };

  assert.equal(
    __platformOptionChainAvailabilityTestInternals.classify(result),
    "empty",
  );
  assert.equal(
    __platformOptionChainAvailabilityTestInternals.requireAvailable(result),
    result,
  );
});

test("strict option-chain reads reject degraded empty results", () => {
  for (const reason of [
    "options_upstream_failure",
    "options_backoff",
    "options_degraded_empty",
  ]) {
    const result = {
      underlying: "SPY",
      expirationDate: null,
      contracts: [],
      debug: debug(reason),
    };

    assert.equal(
      __platformOptionChainAvailabilityTestInternals.classify(result),
      "unavailable",
    );
    assert.throws(
      () =>
        __platformOptionChainAvailabilityTestInternals.requireAvailable(result),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 503 &&
        error.code === "option_chain_unavailable" &&
        error.data !== null &&
        typeof error.data === "object" &&
        (error.data as { reason?: unknown }).reason === reason,
      reason,
    );
  }
});

