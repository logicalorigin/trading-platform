import assert from "node:assert/strict";
import test from "node:test";

import { replayStopElection } from "./stop-election-replay";

const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1_000);

test("last-first confirmation requires two distinct eligible trades", () => {
  const result = replayStopElection({
    stopPrice: 1,
    events: [
      { kind: "trade", id: "t1", at: at(1), price: 0.99 },
      { kind: "trade", id: "t1", at: at(2), price: 0.99 },
      { kind: "trade", id: "t2", at: at(3), price: 0.98 },
    ],
  });
  assert.equal(result.tradeConfirmation?.at.toISOString(), at(3).toISOString());
  assert.deepEqual(result.tradeConfirmation?.evidenceIds, ["t1", "t2"]);
});

test("above-stop trade resets trade confirmation", () => {
  const result = replayStopElection({
    stopPrice: 1,
    events: [
      { kind: "trade", id: "t1", at: at(1), price: 0.99 },
      { kind: "trade", id: "t2", at: at(2), price: 1.01 },
      { kind: "trade", id: "t3", at: at(3), price: 0.98 },
    ],
  });
  assert.equal(result.tradeConfirmation, null);
});

test("ask fallback requires two distinct fresh quote updates", () => {
  const result = replayStopElection({
    stopPrice: 1,
    maxEvidenceSpacingMs: 5_000,
    events: [
      { kind: "quote", id: "q1", at: at(1), bid: 0.7, ask: 0.99 },
      { kind: "quote", id: "q2", at: at(4), bid: 0.65, ask: 0.98 },
    ],
  });
  assert.equal(result.askConfirmation?.at.toISOString(), at(4).toISOString());
});

test("stale spacing and ask recovery reset ask confirmation", () => {
  const result = replayStopElection({
    stopPrice: 1,
    maxEvidenceSpacingMs: 5_000,
    events: [
      { kind: "quote", id: "q1", at: at(1), bid: 0.7, ask: 0.99 },
      { kind: "quote", id: "q2", at: at(8), bid: 0.7, ask: 0.98 },
      { kind: "quote", id: "q3", at: at(9), bid: 0.8, ask: 1.01 },
      { kind: "quote", id: "q4", at: at(10), bid: 0.7, ask: 0.97 },
    ],
  });
  assert.equal(result.askConfirmation, null);
});

test("midpoint touch alone never confirms", () => {
  const result = replayStopElection({
    stopPrice: 1,
    events: [
      { kind: "quote", id: "q1", at: at(1), bid: 0.7, ask: 1.2 },
      { kind: "quote", id: "q2", at: at(2), bid: 0.69, ask: 1.19 },
    ],
  });
  assert.equal(result.tradeConfirmation, null);
  assert.equal(result.askConfirmation, null);
});
