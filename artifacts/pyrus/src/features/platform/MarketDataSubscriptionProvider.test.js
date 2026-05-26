import assert from "node:assert/strict";
import test from "node:test";
import { resolveQuoteStreamDisabledReason } from "./MarketDataSubscriptionProvider.jsx";

test("quote stream disabled reason exposes the first active gate", () => {
  assert.equal(
    resolveQuoteStreamDisabledReason({
      pageVisible: false,
      quoteStreamRuntimeEnabled: true,
      symbolCount: 5,
      eventSourceAvailable: true,
    }),
    "page-hidden",
  );
  assert.equal(
    resolveQuoteStreamDisabledReason({
      pageVisible: true,
      quoteStreamRuntimeEnabled: true,
      symbolCount: 5,
      eventSourceAvailable: true,
      upstreamDisabledReason: "ibkr-not-ready",
    }),
    "ibkr-not-ready",
  );
  assert.equal(
    resolveQuoteStreamDisabledReason({
      pageVisible: true,
      quoteStreamRuntimeEnabled: true,
      symbolCount: 0,
      eventSourceAvailable: true,
    }),
    "empty-symbol-batch",
  );
  assert.equal(
    resolveQuoteStreamDisabledReason({
      pageVisible: true,
      quoteStreamRuntimeEnabled: true,
      symbolCount: 5,
      eventSourceAvailable: false,
    }),
    "eventsource-unavailable",
  );
  assert.equal(
    resolveQuoteStreamDisabledReason({
      pageVisible: true,
      quoteStreamRuntimeEnabled: true,
      symbolCount: 5,
      eventSourceAvailable: true,
    }),
    null,
  );
});
