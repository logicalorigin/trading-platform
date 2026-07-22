import { createHash } from "node:crypto";

import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import { resolveNyseCalendarDay } from "@workspace/market-calendar";
import {
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  db,
  executionEventsTable,
  type AlgoTargetExecution,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import { executePreparedAlgoRobinhoodOptionExit } from "./algo-robinhood-option-exit";
import { reserveAlgoTargetExecution } from "./algo-target-execution-outbox";
import {
  readRobinhoodOptionQuote,
  type RobinhoodOptionOrderInput,
  type RobinhoodOptionQuoteResponse,
} from "./robinhood-option-orders";
import { SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY } from "./signal-options-live-target-execution";
import {
  computeSignalOptionsOvernightPositionExit,
  computeSignalOptionsPositionStop,
} from "./signal-options-exit-policy";

type ManagedPositionInput = {
  id: string;
  quantity: string | number;
  premiumBasis: string | number | null;
  providerPositionId: string | null;
  expiration: string;
  managementState: Record<string, unknown>;
};

type BrokerQuoteProof = {
  providerPositionId: string;
  bid: number;
  ask: number;
  updatedAt: Date;
};

export type SignalOptionsLivePositionManagementState = {
  version: 1;
  peakBid: number;
  stopPrice: number;
  lastBid: number;
  quoteUpdatedAt: string;
  evaluatedAt: string;
  stopBreach: {
    reason: "hard_stop" | "runner_trail_stop";
    stopPrice: number;
    bid: number;
    quoteUpdatedAt: string;
  } | null;
};

export type SignalOptionsLiveTargetExitPlan = {
  managementState: SignalOptionsLivePositionManagementState;
  exit: {
    reason:
      | "hard_stop"
      | "runner_trail_stop"
      | "scale_out_first_trail_arm"
      | "overnight_risk_exit"
      | "expiration";
    quantity: number;
    limitPrice: number;
    quoteUpdatedAt: string;
  } | null;
};

export type SignalOptionsLiveTargetPositionContext = {
  appUserId: string;
  deploymentId: string;
  targetId: string;
  accountId: string;
  providerAccountId: string;
  provider: "robinhood";
  symbol: string;
  deploymentConfig: Record<string, unknown>;
  position: ManagedPositionInput & {
    appUserId: string;
    deploymentId: string;
    targetId: string;
    strategyPositionKey: string;
    symbol: string;
    status: "open";
    contractSnapshot: Record<string, unknown>;
  };
};

type PersistExitIntentInput = {
  context: SignalOptionsLiveTargetPositionContext;
  plan: NonNullable<SignalOptionsLiveTargetExitPlan["exit"]>;
  order: RobinhoodOptionOrderInput;
  managementState: SignalOptionsLivePositionManagementState;
  occurredAt: Date;
};

export type SignalOptionsLiveTargetExitDependencies = {
  now?: () => Date;
  readRobinhoodQuote?: typeof readRobinhoodOptionQuote;
  scaleOutAlreadyFired?: (
    context: SignalOptionsLiveTargetPositionContext,
  ) => Promise<boolean>;
  saveManagementState?: (input: {
    context: SignalOptionsLiveTargetPositionContext;
    managementState: SignalOptionsLivePositionManagementState;
    occurredAt: Date;
  }) => Promise<boolean>;
  persistExitIntent?: (
    input: PersistExitIntentInput,
  ) => Promise<{ id: string }>;
  reserveExit?: typeof reserveAlgoTargetExecution;
  executeRobinhoodExit?: typeof executePreparedAlgoRobinhoodOptionExit;
};

function invalidPositionQuote(message: string): never {
  throw new HttpError(409, message, {
    code: "algo_target_position_quote_invalid",
    expose: true,
  });
}

function finiteNumber(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function regularSessionState(now: Date) {
  const day = resolveNyseCalendarDay(now);
  const openAt = day?.regularOpenAt ? Date.parse(day.regularOpenAt) : Number.NaN;
  const closeAt = day?.regularCloseAt
    ? Date.parse(day.regularCloseAt)
    : Number.NaN;
  const time = now.getTime();
  const open =
    day?.tradingDay === true &&
    Number.isFinite(openAt) &&
    Number.isFinite(closeAt) &&
    time >= openAt &&
    time < closeAt;
  return {
    date: day?.date ?? null,
    open,
    overnightExitWindow: open && time >= closeAt - 15 * 60_000,
  };
}

function priorManagementState(
  value: Record<string, unknown>,
): SignalOptionsLivePositionManagementState | null {
  if (Object.keys(value).length === 0) return null;
  const stopBreachValue = value["stopBreach"];
  const stopBreach =
    stopBreachValue &&
    typeof stopBreachValue === "object" &&
    !Array.isArray(stopBreachValue)
      ? (stopBreachValue as Record<string, unknown>)
      : null;
  const reason = stopBreach?.["reason"];
  const parsed = {
    version: value["version"],
    peakBid: finiteNumber(value["peakBid"]),
    stopPrice: finiteNumber(value["stopPrice"]),
    lastBid: finiteNumber(value["lastBid"]),
    quoteUpdatedAt: value["quoteUpdatedAt"],
    evaluatedAt: value["evaluatedAt"],
    stopBreach:
      stopBreach === null
        ? null
        : {
            reason,
            stopPrice: finiteNumber(stopBreach["stopPrice"]),
            bid: finiteNumber(stopBreach["bid"]),
            quoteUpdatedAt: stopBreach["quoteUpdatedAt"],
          },
  };
  if (
    parsed.version !== 1 ||
    parsed.peakBid === null ||
    parsed.peakBid <= 0 ||
    parsed.stopPrice === null ||
    parsed.stopPrice <= 0 ||
    parsed.lastBid === null ||
    parsed.lastBid <= 0 ||
    typeof parsed.quoteUpdatedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.quoteUpdatedAt)) ||
    typeof parsed.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.evaluatedAt)) ||
    (parsed.stopBreach !== null &&
      ((parsed.stopBreach.reason !== "hard_stop" &&
        parsed.stopBreach.reason !== "runner_trail_stop") ||
        parsed.stopBreach.stopPrice === null ||
        parsed.stopBreach.stopPrice <= 0 ||
        parsed.stopBreach.bid === null ||
        parsed.stopBreach.bid <= 0 ||
        typeof parsed.stopBreach.quoteUpdatedAt !== "string" ||
        !Number.isFinite(Date.parse(parsed.stopBreach.quoteUpdatedAt))))
  ) {
    throw new HttpError(409, "The live position-management state is invalid.", {
      code: "algo_target_position_management_state_invalid",
      expose: true,
    });
  }
  return parsed as SignalOptionsLivePositionManagementState;
}

