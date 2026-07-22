import {
  algoDeploymentTargetsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  type AlgoTargetExecution,
  type AlgoTargetPosition,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import { readRobinhoodAccountPositions } from "./robinhood-account-positions";
import {
  listRobinhoodOptionOrders,
  type RobinhoodOptionRecentOrdersResponse,
} from "./robinhood-option-orders";

const ROBINHOOD_ACCOUNT_PREFIX = "robinhood:";
const RECONCILABLE_EXECUTION_STATUSES = [
  "submitted",
  "reconciliation_required",
] as const;
const ATTRIBUTED_POSITION_STATUSES = [
  "opening",
  "open",
  "closing",
  "manual_takeover",
  "attention",
] as const;

export type AlgoRobinhoodProviderPosition = {
  accountId: string;
  symbol: string;
  assetClass: string;
  quantity: number;
  optionContract: {
    ticker: string;
    underlying: string;
    expirationDate: Date | string;
    strike: number;
    right: "call" | "put";
    multiplier: number;
    sharesPerContract: number;
    providerContractId: string | null;
    brokerContractId?: string | null;
  } | null;
};

export type ReconcileAlgoRobinhoodOptionEntryDependencies = {
  now?: () => Date;
  loadOrders?: (input: {
    appUserId: string;
    accountId: string;
    now: Date;
  }) => Promise<RobinhoodOptionRecentOrdersResponse>;
  loadPositions?: (input: {
    appUserId: string;
    accountId: string;
    accountNumber: string;
    now: Date;
  }) => Promise<AlgoRobinhoodProviderPosition[]>;
};

export type ReconcileAlgoRobinhoodOptionExitDependencies =
  ReconcileAlgoRobinhoodOptionEntryDependencies;

type ExpectedEntry = {
  strategyPositionKey: string;
  symbol: string;
  occSymbol: string;
  expiration: string;
  strike: number;
  optionType: "Call" | "Put";
  multiplier: 100;
  sharesPerContract: 100;
  orderType: "Limit";
  requestedQuantity: number;
  limitPrice: number;
  premiumAtRisk: number;
  maxProviderReadAgeMs: number;
};

type ExpectedExit = {
  positionId: string;
  strategyPositionKey: string;
  symbol: string;
  occSymbol: string;
  expiration: string;
  strike: number;
  optionType: "Call" | "Put";
  multiplier: 100;
  sharesPerContract: 100;
  orderType: "Limit";
  requestedQuantity: number;
  limitPrice: number;
  maxProviderReadAgeMs: number;
};

type ProviderOrderProof = {
  state: string;
  filledQuantity: number;
  checkedAt: Date;
  openedAt: Date;
};

type ProviderExitOrderProof = Omit<ProviderOrderProof, "openedAt">;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "Robinhood reconciliation time is invalid.", {
      code: "algo_reconciliation_time_invalid",
      expose: true,
    });
  }
  return value;
}

function dateValue(value: Date | string | null): Date | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function freshDate(value: Date | string | null, now: Date, maxAgeMs: number) {
  const date = dateValue(value);
  if (!date) return null;
  const ageMs = now.getTime() - date.getTime();
  return ageMs >= 0 && ageMs <= maxAgeMs ? date : null;
}

