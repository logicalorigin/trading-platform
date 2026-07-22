import { HttpError } from "../lib/errors";

export const ALGO_OPTION_BROKER_PROVIDERS = [
  "robinhood",
  "schwab",
  "snaptrade",
  "ibkr",
] as const;

export type AlgoOptionBrokerProvider =
  (typeof ALGO_OPTION_BROKER_PROVIDERS)[number];

export function isAlgoOptionBrokerProvider(
  value: unknown,
): value is AlgoOptionBrokerProvider {
  return (
    typeof value === "string" &&
    (ALGO_OPTION_BROKER_PROVIDERS as readonly string[]).includes(value)
  );
}

export const ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS = {
  robinhood: [],
  schwab: [
    "schwab.order_tooling_unverified",
    "algo.provider.capital_snapshot_unavailable",
    "algo.provider.daily_risk_snapshot_unavailable",
    "algo.provider.deterministic_client_order_id_unavailable",
    "algo.provider.owned_exit_context_unavailable",
    "algo.provider.fill_reconciliation_unavailable",
  ],
  snaptrade: [
    "algo.provider.snaptrade_brokerage_option_fixture_required",
    "algo.provider.daily_risk_snapshot_unavailable",
    "algo.provider.deterministic_client_order_id_unavailable",
    "algo.provider.owned_exit_context_unavailable",
    "algo.provider.reconciliation_incomplete",
  ],
  ibkr: [
    "ibkr.automated_live_orders_disabled",
    "ibkr.special_connector_activation_unavailable",
    "algo.provider.daily_risk_snapshot_unavailable",
    "algo.provider.owned_exit_context_unavailable",
    "algo.provider.reconciliation_incomplete",
  ],
} as const satisfies Record<AlgoOptionBrokerProvider, readonly string[]>;

export const ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE = {
  robinhood: true,
  schwab: false,
  snaptrade: false,
  ibkr: false,
} as const satisfies Record<AlgoOptionBrokerProvider, boolean>;

export function getAlgoOptionProviderBuildReadiness(
  provider: AlgoOptionBrokerProvider,
) {
  const technicalBlockers = [
    ...ALGO_OPTION_PROVIDER_TECHNICAL_BLOCKERS[provider],
  ];
  return {
    provider,
    adapterImplemented: true as const,
    technicalReady: technicalBlockers.length === 0,
    technicalBlockers,
    activationReleased: ALGO_OPTION_PROVIDER_ACTIVATION_RELEASE[provider],
  };
}

export type AlgoOptionBrokerContext = {
  appUserId: string;
  accountId: string;
  deploymentId: string;
  targetId: string;
};

export type AlgoOptionBrokerOrder = {
  contract: {
    symbol: string;
    underlying: string;
    expiration: string;
    strike: number;
    right: "call" | "put";
    multiplier: 100;
    sharesPerContract: 100;
    providerContractId?: string | null;
    brokerContractId?: string | null;
  };
  side: "buy" | "sell";
  positionEffect: "open" | "close";
  orderType: "limit";
  timeInForce: "day";
  quantity: number;
  limitPrice: number;
  clientOrderId: string;
  taxPreflightToken: string;
};

export type AlgoOptionBrokerCapital = {
  accountId: string;
  netLiquidation: number;
  buyingPower: number;
  observedAt: Date;
};

export type AlgoOptionBrokerRisk = {
  accountId: string;
  dailyRealizedPnl: number;
  openSymbols: readonly string[];
  observedAt: Date;
};

export type AlgoOptionBrokerReview = {
  provider: AlgoOptionBrokerProvider;
  accountId: string;
  checkedAt: Date;
  accepted: boolean;
  warnings: string[];
  estimatedPremium: number | null;
};

export type AlgoOptionBrokerSubmission = {
  provider: AlgoOptionBrokerProvider;
  accountId: string;
  brokerOrderId: string | null;
  clientOrderId: string;
  status: string;
  submittedAt: Date;
  reconciliationRequired: boolean;
};

export type AlgoOptionBrokerCancellation = {
  provider: AlgoOptionBrokerProvider;
  accountId: string;
  brokerOrderId: string;
  accepted: boolean;
  checkedAt: Date;
  reconciliationRequired: boolean;
};

export type AlgoOptionBrokerOrderSnapshot = {
  provider: AlgoOptionBrokerProvider;
  accountId: string;
  brokerOrderId: string;
  clientOrderId: string | null;
  contractSymbol: string | null;
  status: string;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  observedAt: Date;
};

export type AlgoOptionBrokerFillSnapshot = {
  provider: AlgoOptionBrokerProvider;
  accountId: string;
  brokerOrderId: string;
  fillId: string;
  contractSymbol: string | null;
  quantity: number;
  price: number;
  executedAt: Date;
};

