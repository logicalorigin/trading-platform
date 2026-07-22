import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  algoAccountControlsTable,
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  type AlgoTargetExecution,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import { normalizeSymbol } from "../lib/values";
import {
  RobinhoodMcpSession,
  type RobinhoodMcpToolCall,
} from "../providers/robinhood/mcp-client";
import {
  buildAlgoTargetExecutionIdentity,
  reserveAlgoTargetExecution,
} from "./algo-target-execution-outbox";
import {
  sizeAlgoOptionLiveEntry,
  type AlgoOptionLiveSizingResult,
} from "./algo-option-live-sizing";
import { getRobinhoodBackedAccounts } from "./account";
import {
  buildRobinhoodOptionTaxOrder,
  placeRobinhoodOptionOrder,
  reviewRobinhoodOptionOrder,
  type PlaceRobinhoodOptionOrderOptions,
  type RobinhoodOptionOrderInput,
  type RobinhoodOptionOrderPlaceResponse,
  type RobinhoodOptionOrderReviewResponse,
  type ReviewRobinhoodOptionOrderOptions,
} from "./robinhood-option-orders";
import { getRobinhoodAccessToken } from "./robinhood-oauth";
import { requireStandardOptionContractIdentity } from "./standard-option-contract-identity";
import { createTaxOrderPreflight } from "./tax-planning";

const OPEN_EXPOSURE_STATUSES = [
  "opening",
  "open",
  "closing",
  "manual_takeover",
  "attention",
] as const;
const UNRESOLVED_EXECUTION_STATUSES = [
  "pending",
  "reviewed",
  "submitted",
  "reconciliation_required",
] as const;
const OPTION_LEVEL_2_CAPABILITY = "robinhood-option-level:option_level_2";
const ROBINHOOD_ACCOUNT_PREFIX = "robinhood:";

export type AlgoRobinhoodPlatformCaps = {
  maxContracts: number;
  maxPremium: number;
  maxBalanceAgeMs: number;
  maxQuoteAgeMs: number;
  maxRiskAgeMs: number;
};

export type PrepareAlgoRobinhoodOptionEntryInput = {
  appUserId: string;
  deploymentId: string;
  targetId: string;
  sourceEventId: string;
  strategyPositionKey: string;
  order: RobinhoodOptionOrderInput;
  platformCaps: AlgoRobinhoodPlatformCaps;
};

export type AlgoRobinhoodCapitalSnapshot = {
  netLiquidation: number;
  buyingPower: number;
  observedAt: Date;
};

export type AlgoRobinhoodRiskSnapshot = {
  dailyRealizedPnl: number;
  openSymbols: readonly string[];
  observedAt: Date;
};

export type LoadRobinhoodAccountOptionRiskInput = {
  appUserId: string;
  deploymentId: string;
  targetId: string;
  accountId: string;
};

export type LoadRobinhoodAccountOptionRiskOptions = {
  now?: () => Date;
  callTool?: (call: RobinhoodMcpToolCall) => Promise<unknown>;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  encryptionKey?: string;
  mcpUrl?: string;
};

export type PrepareAlgoRobinhoodOptionEntryDependencies = {
  now?: () => Date;
  loadCapital?: (input: {
    appUserId: string;
    accountId: string;
  }) => Promise<AlgoRobinhoodCapitalSnapshot>;
  loadRisk?: (
    input: LoadRobinhoodAccountOptionRiskInput,
  ) => Promise<AlgoRobinhoodRiskSnapshot>;
  loadRiskOptions?: Omit<LoadRobinhoodAccountOptionRiskOptions, "now">;
};

export type PreparedAlgoRobinhoodOptionEntry = {
  accountId: string;
  execution: AlgoTargetExecution;
  sizing: AlgoOptionLiveSizingResult | null;
  reused: boolean;
};

type AlgoTaxPreflightResult = Pick<
  Awaited<ReturnType<typeof createTaxOrderPreflight>>,
  "action" | "preflightToken"
>;

export type ExecuteAlgoRobinhoodOptionEntryDependencies =
  PrepareAlgoRobinhoodOptionEntryDependencies & {
    reviewOrder?: (
      options: ReviewRobinhoodOptionOrderOptions,
    ) => Promise<RobinhoodOptionOrderReviewResponse>;
    createTaxPreflight?: (
      input: { order: ReturnType<typeof buildRobinhoodOptionTaxOrder> },
      options: { appUserId: string },
    ) => Promise<AlgoTaxPreflightResult>;
    placeOrder?: (
      options: PlaceRobinhoodOptionOrderOptions,
    ) => Promise<RobinhoodOptionOrderPlaceResponse>;
  };

