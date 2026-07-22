import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  OrderPreviewSnapshot,
  PlaceOrderInput,
} from "@workspace/ibkr-contracts";
import {
  algoDeploymentTargetsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { eq } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import {
  ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE,
  ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS,
  type AlgoOptionBrokerAdapter,
  type AlgoOptionBrokerContext,
  type AlgoOptionBrokerOrder,
} from "./algo-option-broker-adapter";
import {
  listIbkrAccounts,
  listIbkrExecutions,
  listIbkrOrders,
} from "./ibkr-account-bridge";
import { runWithIbkrPortalUser } from "./ibkr-portal-context";
import {
  cancelOrder as cancelIbkrOrder,
  placeOrder as placeIbkrOrder,
  previewOrder as previewIbkrOrder,
} from "./platform";

type ResolvedIbkrAccount = {
  providerAccountId: string;
  mode: "live";
};

type IbkrPlacedOrder = BrokerOrderSnapshot & {
  placementConfirmed: boolean;
  reconciliationRequired: boolean;
};

type IbkrCancelResult = Awaited<ReturnType<typeof cancelIbkrOrder>>;

export type AlgoIbkrOptionAdapterDependencies = {
  now?: () => Date;
  resolveAccount?: (
    input: AlgoOptionBrokerContext,
  ) => Promise<ResolvedIbkrAccount>;
  readAccounts?: (input: {
    appUserId: string;
  }) => Promise<BrokerAccountSnapshot[]>;
  previewOrder?: (input: {
    appUserId: string;
    order: PlaceOrderInput;
  }) => Promise<OrderPreviewSnapshot>;
  submitOrder?: (input: {
    appUserId: string;
    order: PlaceOrderInput & { source: "automation" };
  }) => Promise<IbkrPlacedOrder>;
  cancelOrder?: (input: {
    appUserId: string;
    accountId: string;
    brokerOrderId: string;
  }) => Promise<IbkrCancelResult>;
  listOrders?: (input: {
    appUserId: string;
    accountId: string;
  }) => Promise<BrokerOrderSnapshot[]>;
  listExecutions?: (input: {
    appUserId: string;
    accountId: string;
  }) => Promise<BrokerExecutionSnapshot[]>;
};

function unavailable(): never {
  throw new HttpError(409, "This IBKR Algo operation is not available.", {
    code: "algo_provider_operation_unavailable",
    expose: true,
  });
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "IBKR adapter time is invalid.", {
      code: "algo_provider_adapter_time_invalid",
      expose: true,
    });
  }
  return value;
}

function expirationDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(date.getTime())) {
    throw new HttpError(422, "The option expiration is invalid.", {
      code: "algo_provider_order_invalid",
      expose: true,
    });
  }
  return date;
}

function finiteMoney(value: number | null, field: string): number {
  if (value == null || !Number.isFinite(value) || value < 0) {
    throw new HttpError(503, `IBKR ${field} is unavailable.`, {
      code: "algo_provider_capital_unavailable",
      expose: true,
    });
  }
  return value;
}

function parseAmount(value: string | null): number | null {
  if (!value?.trim()) return null;
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) ? Math.abs(number) : null;
}

function ibkrEntryOrder(
  accountId: string,
  order: AlgoOptionBrokerOrder,
): PlaceOrderInput {
  if (order.side !== "buy" || order.positionEffect !== "open") {
    throw new HttpError(409, "IBKR Algo entries must be buy-to-open.", {
      code: "algo_provider_order_unsupported",
      expose: true,
    });
  }
  return {
    accountId,
    mode: "live",
    clientOrderId: order.clientOrderId,
    symbol: order.contract.underlying,
    assetClass: "option",
    side: "buy",
    type: "limit",
    quantity: order.quantity,
    limitPrice: order.limitPrice,
    stopPrice: null,
    timeInForce: "day",
    optionContract: {
      ticker: order.contract.symbol,
      underlying: order.contract.underlying,
      expirationDate: expirationDate(order.contract.expiration),
      strike: order.contract.strike,
      right: order.contract.right,
      multiplier: order.contract.multiplier,
      sharesPerContract: order.contract.sharesPerContract,
      providerContractId: order.contract.providerContractId ?? null,
      brokerContractId: order.contract.brokerContractId ?? null,
      standardDeliverableVerified: true,
    },
    optionAction: "buy_to_open",
    positionEffect: "open",
    strategyIntent: "long_option",
    tradingSession: "regular",
    includeOvernight: false,
    taxPreflightToken: order.taxPreflightToken,
  };
}