export function planSignalOptionsLiveTargetExit(input: {
  position: ManagedPositionInput;
  profile: SignalOptionsExecutionProfile;
  quote: BrokerQuoteProof;
  now: Date;
  scaleOutAlreadyFired: boolean;
}): SignalOptionsLiveTargetExitPlan {
  const quantity = finiteNumber(input.position.quantity);
  const premiumBasis = finiteNumber(input.position.premiumBasis);
  const quoteAt = input.quote.updatedAt;
  const nowMs = input.now.getTime();
  const quoteAgeMs = nowMs - quoteAt.getTime();
  const maxQuoteAgeMs = Math.min(
    SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY.maxQuoteAgeMs,
    input.profile.exitPolicy.stopConfirmationMaxQuoteAgeMs,
  );
  if (
    !input.position.id.trim() ||
    !input.position.providerPositionId?.trim() ||
    input.quote.providerPositionId !== input.position.providerPositionId ||
    quantity === null ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    premiumBasis === null ||
    premiumBasis <= 0 ||
    !Number.isFinite(input.quote.bid) ||
    input.quote.bid <= 0 ||
    !Number.isFinite(input.quote.ask) ||
    input.quote.ask < input.quote.bid ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(quoteAt.getTime()) ||
    quoteAgeMs < 0 ||
    quoteAgeMs > maxQuoteAgeMs
  ) {
    return invalidPositionQuote(
      "The broker did not return fresh proof for the exact algo-owned position.",
    );
  }
  const ownedQuantity = quantity as number;

  const entryPrice = premiumBasis / (ownedQuantity * 100);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new HttpError(409, "The algo-owned position basis is invalid.", {
      code: "algo_target_position_basis_invalid",
      expose: true,
    });
  }
  const prior = priorManagementState(input.position.managementState);
  const peakBid = Math.max(entryPrice, input.quote.bid, prior?.peakBid ?? 0);
  const stop = computeSignalOptionsPositionStop({
    entryPrice,
    peakPrice: peakBid,
    markPrice: input.quote.bid,
    profile: input.profile,
    priorStopPrice: prior?.stopPrice ?? null,
    quantity: ownedQuantity,
    scaleOutAlreadyFired: input.scaleOutAlreadyFired,
    now: input.now,
    wireTrailEnforceEnabled: false,
  });
  const regularReason =
    stop.exitReason === "hard_stop" ||
    stop.exitReason === "runner_trail_stop"
      ? stop.exitReason
      : null;
  const quoteUpdatedAt = quoteAt.toISOString();
  const priorBreachAt = prior?.stopBreach
    ? Date.parse(prior.stopBreach.quoteUpdatedAt)
    : Number.NaN;
  const regularStopConfirmed = Boolean(
    regularReason &&
      prior?.stopBreach?.reason === regularReason &&
      prior.stopBreach.stopPrice === stop.stopPrice &&
      quoteAt.getTime() > priorBreachAt &&
      quoteAt.getTime() - priorBreachAt <=
        input.profile.exitPolicy.stopConfirmationWindowMs,
  );
  const managementState: SignalOptionsLivePositionManagementState = {
    version: 1,
    peakBid: rounded(peakBid),
    stopPrice: rounded(stop.stopPrice),
    lastBid: rounded(input.quote.bid),
    quoteUpdatedAt,
    evaluatedAt: input.now.toISOString(),
    stopBreach: regularReason
      ? {
          reason: regularReason,
          stopPrice: rounded(stop.stopPrice),
          bid: rounded(input.quote.bid),
          quoteUpdatedAt,
        }
      : null,
  };
  const scaleOut =
    !regularReason &&
    stop.scaleOutArmed === true &&
    Number.isSafeInteger(stop.exitQuantity) &&
    Number(stop.exitQuantity) > 0 &&
    Number(stop.exitQuantity) < ownedQuantity;
  const session = regularSessionState(input.now);
  const expirationExit =
    session.open &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.position.expiration) &&
    session.date !== null &&
    session.date >= input.position.expiration;
  const overnight = session.overnightExitWindow
    ? computeSignalOptionsOvernightPositionExit({
        entryPrice,
        peakPrice: peakBid,
        markPrice: input.quote.bid,
        profile: input.profile,
      })
    : null;
  const reason = expirationExit
    ? "expiration"
    : overnight?.exitReason === "overnight_risk_exit"
      ? "overnight_risk_exit"
      : session.open && regularStopConfirmed
        ? regularReason
        : session.open && scaleOut
          ? "scale_out_first_trail_arm"
          : null;
  return {
    managementState,
    exit: reason
      ? {
          reason,
          quantity:
            reason === "scale_out_first_trail_arm"
              ? Number(stop.exitQuantity)
              : ownedQuantity,
          limitPrice: rounded(input.quote.bid),
          quoteUpdatedAt,
        }
      : null,
  };
}

