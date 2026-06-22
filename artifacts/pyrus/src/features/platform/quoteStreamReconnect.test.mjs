import assert from "node:assert/strict";
import test from "node:test";

import {
  QUOTE_STREAM_RECONNECT_BASE_MS,
  QUOTE_STREAM_RECONNECT_MAX_MS,
  QUOTE_STREAM_STALL_BASE_MS,
  QUOTE_STREAM_STALL_MAX_MS,
  nextQuoteStreamReconnectDelayMs,
  nextQuoteStreamStallMs,
} from "./quoteStreamReconnect.ts";

test("reconnect backoff grows exponentially from base", () => {
  assert.equal(nextQuoteStreamReconnectDelayMs(0), QUOTE_STREAM_RECONNECT_BASE_MS);
  assert.equal(nextQuoteStreamReconnectDelayMs(1), 2_000);
  assert.equal(nextQuoteStreamReconnectDelayMs(2), 4_000);
  assert.equal(nextQuoteStreamReconnectDelayMs(3), 8_000);
});

test("reconnect backoff is capped at the max", () => {
  assert.equal(nextQuoteStreamReconnectDelayMs(20), QUOTE_STREAM_RECONNECT_MAX_MS);
  assert.equal(nextQuoteStreamReconnectDelayMs(1000), QUOTE_STREAM_RECONNECT_MAX_MS);
});

test("reconnect backoff clamps non-positive/NaN attempts to base", () => {
  assert.equal(nextQuoteStreamReconnectDelayMs(-5), QUOTE_STREAM_RECONNECT_BASE_MS);
  assert.equal(nextQuoteStreamReconnectDelayMs(Number.NaN), QUOTE_STREAM_RECONNECT_BASE_MS);
});

test("stall window doubles each quiet cycle then caps", () => {
  // base -> 2x -> 4x ... clamped at max (45s -> 90 -> 180 -> 300 cap)
  assert.equal(nextQuoteStreamStallMs(QUOTE_STREAM_STALL_BASE_MS), 90_000);
  assert.equal(nextQuoteStreamStallMs(90_000), 180_000);
  assert.equal(nextQuoteStreamStallMs(180_000), QUOTE_STREAM_STALL_MAX_MS);
  assert.equal(nextQuoteStreamStallMs(QUOTE_STREAM_STALL_MAX_MS), QUOTE_STREAM_STALL_MAX_MS);
});

test("stall window never drops below a full base window", () => {
  // A stalled-out value below base (or 0) still escalates from at least base.
  assert.equal(nextQuoteStreamStallMs(0), 90_000);
  assert.equal(nextQuoteStreamStallMs(1_000), 90_000);
});

// Regression guard: the live stream effect must actually wire the self-heal.
// Without these, a CLOSED EventSource (the freeze) never reconnects.
test("live-streams wires onerror reconnect + stall watchdog", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  assert.match(source, /next\.onerror = \(\) => \{/);
  assert.match(source, /readyState !== EventSource\.CLOSED/);
  assert.match(source, /nextQuoteStreamReconnectDelayMs\(reconnectAttempt\)/);
  assert.match(source, /setInterval\(/);
  assert.match(source, /nextQuoteStreamStallMs\(stallMs\)/);
});
