import { HttpError } from "../lib/errors";
import {
  ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE,
  ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS,
  type AlgoOptionBrokerAdapter,
  type AlgoOptionBrokerOrder,
  type AlgoOptionBrokerOrderSnapshot,
} from "./algo-option-broker-adapter";
import { getSnapTradeAccountPortfolio } from "./snaptrade-account-portfolio";
import {
  cancelSnapTradeOptionOrder,
  checkSnapTradeOptionOrderImpact,
  listSnapTradeRecentOptionOrders,
  submitSnapTradeOptionOrder,
  type SnapTradeOptionOrderAction,
  type SnapTradeOptionOrderInput,
} from "./snaptrade-option-orders";

export type AlgoSnapTradeOptionAdapterDependencies = {
  now?: () => Date;
  readPortfolio?: typeof getSnapTradeAccountPortfolio;
  checkImpact?: typeof checkSnapTradeOptionOrderImpact;
  submitOrder?: typeof submitSnapTradeOptionOrder;
  cancelOrder?: typeof cancelSnapTradeOptionOrder;
  listOrders?: typeof listSnapTradeRecentOptionOrders;
};

function unavailable(): never {
  throw new HttpError(409, "This SnapTrade Algo operation is not available.", {
    code: "algo_provider_operation_unavailable",
    expose: true,
  });
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "SnapTrade adapter time is invalid.", {
      code: "algo_provider_adapter_time_invalid",
      expose: true,
    });
  }
  return value;
}

function providerDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new HttpError(502, `SnapTrade ${field} is invalid.`, {
      code: "algo_provider_adapter_response_invalid",
    });
  }
  return date;
}

function snapTradeAction(order: AlgoOptionBrokerOrder): SnapTradeOptionOrderAction {
  return `${order.side.toUpperCase()}_TO_${order.positionEffect.toUpperCase()}` as SnapTradeOptionOrderAction;
}

function snapTradeOrder(order: AlgoOptionBrokerOrder): SnapTradeOptionOrderInput {
  return {
    contractSymbol: order.contract.symbol,
    multiplier: order.contract.multiplier,
    sharesPerContract: order.contract.sharesPerContract,
    underlyingSymbol: order.contract.underlying,
    expiration: order.contract.expiration,
    strike: order.contract.strike,
    optionType: order.contract.right === "call" ? "Call" : "Put",
    action: snapTradeAction(order),
    orderType: "Limit",
    timeInForce: "Day",
    units: order.quantity,
    price: order.limitPrice,
  };
}

function finiteMoney(value: number | null, field: string): number {
  if (value == null || !Number.isFinite(value) || value < 0) {
    throw new HttpError(503, `SnapTrade ${field} is unavailable.`, {
      code: "algo_provider_capital_unavailable",
      expose: true,
    });
  }
  return value;
}

function normalizeOrderRows(input: {
  accountId: string;
  checkedAt: string;
  orders: Awaited<ReturnType<typeof listSnapTradeRecentOptionOrders>>["orders"];
}): AlgoOptionBrokerOrderSnapshot[] {
  const checkedAt = providerDate(input.checkedAt, "orders timestamp");
  return input.orders.flatMap((order) => {
    const brokerOrderId = order.brokerageOrderId?.trim();
    const quantity = Number(order.totalQuantity);
    const filledQuantity = Number(order.filledQuantity ?? 0);
    if (
      !brokerOrderId ||
      (!order.optionTicker && !order.optionSymbolId) ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(filledQuantity) ||
      filledQuantity < 0 ||
      filledQuantity > quantity
    ) {
      return [];
    }
    return [{
      provider: "snaptrade" as const,
      accountId: input.accountId,
      brokerOrderId,
      clientOrderId: null,
      contractSymbol: order.optionTicker?.trim() || null,
      status: order.status.trim() || "unknown",
      quantity,
      filledQuantity,
      limitPrice: order.limitPrice == null ? null : Number(order.limitPrice),
      observedAt: order.timeUpdated
        ? providerDate(order.timeUpdated, "order timestamp")
        : checkedAt,
    }];
  });
}

