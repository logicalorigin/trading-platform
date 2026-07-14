import assert from "node:assert/strict";
import test from "node:test";

import type { IbkrRuntimeConfig } from "../../lib/runtime";
import { IbkrClient } from "./client";

const ACCOUNT_ID = "DU1234567";

function config(): IbkrRuntimeConfig {
  return {
    baseUrl: "http://127.0.0.1:15000/v1/api",
    bearerToken: null,
    cookie: null,
    defaultAccountId: null,
    extOperator: null,
    extraHeaders: {},
    username: null,
    password: null,
    allowInsecureTls: true,
    paperAccountOnly: true,
  };
}

function equityPosition(index: number) {
  return {
    acctId: ACCOUNT_ID,
    conid: 100_000 + index,
    secType: "STK",
    assetClass: "STK",
    position: 1,
    ticker: `T${index}`,
    avgPrice: 10,
    mktPrice: 11,
    mktValue: 11,
    unrealizedPnl: 1,
  };
}

function equityOrder(index: number) {
  return {
    orderId: String(900_000 + index),
    acct: ACCOUNT_ID,
    conid: 265_598,
    ticker: "AAPL",
    secType: "STK",
    side: "SELL",
    origOrderType: "LMT",
    timeInForce: "GTC",
    order_ccp_status: "Submitted",
    totalSize: 10,
    filledQuantity: 0,
    remainingQuantity: 10,
    price: 200,
  };
}

function optionContractInfo(input: {
  conid: number;
  right: "C" | "P";
  tradingClass?: string;
}) {
  return {
    con_id: input.conid,
    instrument_type: "OPT",
    symbol: "AAPL",
    maturity_date: "20260821",
    strike: 200,
    right: input.right,
    multiplier: "100",
    trading_class: input.tradingClass ?? "AAPL",
    local_symbol: `AAPL  260821${input.right}00200000`,
    currency: "USD",
    contract_clarification_type: null,
  };
}

function commonResponse(path: string): Response | null {
  if (path.endsWith("/portfolio/accounts")) {
    return Response.json([{ accountId: ACCOUNT_ID, currency: "USD" }]);
  }
  if (path.endsWith(`/portfolio/${ACCOUNT_ID}/summary`)) {
    return Response.json({ settledcash: { amount: 25_000 } });
  }
  if (path.endsWith(`/portfolio/${ACCOUNT_ID}/ledger`)) {
    return Response.json({
      USD: { currency: "USD", settledcash: 25_000 },
      BASE: { currency: "USD", settledcash: 25_000 },
    });
  }
  if (path.endsWith("/iserver/accounts")) {
    return Response.json({
      accounts: [ACCOUNT_ID],
      selectedAccount: ACCOUNT_ID,
    });
  }
  return null;
}