function entryBlocked(code: string, message: string): never {
  throw new HttpError(409, message, { code, expose: true });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateEntryOrder(order: RobinhoodOptionOrderInput) {
  if (
    order.side !== "Buy" ||
    order.positionEffect !== "Open" ||
    order.orderType !== "Limit" ||
    order.timeInForce !== "Day" ||
    (order.marketHours ?? "regular_hours") !== "regular_hours" ||
    (order.underlyingType != null && order.underlyingType !== "equity") ||
    order.stopPrice != null ||
    !Number.isSafeInteger(order.quantity) ||
    order.quantity <= 0 ||
    !Number.isFinite(order.limitPrice) ||
    Number(order.limitPrice) <= 0
  ) {
    return entryBlocked(
      "algo_live_entry_order_unsupported",
      "Automated Robinhood entries require a long single-leg Day limit order.",
    );
  }
  return requireStandardOptionContractIdentity({
    contractSymbol: order.contractSymbol,
    multiplier: order.multiplier,
    sharesPerContract: order.sharesPerContract,
    underlyingSymbol: order.chainSymbol,
    expiration: order.expiration,
    strike: order.strike,
    optionType: order.optionType,
  });
}

function validatePlatformCaps(caps: AlgoRobinhoodPlatformCaps): void {
  if (
    !Number.isSafeInteger(caps.maxContracts) ||
    caps.maxContracts <= 0 ||
    !Number.isFinite(caps.maxPremium) ||
    caps.maxPremium <= 0 ||
    !Number.isSafeInteger(caps.maxBalanceAgeMs) ||
    caps.maxBalanceAgeMs <= 0 ||
    !Number.isSafeInteger(caps.maxQuoteAgeMs) ||
    caps.maxQuoteAgeMs <= 0 ||
    !Number.isSafeInteger(caps.maxRiskAgeMs) ||
    caps.maxRiskAgeMs <= 0
  ) {
    throw new HttpError(422, "Live option platform caps are invalid.", {
      code: "algo_live_platform_caps_invalid",
      expose: true,
    });
  }
}

function validateStrategyPositionKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 256) {
    throw new HttpError(422, "Strategy position identity is invalid.", {
      code: "algo_strategy_position_key_invalid",
      expose: true,
    });
  }
  return key;
}

function premiumExposure(value: string | null): number {
  const amount = Number(value);
  if (value === null || !Number.isFinite(amount) || amount < 0) {
    return entryBlocked(
      "algo_premium_exposure_unknown",
      "Current algo premium exposure is unavailable.",
    );
  }
  return amount;
}

export async function loadRobinhoodAlgoOptionCapital(input: {
  appUserId: string;
  accountId: string;
}): Promise<AlgoRobinhoodCapitalSnapshot> {
  const accounts = await getRobinhoodBackedAccounts("live", input.appUserId);
  const account = accounts.find(
    (candidate) => candidate.id === input.accountId,
  );
  if (!account) {
    return entryBlocked(
      "algo_capital_base_unavailable",
      "A live Robinhood capital base is unavailable.",
    );
  }
  const netLiquidation = Number(account.netLiquidation);
  const buyingPower = Number(account.buyingPower);
  const observedAt = account.updatedAt;
  if (
    !Number.isFinite(netLiquidation) ||
    !Number.isFinite(buyingPower) ||
    !(observedAt instanceof Date) ||
    !Number.isFinite(observedAt.getTime())
  ) {
    return entryBlocked(
      "algo_capital_base_unavailable",
      "A live Robinhood capital base is unavailable.",
    );
  }
  return { netLiquidation, buyingPower, observedAt };
}

function riskSnapshotUnavailable(): never {
  throw new HttpError(503, "A fresh live risk snapshot is unavailable.", {
    code: "algo_live_risk_snapshot_unavailable",
    expose: true,
  });
}

function finiteRiskNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : riskSnapshotUnavailable();
  }
  if (typeof value !== "string" || !value.trim()) {
    return riskSnapshotUnavailable();
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : riskSnapshotUnavailable();
}

export async function loadRobinhoodAccountOptionRiskSnapshot(
  input: LoadRobinhoodAccountOptionRiskInput,
  options: LoadRobinhoodAccountOptionRiskOptions = {},
): Promise<AlgoRobinhoodRiskSnapshot> {
  const observedAt = options.now?.() ?? new Date();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    return riskSnapshotUnavailable();
  }

  const [context] = await db
    .select({
      deploymentId: algoDeploymentTargetsTable.deploymentId,
      accountId: brokerAccountsTable.id,
      lifecycle: algoDeploymentTargetsTable.lifecycle,
      accountOwnerId: brokerAccountsTable.appUserId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      accountMode: brokerAccountsTable.mode,
      includedInTrading: brokerAccountsTable.includedInTrading,
      accountStatus: brokerAccountsTable.accountStatus,
      accountCapabilities: brokerAccountsTable.capabilities,
      executionBlockers: brokerAccountsTable.executionBlockers,
      connectionOwnerId: brokerConnectionsTable.appUserId,
      connectionType: brokerConnectionsTable.connectionType,
      connectionProvider: brokerConnectionsTable.brokerProvider,
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
    !context ||
    context.deploymentId !== input.deploymentId ||
    context.accountId !== input.accountId
  ) {
    throw new HttpError(404, "Algorithm broker target not found.", {
      code: "algo_target_not_found",
    });
  }
  if (
    context.accountOwnerId !== input.appUserId ||
    context.connectionOwnerId !== input.appUserId
  ) {
    throw new HttpError(403, "Algorithm broker target access denied.", {
      code: "algo_target_forbidden",
    });
  }
  if (
    context.lifecycle !== "active" ||
    context.accountMode !== "live" ||
    !context.includedInTrading ||
    (context.accountStatus !== null && context.accountStatus !== "open") ||
    context.connectionType !== "broker" ||
    context.connectionProvider !== "robinhood" ||
    context.connectionStatus !== "connected" ||
    !context.accountCapabilities.includes("robinhood-agentic") ||
    !context.accountCapabilities.includes("execution-ready") ||
    !context.accountCapabilities.includes(OPTION_LEVEL_2_CAPABILITY) ||
    context.executionBlockers.length > 0
  ) {
    return entryBlocked(
      "algo_target_account_execution_blocked",
      "The Robinhood target is not ready for automated options trading.",
    );
  }

  const providerAccountId = context.providerAccountId.trim();
  const accountNumber = providerAccountId.startsWith(ROBINHOOD_ACCOUNT_PREFIX)
    ? providerAccountId.slice(ROBINHOOD_ACCOUNT_PREFIX.length).trim()
    : providerAccountId;
  if (!accountNumber) {
    return riskSnapshotUnavailable();
  }

  const positions = await db
    .select({ symbol: algoTargetPositionsTable.symbol })
    .from(algoTargetPositionsTable)
    .where(
      and(
        eq(algoTargetPositionsTable.appUserId, input.appUserId),
        eq(algoTargetPositionsTable.deploymentId, input.deploymentId),
        eq(algoTargetPositionsTable.targetId, input.targetId),
        inArray(algoTargetPositionsTable.status, OPEN_EXPOSURE_STATUSES),
      ),
    );
  const openSymbols = [
    ...new Set(positions.map(({ symbol }) => normalizeSymbol(symbol))),
  ].sort();
  if (openSymbols.some((symbol) => !symbol || symbol.length > 64)) {
    return riskSnapshotUnavailable();
  }

  const call: RobinhoodMcpToolCall = {
    name: "get_realized_pnl",
    arguments: {
      account_number: accountNumber,
      span: "day",
      asset_classes: ["option"],
      display_currency: "USD",
      timezone: "America/New_York",
    },
  };
  let payload: unknown;
  try {
    if (options.callTool) {
      payload = await options.callTool(call);
    } else {
      const accessToken = await getRobinhoodAccessToken({
        appUserId: input.appUserId,
        env: options.env,
        fetchImpl: options.fetchImpl,
        encryptionKey: options.encryptionKey,
        now: observedAt,
      });
      const session = new RobinhoodMcpSession({
        accessToken,
        fetchImpl: options.fetchImpl,
        mcpUrl: options.mcpUrl,
      });
      payload = await session.callTool(call);
    }
  } catch {
    return riskSnapshotUnavailable();
  }

  const data = asRecord(asRecord(payload)["data"]);
  if (
    data["account_number"] !== accountNumber ||
    data["window"] !== "day" ||
    data["display_currency"] !== "USD"
  ) {
    return riskSnapshotUnavailable();
  }
  return {
    dailyRealizedPnl: finiteRiskNumber(data["total_returns"]),
    openSymbols,
    observedAt,
  };
}

