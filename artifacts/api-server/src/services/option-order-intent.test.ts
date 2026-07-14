import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  PlaceOrderInput,
} from "../providers/ibkr/client";
import {
  validateSellCallOrderIntent,
  validateSingleLegOrderIntent,
  type OptionOrderAction,
  type SingleLegAccountState,
} from "./option-order-intent";

const NOW = new Date("2026-07-13T22:00:00.000Z");
const FRESH = new Date(NOW.getTime() - 1_000);
const MAX_STATE_AGE_MS = 30_000;

const CALL_CONTRACT = {
  ticker: "O:AAPL260821C00200000",
  underlying: "AAPL",
  expirationDate: new Date("2026-08-21T00:00:00.000Z"),
  strike: 200,
  right: "call" as const,
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "call-200",
  brokerContractId: "broker-call-200",
  standardDeliverableVerified: true,
};

const PUT_CONTRACT = {
  ...CALL_CONTRACT,
  ticker: "O:AAPL260821P00200000",
  right: "put" as const,
  providerContractId: "put-200",
  brokerContractId: "broker-put-200",
};

type TestOrderInput = PlaceOrderInput & {
  optionAction?: OptionOrderAction;
};

function optionOrder(overrides: Partial<TestOrderInput> = {}): TestOrderInput {
  return {
    accountId: "account-1",
    mode: "live",
    symbol: "AAPL",
    assetClass: "option",
    side: "buy",
    type: "limit",
    quantity: 1,
    limitPrice: 5,
    timeInForce: "day",
    optionContract: CALL_CONTRACT,
    optionAction: "buy_to_open",
    positionEffect: "open",
    strategyIntent: "long_option",
    ...overrides,
  };
}

function equityOrder(overrides: Partial<TestOrderInput> = {}): TestOrderInput {
  return {
    accountId: "account-1",
    mode: "live",
    symbol: "AAPL",
    assetClass: "equity",
    side: "buy",
    type: "limit",
    quantity: 1,
    limitPrice: 200,
    timeInForce: "day",
    optionContract: null,
    ...overrides,
  };
}

function equityPosition(
  quantity: number,
  overrides: Partial<BrokerPositionSnapshot> = {},
): BrokerPositionSnapshot {
  return {
    id: "equity-position",
    accountId: "account-1",
    symbol: "AAPL",
    assetClass: "equity",
    quantity,
    averagePrice: 150,
    marketPrice: 200,
    marketValue: quantity * 200,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    optionContract: null,
    ...overrides,
  };
}

function optionPosition(
  quantity: number,
  contract: NonNullable<
    BrokerPositionSnapshot["optionContract"]
  > = CALL_CONTRACT,
  overrides: Partial<BrokerPositionSnapshot> = {},
): BrokerPositionSnapshot {
  return {
    id: "option-position",
    accountId: "account-1",
    symbol: contract.ticker,
    assetClass: "option",
    quantity,
    averagePrice: 5,
    marketPrice: 6,
    marketValue: quantity * 600,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    optionContract: contract,
    ...overrides,
  };
}

function workingOrder(
  overrides: Partial<BrokerOrderSnapshot> = {},
): BrokerOrderSnapshot {
  return {
    id: "working-order",
    accountId: "account-1",
    mode: "live",
    symbol: "AAPL",
    assetClass: "equity",
    side: "sell",
    type: "limit",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: 200,
    stopPrice: null,
    placedAt: FRESH,
    updatedAt: FRESH,
    optionContract: null,
    ...overrides,
  };
}

function accountState(
  overrides: Partial<SingleLegAccountState> = {},
): SingleLegAccountState {
  return {
    positions: [],
    orders: [],
    positionsComplete: true,
    ordersComplete: true,
    positionsObservedAt: FRESH,
    ordersObservedAt: FRESH,
    settledCashUsd: 100_000,
    settledCashObservedAt: FRESH,
    optionCollateralContractsVerified: true,
    ...overrides,
  };
}

function validate(
  order: TestOrderInput,
  state: SingleLegAccountState = accountState(),
  replacingOrderId?: string,
  standardOptionDeliverableVerified = true,
) {
  return validateSingleLegOrderIntent({
    order,
    state,
    now: NOW,
    maxStateAgeMs: MAX_STATE_AGE_MS,
    replacingOrderId,
    standardOptionDeliverableVerified,
  });
}

