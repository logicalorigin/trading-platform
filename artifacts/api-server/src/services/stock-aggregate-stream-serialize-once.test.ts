import assert from "node:assert/strict";
import test from "node:test";

import {
  subscribeMutableStockMinuteAggregates,
  __stockAggregateStreamTestInternals,
  type StockMinuteAggregateMessage,
} from "./stock-aggregate-stream";
import {
  __resetSseStreamDiagnosticsForTests,
  getSseEmitCounters,
} from "./sse-stream-diagnostics";

// Loosely re-typed test hook: the Massive quote handler only reads symbol/price/
// bid/ask/volume off each quote, so a minimal literal is enough to drive one
// live aggregate broadcast without building a full provider payload.
const ingestQuote = __stockAggregateStreamTestInternals.handleMassiveQuoteSnapshot as unknown as (
  payload: {
    quotes: Array<{
      symbol: string;
      price: number;
      bid: number;
      ask: number;
      volume: number | null;
    }>;
  },
  observedAt?: number,
) => void;

type Received = {
  label: string;
  message: StockMinuteAggregateMessage;
  serializeEvent?: () => string;
};

function driveOneBroadcast(received: Received[]) {
  ingestQuote({
    quotes: [{ symbol: "AAPL", price: 100, bid: 0, ask: 0, volume: 10 }],
  });
  __stockAggregateStreamTestInternals.flushAggregateFanout();
}

test("aggregate fan-out serializes once per broadcast and shares identical bytes across subscribers", () => {
  __stockAggregateStreamTestInternals.reset();
  __resetSseStreamDiagnosticsForTests();

  const received: Received[] = [];
  const capture =
    (label: string) =>
    (message: StockMinuteAggregateMessage, serializeEvent?: () => string) => {
      received.push({ label, message, serializeEvent });
    };
  const subA = subscribeMutableStockMinuteAggregates(["AAPL"], capture("A"));
  const subB = subscribeMutableStockMinuteAggregates(["AAPL"], capture("B"));

  driveOneBroadcast(received);

  assert.equal(received.length, 2, "both subscribers receive the broadcast");
  assert.ok(
    received[0].serializeEvent && received[1].serializeEvent,
    "each delivery carries a serialize-once thunk",
  );
  // The SAME memoized thunk is shared across subscribers of one broadcast.
  assert.equal(
    received[0].serializeEvent,
    received[1].serializeEvent,
    "subscribers share one serialize-once thunk",
  );

  const bytesA = received[0].serializeEvent!();
  const bytesB = received[1].serializeEvent!();
  assert.equal(bytesA, bytesB, "every subscriber gets byte-identical data");
  assert.equal(
    getSseEmitCounters().events,
    1,
    "payload serialized exactly once despite two subscribers",
  );
  assert.match(bytesA, /"symbol":"AAPL"/);
  assert.match(bytesA, /"apiServerEmittedAt"/);

  subA.unsubscribe();
  subB.unsubscribe();
});

test("aggregate broadcast performs zero serialization when no subscriber reads the thunk", () => {
  __stockAggregateStreamTestInternals.reset();
  __resetSseStreamDiagnosticsForTests();

  let delivered = 0;
  // A signal-monitor-style subscriber consumes the message but ignores the thunk.
  const sub = subscribeMutableStockMinuteAggregates(["AAPL"], () => {
    delivered += 1;
  });

  driveOneBroadcast([]);

  assert.equal(delivered, 1, "non-SSE subscriber still receives the broadcast");
  assert.equal(
    getSseEmitCounters().events,
    0,
    "no JSON serialization happens when nothing reads the thunk",
  );

  sub.unsubscribe();
});