function assertExistingEntryMatches(input: {
  execution: AlgoTargetExecution;
  order: RobinhoodOptionOrderInput;
  occSymbol: string;
  strategyPositionKey: string;
  platformCaps: AlgoRobinhoodPlatformCaps;
}) {
  const contract = asRecord(input.execution.contractSnapshot);
  const order = asRecord(input.execution.orderSnapshot);
  const platformCaps = asRecord(order["platformCaps"]);
  if (
    input.execution.action !== "entry" ||
    String(contract["occSymbol"] ?? "") !== input.occSymbol ||
    String(contract["contractSymbol"] ?? "") !== input.order.contractSymbol ||
    Number(contract["multiplier"]) !== input.order.multiplier ||
    Number(contract["sharesPerContract"]) !== input.order.sharesPerContract ||
    String(contract["chainSymbol"] ?? "") !==
      input.order.chainSymbol.toUpperCase() ||
    String(contract["underlyingType"] ?? "") !==
      (input.order.underlyingType ?? "equity") ||
    String(contract["expiration"] ?? "") !== input.order.expiration ||
    Number(contract["strike"]) !== input.order.strike ||
    String(contract["optionType"] ?? "") !== input.order.optionType ||
    String(order["strategyPositionKey"] ?? "") !== input.strategyPositionKey ||
    String(order["side"] ?? "") !== input.order.side ||
    String(order["positionEffect"] ?? "") !== input.order.positionEffect ||
    String(order["orderType"] ?? "") !== input.order.orderType ||
    String(order["timeInForce"] ?? "") !== input.order.timeInForce ||
    String(order["marketHours"] ?? "") !==
      (input.order.marketHours ?? "regular_hours") ||
    Number(order["quantity"]) !== Number(input.execution.requestedQuantity) ||
    Number(order["requestedQuantity"]) !== input.order.quantity ||
    Number(order["limitPrice"]) !== input.order.limitPrice ||
    order["stopPrice"] !== null ||
    Number(platformCaps["maxContracts"]) !== input.platformCaps.maxContracts ||
    Number(platformCaps["maxPremium"]) !== input.platformCaps.maxPremium ||
    Number(platformCaps["maxBalanceAgeMs"]) !==
      input.platformCaps.maxBalanceAgeMs ||
    Number(platformCaps["maxQuoteAgeMs"]) !==
      input.platformCaps.maxQuoteAgeMs ||
    Number(platformCaps["maxRiskAgeMs"]) !== input.platformCaps.maxRiskAgeMs
  ) {
    return entryBlocked(
      "algo_target_execution_conflict",
      "This target execution identity already has different order facts.",
    );
  }
}

