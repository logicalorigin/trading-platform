import { resolveNyseCalendarDay } from "@workspace/market-calendar";

import { HttpError } from "../lib/errors";
import { normalizeSymbol } from "../lib/values";
import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  OptionOrderAction as ContractOptionOrderAction,
  OptionOrderPositionEffect as ContractOptionOrderPositionEffect,
  OptionOrderStrategyIntent as ContractOptionOrderStrategyIntent,
  PlaceOrderInput,
} from "../providers/ibkr/client";

export type OptionOrderAction = ContractOptionOrderAction;
export type OptionOrderPositionEffect = ContractOptionOrderPositionEffect;
export type OptionOrderStrategyIntent = ContractOptionOrderStrategyIntent;

export type SingleLegAccountState = {
  positions: readonly BrokerPositionSnapshot[] | null;
  orders: readonly BrokerOrderSnapshot[] | null;
  /** True only after all broker position pages were read. */
  positionsComplete?: boolean;
  /** True only after all open-order pages/scopes were read. */
  ordersComplete?: boolean;
  /** Local completion time of a non-cached broker position read. */
  positionsObservedAt: Date | null;
  /** Local completion time of a non-cached broker open-order read. */
  ordersObservedAt: Date | null;
  /** Raw settled USD cash before this validator's conservative reservations. */
  settledCashUsd?: number | null;
  /** Local completion time of the broker cash read. */
  settledCashObservedAt?: Date | null;
  /** True only when every collateral-bearing put in this exact snapshot was verified. */
  optionCollateralContractsVerified?: boolean;
};

const WORKING_ORDER_STATUSES = new Set<BrokerOrderSnapshot["status"]>([
  "pending_submit",
  "pending_cancel",
  "submitted",
  "accepted",
  "partially_filled",
]);

