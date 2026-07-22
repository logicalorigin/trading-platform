import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

import { getMassiveRuntimeConfig } from "../../artifacts/api-server/src/lib/runtime";
import {
  MassiveMarketDataClient,
  type MarketQuoteTick,
} from "../../artifacts/api-server/src/providers/massive/market-data";

const CORRECTION_ID = "41b8f7e5-4b26-4d04-b7bd-3a9ba4d923e4";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const ACCOUNT_ID = "shadow";
const MAX_QUOTE_AGE_MS = 5 * 60_000;
const MAX_CONFIRMATION_SPACING_MS = 10_000;
const MARK_MATCH_TOLERANCE = 0.011;

type Mode = "dry-run" | "apply";

type QuoteEvidence = {
  at: string;
  bid: number;
  ask: number;
  bidSize: number | null;
  askSize: number | null;
  sequenceNumber: number | null;
};

type OriginalExit = {
  eventId: string;
  orderId: string;
  fillId: string;
  at: string;
  price: number;
  cashDelta: number;
  realizedPnl: number;
  fees: number;
};

type PositionCorrection = {
  symbol: string;
  ticker: string;
  positionId: string;
  entryEventId: string;
  entryOrderId: string;
  entryFillId: string;
  openedAt: string;
  entryPrice: number;
  quantity: number;
  multiplier: number;
  entryFee: number;
  peakBid: number;
  peakAt: string;
  trailStep: {
    activationPct: number;
    retracementPct: number;
    minLockedGainPct: number;
  };
  stopPrice: number;
  evidence: [QuoteEvidence, QuoteEvidence];
  exitFee: number;
  replacement: {
    eventId: string;
    orderId: string;
    fillId: string;
  };
  originalExit: OriginalExit | null;
  expectedMarkCorrectionCount: number;
  expectedMarkCorrectionSha256: string;
};

const corrections: readonly PositionCorrection[] = [
  {
    symbol: "ABT",
    ticker: "O:ABT260724P00103000",
    positionId: "917ce307-c03c-45c8-801e-39f60acfcfcc",
    entryEventId: "c3445f40-d282-845c-818a-ed5c46d2c339",
    entryOrderId: "53793606-8add-4cb0-abe0-e9eb02fc9c70",
    entryFillId: "642a2406-1735-4d6c-bcfb-33f29bfe792a",
    openedAt: "2026-07-20T18:59:31.923Z",
    entryPrice: 2.34,
    quantity: 6,
    multiplier: 100,
    entryFee: 4.04,
    peakBid: 2.85,
    peakAt: "2026-07-21T17:01:38.022Z",
    trailStep: {
      activationPct: 20,
      retracementPct: 30,
      minLockedGainPct: 0,
    },
    stopPrice: 2.7,
    evidence: [
      {
        at: "2026-07-22T13:35:13.066Z",
        bid: 1.7,
        ask: 4.4,
        bidSize: 1,
        askSize: 1,
        sequenceNumber: 64_450_610,
      },
      {
        at: "2026-07-22T13:35:13.087Z",
        bid: 1.1,
        ask: 5,
        bidSize: 1,
        askSize: 1,
        sequenceNumber: 64_452_819,
      },
    ],
    exitFee: 4.04,
    replacement: {
      eventId: "f7d6d6f9-0de7-48db-bccd-2aee0297dfeb",
      orderId: "18670815-8f80-49d5-9453-f9b874f985b3",
      fillId: "0d909322-b9f9-4dc9-9187-7f553e66caa0",
    },
    originalExit: {
      eventId: "d7ff70d1-8be0-8c06-9602-715e08f708ad",
      orderId: "f3bbe890-05c7-49fe-b5fa-15103a63dfd2",
      fillId: "6994f66b-5ccc-4412-bac9-c49cf2a9049b",
      at: "2026-07-22T17:42:05.324Z",
      price: 2.1,
      cashDelta: 1_255.96,
      realizedPnl: -148.04,
      fees: 4.04,
    },
    expectedMarkCorrectionCount: 682,
    expectedMarkCorrectionSha256:
      "af505f57c0b4c073b1183feea6d62155f76281ebf93b4ee4dfc63f64f32f96c0",
  },
  {
    symbol: "AA",
    ticker: "O:AA260724C00045000",
    positionId: "4ea00c5a-7498-4389-83f7-8e6aef7538d0",
    entryEventId: "32ed7a30-7b7c-89ec-93a1-bf6aa7f19493",
    entryOrderId: "98ba8c61-f71b-4df5-af36-8e8fd183335a",
    entryFillId: "893717e0-2569-41d3-9a0a-4126b4a00c66",
    openedAt: "2026-07-22T13:33:36.747Z",
    entryPrice: 1.59,
    quantity: 9,
    multiplier: 100,
    entryFee: 6.06,
    peakBid: 2.27,
    peakAt: "2026-07-22T15:21:21.380Z",
    trailStep: {
      activationPct: 30,
      retracementPct: 25,
      minLockedGainPct: 15,
    },
    stopPrice: 2.1,
    evidence: [
      {
        at: "2026-07-22T15:21:55.697Z",
        bid: 2.08,
        ask: 2.41,
        bidSize: 110,
        askSize: 365,
        sequenceNumber: 581_860_399,
      },
      {
        at: "2026-07-22T15:21:55.700Z",
        bid: 2.08,
        ask: 2.41,
        bidSize: 110,
        askSize: 381,
        sequenceNumber: 581_860_574,
      },
    ],
    exitFee: 6.06,
    replacement: {
      eventId: "9bb1bb52-5131-448e-b483-3aa216d30c63",
      orderId: "d96f2a44-879f-4c76-a7f7-84acb2dd9f41",
      fillId: "620f99be-1772-423b-a5fa-2733e26f097d",
    },
    originalExit: {
      eventId: "003dc77e-2562-8c01-b366-4dae5bc84613",
      orderId: "412732b3-7ceb-42ec-b510-ae293dc5f0dc",
      fillId: "dfec2e6c-7e1a-435f-bfc6-51703611c48d",
      at: "2026-07-22T17:03:40.177Z",
      price: 1.68,
      cashDelta: 1_505.94,
      realizedPnl: 74.94,
      fees: 6.06,
    },
    expectedMarkCorrectionCount: 179,
    expectedMarkCorrectionSha256:
      "1194a34f9c38d9b74d12139a772a9870e979505027ffa9a5ad0352dd6c570faf",
  },
  {
    symbol: "COF",
    ticker: "O:COF260724P00210000",
    positionId: "ab3ad50f-3fc4-43a8-8101-1725fa830dfb",
    entryEventId: "e030ddbe-faca-86ec-8a35-65e1f1eb9f77",
    entryOrderId: "1f9cf120-ed71-4074-a33e-9d91020e9d61",
    entryFillId: "05bbdac6-07b8-4728-afd7-42096e5281df",
    openedAt: "2026-07-20T17:13:22.138Z",
    entryPrice: 7.16,
    quantity: 2,
    multiplier: 100,
    entryFee: 1.35,
    peakBid: 9.8,
    peakAt: "2026-07-22T15:18:49.339Z",
    trailStep: {
      activationPct: 30,
      retracementPct: 25,
      minLockedGainPct: 15,
    },
    stopPrice: 9.14,
    evidence: [
      {
        at: "2026-07-22T15:20:23.221Z",
        bid: 9,
        ask: 11,
        bidSize: 37,
        askSize: 82,
        sequenceNumber: 486_110_759,
      },
      {
        at: "2026-07-22T15:20:23.290Z",
        bid: 9,
        ask: 11,
        bidSize: 37,
        askSize: 94,
        sequenceNumber: 486_126_023,
      },
    ],
    exitFee: 1.35,
    replacement: {
      eventId: "a25da9d5-d3d5-4732-99ef-b6893b02c1f8",
      orderId: "e8141796-ae28-42ad-951b-a11ec9f0501b",
      fillId: "a1577438-1ab1-41e0-85ca-ac1c5143a1d8",
    },
    originalExit: null,
    expectedMarkCorrectionCount: 1_206,
    expectedMarkCorrectionSha256:
      "7341aa91c3ba1f36df5da12ca332cb1f9c9fe71b94e659cdf121d34c623097d3",
  },
] as const;

