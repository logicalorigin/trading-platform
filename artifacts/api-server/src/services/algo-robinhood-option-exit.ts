import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  db,
  type AlgoTargetExecution,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import {
  buildRobinhoodOptionTaxOrder,
  placeRobinhoodAlgoOptionOrder,
  reviewRobinhoodAlgoOptionOrder,
  type PlaceRobinhoodAlgoOptionOrderOptions,
  type ReviewRobinhoodAlgoOptionOrderOptions,
  type RobinhoodAlgoOptionOrderContext,
  type RobinhoodOptionOrderInput,
  type RobinhoodOptionOrderPlaceResponse,
  type RobinhoodOptionOrderReviewResponse,
} from "./robinhood-option-orders";
import { requireStandardOptionContractIdentity } from "./standard-option-contract-identity";
import { createTaxOrderPreflight } from "./tax-planning";

type AlgoTaxPreflightResult = Pick<
  Awaited<ReturnType<typeof createTaxOrderPreflight>>,
  "action" | "preflightToken"
>;

export type ExecutePreparedAlgoRobinhoodOptionExitInput = {
  appUserId: string;
  accountId: string;
  algoContext: RobinhoodAlgoOptionOrderContext;
  order: RobinhoodOptionOrderInput;
};

export type ExecuteAlgoRobinhoodOptionExitDependencies = {
  now?: () => Date;
  reviewOrder?: (
    options: ReviewRobinhoodAlgoOptionOrderOptions,
  ) => Promise<RobinhoodOptionOrderReviewResponse>;
  createTaxPreflight?: (
    input: { order: ReturnType<typeof buildRobinhoodOptionTaxOrder> },
    options: { appUserId: string },
  ) => Promise<AlgoTaxPreflightResult>;
  placeOrder?: (
    options: PlaceRobinhoodAlgoOptionOrderOptions,
  ) => Promise<RobinhoodOptionOrderPlaceResponse>;
};

type PreparedExit = {
  execution: AlgoTargetExecution;
  maxQuoteAgeMs: number;
  providerPositionId: string;
};

type ExitSafetyFailure = {
  code: string;
  message: string;
};

function exitBlocked(code: string, message: string): never {
  throw new HttpError(409, message, { code, expose: true });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HttpError(422, "Live option exit time is invalid.", {
      code: "algo_live_exit_time_invalid",
      expose: true,
    });
  }
  return value;
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