export async function prepareAlgoRobinhoodOptionEntry(
  input: PrepareAlgoRobinhoodOptionEntryInput,
  dependencies: PrepareAlgoRobinhoodOptionEntryDependencies = {},
): Promise<PreparedAlgoRobinhoodOptionEntry> {
  validatePlatformCaps(input.platformCaps);
  const now = dependencies.now?.() ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new HttpError(422, "Live option preparation time is invalid.", {
      code: "algo_live_preparation_invalid",
      expose: true,
    });
  }
  const strategyPositionKey = validateStrategyPositionKey(
    input.strategyPositionKey,
  );
  const contract = validateEntryOrder(input.order);

  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
    .limit(1);
  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }
  if (deployment.appUserId !== input.appUserId) {
    throw new HttpError(403, "Algorithm deployment access denied.", {
      code: "algo_deployment_forbidden",
    });
  }
  if (
    deployment.mode !== "live" ||
    !deployment.enabled ||
    deployment.isDraft ||
    deployment.archivedAt
  ) {
    return entryBlocked(
      "algo_live_deployment_not_running",
      "The live deployment is not running.",
    );
  }
  if (
    !deployment.symbolUniverse.includes(input.order.chainSymbol.toUpperCase())
  ) {
    return entryBlocked(
      "algo_live_symbol_not_allowed",
      "The option underlying is outside this deployment universe.",
    );
  }

  const [context] = await db
    .select({
      deploymentId: algoDeploymentTargetsTable.deploymentId,
      brokerAccountId: algoDeploymentTargetsTable.brokerAccountId,
      lifecycle: algoDeploymentTargetsTable.lifecycle,
      allowanceUnit: algoDeploymentTargetsTable.allowanceUnit,
      allowanceValue: algoDeploymentTargetsTable.allowanceValue,
      executionEnabled: algoDeploymentTargetsTable.executionEnabled,
      totalAlgoAllowanceUnit:
        algoAccountControlsTable.totalAlgoAllowanceUnit,
      totalAlgoAllowanceValue:
        algoAccountControlsTable.totalAlgoAllowanceValue,
      dailyLossLimitUsd: algoAccountControlsTable.dailyLossLimitUsd,
      dailyLossScope: algoAccountControlsTable.dailyLossScope,
      controlOwnerId: algoAccountControlsTable.appUserId,
      accountOwnerId: brokerAccountsTable.appUserId,
      accountMode: brokerAccountsTable.mode,
      includedInTrading: brokerAccountsTable.includedInTrading,
      accountStatus: brokerAccountsTable.accountStatus,
      accountCapabilities: brokerAccountsTable.capabilities,
      executionBlockers: brokerAccountsTable.executionBlockers,
      connectionOwnerId: brokerConnectionsTable.appUserId,
      connectionType: brokerConnectionsTable.connectionType,
      connectionProvider: brokerConnectionsTable.brokerProvider,
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
    .leftJoin(
      algoAccountControlsTable,
      eq(
        algoAccountControlsTable.brokerAccountId,
        algoDeploymentTargetsTable.brokerAccountId,
      ),
    )
    .where(eq(algoDeploymentTargetsTable.id, input.targetId))
    .limit(1);
  if (
    !context ||
    context.deploymentId !== input.deploymentId ||
    !context.brokerAccountId
  ) {
    throw new HttpError(404, "Algorithm broker target not found.", {
      code: "algo_target_not_found",
    });
  }
  if (!context.executionEnabled) {
    return entryBlocked(
      "algo_target_execution_disabled",
      "This account target is configured but not enabled for execution.",
    );
  }
  const accountReady =
    context.lifecycle === "active" &&
    context.accountOwnerId === input.appUserId &&
    context.controlOwnerId === input.appUserId &&
    context.connectionOwnerId === input.appUserId &&
    context.accountMode === "live" &&
    context.includedInTrading &&
    (context.accountStatus === null || context.accountStatus === "open") &&
    context.connectionType === "broker" &&
    context.connectionProvider === "robinhood" &&
    context.connectionStatus === "connected" &&
    context.accountCapabilities.includes("robinhood-agentic") &&
    context.accountCapabilities.includes("execution-ready") &&
    context.accountCapabilities.includes(OPTION_LEVEL_2_CAPABILITY) &&
    context.executionBlockers.length === 0 &&
    context.totalAlgoAllowanceUnit !== null &&
    context.totalAlgoAllowanceValue !== null;
  if (!accountReady) {
    return entryBlocked(
      "algo_target_account_execution_blocked",
      "The Robinhood target is not ready for automated options trading.",
    );
  }
  if (context.dailyLossLimitUsd === null) {
    return entryBlocked(
      "algo_account_daily_loss_limit_required",
      "A shared account daily-loss limit is required before live execution.",
    );
  }
  const accountDailyLossLimitUsd = Number(context.dailyLossLimitUsd);
  if (
    context.dailyLossScope !== "account_options_realized" ||
    !Number.isFinite(accountDailyLossLimitUsd) ||
    accountDailyLossLimitUsd <= 0
  ) {
    return entryBlocked(
      "algo_account_daily_loss_policy_invalid",
      "The shared account daily-loss policy is invalid.",
    );
  }

  const executionIdentity = buildAlgoTargetExecutionIdentity({
    appUserId: input.appUserId,
    deploymentId: input.deploymentId,
    targetId: input.targetId,
    sourceEventId: input.sourceEventId,
    action: "entry",
    actionIdentity: strategyPositionKey,
  });
  const [existing] = await db
    .select()
    .from(algoTargetExecutionsTable)
    .where(
      eq(
        algoTargetExecutionsTable.executionKey,
        executionIdentity.executionKey,
      ),
    )
    .limit(1);
  if (existing) {
    assertExistingEntryMatches({
      execution: existing,
      order: input.order,
      occSymbol: contract.occSymbol,
      strategyPositionKey,
      platformCaps: input.platformCaps,
    });
    return {
      accountId: context.brokerAccountId,
      execution: existing,
      sizing: null,
      reused: true,
    };
  }

  const [unresolved] = await db
    .select({ id: algoTargetExecutionsTable.id })
    .from(algoTargetExecutionsTable)
    .innerJoin(
      algoDeploymentTargetsTable,
      eq(algoDeploymentTargetsTable.id, algoTargetExecutionsTable.targetId),
    )
    .where(
      and(
        eq(algoDeploymentTargetsTable.brokerAccountId, context.brokerAccountId),
        inArray(
          algoTargetExecutionsTable.status,
          UNRESOLVED_EXECUTION_STATUSES,
        ),
      ),
    )
    .limit(1);
  if (unresolved) {
    return entryBlocked(
      "algo_broker_mutation_unresolved",
      "A broker mutation or reconciliation is still unresolved.",
    );
  }

  const positionRows = await db
    .select({
      targetId: algoTargetPositionsTable.targetId,
      symbol: algoTargetPositionsTable.symbol,
      premiumBasis: algoTargetPositionsTable.premiumBasis,
    })
    .from(algoTargetPositionsTable)
    .innerJoin(
      algoDeploymentTargetsTable,
      eq(algoDeploymentTargetsTable.id, algoTargetPositionsTable.targetId),
    )
    .where(
      and(
        eq(algoTargetPositionsTable.appUserId, input.appUserId),
        eq(algoDeploymentTargetsTable.brokerAccountId, context.brokerAccountId),
        inArray(algoTargetPositionsTable.status, OPEN_EXPOSURE_STATUSES),
      ),
    );
  let accountPremiumAtRisk = 0;
  let targetPremiumAtRisk = 0;
  for (const row of positionRows) {
    const exposure = premiumExposure(row.premiumBasis);
    accountPremiumAtRisk += exposure;
    if (row.targetId === input.targetId) targetPremiumAtRisk += exposure;
  }
  const underlying = input.order.chainSymbol.toUpperCase();
  if (
    positionRows.some(
      (row) =>
        row.targetId === input.targetId &&
        normalizeSymbol(row.symbol) === underlying,
    )
  ) {
    // ponytail: conservatively reject overlap until live target positions own
    // the saved same-direction/flip policy across Signal Options scans.
    return entryBlocked(
      "algo_live_target_symbol_position_exists",
      "This live target already owns an open position for the signal symbol.",
    );
  }

  const profile = resolveSignalOptionsExecutionProfile(deployment.config);
  if (
    !profile.riskHaltControls.dailyLossHaltEnabled ||
    !profile.riskHaltControls.openSymbolCapEnabled ||
    !profile.riskHaltControls.premiumBudgetEnabled
  ) {
    return entryBlocked(
      "algo_live_risk_halt_required",
      "All required live risk halts must be enabled.",
    );
  }

  const riskInput = {
    appUserId: input.appUserId,
    deploymentId: input.deploymentId,
    targetId: input.targetId,
    accountId: context.brokerAccountId,
  };
  const risk = dependencies.loadRisk
    ? await dependencies.loadRisk(riskInput)
    : await loadRobinhoodAccountOptionRiskSnapshot(riskInput, {
        ...dependencies.loadRiskOptions,
        now: dependencies.now,
      });
  const riskCheckedAt = dependencies.now?.() ?? new Date();
  const riskObservedAt = risk?.observedAt;
  const riskAgeMs =
    riskObservedAt instanceof Date
      ? riskCheckedAt.getTime() - riskObservedAt.getTime()
      : Number.NaN;
  if (
    !Number.isFinite(risk?.dailyRealizedPnl) ||
    !Array.isArray(risk?.openSymbols) ||
    risk.openSymbols.some((symbol) => typeof symbol !== "string") ||
    !Number.isFinite(riskAgeMs)
  ) {
    return entryBlocked(
      "algo_live_risk_snapshot_unavailable",
      "A fresh live risk snapshot is unavailable.",
    );
  }
  if (riskAgeMs < 0 || riskAgeMs > input.platformCaps.maxRiskAgeMs) {
    return entryBlocked(
      "algo_live_risk_snapshot_stale",
      "The live risk snapshot is stale.",
    );
  }
  const openSymbols = new Set(
    risk.openSymbols.map((symbol) => normalizeSymbol(symbol)),
  );
  if ([...openSymbols].some((symbol) => !symbol || symbol.length > 64)) {
    return entryBlocked(
      "algo_live_risk_snapshot_unavailable",
      "A fresh live risk snapshot is unavailable.",
    );
  }
  if (risk.dailyRealizedPnl <= -accountDailyLossLimitUsd) {
    return entryBlocked(
      "algo_live_daily_realized_loss_halt",
      "The configured daily realized-loss halt is active.",
    );
  }
  if (
    !openSymbols.has(underlying) &&
    openSymbols.size >= profile.riskCaps.maxOpenSymbols
  ) {
    return entryBlocked(
      "algo_live_open_symbol_halt",
      "The configured open-symbol halt is active.",
    );
  }

  const capital = await (
    dependencies.loadCapital ?? loadRobinhoodAlgoOptionCapital
  )({
    appUserId: input.appUserId,
    accountId: context.brokerAccountId,
  });
  const capitalCheckedAt = dependencies.now?.() ?? new Date();
  const totalAlgoAllowance =
    context.totalAlgoAllowanceUnit !== null &&
    context.totalAlgoAllowanceValue !== null
      ? {
          unit: context.totalAlgoAllowanceUnit,
          value: Number(context.totalAlgoAllowanceValue),
        }
      : entryBlocked(
          "algo_account_total_allowance_required",
          "A total algo allowance is required before live execution.",
        );
  const sizing = sizeAlgoOptionLiveEntry({
    requestedQuantity: input.order.quantity,
    limitPrice: input.order.limitPrice ?? Number.NaN,
    multiplier: input.order.multiplier,
    strategyMaxContracts: profile.riskCaps.maxContracts,
    strategyMaxPremium: profile.riskCaps.maxPremiumPerEntry,
    targetAllowance: {
      unit: context.allowanceUnit,
      value: Number(context.allowanceValue),
    },
    targetPremiumAtRisk,
    targetPremiumReserved: 0,
    totalAlgoAllowance,
    accountPremiumAtRisk,
    accountPremiumReserved: 0,
    platformMaxContracts: input.platformCaps.maxContracts,
    platformMaxPremium: input.platformCaps.maxPremium,
    netLiquidation: capital.netLiquidation,
    buyingPower: capital.buyingPower,
    balanceObservedAt: capital.observedAt,
    now: capitalCheckedAt,
    maxBalanceAgeMs: input.platformCaps.maxBalanceAgeMs,
  });
  const premiumAtRisk = sizing.quantity * sizing.premiumPerContract;
  const execution = await reserveAlgoTargetExecution({
    appUserId: input.appUserId,
    deploymentId: input.deploymentId,
    targetId: input.targetId,
    sourceEventId: input.sourceEventId,
    action: "entry",
    actionIdentity: strategyPositionKey,
    contractSnapshot: {
      contractSymbol: input.order.contractSymbol,
      occSymbol: contract.occSymbol,
      multiplier: contract.multiplier,
      sharesPerContract: contract.sharesPerContract,
      chainSymbol: input.order.chainSymbol.toUpperCase(),
      underlyingType: input.order.underlyingType ?? "equity",
      expiration: input.order.expiration,
      strike: input.order.strike,
      optionType: input.order.optionType,
    },
    orderSnapshot: {
      strategyPositionKey,
      side: input.order.side,
      positionEffect: input.order.positionEffect,
      orderType: input.order.orderType,
      timeInForce: input.order.timeInForce,
      marketHours: input.order.marketHours ?? "regular_hours",
      quantity: sizing.quantity,
      requestedQuantity: input.order.quantity,
      limitPrice: input.order.limitPrice,
      stopPrice: null,
      sizing,
      platformCaps: input.platformCaps,
      riskSnapshot: {
        dailyRealizedPnl: risk.dailyRealizedPnl,
        openSymbols: [...openSymbols].sort(),
        observedAt: riskObservedAt.toISOString(),
        accountDailyLossLimit: {
          unit: "usd",
          value: accountDailyLossLimitUsd,
          scope: "account_options_realized",
          timezone: "America/New_York",
        },
      },
    },
    requestedQuantity: sizing.quantity,
    premiumAtRisk,
    entryAdmission: {
      netLiquidation: capital.netLiquidation,
      buyingPower: capital.buyingPower,
      observedAt: capital.observedAt,
      maxCapitalAgeMs: input.platformCaps.maxBalanceAgeMs,
    },
    occurredAt: capitalCheckedAt,
  });
  return {
    accountId: context.brokerAccountId,
    execution,
    sizing,
    reused: false,
  };
}

type ExecutionSafetyFailure = {
  code: string;
  message: string;
};

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "Live option execution time is invalid.", {
      code: "algo_live_execution_time_invalid",
      expose: true,
    });
  }
  return value;
}

