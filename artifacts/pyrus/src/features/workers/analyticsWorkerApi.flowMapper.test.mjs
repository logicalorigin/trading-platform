import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { analyticsWorkerApi } from "./analyticsWorkerApi.js";

const formatterSource = readFileSync(
  new URL("../../lib/formatters.js", import.meta.url),
  "utf8",
);
const analyticsClientSource = readFileSync(
  new URL("./analyticsClient.js", import.meta.url),
  "utf8",
);

test("analytics worker mapper does not pull JSX UI tokens into its import graph", () => {
  assert.doesNotMatch(formatterSource, /uiTokens\.jsx/);
  assert.match(formatterSource, /displayValues/);
});

test("cold chart conversions use the measured worker startup ceiling", () => {
  assert.match(
    analyticsClientSource,
    /const WORKER_FLOW_EVENT_FALLBACK_MS = 2_000;/,
  );
});

test("chart conversion effects do not rebuild a redundant event signature", () => {
  assert.doesNotMatch(analyticsClientSource, /buildFlowEventSignature/);
  assert.match(
    analyticsClientSource,
    /\}, \[inputEvents, symbol, syncConversion\]\);/,
  );
});

test("analytics worker maps flow events with the shared UI mapper", () => {
  const [mapped] = analyticsWorkerApi.mapFlowEventsToUi([
    {
      id: "flow-1",
      basis: "trade",
      occurredAt: "2026-07-11T17:45:00.000Z",
      underlying: "SPY",
      expirationDate: "2026-07-17",
      right: "call",
      strike: 700,
      side: "buy",
      price: 1.25,
      size: 10,
    },
  ]);

  assert.equal(mapped.id, "flow-1");
  assert.equal(mapped.ticker, "SPY");
  assert.equal(mapped.cp, "C");
  assert.equal(mapped.occurredAt, "2026-07-11T17:45:00.000Z");
});