const KNOWN_ORDER_STATUSES = new Set<BrokerOrderSnapshot["status"]>([
  ...WORKING_ORDER_STATUSES,
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

const OPTION_ACTION_FIELDS: Record<
  OptionOrderAction,
  { side: PlaceOrderInput["side"]; positionEffect: OptionOrderPositionEffect }
> = {
  buy_to_open: { side: "buy", positionEffect: "open" },
  buy_to_close: { side: "buy", positionEffect: "close" },
  sell_to_close: { side: "sell", positionEffect: "close" },
  sell_to_open: { side: "sell", positionEffect: "open" },
};

type ComparableOptionContract = {
  ticker?: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  multiplier?: number;
  sharesPerContract?: number;
  providerContractId?: string | null;
  brokerContractId?: string | null;
};

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function optionTupleKey(contract: ComparableOptionContract): string {
  const providerContractId = String(contract.providerContractId ?? "").trim();
  const brokerContractId = String(contract.brokerContractId ?? "").trim();
  const ticker = String(contract.ticker ?? "")
    .trim()
    .toUpperCase();
  const identity = providerContractId
    ? `provider:${providerContractId}`
    : brokerContractId
      ? `broker:${brokerContractId}`
      : `ticker:${ticker}`;
  return [
    identity,
    normalizeSymbol(contract.underlying),
    dateKey(contract.expirationDate),
    String(Number(contract.strike)),
    contract.right,
    String(Number(contract.multiplier)),
    String(Number(contract.sharesPerContract)),
  ].join(":");
}

function sameOptionContract(
  left: NonNullable<BrokerPositionSnapshot["optionContract"]>,
  right: NonNullable<PlaceOrderInput["optionContract"]>,
): boolean {
  return optionTupleKey(left) === optionTupleKey(right);
}

function orderOptionContract(
  order: BrokerOrderSnapshot,
): BrokerOrderSnapshot["optionContract"] {
  if (!order.optionContract) {
    return null;
  }
  return {
    ...order.optionContract,
    providerContractId:
      order.optionContract.providerContractId ??
      order.providerContractId ??
      null,
  };
}

function requireConsistentOrderContractIds(
  order: BrokerOrderSnapshot,
  code: string,
) {
  if (
    order.providerContractId &&
    order.optionContract?.providerContractId &&
    String(order.providerContractId) !==
      String(order.optionContract.providerContractId)
  ) {
    rejectIntent(
      code,
      "A working option order has contradictory contract identifiers.",
    );
  }
}

function sharesPerContract(
  contract: NonNullable<PlaceOrderInput["optionContract"]>,
): number {
  const shares = Number(contract.sharesPerContract ?? contract.multiplier);
  return Number.isFinite(shares) && shares > 0 ? shares : 100;
}

function conservativeReservedOrderQuantity(order: BrokerOrderSnapshot): number {
  const quantity = Number(order.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  return quantity;
}

function isWorkingSellCallOrderForUnderlying(
  order: BrokerOrderSnapshot,
  underlying: string,
): boolean {
  return Boolean(
    WORKING_ORDER_STATUSES.has(order.status) &&
      order.side === "sell" &&
      order.assetClass === "option" &&
      order.optionContract?.right === "call" &&
      normalizeSymbol(order.optionContract.underlying) === underlying,
  );
}

function isWorkingSellEquityOrderForUnderlying(
  order: BrokerOrderSnapshot,
  underlying: string,
): boolean {
  return Boolean(
    WORKING_ORDER_STATUSES.has(order.status) &&
      order.side === "sell" &&
      order.assetClass === "equity" &&
      !order.optionContract &&
      normalizeSymbol(order.symbol) === underlying,
  );
}

function rejectIntent(
  code: string,
  message: string,
  data?: Record<string, unknown>,
): never {
  throw new HttpError(409, message, {
    code,
    expose: true,
    ...(data ? { data } : {}),
  });
}

function requireValidOptionContract(
  contract: ComparableOptionContract | null | undefined,
  code = "option_contract_invalid",
): asserts contract is ComparableOptionContract {
  const expirationTime =
    contract?.expirationDate instanceof Date
      ? contract.expirationDate.getTime()
      : Number.NaN;
  const multiplier = contract?.multiplier;
  const deliverableShares = contract?.sharesPerContract;
  if (
    !contract ||
    !String(contract.ticker ?? "").trim() ||
    !normalizeSymbol(contract.underlying) ||
    !Number.isFinite(expirationTime) ||
    !Number.isFinite(contract.strike) ||
    contract.strike <= 0 ||
    (contract.right !== "call" && contract.right !== "put") ||
    !Number.isInteger(multiplier) ||
    multiplier <= 0 ||
    !Number.isInteger(deliverableShares) ||
    deliverableShares <= 0
  ) {
    rejectIntent(
      code,
      "The option contract economics are unavailable or invalid.",
    );
  }
}

function requirePositiveOrderQuantity(order: PlaceOrderInput): number {
  const quantity = order.quantity;
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    (order.assetClass === "option" && !Number.isInteger(quantity))
  ) {
    rejectIntent(
      order.assetClass === "option"
        ? "option_order_quantity_invalid"
        : "equity_order_quantity_invalid",
      "The order quantity is invalid.",
    );
  }
  return quantity;
}

function requireFreshObservation(input: {
  resource: "positions" | "orders" | "cash";
  observedAt: Date | null | undefined;
  now: Date;
  maxStateAgeMs: number;
}) {
  if (
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(input.maxStateAgeMs) ||
    input.maxStateAgeMs < 0
  ) {
    throw new HttpError(500, "The trading-state freshness policy is invalid.", {
      code: "trading_state_freshness_policy_invalid",
    });
  }

  const observedAt = input.observedAt;
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    rejectIntent(
      `trading_${input.resource}_freshness_unavailable`,
      `Fresh ${input.resource} state is required for this order.`,
    );
  }

  const ageMs = input.now.getTime() - observedAt.getTime();
  if (ageMs < 0) {
    rejectIntent(
      `trading_${input.resource}_timestamp_invalid`,
      `The ${input.resource} observation timestamp is invalid.`,
    );
  }
  if (ageMs > input.maxStateAgeMs) {
    rejectIntent(
      `trading_${input.resource}_stale`,
      `The ${input.resource} state is too old for this order.`,
      { ageMs, maxStateAgeMs: input.maxStateAgeMs },
    );
  }
}

function validatePositionState(
  position: BrokerPositionSnapshot,
  accountId: string,
) {
  if (position.accountId !== accountId) {
    rejectIntent(
      "trading_state_account_mismatch",
      "The position state does not belong to the selected account.",
    );
  }
  if (!Number.isFinite(position.quantity)) {
    rejectIntent(
      "trading_position_state_invalid",
      "A broker position has an invalid quantity.",
    );
  }
  if (position.assetClass === "option") {
    if (!Number.isInteger(position.quantity)) {
      rejectIntent(
        "trading_position_state_invalid",
        "An option position has a fractional contract quantity.",
      );
    }
    requireValidOptionContract(
      position.optionContract,
      "trading_option_position_contract_invalid",
    );
    return;
  }
  if (position.assetClass !== "equity" || position.optionContract !== null) {
    rejectIntent(
      "trading_position_state_invalid",
      "A broker position has contradictory asset-class data.",
    );
  }
}

function validateOrderState(
  order: BrokerOrderSnapshot,
  accountId: string,
  mode: PlaceOrderInput["mode"],
) {
  if (order.accountId !== accountId) {
    rejectIntent(
      "trading_state_account_mismatch",
      "The working-order state does not belong to the selected account.",
    );
  }
  if (order.mode !== mode) {
    rejectIntent(
      "trading_state_mode_mismatch",
      "The working-order state belongs to a different trading mode.",
    );
  }
  if (!KNOWN_ORDER_STATUSES.has(order.status)) {
    rejectIntent(
      "trading_order_state_invalid",
      "A broker order has an unknown status.",
    );
  }
  if (order.side !== "buy" && order.side !== "sell") {
    rejectIntent(
      "trading_order_state_invalid",
      "A broker order has an invalid side.",
    );
  }
  if (!WORKING_ORDER_STATUSES.has(order.status)) {
    return;
  }

  const quantity = order.quantity;
  const filledQuantity = order.filledQuantity;
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(filledQuantity) ||
    filledQuantity < 0 ||
    filledQuantity > quantity ||
    (order.assetClass === "option" && !Number.isInteger(quantity))
  ) {
    rejectIntent(
      "trading_order_state_invalid",
      "A working broker order has invalid quantity data.",
    );
  }
  if (order.assetClass === "option") {
    requireConsistentOrderContractIds(
      order,
      "trading_option_order_contract_invalid",
    );
    requireValidOptionContract(
      orderOptionContract(order),
      "trading_option_order_contract_invalid",
    );
    return;
  }
  if (order.assetClass !== "equity" || order.optionContract !== null) {
    rejectIntent(
      "trading_order_state_invalid",
      "A working broker order has contradictory asset-class data.",
    );
  }
}

