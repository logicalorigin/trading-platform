import assert from "node:assert/strict";
import test from "node:test";

import { formatRelativeTimeShort } from "../../lib/formatters.js";
import {
  formatPositionQuoteFreshnessLabel,
  getPositionQuote,
} from "./positionDisplayModel.js";

// Regression: a one-sided quote (only bid OR only ask > 0) must NOT fabricate a
// mid. Before the fix, buildQuote's guard was `bid > 0 || ask > 0`, so a garbage
// book like bid 0.00 / ask 5.00 produced mid (0 + 5) / 2 = 2.50 and used it as the
// displayed mark — e.g. OPTT showed a phantom 2.50 price while the broker mark was
// 0.02. The mid now requires BOTH sides > 0; a one-sided book falls back to the
// broker mark.
test("one-sided quote does not fabricate a mid (falls back to broker mark)", () => {
  const quote = getPositionQuote({ quote: { bid: 0, ask: 5 }, mark: 0.02 });
  assert.equal(quote.mid, null);
  assert.equal(quote.mark, 0.02);
});

test("zero/zero quote does not fabricate a mid", () => {
  const quote = getPositionQuote({ quote: { bid: 0, ask: 0 }, mark: 0.02 });
  assert.equal(quote.mid, null);
  assert.equal(quote.mark, 0.02);
});

test("a valid two-sided quote still computes the mid", () => {
  const quote = getPositionQuote({ quote: { bid: 4, ask: 5 } });
  assert.equal(quote.mid, 4.5);
  assert.equal(quote.mark, 4.5);
});

test("quote freshness uses API receipt time when the exchange quote is unchanged", () => {
  const receivedAt = new Date(Date.now() - 5_000).toISOString();
  const quote = getPositionQuote({
    optionQuote: {
      bid: 3,
      ask: 4.8,
      freshness: "live",
      updatedAt: "2026-07-21T16:44:17.000Z",
      latency: { apiServerReceivedAt: receivedAt },
    },
  });

  assert.deepEqual(quote.latency, { apiServerReceivedAt: receivedAt });
  assert.equal(
    formatPositionQuoteFreshnessLabel(quote),
    `live · ${formatRelativeTimeShort(receivedAt)}`,
  );
});