function expectHttpCode(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => {
    const candidate = error as {
      statusCode?: number;
      code?: string;
      data?: unknown;
    };
    assert.equal(candidate.statusCode, 409);
    assert.equal(candidate.code, code);
    return true;
  });
}

test("requires an explicit, internally consistent BTO/BTC/STC/STO action", () => {
  expectHttpCode(
    () => validate(optionOrder({ optionAction: undefined })),
    "option_order_action_required",
  );
  expectHttpCode(
    () => validate(optionOrder({ optionAction: "sell_to_open" })),
    "option_order_action_conflict",
  );
  expectHttpCode(
    () => validate(optionOrder({ positionEffect: "close" })),
    "option_order_action_conflict",
  );
  expectHttpCode(
    () =>
      validate(
        optionOrder({
          side: "sell",
          optionAction: "sell_to_open",
          positionEffect: "open",
          strategyIntent: "uncovered_short_call",
        }),
      ),
    "option_uncovered_short_disabled",
  );
  expectHttpCode(
    () =>
      validate(
        optionOrder({
          quantity: "1" as unknown as number,
        }),
      ),
    "option_order_quantity_invalid",
  );
  expectHttpCode(
    () =>
      validate(
        equityOrder({
          side: "short" as PlaceOrderInput["side"],
        }),
      ),
    "single_leg_order_side_invalid",
  );
  expectHttpCode(
    () => validate(optionOrder({ symbol: "MSFT" })),
    "option_order_underlying_mismatch",
  );
  expectHttpCode(
    () =>
      validate(
        optionOrder({
          optionContract: {
            ...CALL_CONTRACT,
            expirationDate: new Date("2026-07-12T00:00:00.000Z"),
          },
        }),
      ),
    "option_open_contract_expired",
  );
  assert.doesNotThrow(() =>
    validateSingleLegOrderIntent({
      order: optionOrder({
        optionContract: {
          ...CALL_CONTRACT,
          expirationDate: new Date("2026-07-13T00:00:00.000Z"),
        },
      }),
      state: accountState(),
      now: new Date("2026-07-14T01:00:00.000Z"),
      maxStateAgeMs: MAX_STATE_AGE_MS,
      standardOptionDeliverableVerified: true,
    }),
  );
});

test("allows risk-bounded equity buys and BTO without inventory state", () => {
  const unavailableState = accountState({
    positions: null,
    orders: null,
    positionsObservedAt: null,
    ordersObservedAt: null,
  });

  assert.doesNotThrow(() => validate(equityOrder(), unavailableState));
  assert.doesNotThrow(() => validate(optionOrder(), unavailableState));
});

test("fails closed when required position or order state is missing, stale, or cross-account", () => {
  const sell = equityOrder({ side: "sell", quantity: 1 });
  expectHttpCode(
    () => validate(sell, accountState({ positions: null })),
    "trading_positions_unavailable",
  );
  expectHttpCode(
    () =>
      validate(
        sell,
        accountState({
          positionsObservedAt: new Date(NOW.getTime() - MAX_STATE_AGE_MS - 1),
        }),
      ),
    "trading_positions_stale",
  );
  expectHttpCode(
    () => validate(sell, accountState({ orders: null })),
    "trading_orders_unavailable",
  );
  expectHttpCode(
    () => validate(sell, accountState({ positionsComplete: false })),
    "trading_positions_incomplete",
  );
  expectHttpCode(
    () => validate(sell, accountState({ ordersComplete: false })),
    "trading_orders_incomplete",
  );
  expectHttpCode(
    () =>
      validate(
        sell,
        accountState({
          positions: [equityPosition(100, { accountId: "account-2" })],
        }),
      ),
    "trading_state_account_mismatch",
  );
  expectHttpCode(
    () =>
      validate(
        sell,
        accountState({
          positions: [equityPosition(100)],
          orders: [
            workingOrder({
              quantity: "1" as unknown as number,
            }),
          ],
        }),
      ),
    "trading_order_state_invalid",
  );
});