function validateReplacementExclusion(
  replacement: BrokerOrderSnapshot | undefined,
  requested: PlaceOrderInput,
) {
  const sameEquity =
    replacement?.assetClass === "equity" &&
    requested.assetClass === "equity" &&
    normalizeSymbol(replacement.symbol) === normalizeSymbol(requested.symbol);
  const sameOption =
    replacement?.assetClass === "option" &&
    requested.assetClass === "option" &&
    replacement.optionAction === requested.optionAction &&
    replacement.positionEffect === requested.positionEffect &&
    orderOptionContract(replacement) &&
    requested.optionContract &&
    sameOptionContract(
      orderOptionContract(replacement)!,
      requested.optionContract,
    );
  if (
    !replacement ||
    (replacement.status !== "submitted" && replacement.status !== "accepted") ||
    replacement.filledQuantity !== 0 ||
    replacement.side !== requested.side ||
    replacement.type !== requested.type ||
    replacement.timeInForce !== requested.timeInForce ||
    replacement.quantity !== requested.quantity ||
    (!sameEquity && !sameOption)
  ) {
    rejectIntent(
      "trading_replacement_order_mismatch",
      "The replacement does not match one fully unfilled working order.",
    );
  }
}

function requireInventoryState(input: {
  order: PlaceOrderInput;
  state: SingleLegAccountState;
  now: Date;
  maxStateAgeMs: number;
  replacingOrderId?: string;
}) {
  if (!Array.isArray(input.state.positions)) {
    rejectIntent(
      "trading_positions_unavailable",
      "Current broker positions are required for this order.",
    );
  }
  if (!Array.isArray(input.state.orders)) {
    rejectIntent(
      "trading_orders_unavailable",
      "Current broker orders are required for this order.",
    );
  }
  if (input.state.positionsComplete !== true) {
    rejectIntent(
      "trading_positions_incomplete",
      "The broker position snapshot is incomplete.",
    );
  }
  if (input.state.ordersComplete !== true) {
    rejectIntent(
      "trading_orders_incomplete",
      "The broker open-order snapshot is incomplete.",
    );
  }
  requireFreshObservation({
    resource: "positions",
    observedAt: input.state.positionsObservedAt,
    now: input.now,
    maxStateAgeMs: input.maxStateAgeMs,
  });
  requireFreshObservation({
    resource: "orders",
    observedAt: input.state.ordersObservedAt,
    now: input.now,
    maxStateAgeMs: input.maxStateAgeMs,
  });

  const positions = input.state.positions;
  const orders = input.state.orders;
  for (const position of positions) {
    validatePositionState(position, input.order.accountId);
  }

  const orderIds = new Set<string>();
  for (const order of orders) {
    if (!order.id || orderIds.has(order.id)) {
      rejectIntent(
        "trading_order_state_invalid",
        "The broker order snapshot contains a missing or duplicate order id.",
      );
    }
    orderIds.add(order.id);
    validateOrderState(order, input.order.accountId, input.order.mode);
  }

  if (input.replacingOrderId) {
    validateReplacementExclusion(
      orders.find((order) => order.id === input.replacingOrderId),
      input.order,
    );
  }

  const workingOrders = orders.filter(
    (order) =>
      WORKING_ORDER_STATUSES.has(order.status) &&
      order.id !== input.replacingOrderId,
  );
  return { positions, workingOrders };
}