test("IBKR risk state proves a near-real-time position read and fresh order snapshot", async () => {
  const previousFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  let ordersForceQuery: string | null = null;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    requestedPaths.push(path);
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json(
        Array.from({ length: 101 }, (_, index) => equityPosition(index)),
      );
    }
    if (path.endsWith("/iserver/account/orders")) {
      ordersForceQuery = url.searchParams.get("force");
      return Response.json({ snapshot: true, orders: [equityOrder(1)] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  const startedAt = Date.now();
  try {
    const state = await new IbkrClient(config()).readAccountRiskState({
      accountId: ACCOUNT_ID,
      mode: "live",
    });
    const finishedAt = Date.now();

    assert.equal(state.accountId, ACCOUNT_ID);
    assert.equal(state.mode, "live");
    assert.equal(state.positionsComplete, true);
    assert.equal(state.positions.length, 101);
    assert.equal(state.ordersComplete, true);
    assert.equal(state.orders.length, 1);
    assert.equal(state.orders[0]?.id, "900001");
    assert.equal(state.settledCashUsd, 25_000);
    assert.equal(state.optionCollateralContractsVerified, true);
    assert.deepEqual(state.verifiedStandardOptionContractIds, []);
    for (const observedAt of [
      state.positionsObservedAt,
      state.ordersObservedAt,
      state.settledCashObservedAt,
    ]) {
      assert.ok(observedAt instanceof Date);
      assert.ok(observedAt.getTime() >= startedAt);
      assert.ok(observedAt.getTime() <= finishedAt);
    }
    assert.equal(ordersForceQuery, "true");
    assert.ok(
      requestedPaths.some((path) =>
        path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`),
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state rejects a non-snapshot or capped order response", async () => {
  for (const ordersPayload of [
    { snapshot: false, orders: [] },
    {
      snapshot: true,
      orders: Array.from({ length: 1_000 }, (_, index) => equityOrder(index)),
    },
  ]) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const path = new URL(String(input)).pathname;
      const common = commonResponse(path);
      if (common) return common;
      if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
        return Response.json([]);
      }
      if (path.endsWith("/iserver/account/orders")) {
        return Response.json(ordersPayload);
      }
      throw new Error(`unexpected IBKR request: ${path}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          new IbkrClient(config()).readAccountRiskState({
            accountId: ACCOUNT_ID,
            mode: "live",
          }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_orders_snapshot_incomplete",
          );
          return true;
        },
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  }
});

test("IBKR risk state rejects malformed position evidence", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([{ ...equityPosition(1), position: null }]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({ snapshot: true, orders: [] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        new IbkrClient(config()).readAccountRiskState({
          accountId: ACCOUNT_ID,
          mode: "live",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_positions_snapshot_invalid",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state rejects duplicate positions", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([equityPosition(0), equityPosition(0)]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({ snapshot: true, orders: [] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        new IbkrClient(config()).readAccountRiskState({
          accountId: ACCOUNT_ID,
          mode: "live",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_positions_snapshot_invalid",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state keeps partially filled stop-limit orders fully reserved", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        snapshot: true,
        orders: [
          {
            ...equityOrder(3),
            origOrderType: "STP LMT",
            order_ccp_status: "PartiallyFilled",
            totalSize: 10,
            filledQuantity: 2,
            remainingQuantity: 8,
            price: 205,
            auxPrice: 200,
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const state = await new IbkrClient(config()).readAccountRiskState({
      accountId: ACCOUNT_ID,
      mode: "live",
    });
    assert.deepEqual(
      {
        status: state.orders[0]?.status,
        type: state.orders[0]?.type,
        quantity: state.orders[0]?.quantity,
        filledQuantity: state.orders[0]?.filledQuantity,
        limitPrice: state.orders[0]?.limitPrice,
        stopPrice: state.orders[0]?.stopPrice,
      },
      {
        status: "partially_filled",
        type: "stop_limit",
        quantity: 10,
        filledQuantity: 2,
        limitPrice: 205,
        stopPrice: 200,
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state never drops a filled label with a positive remainder", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        snapshot: true,
        orders: [
          {
            ...equityOrder(6),
            order_ccp_status: "Filled",
            totalSize: 10,
            filledQuantity: 0,
            remainingQuantity: 10,
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const state = await new IbkrClient(config()).readAccountRiskState({
      accountId: ACCOUNT_ID,
      mode: "live",
    });
    assert.equal(state.orders.length, 1);
    assert.equal(state.orders[0]?.status, "pending_submit");
    assert.equal(state.orders[0]?.quantity, 10);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state hydrates each option conid once from full contract details", async () => {
  const previousFetch = globalThis.fetch;
  let contractInfoRequests = 0;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([
        {
          acctId: ACCOUNT_ID,
          conid: 700_001,
          secType: "OPT",
          assetClass: "OPT",
          position: -1,
          avgPrice: 2,
          mktPrice: 3,
          mktValue: -300,
          unrealizedPnl: -100,
        },
      ]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        snapshot: true,
        orders: [
          {
            orderId: "900002",
            acct: ACCOUNT_ID,
            conid: 700_001,
            secType: "OPT",
            side: "SELL",
            origOrderType: "LMT",
            timeInForce: "GTC",
            order_ccp_status: "Submitted",
            totalSize: 1,
            filledQuantity: 0,
            remainingQuantity: 1,
            price: 2,
          },
        ],
      });
    }
    if (path.endsWith("/iserver/contract/700001/info")) {
      contractInfoRequests += 1;
      return Response.json(optionContractInfo({ conid: 700_001, right: "P" }));
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const state = await new IbkrClient(config()).readAccountRiskState({
      accountId: ACCOUNT_ID,
      mode: "live",
    });

    assert.equal(contractInfoRequests, 1);
    assert.equal(state.optionCollateralContractsVerified, true);
    assert.deepEqual(state.verifiedStandardOptionContractIds, ["700001"]);
    for (const contract of [
      state.positions[0]?.optionContract,
      state.orders[0]?.optionContract,
    ]) {
      assert.equal(contract?.providerContractId, "700001");
      assert.equal(contract?.underlying, "AAPL");
      assert.equal(
        contract?.expirationDate.toISOString().slice(0, 10),
        "2026-08-21",
      );
      assert.equal(contract?.strike, 200);
      assert.equal(contract?.right, "put");
      assert.equal(contract?.sharesPerContract, 100);
      assert.equal(contract?.standardDeliverableVerified, true);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state verifies every collateral-bearing put as a standard contract", async () => {
  for (const [tradingClass, expectedVerified] of [
    ["AAPL", true],
    ["AAPL1", false],
  ] as const) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const path = new URL(String(input)).pathname;
      const common = commonResponse(path);
      if (common) return common;
      if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
        return Response.json([]);
      }
      if (path.endsWith("/iserver/account/orders")) {
        return Response.json({
          snapshot: true,
          orders: [
            {
              orderId: "900002",
              acct: ACCOUNT_ID,
              conid: 700_002,
              secType: "OPT",
              side: "SELL",
              origOrderType: "LMT",
              timeInForce: "GTC",
              order_ccp_status: "Submitted",
              totalSize: 1,
              filledQuantity: 0,
              remainingQuantity: 1,
              price: 2,
            },
          ],
        });
      }
      if (path.endsWith("/iserver/contract/700002/info")) {
        return Response.json(
          optionContractInfo({
            conid: 700_002,
            right: "P",
            tradingClass,
          }),
        );
      }
      throw new Error(`unexpected IBKR request: ${path}`);
    }) as typeof fetch;

    try {
      const state = await new IbkrClient(config()).readAccountRiskState({
        accountId: ACCOUNT_ID,
        mode: "live",
      });
      assert.equal(state.optionCollateralContractsVerified, expectedVerified);
      assert.deepEqual(
        state.verifiedStandardOptionContractIds,
        expectedVerified ? ["700002"] : [],
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  }
});

test("IBKR risk state rejects mismatched option contract details", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([
        {
          acctId: ACCOUNT_ID,
          conid: 700_001,
          secType: "OPT",
          assetClass: "OPT",
          position: 1,
        },
      ]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({ snapshot: true, orders: [] });
    }
    if (path.endsWith("/iserver/contract/700001/info")) {
      return Response.json(optionContractInfo({ conid: 700_999, right: "C" }));
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        new IbkrClient(config()).readAccountRiskState({
          accountId: ACCOUNT_ID,
          mode: "live",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_option_contract_info_invalid",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state rejects an unknown order status", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        snapshot: true,
        orders: [
          {
            ...equityOrder(4),
            order_ccp_status: "MysteryState",
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        new IbkrClient(config()).readAccountRiskState({
          accountId: ACCOUNT_ID,
          mode: "live",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_orders_snapshot_invalid",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state ignores terminal orders with unsupported instructions", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        snapshot: true,
        orders: [
          {
            orderId: "900005",
            acct: ACCOUNT_ID,
            conid: 700_005,
            secType: "OPT",
            side: "SELL",
            origOrderType: "TRAIL",
            timeInForce: "GTD",
            order_ccp_status: "Filled",
            totalSize: 1,
            filledQuantity: 1,
            remainingQuantity: 0,
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const state = await new IbkrClient(config()).readAccountRiskState({
      accountId: ACCOUNT_ID,
      mode: "live",
    });
    assert.deepEqual(state.orders, []);
    assert.deepEqual(state.verifiedStandardOptionContractIds, []);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR risk state verifies a selected STO contract absent from account state", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const common = commonResponse(path);
    if (common) return common;
    if (path.endsWith(`/portfolio2/${ACCOUNT_ID}/positions`)) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({ snapshot: true, orders: [] });
    }
    if (path.endsWith("/iserver/contract/700001/info")) {
      return Response.json(optionContractInfo({ conid: 700_001, right: "P" }));
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const state = await new IbkrClient(config()).readAccountRiskState({
      accountId: ACCOUNT_ID,
      mode: "live",
      selectedOptionContractId: "700001",
    });
    assert.deepEqual(state.verifiedStandardOptionContractIds, ["700001"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