function requiredString(value: unknown, code: string): string {
  const string = typeof value === "string" ? value.trim() : "";
  if (!string) {
    throw new HttpError(409, "The algo-owned option contract is invalid.", {
      code,
      expose: true,
    });
  }
  return string;
}

function positiveNumber(value: unknown, code: string): number {
  const number = finiteNumber(value);
  if (number === null || number <= 0) {
    throw new HttpError(409, "The algo-owned option contract is invalid.", {
      code,
      expose: true,
    });
  }
  return number;
}

function exitOrderFromContext(
  context: SignalOptionsLiveTargetPositionContext,
  exit: { quantity: number; limitPrice: number },
): RobinhoodOptionOrderInput {
  const contract = context.position.contractSnapshot;
  const optionType = contract["optionType"];
  if (optionType !== "Call" && optionType !== "Put") {
    throw new HttpError(409, "The algo-owned option contract is invalid.", {
      code: "algo_target_close_contract_invalid",
      expose: true,
    });
  }
  return {
    contractSymbol: requiredString(
      contract["contractSymbol"] ?? contract["occSymbol"],
      "algo_target_close_contract_invalid",
    ),
    multiplier: positiveNumber(
      contract["multiplier"],
      "algo_target_close_contract_invalid",
    ),
    sharesPerContract: positiveNumber(
      contract["sharesPerContract"],
      "algo_target_close_contract_invalid",
    ),
    chainSymbol: requiredString(
      contract["chainSymbol"],
      "algo_target_close_contract_invalid",
    ),
    underlyingType: "equity",
    expiration: requiredString(
      contract["expiration"],
      "algo_target_close_contract_invalid",
    ),
    strike: positiveNumber(
      contract["strike"],
      "algo_target_close_contract_invalid",
    ),
    optionType,
    side: "Sell",
    positionEffect: "Close",
    orderType: "Limit",
    timeInForce: "Day",
    marketHours: "regular_hours",
    quantity: exit.quantity,
    limitPrice: exit.limitPrice,
    stopPrice: null,
  };
}

