import assert from "node:assert/strict";
import test from "node:test";

const { buildAccountReturnsModel } = await import("./accountReturnsModel.js");

// The account hero "Unrealized" KPI reads returnsModel.positions.unrealizedPnl.
// These tests pin the field so a degraded/absent positions response can never be
// misreported as a confident "+$0" (formatSignedMoney(0) -> "+$0", but
// formatSignedMoney(null) -> "—").

test("sums per-row unrealized P&L when open rows carry finite values", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [
        { quantity: 10, unrealizedPnl: 3182.1 },
        { quantity: 5, unrealizedPnl: 6660 },
      ],
      totals: { unrealizedPnl: 9999 },
    },
  });
  // Per-row sum wins over totals when rows have finite values.
  assert.equal(model.positions.unrealizedPnl, 3182.1 + 6660);
  assert.equal(model.positions.count, 2);
});

test("absent positions response yields null (renders '—'), not 0", () => {
  const model = buildAccountReturnsModel({ positionsResponse: undefined });
  assert.equal(model.positions.unrealizedPnl, null);
  assert.equal(model.positions.count, 0);
});

test("degraded response with empty rows but populated totals uses totals", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [],
      totals: { unrealizedPnl: 3182.1 },
    },
  });
  assert.equal(model.positions.unrealizedPnl, 3182.1);
});

test("present response with open rows lacking unrealized falls back to totals", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [{ quantity: 10, unrealizedPnl: null }],
      totals: { unrealizedPnl: 1234.5 },
    },
  });
  assert.equal(model.positions.unrealizedPnl, 1234.5);
});

test("present response with no rows and no totals is unknown (null), not 0", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: { positions: [], totals: {} },
  });
  assert.equal(model.positions.unrealizedPnl, null);
});

test("genuinely flat account (rows report zero) reports 0, not null", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [{ quantity: 10, unrealizedPnl: 0 }],
      totals: { unrealizedPnl: 0 },
    },
  });
  assert.equal(model.positions.unrealizedPnl, 0);
});
