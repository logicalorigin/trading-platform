import type { AlgoTargetExecution } from "@workspace/db";

import { HttpError } from "../lib/errors";
import {
  ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE,
  ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS,
  type AlgoOptionBrokerAdapter,
  type AlgoOptionBrokerOrder,
  type AlgoOptionBrokerOrderSnapshot,
} from "./algo-option-broker-adapter";
import {
  loadRobinhoodAccountOptionRiskSnapshot,
  loadRobinhoodAlgoOptionCapital,
} from "./algo-robinhood-option-execution";
import { executePreparedAlgoRobinhoodOptionExit } from "./algo-robinhood-option-exit";
import {
  reconcileAlgoRobinhoodOptionEntry,
  reconcileAlgoRobinhoodOptionExit,
} from "./algo-robinhood-option-reconciliation";
import {
  cancelRobinhoodOptionOrder,
  listRobinhoodOptionOrders,
  placeRobinhoodOptionOrder,
  reviewRobinhoodOptionOrder,
  type RobinhoodOptionOrderInput,
} from "./robinhood-option-orders";

export type AlgoRobinhoodOptionAdapterDependencies = {
  now?: () => Date;
  readCapital?: typeof loadRobinhoodAlgoOptionCapital;
  readRisk?: typeof loadRobinhoodAccountOptionRiskSnapshot;
  reviewOrder?: typeof reviewRobinhoodOptionOrder;
  placeOrder?: typeof placeRobinhoodOptionOrder;
  executeExit?: typeof executePreparedAlgoRobinhoodOptionExit;
  cancelOrder?: typeof cancelRobinhoodOptionOrder;
  listOrders?: typeof listRobinhoodOptionOrders;
  reconcileEntry?: typeof reconcileAlgoRobinhoodOptionEntry;
  reconcileExit?: typeof reconcileAlgoRobinhoodOptionExit;
};

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "Robinhood adapter time is invalid.", {
      code: "algo_provider_adapter_time_invalid",
      expose: true,
    });
  }
  return value;
}

function providerDate(value: string | Date, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new HttpError(502, `Robinhood ${field} is invalid.`, {
      code: "algo_provider_adapter_response_invalid",
    });
  }
  return date;
}

function hasContent(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function robinhoodOrder(order: AlgoOptionBrokerOrder): RobinhoodOptionOrderInput {
  return {
    contractSymbol: order.contract.symbol,
    multiplier: order.contract.multiplier,
    sharesPerContract: order.contract.sharesPerContract,
    chainSymbol: order.contract.underlying,
    underlyingType: "equity",
    expiration: order.contract.expiration,
    strike: order.contract.strike,
    optionType: order.contract.right === "call" ? "Call" : "Put",
    side: order.side === "buy" ? "Buy" : "Sell",
    positionEffect: order.positionEffect === "open" ? "Open" : "Close",
    orderType: "Limit",
    timeInForce: "Day",
    marketHours: "regular_hours",
    quantity: order.quantity,
    limitPrice: order.limitPrice,
    stopPrice: null,
  };
}

function executionState(execution: AlgoTargetExecution) {
  const requested = Number(execution.requestedQuantity);
  const filled = Number(execution.filledQuantity);
  if (
    Number.isFinite(requested) &&
    Number.isFinite(filled) &&
    filled > 0 &&
    filled < requested
  ) {
    return "partially_filled";
  }
  if (execution.status === "filled") return "filled";
  if (execution.status === "cancelled") return "cancelled";
  if (execution.status === "reconciliation_required" || execution.status === "rejected") {
    return "attention";
  }
  return execution.status === "submitted" ? "submitted" : "pending";
}

function normalizeOrderRows(input: {
  accountId: string;
  checkedAt: string;
  orders: Awaited<ReturnType<typeof listRobinhoodOptionOrders>>["orders"];
}): AlgoOptionBrokerOrderSnapshot[] {
  const observedAt = providerDate(input.checkedAt, "order timestamp");
  return input.orders.flatMap((order) => {
    const brokerOrderId = order.id?.trim();
    const quantity = Number(order.quantity);
    const filledQuantity = Number(order.processedQuantity ?? 0);
    if (
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
      provider: "robinhood" as const,
      accountId: input.accountId,
      brokerOrderId,
      clientOrderId: null,
      contractSymbol: null,
      status: order.state?.trim() || "unknown",
      quantity,
      filledQuantity,
      limitPrice: order.price == null ? null : Number(order.price),
      observedAt,
    }];
  });
}

