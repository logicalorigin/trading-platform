import assert from "node:assert/strict";
import { test } from "node:test";

import { isExpectedOptionUpstreamAvailabilityReason } from "./platform";

// Off-hours the IBKR options market is closed, so option expirations/chains come back via
// the transient-upstream path with these reasons. They are expected data-availability
// conditions (market data runs 24/7, serving cached/durable/empty), not connection faults,
// and must NOT raise a degraded warning event (which would surface in readiness
// degradedReasons). Real connection problems are tracked via broker readiness / governor.
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