function quoteProbeOrder(
  context: SignalOptionsLiveTargetPositionContext,
): RobinhoodOptionOrderInput {
  return exitOrderFromContext(context, { quantity: 1, limitPrice: 0.01 });
}

function deterministicEventId(namespace: string, identity: unknown[]): string {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(JSON.stringify(identity))
    .digest("hex");
  const variant = (
    (Number.parseInt(digest.slice(16, 17), 16) & 0b0011) |
    0b1000
  ).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `8${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

async function defaultScaleOutAlreadyFired(
  context: SignalOptionsLiveTargetPositionContext,
): Promise<boolean> {
  const rows = await db
    .select({
      status: algoTargetExecutionsTable.status,
      filledQuantity: algoTargetExecutionsTable.filledQuantity,
      orderSnapshot: algoTargetExecutionsTable.orderSnapshot,
    })
    .from(algoTargetExecutionsTable)
    .where(
      and(
        eq(algoTargetExecutionsTable.appUserId, context.appUserId),
        eq(algoTargetExecutionsTable.deploymentId, context.deploymentId),
        eq(algoTargetExecutionsTable.targetId, context.targetId),
        eq(algoTargetExecutionsTable.action, "exit"),
      ),
    );
  return rows.some((row) => {
    const snapshot = row.orderSnapshot;
    return (
      snapshot["positionId"] === context.position.id &&
      snapshot["exitReason"] === "scale_out_first_trail_arm" &&
      row.status !== "rejected" &&
      (row.status !== "cancelled" || Number(row.filledQuantity) > 0)
    );
  });
}

async function defaultSaveManagementState(input: {
  context: SignalOptionsLiveTargetPositionContext;
  managementState: SignalOptionsLivePositionManagementState;
  occurredAt: Date;
}): Promise<boolean> {
  const [updated] = await db
    .update(algoTargetPositionsTable)
    .set({
      managementState: input.managementState,
      updatedAt: input.occurredAt,
    })
    .where(
      and(
        eq(algoTargetPositionsTable.id, input.context.position.id),
        eq(algoTargetPositionsTable.appUserId, input.context.appUserId),
        eq(
          algoTargetPositionsTable.deploymentId,
          input.context.deploymentId,
        ),
        eq(algoTargetPositionsTable.targetId, input.context.targetId),
        eq(algoTargetPositionsTable.status, "open"),
      ),
    )
    .returning({ id: algoTargetPositionsTable.id });
  return Boolean(updated);
}

async function defaultPersistExitIntent(
  input: PersistExitIntentInput,
): Promise<{ id: string }> {
  const id = deterministicEventId("pyrus:signal-options:live-exit-intent:v1", [
    input.context.deploymentId,
    input.context.targetId,
    input.context.position.id,
    input.plan.reason,
    input.plan.quantity,
    input.plan.limitPrice,
    input.plan.quoteUpdatedAt,
  ]);
  const [inserted] = await db
    .insert(executionEventsTable)
    .values({
      id,
      deploymentId: input.context.deploymentId,
      providerAccountId: input.context.providerAccountId,
      symbol: input.context.symbol,
      eventType: "signal_options_live_exit_intent",
      summary: `${input.context.symbol} live exit: ${input.plan.reason}`,
      payload: {
        targetId: input.context.targetId,
        positionId: input.context.position.id,
        strategyPositionKey: input.context.position.strategyPositionKey,
        reason: input.plan.reason,
        quantity: input.plan.quantity,
        limitPrice: input.plan.limitPrice,
        quoteUpdatedAt: input.plan.quoteUpdatedAt,
        managementState: input.managementState,
      },
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing({ target: executionEventsTable.id })
    .returning({ id: executionEventsTable.id });
  if (inserted) return inserted;
  const [existing] = await db
    .select({ id: executionEventsTable.id })
    .from(executionEventsTable)
    .where(eq(executionEventsTable.id, id))
    .limit(1);
  if (!existing) {
    throw new HttpError(409, "The durable live exit intent is unavailable.", {
      code: "algo_target_exit_intent_unavailable",
      expose: true,
    });
  }
  return existing;
}

function validNow(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) {
    throw new HttpError(422, "Live position management time is invalid.", {
      code: "algo_target_position_time_invalid",
      expose: true,
    });
  }
  return value;
}

function quoteProof(
  response: RobinhoodOptionQuoteResponse,
  context: SignalOptionsLiveTargetPositionContext,
): BrokerQuoteProof {
  const bid = finiteNumber(response.quote.bidPrice);
  const ask = finiteNumber(response.quote.askPrice);
  const updatedAt = new Date(String(response.quote.updatedAt ?? ""));
  if (
    response.provider !== "robinhood" ||
    response.account.id !== context.accountId ||
    response.optionId !== context.position.providerPositionId ||
    response.quote.instrumentId !== context.position.providerPositionId ||
    bid === null ||
    ask === null
  ) {
    return invalidPositionQuote(
      "Robinhood did not return the exact algo-owned option quote.",
    );
  }
  return {
    providerPositionId: response.optionId,
    bid,
    ask,
    updatedAt,
  };
}

export async function manageSignalOptionsLiveTargetPosition(
  context: SignalOptionsLiveTargetPositionContext,
  dependencies: SignalOptionsLiveTargetExitDependencies = {},
): Promise<{
  status: "managed" | "session_closed" | AlgoTargetExecution["status"];
  execution: AlgoTargetExecution | null;
  plan: SignalOptionsLiveTargetExitPlan | null;
}> {
  if (
    context.position.appUserId !== context.appUserId ||
    context.position.deploymentId !== context.deploymentId ||
    context.position.targetId !== context.targetId ||
    context.position.symbol !== context.symbol ||
    context.position.status !== "open"
  ) {
    throw new HttpError(409, "The algo-owned position context is invalid.", {
      code: "algo_target_position_context_invalid",
      expose: true,
    });
  }
  const now = validNow(dependencies.now);
  if (!regularSessionState(now).open) {
    return { status: "session_closed", execution: null, plan: null };
  }
  const quote = await (
    dependencies.readRobinhoodQuote ?? readRobinhoodOptionQuote
  )({
    appUserId: context.appUserId,
    accountId: context.accountId,
    input: quoteProbeOrder(context),
    now,
  });
  const profile = resolveSignalOptionsExecutionProfile(
    context.deploymentConfig,
  );
  const scaleOutAlreadyFired = await (
    dependencies.scaleOutAlreadyFired ?? defaultScaleOutAlreadyFired
  )(context);
  const plan = planSignalOptionsLiveTargetExit({
    position: context.position,
    profile,
    quote: quoteProof(quote, context),
    now,
    scaleOutAlreadyFired,
  });
  const stateSaved = await (
    dependencies.saveManagementState ?? defaultSaveManagementState
  )({ context, managementState: plan.managementState, occurredAt: now });
  if (!stateSaved) {
    throw new HttpError(
      409,
      "The algo-owned position changed before its state could be saved.",
      {
        code: "algo_target_position_state_conflict",
        expose: true,
      },
    );
  }
  if (!plan.exit) return { status: "managed", execution: null, plan };

  const order = exitOrderFromContext(context, plan.exit);
  const intent = await (
    dependencies.persistExitIntent ?? defaultPersistExitIntent
  )({
    context,
    plan: plan.exit,
    order,
    managementState: plan.managementState,
    occurredAt: now,
  });
  const execution = await (
    dependencies.reserveExit ?? reserveAlgoTargetExecution
  )({
    appUserId: context.appUserId,
    deploymentId: context.deploymentId,
    targetId: context.targetId,
    sourceEventId: intent.id,
    action: "exit",
    actionIdentity: [
      context.position.id,
      plan.exit.reason,
      plan.exit.quantity,
      plan.exit.limitPrice,
      plan.exit.quoteUpdatedAt,
    ].join(":"),
    contractSnapshot: context.position.contractSnapshot,
    orderSnapshot: {
      positionId: context.position.id,
      strategyPositionKey: context.position.strategyPositionKey,
      exitReason: plan.exit.reason,
      side: "Sell",
      positionEffect: "Close",
      orderType: "Limit",
      timeInForce: "Day",
      marketHours: "regular_hours",
      quantity: plan.exit.quantity,
      limitPrice: plan.exit.limitPrice,
      stopPrice: null,
      platformCaps: {
        maxQuoteAgeMs: SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY.maxQuoteAgeMs,
      },
    },
    requestedQuantity: plan.exit.quantity,
    premiumAtRisk: null,
    occurredAt: now,
  });
  const submitted = await (
    dependencies.executeRobinhoodExit ?? executePreparedAlgoRobinhoodOptionExit
  )({
    appUserId: context.appUserId,
    accountId: context.accountId,
    algoContext: {
      deploymentId: context.deploymentId,
      targetId: context.targetId,
      positionId: context.position.id,
      targetExecutionId: execution.id,
    },
    order,
  });
  return { status: submitted.status, execution: submitted, plan };
}
