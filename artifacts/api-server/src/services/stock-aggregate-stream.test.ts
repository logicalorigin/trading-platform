import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreferredStockAggregateStreamSource } from "./stock-aggregate-stream";

test("stock aggregate stream prefers Massive realtime when available", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: true,
    }),
    "massive-websocket",
  );
});

test("stock aggregate stream does not wait on configured IBKR when delayed Massive is available", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: false,
    }),
    "massive-delayed-websocket",
  );
});

test("stock aggregate stream reports unavailable without Massive", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: false,
      massiveRealtimeConfigured: false,
    }),
    "none",
  );
});

test("stock aggregate stream reports unavailable when no provider is configured", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: false,
      massiveRealtimeConfigured: false,
    }),
    "none",
  );
});
