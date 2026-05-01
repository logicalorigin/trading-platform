import assert from "node:assert/strict";
import test from "node:test";
import {
  findOptionContractForFlowEvent,
  normalizeFlowOptionExpirationIso,
  normalizeFlowOptionRight,
  normalizeFlowOptionStrike,
} from "./flowOptionChartIdentity.js";

test("flow option identity normalizes expiration, side, and strike", () => {
  assert.equal(normalizeFlowOptionExpirationIso("20260428"), "2026-04-28");
  assert.equal(normalizeFlowOptionExpirationIso("2026-04-28T13:30:00Z"), "2026-04-28");
  assert.equal(normalizeFlowOptionRight("CALL"), "call");
  assert.equal(normalizeFlowOptionRight("Put"), "put");
  assert.equal(normalizeFlowOptionRight(null, "P"), "put");
  assert.equal(normalizeFlowOptionStrike("$1,234.50 C"), 1234.5);
});

test("findOptionContractForFlowEvent prefers exact row strike", () => {
  const match = findOptionContractForFlowEvent({
    rows: [
      { k: 500.01, cContract: { providerContractId: "near" } },
      { k: 500, cContract: { providerContractId: "exact" } },
    ],
    strike: "$500.00",
    right: "CALL",
  });

  assert.equal(match.providerContractId, "exact");
});

test("findOptionContractForFlowEvent accepts nearest same-expiration contract within tolerance", () => {
  const match = findOptionContractForFlowEvent({
    expirationIso: "2026-04-28",
    strike: 970,
    right: "put",
    contracts: [
      {
        contract: {
          expirationDate: "2026-04-28T00:00:00.000Z",
          strike: 970.005,
          right: "PUT",
          providerContractId: "near-put",
        },
      },
      {
        contract: {
          expirationDate: "2026-04-28T00:00:00.000Z",
          strike: 970,
          right: "call",
          providerContractId: "wrong-side",
        },
      },
    ],
  });

  assert.equal(match.providerContractId, "near-put");
});

test("findOptionContractForFlowEvent rejects contracts outside expiration and strike tolerance", () => {
  const match = findOptionContractForFlowEvent({
    expirationIso: "2026-04-28",
    strike: 970,
    right: "call",
    contracts: [
      {
        contract: {
          expirationDate: "2026-05-01T00:00:00.000Z",
          strike: 970,
          right: "call",
          providerContractId: "wrong-expiration",
        },
      },
      {
        contract: {
          expirationDate: "2026-04-28T00:00:00.000Z",
          strike: 970.5,
          right: "call",
          providerContractId: "too-far",
        },
      },
    ],
  });

  assert.equal(match, null);
});
