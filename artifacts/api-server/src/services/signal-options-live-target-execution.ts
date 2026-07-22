import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  type AlgoTargetExecution,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import { normalizeSymbol } from "../lib/values";
import {
  getAlgoOptionProviderBuildReadiness,
  isAlgoOptionBrokerProvider,
  type AlgoOptionBrokerProvider,
} from "./algo-option-broker-adapter";
import {
  executePreparedAlgoRobinhoodOptionEntry,
  type PrepareAlgoRobinhoodOptionEntryInput,
} from "./algo-robinhood-option-execution";

// These are platform freshness policies, not user allocation controls. User
// contract/premium limits come from the saved deployment profile below.
export const SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY = {
  maxBalanceAgeMs: 45_000,
  maxQuoteAgeMs: 15_000,
  maxRiskAgeMs: 30_000,
} as const;

type LiveDeployment = {
  id: string;
  appUserId: string | null;
  mode: string;
  enabled: boolean;
  isDraft: boolean;
  archivedAt: Date | null;
};

type SignalOptionsLiveEntryPlan = {
  deployment: LiveDeployment;
  sourceEventId: string;
  selectedContract: Record<string, unknown>;
  orderPlan: Record<string, unknown>;
  profile: {
    riskCaps: {
      maxContracts: number;
      maxPremiumPerEntry: number;
    };
  };
};

export type SignalOptionsLiveTarget = {
  targetId: string;
  accountId: string;
  provider: AlgoOptionBrokerProvider;
};

type ProviderReadiness = {
  technicalReady: boolean;
  activationReleased: boolean;
  technicalBlockers: readonly string[];
};

export type SignalOptionsLiveTargetExecutionDependencies = {
  listTargets?: (input: {
    appUserId: string;
    deploymentId: string;
  }) => Promise<SignalOptionsLiveTarget[]>;
  describeProvider?: (
    provider: AlgoOptionBrokerProvider,
  ) => ProviderReadiness;
  executeRobinhoodEntry?: typeof executePreparedAlgoRobinhoodOptionEntry;
};

function invalidLiveOrder(message: string): never {
  throw new HttpError(422, message, {
    code: "signal_options_live_order_invalid",
    expose: true,
  });
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return invalidLiveOrder(message);
  }
  return value.trim();
}

function positiveNumber(value: unknown, message: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return invalidLiveOrder(message);
  }
  return number;
}

function positiveInteger(value: unknown, message: string): number {
  const number = positiveNumber(value, message);
  if (!Number.isSafeInteger(number)) {
    return invalidLiveOrder(message);
  }
  return number;
}

function expirationDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = requiredString(value, "The live option expiration is missing.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return invalidLiveOrder("The live option expiration is invalid.");
  }
  return raw;
}

function assertLiveDeployment(deployment: LiveDeployment): string {
  const appUserId = requiredString(
    deployment.appUserId,
    "The live deployment owner is missing.",
  );
  requiredString(deployment.id, "The live deployment identity is missing.");
  if (
    deployment.mode !== "live" ||
    !deployment.enabled ||
    deployment.isDraft ||
    deployment.archivedAt
  ) {
    throw new HttpError(409, "The live deployment is not running.", {
      code: "algo_live_deployment_not_running",
      expose: true,
    });
  }
  return appUserId;
}

export function buildSignalOptionsLiveEntryRequest(
  input: SignalOptionsLiveEntryPlan & { targetId: string },
): PrepareAlgoRobinhoodOptionEntryInput {
  const appUserId = assertLiveDeployment(input.deployment);
  const targetId = requiredString(
    input.targetId,
    "The live account target is missing.",
  );
  const sourceEventId = requiredString(
    input.sourceEventId,
    "The live signal intent is missing.",
  );
  const contractSymbol = requiredString(
    input.selectedContract.providerContractId,
    "The live option contract identity is missing.",
  );
  const chainSymbol = normalizeSymbol(
    requiredString(
      input.selectedContract.underlying,
      "The live option underlying is missing.",
    ),
  ).toUpperCase();
  if (!chainSymbol) {
    return invalidLiveOrder("The live option underlying is invalid.");
  }
  const multiplier = positiveInteger(
    input.selectedContract.multiplier,
    "The live option multiplier is invalid.",
  );
  const sharesPerContract = positiveInteger(
    input.selectedContract.sharesPerContract,
    "The live option contract size is invalid.",
  );
  if (multiplier !== 100 || sharesPerContract !== 100) {
    return invalidLiveOrder(
      "Automated live execution requires a standard 100-share option contract.",
    );
  }
  const right = requiredString(
    input.selectedContract.right,
    "The live option right is missing.",
  ).toLowerCase();
  if (right !== "call" && right !== "put") {
    return invalidLiveOrder("The live option right is invalid.");
  }

  return {
    appUserId,
    deploymentId: input.deployment.id,
    targetId,
    sourceEventId,
    strategyPositionKey: `signal-options:${sourceEventId}`,
    order: {
      contractSymbol,
      multiplier: 100,
      sharesPerContract: 100,
      chainSymbol,
      underlyingType: "equity",
      expiration: expirationDate(input.selectedContract.expirationDate),
      strike: positiveNumber(
        input.selectedContract.strike,
        "The live option strike is invalid.",
      ),
      optionType: right === "call" ? "Call" : "Put",
      side: "Buy",
      positionEffect: "Open",
      orderType: "Limit",
      timeInForce: "Day",
      marketHours: "regular_hours",
      quantity: positiveInteger(
        input.orderPlan.quantity,
        "The live option quantity is invalid.",
      ),
      limitPrice: positiveNumber(
        input.orderPlan.entryLimitPrice,
        "The live option limit price is invalid.",
      ),
      stopPrice: null,
    },
    platformCaps: {
      maxContracts: positiveInteger(
        input.profile.riskCaps.maxContracts,
        "The saved contract limit is invalid.",
      ),
      maxPremium: positiveNumber(
        input.profile.riskCaps.maxPremiumPerEntry,
        "The saved premium limit is invalid.",
      ),
      ...SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY,
    },
  };
}