async function resolveOwnedIbkrAccount(
  input: AlgoOptionBrokerContext,
): Promise<ResolvedIbkrAccount> {
  const [row] = await db
    .select({
      deploymentId: algoDeploymentTargetsTable.deploymentId,
      brokerAccountId: algoDeploymentTargetsTable.brokerAccountId,
      accountOwnerId: brokerAccountsTable.appUserId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      accountMode: brokerAccountsTable.mode,
      connectionOwnerId: brokerConnectionsTable.appUserId,
      connectionProvider: brokerConnectionsTable.brokerProvider,
      connectionType: brokerConnectionsTable.connectionType,
      connectionStatus: brokerConnectionsTable.status,
    })
    .from(algoDeploymentTargetsTable)
    .innerJoin(
      brokerAccountsTable,
      eq(brokerAccountsTable.id, algoDeploymentTargetsTable.brokerAccountId),
    )
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(eq(algoDeploymentTargetsTable.id, input.targetId))
    .limit(1);
  if (
    !row ||
    row.deploymentId !== input.deploymentId ||
    row.brokerAccountId !== input.accountId
  ) {
    throw new HttpError(404, "Algorithm broker target not found.", {
      code: "algo_target_not_found",
    });
  }
  if (
    row.accountOwnerId !== input.appUserId ||
    row.connectionOwnerId !== input.appUserId
  ) {
    throw new HttpError(403, "Algorithm broker target access denied.", {
      code: "algo_target_forbidden",
    });
  }
  if (
    row.accountMode !== "live" ||
    row.connectionProvider !== "ibkr" ||
    row.connectionType !== "broker" ||
    row.connectionStatus !== "connected" ||
    !row.providerAccountId.trim()
  ) {
    throw new HttpError(409, "The IBKR account is unavailable.", {
      code: "algo_provider_account_unavailable",
      expose: true,
    });
  }
  return { providerAccountId: row.providerAccountId.trim(), mode: "live" };
}