export type AlgoOptionBrokerReconciliation = {
  provider: AlgoOptionBrokerProvider;
  accountId: string;
  executionId: string;
  state: "pending" | "submitted" | "partially_filled" | "filled" | "cancelled" | "attention";
  checkedAt: Date;
};

type OrderInput = AlgoOptionBrokerContext & { order: AlgoOptionBrokerOrder };

export type AlgoOptionBrokerAdapter = {
  provider: AlgoOptionBrokerProvider;
  activationReleased: boolean;
  technicalBlockers: readonly string[];
  readCapital(input: AlgoOptionBrokerContext): Promise<AlgoOptionBrokerCapital>;
  readRisk(input: AlgoOptionBrokerContext): Promise<AlgoOptionBrokerRisk>;
  reviewOrder(input: OrderInput): Promise<AlgoOptionBrokerReview>;
  submitEntry(input: OrderInput): Promise<AlgoOptionBrokerSubmission>;
  submitOwnedPositionExit(
    input: OrderInput & {
      ownedPosition: {
        deploymentId: string;
        targetId: string;
        positionId: string;
        targetExecutionId: string;
        providerPositionId: string;
      };
    },
  ): Promise<AlgoOptionBrokerSubmission>;
  cancelOrder(
    input: AlgoOptionBrokerContext & { brokerOrderId: string },
  ): Promise<AlgoOptionBrokerCancellation>;
  listOrders(
    input: AlgoOptionBrokerContext,
  ): Promise<AlgoOptionBrokerOrderSnapshot[]>;
  listFills(
    input: AlgoOptionBrokerContext,
  ): Promise<AlgoOptionBrokerFillSnapshot[]>;
  reconcile(
    input: AlgoOptionBrokerContext & {
      executionId: string;
      action: "entry" | "exit";
    },
  ): Promise<AlgoOptionBrokerReconciliation>;
};

export type AlgoOptionBrokerMutationAuthorityInput = AlgoOptionBrokerContext & {
  provider: AlgoOptionBrokerProvider;
  action: "entry" | "exit" | "cancel";
};

export type AlgoOptionBrokerDispatcherOptions = {
  authorizeMutation?: (
    input: AlgoOptionBrokerMutationAuthorityInput,
  ) => Promise<void>;
};

const REQUIRED_METHODS = [
  "readCapital",
  "readRisk",
  "reviewOrder",
  "submitEntry",
  "submitOwnedPositionExit",
  "cancelOrder",
  "listOrders",
  "listFills",
  "reconcile",
] as const satisfies readonly (keyof AlgoOptionBrokerAdapter)[];

function adapterError(code: string, message: string, statusCode = 500): never {
  throw new HttpError(statusCode, message, { code, expose: statusCode < 500 });
}

function validateContext(input: AlgoOptionBrokerContext): AlgoOptionBrokerContext {
  const appUserId = input.appUserId?.trim();
  const accountId = input.accountId?.trim();
  const deploymentId = input.deploymentId?.trim();
  const targetId = input.targetId?.trim();
  if (!appUserId || !accountId || !deploymentId || !targetId) {
    return adapterError(
      "algo_provider_adapter_context_invalid",
      "The Algo broker account context is invalid.",
      422,
    );
  }
  return { appUserId, accountId, deploymentId, targetId };
}

function assertTechnicalReady(adapter: AlgoOptionBrokerAdapter): void {
  if (adapter.technicalBlockers.length > 0) {
    return adapterError(
      "algo_provider_adapter_blocked",
      "The Algo option adapter is not technically ready.",
      409,
    );
  }
}

function assertMutationReleased(adapter: AlgoOptionBrokerAdapter): void {
  assertTechnicalReady(adapter);
  if (!adapter.activationReleased) {
    return adapterError(
      "algo_provider_activation_not_released",
      "Automated execution has not been released for this provider.",
      409,
    );
  }
}

