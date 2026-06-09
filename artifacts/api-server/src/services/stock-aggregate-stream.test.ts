import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreferredStockAggregateStreamSource } from "./stock-aggregate-stream";

test("stock aggregate stream prefers Massive realtime when available", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: true,
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: true,
    }),
    "massive-websocket",
  );
});

test("stock aggregate stream does not wait on configured IBKR when delayed Massive is available", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: true,
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: false,
    }),
    "massive-delayed-websocket",
  );
});

test("stock aggregate stream falls back to IBKR-derived aggregates only without Massive", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: true,
      massiveDelayedConfigured: false,
      massiveRealtimeConfigured: false,
    }),
    "ibkr-websocket-derived",
  );
});

test("stock aggregate stream reports unavailable when no provider is configured", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: false,
      massiveDelayedConfigured: false,
      massiveRealtimeConfigured: false,
    }),
    "none",
  );
});
