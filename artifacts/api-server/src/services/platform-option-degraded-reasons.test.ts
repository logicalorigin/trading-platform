import assert from "node:assert/strict";
import { test } from "node:test";

import { isExpectedOptionUpstreamAvailabilityReason } from "./platform";

// Option expirations/chains can come back through transient-upstream paths while
// provider fetches are unavailable, backed off, or deferred to durable cache. These
// are expected data-availability conditions, not broker connection faults, and must
// NOT raise a degraded warning event (which would surface in readiness degradedReasons).
test("upstream-availability option reasons are treated as expected (no warning)", () => {
  for (const reason of [
    "options_upstream_failure",
    "options_backoff",
    "option_expirations_refresh_deferred",
    "durable_option_expirations_after_upstream_failure",
  ]) {
    assert.equal(
      isExpectedOptionUpstreamAvailabilityReason(reason),
      true,
      `${reason} should be treated as expected upstream availability`,
    );
  }
});

test("genuine option-degradation reasons still warn", () => {
  for (const reason of [
    "options_successful_empty",
    "option_expirations_successful_empty",
    "options_degraded_empty",
    "option_expirations_degraded_empty",
  ]) {
    assert.equal(
      isExpectedOptionUpstreamAvailabilityReason(reason),
      false,
      `${reason} should still raise a degraded warning`,
    );
  }
});
