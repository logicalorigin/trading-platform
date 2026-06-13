import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  __setBridgeQuoteStreamNowForTests,
  __toPayloadQuoteForTests,
} from "./bridge-quote-stream";
import type { QuoteSnapshot } from "../providers/ibkr/client";

const NOW = new Date("2026-06-13T18:00:00.000Z");

// Minimal quote: toPayloadQuote only reads latency.apiServerReceivedAt + freshness.
const makeQuote = (
  freshness: string,
  receivedAt: Date,
): QuoteSnapshot =>
  ({
    symbol: "SPY",
    freshness,
    latency: { apiServerReceivedAt: receivedAt },
  }) as unknown as QuoteSnapshot;

afterEach(() => {
  __setBridgeQuoteStreamNowForTests(null);
});

test("a fresh-by-age DELAYED quote is NOT promoted to live", () => {
  __setBridgeQuoteStreamNowForTests(NOW);
  // Received 'now' => age 0ms (< the 2s live window). Must stay delayed.
  const out = __toPayloadQuoteForTests(makeQuote("delayed", NOW));
  assert.equal(out.freshness, "delayed");
});

test("a fresh-by-age FROZEN quote is NOT promoted to live", () => {
  __setBridgeQuoteStreamNowForTests(NOW);
  const out = __toPayloadQuoteForTests(makeQuote("frozen", NOW));
  assert.equal(out.freshness, "frozen");
});

test("a genuinely live quote stays live (no regression)", () => {
  __setBridgeQuoteStreamNowForTests(NOW);
  const out = __toPayloadQuoteForTests(makeQuote("live", NOW));
  assert.equal(out.freshness, "live");
});

test("a too-old delayed quote becomes stale (age can still demote)", () => {
  __setBridgeQuoteStreamNowForTests(NOW);
  const old = new Date(NOW.getTime() - 5_000); // 5s old, beyond the 2s window
  const out = __toPayloadQuoteForTests(makeQuote("delayed", old));
  assert.equal(out.freshness, "stale");
});
