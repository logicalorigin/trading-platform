import { HttpError } from "../lib/errors";
import {
  ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE,
  ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS,
  type AlgoOptionBrokerAdapter,
  type AlgoOptionBrokerOrder,
  type AlgoOptionBrokerOrderSnapshot,
} from "./algo-option-broker-adapter";
import {
  cancelSchwabOptionOrder,
  previewSchwabOptionOrder,
  submitSchwabOptionOrder,
  type SchwabOptionInstruction,
  type SchwabOptionOrderPreviewInput,
} from "./schwab-option-orders";
import { listSchwabRecentOrders } from "./schwab-orders-read";

export type AlgoSchwabOptionAdapterDependencies = {
  now?: () => Date;
  previewOrder?: typeof previewSchwabOptionOrder;
  submitOrder?: typeof submitSchwabOptionOrder;
  cancelOrder?: typeof cancelSchwabOptionOrder;
  listOrders?: typeof listSchwabRecentOrders;
};

function unavailable(): never {
  throw new HttpError(409, "This Schwab Algo operation is not available.", {
    code: "algo_provider_operation_unavailable",
    expose: true,
  });
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "Schwab adapter time is invalid.", {
      code: "algo_provider_adapter_time_invalid",
      expose: true,
    });
  }
  return value;
}

function providerDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new HttpError(502, `Schwab ${field} is invalid.`, {
      code: "algo_provider_adapter_response_invalid",
    });
  }
  return date;
}

function schwabInstruction(order: AlgoOptionBrokerOrder): SchwabOptionInstruction {
  if (order.side === "buy") {
    return order.positionEffect === "open" ? "BuyToOpen" : "BuyToClose";
  }
  return order.positionEffect === "open" ? "SellToOpen" : "SellToClose";
}

function schwabOrder(order: AlgoOptionBrokerOrder): SchwabOptionOrderPreviewInput {
  return {
    contractSymbol: order.contract.symbol,
    multiplier: order.contract.multiplier,
    sharesPerContract: order.contract.sharesPerContract,
    underlyingSymbol: order.contract.underlying,
    expiration: order.contract.expiration,
    strike: order.contract.strike,
    optionType: order.contract.right === "call" ? "Call" : "Put",
    instruction: schwabInstruction(order),
    orderType: "Limit",
    duration: "Day",
    session: "Normal",
    quantity: order.quantity,
    limitPrice: order.limitPrice,
  };
}

function normalizeOrderRows(input: {
  accountId: string;
  checkedAt: string;
  orders: Awaited<ReturnType<typeof listSchwabRecentOrders>>["orders"];
}): AlgoOptionBrokerOrderSnapshot[] {
  const checkedAt = providerDate(input.checkedAt, "orders timestamp");
  return input.orders.flatMap((order) => {
    const brokerOrderId = order.orderId?.trim();
    const quantity = Number(order.quantity);
    const filledQuantity = Number(order.filledQuantity ?? 0);
    if (
      order.assetType?.toUpperCase() !== "OPTION" ||
      !brokerOrderId ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(filledQuantity) ||
      filledQuantity < 0 ||
      filledQuantity > quantity
    ) {
      return [];
    }
    return [{
      provider: "schwab" as const,
      accountId: input.accountId,
      brokerOrderId,
      clientOrderId: null,
      contractSymbol: order.symbol?.trim() || null,
      status: order.status.trim() || "unknown",
      quantity,
      filledQuantity,
      limitPrice: order.price == null ? null : Number(order.price),
      observedAt: order.enteredTime
        ? providerDate(order.enteredTime, "order timestamp")
        : checkedAt,
    }];
  });
}

export function createAlgoSchwabOptionAdapter(
  dependencies: AlgoSchwabOptionAdapterDependencies = {},
): AlgoOptionBrokerAdapter {
  return {
    provider: "schwab",
    activationReleased: ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE.schwab,
    technicalBlockers: ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS.schwab,
    async readCapital() {
      return unavailable();
    },
    async readRisk() {
      return unavailable();
    },
    async reviewOrder(input) {
      const response = await (
        dependencies.previewOrder ?? previewSchwabOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: schwabOrder(input.order),
        now: currentTime(dependencies.now),
      });
      return {
        provider: "schwab",
        accountId: input.accountId,
        checkedAt: providerDate(response.checkedAt, "preview timestamp"),
        accepted: false,
        warnings: ["schwab_preview_normalization_pending"],
        estimatedPremium: null,
      };
    },
    async submitEntry(input) {
      const response = await (
        dependencies.submitOrder ?? submitSchwabOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: {
          ...schwabOrder(input.order),
          confirm: true,
          taxPreflightToken: input.order.taxPreflightToken,
        },
        now: currentTime(dependencies.now),
      });
      return {
        provider: "schwab",
        accountId: input.accountId,
        brokerOrderId: response.orderId,
        clientOrderId: input.order.clientOrderId,
        status: response.status,
        submittedAt: providerDate(response.submittedAt, "submission timestamp"),
        reconciliationRequired: response.reconcileRequired === true,
      };
    },
    async submitOwnedPositionExit() {
      return unavailable();
    },
    async cancelOrder(input) {
      const response = await (
        dependencies.cancelOrder ?? cancelSchwabOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        orderId: input.brokerOrderId,
        now: currentTime(dependencies.now),
      });
      return {
        provider: "schwab",
        accountId: input.accountId,
        brokerOrderId: response.orderId,
        accepted: response.status === "canceled",
        checkedAt: providerDate(response.canceledAt, "cancel timestamp"),
        reconciliationRequired: response.status !== "canceled",
      };
    },
    async listOrders(input) {
      const response = await (
        dependencies.listOrders ?? listSchwabRecentOrders
      )({
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
    async listFills() {
      return unavailable();
    },
    async reconcile() {
      return unavailable();
    },
  };
}