function requireOptionAction(
  order: PlaceOrderInput,
  contract: ComparableOptionContract,
): OptionOrderAction {
  const action = order.optionAction as OptionOrderAction | undefined;
  if (!action) {
    rejectIntent(
      "option_order_action_required",
      "Choose an explicit BTO, BTC, STC, or STO option action.",
    );
  }
  const expected = OPTION_ACTION_FIELDS[action];
  if (!expected) {
    rejectIntent(
      "option_order_action_invalid",
      "The selected option action is invalid.",
    );
  }
  if (
    order.side !== expected.side ||
    order.positionEffect !== expected.positionEffect
  ) {
    rejectIntent(
      "option_order_action_conflict",
      "The option action conflicts with its side or position effect.",
      {
        optionAction: action,
        side: order.side,
        positionEffect: order.positionEffect ?? null,
      },
    );
  }

  const strategyIntent = order.strategyIntent ?? null;
  if (
    strategyIntent === "uncovered_short_call" ||
    strategyIntent === "uncovered_short_put"
  ) {
    rejectIntent(
      "option_uncovered_short_disabled",
      "Naked short option orders are disabled.",
    );
  }

  const allowedStrategy =
    action === "buy_to_open"
      ? "long_option"
      : action === "sell_to_close"
        ? "sell_to_close"
        : null;
  if (action !== "sell_to_open") {
    if (strategyIntent !== null && strategyIntent !== allowedStrategy) {
      rejectIntent(
        "option_order_strategy_conflict",
        "The option strategy conflicts with the selected action.",
      );
    }
    return action;
  }

  const requiredStrategy =
    contract.right === "call" ? "covered_call" : "cash_secured_put";
  if (strategyIntent === null) {
    rejectIntent(
      "option_sell_to_open_strategy_required",
      "STO requires an explicit covered-call or cash-secured-put strategy.",
    );
  }
  if (strategyIntent !== requiredStrategy) {
    rejectIntent(
      "option_order_strategy_conflict",
      "The STO strategy conflicts with the selected option right.",
    );
  }
  return action;
}

function requireOpenContractNotExpired(input: {
  action: OptionOrderAction;
  contract: ComparableOptionContract;
  now: Date;
}) {
  if (input.action !== "buy_to_open" && input.action !== "sell_to_open") {
    return;
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new HttpError(500, "The order evaluation time is invalid.", {
      code: "trading_evaluation_time_invalid",
    });
  }
  const marketDay = resolveNyseCalendarDay(input.now);
  if (!marketDay) {
    throw new HttpError(500, "The U.S. market date is unavailable.", {
      code: "trading_market_date_unavailable",
    });
  }
  if (dateKey(input.contract.expirationDate) < marketDay.date) {
    rejectIntent(
      "option_open_contract_expired",
      "An expired option contract cannot be opened.",
    );
  }
}

function workingOrderQuantity(order: BrokerOrderSnapshot): number {
  return Number(order.quantity);
}

function buildEquityShareCapacity(input: {
  underlying: string;
  positions: readonly BrokerPositionSnapshot[];
  workingOrders: readonly BrokerOrderSnapshot[];
}) {
  const underlying = normalizeSymbol(input.underlying);
  const netUnderlyingShares = input.positions
    .filter(
      (position) =>
        position.assetClass === "equity" &&
        normalizeSymbol(position.symbol) === underlying,
    )
    .reduce((sum, position) => sum + Number(position.quantity), 0);
  const existingShortCallShares = input.positions
    .filter(
      (position) =>
        position.assetClass === "option" &&
        position.optionContract?.right === "call" &&
        normalizeSymbol(position.optionContract.underlying) === underlying &&
        Number(position.quantity) < 0,
    )
    .reduce(
      (sum, position) =>
        sum +
        Math.abs(Number(position.quantity)) *
          Number(position.optionContract?.sharesPerContract),
      0,
    );
  const workingSellCallShares = input.workingOrders
    .filter(
      (order) =>
        order.assetClass === "option" &&
        order.side === "sell" &&
        order.optionContract?.right === "call" &&
        normalizeSymbol(order.optionContract.underlying) === underlying,
    )
    .reduce(
      (sum, order) =>
        sum +
        workingOrderQuantity(order) *
          Number(order.optionContract?.sharesPerContract),
      0,
    );
  const workingEquitySellShares = input.workingOrders
    .filter(
      (order) =>
        order.assetClass === "equity" &&
        order.side === "sell" &&
        normalizeSymbol(order.symbol) === underlying,
    )
    .reduce((sum, order) => sum + workingOrderQuantity(order), 0);
  const reservedShares =
    existingShortCallShares + workingSellCallShares + workingEquitySellShares;

  return {
    underlying,
    netUnderlyingShares,
    existingShortCallShares,
    workingSellCallShares,
    workingEquitySellShares,
    reservedShares,
    availableShares: Math.max(0, netUnderlyingShares - reservedShares),
  };
}