export function createAlgoOptionBrokerDispatcher(
  adapters: readonly AlgoOptionBrokerAdapter[],
  options: AlgoOptionBrokerDispatcherOptions = {},
) {
  const byProvider = new Map<AlgoOptionBrokerProvider, AlgoOptionBrokerAdapter>();
  for (const adapter of adapters) {
    if (!ALGO_OPTION_BROKER_PROVIDERS.includes(adapter.provider)) {
      adapterError(
        "algo_provider_adapter_unknown",
        "The Algo option adapter provider is unknown.",
      );
    }
    if (byProvider.has(adapter.provider)) {
      adapterError(
        "algo_provider_adapter_duplicate",
        "Only one Algo option adapter may be registered per provider.",
      );
    }
    if (
      typeof adapter.activationReleased !== "boolean" ||
      !Array.isArray(adapter.technicalBlockers) ||
      adapter.technicalBlockers.some(
        (blocker) => typeof blocker !== "string" || !blocker.trim(),
      ) ||
      REQUIRED_METHODS.some((method) => typeof adapter[method] !== "function")
    ) {
      adapterError(
        "algo_provider_adapter_incomplete",
        "The Algo option adapter is incomplete.",
      );
    }
    byProvider.set(adapter.provider, adapter);
  }

  const adapterFor = (provider: AlgoOptionBrokerProvider) => {
    const adapter = byProvider.get(provider);
    return (
      adapter ??
      adapterError(
        "algo_provider_adapter_unavailable",
        "No Algo option adapter is available for this provider.",
        409,
      )
    );
  };

  return {
    describe(provider: AlgoOptionBrokerProvider) {
      const adapter = adapterFor(provider);
      return {
        provider: adapter.provider,
        adapterComplete: true as const,
        technicalReady: adapter.technicalBlockers.length === 0,
        technicalBlockers: [...new Set(adapter.technicalBlockers)],
        activationReleased: adapter.activationReleased,
      };
    },
    readCapital(input: AlgoOptionBrokerContext & { provider: AlgoOptionBrokerProvider }) {
      return adapterFor(input.provider).readCapital(validateContext(input));
    },
    readRisk(input: AlgoOptionBrokerContext & { provider: AlgoOptionBrokerProvider }) {
      return adapterFor(input.provider).readRisk(validateContext(input));
    },
    async reviewOrder(input: OrderInput & { provider: AlgoOptionBrokerProvider }) {
      const adapter = adapterFor(input.provider);
      assertTechnicalReady(adapter);
      return adapter.reviewOrder({ ...validateContext(input), order: input.order });
    },
    async submitEntry(
      input: OrderInput & { provider: AlgoOptionBrokerProvider },
    ) {
      const adapter = adapterFor(input.provider);
      assertMutationReleased(adapter);
      const context = validateContext(input);
      if (!options.authorizeMutation) {
        return adapterError(
          "algo_provider_mutation_authority_unavailable",
          "Persisted Algo target authority is unavailable.",
          409,
        );
      }
      await options.authorizeMutation({
        ...context,
        provider: input.provider,
        action: "entry",
      });
      return adapter.submitEntry({ ...context, order: input.order });
    },
    async submitOwnedPositionExit(
      input: OrderInput & {
        provider: AlgoOptionBrokerProvider;
        ownedPosition: Parameters<AlgoOptionBrokerAdapter["submitOwnedPositionExit"]>[0]["ownedPosition"];
      },
    ) {
      const adapter = adapterFor(input.provider);
      assertMutationReleased(adapter);
      const context = validateContext(input);
      if (!options.authorizeMutation) {
        return adapterError(
          "algo_provider_mutation_authority_unavailable",
          "Persisted Algo target authority is unavailable.",
          409,
        );
      }
      await options.authorizeMutation({
        ...context,
        provider: input.provider,
        action: "exit",
      });
      return adapter.submitOwnedPositionExit({
        ...context,
        order: input.order,
        ownedPosition: input.ownedPosition,
      });
    },
    async cancelOrder(
      input: AlgoOptionBrokerContext & {
        provider: AlgoOptionBrokerProvider;
        brokerOrderId: string;
      },
    ) {
      const adapter = adapterFor(input.provider);
      assertMutationReleased(adapter);
      const context = validateContext(input);
      if (!options.authorizeMutation) {
        return adapterError(
          "algo_provider_mutation_authority_unavailable",
          "Persisted Algo target authority is unavailable.",
          409,
        );
      }
      await options.authorizeMutation({
        ...context,
        provider: input.provider,
        action: "cancel",
      });
      return adapter.cancelOrder({
        ...context,
        brokerOrderId: input.brokerOrderId,
      });
    },
    listOrders(input: AlgoOptionBrokerContext & { provider: AlgoOptionBrokerProvider }) {
      return adapterFor(input.provider).listOrders(validateContext(input));
    },
    listFills(input: AlgoOptionBrokerContext & { provider: AlgoOptionBrokerProvider }) {
      return adapterFor(input.provider).listFills(validateContext(input));
    },
    reconcile(
      input: AlgoOptionBrokerContext & {
        provider: AlgoOptionBrokerProvider;
        executionId: string;
        action: "entry" | "exit";
      },
    ) {
      return adapterFor(input.provider).reconcile({
        ...validateContext(input),
        executionId: input.executionId,
        action: input.action,
      });
    },
  };
}
