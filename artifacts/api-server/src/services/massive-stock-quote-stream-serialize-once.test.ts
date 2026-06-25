import assert from "node:assert/strict";
import test from "node:test";

import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  subscribeMassiveStockQuoteSnapshots,
  __massiveStockQuoteStreamInternalsForTests as internals,
} from "./massive-stock-quote-stream";
import {
  __resetSseStreamDiagnosticsForTests,
  getSseEmitCounters,
} from "./sse-stream-diagnostics";

function enableMassive() {
  process.env["MASSIVE_API_KEY"] = "test-key";
  __resetProviderRuntimeConfigCacheForTests();
  internals.reset();
  __resetSseStreamDiagnosticsForTests();
}

test("quote fan-out serializes once per matched subset and shares identical bytes without leakage", () => {
  enableMassive();
  const recv: Array<{ label: string; serializeEvent?: () => string }> = [];
  const cap =
    (label: string) =>
    (_payload: unknown, serializeEvent?: () => string) => {
      recv.push({ label, serializeEvent });
    };
  // A and B both watch AAPL; A also watches MSFT, B also watches GOOG.
  const unsubA = subscribeMassiveStockQuoteSnapshots(["AAPL", "MSFT"], cap("A"));
  const unsubB = subscribeMassiveStockQuoteSnapshots(["AAPL", "GOOG"], cap("B"));
  assert.ok(typeof unsubA === "function" && typeof unsubB === "function");
  recv.length = 0;
  __resetSseStreamDiagnosticsForTests();

  // Only AAPL ticks -> A and B both match exactly [AAPL] -> same subset.
  internals.handleWebSocketMessage({ ev: "T", sym: "AAPL", p: 100 });
  internals.handleWebSocketMessage({ ev: "Q", sym: "AAPL", bp: 99, ap: 101, bs: 5, as: 5 });
  internals.flushSnapshotNotifications();

  assert.equal(recv.length, 2, "both subscribers receive the AAPL tick");
  assert.ok(recv[0].serializeEvent && recv[1].serializeEvent, "thunk supplied");
  assert.equal(
    recv[0].serializeEvent,
    recv[1].serializeEvent,
    "same subset shares one serialize-once thunk",
  );

  const a = recv[0].serializeEvent!();
  const b = recv[1].serializeEvent!();
  assert.equal(a, b, "byte-identical for the shared subset");
  assert.equal(getSseEmitCounters().events, 1, "serialized once despite two subscribers");
  assert.match(a, /"symbol":"AAPL"/);
  assert.doesNotMatch(a, /MSFT|GOOG/, "no other subscriber's symbols leak in");

  unsubA();
  unsubB();
});

test("quote fan-out keeps distinct symbol-subsets separate", () => {
  enableMassive();
  const recv: Array<{ label: string; bytes: string }> = [];
  const cap =
    (label: string) =>
    (_payload: unknown, serializeEvent?: () => string) => {
      recv.push({ label, bytes: serializeEvent ? serializeEvent() : "" });
    };
  const unsubA = subscribeMassiveStockQuoteSnapshots(["AAPL"], cap("A"));
  const unsubB = subscribeMassiveStockQuoteSnapshots(["MSFT"], cap("B"));
  recv.length = 0;
  __resetSseStreamDiagnosticsForTests();

  internals.handleWebSocketMessage({ ev: "T", sym: "AAPL", p: 100 });
  internals.handleWebSocketMessage({ ev: "Q", sym: "AAPL", bp: 99, ap: 101 });
  internals.handleWebSocketMessage({ ev: "T", sym: "MSFT", p: 200 });
  internals.handleWebSocketMessage({ ev: "Q", sym: "MSFT", bp: 199, ap: 201 });
  internals.flushSnapshotNotifications();

  assert.equal(recv.length, 2);
  const byLabel = Object.fromEntries(recv.map((r) => [r.label, r.bytes]));
  assert.match(byLabel["A"], /"symbol":"AAPL"/);
  assert.doesNotMatch(byLabel["A"], /MSFT/);
  assert.match(byLabel["B"], /"symbol":"MSFT"/);
  assert.doesNotMatch(byLabel["B"], /AAPL/);
  assert.notEqual(byLabel["A"], byLabel["B"], "distinct subsets do not share bytes");
  assert.equal(getSseEmitCounters().events, 2, "one serialization per distinct subset");

  unsubA();
  unsubB();
});