function hasContent(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function freshTimestamp(
  value: string | Date | null,
  now: Date,
  maxAgeMs: number,
): boolean {
  const milliseconds =
    value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""));
  const ageMs = now.getTime() - milliseconds;
  return Number.isFinite(milliseconds) && ageMs >= 0 && ageMs <= maxAgeMs;
}

function reviewSafetyFailure(input: {
  response: RobinhoodOptionOrderReviewResponse;
  accountId: string;
  order: RobinhoodOptionOrderInput;
  execution: AlgoTargetExecution;
  now: Date;
  maxQuoteAgeMs: number;
}): ExecutionSafetyFailure | null {
  const expected = validateEntryOrder(input.order);
  const reviewed = input.response.order;
  if (input.response.review.alerts.length > 0) {
    return {
      code: "algo_robinhood_review_alert",
      message: "Robinhood review returned an alert.",
    };
  }
  if (hasContent(input.response.review.orderChecks)) {
    return {
      code: "algo_robinhood_review_check",
      message: "Robinhood review returned an order check.",
    };
  }
  if (
    input.response.provider !== "robinhood" ||
    input.response.account.id !== input.accountId ||
    input.response.account.mode !== "live" ||
    !freshTimestamp(input.response.checkedAt, input.now, input.maxQuoteAgeMs) ||
    !reviewed.optionId ||
    reviewed.occSymbol !== expected.occSymbol ||
    reviewed.multiplier !== input.order.multiplier ||
    reviewed.sharesPerContract !== input.order.sharesPerContract ||
    reviewed.chainSymbol !== input.order.chainSymbol.toUpperCase() ||
    reviewed.underlyingType !== "equity" ||
    reviewed.expiration !== input.order.expiration ||
    reviewed.strike !== input.order.strike ||
    reviewed.optionType !== input.order.optionType ||
    reviewed.side !== input.order.side ||
    reviewed.positionEffect !== input.order.positionEffect ||
    reviewed.orderType !== input.order.orderType ||
    reviewed.timeInForce !== input.order.timeInForce ||
    reviewed.marketHours !== (input.order.marketHours ?? "regular_hours") ||
    reviewed.quantity !== input.order.quantity ||
    reviewed.limitPrice !== input.order.limitPrice ||
    reviewed.stopPrice !== null
  ) {
    return {
      code: "algo_robinhood_review_mismatch",
      message: "Robinhood review did not match the durable entry order.",
    };
  }
  const quote = input.response.review.quote;
  if (
    !quote ||
    quote.instrumentId !== reviewed.optionId ||
    !freshTimestamp(quote.updatedAt, input.now, input.maxQuoteAgeMs)
  ) {
    return {
      code: "algo_robinhood_quote_stale",
      message: "Robinhood did not return a fresh matching option quote.",
    };
  }
  const estimatedPremium = input.response.review.estimate.premium;
  const premiumAtRisk = Number(input.execution.premiumAtRisk);
  if (
    !Number.isFinite(estimatedPremium) ||
    Number(estimatedPremium) < 0 ||
    !Number.isFinite(premiumAtRisk) ||
    premiumAtRisk <= 0 ||
    Number(estimatedPremium) > premiumAtRisk
  ) {
    return {
      code: "algo_robinhood_review_premium_invalid",
      message: "Robinhood review premium exceeded the durable entry cap.",
    };
  }
  return null;
}