test("equity sells cannot exceed unreserved shares or uncover short calls", () => {
  const sell = equityOrder({ side: "sell", quantity: 41 });
  const pendingCancel = workingOrder({
    id: "pending-equity-sale",
    status: "pending_cancel",
    quantity: 60,
  });
  const state = accountState({
    positions: [equityPosition(100)],
    orders: [pendingCancel],
  });

  expectHttpCode(
    () => validate(sell, state),
    "equity_sell_quantity_exceeds_position",
  );
  expectHttpCode(
    () =>
      validate(
        equityOrder({ side: "sell", quantity: 1 }),
        accountState({
          positions: [
            equityPosition(200),
            optionPosition(-1, {
              ...CALL_CONTRACT,
              standardDeliverableVerified: false,
            }),
          ],
        }),
      ),
    "trading_share_reservation_unverified",
  );
  expectHttpCode(
    () =>
      validate(
        equityOrder({ side: "sell", quantity: 1 }),
        accountState({
          positions: [
            equityPosition(200),
            optionPosition(-1, {
              ...CALL_CONTRACT,
              multiplier: 10,
              sharesPerContract: 10,
            }),
          ],
        }),
      ),
    "trading_share_reservation_unverified",
  );
  assert.doesNotThrow(() => validate({ ...sell, quantity: 40 }, state));

  expectHttpCode(
    () =>
      validate(
        equityOrder({ side: "sell", quantity: 1 }),
        accountState({
          positions: [equityPosition(100), optionPosition(-1)],
        }),
      ),
    "equity_sell_quantity_exceeds_position",
  );
});

test("replacement validation excludes only the working order being replaced", () => {
  const existing = workingOrder({ id: "replace-me", quantity: 100 });
  const state = accountState({
    positions: [equityPosition(100)],
    orders: [existing],
  });

  expectHttpCode(
    () => validate(equityOrder({ side: "sell", quantity: 100 }), state),
    "equity_sell_quantity_exceeds_position",
  );
  assert.doesNotThrow(() =>
    validate(equityOrder({ side: "sell", quantity: 100 }), state, "replace-me"),
  );

  expectHttpCode(
    () =>
      validate(
        equityOrder({ side: "sell", quantity: 101 }),
        state,
        "replace-me",
      ),
    "trading_replacement_order_mismatch",
  );
  expectHttpCode(
    () =>
      validate(
        equityOrder({ side: "sell", quantity: 100 }),
        accountState({
          positions: [equityPosition(100)],
          orders: [
            workingOrder({
              id: "replace-me",
              symbol: "MSFT",
              quantity: 100,
            }),
          ],
        }),
        "replace-me",
      ),
    "trading_replacement_order_mismatch",
  );
});

test("STC and BTC use exact contract inventory and reserve pending-cancel orders", () => {
  const pendingStc = workingOrder({
    id: "pending-stc",
    status: "pending_cancel",
    assetClass: "option",
    symbol: CALL_CONTRACT.ticker,
    side: "sell",
    quantity: 1,
    optionContract: CALL_CONTRACT,
  });
  const longState = accountState({
    positions: [optionPosition(2)],
    orders: [pendingStc],
  });
  const stc = optionOrder({
    side: "sell",
    quantity: 2,
    optionAction: "sell_to_close",
    positionEffect: "close",
    strategyIntent: "sell_to_close",
  });

  expectHttpCode(
    () => validate(stc, longState),
    "option_close_quantity_exceeds_position",
  );
  assert.doesNotThrow(() => validate({ ...stc, quantity: 1 }, longState));

  const differentProviderContract = {
    ...CALL_CONTRACT,
    providerContractId: "different-contract",
  };
  expectHttpCode(
    () =>
      validate(
        { ...stc, quantity: 1 },
        accountState({
          positions: [optionPosition(1, differentProviderContract)],
        }),
      ),
    "option_close_quantity_exceeds_position",
  );

  const topLevelContractIdOrder = workingOrder({
    id: "top-level-contract-id",
    providerContractId: CALL_CONTRACT.providerContractId,
    assetClass: "option",
    symbol: CALL_CONTRACT.ticker,
    side: "sell",
    quantity: 1,
    optionContract: {
      ...CALL_CONTRACT,
      providerContractId: null,
      brokerContractId: null,
    },
  });
  expectHttpCode(
    () =>
      validate(
        stc,
        accountState({
          positions: [optionPosition(2)],
          orders: [topLevelContractIdOrder],
        }),
      ),
    "option_close_quantity_exceeds_position",
  );

  expectHttpCode(
    () =>
      validate(
        stc,
        accountState({
          positions: [optionPosition(2)],
          orders: [
            workingOrder({
              id: "contradictory-contract-id",
              providerContractId: "top-level-id",
              assetClass: "option",
              symbol: CALL_CONTRACT.ticker,
              side: "sell",
              optionContract: CALL_CONTRACT,
            }),
          ],
        }),
      ),
    "trading_option_order_contract_invalid",
  );
  assert.throws(
    () =>
      validateSellCallOrderIntent({
        order: { ...stc, quantity: 1 },
        positions: [optionPosition(2)],
        orders: [
          workingOrder({
            id: "legacy-contradictory-contract-id",
            providerContractId: "top-level-id",
            assetClass: "option",
            symbol: CALL_CONTRACT.ticker,
            side: "sell",
            optionContract: CALL_CONTRACT,
          }),
        ],
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "ibkr_option_order_contract_state_invalid",
      );
      return true;
    },
  );

  const pendingBtc = workingOrder({
    id: "pending-btc",
    status: "pending_cancel",
    assetClass: "option",
    symbol: PUT_CONTRACT.ticker,
    side: "buy",
    quantity: 1,
    optionContract: PUT_CONTRACT,
  });
  const btc = optionOrder({
    optionContract: PUT_CONTRACT,
    quantity: 2,
    optionAction: "buy_to_close",
    positionEffect: "close",
    strategyIntent: undefined,
  });
  expectHttpCode(
    () =>
      validate(
        btc,
        accountState({
          positions: [optionPosition(-2, PUT_CONTRACT)],
          orders: [pendingBtc],
        }),
      ),
    "option_close_quantity_exceeds_position",
  );
});