export function createAlgoSnapTradeOptionAdapter(
  dependencies: AlgoSnapTradeOptionAdapterDependencies = {},
): AlgoOptionBrokerAdapter {
  const loadOrders = dependencies.listOrders ?? listSnapTradeRecentOptionOrders;
  return {
    provider: "snaptrade",
    activationReleased: ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE.snaptrade,
    technicalBlockers: ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS.snaptrade,
    async readCapital(input) {
      const response = await (
        dependencies.readPortfolio ?? getSnapTradeAccountPortfolio
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        now: currentTime(dependencies.now),
      });
      return {
        accountId: input.accountId,
        netLiquidation: finiteMoney(
          response.totals.netLiquidation,
          "net liquidation",
        ),
        buyingPower: finiteMoney(response.totals.buyingPower, "buying power"),
        observedAt: providerDate(response.syncedAt, "capital timestamp"),
      };
    },
    async readRisk() {
      return unavailable();
    },
    async reviewOrder(input) {
      const response = await (
        dependencies.checkImpact ?? checkSnapTradeOptionOrderImpact
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: snapTradeOrder(input.order),
        now: currentTime(dependencies.now),
      });
      const cashChange = response.impact.estimatedCashChange;
      const estimatedPremium =
        cashChange != null && Number.isFinite(cashChange)
          ? Math.abs(cashChange)
          : null;
      return {
        provider: "snaptrade",
        accountId: input.accountId,
        checkedAt: providerDate(response.checkedAt, "impact timestamp"),
        accepted: estimatedPremium !== null,
        warnings:
          estimatedPremium === null
            ? ["snaptrade_impact_estimate_unavailable"]
            : [],
        estimatedPremium,
      };
    },
    async submitEntry(input) {
      const response = await (
        dependencies.submitOrder ?? submitSnapTradeOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: {
          ...snapTradeOrder(input.order),
          confirm: true,
          taxPreflightToken: input.order.taxPreflightToken,
        },
        now: currentTime(dependencies.now),
      });
      return {
        provider: "snaptrade",
        accountId: input.accountId,
        brokerOrderId: response.order.brokerageOrderId,
        clientOrderId: input.order.clientOrderId,
        status: response.order.status,
        submittedAt: providerDate(response.submittedAt, "submission timestamp"),
        reconciliationRequired: response.reconcileRequired === true,
      };
    },
    async submitOwnedPositionExit() {
      return unavailable();
    },
    async cancelOrder(input) {
      const response = await (
        dependencies.cancelOrder ?? cancelSnapTradeOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: { orderId: input.brokerOrderId },
        now: currentTime(dependencies.now),
      });
      const accepted = response.status.toLowerCase() !== "rejected";
      return {
        provider: "snaptrade",
        accountId: input.accountId,
        brokerOrderId: response.orderId,
        accepted,
        checkedAt: providerDate(response.canceledAt, "cancel timestamp"),
        reconciliationRequired: !accepted,
      };
    },
    async listOrders(input) {
      const response = await loadOrders({
        appUserId: input.appUserId,
        accountId: input.accountId,
        now: currentTime(dependencies.now),
      });
      return normalizeOrderRows({
        accountId: input.accountId,
        checkedAt: response.checkedAt,
        orders: response.orders,
      });
    },
    async listFills(input) {
      const response = await loadOrders({
        appUserId: input.appUserId,
        accountId: input.accountId,
        now: currentTime(dependencies.now),
      });
      return response.orders.flatMap((order) => {
        const brokerOrderId = order.brokerageOrderId?.trim();
        const quantity = Number(order.filledQuantity);
        const price = Number(order.executionPrice);
        if (
          !brokerOrderId ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(price) ||
          price <= 0 ||
          !order.timeExecuted
        ) {
          return [];
        }
        return [{
          provider: "snaptrade" as const,
          accountId: input.accountId,
          brokerOrderId,
          fillId: `${brokerOrderId}:aggregate`,
          contractSymbol: order.optionTicker?.trim() || null,
          quantity,
          price,
          executedAt: providerDate(order.timeExecuted, "fill timestamp"),
        }];
      });
    },
    async reconcile() {
      return unavailable();
    },
  };
}