function positiveString(record: Record<string, unknown>, key: string) {
  const raw = record[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? value : null;
}

function isReconcileableStatus(status: AlgoTargetExecution["status"]): boolean {
  return status === "submitted" || status === "reconciliation_required";
}

function isAttributedPositionStatus(status: string): boolean {
  return ATTRIBUTED_POSITION_STATUSES.some((candidate) => candidate === status);
}

function expectedEntry(execution: AlgoTargetExecution): ExpectedEntry | null {
  const contract = asRecord(execution.contractSnapshot);
  const order = asRecord(execution.orderSnapshot);
  const platformCaps = asRecord(order["platformCaps"]);
  const requestedQuantity = Number(execution.requestedQuantity);
  const premiumAtRisk = Number(execution.premiumAtRisk);
  const multiplier = Number(contract["multiplier"]);
  const sharesPerContract = Number(contract["sharesPerContract"]);
  const strike = Number(contract["strike"]);
  const limitPrice = Number(order["limitPrice"]);
  const maxProviderReadAgeMs = Number(platformCaps["maxQuoteAgeMs"]);
  const premiumMicros = Math.round(premiumAtRisk * 1_000_000);
  const optionType = contract["optionType"];
  const strategyPositionKey = positiveString(order, "strategyPositionKey");
  const symbol = positiveString(contract, "chainSymbol");
  const occSymbol = positiveString(contract, "occSymbol");
  const expiration = positiveString(contract, "expiration");
  if (
    execution.action !== "entry" ||
    !strategyPositionKey ||
    strategyPositionKey.length > 256 ||
    !symbol ||
    !occSymbol ||
    !expiration ||
    (optionType !== "Call" && optionType !== "Put") ||
    multiplier !== 100 ||
    sharesPerContract !== 100 ||
    !Number.isFinite(strike) ||
    strike <= 0 ||
    order["side"] !== "Buy" ||
    order["positionEffect"] !== "Open" ||
    order["orderType"] !== "Limit" ||
    order["timeInForce"] !== "Day" ||
    order["marketHours"] !== "regular_hours" ||
    contract["underlyingType"] !== "equity" ||
    Number(order["quantity"]) !== requestedQuantity ||
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity <= 0 ||
    !Number.isFinite(limitPrice) ||
    limitPrice <= 0 ||
    order["stopPrice"] !== null ||
    !Number.isFinite(premiumAtRisk) ||
    premiumAtRisk <= 0 ||
    !Number.isSafeInteger(premiumMicros) ||
    !Number.isSafeInteger(maxProviderReadAgeMs) ||
    maxProviderReadAgeMs <= 0
  ) {
    return null;
  }
  return {
    strategyPositionKey,
    symbol,
    occSymbol,
    expiration,
    strike,
    optionType,
    multiplier: 100,
    sharesPerContract: 100,
    orderType: "Limit",
    requestedQuantity,
    limitPrice,
    premiumAtRisk,
    maxProviderReadAgeMs,
  };
}

function expectedExit(execution: AlgoTargetExecution): ExpectedExit | null {
  const contract = asRecord(execution.contractSnapshot);
  const order = asRecord(execution.orderSnapshot);
  const platformCaps = asRecord(order["platformCaps"]);
  const requestedQuantity = Number(execution.requestedQuantity);
  const multiplier = Number(contract["multiplier"]);
  const sharesPerContract = Number(contract["sharesPerContract"]);
  const strike = Number(contract["strike"]);
  const limitPrice = Number(order["limitPrice"]);
  const maxProviderReadAgeMs = Number(platformCaps["maxQuoteAgeMs"]);
  const optionType = contract["optionType"];
  const positionId = positiveString(order, "positionId");
  const strategyPositionKey = positiveString(order, "strategyPositionKey");
  const symbol = positiveString(contract, "chainSymbol");
  const occSymbol = positiveString(contract, "occSymbol");
  const expiration = positiveString(contract, "expiration");
  if (
    execution.action !== "exit" ||
    !positionId ||
    positionId.length > 128 ||
    !strategyPositionKey ||
    strategyPositionKey.length > 256 ||
    !symbol ||
    !occSymbol ||
    !expiration ||
    (optionType !== "Call" && optionType !== "Put") ||
    multiplier !== 100 ||
    sharesPerContract !== 100 ||
    !Number.isFinite(strike) ||
    strike <= 0 ||
    order["side"] !== "Sell" ||
    order["positionEffect"] !== "Close" ||
    order["orderType"] !== "Limit" ||
    order["timeInForce"] !== "Day" ||
    order["marketHours"] !== "regular_hours" ||
    contract["underlyingType"] !== "equity" ||
    Number(order["quantity"]) !== requestedQuantity ||
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity <= 0 ||
    !Number.isFinite(limitPrice) ||
    limitPrice <= 0 ||
    order["stopPrice"] !== null ||
    !Number.isSafeInteger(maxProviderReadAgeMs) ||
    maxProviderReadAgeMs <= 0
  ) {
    return null;
  }
  return {
    positionId,
    strategyPositionKey,
    symbol,
    occSymbol,
    expiration,
    strike,
    optionType,
    multiplier: 100,
    sharesPerContract: 100,
    orderType: "Limit",
    requestedQuantity,
    limitPrice,
    maxProviderReadAgeMs,
  };
}

async function loadExecution(
  appUserId: string,
  executionId: string,
): Promise<AlgoTargetExecution> {
  const [execution] = await db
    .select()
    .from(algoTargetExecutionsTable)
    .where(eq(algoTargetExecutionsTable.id, executionId))
    .limit(1);
  if (!execution) {
    throw new HttpError(404, "Algorithm target execution not found.", {
      code: "algo_target_execution_not_found",
    });
  }
  if (execution.appUserId !== appUserId) {
    throw new HttpError(403, "Algorithm target execution access denied.", {
      code: "algo_target_execution_forbidden",
    });
  }
  return execution;
}

async function loadRobinhoodReconciliationContext(
  execution: AlgoTargetExecution,
  appUserId: string,
) {
  const [context] = await db
    .select({
      deploymentId: algoDeploymentTargetsTable.deploymentId,
      accountId: brokerAccountsTable.id,
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
    .where(eq(algoDeploymentTargetsTable.id, execution.targetId))
    .limit(1);
  const accountNumber = context?.providerAccountId.startsWith(
    ROBINHOOD_ACCOUNT_PREFIX,
  )
    ? context.providerAccountId.slice(ROBINHOOD_ACCOUNT_PREFIX.length).trim()
    : "";
  if (
    !context ||
    context.deploymentId !== execution.deploymentId ||
    context.accountOwnerId !== appUserId ||
    context.connectionOwnerId !== appUserId ||
    context.accountMode !== "live" ||
    context.connectionType !== "broker" ||
    context.connectionProvider !== "robinhood" ||
    context.connectionStatus !== "connected" ||
    !accountNumber
  ) {
    return null;
  }
  return { ...context, accountNumber };
}

async function markReconciliationRequired(input: {
  execution: AlgoTargetExecution;
  code: string;
  message: string;
  now: Date;
  brokerOrderState?: string | null;
}): Promise<AlgoTargetExecution> {
  const [updated] = await db
    .update(algoTargetExecutionsTable)
    .set({
      status: "reconciliation_required",
      errorCode: input.code.slice(0, 128),
      errorMessage: input.message.slice(0, 512),
      ...(input.brokerOrderState !== undefined
        ? { brokerOrderState: input.brokerOrderState?.slice(0, 64) || null }
        : {}),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(algoTargetExecutionsTable.id, input.execution.id),
        eq(algoTargetExecutionsTable.appUserId, input.execution.appUserId),
        inArray(
          algoTargetExecutionsTable.status,
          RECONCILABLE_EXECUTION_STATUSES,
        ),
      ),
    )
    .returning();
  return (
    updated ?? loadExecution(input.execution.appUserId, input.execution.id)
  );
}

async function markExitReconciliationRequired(input: {
  execution: AlgoTargetExecution;
  positionId?: string;
  code: string;
  message: string;
  now: Date;
  brokerOrderState?: string | null;
}): Promise<AlgoTargetExecution> {
  return db.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(algoTargetExecutionsTable)
      .set({
        status: "reconciliation_required",
        errorCode: input.code.slice(0, 128),
        errorMessage: input.message.slice(0, 512),
        ...(input.brokerOrderState !== undefined
          ? { brokerOrderState: input.brokerOrderState?.slice(0, 64) || null }
          : {}),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(algoTargetExecutionsTable.id, input.execution.id),
          eq(algoTargetExecutionsTable.appUserId, input.execution.appUserId),
          inArray(
            algoTargetExecutionsTable.status,
            RECONCILABLE_EXECUTION_STATUSES,
          ),
        ),
      )
      .returning();
    if (!updated) {
      const [current] = await transaction
        .select()
        .from(algoTargetExecutionsTable)
        .where(
          and(
            eq(algoTargetExecutionsTable.id, input.execution.id),
            eq(algoTargetExecutionsTable.appUserId, input.execution.appUserId),
          ),
        )
        .limit(1);
      if (!current) {
        throw new HttpError(
          409,
          "The durable target execution is unavailable.",
          {
            code: "algo_target_execution_unavailable",
            expose: true,
          },
        );
      }
      return current;
    }
    if (input.positionId) {
      await transaction
        .update(algoTargetPositionsTable)
        .set({ status: "attention", updatedAt: input.now })
        .where(
          and(
            eq(algoTargetPositionsTable.id, input.positionId),
            eq(algoTargetPositionsTable.appUserId, input.execution.appUserId),
            eq(
              algoTargetPositionsTable.deploymentId,
              input.execution.deploymentId,
            ),
            eq(algoTargetPositionsTable.targetId, input.execution.targetId),
            inArray(algoTargetPositionsTable.status, [
              "open",
              "closing",
              "attention",
            ]),
          ),
        );
    }
    return updated;
  });
}

function providerOrderProof(input: {
  response: RobinhoodOptionRecentOrdersResponse;
  execution: AlgoTargetExecution;
  expected: ExpectedEntry;
  accountId: string;
  now: Date;
}): ProviderOrderProof | null {
  const checkedAt = freshDate(
    input.response.checkedAt,
    input.now,
    input.expected.maxProviderReadAgeMs,
  );
  const matches = input.response.orders.filter(
    (order) => order.id === input.execution.brokerOrderId,
  );
  if (
    input.response.provider !== "robinhood" ||
    input.response.account.id !== input.accountId ||
    !checkedAt ||
    matches.length !== 1
  ) {
    return null;
  }
  const order = matches[0]!;
  const state = order.state?.trim().toLowerCase() ?? "";
  const filledQuantity = Number(order.processedQuantity);
  const openedAt = order.createdAt
    ? dateValue(order.createdAt)
    : input.execution.occurredAt;
  if (
    !state ||
    order.chainSymbol?.trim().toUpperCase() !== input.expected.symbol ||
    order.orderType !== input.expected.orderType ||
    order.quantity !== input.expected.requestedQuantity ||
    order.price !== input.expected.limitPrice ||
    order.stopPrice !== null ||
    !Number.isSafeInteger(filledQuantity) ||
    filledQuantity < 0 ||
    filledQuantity > input.expected.requestedQuantity ||
    !openedAt ||
    (state === "filled" &&
      filledQuantity !== input.expected.requestedQuantity) ||
    (state === "cancelled" &&
      filledQuantity === input.expected.requestedQuantity)
  ) {
    return null;
  }
  return { state, filledQuantity, checkedAt, openedAt };
}

function providerExitOrderProof(input: {
  response: RobinhoodOptionRecentOrdersResponse;
  execution: AlgoTargetExecution;
  expected: ExpectedExit;
  accountId: string;
  now: Date;
}): ProviderExitOrderProof | null {
  const checkedAt = freshDate(
    input.response.checkedAt,
    input.now,
    input.expected.maxProviderReadAgeMs,
  );
  const matches = input.response.orders.filter(
    (order) => order.id === input.execution.brokerOrderId,
  );
  if (
    input.response.provider !== "robinhood" ||
    input.response.account.id !== input.accountId ||
    !checkedAt ||
    matches.length !== 1
  ) {
    return null;
  }
  const order = matches[0]!;
  const state = order.state?.trim().toLowerCase() ?? "";
  const filledQuantity = Number(order.processedQuantity);
  if (
    !state ||
    order.chainSymbol?.trim().toUpperCase() !== input.expected.symbol ||
    order.orderType !== input.expected.orderType ||
    order.quantity !== input.expected.requestedQuantity ||
    order.price !== input.expected.limitPrice ||
    order.stopPrice !== null ||
    !Number.isSafeInteger(filledQuantity) ||
    filledQuantity < 0 ||
    filledQuantity > input.expected.requestedQuantity ||
    (state === "filled" &&
      filledQuantity !== input.expected.requestedQuantity) ||
    (state === "cancelled" &&
      filledQuantity === input.expected.requestedQuantity) ||
    (state !== "filled" &&
      state !== "cancelled" &&
      filledQuantity === input.expected.requestedQuantity)
  ) {
    return null;
  }
  return { state, filledQuantity, checkedAt };
}

function matchingProviderPositions(input: {
  positions: AlgoRobinhoodProviderPosition[];
  accountId: string;
  expected: Pick<
    ExpectedEntry,
    | "symbol"
    | "expiration"
    | "strike"
    | "optionType"
    | "multiplier"
    | "sharesPerContract"
  >;
}): AlgoRobinhoodProviderPosition[] {
  const right = input.expected.optionType === "Call" ? "call" : "put";
  const expiration = new Date(`${input.expected.expiration}T00:00:00.000Z`);
  return input.positions.filter((position) => {
    const contract = position.optionContract;
    const contractExpiration = contract
      ? dateValue(contract.expirationDate)
      : null;
    return (
      position.accountId === input.accountId &&
      position.assetClass === "option" &&
      position.symbol.trim().toUpperCase() === input.expected.symbol &&
      Number.isSafeInteger(position.quantity) &&
      position.quantity > 0 &&
      contract !== null &&
      contract.underlying.trim().toUpperCase() === input.expected.symbol &&
      contractExpiration?.getTime() === expiration.getTime() &&
      contract.strike === input.expected.strike &&
      contract.right === right &&
      contract.multiplier === input.expected.multiplier &&
      contract.sharesPerContract === input.expected.sharesPerContract &&
      Boolean(contract.providerContractId?.trim()) &&
      contract.providerContractId === contract.brokerContractId &&
      contract.providerContractId!.length <= 128
    );
  });
}

function matchingProviderPosition(input: {
  positions: AlgoRobinhoodProviderPosition[];
  accountId: string;
  expected: ExpectedEntry;
}): AlgoRobinhoodProviderPosition | null {
  const matches = matchingProviderPositions(input);
  return matches.length === 1 ? matches[0]! : null;
}

function decimalQuantity(value: number): string {
  return value.toFixed(6);
}

function proportionalPremiumBasis(input: {
  premiumAtRisk: number;
  filledQuantity: number;
  requestedQuantity: number;
}): string {
  const premiumMicros = BigInt(Math.round(input.premiumAtRisk * 1_000_000));
  const filled = BigInt(input.filledQuantity);
  const requested = BigInt(input.requestedQuantity);
  const basisMicros = (premiumMicros * filled + requested - 1n) / requested;
  const whole = basisMicros / 1_000_000n;
  const fraction = (basisMicros % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

function exitPositionMatches(input: {
  position: AlgoTargetPosition;
  execution: AlgoTargetExecution;
  expected: ExpectedExit;
}): boolean {
  const contract = asRecord(input.position.contractSnapshot);
  const quantity = Number(input.position.quantity);
  return (
    input.position.id === input.expected.positionId &&
    input.position.appUserId === input.execution.appUserId &&
    input.position.deploymentId === input.execution.deploymentId &&
    input.position.targetId === input.execution.targetId &&
    input.position.strategyPositionKey === input.expected.strategyPositionKey &&
    input.position.symbol === input.expected.symbol &&
    Boolean(input.position.providerPositionId?.trim()) &&
    input.position.providerPositionId!.length <= 128 &&
    (input.position.status === "closing" ||
      input.position.status === "attention") &&
    Number.isSafeInteger(quantity) &&
    quantity >= 0 &&
    contract["occSymbol"] === input.expected.occSymbol &&
    contract["chainSymbol"] === input.expected.symbol &&
    contract["underlyingType"] === "equity" &&
    contract["expiration"] === input.expected.expiration &&
    Number(contract["strike"]) === input.expected.strike &&
    contract["optionType"] === input.expected.optionType &&
    Number(contract["multiplier"]) === input.expected.multiplier &&
    Number(contract["sharesPerContract"]) === input.expected.sharesPerContract
  );
}

function remainingPremiumBasis(input: {
  premiumBasis: string | null;
  quantity: number;
  remainingQuantity: number;
}): string | null | undefined {
  if (input.premiumBasis === null) return null;
  const premium = Number(input.premiumBasis);
  const premiumMicros = Math.round(premium * 1_000_000);
  if (
    !Number.isFinite(premium) ||
    premium < 0 ||
    !Number.isSafeInteger(premiumMicros) ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0 ||
    !Number.isSafeInteger(input.remainingQuantity) ||
    input.remainingQuantity < 0 ||
    input.remainingQuantity > input.quantity
  ) {
    return undefined;
  }
  if (input.remainingQuantity === 0) return "0.000000";
  if (input.remainingQuantity === input.quantity) return input.premiumBasis;
  const remaining = BigInt(input.remainingQuantity);
  const quantity = BigInt(input.quantity);
  const basisMicros =
    (BigInt(premiumMicros) * remaining + quantity - 1n) / quantity;
  const whole = basisMicros / 1_000_000n;
  const fraction = (basisMicros % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

async function defaultLoadOrders(input: {
  appUserId: string;
  accountId: string;
  now: Date;
}) {
  return listRobinhoodOptionOrders({
    appUserId: input.appUserId,
    accountId: input.accountId,
    now: input.now,
  });
}

async function defaultLoadPositions(input: {
  appUserId: string;
  accountId: string;
  accountNumber: string;
  now: Date;
}): Promise<AlgoRobinhoodProviderPosition[]> {
  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: input.appUserId,
      accounts: [
        { accountId: input.accountId, accountNumber: input.accountNumber },
      ],
    },
    { now: input.now },
  );
  return positions.map((position) => ({
    accountId: position.accountId,
    symbol: position.symbol,
    assetClass: position.assetClass,
    quantity: position.quantity,
    optionContract: position.optionContract,
  }));
}

// ponytail: Robinhood's current get_option_orders schema exposes no ref_id
// lookup. Missing broker IDs therefore stay unresolved; the upgrade path is a
// provider-supported deterministic-ref read, never tuple/time heuristics.
export async function reconcileAlgoRobinhoodOptionEntry(
  input: { appUserId: string; executionId: string },
  dependencies: ReconcileAlgoRobinhoodOptionEntryDependencies = {},
): Promise<AlgoTargetExecution> {
  const execution = await loadExecution(input.appUserId, input.executionId);
  if (!isReconcileableStatus(execution.status)) {
    return execution;
  }
  const now = currentTime(dependencies.now);
  const expected = expectedEntry(execution);
  if (!expected) {
    return markReconciliationRequired({
      execution,
      code: "algo_target_execution_snapshot_invalid",
      message: "The durable entry snapshot cannot be reconciled.",
      now,
    });
  }

  const context = await loadRobinhoodReconciliationContext(
    execution,
    input.appUserId,
  );
  if (!context) {
    return markReconciliationRequired({
      execution,
      code: "algo_target_reconciliation_account_unavailable",
      message: "The Robinhood account is unavailable for reconciliation.",
      now,
    });
  }

  if (!execution.brokerOrderId) {
    return markReconciliationRequired({
      execution,
      code: "algo_robinhood_ref_lookup_unavailable",
      message:
        "Robinhood does not expose a deterministic ref lookup for this unresolved order.",
      now,
    });
  }

  const orders = await (dependencies.loadOrders ?? defaultLoadOrders)({
    appUserId: input.appUserId,
    accountId: context.accountId,
    now,
  });
  const proof = providerOrderProof({
    response: orders,
    execution,
    expected,
    accountId: context.accountId,
    now: currentTime(dependencies.now),
  });
  if (!proof) {
    return markReconciliationRequired({
      execution,
      code: "algo_robinhood_order_proof_invalid",
      message: "Robinhood did not return an exact durable order match.",
      now: currentTime(dependencies.now),
    });
  }

  let providerPosition: AlgoRobinhoodProviderPosition | null = null;
  if (proof.filledQuantity > 0) {
    const positions = await (
      dependencies.loadPositions ?? defaultLoadPositions
    )({
      appUserId: input.appUserId,
      accountId: context.accountId,
      accountNumber: context.accountNumber,
      now: currentTime(dependencies.now),
    });
    providerPosition = matchingProviderPosition({
      positions,
      accountId: context.accountId,
      expected,
    });
    if (!providerPosition || providerPosition.quantity < proof.filledQuantity) {
      return markReconciliationRequired({
        execution,
        code: "algo_robinhood_position_proof_invalid",
        message: "Robinhood did not return an exact position for the fill.",
        brokerOrderState: proof.state,
        now: currentTime(dependencies.now),
      });
    }
  }

  const providerPositionId =
    providerPosition?.optionContract?.providerContractId ?? null;
  const finalStatus =
    proof.state === "filled"
      ? "filled"
      : proof.state === "cancelled"
        ? "cancelled"
        : "submitted";
  const positionStatus =
    finalStatus === "filled" || finalStatus === "cancelled"
      ? "open"
      : "opening";

  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(algoTargetExecutionsTable)
      .where(
        and(
          eq(algoTargetExecutionsTable.id, execution.id),
          eq(algoTargetExecutionsTable.appUserId, input.appUserId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new HttpError(409, "The durable target execution is unavailable.", {
        code: "algo_target_execution_unavailable",
        expose: true,
      });
    }
    if (!isReconcileableStatus(current.status)) {
      return current;
    }
    if (current.brokerOrderId !== execution.brokerOrderId) {
      const [changed] = await transaction
        .update(algoTargetExecutionsTable)
        .set({
          status: "reconciliation_required",
          errorCode: "algo_robinhood_order_identity_changed",
          errorMessage: "The durable Robinhood order identity changed.",
          updatedAt: proof.checkedAt,
        })
        .where(eq(algoTargetExecutionsTable.id, current.id))
        .returning();
      return changed!;
    }

    await transaction
      .select({ id: brokerAccountsTable.id })
      .from(brokerAccountsTable)
      .where(eq(brokerAccountsTable.id, context.accountId))
      .limit(1)
      .for("update");

    if (proof.filledQuantity > 0 && providerPositionId) {
      const positions = await transaction
        .select({
          id: algoTargetPositionsTable.id,
          appUserId: algoTargetPositionsTable.appUserId,
          deploymentId: algoTargetPositionsTable.deploymentId,
          targetId: algoTargetPositionsTable.targetId,
          strategyPositionKey: algoTargetPositionsTable.strategyPositionKey,
          symbol: algoTargetPositionsTable.symbol,
          providerPositionId: algoTargetPositionsTable.providerPositionId,
          contractSnapshot: algoTargetPositionsTable.contractSnapshot,
          quantity: algoTargetPositionsTable.quantity,
          status: algoTargetPositionsTable.status,
          openedAt: algoTargetPositionsTable.openedAt,
        })
        .from(algoTargetPositionsTable)
        .innerJoin(
          algoDeploymentTargetsTable,
          eq(algoDeploymentTargetsTable.id, algoTargetPositionsTable.targetId),
        )
        .where(
          eq(algoDeploymentTargetsTable.brokerAccountId, context.accountId),
        )
        .for("update");
      const existing = positions.find(
        (position) =>
          position.targetId === execution.targetId &&
          position.strategyPositionKey === expected.strategyPositionKey,
      );
      const existingContract = asRecord(existing?.contractSnapshot);
      const existingMatches =
        !existing ||
        (existing.appUserId === input.appUserId &&
          existing.deploymentId === execution.deploymentId &&
          existing.symbol === expected.symbol &&
          existing.providerPositionId === providerPositionId &&
          existingContract["occSymbol"] === expected.occSymbol &&
          (existing.status === "opening" || existing.status === "open"));
      const attributedQuantity = positions.reduce((total, position) => {
        if (
          !isAttributedPositionStatus(position.status) ||
          position.id === existing?.id ||
          position.providerPositionId !== providerPositionId
        ) {
          return total;
        }
        const quantity = Number(position.quantity);
        return Number.isFinite(quantity) && quantity >= 0
          ? total + quantity
          : Number.NaN;
      }, 0);
      if (
        !existingMatches ||
        !Number.isFinite(attributedQuantity) ||
        !providerPosition ||
        providerPosition.quantity < attributedQuantity + proof.filledQuantity
      ) {
        const [invalid] = await transaction
          .update(algoTargetExecutionsTable)
          .set({
            status: "reconciliation_required",
            brokerOrderState: proof.state.slice(0, 64),
            errorCode: "algo_provider_position_attribution_invalid",
            errorMessage:
              "The provider position cannot safely cover algo attribution.",
            updatedAt: proof.checkedAt,
          })
          .where(eq(algoTargetExecutionsTable.id, current.id))
          .returning();
        return invalid!;
      }

      const quantity = decimalQuantity(proof.filledQuantity);
      const premiumBasis = proportionalPremiumBasis({
        premiumAtRisk: expected.premiumAtRisk,
        filledQuantity: proof.filledQuantity,
        requestedQuantity: expected.requestedQuantity,
      });
      if (existing) {
        await transaction
          .update(algoTargetPositionsTable)
          .set({
            quantity,
            premiumBasis,
            status: positionStatus,
            closedAt: null,
            lastReconciledAt: proof.checkedAt,
            updatedAt: proof.checkedAt,
          })
          .where(eq(algoTargetPositionsTable.id, existing.id));
      } else {
        await transaction.insert(algoTargetPositionsTable).values({
          appUserId: input.appUserId,
          deploymentId: execution.deploymentId,
          targetId: execution.targetId,
          strategyPositionKey: expected.strategyPositionKey,
          symbol: expected.symbol,
          providerPositionId,
          contractSnapshot: execution.contractSnapshot,
          quantity,
          premiumBasis,
          status: positionStatus,
          openedAt: proof.openedAt,
          lastReconciledAt: proof.checkedAt,
          updatedAt: proof.checkedAt,
        });
      }
    }

    const [updated] = await transaction
      .update(algoTargetExecutionsTable)
      .set({
        status: finalStatus,
        brokerOrderState: proof.state.slice(0, 64),
        filledQuantity: decimalQuantity(proof.filledQuantity),
        errorCode: null,
        errorMessage: null,
        updatedAt: proof.checkedAt,
      })
      .where(eq(algoTargetExecutionsTable.id, current.id))
      .returning();
    return updated!;
  });
}

// Robinhood exposes exact brokerage order IDs but no deterministic ref lookup.
// An ambiguous close without that ID remains fenced instead of using tuple or
// timestamp heuristics.
export async function reconcileAlgoRobinhoodOptionExit(
  input: { appUserId: string; executionId: string },
  dependencies: ReconcileAlgoRobinhoodOptionExitDependencies = {},
): Promise<AlgoTargetExecution> {
  const execution = await loadExecution(input.appUserId, input.executionId);
  if (!isReconcileableStatus(execution.status)) {
    return execution;
  }
  const now = currentTime(dependencies.now);
  const expected = expectedExit(execution);
  if (!expected) {
    return markExitReconciliationRequired({
      execution,
      code: "algo_target_execution_snapshot_invalid",
      message: "The durable exit snapshot cannot be reconciled.",
      now,
    });
  }

  const context = await loadRobinhoodReconciliationContext(
    execution,
    input.appUserId,
  );
  if (!context) {
    return markExitReconciliationRequired({
      execution,
      positionId: expected.positionId,
      code: "algo_target_reconciliation_account_unavailable",
      message: "The Robinhood account is unavailable for reconciliation.",
      now,
    });
  }
  if (!execution.brokerOrderId) {
    return markExitReconciliationRequired({
      execution,
      positionId: expected.positionId,
      code: "algo_robinhood_ref_lookup_unavailable",
      message:
        "Robinhood does not expose a deterministic ref lookup for this unresolved order.",
      now,
    });
  }

  const orders = await (dependencies.loadOrders ?? defaultLoadOrders)({
    appUserId: input.appUserId,
    accountId: context.accountId,
    now,
  });
  const proof = providerExitOrderProof({
    response: orders,
    execution,
    expected,
    accountId: context.accountId,
    now: currentTime(dependencies.now),
  });
  if (!proof) {
    return markExitReconciliationRequired({
      execution,
      positionId: expected.positionId,
      code: "algo_robinhood_order_proof_invalid",
      message: "Robinhood did not return an exact durable close order match.",
      now: currentTime(dependencies.now),
    });
  }

  const [position] = await db
    .select()
    .from(algoTargetPositionsTable)
    .where(eq(algoTargetPositionsTable.id, expected.positionId))
    .limit(1);
  if (!position || !exitPositionMatches({ position, execution, expected })) {
    return markExitReconciliationRequired({
      execution,
      positionId: expected.positionId,
      code: "algo_target_close_position_invalid",
      message: "The durable algo-owned close position is invalid.",
      brokerOrderState: proof.state,
      now: proof.checkedAt,
    });
  }

  const providerPositions = await (
    dependencies.loadPositions ?? defaultLoadPositions
  )({
    appUserId: input.appUserId,
    accountId: context.accountId,
    accountNumber: context.accountNumber,
    now: currentTime(dependencies.now),
  });
  const providerMatches = matchingProviderPositions({
    positions: providerPositions,
    accountId: context.accountId,
    expected,
  });

  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(algoTargetExecutionsTable)
      .where(
        and(
          eq(algoTargetExecutionsTable.id, execution.id),
          eq(algoTargetExecutionsTable.appUserId, input.appUserId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new HttpError(409, "The durable target execution is unavailable.", {
        code: "algo_target_execution_unavailable",
        expose: true,
      });
    }
    if (!isReconcileableStatus(current.status)) {
      return current;
    }

    const markInvalid = async (code: string, message: string) => {
      const [invalid] = await transaction
        .update(algoTargetExecutionsTable)
        .set({
          status: "reconciliation_required",
          brokerOrderState: proof.state.slice(0, 64),
          errorCode: code.slice(0, 128),
          errorMessage: message.slice(0, 512),
          updatedAt: proof.checkedAt,
        })
        .where(eq(algoTargetExecutionsTable.id, current.id))
        .returning();
      await transaction
        .update(algoTargetPositionsTable)
        .set({ status: "attention", updatedAt: proof.checkedAt })
        .where(
          and(
            eq(algoTargetPositionsTable.id, expected.positionId),
            eq(algoTargetPositionsTable.appUserId, input.appUserId),
            eq(algoTargetPositionsTable.deploymentId, execution.deploymentId),
            eq(algoTargetPositionsTable.targetId, execution.targetId),
            inArray(algoTargetPositionsTable.status, [
              "open",
              "closing",
              "attention",
            ]),
          ),
        );
      return invalid!;
    };

    if (current.brokerOrderId !== execution.brokerOrderId) {
      return markInvalid(
        "algo_robinhood_order_identity_changed",
        "The durable Robinhood close order identity changed.",
      );
    }

    const [accountLock] = await transaction
      .select({ id: brokerAccountsTable.id })
      .from(brokerAccountsTable)
      .where(eq(brokerAccountsTable.id, context.accountId))
      .limit(1)
      .for("update");
    if (!accountLock) {
      return markInvalid(
        "algo_target_reconciliation_account_unavailable",
        "The Robinhood account became unavailable during reconciliation.",
      );
    }

    const lockedRows = await transaction
      .select({ position: algoTargetPositionsTable })
      .from(algoTargetPositionsTable)
      .innerJoin(
        algoDeploymentTargetsTable,
        eq(algoDeploymentTargetsTable.id, algoTargetPositionsTable.targetId),
      )
      .where(eq(algoDeploymentTargetsTable.brokerAccountId, context.accountId))
      .for("update");
    const positions = lockedRows.map((row) => row.position);
    const ownedPosition = positions.find(
      (candidate) => candidate.id === expected.positionId,
    );
    if (
      !ownedPosition ||
      !exitPositionMatches({
        position: ownedPosition,
        execution: current,
        expected,
      })
    ) {
      return markInvalid(
        "algo_target_close_position_invalid",
        "The algo-owned close position changed during reconciliation.",
      );
    }

    const currentQuantity = Number(ownedPosition.quantity);
    const previousFilledQuantity = Number(current.filledQuantity);
    const filledDelta = proof.filledQuantity - previousFilledQuantity;
    if (
      !Number.isSafeInteger(previousFilledQuantity) ||
      previousFilledQuantity < 0 ||
      previousFilledQuantity > expected.requestedQuantity ||
      filledDelta < 0 ||
      !Number.isSafeInteger(filledDelta) ||
      filledDelta > currentQuantity
    ) {
      return markInvalid(
        "algo_robinhood_exit_fill_invalid",
        "Robinhood returned an invalid cumulative close fill.",
      );
    }

    const remainingQuantity = currentQuantity - filledDelta;
    const otherAttributedQuantity = positions.reduce((total, candidate) => {
      if (
        candidate.id === ownedPosition.id ||
        candidate.providerPositionId !== ownedPosition.providerPositionId ||
        !isAttributedPositionStatus(candidate.status)
      ) {
        return total;
      }
      const quantity = Number(candidate.quantity);
      return Number.isSafeInteger(quantity) && quantity >= 0
        ? total + quantity
        : Number.NaN;
    }, 0);
    const providerPosition =
      providerMatches.length === 1 ? providerMatches[0]! : null;
    const requiredProviderQuantity =
      remainingQuantity + otherAttributedQuantity;
    if (
      providerMatches.length > 1 ||
      !Number.isFinite(otherAttributedQuantity) ||
      !Number.isSafeInteger(requiredProviderQuantity) ||
      requiredProviderQuantity < 0 ||
      (providerPosition !== null &&
        providerPosition.optionContract?.providerContractId !==
          ownedPosition.providerPositionId) ||
      (requiredProviderQuantity > 0 && providerPosition === null) ||
      (providerPosition !== null &&
        providerPosition.quantity < requiredProviderQuantity)
    ) {
      return markInvalid(
        "algo_provider_position_attribution_invalid",
        "The provider position cannot safely cover remaining algo attribution.",
      );
    }

    const premiumBasis = remainingPremiumBasis({
      premiumBasis: ownedPosition.premiumBasis,
      quantity: currentQuantity,
      remainingQuantity,
    });
    if (premiumBasis === undefined) {
      return markInvalid(
        "algo_target_position_basis_invalid",
        "The algo-owned position premium basis is invalid.",
      );
    }

    const finalStatus =
      proof.state === "filled"
        ? "filled"
        : proof.state === "cancelled"
          ? "cancelled"
          : "submitted";
    const positionStatus =
      remainingQuantity === 0
        ? "closed"
        : finalStatus === "filled" || finalStatus === "cancelled"
          ? "open"
          : "closing";
    await transaction
      .update(algoTargetPositionsTable)
      .set({
        quantity: decimalQuantity(remainingQuantity),
        premiumBasis,
        status: positionStatus,
        closedAt: remainingQuantity === 0 ? proof.checkedAt : null,
        lastReconciledAt: proof.checkedAt,
        updatedAt: proof.checkedAt,
      })
      .where(eq(algoTargetPositionsTable.id, ownedPosition.id));
    const [updated] = await transaction
      .update(algoTargetExecutionsTable)
      .set({
        status: finalStatus,
        brokerOrderState: proof.state.slice(0, 64),
        filledQuantity: decimalQuantity(proof.filledQuantity),
        errorCode: null,
        errorMessage: null,
        updatedAt: proof.checkedAt,
      })
      .where(eq(algoTargetExecutionsTable.id, current.id))
      .returning();
    return updated!;
  });
}