function hasContent(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function validateExitOrder(order: RobinhoodOptionOrderInput) {
  if (
    order.side !== "Sell" ||
    order.positionEffect !== "Close" ||
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
    return exitBlocked(
      "algo_target_close_order_unsupported",
      "Automated Robinhood closes require a sell-to-close Day limit order.",
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

async function validatePreparedExit(
  input: ExecutePreparedAlgoRobinhoodOptionExitInput,
  execution: AlgoTargetExecution,
): Promise<PreparedExit> {
  const contract = validateExitOrder(input.order);
  const contractSnapshot = asRecord(execution.contractSnapshot);
  const orderSnapshot = asRecord(execution.orderSnapshot);
  const platformCaps = asRecord(orderSnapshot["platformCaps"]);
  const maxQuoteAgeMs = Number(platformCaps["maxQuoteAgeMs"]);
  if (
    execution.action !== "exit" ||
    execution.deploymentId !== input.algoContext.deploymentId ||
    execution.targetId !== input.algoContext.targetId ||
    execution.id !== input.algoContext.targetExecutionId ||
    orderSnapshot["positionId"] !== input.algoContext.positionId ||
    contractSnapshot["occSymbol"] !== contract.occSymbol ||
    Number(contractSnapshot["multiplier"]) !== input.order.multiplier ||
    Number(contractSnapshot["sharesPerContract"]) !==
      input.order.sharesPerContract ||
    String(contractSnapshot["chainSymbol"] ?? "") !==
      input.order.chainSymbol.toUpperCase() ||
    String(contractSnapshot["underlyingType"] ?? "") !==
      (input.order.underlyingType ?? "equity") ||
    String(contractSnapshot["expiration"] ?? "") !== input.order.expiration ||
    Number(contractSnapshot["strike"]) !== input.order.strike ||
    String(contractSnapshot["optionType"] ?? "") !== input.order.optionType ||
    orderSnapshot["side"] !== input.order.side ||
    orderSnapshot["positionEffect"] !== input.order.positionEffect ||
    orderSnapshot["orderType"] !== input.order.orderType ||
    orderSnapshot["timeInForce"] !== input.order.timeInForce ||
    orderSnapshot["marketHours"] !==
      (input.order.marketHours ?? "regular_hours") ||
    Number(orderSnapshot["quantity"]) !== input.order.quantity ||
    Number(execution.requestedQuantity) !== input.order.quantity ||
    Number(orderSnapshot["limitPrice"]) !== input.order.limitPrice ||
    orderSnapshot["stopPrice"] !== null ||
    !Number.isSafeInteger(maxQuoteAgeMs) ||
    maxQuoteAgeMs <= 0
  ) {
    return exitBlocked(
      "algo_target_close_execution_invalid",
      "The durable close execution does not match this order.",
    );
  }

  const [deployment, target, position] = await Promise.all([
    db
      .select({
        appUserId: algoDeploymentsTable.appUserId,
        mode: algoDeploymentsTable.mode,
        isDraft: algoDeploymentsTable.isDraft,
        archivedAt: algoDeploymentsTable.archivedAt,
      })
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.id, execution.deploymentId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        deploymentId: algoDeploymentTargetsTable.deploymentId,
        brokerAccountId: algoDeploymentTargetsTable.brokerAccountId,
        lifecycle: algoDeploymentTargetsTable.lifecycle,
      })
      .from(algoDeploymentTargetsTable)
      .where(eq(algoDeploymentTargetsTable.id, execution.targetId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(algoTargetPositionsTable)
      .where(eq(algoTargetPositionsTable.id, input.algoContext.positionId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (
    !deployment ||
    deployment.appUserId !== input.appUserId ||
    deployment.mode !== "live" ||
    deployment.isDraft ||
    deployment.archivedAt
  ) {
    return exitBlocked(
      "algo_target_close_deployment_blocked",
      "The deployment cannot submit an automated close.",
    );
  }
  if (
    !target ||
    target.deploymentId !== execution.deploymentId ||
    target.brokerAccountId !== input.accountId ||
    !["active", "draining"].includes(target.lifecycle)
  ) {
    return exitBlocked(
      "algo_target_close_target_invalid",
      "The algo-owned target is unavailable for closing.",
    );
  }
  const positionQuantity = Number(position?.quantity);
  if (
    !position ||
    position.appUserId !== input.appUserId ||
    position.deploymentId !== execution.deploymentId ||
    position.targetId !== execution.targetId ||
    position.status !== "open" ||
    !position.providerPositionId ||
    !position.lastReconciledAt ||
    position.lastReconciledAt < execution.occurredAt ||
    !Number.isSafeInteger(positionQuantity) ||
    positionQuantity < input.order.quantity
  ) {
    return exitBlocked(
      "algo_target_close_position_invalid",
      "The algo-owned option position is not open and reconciled.",
    );
  }
  const positionContractSnapshot = asRecord(position.contractSnapshot);
  const positionOptionType = positionContractSnapshot["optionType"];
  if (positionOptionType !== "Call" && positionOptionType !== "Put") {
    return exitBlocked(
      "algo_target_close_position_invalid",
      "The algo-owned option position contract is invalid.",
    );
  }
  const positionContract = requireStandardOptionContractIdentity({
    contractSymbol: String(positionContractSnapshot["occSymbol"] ?? ""),
    multiplier: Number(positionContractSnapshot["multiplier"]),
    sharesPerContract: Number(positionContractSnapshot["sharesPerContract"]),
    underlyingSymbol: String(positionContractSnapshot["chainSymbol"] ?? ""),
    expiration: String(positionContractSnapshot["expiration"] ?? ""),
    strike: Number(positionContractSnapshot["strike"]),
    optionType: positionOptionType,
  });
  if (positionContract.occSymbol !== contract.occSymbol) {
    return exitBlocked(
      "algo_target_close_contract_mismatch",
      "The close contract does not match the algo-owned position.",
    );
  }
  return {
    execution,
    maxQuoteAgeMs,
    providerPositionId: position.providerPositionId,
  };
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

async function rejectExecution(input: {
  appUserId: string;
  execution: AlgoTargetExecution;
  expectedStatus: "pending" | "reviewed";
  failure: ExitSafetyFailure;
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

function exitReviewFailure(input: {
  response: RobinhoodOptionOrderReviewResponse;
  accountId: string;
  order: RobinhoodOptionOrderInput;
  providerPositionId: string;
  now: Date;
  maxQuoteAgeMs: number;
}): ExitSafetyFailure | null {
  const expected = validateExitOrder(input.order);
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
    reviewed.optionId !== input.providerPositionId ||
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
      message: "Robinhood review did not match the durable close order.",
    };
  }
  const quote = input.response.review.quote;
  if (
    !quote ||
    quote.instrumentId !== input.providerPositionId ||
    !freshTimestamp(quote.updatedAt, input.now, input.maxQuoteAgeMs)
  ) {
    return {
      code: "algo_robinhood_quote_stale",
      message: "Robinhood did not return a fresh matching option quote.",
    };
  }
  const estimatedPremium = input.response.review.estimate.premium;
  if (
    estimatedPremium === null ||
    !Number.isFinite(estimatedPremium) ||
    estimatedPremium < 0
  ) {
    return {
      code: "algo_robinhood_review_premium_invalid",
      message: "Robinhood review did not return a valid close estimate.",
    };
  }
  return null;
}

function exitPlaceFailure(input: {
  response: RobinhoodOptionOrderPlaceResponse;
  accountId: string;
  order: RobinhoodOptionOrderInput;
  execution: AlgoTargetExecution;
  providerPositionId: string;
}): ExitSafetyFailure | null {
  const expected = validateExitOrder(input.order);
  const placed = input.response.order;
  if (
    input.response.provider !== "robinhood" ||
    input.response.account.id !== input.accountId ||
    placed.refId !== input.execution.clientOrderId ||
    !placed.brokerageOrderId.trim() ||
    placed.brokerageOrderId.length > 128 ||
    placed.optionId !== input.providerPositionId ||
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
      message: "Robinhood submission returned an unmatched close order.",
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

async function finishSubmission(input: {
  appUserId: string;
  execution: AlgoTargetExecution;
  positionId: string;
  status: "submitted" | "reconciliation_required";
  positionStatus: "closing" | "attention";
  brokerOrderId: string | null;
  brokerOrderState: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  now: Date;
}): Promise<AlgoTargetExecution> {
  return db.transaction(async (transaction) => {
    const [execution] = await transaction
      .update(algoTargetExecutionsTable)
      .set({
        status: input.status,
        brokerOrderId: input.brokerOrderId,
        brokerOrderState: input.brokerOrderState,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(algoTargetExecutionsTable.id, input.execution.id),
          eq(algoTargetExecutionsTable.appUserId, input.appUserId),
          eq(algoTargetExecutionsTable.status, "submitted"),
        ),
      )
      .returning();
    if (!execution) {
      const [current] = await transaction
        .select()
        .from(algoTargetExecutionsTable)
        .where(
          and(
            eq(algoTargetExecutionsTable.id, input.execution.id),
            eq(algoTargetExecutionsTable.appUserId, input.appUserId),
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
    const [position] = await transaction
      .update(algoTargetPositionsTable)
      .set({ status: input.positionStatus, updatedAt: input.now })
      .where(
        and(
          eq(algoTargetPositionsTable.id, input.positionId),
          eq(algoTargetPositionsTable.appUserId, input.appUserId),
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
      )
      .returning({ id: algoTargetPositionsTable.id });
    if (!position) {
      const [unresolved] = await transaction
        .update(algoTargetExecutionsTable)
        .set({
          status: "reconciliation_required",
          errorCode: "algo_target_close_position_transition_failed",
          errorMessage:
            "The close order was submitted but its algo-owned position could not be transitioned.",
          updatedAt: input.now,
        })
        .where(eq(algoTargetExecutionsTable.id, execution.id))
        .returning();
      return unresolved!;
    }
    return execution;
  });
}

function reviewedExecutionIsFresh(
  execution: AlgoTargetExecution,
  now: Date,
  maxQuoteAgeMs: number,
): boolean {
  return freshTimestamp(execution.updatedAt, now, maxQuoteAgeMs);
}

// This remains deliberately unhooked from Signal Options. The caller must first
// reserve the exact exit and reconcile the target-owned provider position; the
// remaining ceiling is exit fill reconciliation plus the live portfolio halts.
export async function executePreparedAlgoRobinhoodOptionExit(
  input: ExecutePreparedAlgoRobinhoodOptionExitInput,
  dependencies: ExecuteAlgoRobinhoodOptionExitDependencies = {},
): Promise<AlgoTargetExecution> {
  let execution = await loadExecution(
    input.appUserId,
    input.algoContext.targetExecutionId,
  );
  if (execution.status !== "pending" && execution.status !== "reviewed") {
    return execution;
  }
  const prepared = await validatePreparedExit(input, execution);

  if (execution.status === "pending") {
    const requestedAt = currentTime(dependencies.now);
    const review = await (
      dependencies.reviewOrder ?? reviewRobinhoodAlgoOptionOrder
    )({
      appUserId: input.appUserId,
      accountId: input.accountId,
      algoContext: input.algoContext,
      input: input.order,
      now: requestedAt,
    });
    const reviewedAt = currentTime(dependencies.now);
    const failure = exitReviewFailure({
      response: review,
      accountId: input.accountId,
      order: input.order,
      providerPositionId: prepared.providerPositionId,
      now: reviewedAt,
      maxQuoteAgeMs: prepared.maxQuoteAgeMs,
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
  if (!reviewedExecutionIsFresh(execution, now, prepared.maxQuoteAgeMs)) {
    return rejectExecution({
      appUserId: input.appUserId,
      execution,
      expectedStatus: "reviewed",
      failure: {
        code: "algo_robinhood_review_stale",
        message:
          "The durable Robinhood close review expired before submission.",
      },
      now,
    });
  }

  const taxOrder = buildRobinhoodOptionTaxOrder({
    accountId: input.accountId,
    order: input.order,
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
            : "Tax preflight blocked the automated close.",
      },
      now: currentTime(dependencies.now),
    });
  }

  now = currentTime(dependencies.now);
  if (!reviewedExecutionIsFresh(execution, now, prepared.maxQuoteAgeMs)) {
    return rejectExecution({
      appUserId: input.appUserId,
      execution,
      expectedStatus: "reviewed",
      failure: {
        code: "algo_robinhood_review_stale",
        message:
          "The durable Robinhood close review expired before submission.",
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
    const placed = await (
      dependencies.placeOrder ?? placeRobinhoodAlgoOptionOrder
    )({
      appUserId: input.appUserId,
      accountId: input.accountId,
      algoContext: input.algoContext,
      input: {
        ...input.order,
        confirm: true,
        refId: execution.clientOrderId,
        taxPreflightToken: taxPreflight.preflightToken,
      },
      now,
    });
    const failure = exitPlaceFailure({
      response: placed,
      accountId: input.accountId,
      order: input.order,
      execution,
      providerPositionId: prepared.providerPositionId,
    });
    const reconciliationRequired = placed.reconcileRequired === true || failure;
    const brokerIdentityTrusted =
      !failure || failure.code === "algo_robinhood_submit_alert";
    return finishSubmission({
      appUserId: input.appUserId,
      execution,
      positionId: input.algoContext.positionId,
      status: reconciliationRequired ? "reconciliation_required" : "submitted",
      positionStatus: reconciliationRequired ? "attention" : "closing",
      brokerOrderId: brokerIdentityTrusted
        ? placed.order.brokerageOrderId.trim().slice(0, 128) || null
        : null,
      brokerOrderState: placed.order.state?.trim().slice(0, 64) || null,
      errorCode: reconciliationRequired
        ? (failure?.code ?? "algo_robinhood_submit_reconciliation_required")
        : null,
      errorMessage: reconciliationRequired
        ? (failure?.message ??
          "Robinhood close submission requires provider reconciliation.")
        : null,
      now: currentTime(dependencies.now),
    });
  } catch (error) {
    const expectedReconciliation =
      error instanceof HttpError &&
      error.code === "robinhood_option_order_submit_reconcile_required";
    return finishSubmission({
      appUserId: input.appUserId,
      execution,
      positionId: input.algoContext.positionId,
      status: "reconciliation_required",
      positionStatus: "attention",
      brokerOrderId: null,
      brokerOrderState: null,
      errorCode: expectedReconciliation
        ? "robinhood_option_order_submit_reconcile_required"
        : "algo_robinhood_submit_outcome_unknown",
      errorMessage: expectedReconciliation
        ? "Robinhood close submission requires provider reconciliation."
        : "Robinhood close submission outcome is unknown and must be reconciled.",
      now: currentTime(dependencies.now),
    });
  }
}
