import { HttpError } from "../lib/errors";
import { normalizeSymbol } from "../lib/values";
import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  PlaceOrderInput,
} from "../providers/ibkr/client";

export type OptionOrderPositionEffect = "open" | "close";
export type OptionOrderStrategyIntent =
  | "long_option"
  | "sell_to_close"
  | "covered_call"
  | "uncovered_short_call";

const WORKING_ORDER_STATUSES = new Set<BrokerOrderSnapshot["status"]>([
  "pending_submit",
  "submitted",
  "accepted",
  "partially_filled",
]);

type ComparableOptionContract = {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  providerContractId?: string | null;
};

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function optionTupleKey(contract: ComparableOptionContract): string {
  return [
    normalizeSymbol(contract.underlying),
    dateKey(contract.expirationDate),
    String(Number(contract.strike)),
    contract.right,
  ].join(":");
}

function sameOptionContract(
  left: NonNullable<BrokerPositionSnapshot["optionContract"]>,
  right: NonNullable<PlaceOrderInput["optionContract"]>,
): boolean {
  const leftProviderContractId = left.providerContractId
    ? String(left.providerContractId)
    : "";
  const rightProviderContractId = right.providerContractId
    ? String(right.providerContractId)
    : "";

  if (leftProviderContractId && rightProviderContractId) {
    return leftProviderContractId === rightProviderContractId;
  }

  return optionTupleKey(left) === optionTupleKey({
    ...right,
    providerContractId: right.providerContractId ?? null,
  });
}

function sharesPerContract(
  contract: NonNullable<PlaceOrderInput["optionContract"]>,
): number {
  const shares = Number(contract.sharesPerContract ?? contract.multiplier);
  return Number.isFinite(shares) && shares > 0 ? shares : 100;
}

function remainingOrderQuantity(order: BrokerOrderSnapshot): number {
  const quantity = Number(order.quantity);
  const filled = Number(order.filledQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  return Math.max(0, quantity - (Number.isFinite(filled) ? filled : 0));
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

export function buildSellCallCoverageSnapshot(input: {
  order: PlaceOrderInput;
  positions: BrokerPositionSnapshot[];
  orders: BrokerOrderSnapshot[];
}) {
  const contract = input.order.optionContract;
  const underlying = normalizeSymbol(contract?.underlying ?? input.order.symbol);
  const selectedSharesPerContract = contract ? sharesPerContract(contract) : 100;
  const selectedContractKey = contract ? optionTupleKey(contract) : "";
  const longUnderlyingShares = input.positions
    .filter(
      (position) =>
        position.assetClass === "equity" &&
        !position.optionContract &&
        normalizeSymbol(position.symbol) === underlying,
    )
    .reduce((sum, position) => sum + Math.max(0, Number(position.quantity) || 0), 0);
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
      const key = optionTupleKey(order.optionContract);
      pendingSellCallContractsByKey.set(
        key,
        (pendingSellCallContractsByKey.get(key) ?? 0) +
          remainingOrderQuantity(order),
      );
    }
  }
  const pendingSellCallContracts = Array.from(
    pendingSellCallContractsByKey.values(),
  ).reduce((sum, quantity) => sum + quantity, 0);
  const pendingMatchingSellCallContracts = selectedContractKey
    ? pendingSellCallContractsByKey.get(selectedContractKey) ?? 0
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
    .reduce((sum, order) => sum + remainingOrderQuantity(order), 0);
  const reservedShares =
    (existingShortCallContracts + pendingShortOpeningSellCallContracts) *
      selectedSharesPerContract +
    pendingUnderlyingSellShares;
  const coveredCallCapacity = Math.max(
    0,
    Math.floor((longUnderlyingShares - reservedShares) / selectedSharesPerContract),
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
    throw new HttpError(409, "The option order position effect conflicts with its strategy intent.", {
      code: "ibkr_option_order_intent_conflict",
      expose: true,
      data: { positionEffect, strategyIntent },
    });
  }

  if (strategyIntent === "uncovered_short_call") {
    throw new HttpError(409, "Uncovered short call orders are disabled in this version.", {
      code: "ibkr_uncovered_short_call_disabled",
      expose: true,
    });
  }

  if (strategyIntent === "long_option") {
    throw new HttpError(409, "A sell call order cannot use the long-option strategy intent.", {
      code: "ibkr_option_order_intent_invalid",
      expose: true,
    });
  }

  const coverage = buildSellCallCoverageSnapshot(input);
  const requestedClose =
    positionEffect === "close" || strategyIntent === "sell_to_close";
  const requestedCoveredCall =
    positionEffect === "open" || strategyIntent === "covered_call";

  if (requestedClose) {
    if (coverage.availableMatchingLongCallContracts < quantity) {
      throw new HttpError(409, "Cannot sell to close more call contracts than the account is long.", {
        code: "ibkr_sell_to_close_quantity_exceeds_position",
        expose: true,
        data: { requestedQuantity: quantity, ...coverage },
      });
    }
    return;
  }

  if (requestedCoveredCall) {
    if (coverage.coveredCallCapacity < quantity) {
      throw new HttpError(409, "Covered call order is not fully covered by unreserved underlying shares.", {
        code: "ibkr_covered_call_insufficient_shares",
        expose: true,
        data: { requestedQuantity: quantity, ...coverage },
      });
    }
    return;
  }

  if (coverage.availableMatchingLongCallContracts >= quantity) {
    return;
  }

  throw new HttpError(409, "Selling this call would open a short call. Choose a covered-call action with sufficient underlying shares.", {
    code: "ibkr_call_sell_requires_explicit_open_or_close_intent",
    expose: true,
    data: { requestedQuantity: quantity, ...coverage },
  });
}