export function createAlgoRobinhoodOptionAdapter(
  dependencies: AlgoRobinhoodOptionAdapterDependencies = {},
): AlgoOptionBrokerAdapter {
  const loadOrders = dependencies.listOrders ?? listRobinhoodOptionOrders;
  return {
    provider: "robinhood",
    activationReleased: ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE.robinhood,
    technicalBlockers: ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS.robinhood,
    async readCapital(input) {
      const capital = await (
        dependencies.readCapital ?? loadRobinhoodAlgoOptionCapital
      )(input);
      return { accountId: input.accountId, ...capital };
    },
    async readRisk(input) {
      const risk = await (
        dependencies.readRisk ?? loadRobinhoodAccountOptionRiskSnapshot
      )(
        {
          appUserId: input.appUserId,
          deploymentId: input.deploymentId,
          targetId: input.targetId,
          accountId: input.accountId,
        },
        { now: dependencies.now },
      );
      return { accountId: input.accountId, ...risk };
    },
    async reviewOrder(input) {
      const reviewed = await (
        dependencies.reviewOrder ?? reviewRobinhoodOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: robinhoodOrder(input.order),
        now: currentTime(dependencies.now),
      });
      const warnings = [...reviewed.review.alerts];
      if (hasContent(reviewed.review.orderChecks)) {
        warnings.push("robinhood_order_check");
      }
      return {
        provider: "robinhood",
        accountId: input.accountId,
        checkedAt: providerDate(reviewed.checkedAt, "review timestamp"),
        accepted: warnings.length === 0,
        warnings,
        estimatedPremium: reviewed.review.estimate.premium,
      };
    },
    async submitEntry(input) {
      const placed = await (
        dependencies.placeOrder ?? placeRobinhoodOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: {
          ...robinhoodOrder(input.order),
          confirm: true,
          refId: input.order.clientOrderId,
          taxPreflightToken: input.order.taxPreflightToken,
        },
        now: currentTime(dependencies.now),
      });
      return {
        provider: "robinhood",
        accountId: input.accountId,
        brokerOrderId: placed.order.brokerageOrderId,
        clientOrderId: input.order.clientOrderId,
        status: placed.order.state?.trim() || "submitted",
        submittedAt: providerDate(placed.submittedAt, "submission timestamp"),
        reconciliationRequired: placed.reconcileRequired === true,
      };
    },
    async submitOwnedPositionExit(input) {
      const execution = await (
        dependencies.executeExit ?? executePreparedAlgoRobinhoodOptionExit
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        algoContext: {
          deploymentId: input.ownedPosition.deploymentId,
          targetId: input.ownedPosition.targetId,
          positionId: input.ownedPosition.positionId,
          targetExecutionId: input.ownedPosition.targetExecutionId,
        },
        order: robinhoodOrder(input.order),
      });
      return {
        provider: "robinhood",
        accountId: input.accountId,
        brokerOrderId: execution.brokerOrderId,
        clientOrderId: execution.clientOrderId,
        status: executionState(execution),
        submittedAt: providerDate(execution.updatedAt, "submission timestamp"),
        reconciliationRequired: execution.status === "reconciliation_required",
      };
    },
    async cancelOrder(input) {
      const cancelled = await (
        dependencies.cancelOrder ?? cancelRobinhoodOptionOrder
      )({
        appUserId: input.appUserId,
        accountId: input.accountId,
        input: { orderId: input.brokerOrderId },
        now: currentTime(dependencies.now),
      });
      return {
        provider: "robinhood",
        accountId: input.accountId,
        brokerOrderId: input.brokerOrderId,
        accepted: cancelled.accepted,
        checkedAt: providerDate(cancelled.cancelledAt, "cancel timestamp"),
        reconciliationRequired: !cancelled.accepted,
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
      const checkedAt = providerDate(response.checkedAt, "fill timestamp");
      return response.orders.flatMap((order) => {
        const brokerOrderId = order.id?.trim();
        const quantity = Number(order.processedQuantity);
        const price = Number(order.price);
        if (!brokerOrderId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
          return [];
        }
        return [{
          provider: "robinhood" as const,
          accountId: input.accountId,
          brokerOrderId,
          fillId: `${brokerOrderId}:aggregate`,
          contractSymbol: null,
          quantity,
          price,
          executedAt: order.createdAt
            ? providerDate(order.createdAt, "fill timestamp")
            : checkedAt,
        }];
      });
    },
    async reconcile(input) {
      const execution = await (input.action === "entry"
        ? (dependencies.reconcileEntry ?? reconcileAlgoRobinhoodOptionEntry)(
            { appUserId: input.appUserId, executionId: input.executionId },
          )
        : (dependencies.reconcileExit ?? reconcileAlgoRobinhoodOptionExit)(
            { appUserId: input.appUserId, executionId: input.executionId },
          ));
      return {
        provider: "robinhood",
        accountId: input.accountId,
        executionId: input.executionId,
        state: executionState(execution),
        checkedAt: providerDate(execution.updatedAt, "reconciliation timestamp"),
      };
    },
  };
}