type DbMark = {
  id: string;
  mark: number;
  marketValue: number;
  unrealizedPnl: number;
  source: string;
  asOf: Date;
};

type MarkUpdate = DbMark & {
  oldMark: number;
  oldMarketValue: number;
  oldUnrealizedPnl: number;
  quote: QuoteEvidence;
};

type MarkPlan = {
  original: DbMark[];
  corrected: DbMark[];
  updates: MarkUpdate[];
  removals: DbMark[];
  canonicalSha256: string;
};

type SnapshotRow = {
  id: string;
  asOf: Date;
  cash: number;
  buyingPower: number;
  netLiquidation: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function numberValue(value: unknown, label = "value"): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`${label} must be finite; received ${String(value)}`);
  }
  return parsed;
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

function nearlyEqual(left: number, right: number, tolerance = 0.000_001) {
  return Math.abs(left - right) <= tolerance;
}

function assertMoney(actual: unknown, expected: number, label: string): void {
  const parsed = numberValue(actual, label);
  if (!nearlyEqual(parsed, expected)) {
    fail(`${label}: expected ${expected.toFixed(6)}, received ${parsed.toFixed(6)}`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function quoteEvidence(quote: MarketQuoteTick): QuoteEvidence {
  return {
    at: quote.occurredAt.toISOString(),
    bid: quote.bid,
    ask: quote.ask,
    bidSize: quote.bidSize ?? null,
    askSize: quote.askSize ?? null,
    sequenceNumber: quote.sequenceNumber ?? null,
  };
}

function sameQuote(left: QuoteEvidence, right: QuoteEvidence): boolean {
  return (
    left.at === right.at &&
    left.bid === right.bid &&
    left.ask === right.ask &&
    left.bidSize === right.bidSize &&
    left.askSize === right.askSize &&
    left.sequenceNumber === right.sequenceNumber
  );
}

function validQuotes(quotes: readonly MarketQuoteTick[]) {
  return [...quotes]
    .filter(
      (quote) =>
        Number.isFinite(quote.bid) &&
        quote.bid > 0 &&
        Number.isFinite(quote.ask) &&
        quote.ask >= quote.bid,
    )
    .sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        String(left.sequenceNumber ?? "").localeCompare(
          String(right.sequenceNumber ?? ""),
        ),
    );
}

export function findEarliestBidConfirmation(input: {
  quotes: readonly MarketQuoteTick[];
  from: Date;
  stopPrice: number;
  maxSpacingMs?: number;
}): [QuoteEvidence, QuoteEvidence] | null {
  const maxSpacingMs =
    input.maxSpacingMs ?? MAX_CONFIRMATION_SPACING_MS;
  let prior: MarketQuoteTick | null = null;
  for (const quote of validQuotes(input.quotes)) {
    if (quote.occurredAt < input.from) {
      continue;
    }
    if (quote.bid > input.stopPrice) {
      prior = null;
      continue;
    }
    if (
      prior &&
      quote.occurredAt.getTime() - prior.occurredAt.getTime() <= maxSpacingMs
    ) {
      return [quoteEvidence(prior), quoteEvidence(quote)];
    }
    prior = quote;
  }
  return null;
}

export function computeProfitRetraceStop(input: {
  entryPrice: number;
  peakPrice: number;
  retracementPct: number;
  minLockedGainPct: number;
}) {
  const retrace =
    input.entryPrice +
    (input.peakPrice - input.entryPrice) *
      (1 - input.retracementPct / 100);
  const floor = input.entryPrice * (1 + input.minLockedGainPct / 100);
  return money(Math.max(retrace, floor));
}

function latestQuoteAtOrBefore(
  quotes: readonly MarketQuoteTick[],
  asOf: Date,
): MarketQuoteTick | null {
  let low = 0;
  let high = quotes.length - 1;
  let found: MarketQuoteTick | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const quote = quotes[middle]!;
    if (quote.occurredAt <= asOf) {
      found = quote;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export function buildMarkPlan(input: {
  spec: PositionCorrection;
  marks: readonly DbMark[];
  quotes: readonly MarketQuoteTick[];
}): MarkPlan {
  const exitAt = new Date(input.spec.evidence[1].at);
  const quotes = validQuotes(input.quotes);
  const original = [...input.marks].sort(
    (left, right) =>
      left.asOf.getTime() - right.asOf.getTime() ||
      left.id.localeCompare(right.id),
  );
  const updates: MarkUpdate[] = [];
  const removals: DbMark[] = [];
  for (const mark of original) {
    if (mark.asOf >= exitAt) {
      removals.push(mark);
      continue;
    }
    const quote = latestQuoteAtOrBefore(quotes, mark.asOf);
    if (!quote) {
      continue;
    }
    const ageMs = mark.asOf.getTime() - quote.occurredAt.getTime();
    if (ageMs < 0 || ageMs > MAX_QUOTE_AGE_MS) {
      continue;
    }
    const midpoint = (quote.bid + quote.ask) / 2;
    const alreadyBid = Math.abs(mark.mark - quote.bid) <= MARK_MATCH_TOLERANCE;
    const wasMidpoint =
      Math.abs(mark.mark - midpoint) <= MARK_MATCH_TOLERANCE;
    if (alreadyBid || !wasMidpoint || nearlyEqual(mark.mark, quote.bid, 0.001)) {
      continue;
    }
    const extension = mark.marketValue / mark.mark;
    const expectedExtension = input.spec.quantity * input.spec.multiplier;
    if (!nearlyEqual(extension, expectedExtension, 0.01)) {
      fail(
        `${input.spec.symbol} mark ${mark.id} extension ${extension} does not match ${expectedExtension}`,
      );
    }
    const marketValue = money(quote.bid * extension);
    updates.push({
      ...mark,
      oldMark: mark.mark,
      oldMarketValue: mark.marketValue,
      oldUnrealizedPnl: mark.unrealizedPnl,
      mark: quote.bid,
      marketValue,
      unrealizedPnl: money(
        mark.unrealizedPnl + marketValue - mark.marketValue,
      ),
      source: "ledger_correction_executable_bid",
      quote: quoteEvidence(quote),
    });
  }
  const updateById = new Map(updates.map((mark) => [mark.id, mark]));
  const removalIds = new Set(removals.map((mark) => mark.id));
  const corrected = original
    .filter((mark) => !removalIds.has(mark.id))
    .map((mark) => updateById.get(mark.id) ?? mark);
  const auditRows = updates.map((mark) => ({
    id: mark.id,
    at: mark.asOf.toISOString(),
    oldMark: mark.oldMark,
    bid: mark.quote.bid,
    ask: mark.quote.ask,
    quoteAt: mark.quote.at,
    sequenceNumber: mark.quote.sequenceNumber,
  }));
  return {
    original,
    corrected,
    updates,
    removals,
    canonicalSha256: sha256(JSON.stringify(auditRows)),
  };
}

function contributionAt(input: {
  spec: PositionCorrection;
  marks: readonly DbMark[];
  asOf: Date;
  closedAt: Date | null;
}) {
  const openedAt = new Date(input.spec.openedAt);
  if (
    input.asOf < openedAt ||
    (input.closedAt && input.asOf >= input.closedAt)
  ) {
    return { marketValue: 0, unrealizedPnl: 0 };
  }
  let low = 0;
  let high = input.marks.length - 1;
  let found: DbMark | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const mark = input.marks[middle]!;
    if (mark.asOf <= input.asOf) {
      found = mark;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found
    ? {
        marketValue: found.marketValue,
        unrealizedPnl: found.unrealizedPnl,
      }
    : {
        marketValue:
          input.spec.entryPrice *
          input.spec.quantity *
          input.spec.multiplier,
        unrealizedPnl: 0,
      };
}

function replacementEconomics(spec: PositionCorrection) {
  const price = spec.evidence[1].bid;
  const grossAmount = money(price * spec.quantity * spec.multiplier);
  const grossPnl = money(
    (price - spec.entryPrice) * spec.quantity * spec.multiplier,
  );
  return {
    price,
    grossAmount,
    grossPnl,
    fees: spec.exitFee,
    cashDelta: money(grossAmount - spec.exitFee),
    realizedPnl: money(grossPnl - spec.exitFee),
  };
}

function exitEconomicsAt(
  economics: Pick<OriginalExit, "at" | "cashDelta" | "realizedPnl" | "fees"> | null,
  asOf: Date,
) {
  return economics && asOf >= new Date(economics.at)
    ? {
        cashDelta: economics.cashDelta,
        realizedPnl: economics.realizedPnl,
        fees: economics.fees,
      }
    : { cashDelta: 0, realizedPnl: 0, fees: 0 };
}

export function correctSnapshot(input: {
  snapshot: SnapshotRow;
  plans: ReadonlyMap<string, MarkPlan>;
}) {
  let cashDelta = 0;
  let realizedDelta = 0;
  let feesDelta = 0;
  let marketValueDelta = 0;
  let unrealizedDelta = 0;
  for (const spec of corrections) {
    const plan = input.plans.get(spec.symbol);
    if (!plan) {
      fail(`Missing ${spec.symbol} mark plan`);
    }
    const replacement = replacementEconomics(spec);
    const newExit = exitEconomicsAt(
      {
        at: spec.evidence[1].at,
        cashDelta: replacement.cashDelta,
        realizedPnl: replacement.realizedPnl,
        fees: replacement.fees,
      },
      input.snapshot.asOf,
    );
    const oldExit = exitEconomicsAt(spec.originalExit, input.snapshot.asOf);
    cashDelta += newExit.cashDelta - oldExit.cashDelta;
    realizedDelta += newExit.realizedPnl - oldExit.realizedPnl;
    feesDelta += newExit.fees - oldExit.fees;

    const oldContribution = contributionAt({
      spec,
      marks: plan.original,
      asOf: input.snapshot.asOf,
      closedAt: spec.originalExit ? new Date(spec.originalExit.at) : null,
    });
    const newContribution = contributionAt({
      spec,
      marks: plan.corrected,
      asOf: input.snapshot.asOf,
      closedAt: new Date(spec.evidence[1].at),
    });
    marketValueDelta +=
      newContribution.marketValue - oldContribution.marketValue;
    unrealizedDelta +=
      newContribution.unrealizedPnl - oldContribution.unrealizedPnl;
  }
  return {
    ...input.snapshot,
    cash: money(input.snapshot.cash + cashDelta),
    buyingPower: money(input.snapshot.buyingPower + cashDelta),
    netLiquidation: money(
      input.snapshot.netLiquidation + cashDelta + marketValueDelta,
    ),
    realizedPnl: money(input.snapshot.realizedPnl + realizedDelta),
    unrealizedPnl: money(input.snapshot.unrealizedPnl + unrealizedDelta),
    fees: money(input.snapshot.fees + feesDelta),
  };
}

function readMode(): Mode {
  const value =
    process.env.SHADOW_TRAILING_BID_CORRECTION_MODE?.trim() || "dry-run";
  if (value !== "dry-run" && value !== "apply") {
    fail(
      "SHADOW_TRAILING_BID_CORRECTION_MODE must be dry-run or apply",
    );
  }
  return value;
}

function correctionMetadata(correctedAt: Date, reason: string) {
  return {
    id: CORRECTION_ID,
    status: "corrected",
    reason,
    correctedAt: correctedAt.toISOString(),
  };
}

async function verifyBackupTable(client: PoolClient): Promise<void> {
  const result = await client.query<{ table_name: string | null }>(
    "select to_regclass('public.shadow_ledger_correction_backups')::text as table_name",
  );
  if (result.rows[0]?.table_name !== "shadow_ledger_correction_backups") {
    fail(
      "Apply lib/db/migrations/20260722_shadow_ledger_correction_backups.sql first",
    );
  }
}

async function backupUuidRows(
  client: PoolClient,
  tableName:
    | "execution_events"
    | "shadow_orders"
    | "shadow_positions"
    | "shadow_position_marks"
    | "shadow_balance_snapshots",
  ids: readonly string[],
  backedUpAt: Date,
) {
  if (!ids.length) return 0;
  const sqlByTable = {
    execution_events: `
      insert into shadow_ledger_correction_backups
        (correction_id, table_name, row_id, row_data, backed_up_at)
      select $1::uuid, 'execution_events', id::text, to_jsonb(row), $3
      from execution_events row where id = any($2::uuid[])
      on conflict do nothing`,
    shadow_orders: `
      insert into shadow_ledger_correction_backups
        (correction_id, table_name, row_id, row_data, backed_up_at)
      select $1::uuid, 'shadow_orders', id::text, to_jsonb(row), $3
      from shadow_orders row where id = any($2::uuid[])
      on conflict do nothing`,
    shadow_positions: `
      insert into shadow_ledger_correction_backups
        (correction_id, table_name, row_id, row_data, backed_up_at)
      select $1::uuid, 'shadow_positions', id::text, to_jsonb(row), $3
      from shadow_positions row where id = any($2::uuid[])
      on conflict do nothing`,
    shadow_position_marks: `
      insert into shadow_ledger_correction_backups
        (correction_id, table_name, row_id, row_data, backed_up_at)
      select $1::uuid, 'shadow_position_marks', id::text, to_jsonb(row), $3
      from shadow_position_marks row where id = any($2::uuid[])
      on conflict do nothing`,
    shadow_balance_snapshots: `
      insert into shadow_ledger_correction_backups
        (correction_id, table_name, row_id, row_data, backed_up_at)
      select $1::uuid, 'shadow_balance_snapshots', id::text, to_jsonb(row), $3
      from shadow_balance_snapshots row where id = any($2::uuid[])
      on conflict do nothing`,
  } as const;
  const result = await client.query(sqlByTable[tableName], [
    CORRECTION_ID,
    ids,
    backedUpAt,
  ]);
  return result.rowCount ?? 0;
}

async function backupAccount(client: PoolClient, backedUpAt: Date) {
  const result = await client.query(
    `insert into shadow_ledger_correction_backups
       (correction_id, table_name, row_id, row_data, backed_up_at)
     select $1::uuid, 'shadow_accounts', id, to_jsonb(row), $3
     from shadow_accounts row where id = $2
     on conflict do nothing`,
    [CORRECTION_ID, ACCOUNT_ID, backedUpAt],
  );
  return result.rowCount ?? 0;
}

async function loadMarks(
  client: PoolClient,
  positionId: string,
): Promise<DbMark[]> {
  const result = await client.query<{
    id: string;
    mark: string;
    market_value: string;
    unrealized_pnl: string;
    source: string;
    as_of: Date;
  }>(
    `select id::text, mark::text, market_value::text, unrealized_pnl::text,
            source, as_of
       from shadow_position_marks
      where position_id = $1::uuid
      order by as_of, id`,
    [positionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    mark: numberValue(row.mark),
    marketValue: numberValue(row.market_value),
    unrealizedPnl: numberValue(row.unrealized_pnl),
    source: row.source,
    asOf: new Date(row.as_of),
  }));
}

async function fetchQuoteTapes() {
  const config = getMassiveRuntimeConfig();
  if (!config) {
    fail("Massive market-data configuration is unavailable");
  }
  const client = new MassiveMarketDataClient(config);
  const result = new Map<string, MarketQuoteTick[]>();
  for (const spec of corrections) {
    const quotes = await client.getOptionQuoteTicks({
      optionTicker: spec.ticker,
      from: new Date(spec.openedAt),
      to: new Date(),
      limit: 50_000,
      maxPages: 10,
    });
    const confirmation = findEarliestBidConfirmation({
      quotes,
      from: new Date(spec.peakAt),
      stopPrice: spec.stopPrice,
    });
    if (
      !confirmation ||
      !sameQuote(confirmation[0], spec.evidence[0]) ||
      !sameQuote(confirmation[1], spec.evidence[1])
    ) {
      fail(`${spec.symbol} provider confirmation no longer matches the audit`);
    }
    result.set(spec.symbol, quotes);
  }
  return result;
}

function validateStopConfiguration(): void {
  for (const spec of corrections) {
    const peakReturnPct = ((spec.peakBid / spec.entryPrice) - 1) * 100;
    if (peakReturnPct < spec.trailStep.activationPct) {
      fail(`${spec.symbol} peak does not activate its configured trail rung`);
    }
    assertMoney(
      computeProfitRetraceStop({
        entryPrice: spec.entryPrice,
        peakPrice: spec.peakBid,
        retracementPct: spec.trailStep.retracementPct,
        minLockedGainPct: spec.trailStep.minLockedGainPct,
      }),
      spec.stopPrice,
      `${spec.symbol} stop price`,
    );
  }
}

async function validateBaseRows(client: PoolClient): Promise<void> {
  const existing = await client.query(
    "select event_type from execution_events where id = $1::uuid",
    [CORRECTION_ID],
  );
  if (existing.rowCount) {
    fail("The trailing-bid ledger correction is already applied");
  }
  for (const spec of corrections) {
    const position = await client.query<{
      status: string;
      average_cost: string;
      opened_at: Date;
      executable_bid_peak: string | null;
      executable_bid_peak_as_of: Date | null;
    }>(
      `select status, average_cost::text, opened_at,
              executable_bid_peak::text, executable_bid_peak_as_of
         from shadow_positions where id = $1::uuid for update`,
      [spec.positionId],
    );
    if (position.rowCount !== 1) fail(`${spec.symbol} position is missing`);
    const row = position.rows[0]!;
    if (spec.originalExit ? row.status !== "closed" : row.status !== "open") {
      fail(`${spec.symbol} position status changed to ${row.status}`);
    }
    assertMoney(row.average_cost, spec.entryPrice, `${spec.symbol} entry price`);
    if (new Date(row.opened_at).toISOString() !== spec.openedAt) {
      fail(`${spec.symbol} opened_at changed`);
    }
    assertMoney(
      row.executable_bid_peak,
      spec.peakBid,
      `${spec.symbol} executable peak`,
    );
    if (
      !row.executable_bid_peak_as_of ||
      new Date(row.executable_bid_peak_as_of).toISOString() !== spec.peakAt
    ) {
      fail(`${spec.symbol} executable peak timestamp changed`);
    }

    const entryFill = await client.query(
      `select price, quantity, fees from shadow_fills
        where id = $1::uuid and order_id = $2::uuid and source_event_id = $3::uuid`,
      [spec.entryFillId, spec.entryOrderId, spec.entryEventId],
    );
    if (entryFill.rowCount !== 1) fail(`${spec.symbol} entry fill is missing`);
    assertMoney(entryFill.rows[0]!.price, spec.entryPrice, `${spec.symbol} entry fill`);
    assertMoney(entryFill.rows[0]!.quantity, spec.quantity, `${spec.symbol} entry quantity`);
    assertMoney(entryFill.rows[0]!.fees, spec.entryFee, `${spec.symbol} entry fee`);

    if (spec.originalExit) {
      const exitFill = await client.query(
        `select price, cash_delta, realized_pnl, fees, occurred_at
           from shadow_fills
          where id = $1::uuid and order_id = $2::uuid and source_event_id = $3::uuid`,
        [
          spec.originalExit.fillId,
          spec.originalExit.orderId,
          spec.originalExit.eventId,
        ],
      );
      if (exitFill.rowCount !== 1) fail(`${spec.symbol} original exit is missing`);
      const exit = exitFill.rows[0]!;
      assertMoney(exit.price, spec.originalExit.price, `${spec.symbol} old exit price`);
      assertMoney(exit.cash_delta, spec.originalExit.cashDelta, `${spec.symbol} old exit cash`);
      assertMoney(exit.realized_pnl, spec.originalExit.realizedPnl, `${spec.symbol} old exit P&L`);
      assertMoney(exit.fees, spec.originalExit.fees, `${spec.symbol} old exit fee`);
      if (new Date(exit.occurred_at).toISOString() !== spec.originalExit.at) {
        fail(`${spec.symbol} original exit timestamp changed`);
      }
    }
  }
}

function buildReplacementPayload(input: {
  spec: PositionCorrection;
  entryPayload: Record<string, unknown>;
  correctedAt: Date;
}) {
  const { spec, entryPayload, correctedAt } = input;
  const economics = replacementEconomics(spec);
  const exitAt = spec.evidence[1].at;
  const quote = {
    bid: spec.evidence[1].bid,
    ask: spec.evidence[1].ask,
    mark: money((spec.evidence[1].bid + spec.evidence[1].ask) / 2),
    updatedAt: exitAt,
    quoteUpdatedAt: exitAt,
    dataUpdatedAt: exitAt,
    marketDataMode: "historical",
    quoteFreshness: "historical_replay",
  };
  const position =
    entryPayload.position && typeof entryPayload.position === "object"
      ? (entryPayload.position as Record<string, unknown>)
      : {};
  const progressiveTrailStep = {
    activationPct: spec.trailStep.activationPct,
    retracementPct: spec.trailStep.retracementPct,
    // Legacy read compatibility until every historical consumer has migrated.
    givebackPct: spec.trailStep.retracementPct,
    minLockedGainPct: spec.trailStep.minLockedGainPct,
  };
  const stopElection = {
    elected: true,
    source: "double_bid",
    electedAt: exitAt,
    evidenceCount: 2,
    evidence: spec.evidence,
  };
  const stop = {
    hardStopPrice: money(spec.entryPrice * 0.8),
    activeStopPrice: spec.stopPrice,
    activeStopKind: "trailing_stop",
    stopPrice: spec.stopPrice,
    trailActive: true,
    trailStopPrice: spec.stopPrice,
    trailHasTakenOver: true,
    trailRetracementPct: spec.trailStep.retracementPct,
    progressiveTrailStep,
    peakEvidenceSource: "executable_bid",
    exitReason: "runner_trail_stop",
    stopElection,
  };
  return {
    ...entryPayload,
    reason: "runner_trail_stop",
    partial: false,
    exitQuantity: spec.quantity,
    remainingQuantity: null,
    exitPrice: economics.price,
    markPrice: economics.price,
    fillQuoteSource: "massive_historical_replay",
    quoteFreshness: "historical_replay",
    pnl: economics.grossPnl,
    position: {
      ...position,
      peakPrice: spec.peakBid,
      stopPrice: spec.stopPrice,
      lastMarkPrice: economics.price,
      lastMarkedAt: exitAt,
      lastStop: stop,
    },
    selectedContract:
      entryPayload.selectedContract ?? position.selectedContract ?? null,
    quote,
    liquidity: {
      ok: true,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mark,
      mark: quote.mark,
      spread: money(quote.ask - quote.bid),
      spreadPctOfMid:
        quote.mark > 0
          ? ((quote.ask - quote.bid) / quote.mark) * 100
          : null,
      reasons: [],
      marketDataMode: "historical",
      quoteFreshness: "historical_replay",
    },
    stop,
    stopElection,
    ledgerCorrection: {
      ...correctionMetadata(correctedAt, "bid_stop_election_replay"),
      replay: {
        entryPrice: spec.entryPrice,
        peakBid: spec.peakBid,
        peakAt: spec.peakAt,
        stopPrice: spec.stopPrice,
        progressiveTrailStep,
        evidence: spec.evidence,
        exitPrice: economics.price,
      },
    },
  };
}

async function tombstoneOriginalExits(
  client: PoolClient,
  correctedAt: Date,
) {
  const eventIds = corrections.flatMap((spec) =>
    spec.originalExit ? [spec.originalExit.eventId] : [],
  );
  const orderIds = corrections.flatMap((spec) =>
    spec.originalExit ? [spec.originalExit.orderId] : [],
  );
  const metadata = JSON.stringify(
    correctionMetadata(correctedAt, "superseded_exit"),
  );
  if (eventIds.length) {
    const events = await client.query(
      `update execution_events
          set event_type = 'signal_options_ledger_correction_void',
              summary = '[VOIDED BY TRAILING-BID CORRECTION] ' || summary,
              payload = payload || jsonb_build_object('ledgerCorrection', $2::jsonb),
              updated_at = $3
        where id = any($1::uuid[])`,
      [eventIds, metadata, correctedAt],
    );
    if (events.rowCount !== eventIds.length) fail("Original exit event tombstone mismatch");
  }
  if (orderIds.length) {
    const orders = await client.query(
      `update shadow_orders
          set payload = payload || jsonb_build_object(
                'forwardTest', true,
                'ledgerCorrection', $2::jsonb
              ),
              updated_at = $3
        where id = any($1::uuid[])`,
      [orderIds, metadata, correctedAt],
    );
    if (orders.rowCount !== orderIds.length) fail("Original exit order tombstone mismatch");
  }
}

async function insertReplacementExit(
  client: PoolClient,
  spec: PositionCorrection,
  correctedAt: Date,
) {
  const entry = await client.query<{ payload: Record<string, unknown> }>(
    "select payload from execution_events where id = $1::uuid",
    [spec.entryEventId],
  );
  if (entry.rowCount !== 1) fail(`${spec.symbol} entry event is missing`);
  const payload = buildReplacementPayload({
    spec,
    entryPayload: entry.rows[0]!.payload,
    correctedAt,
  });
  const economics = replacementEconomics(spec);
  const selectedContract =
    (payload.selectedContract as Record<string, unknown> | null) ?? null;
  const event = await client.query(
    `insert into execution_events
       (id, deployment_id, provider_account_id, event_type, symbol, summary,
        payload, occurred_at, created_at, updated_at)
     values ($1::uuid, $2::uuid, $3, 'signal_options_shadow_exit', $4, $5,
             $6::jsonb, $7::timestamptz, $8, $8)`,
    [
      spec.replacement.eventId,
      DEPLOYMENT_ID,
      ACCOUNT_ID,
      spec.symbol,
      `${spec.symbol} shadow exit trailing stop at ${economics.price.toFixed(2)}`,
      JSON.stringify(payload),
      spec.evidence[1].at,
      correctedAt,
    ],
  );
  if (event.rowCount !== 1) fail(`${spec.symbol} replacement event insert failed`);
  const order = await client.query(
    `insert into shadow_orders
       (id, account_id, source, source_event_id, client_order_id, symbol,
        asset_class, position_type, side, type, time_in_force, status, quantity,
        filled_quantity, limit_price, stop_price, average_fill_price, fees,
        option_contract, payload, placed_at, filled_at, created_at, updated_at)
     values ($1::uuid, $2, 'automation', $3::uuid, $4, $5,
             'option', 'option', 'sell', 'market', 'day', 'filled', $6, $6,
             $7, $8, $7, $9, $10::jsonb, $11::jsonb,
             $12::timestamptz, $12::timestamptz, $13, $13)`,
    [
      spec.replacement.orderId,
      ACCOUNT_ID,
      spec.replacement.eventId,
      `shadow-ledger-correction-${spec.replacement.eventId}`,
      spec.symbol,
      spec.quantity,
      economics.price,
      spec.stopPrice,
      spec.exitFee,
      JSON.stringify(selectedContract),
      JSON.stringify(payload),
      spec.evidence[1].at,
      correctedAt,
    ],
  );
  if (order.rowCount !== 1) fail(`${spec.symbol} replacement order insert failed`);
  const fill = await client.query(
    `insert into shadow_fills
       (id, account_id, order_id, source_event_id, symbol, asset_class,
        position_type, side, quantity, price, gross_amount, fees, realized_pnl,
        cash_delta, option_contract, occurred_at, created_at, updated_at)
     values ($1::uuid, $2, $3::uuid, $4::uuid, $5, 'option', 'option', 'sell',
             $6, $7, $8, $9, $10, $11, $12::jsonb,
             $13::timestamptz, $14, $14)`,
    [
      spec.replacement.fillId,
      ACCOUNT_ID,
      spec.replacement.orderId,
      spec.replacement.eventId,
      spec.symbol,
      spec.quantity,
      economics.price,
      economics.grossAmount,
      economics.fees,
      economics.realizedPnl,
      economics.cashDelta,
      JSON.stringify(selectedContract),
      spec.evidence[1].at,
      correctedAt,
    ],
  );
  if (fill.rowCount !== 1) fail(`${spec.symbol} replacement fill insert failed`);

  const position = await client.query(
    `update shadow_positions
        set quantity = 0,
            mark = $2,
            market_value = 0,
            unrealized_pnl = 0,
            realized_pnl = $3,
            fees = $4,
            closed_at = $5::timestamptz,
            as_of = $5::timestamptz,
            status = 'closed',
            option_contract = coalesce(option_contract, '{}'::jsonb) ||
              jsonb_build_object('ledgerCorrection', $6::jsonb),
            updated_at = $7
      where id = $1::uuid`,
    [
      spec.positionId,
      economics.price,
      economics.realizedPnl,
      money(spec.entryFee + spec.exitFee),
      spec.evidence[1].at,
      JSON.stringify(correctionMetadata(correctedAt, "corrected_position_close")),
      correctedAt,
    ],
  );
  if (position.rowCount !== 1) fail(`${spec.symbol} position update failed`);
}

async function applyMarkPlans(
  client: PoolClient,
  plans: ReadonlyMap<string, MarkPlan>,
  correctedAt: Date,
) {
  const updates = [...plans.values()].flatMap((plan) => plan.updates);
  const removals = [...plans.values()].flatMap((plan) => plan.removals);
  if (updates.length) {
    const result = await client.query(
      `update shadow_position_marks mark
          set mark = corrected.mark,
              market_value = corrected.market_value,
              unrealized_pnl = corrected.unrealized_pnl,
              source = corrected.source,
              updated_at = $6
         from unnest(
           $1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::text[]
         ) corrected(id, mark, market_value, unrealized_pnl, source)
        where mark.id = corrected.id`,
      [
        updates.map((mark) => mark.id),
        updates.map((mark) => mark.mark),
        updates.map((mark) => mark.marketValue),
        updates.map((mark) => mark.unrealizedPnl),
        updates.map((mark) => mark.source),
        correctedAt,
      ],
    );
    if (result.rowCount !== updates.length) fail("Mark update count mismatch");
  }
  if (removals.length) {
    const result = await client.query(
      "delete from shadow_position_marks where id = any($1::uuid[])",
      [removals.map((mark) => mark.id)],
    );
    if (result.rowCount !== removals.length) fail("Post-exit mark delete mismatch");
  }
  return { updated: updates.length, removed: removals.length };
}

async function tombstonePostExitMarkEvents(
  client: PoolClient,
  correctedAt: Date,
) {
  const ids: string[] = [];
  for (const spec of corrections) {
    const result = await client.query<{ id: string }>(
      `select id::text
         from execution_events
        where deployment_id = $1::uuid
          and event_type = 'signal_options_shadow_mark'
          and symbol = $2
          and occurred_at >= $3::timestamptz
          and occurred_at <= $4
        order by occurred_at, id`,
      [DEPLOYMENT_ID, spec.symbol, spec.evidence[1].at, correctedAt],
    );
    ids.push(...result.rows.map((row) => row.id));
  }
  if (!ids.length) return ids;
  await backupUuidRows(client, "execution_events", ids, correctedAt);
  const result = await client.query(
    `update execution_events
        set event_type = 'signal_options_ledger_correction_void',
            summary = '[VOIDED POST-EXIT MARK] ' || summary,
            payload = payload || jsonb_build_object(
              'ledgerCorrection', $2::jsonb
            ),
            updated_at = $3
      where id = any($1::uuid[])`,
    [
      ids,
      JSON.stringify(correctionMetadata(correctedAt, "mark_after_corrected_exit")),
      correctedAt,
    ],
  );
  if (result.rowCount !== ids.length) fail("Post-exit mark event tombstone mismatch");
  return ids;
}

function snapshotChanged(left: SnapshotRow, right: SnapshotRow) {
  const numericKeys: readonly (keyof Pick<
    SnapshotRow,
    | "cash"
    | "buyingPower"
    | "netLiquidation"
    | "realizedPnl"
    | "unrealizedPnl"
    | "fees"
  >)[] = [
    "cash",
    "buyingPower",
    "netLiquidation",
    "realizedPnl",
    "unrealizedPnl",
    "fees",
  ];
  return numericKeys.some((key) => !nearlyEqual(left[key], right[key]));
}

async function buildSnapshotUpdates(
  client: PoolClient,
  plans: ReadonlyMap<string, MarkPlan>,
) {
  const start = corrections
    .map((spec) => new Date(spec.openedAt).getTime())
    .sort((left, right) => left - right)[0]!;
  const result = await client.query<{
    id: string;
    as_of: Date;
    cash: string;
    buying_power: string;
    net_liquidation: string;
    realized_pnl: string;
    unrealized_pnl: string;
    fees: string;
  }>(
    `select id::text, as_of, cash::text, buying_power::text,
            net_liquidation::text, realized_pnl::text, unrealized_pnl::text,
            fees::text
       from shadow_balance_snapshots
      where account_id = $1
        and as_of >= $2
        and source not in (
          'signal_options_replay',
          'signal_options_replay_mark',
          'watchlist_backtest_mark'
        )
        and source not like 'watchlist_backtest:%'
        and source not like 'watchlist_bt:%'
      order by as_of, id
      for update`,
    [ACCOUNT_ID, new Date(start)],
  );
  return result.rows
    .map((row): SnapshotRow => ({
      id: row.id,
      asOf: new Date(row.as_of),
      cash: numberValue(row.cash),
      buyingPower: numberValue(row.buying_power),
      netLiquidation: numberValue(row.net_liquidation),
      realizedPnl: numberValue(row.realized_pnl),
      unrealizedPnl: numberValue(row.unrealized_pnl),
      fees: numberValue(row.fees),
    }))
    .map((before) => ({ before, after: correctSnapshot({ snapshot: before, plans }) }))
    .filter(({ before, after }) => snapshotChanged(before, after));
}

async function applySnapshotUpdates(
  client: PoolClient,
  updates: Awaited<ReturnType<typeof buildSnapshotUpdates>>,
  correctedAt: Date,
) {
  if (!updates.length) return 0;
  const result = await client.query(
    `update shadow_balance_snapshots snapshot
        set cash = corrected.cash,
            buying_power = corrected.buying_power,
            net_liquidation = corrected.net_liquidation,
            realized_pnl = corrected.realized_pnl,
            unrealized_pnl = corrected.unrealized_pnl,
            fees = corrected.fees,
            updated_at = $8
       from unnest(
         $1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[],
         $5::numeric[], $6::numeric[], $7::numeric[]
       ) corrected(
         id, cash, buying_power, net_liquidation,
         realized_pnl, unrealized_pnl, fees
       )
      where snapshot.id = corrected.id`,
    [
      updates.map(({ after }) => after.id),
      updates.map(({ after }) => after.cash),
      updates.map(({ after }) => after.buyingPower),
      updates.map(({ after }) => after.netLiquidation),
      updates.map(({ after }) => after.realizedPnl),
      updates.map(({ after }) => after.unrealizedPnl),
      updates.map(({ after }) => after.fees),
      correctedAt,
    ],
  );
  if (result.rowCount !== updates.length) fail("Snapshot update count mismatch");
  return updates.length;
}

async function recomputeAccountAndSnapshot(
  client: PoolClient,
  correctedAt: Date,
) {
  const totals = await client.query<{
    cash: string;
    realized_pnl: string;
    fees: string;
  }>(
    `select account.starting_balance + coalesce(sum(fill.cash_delta), 0) as cash,
            coalesce(sum(fill.realized_pnl), 0) as realized_pnl,
            coalesce(sum(fill.fees), 0) as fees
       from shadow_accounts account
       left join shadow_orders orders
         on orders.account_id = account.id
        and lower(coalesce(orders.payload->>'forwardTest', 'false')) <> 'true'
        and coalesce(orders.client_order_id, '') not like 'shadow-equity-forward-%'
       left join shadow_fills fill on fill.order_id = orders.id
      where account.id = $1
      group by account.id, account.starting_balance`,
    [ACCOUNT_ID],
  );
  const row = totals.rows[0]!;
  const cash = numberValue(row.cash);
  const realizedPnl = numberValue(row.realized_pnl);
  const fees = numberValue(row.fees);
  await client.query(
    `update shadow_accounts
        set cash = $2, realized_pnl = $3, fees = $4, updated_at = $5
      where id = $1`,
    [ACCOUNT_ID, cash, realizedPnl, fees, correctedAt],
  );
  const open = await client.query<{
    market_value: string;
    unrealized_pnl: string;
  }>(
    `select coalesce(sum(market_value), 0)::text as market_value,
            coalesce(sum(unrealized_pnl), 0)::text as unrealized_pnl
       from shadow_positions
      where account_id = $1
        and status = 'open'
        and position_key not like 'shadow_equity_forward:%'`,
    [ACCOUNT_ID],
  );
  const marketValue = numberValue(open.rows[0]!.market_value);
  const unrealizedPnl = numberValue(open.rows[0]!.unrealized_pnl);
  const netLiquidation = money(cash + marketValue);
  await client.query(
    `insert into shadow_balance_snapshots
       (account_id, currency, cash, buying_power, net_liquidation,
        realized_pnl, unrealized_pnl, fees, source, as_of,
        created_at, updated_at)
     values ($1, 'USD', $2, greatest($2::numeric, 0), $3, $4, $5, $6,
             'ledger_correction_trailing_bid', $7, $7, $7)`,
    [
      ACCOUNT_ID,
      cash,
      netLiquidation,
      realizedPnl,
      unrealizedPnl,
      fees,
      correctedAt,
    ],
  );
  return { cash, realizedPnl, fees, marketValue, unrealizedPnl, netLiquidation };
}

async function runCorrection(mode: Mode) {
  validateStopConfiguration();
  const quoteTapes = await fetchQuoteTapes();
  const client = await pool.connect();
  const correctedAt = new Date();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`shadow-ledger-correction:${CORRECTION_ID}`],
    );
    await verifyBackupTable(client);
    await client.query(
      `lock table execution_events, shadow_orders, shadow_fills,
        shadow_positions, shadow_position_marks, shadow_balance_snapshots,
        shadow_accounts in share row exclusive mode`,
    );
    await validateBaseRows(client);

    const plans = new Map<string, MarkPlan>();
    for (const spec of corrections) {
      const plan = buildMarkPlan({
        spec,
        marks: await loadMarks(client, spec.positionId),
        quotes: quoteTapes.get(spec.symbol) ?? [],
      });
      if (plan.updates.length !== spec.expectedMarkCorrectionCount) {
        fail(
          `${spec.symbol} expected ${spec.expectedMarkCorrectionCount} mark updates; received ${plan.updates.length}`,
        );
      }
      if (plan.canonicalSha256 !== spec.expectedMarkCorrectionSha256) {
        fail(`${spec.symbol} mark correction evidence hash changed`);
      }
      plans.set(spec.symbol, plan);
    }

    const snapshotUpdates = await buildSnapshotUpdates(client, plans);
    const originalExitEventIds = corrections.flatMap((spec) =>
      spec.originalExit ? [spec.originalExit.eventId] : [],
    );
    const originalExitOrderIds = corrections.flatMap((spec) =>
      spec.originalExit ? [spec.originalExit.orderId] : [],
    );
    const changedMarkIds = [...plans.values()].flatMap((plan) => [
      ...plan.updates.map((mark) => mark.id),
      ...plan.removals.map((mark) => mark.id),
    ]);
    const backupCounts = {
      events: await backupUuidRows(
        client,
        "execution_events",
        originalExitEventIds,
        correctedAt,
      ),
      orders: await backupUuidRows(
        client,
        "shadow_orders",
        originalExitOrderIds,
        correctedAt,
      ),
      positions: await backupUuidRows(
        client,
        "shadow_positions",
        corrections.map((spec) => spec.positionId),
        correctedAt,
      ),
      marks: await backupUuidRows(
        client,
        "shadow_position_marks",
        changedMarkIds,
        correctedAt,
      ),
      snapshots: await backupUuidRows(
        client,
        "shadow_balance_snapshots",
        snapshotUpdates.map(({ before }) => before.id),
        correctedAt,
      ),
      account: await backupAccount(client, correctedAt),
    };

    await tombstoneOriginalExits(client, correctedAt);
    const voidedMarkEventIds = await tombstonePostExitMarkEvents(
      client,
      correctedAt,
    );
    for (const spec of corrections) {
      await insertReplacementExit(client, spec, correctedAt);
    }
    const markCounts = await applyMarkPlans(client, plans, correctedAt);
    const snapshotCount = await applySnapshotUpdates(
      client,
      snapshotUpdates,
      correctedAt,
    );

    const beforeAccount = await client.query(
      `select row_data from shadow_ledger_correction_backups
        where correction_id = $1::uuid
          and table_name = 'shadow_accounts'
          and row_id = $2`,
      [CORRECTION_ID, ACCOUNT_ID],
    );
    const after = await recomputeAccountAndSnapshot(client, correctedAt);
    const correctionPayload = {
      correctionId: CORRECTION_ID,
      status: "applied",
      reason:
        "long-option marks, trailing-stop election, and sell fills used inconsistent market sides",
      correctedAt: correctedAt.toISOString(),
      policy: {
        valuation: "executable_bid",
        peak: "executable_bid",
        stopElection: "double_bid",
        sellFill: "executable_bid",
        trailFormula: "entry_plus_profit_times_one_minus_retracement",
      },
      positions: corrections.map((spec) => ({
        symbol: spec.symbol,
        ticker: spec.ticker,
        positionId: spec.positionId,
        entryPrice: spec.entryPrice,
        peakBid: spec.peakBid,
        peakAt: spec.peakAt,
        stopPrice: spec.stopPrice,
        evidence: spec.evidence,
        replacement: {
          ...spec.replacement,
          ...replacementEconomics(spec),
          exitAt: spec.evidence[1].at,
        },
        supersededExit: spec.originalExit,
        markUpdates: plans.get(spec.symbol)!.updates.length,
        markRemovals: plans.get(spec.symbol)!.removals.length,
        markEvidenceSha256: plans.get(spec.symbol)!.canonicalSha256,
      })),
      voidedPostExitMarkEventIds: voidedMarkEventIds,
      snapshotUpdates: snapshotCount,
      backupCounts,
      beforeAccount: beforeAccount.rows[0]?.row_data ?? null,
      after,
    };
    const correctionEvent = await client.query(
      `insert into execution_events
         (id, deployment_id, provider_account_id, event_type, summary, payload,
          occurred_at, created_at, updated_at)
       values ($1::uuid, $2::uuid, $3, 'signal_options_ledger_correction',
               $4, $5::jsonb, $6, $6, $6)`,
      [
        CORRECTION_ID,
        DEPLOYMENT_ID,
        ACCOUNT_ID,
        "Corrected ABT, AA, and COF trailing-stop ledgers to executable-bid semantics",
        JSON.stringify(correctionPayload),
        correctedAt,
      ],
    );
    if (correctionEvent.rowCount !== 1) fail("Correction audit event insert failed");

    const remaining = await client.query<{ count: number }>(
      `select count(*)::int as count
         from shadow_position_marks mark
         join (values
           ($1::uuid, $2::timestamptz),
           ($3::uuid, $4::timestamptz),
           ($5::uuid, $6::timestamptz)
         ) target(position_id, exit_at)
           on target.position_id = mark.position_id
        where mark.as_of >= target.exit_at`,
      corrections.flatMap((spec) => [spec.positionId, spec.evidence[1].at]),
    );
    if (remaining.rows[0]!.count !== 0) fail("Post-exit marks remain");

    const report = {
      mode,
      correctionId: CORRECTION_ID,
      correctedAt: correctedAt.toISOString(),
      markCounts,
      snapshotCount,
      voidedPostExitMarkEvents: voidedMarkEventIds.length,
      backupCounts,
      outcomes: corrections.map((spec) => ({
        symbol: spec.symbol,
        stopPrice: spec.stopPrice,
        exitAt: spec.evidence[1].at,
        ...replacementEconomics(spec),
      })),
      after,
    };
    if (mode === "apply") {
      await client.query("commit");
    } else {
      await client.query("rollback");
    }
    return report;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const __trailingBidCorrectionInternals = {
  CORRECTION_ID,
  corrections,
  buildMarkPlan,
  computeProfitRetraceStop,
  correctSnapshot,
  findEarliestBidConfirmation,
  readMode,
  replacementEconomics,
};

async function main() {
  const report = await runCorrection(readMode());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main()
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