function buildOptionCloseCapacity(input: {
  action: "buy_to_close" | "sell_to_close";
  contract: NonNullable<PlaceOrderInput["optionContract"]>;
  positions: readonly BrokerPositionSnapshot[];
  workingOrders: readonly BrokerOrderSnapshot[];
}) {
  const netContracts = input.positions
    .filter(
      (position) =>
        position.assetClass === "option" &&
        position.optionContract &&
        sameOptionContract(position.optionContract, input.contract),
    )
    .reduce((sum, position) => sum + Number(position.quantity), 0);
  const heldContracts =
    input.action === "sell_to_close"
      ? Math.max(0, netContracts)
      : Math.max(0, -netContracts);
  const reservationSide = input.action === "sell_to_close" ? "sell" : "buy";
  const reservedContracts = input.workingOrders
    .filter(
      (order) =>
        order.assetClass === "option" &&
        order.side === reservationSide &&
        orderOptionContract(order) &&
        sameOptionContract(orderOptionContract(order)!, input.contract),
    )
    .reduce((sum, order) => sum + workingOrderQuantity(order), 0);

  return {
    netContracts,
    heldContracts,
    reservedContracts,
    availableContracts: Math.max(0, heldContracts - reservedContracts),
  };
}

function requireStandardSellToOpenDeliverable(
  contract: ComparableOptionContract,
  standardOptionDeliverableVerified: boolean | undefined,
) {
  if (standardOptionDeliverableVerified !== true) {
    rejectIntent(
      "option_sell_to_open_deliverable_unverified",
      "STO requires broker-verified standard option deliverables.",
    );
  }
  // ponytail: STO is capped at standard 100-share equity-option deliverables;
  // lift this only after the contract model represents every adjusted cash/share deliverable.
  if (contract.multiplier !== 100 || contract.sharesPerContract !== 100) {
    rejectIntent(
      "option_sell_to_open_deliverable_unsupported",
      "STO currently supports only standard 100-share option deliverables.",
    );
  }
}

function requireModeledPutCollateral(
  contract: ComparableOptionContract,
): number {
  if (contract.multiplier !== 100 || contract.sharesPerContract !== 100) {
    rejectIntent(
      "trading_cash_reservation_unmodeled",
      "Existing adjusted put collateral cannot be modeled safely.",
    );
  }
  return Number(contract.strike) * Number(contract.sharesPerContract);
}

function maximumWorkingBuyDebit(order: BrokerOrderSnapshot): number {
  if (order.type !== "limit" && order.type !== "stop_limit") {
    rejectIntent(
      "trading_cash_reservation_unbounded",
      "A working buy order has no bounded maximum debit.",
      { orderId: order.id },
    );
  }
  const limitPrice = Number(order.limitPrice);
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
    rejectIntent(
      "trading_cash_reservation_unbounded",
      "A working buy order has no valid maximum debit.",
      { orderId: order.id },
    );
  }
  const multiplier =
    order.assetClass === "option"
      ? Number(order.optionContract?.multiplier)
      : 1;
  const maximumDebit = workingOrderQuantity(order) * limitPrice * multiplier;
  if (!Number.isFinite(maximumDebit) || maximumDebit < 0) {
    rejectIntent(
      "trading_cash_reservation_unbounded",
      "A working buy order debit cannot be modeled safely.",
      { orderId: order.id },
    );
  }
  return maximumDebit;
}

function requireCashAccountRiskModeled(input: {
  positions: readonly BrokerPositionSnapshot[];
  workingOrders: readonly BrokerOrderSnapshot[];
}) {
  const equitySharesBySymbol = new Map<string, number>();
  for (const position of input.positions) {
    if (position.assetClass !== "equity") continue;
    const symbol = normalizeSymbol(position.symbol);
    equitySharesBySymbol.set(
      symbol,
      (equitySharesBySymbol.get(symbol) ?? 0) + Number(position.quantity),
    );
  }
  if (
    Array.from(equitySharesBySymbol.values()).some((quantity) => quantity < 0)
  ) {
    rejectIntent(
      "trading_cash_reservation_unmodeled",
      "Net short equity makes settled-cash collateral unsafe to infer.",
    );
  }

  const callUnderlyings = new Set<string>();
  for (const position of input.positions) {
    if (
      position.assetClass === "option" &&
      position.optionContract?.right === "call" &&
      Number(position.quantity) < 0
    ) {
      callUnderlyings.add(normalizeSymbol(position.optionContract.underlying));
    }
  }
  for (const order of input.workingOrders) {
    if (
      order.assetClass === "option" &&
      order.side === "sell" &&
      order.optionContract?.right === "call"
    ) {
      callUnderlyings.add(normalizeSymbol(order.optionContract.underlying));
    }
  }
  for (const underlying of callUnderlyings) {
    const capacity = buildEquityShareCapacity({ underlying, ...input });
    if (capacity.netUnderlyingShares < capacity.reservedShares) {
      rejectIntent(
        "trading_cash_reservation_unmodeled",
        "An uncovered call obligation makes settled-cash collateral unsafe to infer.",
        { underlying },
      );
    }
  }
}