test("partial working closes reserve their full original quantity during snapshot races", () => {
  const partialStc = workingOrder({
    id: "partial-stc",
    status: "partially_filled",
    assetClass: "option",
    symbol: CALL_CONTRACT.ticker,
    side: "sell",
    quantity: 2,
    filledQuantity: 1,
    optionContract: CALL_CONTRACT,
  });
  const stc = optionOrder({
    side: "sell",
    quantity: 1,
    optionAction: "sell_to_close",
    positionEffect: "close",
    strategyIntent: "sell_to_close",
  });

  expectHttpCode(
    () =>
      validate(
        stc,
        accountState({
          positions: [optionPosition(2)],
          orders: [partialStc],
        }),
      ),
    "option_close_quantity_exceeds_position",
  );

  assert.throws(
    () =>
      validateSellCallOrderIntent({
        order: stc,
        positions: [optionPosition(2)],
        orders: [partialStc],
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "ibkr_sell_to_close_quantity_exceeds_position",
      );
      return true;
    },
  );
});

test("covered-call STO requires explicit intent and unreserved underlying shares", () => {
  const sto = optionOrder({
    side: "sell",
    optionAction: "sell_to_open",
    positionEffect: "open",
    strategyIntent: "covered_call",
  });
  assert.doesNotThrow(() =>
    validate(
      sto,
      accountState({
        positions: [equityPosition(200), optionPosition(-1)],
      }),
    ),
  );

  expectHttpCode(
    () =>
      validate(
        { ...sto, strategyIntent: undefined },
        accountState({ positions: [equityPosition(100)] }),
      ),
    "option_sell_to_open_strategy_required",
  );

  const pendingCallSale = workingOrder({
    assetClass: "option",
    symbol: CALL_CONTRACT.ticker,
    side: "sell",
    status: "pending_cancel",
    optionContract: CALL_CONTRACT,
  });
  expectHttpCode(
    () =>
      validate(
        sto,
        accountState({
          positions: [equityPosition(100)],
          orders: [pendingCallSale],
        }),
      ),
    "option_covered_call_insufficient_shares",
  );
  expectHttpCode(
    () =>
      validate(
        sto,
        accountState({
          positions: [
            equityPosition(300),
            optionPosition(-1, {
              ...CALL_CONTRACT,
              standardDeliverableVerified: false,
            }),
          ],
        }),
      ),
    "trading_share_reservation_unverified",
  );
});

