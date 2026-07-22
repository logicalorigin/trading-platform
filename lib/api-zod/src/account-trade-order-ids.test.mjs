import assert from "node:assert/strict";
import test from "node:test";

import { GetAccountClosedTradesResponse } from "./generated/api.ts";

const trade = (id, orderIds) => ({
  id,
  source: "LIVE_EXECUTION",
  accountId: "U123",
  symbol: "AAPL",
  side: "sell",
  assetClass: "Stocks",
  positionType: "stock",
  quantity: 1,
  openDate: "2026-07-16T14:00:00.000Z",
  closeDate: "2026-07-16T15:00:00.000Z",
  avgOpen: 100,
  avgClose: 105,
  realizedPnl: 5,
  realizedPnlPercent: 5,
  holdDurationMinutes: 60,
  commissions: null,
  currency: "USD",
  ...(orderIds ? { orderIds } : {}),
});

test("AccountTrade accepts optional orderIds and preserves their stable order", () => {
  const result = GetAccountClosedTradesResponse.safeParse({
    accountId: "U123",
    currency: "USD",
    trades: [
      trade("linked", ["execution:entry-1", "execution:exit-1"]),
      trade("unlinked"),
    ],
    summary: {},
    updatedAt: "2026-07-16T15:00:00.000Z",
  });

  assert.equal(result.success, true, result.success ? undefined : result.error.message);
  assert.deepEqual(result.data.trades[0]?.orderIds, [
    "execution:entry-1",
    "execution:exit-1",
  ]);
  assert.equal(result.data.trades[1]?.orderIds, undefined);
});

test("AccountTrade restricts direction and commission cost semantics", () => {
  const response = (accountTrade) => ({
    accountId: "U123",
    currency: "USD",
    trades: [accountTrade],
    summary: {},
    updatedAt: "2026-07-16T15:00:00.000Z",
  });

  assert.equal(
    GetAccountClosedTradesResponse.safeParse(
      response({ ...trade("unknown-direction"), side: "unknown" }),
    ).success,
    true,
  );
  assert.equal(
    GetAccountClosedTradesResponse.safeParse(
      response({ ...trade("invalid-direction"), side: "sideways" }),
    ).success,
    false,
  );
  assert.equal(
    GetAccountClosedTradesResponse.safeParse(
      response({ ...trade("negative-fee"), commissions: -1 }),
    ).success,
    false,
  );
});