function buildCashSecuredPutCapacity(input: {
  positions: readonly BrokerPositionSnapshot[];
  workingOrders: readonly BrokerOrderSnapshot[];
  settledCashUsd: number;
}) {
  requireCashAccountRiskModeled(input);
  const existingShortPutCollateral = input.positions
    .filter(
      (position) =>
        position.assetClass === "option" &&
        position.optionContract?.right === "put" &&
        Number(position.quantity) < 0,
    )
    .reduce(
      (sum, position) =>
        sum +
        Math.abs(Number(position.quantity)) *
          requireModeledPutCollateral(position.optionContract!),
      0,
    );
  const workingSellPutCollateral = input.workingOrders
    .filter(
      (order) =>
        order.assetClass === "option" &&
        order.side === "sell" &&
        order.optionContract?.right === "put",
    )
    .reduce(
      (sum, order) =>
        sum +
        workingOrderQuantity(order) *
          requireModeledPutCollateral(order.optionContract!),
      0,
    );
  const workingBuyDebits = input.workingOrders
    .filter((order) => order.side === "buy")
    .reduce((sum, order) => sum + maximumWorkingBuyDebit(order), 0);
  const reservedCashUsd =
    existingShortPutCollateral + workingSellPutCollateral + workingBuyDebits;

  return {
    settledCashUsd: input.settledCashUsd,
    existingShortPutCollateral,
    workingSellPutCollateral,
    workingBuyDebits,
    reservedCashUsd,
    availableCashUsd: Math.max(0, input.settledCashUsd - reservedCashUsd),
  };
}

export function validateSingleLegOrderIntent(input: {
  order: PlaceOrderInput;
  state: SingleLegAccountState;
  now: Date;
  maxStateAgeMs: number;
  replacingOrderId?: string;
  /** True only after verifying the selected STO contract's full deliverable. */
  standardOptionDeliverableVerified?: boolean;
}) {
  if (input.order.side !== "buy" && input.order.side !== "sell") {
    rejectIntent("single_leg_order_side_invalid", "The order side is invalid.");
  }
  const quantity = requirePositiveOrderQuantity(input.order);
  const order = input.order;

  if (order.assetClass === "equity") {
    if (
      order.optionContract !== null ||
      order.optionAction !== undefined ||
      order.positionEffect !== undefined ||
      order.strategyIntent !== undefined
    ) {
      rejectIntent(
        "equity_order_option_fields_invalid",
        "An equity order contains option-only intent fields.",
      );
    }
    if (order.side === "buy") {
      if (input.replacingOrderId) {
        requireInventoryState(input);
      }
      return;
    }

    const state = requireInventoryState(input);
    const capacity = buildEquityShareCapacity({
      underlying: order.symbol,
      ...state,
    });
    if (capacity.availableShares < quantity) {
      rejectIntent(
        "equity_sell_quantity_exceeds_position",
        "The equity sale exceeds unreserved long shares.",
        { requestedQuantity: quantity, ...capacity },
      );
    }
    return;
  }

  if (order.assetClass !== "option") {
    rejectIntent(
      "single_leg_asset_class_unsupported",
      "Only single-leg equity and option orders are supported.",
    );
  }
  requireValidOptionContract(order.optionContract);
  const contract = order.optionContract;
  if (normalizeSymbol(order.symbol) !== normalizeSymbol(contract.underlying)) {
    rejectIntent(
      "option_order_underlying_mismatch",
      "The order symbol does not match the option underlying.",
    );
  }
  const action = requireOptionAction(order, contract);
  requireOpenContractNotExpired({ action, contract, now: input.now });
  if (action === "buy_to_open") {
    if (input.replacingOrderId) {
      requireInventoryState(input);
    }
    return;
  }

  const state = requireInventoryState(input);
  if (action === "buy_to_close" || action === "sell_to_close") {
    const capacity = buildOptionCloseCapacity({
      action,
      contract,
      ...state,
    });
    if (capacity.availableContracts < quantity) {
      rejectIntent(
        "option_close_quantity_exceeds_position",
        "The close order exceeds unreserved matching option contracts.",
        { requestedQuantity: quantity, optionAction: action, ...capacity },
      );
    }
    return;
  }

  requireStandardSellToOpenDeliverable(
    contract,
    input.standardOptionDeliverableVerified,
  );
  if (contract.right === "call") {
    const capacity = buildEquityShareCapacity({
      underlying: contract.underlying,
      ...state,
    });
    const requestedShares = quantity * Number(contract.sharesPerContract);
    if (capacity.availableShares < requestedShares) {
      rejectIntent(
        "option_covered_call_insufficient_shares",
        "The covered-call order exceeds unreserved underlying shares.",
        { requestedQuantity: quantity, requestedShares, ...capacity },
      );
    }
    return;
  }

  const settledCashUsd = input.state.settledCashUsd;
  if (!Number.isFinite(settledCashUsd) || settledCashUsd < 0) {
    rejectIntent(
      "trading_cash_unavailable",
      "Fresh settled USD cash is required for a cash-secured put.",
    );
  }
  requireFreshObservation({
    resource: "cash",
    observedAt: input.state.settledCashObservedAt,
    now: input.now,
    maxStateAgeMs: input.maxStateAgeMs,
  });
  if (input.state.optionCollateralContractsVerified !== true) {
    rejectIntent(
      "trading_cash_reservation_unverified",
      "Every collateral-bearing put must have verified standard deliverables.",
    );
  }
  const capacity = buildCashSecuredPutCapacity({
    ...state,
    settledCashUsd,
  });
  const requestedCollateralUsd =
    quantity * Number(contract.strike) * Number(contract.sharesPerContract);
  if (capacity.availableCashUsd < requestedCollateralUsd) {
    rejectIntent(
      "option_cash_secured_put_insufficient_cash",
      "The cash-secured put exceeds unreserved settled USD cash.",
      { requestedQuantity: quantity, requestedCollateralUsd, ...capacity },
    );
  }
}