async function listEnabledLiveTargets(input: {
  appUserId: string;
  deploymentId: string;
}): Promise<SignalOptionsLiveTarget[]> {
  const rows = await db
    .select({
      targetId: algoDeploymentTargetsTable.id,
      accountId: brokerAccountsTable.id,
      provider: brokerConnectionsTable.brokerProvider,
    })
    .from(algoDeploymentTargetsTable)
    .innerJoin(
      algoDeploymentsTable,
      eq(algoDeploymentsTable.id, algoDeploymentTargetsTable.deploymentId),
    )
    .innerJoin(
      brokerAccountsTable,
      eq(brokerAccountsTable.id, algoDeploymentTargetsTable.brokerAccountId),
    )
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(algoDeploymentTargetsTable.deploymentId, input.deploymentId),
        eq(algoDeploymentTargetsTable.lifecycle, "active"),
        eq(algoDeploymentTargetsTable.executionEnabled, true),
        eq(algoDeploymentsTable.appUserId, input.appUserId),
        eq(brokerAccountsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.appUserId, input.appUserId),
      ),
    );

  return rows.flatMap((row) =>
    row.provider && isAlgoOptionBrokerProvider(row.provider)
      ? [{ ...row, provider: row.provider }]
      : [],
  );
}

function executionFailure(error: unknown) {
  return {
    code:
      error instanceof HttpError && error.code
        ? error.code
        : "signal_options_live_target_execution_failed",
    message:
      error instanceof HttpError && error.expose
        ? error.message
        : "The live account target could not execute this signal.",
  };
}

export async function dispatchSignalOptionsLiveEntryTargets(
  input: SignalOptionsLiveEntryPlan,
  dependencies: SignalOptionsLiveTargetExecutionDependencies = {},
) {
  const appUserId = assertLiveDeployment(input.deployment);
  // Validate all signal/order/profile facts before reading or invoking a target.
  // The target identity itself is supplied separately for each account below.
  const validateTargetId = "00000000-0000-4000-8000-000000000000";
  buildSignalOptionsLiveEntryRequest({ ...input, targetId: validateTargetId });

  const targets = await (dependencies.listTargets ?? listEnabledLiveTargets)({
    appUserId,
    deploymentId: input.deployment.id,
  });
  const describe =
    dependencies.describeProvider ?? getAlgoOptionProviderBuildReadiness;
  const executeRobinhood =
    dependencies.executeRobinhoodEntry ?? executePreparedAlgoRobinhoodOptionEntry;

  const results = [];
  for (const target of targets) {
    const readiness = describe(target.provider);
    if (!readiness.technicalReady || !readiness.activationReleased) {
      results.push({
        ...target,
        status: "blocked" as const,
        code: readiness.technicalReady
          ? "algo_provider_activation_not_released"
          : "algo_provider_adapter_blocked",
        message: readiness.technicalReady
          ? "Automated execution has not been released for this provider."
          : "The Algo option adapter is not technically ready.",
        blockers: [...readiness.technicalBlockers],
        executionId: null,
        brokerOrderId: null,
      });
      continue;
    }
    if (target.provider !== "robinhood") {
      results.push({
        ...target,
        status: "blocked" as const,
        code: "algo_provider_entry_orchestrator_unavailable",
        message: "The provider live-entry orchestrator is unavailable.",
        blockers: ["algo.provider.entry_orchestrator_unavailable"],
        executionId: null,
        brokerOrderId: null,
      });
      continue;
    }

    try {
      const execution: AlgoTargetExecution = await executeRobinhood(
        buildSignalOptionsLiveEntryRequest({
          ...input,
          targetId: target.targetId,
        }),
      );
      results.push({
        ...target,
        status: execution.status,
        code: execution.errorCode ?? null,
        message: execution.errorMessage ?? null,
        blockers: [] as string[],
        executionId: execution.id,
        brokerOrderId: execution.brokerOrderId,
      });
    } catch (error) {
      const failure = executionFailure(error);
      results.push({
        ...target,
        status: "failed" as const,
        ...failure,
        blockers: [] as string[],
        executionId: null,
        brokerOrderId: null,
      });
    }
  }

  return {
    results,
    submitted: results.filter((result) =>
      ["submitted", "filled", "reconciliation_required"].includes(
        result.status,
      ),
    ).length,
  };
}