test("cash-secured-put STO uses fresh settled USD cash after conservative reservations", () => {
  const sto = optionOrder({
    optionContract: PUT_CONTRACT,
    side: "sell",
    optionAction: "sell_to_open",
    positionEffect: "open",
    strategyIntent: "cash_secured_put",
  });
  const existingShortPut = optionPosition(-1, {
    ...PUT_CONTRACT,
    ticker: "O:MSFT260821P00100000",
    underlying: "MSFT",
    strike: 100,
    providerContractId: "msft-put-100",
    brokerContractId: "broker-msft-put-100",
  });
  const pendingPutSale = workingOrder({
    id: "pending-put-sale",
    status: "pending_cancel",
    assetClass: "option",
    symbol: "O:NVDA260821P00050000",
    side: "sell",
    quantity: 1,
    optionContract: {
      ...PUT_CONTRACT,
      ticker: "O:NVDA260821P00050000",
      underlying: "NVDA",
      strike: 50,
      providerContractId: "nvda-put-50",
      brokerContractId: "broker-nvda-put-50",
    },
  });
  const pendingEquityBuy = workingOrder({
    id: "pending-equity-buy",
    side: "buy",
    quantity: 50,
    limitPrice: 100,
  });
  const reservedState = accountState({
    positions: [existingShortPut],
    orders: [pendingPutSale, pendingEquityBuy],
    settledCashUsd: 40_000,
  });

  assert.doesNotThrow(() =>
    validate(
      {
        ...sto,
        optionContract: { ...PUT_CONTRACT, strike: 200 },
        quantity: 1,
      },
      reservedState,
    ),
  );
  expectHttpCode(
    () => validate({ ...sto, quantity: 2 }, reservedState),
    "option_cash_secured_put_insufficient_cash",
  );

  expectHttpCode(
    () =>
      validate(
        sto,
        accountState({
          settledCashObservedAt: new Date(NOW.getTime() - MAX_STATE_AGE_MS - 1),
        }),
      ),
    "trading_cash_stale",
  );
  expectHttpCode(
    () =>
      validate(sto, accountState({ optionCollateralContractsVerified: false })),
    "trading_cash_reservation_unverified",
  );
  expectHttpCode(
    () =>
      validate(
        sto,
        accountState({
          positions: [
            equityPosition(-1, {
              id: "short-msft",
              symbol: "MSFT",
            }),
          ],
        }),
      ),
    "trading_cash_reservation_unmodeled",
  );
  expectHttpCode(
    () =>
      validate(
        sto,
        accountState({
          positions: [
            optionPosition(-1, {
              ...CALL_CONTRACT,
              ticker: "O:MSFT260821C00200000",
              underlying: "MSFT",
              providerContractId: "msft-call-200",
              brokerContractId: "broker-msft-call-200",
            }),
          ],
        }),
      ),
    "trading_cash_reservation_unmodeled",
  );
  assert.doesNotThrow(() =>
    validate(
      sto,
      accountState({
        positions: [
          equityPosition(100, {
            id: "msft-shares",
            symbol: "MSFT",
          }),
          optionPosition(-1, {
            ...CALL_CONTRACT,
            ticker: "O:MSFT260821C00200000",
            underlying: "MSFT",
            providerContractId: "msft-call-200",
            brokerContractId: "broker-msft-call-200",
          }),
        ],
      }),
    ),
  );
});

test("cash-secured puts stop when a working buy has no bounded maximum debit", () => {
  const sto = optionOrder({
    optionContract: PUT_CONTRACT,
    side: "sell",
    optionAction: "sell_to_open",
    positionEffect: "open",
    strategyIntent: "cash_secured_put",
  });
  const marketBuy = workingOrder({
    side: "buy",
    type: "market",
    limitPrice: null,
  });

  expectHttpCode(
    () => validate(sto, accountState({ orders: [marketBuy] })),
    "trading_cash_reservation_unbounded",
  );
});

test("STO rejects nonstandard deliverables until their full economics are modeled", () => {
  const miniCall = {
    ...CALL_CONTRACT,
    multiplier: 10,
    sharesPerContract: 10,
    providerContractId: "mini-call",
    brokerContractId: "broker-mini-call",
  };
  expectHttpCode(
    () =>
      validate(
        optionOrder({
          side: "sell",
          optionContract: miniCall,
          optionAction: "sell_to_open",
          positionEffect: "open",
          strategyIntent: "covered_call",
        }),
        accountState({ positions: [equityPosition(100)] }),
      ),
    "option_sell_to_open_deliverable_unsupported",
  );

  expectHttpCode(
    () =>
      validate(
        optionOrder({
          side: "sell",
          optionAction: "sell_to_open",
          positionEffect: "open",
          strategyIntent: "covered_call",
        }),
        accountState({ positions: [equityPosition(100)] }),
        undefined,
        false,
      ),
    "option_sell_to_open_deliverable_unverified",
  );
});