export function buildSellCallCoverageSnapshot(input: {
  order: PlaceOrderInput;
  positions: BrokerPositionSnapshot[];
  orders: BrokerOrderSnapshot[];
}) {
  const contract = input.order.optionContract;
  const underlying = normalizeSymbol(
    contract?.underlying ?? input.order.symbol,
  );
  const selectedSharesPerContract = contract
    ? sharesPerContract(contract)
    : 100;
  const selectedContractKey = contract ? optionTupleKey(contract) : "";
  const longUnderlyingShares = input.positions
    .filter(
      (position) =>
        position.assetClass === "equity" &&
        !position.optionContract &&
        normalizeSymbol(position.symbol) === underlying,
    )
    .reduce(
      (sum, position) => sum + Math.max(0, Number(position.quantity) || 0),
      0,
    );
  const matchingLongCallContracts =
    contract?.right === "call"
      ? input.positions
          .filter(
            (position) =>
              position.assetClass === "option" &&
              position.optionContract?.right === "call" &&
              Number(position.quantity) > 0 &&
              sameOptionContract(position.optionContract, contract),
          )
          .reduce((sum, position) => sum + Number(position.quantity), 0)
      : 0;
  const longCallContractsByKey = new Map<string, number>();
  for (const position of input.positions) {
    if (
      position.assetClass === "option" &&
      position.optionContract?.right === "call" &&
      normalizeSymbol(position.optionContract.underlying) === underlying &&
      Number(position.quantity) > 0
    ) {
      const key = optionTupleKey(position.optionContract);
      longCallContractsByKey.set(
        key,
        (longCallContractsByKey.get(key) ?? 0) + Number(position.quantity),
      );
    }
  }
  const existingShortCallContracts = input.positions
    .filter(
      (position) =>
        position.assetClass === "option" &&
        position.optionContract?.right === "call" &&
        normalizeSymbol(position.optionContract.underlying) === underlying &&
        Number(position.quantity) < 0,
    )
    .reduce((sum, position) => sum + Math.abs(Number(position.quantity)), 0);
  const pendingSellCallContractsByKey = new Map<string, number>();
  for (const order of input.orders) {
    if (
      isWorkingSellCallOrderForUnderlying(order, underlying) &&
      order.optionContract
    ) {
      requireConsistentOrderContractIds(
        order,
        "ibkr_option_order_contract_state_invalid",
      );
      const key = optionTupleKey(orderOptionContract(order)!);
      pendingSellCallContractsByKey.set(
        key,
        (pendingSellCallContractsByKey.get(key) ?? 0) +
          conservativeReservedOrderQuantity(order),
      );
    }
  }
  const pendingSellCallContracts = Array.from(
    pendingSellCallContractsByKey.values(),
  ).reduce((sum, quantity) => sum + quantity, 0);
  const pendingMatchingSellCallContracts = selectedContractKey
    ? (pendingSellCallContractsByKey.get(selectedContractKey) ?? 0)
    : 0;
  const availableMatchingLongCallContracts = Math.max(
    0,
    matchingLongCallContracts - pendingMatchingSellCallContracts,
  );
  const pendingShortOpeningSellCallContracts = Array.from(
    pendingSellCallContractsByKey.entries(),
  ).reduce((sum, [key, pendingQuantity]) => {
    const longQuantity = longCallContractsByKey.get(key) ?? 0;
    return sum + Math.max(0, pendingQuantity - longQuantity);
  }, 0);
  const pendingUnderlyingSellShares = input.orders
    .filter((order) => isWorkingSellEquityOrderForUnderlying(order, underlying))
    .reduce((sum, order) => sum + conservativeReservedOrderQuantity(order), 0);
  const reservedShares =
    (existingShortCallContracts + pendingShortOpeningSellCallContracts) *
      selectedSharesPerContract +
    pendingUnderlyingSellShares;
  const coveredCallCapacity = Math.max(
    0,
    Math.floor(
      (longUnderlyingShares - reservedShares) / selectedSharesPerContract,
    ),
  );

  return {
    underlying,
    sharesPerContract: selectedSharesPerContract,
    longUnderlyingShares,
    matchingLongCallContracts,
    pendingMatchingSellCallContracts,
    availableMatchingLongCallContracts,
    existingShortCallContracts,
    pendingSellCallContracts,
    pendingShortOpeningSellCallContracts,
    pendingUnderlyingSellShares,
    reservedShares,
    coveredCallCapacity,
  };
}