export function createAlgoIbkrOptionAdapter(
  dependencies: AlgoIbkrOptionAdapterDependencies = {},
): AlgoOptionBrokerAdapter {
  const resolveAccount = dependencies.resolveAccount ?? resolveOwnedIbkrAccount;
  const readAccounts =
    dependencies.readAccounts ??
    ((input: { appUserId: string }) =>
      runWithIbkrPortalUser(input.appUserId, () => listIbkrAccounts("live")));
  const previewOrder =
    dependencies.previewOrder ??
    ((input: { appUserId: string; order: PlaceOrderInput }) =>
      runWithIbkrPortalUser(input.appUserId, () => previewIbkrOrder(input.order)));
  const submitOrder =
    dependencies.submitOrder ??
    ((input: {
      appUserId: string;
      order: PlaceOrderInput & { source: "automation" };
    }) => runWithIbkrPortalUser(input.appUserId, () => placeIbkrOrder(input.order)));
  const cancelOrder =
    dependencies.cancelOrder ??
    ((input: {
      appUserId: string;
      accountId: string;
      brokerOrderId: string;
    }) =>
      runWithIbkrPortalUser(input.appUserId, () =>
        cancelIbkrOrder({
          accountId: input.accountId,
          orderId: input.brokerOrderId,
          mode: "live",
          confirm: true,
        }),
      ));
  const readOrders =
    dependencies.listOrders ??
    ((input: { appUserId: string; accountId: string }) =>
      runWithIbkrPortalUser(input.appUserId, () =>
        listIbkrOrders({ accountId: input.accountId, mode: "live" }),
      ));
  const readExecutions =
    dependencies.listExecutions ??
    ((input: { appUserId: string; accountId: string }) =>
      runWithIbkrPortalUser(input.appUserId, () =>
        listIbkrExecutions({ accountId: input.accountId, mode: "live" }),
      ));

  return {
    provider: "ibkr",
    activationReleased: ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE.ibkr,
    technicalBlockers: ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS.ibkr,
    async readCapital(input) {
      const account = await resolveAccount(input);
      const accounts = await readAccounts({ appUserId: input.appUserId });
      const snapshot = accounts.find(
        (candidate) =>
          candidate.providerAccountId === account.providerAccountId ||
          candidate.id === account.providerAccountId,
      );
      if (!snapshot) {
        throw new HttpError(503, "IBKR capital is unavailable.", {
          code: "algo_provider_capital_unavailable",
          expose: true,
        });
      }
      return {
        accountId: input.accountId,
        netLiquidation: finiteMoney(
          snapshot.netLiquidation,
          "net liquidation",
        ),
        buyingPower: finiteMoney(snapshot.buyingPower, "buying power"),
        observedAt: snapshot.updatedAt,
      };
    },
    async readRisk() {
      return unavailable();
    },
    async reviewOrder(input) {
      const account = await resolveAccount(input);
      const preview = await previewOrder({
        appUserId: input.appUserId,
        order: ibkrEntryOrder(account.providerAccountId, input.order),
      });
      const warnings = [...preview.whatIf.warnings];
      if (preview.whatIf.error) warnings.push("ibkr_what_if_error");
      return {
        provider: "ibkr",
        accountId: input.accountId,
        checkedAt: currentTime(dependencies.now),
        accepted: warnings.length === 0,
        warnings,
        estimatedPremium:
          parseAmount(preview.whatIf.amount) ?? parseAmount(preview.whatIf.total),
      };
    },
    async submitEntry(input) {
      const account = await resolveAccount(input);
      const response = await submitOrder({
        appUserId: input.appUserId,
        order: {
          ...ibkrEntryOrder(account.providerAccountId, input.order),
          confirm: true,
          source: "automation",
        },
      });
      return {
        provider: "ibkr",
        accountId: input.accountId,
        brokerOrderId: response.id,
        clientOrderId: response.clientOrderId ?? input.order.clientOrderId,
        status: response.status,
        submittedAt: response.updatedAt,
        reconciliationRequired: response.reconciliationRequired,
      };
    },
    async submitOwnedPositionExit() {
      return unavailable();
    },
    async cancelOrder(input) {
      const account = await resolveAccount(input);
      const response = await cancelOrder({
        appUserId: input.appUserId,
        accountId: account.providerAccountId,
        brokerOrderId: input.brokerOrderId,
      });
      return {
        provider: "ibkr",
        accountId: input.accountId,
        brokerOrderId: response.orderId,
        accepted: response.cancelConfirmed,
        checkedAt: response.submittedAt,
        reconciliationRequired: response.reconciliationRequired,
      };
    },
    async listOrders(input) {
      const account = await resolveAccount(input);
      const orders = await readOrders({
        appUserId: input.appUserId,
        accountId: account.providerAccountId,
      });
      return orders
        .filter((order) => order.assetClass === "option")
        .map((order) => ({
          provider: "ibkr" as const,
          accountId: input.accountId,
          brokerOrderId: order.id,
          clientOrderId: order.clientOrderId ?? null,
          contractSymbol: order.optionContract?.ticker ?? order.symbol,
          status: order.status,
          quantity: order.quantity,
          filledQuantity: order.filledQuantity,
          limitPrice: order.limitPrice,
          observedAt: order.updatedAt,
        }));
    },
    async listFills(input) {
      const account = await resolveAccount(input);
      const executions = await readExecutions({
        appUserId: input.appUserId,
        accountId: account.providerAccountId,
      });
      return executions.flatMap((execution) => {
        const brokerOrderId = execution.orderRef?.trim();
        if (
          execution.assetClass !== "option" ||
          !brokerOrderId ||
          !Number.isFinite(execution.quantity) ||
          execution.quantity <= 0 ||
          !Number.isFinite(execution.price) ||
          execution.price <= 0
        ) {
          return [];
        }
        return [{
          provider: "ibkr" as const,
          accountId: input.accountId,
          brokerOrderId,
          fillId: execution.id,
          contractSymbol: execution.optionContract?.ticker ?? execution.symbol,
          quantity: execution.quantity,
          price: execution.price,
          executedAt: execution.executedAt,
        }];
      });
    },
    async reconcile() {
      return unavailable();
    },
  };
}
