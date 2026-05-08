import test from "node:test";
import assert from "node:assert/strict";
import { mapFlowEventToUi } from "./flowEventMapper.js";

test("mapFlowEventToUi does not default unknown option right to puts", () => {
  const mapped = mapFlowEventToUi({
    id: "unknown-right",
    underlying: "SPY",
    provider: "polygon",
    basis: "trade",
    occurredAt: "2026-05-06T14:30:00.000Z",
    expirationDate: "2026-05-08",
    strike: 500,
    side: "buy",
    price: 1,
    size: 10,
    premium: 1_000,
  });

  assert.equal(mapped.cp, "");
  assert.equal(mapped.flowBias, "neutral");
});