export function validateSellCallOrderIntent(input: {
  order: PlaceOrderInput;
  positions: BrokerPositionSnapshot[];
  orders: BrokerOrderSnapshot[];
}) {
  const order = input.order;
  const contract = order.optionContract;
  if (
    order.assetClass !== "option" ||
    order.side !== "sell" ||
    contract?.right !== "call"
  ) {
    return;
  }

  const quantity = Number(order.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return;
  }

  const positionEffect = order.positionEffect ?? null;
  const strategyIntent = order.strategyIntent ?? null;
  if (
    (positionEffect === "close" && strategyIntent === "covered_call") ||
    (positionEffect === "open" && strategyIntent === "sell_to_close")
  ) {
    throw new HttpError(
      409,
      "The option order position effect conflicts with its strategy intent.",
      {
        code: "ibkr_option_order_intent_conflict",
        expose: true,
        data: { positionEffect, strategyIntent },
      },
    );
  }

  if (strategyIntent === "uncovered_short_call") {
    throw new HttpError(
      409,
      "Uncovered short call orders are disabled in this version.",
      {
        code: "ibkr_uncovered_short_call_disabled",
        expose: true,
      },
    );
  }

  if (strategyIntent === "long_option") {
    throw new HttpError(
      409,
      "A sell call order cannot use the long-option strategy intent.",
      {
        code: "ibkr_option_order_intent_invalid",
        expose: true,
      },
    );
  }

  const coverage = buildSellCallCoverageSnapshot(input);
  const requestedClose =
    positionEffect === "close" || strategyIntent === "sell_to_close";
  const requestedCoveredCall =
    positionEffect === "open" || strategyIntent === "covered_call";

  if (requestedClose) {
    if (coverage.availableMatchingLongCallContracts < quantity) {
      throw new HttpError(
        409,
        "Cannot sell to close more call contracts than the account is long.",
        {
          code: "ibkr_sell_to_close_quantity_exceeds_position",
          expose: true,
          data: { requestedQuantity: quantity, ...coverage },
        },
      );
    }
    return;
  }

  if (requestedCoveredCall) {
    if (coverage.coveredCallCapacity < quantity) {
      throw new HttpError(
        409,
        "Covered call order is not fully covered by unreserved underlying shares.",
        {
          code: "ibkr_covered_call_insufficient_shares",
          expose: true,
          data: { requestedQuantity: quantity, ...coverage },
        },
      );
    }
    return;
  }

  if (coverage.availableMatchingLongCallContracts >= quantity) {
    return;
  }

  throw new HttpError(
    409,
    "Selling this call would open a short call. Choose a covered-call action with sufficient underlying shares.",
    {
      code: "ibkr_call_sell_requires_explicit_open_or_close_intent",
      expose: true,
      data: { requestedQuantity: quantity, ...coverage },
    },
  );
}