async function loadExecution(
  appUserId: string,
  executionId: string,
): Promise<AlgoTargetExecution> {
  const [execution] = await db
    .select()
    .from(algoTargetExecutionsTable)
    .where(
      and(
        eq(algoTargetExecutionsTable.id, executionId),
        eq(algoTargetExecutionsTable.appUserId, appUserId),
      ),
    )
    .limit(1);
  if (!execution) {
    throw new HttpError(409, "The durable target execution is unavailable.", {
      code: "algo_target_execution_unavailable",
      expose: true,
    });
  }
  return execution;
}

async function transitionExecution(input: {
  appUserId: string;
  executionId: string;
  fromStatus: AlgoTargetExecution["status"];
  status: AlgoTargetExecution["status"];
  now: Date;
  brokerOrderId?: string | null;
  brokerOrderState?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<{ claimed: boolean; execution: AlgoTargetExecution }> {
  const [execution] = await db
    .update(algoTargetExecutionsTable)
    .set({
      status: input.status,
      ...(input.brokerOrderId !== undefined
        ? { brokerOrderId: input.brokerOrderId }
        : {}),
      ...(input.brokerOrderState !== undefined
        ? { brokerOrderState: input.brokerOrderState }
        : {}),
      ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage !== undefined
        ? { errorMessage: input.errorMessage }
        : {}),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(algoTargetExecutionsTable.id, input.executionId),
        eq(algoTargetExecutionsTable.appUserId, input.appUserId),
        eq(algoTargetExecutionsTable.status, input.fromStatus),
      ),
    )
    .returning();
  if (execution) return { claimed: true, execution };
  return {
    claimed: false,
    execution: await loadExecution(input.appUserId, input.executionId),
  };
}

function sizedOrderFromExecution(
  input: PrepareAlgoRobinhoodOptionEntryInput,
  execution: AlgoTargetExecution,
): RobinhoodOptionOrderInput {
  const quantity = Number(execution.requestedQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return entryBlocked(
      "algo_target_execution_invalid",
      "The durable target quantity is invalid.",
    );
  }
  return { ...input.order, quantity };
}

function placeResponseFailure(input: {
  response: RobinhoodOptionOrderPlaceResponse;
  accountId: string;
  order: RobinhoodOptionOrderInput;
  execution: AlgoTargetExecution;
}): ExecutionSafetyFailure | null {
  const expected = validateEntryOrder(input.order);
  const placed = input.response.order;
  if (
    input.response.provider !== "robinhood" ||
    input.response.account.id !== input.accountId ||
    placed.refId !== input.execution.clientOrderId ||
    !placed.brokerageOrderId.trim() ||
    placed.brokerageOrderId.length > 128 ||
    placed.occSymbol !== expected.occSymbol ||
    placed.multiplier !== input.order.multiplier ||
    placed.sharesPerContract !== input.order.sharesPerContract ||
    placed.chainSymbol !== input.order.chainSymbol.toUpperCase() ||
    placed.underlyingType !== "equity" ||
    placed.expiration !== input.order.expiration ||
    placed.strike !== input.order.strike ||
    placed.optionType !== input.order.optionType ||
    placed.side !== input.order.side ||
    placed.positionEffect !== input.order.positionEffect ||
    placed.orderType !== input.order.orderType ||
    placed.timeInForce !== input.order.timeInForce ||
    placed.marketHours !== (input.order.marketHours ?? "regular_hours") ||
    placed.quantity !== input.order.quantity ||
    placed.limitPrice !== input.order.limitPrice ||
    placed.stopPrice !== null
  ) {
    return {
      code: "algo_robinhood_submit_response_invalid",
      message: "Robinhood submission returned an unmatched order.",
    };
  }
  if (input.response.alerts.length > 0) {
    return {
      code: "algo_robinhood_submit_alert",
      message: "Robinhood submission returned an alert.",
    };
  }
  return null;
}

async function rejectExecution(input: {
  appUserId: string;
  execution: AlgoTargetExecution;
  expectedStatus: "pending" | "reviewed";
  failure: ExecutionSafetyFailure;
  now: Date;
}): Promise<AlgoTargetExecution> {
  return (
    await transitionExecution({
      appUserId: input.appUserId,
      executionId: input.execution.id,
      fromStatus: input.expectedStatus,
      status: "rejected",
      errorCode: input.failure.code.slice(0, 128),
      errorMessage: input.failure.message.slice(0, 512),
      now: input.now,
    })
  ).execution;
}

function reviewedExecutionIsFresh(
  execution: AlgoTargetExecution,
  now: Date,
  maxQuoteAgeMs: number,
): boolean {
  return freshTimestamp(execution.updatedAt, now, maxQuoteAgeMs);
}

// This orchestrator is deliberately not wired to a signal worker. It proves the
// review/tax/mutation fence; reconciliation and live portfolio halts remain the
// required ceiling before live enablement can be removed.
export async function executePreparedAlgoRobinhoodOptionEntry(
  input: PrepareAlgoRobinhoodOptionEntryInput,
  dependencies: ExecuteAlgoRobinhoodOptionEntryDependencies = {},
): Promise<AlgoTargetExecution> {
  const prepared = await prepareAlgoRobinhoodOptionEntry(input, dependencies);
  let execution = prepared.execution;
  if (execution.status !== "pending" && execution.status !== "reviewed") {
    return execution;
  }
  const order = sizedOrderFromExecution(input, execution);

  if (execution.status === "pending") {
    const requestedAt = currentTime(dependencies.now);
    const review = await (
      dependencies.reviewOrder ?? reviewRobinhoodOptionOrder
    )({
      appUserId: input.appUserId,
      accountId: prepared.accountId,
      input: order,
      now: requestedAt,
    });
    const reviewedAt = currentTime(dependencies.now);
    const failure = reviewSafetyFailure({
      response: review,
      accountId: prepared.accountId,
      order,
      execution,
      now: reviewedAt,
      maxQuoteAgeMs: input.platformCaps.maxQuoteAgeMs,
    });
    if (failure) {
      return rejectExecution({
        appUserId: input.appUserId,
        execution,
        expectedStatus: "pending",
        failure,
        now: reviewedAt,
      });
    }
    const reviewed = await transitionExecution({
      appUserId: input.appUserId,
      executionId: execution.id,
      fromStatus: "pending",
      status: "reviewed",
      errorCode: null,
      errorMessage: null,
      now: reviewedAt,
    });
    if (!reviewed.claimed) return reviewed.execution;
    execution = reviewed.execution;
  }

  let now = currentTime(dependencies.now);
  if (
    !reviewedExecutionIsFresh(execution, now, input.platformCaps.maxQuoteAgeMs)
  ) {
    return rejectExecution({
      appUserId: input.appUserId,
      execution,
      expectedStatus: "reviewed",
      failure: {
        code: "algo_robinhood_review_stale",
        message: "The durable Robinhood review expired before submission.",
      },
      now,
    });
  }

  const taxOrder = buildRobinhoodOptionTaxOrder({
    accountId: prepared.accountId,
    order,
  });
  const taxPreflight = await (
    dependencies.createTaxPreflight ??
    ((body, options) => createTaxOrderPreflight(body, options))
  )({ order: taxOrder }, { appUserId: input.appUserId });
  if (taxPreflight.action !== "allow") {
    return rejectExecution({
      appUserId: input.appUserId,
      execution,
      expectedStatus: "reviewed",
      failure: {
        code:
          taxPreflight.action === "warn_ack_required"
            ? "algo_tax_acknowledgement_required"
            : "algo_tax_preflight_blocked",
        message:
          taxPreflight.action === "warn_ack_required"
            ? "Tax preflight requires a manual acknowledgement."
            : "Tax preflight blocked the automated entry.",
      },
      now: currentTime(dependencies.now),
    });
  }

  now = currentTime(dependencies.now);
  if (
    !reviewedExecutionIsFresh(execution, now, input.platformCaps.maxQuoteAgeMs)
  ) {
    return rejectExecution({
      appUserId: input.appUserId,
      execution,
      expectedStatus: "reviewed",
      failure: {
        code: "algo_robinhood_review_stale",
        message: "The durable Robinhood review expired before submission.",
      },
      now,
    });
  }

  const submitClaim = await transitionExecution({
    appUserId: input.appUserId,
    executionId: execution.id,
    fromStatus: "reviewed",
    status: "submitted",
    brokerOrderId: null,
    brokerOrderState: null,
    errorCode: null,
    errorMessage: null,
    now,
  });
  if (!submitClaim.claimed) return submitClaim.execution;
  execution = submitClaim.execution;

  try {
    const placed = await (dependencies.placeOrder ?? placeRobinhoodOptionOrder)(
      {
        appUserId: input.appUserId,
        accountId: prepared.accountId,
        input: {
          ...order,
          confirm: true,
          refId: execution.clientOrderId,
          taxPreflightToken: taxPreflight.preflightToken,
        },
        now,
      },
    );
    const failure = placeResponseFailure({
      response: placed,
      accountId: prepared.accountId,
      order,
      execution,
    });
    const reconciliationRequired = placed.reconcileRequired === true || failure;
    const brokerIdentityTrusted =
      !failure || failure.code === "algo_robinhood_submit_alert";
    return (
      await transitionExecution({
        appUserId: input.appUserId,
        executionId: execution.id,
        fromStatus: "submitted",
        status: reconciliationRequired
          ? "reconciliation_required"
          : "submitted",
        brokerOrderId: brokerIdentityTrusted
          ? placed.order.brokerageOrderId.trim().slice(0, 128) || null
          : null,
        brokerOrderState: placed.order.state?.trim().slice(0, 64) || null,
        errorCode: reconciliationRequired
          ? (failure?.code ?? "algo_robinhood_submit_reconciliation_required")
          : null,
        errorMessage: reconciliationRequired
          ? (failure?.message ??
            "Robinhood submission requires provider reconciliation.")
          : null,
        now: currentTime(dependencies.now),
      })
    ).execution;
  } catch (error) {
    const expectedReconciliation =
      error instanceof HttpError &&
      error.code === "robinhood_option_order_submit_reconcile_required";
    return (
      await transitionExecution({
        appUserId: input.appUserId,
        executionId: execution.id,
        fromStatus: "submitted",
        status: "reconciliation_required",
        errorCode: expectedReconciliation
          ? "robinhood_option_order_submit_reconcile_required"
          : "algo_robinhood_submit_outcome_unknown",
        errorMessage: expectedReconciliation
          ? "Robinhood submission requires provider reconciliation."
          : "Robinhood submission outcome is unknown and must be reconciled.",
        now: currentTime(dependencies.now),
      })
    ).execution;
  }
}
