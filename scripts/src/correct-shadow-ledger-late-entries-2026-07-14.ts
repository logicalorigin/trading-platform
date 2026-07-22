import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

import { recomputeAccountAndSnapshot } from "./correct-shadow-ledger-2026-07-15";

const CORRECTION_ID = "617e750e-3d35-4e0d-8394-1582a4404379";
const ACCOUNT_ID = "shadow";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const FORWARD_POSITION_PREFIX =
  `shadow_equity_forward:ledger_correction:${CORRECTION_ID}:`;
const BABA_MARK_EVENT_COUNT = 133;
const BABA_MARK_EVENT_ID_SHA256 =
  "dd3b6bc575277bbf471ccbe8047c31692096ffeb7a9c093fb9d2f47edef83242";
const PHYSICAL_MARK_COUNT = 236;
const PHYSICAL_MARK_ID_SHA256 =
  "94c30aca665e2e1b35084b08084be6b430c9ac34b2a1271584f9d18e6f72be7c";
const INVALID_BABA_POSITION_ID = "c829a4a8-7763-4303-a494-0063777e72d3";
const INVALID_BABA_POSITION_KEY =
  `${FORWARD_POSITION_PREFIX}invalid_lifecycle:option:BABA:2026-07-17:112:call:O:BABA260717C00112000`;
const INVALID_BABA_PHYSICAL_MARK_COUNT = 228;
const INVALID_BABA_PHYSICAL_MARK_ID_SHA256 =
  "b5ee9da75b34d58b96903699331fd116ee311ea56076127e04b0fc11bf210411";

type Mode = "dry-run" | "apply";
type PositionStrategy =
  | "tombstone_unique"
  | "subtract_reused"
  | "restore_prior";

type Leg = {
  eventId: string;
  orderId: string;
  fillId: string;
  side: "buy" | "sell";
  occurredAt: string;
  price: number;
  grossAmount: number;
  fees: number;
  realizedPnl: number;
  cashDelta: number;
};

type Lifecycle = {
  symbol: string;
  candidateId: string;
  ticker: string;
  quantity: number;
  positionId: string;
  positionKey: string;
  positionStrategy: PositionStrategy;
  entry: Leg;
  exit: Leg;
  recorded: { cashDelta: number; realizedPnl: number; fees: number };
};

const LIFECYCLES: readonly Lifecycle[] = [
  {
    symbol: "BABA",
    candidateId: "SIGOPT-7e2e4e6f-BABA-buy-1784057400000",
    ticker: "O:BABA260717C00111000",
    quantity: 5,
    positionId: "748081e9-d8c7-4a86-ba62-d23ce5706e06",
    positionKey: "option:BABA:2026-07-17:111:call:O:BABA260717C00111000",
    positionStrategy: "tombstone_unique",
    entry: {
      eventId: "17fa3210-e5e0-44a1-ae01-a6b90025268d",
      orderId: "27f752a7-d44f-4c98-b08a-6418ba7564aa",
      fillId: "3946f0b6-97fa-451d-a23a-f3ed95eda765",
      side: "buy",
      occurredAt: "2026-07-14T19:45:14.615Z",
      price: 2.95,
      grossAmount: 1475,
      fees: 3.36,
      realizedPnl: 0,
      cashDelta: -1478.36,
    },
    exit: {
      eventId: "8575afef-fb97-45b1-bd41-8703ce7aa288",
      orderId: "5ddcea3f-a37a-4a89-a914-c9ec6ad44c45",
      fillId: "3d8cce96-0631-4e82-8334-bfeaef081f87",
      side: "sell",
      occurredAt: "2026-07-14T19:55:01.211Z",
      price: 3.01,
      grossAmount: 1505,
      fees: 3.36,
      realizedPnl: 26.64,
      cashDelta: 1501.64,
    },
    recorded: { cashDelta: 23.28, realizedPnl: 26.64, fees: 6.72 },
  },
  {
    symbol: "A",
    candidateId: "SIGOPT-7e2e4e6f-A-buy-1784058600000",
    ticker: "O:A260717C00135000",
    quantity: 7,
    positionId: "2ee94c8f-b2c1-4d07-b949-073776f04dbc",
    positionKey: "option:A:2026-07-17:135:call:O:A260717C00135000",
    positionStrategy: "tombstone_unique",
    entry: {
      eventId: "21e10d9b-2e1a-4bbd-b960-7d3bd5afbcd5",
      orderId: "973d4f39-3ea3-4eb1-9c40-ed888c306fbb",
      fillId: "c5ecf8cb-05c9-4a1d-9c00-d08bcc822ae1",
      side: "buy",
      occurredAt: "2026-07-14T19:50:12.581Z",
      price: 2.13,
      grossAmount: 1491,
      fees: 4.71,
      realizedPnl: 0,
      cashDelta: -1495.71,
    },
    exit: {
      eventId: "9e08c2a5-0664-4c83-8e73-2e356450a640",
      orderId: "b000295e-17b7-4dc6-ab28-3ad609e965cd",
      fillId: "bd2f937e-4c4d-40da-8ff3-f98a8d64ad0c",
      side: "sell",
      occurredAt: "2026-07-14T19:50:23.999Z",
      price: 1.86,
      grossAmount: 1302,
      fees: 4.71,
      realizedPnl: -193.71,
      cashDelta: 1297.29,
    },
    recorded: { cashDelta: -198.42, realizedPnl: -193.71, fees: 9.42 },
  },
  {
    symbol: "BA",
    candidateId: "SIGOPT-7e2e4e6f-BA-buy-1784058900000",
    ticker: "O:BA260717C00205000",
    quantity: 1,
    positionId: "189539ef-9871-4405-8225-1a273c651147",
    positionKey: "option:BA:2026-07-17:205:call:O:BA260717C00205000",
    positionStrategy: "subtract_reused",
    entry: {
      eventId: "b14fafb1-2dda-4cd4-8839-4f067197cd25",
      orderId: "55f41a72-c1ce-466f-9fc1-59d4c8a42196",
      fillId: "e72b882f-0acb-4b07-a2e9-7d98c2b513dc",
      side: "buy",
      occurredAt: "2026-07-14T19:55:20.549Z",
      price: 14.15,
      grossAmount: 1415,
      fees: 0.67,
      realizedPnl: 0,
      cashDelta: -1415.67,
    },
    exit: {
      eventId: "8db3a29e-d4fa-4131-b62a-1efcc73cf239",
      orderId: "82fe1fd7-9269-4405-ab37-f9aa85fb4a22",
      fillId: "2bac321b-f84e-4d81-959c-3f9c64ab2dae",
      side: "sell",
      occurredAt: "2026-07-14T19:55:25.728Z",
      price: 12.4,
      grossAmount: 1240,
      fees: 0.67,
      realizedPnl: -175.67,
      cashDelta: 1239.33,
    },
    recorded: { cashDelta: -176.34, realizedPnl: -175.67, fees: 1.34 },
  },
  {
    symbol: "BABA",
    candidateId: "SIGOPT-7e2e4e6f-BABA-buy-1784058600000",
    ticker: "O:BABA260717C00112000",
    quantity: 5,
    positionId: "70cd8386-4c23-48aa-b1da-756ebc3bd827",
    positionKey: "option:BABA:2026-07-17:112:call:O:BABA260717C00112000",
    positionStrategy: "restore_prior",
    entry: {
      eventId: "b6abb7ea-3699-4ea0-884f-14f8af953a8d",
      orderId: "beb18f2f-d38d-4e70-9822-2635bd7c9094",
      fillId: "bdaa76d3-b5cb-444c-a100-a3e3cf227d0b",
      side: "buy",
      occurredAt: "2026-07-14T19:55:23.917Z",
      price: 2.55,
      grossAmount: 1275,
      fees: 3.36,
      realizedPnl: 0,
      cashDelta: -1278.36,
    },
    exit: {
      eventId: "be20f596-c2a9-47d5-aa28-235a29da4b96",
      orderId: "f07a5f8e-a0a5-4f05-ae8b-9f4b652fd9d4",
      fillId: "4444e2bc-415e-4910-96d6-baac55f63e92",
      side: "sell",
      occurredAt: "2026-07-15T14:26:49.046Z",
      price: 7.8,
      grossAmount: 3900,
      fees: 3.36,
      realizedPnl: 2621.64,
      cashDelta: 3896.64,
    },
    recorded: { cashDelta: 2618.28, realizedPnl: 2621.64, fees: 6.72 },
  },
] as const;

const RETAINED_BABA_LIFECYCLE = {
  symbol: "BABA",
  candidateId: "SIGOPT-7e2e4e6f-BABA-buy-1784042100000",
  ticker: "O:BABA260717C00112000",
  quantity: 5,
  entry: {
    eventId: "38ee4681-77d4-4300-9382-8c62623725fc",
    orderId: "0f4edfea-a487-407a-a146-b103cf6a9c56",
    fillId: "30414e9d-14d2-4bd1-96a7-37d332f8ced3",
    side: "buy",
    occurredAt: "2026-07-14T15:51:27.732Z",
    price: 2.74,
    grossAmount: 1370,
    fees: 3.36,
    realizedPnl: 0,
    cashDelta: -1373.36,
  },
  exit: {
    eventId: "94538e0f-66eb-497c-98d5-f677848ef2ec",
    orderId: "6e665167-8969-45f8-9065-a161d36746f1",
    fillId: "02c8d498-1e79-4d07-a66f-6d159f9bcf62",
    side: "sell",
    occurredAt: "2026-07-14T19:45:01.020Z",
    price: 2.32,
    grossAmount: 1160,
    fees: 3.36,
    realizedPnl: -213.36,
    cashDelta: 1156.64,
  },
} as const;

const POSITION_BEFORE = {
  "748081e9-d8c7-4a86-ba62-d23ce5706e06": {
    averageCost: 2.95,
    mark: 3.01,
    realizedPnl: 26.64,
    fees: 6.72,
    openedAt: "2026-07-14T19:45:14.615Z",
    closedAt: "2026-07-14T19:55:01.211Z",
  },
  "2ee94c8f-b2c1-4d07-b949-073776f04dbc": {
    averageCost: 2.13,
    mark: 1.86,
    realizedPnl: -193.71,
    fees: 9.42,
    openedAt: "2026-07-14T19:50:12.581Z",
    closedAt: "2026-07-14T19:50:23.999Z",
  },
  "189539ef-9871-4405-8225-1a273c651147": {
    averageCost: 14.89,
    mark: 12.96,
    realizedPnl: -369.34,
    fees: 2.68,
    openedAt: "2026-07-15T17:21:12.573Z",
    closedAt: "2026-07-15T19:45:06.712Z",
  },
  "70cd8386-4c23-48aa-b1da-756ebc3bd827": {
    averageCost: 2.55,
    mark: 7.8,
    realizedPnl: 2408.28,
    fees: 13.44,
    openedAt: "2026-07-14T19:55:23.917Z",
    closedAt: "2026-07-15T14:26:49.046Z",
  },
} as const;

const RETAINED_CONTRACT_FILL_IDS: Record<string, readonly string[]> = {
  "O:BABA260717C00111000": [],
  "O:A260717C00135000": [],
  "O:BA260717C00205000": [
    "39897823-1f38-433b-9807-a39e05e9ed75",
    "4d4f371d-3cf6-454a-9d6a-8c23ab24266e",
  ],
  "O:BABA260717C00112000": [
    RETAINED_BABA_LIFECYCLE.entry.fillId,
    RETAINED_BABA_LIFECYCLE.exit.fillId,
  ],
};

const EXPECTED_BEFORE = {
  cash: 157217.4755,
  realizedPnl: 133020.9755,
  fees: 5481.08,
} as const;
const EXPECTED_AFTER = {
  cash: 154950.6755,
  realizedPnl: 130742.0755,
  fees: 5456.88,
} as const;

function mode(): Mode {
  const value = process.env.SHADOW_LEDGER_CORRECTION_MODE?.trim() || "dry-run";
  if (value !== "dry-run" && value !== "apply") {
    throw new Error("SHADOW_LEDGER_CORRECTION_MODE must be dry-run or apply.");
  }
  return value;
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite.`);
  return parsed;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function money(actual: unknown, expected: number, label: string): void {
  if (Math.abs(finite(actual, label) - expected) > 0.000001) {
    throw new Error(`${label}: expected ${expected.toFixed(6)}, got ${String(actual)}.`);
  }
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid timestamp ${String(value)}.`);
  return parsed.toISOString();
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate identifiers.`);
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function idHash(ids: readonly string[]): string {
  return createHash("sha256").update(`${[...ids].sort().join("\n")}\n`).digest("hex");
}

function validatePlan() {
  const legs = LIFECYCLES.flatMap((item) => [item.entry, item.exit]);
  const retainedLegs = [
    RETAINED_BABA_LIFECYCLE.entry,
    RETAINED_BABA_LIFECYCLE.exit,
  ];
  unique([...legs, ...retainedLegs].map((item) => item.eventId), "event ids");
  unique([...legs, ...retainedLegs].map((item) => item.orderId), "order ids");
  unique([...legs, ...retainedLegs].map((item) => item.fillId), "fill ids");
  unique(LIFECYCLES.map((item) => item.positionId), "position ids");

  for (const lifecycle of LIFECYCLES) {
    for (const leg of [lifecycle.entry, lifecycle.exit]) {
      money(
        leg.grossAmount,
        leg.price * lifecycle.quantity * 100,
        `${lifecycle.candidateId} ${leg.side} gross amount`,
      );
      money(
        leg.cashDelta,
        leg.side === "buy"
          ? -leg.grossAmount - leg.fees
          : leg.grossAmount - leg.fees,
        `${lifecycle.candidateId} ${leg.side} cash delta`,
      );
    }
    money(
      lifecycle.exit.realizedPnl,
      (lifecycle.exit.price - lifecycle.entry.price) * lifecycle.quantity * 100 -
        lifecycle.exit.fees,
      `${lifecycle.candidateId} exit realized P&L`,
    );
    money(
      lifecycle.recorded.cashDelta,
      lifecycle.entry.cashDelta + lifecycle.exit.cashDelta,
      `${lifecycle.candidateId} lifecycle cash`,
    );
    money(
      lifecycle.recorded.realizedPnl,
      lifecycle.entry.realizedPnl + lifecycle.exit.realizedPnl,
      `${lifecycle.candidateId} lifecycle realized P&L`,
    );
    money(
      lifecycle.recorded.fees,
      lifecycle.entry.fees + lifecycle.exit.fees,
      `${lifecycle.candidateId} lifecycle fees`,
    );
  }
  for (const leg of retainedLegs) {
    money(
      leg.grossAmount,
      leg.price * RETAINED_BABA_LIFECYCLE.quantity * 100,
      `retained BABA ${leg.side} gross amount`,
    );
    money(
      leg.cashDelta,
      leg.side === "buy"
        ? -leg.grossAmount - leg.fees
        : leg.grossAmount - leg.fees,
      `retained BABA ${leg.side} cash delta`,
    );
  }
  money(
    RETAINED_BABA_LIFECYCLE.exit.realizedPnl,
    (RETAINED_BABA_LIFECYCLE.exit.price -
      RETAINED_BABA_LIFECYCLE.entry.price) *
      RETAINED_BABA_LIFECYCLE.quantity *
      100 -
      RETAINED_BABA_LIFECYCLE.exit.fees,
    "retained BABA realized P&L",
  );

  const recorded = LIFECYCLES.reduce(
    (sum, item) => ({
      cash: sum.cash + item.recorded.cashDelta,
      realized: sum.realized + item.recorded.realizedPnl,
      fees: sum.fees + item.recorded.fees,
    }),
    { cash: 0, realized: 0, fees: 0 },
  );
  money(EXPECTED_AFTER.cash, EXPECTED_BEFORE.cash - recorded.cash, "after cash");
  money(
    EXPECTED_AFTER.realizedPnl,
    EXPECTED_BEFORE.realizedPnl - recorded.realized,
    "after realized P&L",
  );
  money(EXPECTED_AFTER.fees, EXPECTED_BEFORE.fees - recorded.fees, "after fees");
  return {
    eventCount: legs.length,
    orderCount: legs.length,
    fillCount: legs.length,
    retainedEventCount: retainedLegs.length,
    retainedOrderCount: retainedLegs.length,
    retainedFillCount: retainedLegs.length,
    invalidBabaPhysicalMarkCount: INVALID_BABA_PHYSICAL_MARK_COUNT,
    recordedCashDelta: roundMoney(recorded.cash),
    recordedRealizedPnl: roundMoney(recorded.realized),
    recordedFees: roundMoney(recorded.fees),
    correctionCashDelta: roundMoney(-recorded.cash),
    correctionRealizedPnlDelta: roundMoney(-recorded.realized),
    correctionFeesDelta: roundMoney(-recorded.fees),
  };
}

type EventRow = {
  id: string;
  symbol: string;
  event_type: string;
  occurred_at: Date;
  candidate_id: string | null;
  ticker: string | null;
  entry_price: string | null;
  exit_price: string | null;
  quantity: string | null;
  correction_id: string | null;
};

type OrderRow = {
  order_id: string;
  order_event_id: string | null;
  order_source: string;
  order_status: string;
  order_symbol: string;
  order_side: string;
  order_quantity: string;
  filled_quantity: string;
  limit_price: string | null;
  average_fill_price: string | null;
  order_fees: string;
  placed_at: Date;
  filled_at: Date | null;
  forward_test: string | null;
  order_correction_id: string | null;
};

type FillRow = {
  fill_id: string;
  order_id: string;
  fill_event_id: string | null;
  fill_symbol: string;
  fill_side: string;
  fill_quantity: string;
  fill_price: string;
  gross_amount: string;
  fill_fees: string;
  realized_pnl: string;
  cash_delta: string;
  fill_at: Date;
  ticker: string | null;
};

type EconomicLifecycle = Pick<
  Lifecycle,
  "symbol" | "candidateId" | "ticker" | "quantity" | "entry" | "exit"
>;

type EconomicCensus = {
  orderIds: string[];
  fillIds: string[];
  byEvent: Map<string, { order: OrderRow; fill: FillRow }>;
};

type PositionRow = {
  id: string;
  position_key: string;
  symbol: string;
  status: string;
  quantity: string;
  average_cost: string;
  mark: string | null;
  market_value: string | null;
  unrealized_pnl: string;
  realized_pnl: string;
  fees: string;
  opened_at: Date;
  closed_at: Date | null;
  as_of: Date;
  ticker: string | null;
  correction_id: string | null;
};

type PhysicalMarkRow = {
  id: string;
  position_id: string;
  mark: string;
  source: string;
  as_of: Date;
};

async function accountTotals(client: PoolClient, lock = false) {
  const result = await client.query<{
    cash: string;
    realized_pnl: string;
    fees: string;
  }>(
    `select cash::text, realized_pnl::text, fees::text
       from shadow_accounts where id = $1${lock ? " for update" : ""}`,
    [ACCOUNT_ID],
  );
  equal(result.rowCount, 1, "shadow account row count");
  return {
    cash: finite(result.rows[0]!.cash, "account cash"),
    realizedPnl: finite(result.rows[0]!.realized_pnl, "account realized P&L"),
    fees: finite(result.rows[0]!.fees, "account fees"),
  };
}

async function validateAccountBefore(client: PoolClient) {
  const account = await accountTotals(client, true);
  const folded = await client.query<{
    cash: string;
    realized_pnl: string;
    fees: string;
  }>(
    `select a.starting_balance + coalesce(sum(f.cash_delta), 0) as cash,
            coalesce(sum(f.realized_pnl), 0) as realized_pnl,
            coalesce(sum(f.fees), 0) as fees
       from shadow_accounts a
       left join shadow_orders o
         on o.account_id = a.id
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and coalesce(o.client_order_id, '') not like 'shadow-equity-forward-%'
       left join shadow_fills f on f.order_id = o.id
      where a.id = $1
      group by a.id`,
    [ACCOUNT_ID],
  );
  equal(folded.rowCount, 1, "folded account row count");
  const ledger = {
    cash: finite(folded.rows[0]!.cash, "folded cash"),
    realizedPnl: finite(folded.rows[0]!.realized_pnl, "folded realized P&L"),
    fees: finite(folded.rows[0]!.fees, "folded fees"),
  };
  for (const key of ["cash", "realizedPnl", "fees"] as const) {
    money(account[key], ledger[key], `${key} account/fold parity`);
    money(account[key], EXPECTED_BEFORE[key], `expected before ${key}`);
  }
  return account;
}

function plannedLegs(lifecycles: readonly EconomicLifecycle[]) {
  return lifecycles.flatMap((lifecycle) =>
    [lifecycle.entry, lifecycle.exit].map((leg) => ({ lifecycle, leg })),
  );
}

async function validateLifecycleEvents(
  client: PoolClient,
  lifecycles: readonly EconomicLifecycle[],
  label: string,
) {
  const legs = plannedLegs(lifecycles);
  const result = await client.query<EventRow>(
    `select id::text, symbol, event_type, occurred_at,
            payload->'position'->>'candidateId' as candidate_id,
            coalesce(payload->'selectedContract'->>'ticker',
                     payload#>>'{position,selectedContract,ticker}') as ticker,
            payload#>>'{position,entryPrice}' as entry_price,
            payload->>'exitPrice' as exit_price,
            payload#>>'{position,quantity}' as quantity,
            payload#>>'{ledgerCorrection,id}' as correction_id
       from execution_events
      where id = any($1::uuid[])
      for update`,
    [legs.map(({ leg }) => leg.eventId)],
  );
  equal(result.rowCount, legs.length, `${label} event row count`);
  const rows = new Map(result.rows.map((row) => [row.id, row]));
  for (const { lifecycle, leg } of legs) {
    const row = rows.get(leg.eventId);
    if (!row) throw new Error(`Missing event ${leg.eventId}.`);
    equal(row.symbol, lifecycle.symbol, `${leg.eventId} symbol`);
    equal(
      row.event_type,
      leg.side === "buy"
        ? "signal_options_shadow_entry"
        : "signal_options_shadow_exit",
      `${leg.eventId} type`,
    );
    equal(row.candidate_id, lifecycle.candidateId, `${leg.eventId} candidate`);
    equal(row.ticker, lifecycle.ticker, `${leg.eventId} ticker`);
    equal(iso(row.occurred_at), leg.occurredAt, `${leg.eventId} occurredAt`);
    money(row.quantity, lifecycle.quantity, `${leg.eventId} quantity`);
    money(
      leg.side === "buy" ? row.entry_price : row.exit_price,
      leg.price,
      `${leg.eventId} price`,
    );
    equal(row.correction_id, null, `${leg.eventId} prior correction`);
  }
}

async function validateEconomicRows(
  client: PoolClient,
  lifecycles: readonly EconomicLifecycle[],
  label: string,
): Promise<EconomicCensus> {
  const legs = plannedLegs(lifecycles);
  const eventIds = legs.map(({ leg }) => leg.eventId);
  const orders = await client.query<OrderRow>(
    `select o.id::text as order_id, o.source_event_id::text as order_event_id,
            o.source as order_source, o.status as order_status,
            o.symbol as order_symbol, o.side::text as order_side,
            o.quantity::text as order_quantity,
            o.filled_quantity::text as filled_quantity,
            o.limit_price::text, o.average_fill_price::text,
            o.fees::text as order_fees, o.placed_at, o.filled_at,
            o.payload->>'forwardTest' as forward_test,
            o.payload#>>'{ledgerCorrection,id}' as order_correction_id
       from shadow_orders o
      where o.source_event_id = any($1::uuid[])
      order by o.id
      for update`,
    [eventIds],
  );
  equal(orders.rowCount, legs.length, `${label} source-event order census`);
  const orderIds = orders.rows.map((row) => row.order_id);
  assertStringArrayEqual(
    orderIds,
    legs.map(({ leg }) => leg.orderId),
    `${label} planned order ids`,
  );

  const fills = await client.query<FillRow>(
    `select f.id::text as fill_id, f.order_id::text as order_id,
            f.source_event_id::text as fill_event_id,
            f.symbol as fill_symbol, f.side::text as fill_side,
            f.quantity::text as fill_quantity, f.price::text as fill_price,
            f.gross_amount::text, f.fees::text as fill_fees,
            f.realized_pnl::text, f.cash_delta::text, f.occurred_at as fill_at,
            f.option_contract->>'ticker' as ticker
       from shadow_fills f
      where f.source_event_id = any($1::uuid[])
         or f.order_id = any($2::uuid[])
      order by f.id
      for update`,
    [eventIds, orderIds],
  );
  equal(fills.rowCount, legs.length, `${label} source-event fill census`);
  assertStringArrayEqual(
    fills.rows.map((row) => row.fill_id),
    legs.map(({ leg }) => leg.fillId),
    `${label} planned fill ids`,
  );

  const byEvent = new Map<string, { order: OrderRow; fill: FillRow }>();
  for (const { lifecycle, leg } of legs) {
    const eventOrders = orders.rows.filter(
      (row) => row.order_event_id === leg.eventId,
    );
    equal(eventOrders.length, 1, `${leg.eventId} order count`);
    const order = eventOrders[0]!;
    equal(order.order_id, leg.orderId, `${leg.eventId} planned order`);
    equal(order.order_source, "automation", `${leg.orderId} source`);
    equal(order.order_status, "filled", `${leg.orderId} status`);
    equal(order.order_symbol, lifecycle.symbol, `${leg.orderId} order symbol`);
    equal(order.order_side, leg.side, `${leg.orderId} order side`);
    money(order.order_quantity, lifecycle.quantity, `${leg.orderId} quantity`);
    money(
      order.filled_quantity,
      lifecycle.quantity,
      `${leg.orderId} filled quantity`,
    );
    money(order.limit_price, leg.price, `${leg.orderId} limit price`);
    money(order.average_fill_price, leg.price, `${leg.orderId} average price`);
    money(order.order_fees, leg.fees, `${leg.orderId} order fees`);
    equal(iso(order.placed_at), leg.occurredAt, `${leg.orderId} placedAt`);
    equal(iso(order.filled_at!), leg.occurredAt, `${leg.orderId} filledAt`);
    if (order.forward_test?.toLowerCase() === "true") {
      throw new Error(`${leg.orderId} is already forwardTest.`);
    }
    equal(order.order_correction_id, null, `${leg.orderId} prior correction`);

    const eventFills = fills.rows.filter(
      (row) => row.fill_event_id === leg.eventId,
    );
    const orderFills = fills.rows.filter(
      (row) => row.order_id === order.order_id,
    );
    equal(eventFills.length, 1, `${leg.eventId} fill count`);
    equal(orderFills.length, 1, `${leg.orderId} fill count`);
    const fill = eventFills[0]!;
    equal(fill.fill_id, orderFills[0]!.fill_id, `${leg.eventId} event/order fill`);
    equal(fill.fill_id, leg.fillId, `${leg.eventId} planned fill`);
    equal(fill.order_id, order.order_id, `${leg.fillId} order`);
    equal(fill.fill_symbol, lifecycle.symbol, `${leg.fillId} symbol`);
    equal(fill.fill_side, leg.side, `${leg.fillId} side`);
    equal(fill.ticker, lifecycle.ticker, `${leg.fillId} ticker`);
    money(fill.fill_quantity, lifecycle.quantity, `${leg.fillId} quantity`);
    money(fill.fill_price, leg.price, `${leg.fillId} price`);
    money(fill.gross_amount, leg.grossAmount, `${leg.fillId} gross amount`);
    money(fill.fill_fees, leg.fees, `${leg.fillId} fees`);
    money(fill.realized_pnl, leg.realizedPnl, `${leg.fillId} realized P&L`);
    money(fill.cash_delta, leg.cashDelta, `${leg.fillId} cash delta`);
    equal(iso(fill.fill_at), leg.occurredAt, `${leg.fillId} occurredAt`);
    byEvent.set(leg.eventId, { order, fill });
  }
  equal(byEvent.size, legs.length, `${label} one-to-one economic census`);
  return {
    orderIds,
    fillIds: fills.rows.map((row) => row.fill_id),
    byEvent,
  };
}

type ClosedLifecycleState = {
  quantity: number;
  averageCost: number;
  mark: number;
  realizedPnl: number;
  fees: number;
  openedAt: string;
  closedAt: string;
};

function deriveClosedLifecycleState(
  census: EconomicCensus,
  lifecycle: EconomicLifecycle,
): ClosedLifecycleState {
  const entry = census.byEvent.get(lifecycle.entry.eventId)?.fill;
  const exit = census.byEvent.get(lifecycle.exit.eventId)?.fill;
  if (!entry || !exit) {
    throw new Error(`Incomplete validated lifecycle ${lifecycle.candidateId}.`);
  }
  const quantity =
    finite(entry.fill_quantity, `${entry.fill_id} quantity`) -
    finite(exit.fill_quantity, `${exit.fill_id} quantity`);
  money(quantity, 0, `${lifecycle.candidateId} remaining quantity`);
  return {
    quantity,
    averageCost: finite(entry.fill_price, `${entry.fill_id} price`),
    mark: finite(exit.fill_price, `${exit.fill_id} price`),
    realizedPnl:
      finite(entry.realized_pnl, `${entry.fill_id} realized P&L`) +
      finite(exit.realized_pnl, `${exit.fill_id} realized P&L`),
    fees:
      finite(entry.fill_fees, `${entry.fill_id} fees`) +
      finite(exit.fill_fees, `${exit.fill_id} fees`),
    openedAt: iso(entry.fill_at),
    closedAt: iso(exit.fill_at),
  };
}

async function validateMarkEvents(client: PoolClient) {
  const lifecycle = LIFECYCLES.find(
    (item) => item.positionStrategy === "restore_prior",
  )!;
  const result = await client.query<EventRow>(
    `select id::text, symbol, event_type, occurred_at,
            payload->'position'->>'candidateId' as candidate_id,
            coalesce(payload->'selectedContract'->>'ticker',
                     payload#>>'{position,selectedContract,ticker}') as ticker,
            null::text as entry_price, null::text as exit_price,
            payload#>>'{position,quantity}' as quantity,
            payload#>>'{ledgerCorrection,id}' as correction_id
       from execution_events
      where deployment_id = $1::uuid
        and event_type = 'signal_options_shadow_mark'
        and payload#>>'{position,candidateId}' = $2
      order by id
      for update`,
    [DEPLOYMENT_ID, lifecycle.candidateId],
  );
  equal(result.rowCount, BABA_MARK_EVENT_COUNT, "BABA mark event count");
  equal(
    idHash(result.rows.map((row) => row.id)),
    BABA_MARK_EVENT_ID_SHA256,
    "BABA mark event id hash",
  );
  for (const row of result.rows) {
    equal(row.symbol, lifecycle.symbol, `${row.id} mark symbol`);
    equal(row.event_type, "signal_options_shadow_mark", `${row.id} mark type`);
    equal(row.candidate_id, lifecycle.candidateId, `${row.id} mark candidate`);
    equal(row.ticker, lifecycle.ticker, `${row.id} mark ticker`);
    money(row.quantity, lifecycle.quantity, `${row.id} mark quantity`);
    equal(row.correction_id, null, `${row.id} prior correction`);
    const at = row.occurred_at.getTime();
    if (
      at <= Date.parse(lifecycle.entry.occurredAt) ||
      at >= Date.parse(lifecycle.exit.occurredAt)
    ) {
      throw new Error(`${row.id} is outside the invalid lifecycle.`);
    }
  }
  const chronological = [...result.rows].sort(
    (a, b) => a.occurred_at.getTime() - b.occurred_at.getTime() || a.id.localeCompare(b.id),
  );
  equal(
    chronological[0]!.id,
    "1eac7a12-7545-4621-a1b3-1bc1d4ae6cf1",
    "first BABA mark event",
  );
  equal(
    chronological.at(-1)!.id,
    "ef3ee577-4702-40ee-8cb4-fb07f407e1f8",
    "last BABA mark event",
  );
  return result.rows.map((row) => row.id);
}

async function validatePositions(client: PoolClient) {
  const existingTombstone = await client.query(
    `select id::text, position_key
       from shadow_positions
      where id = $1::uuid
         or (account_id = $2 and position_key = $3)
      for update`,
    [INVALID_BABA_POSITION_ID, ACCOUNT_ID, INVALID_BABA_POSITION_KEY],
  );
  equal(existingTombstone.rowCount, 0, "pre-existing invalid BABA position");

  const result = await client.query<PositionRow>(
    `select id::text, position_key, symbol, status, quantity::text,
            average_cost::text, mark::text, market_value::text,
            unrealized_pnl::text, realized_pnl::text, fees::text,
            opened_at, closed_at, as_of, option_contract->>'ticker' as ticker,
            option_contract#>>'{ledgerCorrection,id}' as correction_id
       from shadow_positions
      where id = any($1::uuid[])
      for update`,
    [LIFECYCLES.map((item) => item.positionId)],
  );
  equal(result.rowCount, LIFECYCLES.length, "position row count");
  const rows = new Map(result.rows.map((row) => [row.id, row]));
  for (const lifecycle of LIFECYCLES) {
    const row = rows.get(lifecycle.positionId);
    if (!row) throw new Error(`Missing position ${lifecycle.positionId}.`);
    const expected = POSITION_BEFORE[lifecycle.positionId as keyof typeof POSITION_BEFORE];
    equal(row.position_key, lifecycle.positionKey, `${row.id} position key`);
    equal(row.symbol, lifecycle.symbol, `${row.id} symbol`);
    equal(row.status, "closed", `${row.id} status`);
    equal(row.ticker, lifecycle.ticker, `${row.id} ticker`);
    money(row.quantity, 0, `${row.id} quantity`);
    money(row.average_cost, expected.averageCost, `${row.id} average cost`);
    money(row.mark, expected.mark, `${row.id} mark`);
    money(row.market_value, 0, `${row.id} market value`);
    money(row.unrealized_pnl, 0, `${row.id} unrealized P&L`);
    money(row.realized_pnl, expected.realizedPnl, `${row.id} realized P&L`);
    money(row.fees, expected.fees, `${row.id} fees`);
    equal(iso(row.opened_at), expected.openedAt, `${row.id} openedAt`);
    equal(iso(row.closed_at!), expected.closedAt, `${row.id} closedAt`);
    equal(iso(row.as_of), expected.closedAt, `${row.id} asOf`);
    equal(row.correction_id, null, `${row.id} prior correction`);
  }

  const contractRows = await client.query<{ ticker: string; fill_ids: string[] }>(
    `select f.option_contract->>'ticker' as ticker,
            array_agg(f.id::text order by f.id) as fill_ids
       from shadow_fills f
      where f.option_contract->>'ticker' = any($1::text[])
      group by f.option_contract->>'ticker'`,
    [LIFECYCLES.map((item) => item.ticker)],
  );
  equal(contractRows.rowCount, LIFECYCLES.length, "contract fill census row count");
  for (const lifecycle of LIFECYCLES) {
    const row = contractRows.rows.find((candidate) => candidate.ticker === lifecycle.ticker);
    if (!row) throw new Error(`Missing fill census for ${lifecycle.ticker}.`);
    assertStringArrayEqual(
      row.fill_ids,
      [
        lifecycle.entry.fillId,
        lifecycle.exit.fillId,
        ...RETAINED_CONTRACT_FILL_IDS[lifecycle.ticker]!,
      ],
      `${lifecycle.ticker} all-time fill ids`,
    );
  }
}

function assertStringArrayEqual(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  equal(
    JSON.stringify([...actual].sort()),
    JSON.stringify([...expected].sort()),
    label,
  );
}

async function validatePhysicalMarks(client: PoolClient) {
  const result = await client.query<PhysicalMarkRow>(
    `with lifecycles(position_id, opened_at, closed_at) as (
       values
         ('748081e9-d8c7-4a86-ba62-d23ce5706e06'::uuid,
          '2026-07-14T19:45:14.615Z'::timestamptz,
          '2026-07-14T19:55:01.211Z'::timestamptz),
         ('2ee94c8f-b2c1-4d07-b949-073776f04dbc'::uuid,
          '2026-07-14T19:50:12.581Z'::timestamptz,
          '2026-07-14T19:50:23.999Z'::timestamptz),
         ('189539ef-9871-4405-8225-1a273c651147'::uuid,
          '2026-07-14T19:55:20.549Z'::timestamptz,
          '2026-07-14T19:55:25.728Z'::timestamptz),
         ('70cd8386-4c23-48aa-b1da-756ebc3bd827'::uuid,
          '2026-07-14T19:55:23.917Z'::timestamptz,
          '2026-07-15T14:26:49.046Z'::timestamptz)
     )
     select m.id::text, m.position_id::text, m.mark::text, m.source, m.as_of
       from shadow_position_marks m
       join lifecycles l on l.position_id = m.position_id
                        and m.as_of >= l.opened_at
                        and m.as_of <= l.closed_at
      order by m.id
      for update of m`,
  );
  equal(result.rowCount, PHYSICAL_MARK_COUNT, "physical mark count");
  equal(
    idHash(result.rows.map((row) => row.id)),
    PHYSICAL_MARK_ID_SHA256,
    "physical mark id hash",
  );
  const expected = [
    {
      positionId: "748081e9-d8c7-4a86-ba62-d23ce5706e06",
      source: "option_quote",
      count: 8,
      min: 2.905,
      max: 3.1,
      first: "2026-07-14T19:45:45.044Z",
      last: "2026-07-14T19:50:07.579Z",
    },
    {
      positionId: "70cd8386-4c23-48aa-b1da-756ebc3bd827",
      source: "automation",
      count: 139,
      min: 2.3,
      max: 9.18,
      first: "2026-07-15T13:30:11.927Z",
      last: "2026-07-15T14:25:59.102Z",
    },
    {
      positionId: "70cd8386-4c23-48aa-b1da-756ebc3bd827",
      source: "option_quote",
      count: 89,
      min: 2.385,
      max: 9.125,
      first: "2026-07-14T19:55:51.658Z",
      last: "2026-07-15T14:26:10.013Z",
    },
  ] as const;
  for (const item of expected) {
    const rows = result.rows
      .filter(
        (row) => row.position_id === item.positionId && row.source === item.source,
      )
      .sort((a, b) => a.as_of.getTime() - b.as_of.getTime() || a.id.localeCompare(b.id));
    equal(rows.length, item.count, `${item.positionId}/${item.source} mark count`);
    money(
      Math.min(...rows.map((row) => finite(row.mark, `${row.id} mark`))),
      item.min,
      `${item.positionId}/${item.source} min mark`,
    );
    money(
      Math.max(...rows.map((row) => finite(row.mark, `${row.id} mark`))),
      item.max,
      `${item.positionId}/${item.source} max mark`,
    );
    equal(iso(rows[0]!.as_of), item.first, `${item.positionId}/${item.source} first mark`);
    equal(
      iso(rows.at(-1)!.as_of),
      item.last,
      `${item.positionId}/${item.source} last mark`,
    );
  }
  equal(
    result.rows.filter(
      (row) =>
        row.position_id === "2ee94c8f-b2c1-4d07-b949-073776f04dbc" ||
        row.position_id === "189539ef-9871-4405-8225-1a273c651147",
    ).length,
    0,
    "A/BA active-window physical mark count",
  );
  const invalidBabaIds = result.rows
    .filter(
      (row) => row.position_id === "70cd8386-4c23-48aa-b1da-756ebc3bd827",
    )
    .map((row) => row.id);
  equal(
    invalidBabaIds.length,
    INVALID_BABA_PHYSICAL_MARK_COUNT,
    "invalid BABA physical mark count",
  );
  equal(
    idHash(invalidBabaIds),
    INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
    "invalid BABA physical mark id hash",
  );
  const baba111Ids = result.rows
    .filter(
      (row) => row.position_id === "748081e9-d8c7-4a86-ba62-d23ce5706e06",
    )
    .map((row) => row.id);
  equal(baba111Ids.length, 8, "BABA111 preserved physical mark count");
  return {
    count: result.rows.length,
    idSha256: PHYSICAL_MARK_ID_SHA256,
    invalidBabaIds,
    invalidBabaIdSha256: INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
    baba111Ids,
    baba111IdSha256: idHash(baba111Ids),
  };
}

async function createInvalidBabaPositionAndMoveMarks(
  client: PoolClient,
  correctedAt: Date,
  state: ClosedLifecycleState,
  marks: {
    invalidBabaIds: string[];
    invalidBabaIdSha256: string;
    baba111Ids: string[];
    baba111IdSha256: string;
  },
) {
  const invalidLifecycle = LIFECYCLES.find(
    (item) => item.positionStrategy === "restore_prior",
  )!;
  const inserted = await client.query(
    `insert into shadow_positions
       (id, account_id, position_key, symbol, asset_class, quantity,
        average_cost, mark, market_value, unrealized_pnl, realized_pnl, fees,
        option_contract, opened_at, closed_at, as_of, status,
        created_at, updated_at, position_type)
     select $1::uuid, account_id, $2, symbol, asset_class, $3, $4, $5,
            0, 0, $6, $7,
            coalesce(option_contract, '{}'::jsonb) ||
              jsonb_build_object('ledgerCorrection', jsonb_build_object(
                'id', $12::text, 'status', 'void',
                'reason', 'entry_cutoff_window', 'correctedAt', $10::text,
                'candidateId', $13::text, 'originalPositionId', id::text,
                'physicalMarkCount', $14::int,
                'physicalMarkIdSha256', $15::text
              )),
            $8::timestamptz, $9::timestamptz, $9::timestamptz, 'closed',
            $8::timestamptz, $10::timestamptz, position_type
       from shadow_positions
      where id = $11::uuid and status = 'closed'`,
    [
      INVALID_BABA_POSITION_ID,
      INVALID_BABA_POSITION_KEY,
      state.quantity,
      state.averageCost,
      state.mark,
      state.realizedPnl,
      state.fees,
      state.openedAt,
      state.closedAt,
      correctedAt.toISOString(),
      invalidLifecycle.positionId,
      CORRECTION_ID,
      invalidLifecycle.candidateId,
      marks.invalidBabaIds.length,
      marks.invalidBabaIdSha256,
    ],
  );
  equal(inserted.rowCount, 1, "invalid BABA position insert count");

  const moved = await client.query<{ id: string }>(
    `update shadow_position_marks
        set position_id = $2::uuid, updated_at = $3::timestamptz
      where id = any($1::uuid[]) and position_id = $4::uuid
      returning id::text`,
    [
      marks.invalidBabaIds,
      INVALID_BABA_POSITION_ID,
      correctedAt.toISOString(),
      invalidLifecycle.positionId,
    ],
  );
  equal(moved.rowCount, INVALID_BABA_PHYSICAL_MARK_COUNT, "moved BABA mark count");
  equal(
    idHash(moved.rows.map((row) => row.id)),
    INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
    "moved BABA mark id hash",
  );

  const postMarks = await client.query<{ id: string; position_id: string }>(
    `select id::text, position_id::text
       from shadow_position_marks
      where position_id = $1::uuid
      order by id`,
    [INVALID_BABA_POSITION_ID],
  );
  equal(postMarks.rowCount, INVALID_BABA_PHYSICAL_MARK_COUNT, "post-move mark count");
  equal(
    idHash(postMarks.rows.map((row) => row.id)),
    INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
    "post-move mark id hash",
  );
  for (const row of postMarks.rows) {
    equal(row.position_id, INVALID_BABA_POSITION_ID, `${row.id} tombstone position`);
  }

  const preserved = await client.query<{ id: string; position_id: string }>(
    `select id::text, position_id::text
       from shadow_position_marks
      where id = any($1::uuid[])
      order by id`,
    [marks.baba111Ids],
  );
  equal(preserved.rowCount, marks.baba111Ids.length, "preserved BABA111 mark count");
  equal(
    idHash(preserved.rows.map((row) => row.id)),
    marks.baba111IdSha256,
    "preserved BABA111 mark id hash",
  );
  for (const row of preserved.rows) {
    equal(
      row.position_id,
      "748081e9-d8c7-4a86-ba62-d23ce5706e06",
      `${row.id} preserved BABA111 position`,
    );
  }

  const position = await client.query<PositionRow>(
    `select id::text, position_key, symbol, status, quantity::text,
            average_cost::text, mark::text, market_value::text,
            unrealized_pnl::text, realized_pnl::text, fees::text,
            opened_at, closed_at, as_of, option_contract->>'ticker' as ticker,
            option_contract#>>'{ledgerCorrection,id}' as correction_id
       from shadow_positions where id = $1::uuid`,
    [INVALID_BABA_POSITION_ID],
  );
  equal(position.rowCount, 1, "post-insert invalid BABA position count");
  const row = position.rows[0]!;
  equal(row.position_key, INVALID_BABA_POSITION_KEY, "invalid BABA position key");
  equal(row.symbol, invalidLifecycle.symbol, "invalid BABA position symbol");
  equal(row.status, "closed", "invalid BABA position status");
  equal(row.ticker, invalidLifecycle.ticker, "invalid BABA position ticker");
  money(row.quantity, state.quantity, "invalid BABA position quantity");
  money(row.average_cost, state.averageCost, "invalid BABA position average cost");
  money(row.mark, state.mark, "invalid BABA position mark");
  money(row.market_value, 0, "invalid BABA position market value");
  money(row.unrealized_pnl, 0, "invalid BABA position unrealized P&L");
  money(row.realized_pnl, state.realizedPnl, "invalid BABA position realized P&L");
  money(row.fees, state.fees, "invalid BABA position fees");
  equal(iso(row.opened_at), state.openedAt, "invalid BABA position openedAt");
  equal(iso(row.closed_at!), state.closedAt, "invalid BABA position closedAt");
  equal(iso(row.as_of), state.closedAt, "invalid BABA position asOf");
  equal(row.correction_id, CORRECTION_ID, "invalid BABA position correction");
  return {
    positionId: INVALID_BABA_POSITION_ID,
    positionKey: INVALID_BABA_POSITION_KEY,
    movedPhysicalMarkCount: postMarks.rows.length,
    movedPhysicalMarkIdSha256: INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
  };
}

async function tombstoneEvents(
  client: PoolClient,
  correctedAt: Date,
  markEventIds: readonly string[],
) {
  const lifecycleEventIds = LIFECYCLES.flatMap((item) => [
    item.entry.eventId,
    item.exit.eventId,
  ]);
  const lifecycleResult = await client.query(
    `update execution_events
        set event_type = event_type || '_voided',
            summary = '[VOIDED ' || $2 || '] ' || summary,
            payload = payload || jsonb_build_object(
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', 'entry_cutoff_window', 'correctedAt', $3::text,
                'originalEventType', event_type, 'originalSummary', summary
              )
            ),
            updated_at = $3::timestamptz
      where id = any($1::uuid[])
        and event_type in ('signal_options_shadow_entry', 'signal_options_shadow_exit')
        and not (payload ? 'ledgerCorrection')`,
    [lifecycleEventIds, CORRECTION_ID, correctedAt.toISOString()],
  );
  equal(lifecycleResult.rowCount, lifecycleEventIds.length, "void lifecycle event count");

  const markResult = await client.query(
    `update execution_events
        set event_type = event_type || '_voided',
            summary = '[VOIDED ' || $2 || '] ' || summary,
            payload = payload || jsonb_build_object(
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', 'invalid_entry_lifecycle_mark', 'correctedAt', $3::text,
                'originalEventType', event_type, 'originalSummary', summary
              )
            ),
            updated_at = $3::timestamptz
      where id = any($1::uuid[])
        and event_type = 'signal_options_shadow_mark'
        and not (payload ? 'ledgerCorrection')`,
    [markEventIds, CORRECTION_ID, correctedAt.toISOString()],
  );
  equal(markResult.rowCount, markEventIds.length, "void mark event count");
  return lifecycleEventIds;
}

async function tombstoneOrders(
  client: PoolClient,
  correctedAt: Date,
  orderIds: readonly string[],
) {
  const result = await client.query(
    `update shadow_orders
        set payload = payload || jsonb_build_object(
              'forwardTest', true,
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', 'entry_cutoff_window', 'correctedAt', $3::text,
                'originalForwardTestPresent', payload ? 'forwardTest',
                'originalForwardTest', payload->'forwardTest'
              )
            ),
            updated_at = $3::timestamptz
      where id = any($1::uuid[])
        and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'
        and not (payload ? 'ledgerCorrection')`,
    [orderIds, CORRECTION_ID, correctedAt.toISOString()],
  );
  equal(result.rowCount, orderIds.length, "forwardTest order count");
  return [...orderIds];
}

async function correctPositions(
  client: PoolClient,
  correctedAt: Date,
  retainedBaba: ClosedLifecycleState,
) {
  for (const lifecycle of LIFECYCLES.filter(
    (item) => item.positionStrategy === "tombstone_unique",
  )) {
    const result = await client.query(
      `update shadow_positions
          set position_key = $2,
              option_contract = coalesce(option_contract, '{}'::jsonb) ||
                jsonb_build_object('ledgerCorrection', jsonb_build_object(
                  'id', $3::text, 'status', 'void',
                  'reason', 'entry_cutoff_window', 'correctedAt', $4::text,
                  'originalPositionKey', position_key
                )),
              updated_at = $4::timestamptz
        where id = $1::uuid and position_key = $5 and status = 'closed'
          and not (coalesce(option_contract, '{}'::jsonb) ? 'ledgerCorrection')`,
      [
        lifecycle.positionId,
        `${FORWARD_POSITION_PREFIX}${lifecycle.positionKey}`,
        CORRECTION_ID,
        correctedAt.toISOString(),
        lifecycle.positionKey,
      ],
    );
    equal(result.rowCount, 1, `${lifecycle.positionId} unique position tombstone`);
  }

  const ba = LIFECYCLES.find((item) => item.positionStrategy === "subtract_reused")!;
  const baResult = await client.query(
    `update shadow_positions
        set realized_pnl = -193.67,
            fees = 1.34,
            option_contract = coalesce(option_contract, '{}'::jsonb) ||
              jsonb_build_object('ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'corrected',
                'reason', 'invalid_entry_lifecycle_removed_from_reused_position',
                'correctedAt', $3::text, 'removedCandidateId', $4::text,
                'originalRealizedPnl', realized_pnl, 'originalFees', fees
              )),
            updated_at = $3::timestamptz
      where id = $1::uuid and position_key = $5 and status = 'closed'
        and not (coalesce(option_contract, '{}'::jsonb) ? 'ledgerCorrection')`,
    [
      ba.positionId,
      CORRECTION_ID,
      correctedAt.toISOString(),
      ba.candidateId,
      ba.positionKey,
    ],
  );
  equal(baResult.rowCount, 1, "BA reused position correction");

  const baba = LIFECYCLES.find((item) => item.positionStrategy === "restore_prior")!;
  const babaResult = await client.query(
    `update shadow_positions
        set quantity = $6, average_cost = $7, mark = $8,
            market_value = 0, unrealized_pnl = 0,
            realized_pnl = $9, fees = $10,
            opened_at = $11::timestamptz,
            closed_at = $12::timestamptz,
            as_of = $12::timestamptz,
            status = 'closed',
            option_contract = coalesce(option_contract, '{}'::jsonb) ||
              jsonb_build_object('ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'corrected',
                'reason', 'restore_prior_valid_lifecycle_after_invalid_reuse',
                'correctedAt', $3::text, 'removedCandidateId', $4::text,
                'retainedEntryEventId', $13::text,
                'retainedExitEventId', $14::text
              )),
            updated_at = $3::timestamptz
      where id = $1::uuid and position_key = $5 and status = 'closed'
        and not (coalesce(option_contract, '{}'::jsonb) ? 'ledgerCorrection')`,
    [
      baba.positionId,
      CORRECTION_ID,
      correctedAt.toISOString(),
      baba.candidateId,
      baba.positionKey,
      retainedBaba.quantity,
      retainedBaba.averageCost,
      retainedBaba.mark,
      retainedBaba.realizedPnl,
      retainedBaba.fees,
      retainedBaba.openedAt,
      retainedBaba.closedAt,
      RETAINED_BABA_LIFECYCLE.entry.eventId,
      RETAINED_BABA_LIFECYCLE.exit.eventId,
    ],
  );
  equal(babaResult.rowCount, 1, "BABA reused position restoration");
}

async function correct(selectedMode = mode()) {
  const plan = validatePlan();
  const correctedAt = new Date();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '60s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `shadow-ledger-correction:${CORRECTION_ID}`,
    ]);
    await client.query(
      "lock table execution_events, shadow_orders, shadow_fills, shadow_positions, shadow_position_marks, shadow_accounts in share row exclusive mode",
    );
    const existing = await client.query(
      "select 1 from execution_events where id = $1::uuid",
      [CORRECTION_ID],
    );
    equal(existing.rowCount, 0, "existing correction event count");

    const before = await validateAccountBefore(client);
    await validateLifecycleEvents(client, LIFECYCLES, "invalid lifecycle");
    await validateLifecycleEvents(
      client,
      [RETAINED_BABA_LIFECYCLE],
      "retained BABA lifecycle",
    );
    const targetEconomics = await validateEconomicRows(
      client,
      LIFECYCLES,
      "invalid lifecycle",
    );
    const retainedBabaEconomics = await validateEconomicRows(
      client,
      [RETAINED_BABA_LIFECYCLE],
      "retained BABA lifecycle",
    );
    const retainedBabaState = deriveClosedLifecycleState(
      retainedBabaEconomics,
      RETAINED_BABA_LIFECYCLE,
    );
    const invalidBabaLifecycle = LIFECYCLES.find(
      (item) => item.positionStrategy === "restore_prior",
    )!;
    const invalidBabaState = deriveClosedLifecycleState(
      targetEconomics,
      invalidBabaLifecycle,
    );
    const markEventIds = await validateMarkEvents(client);
    await validatePositions(client);
    const physicalMarks = await validatePhysicalMarks(client);

    const lifecycleEventIds = await tombstoneEvents(
      client,
      correctedAt,
      markEventIds,
    );
    const orderIds = await tombstoneOrders(
      client,
      correctedAt,
      targetEconomics.orderIds,
    );
    const invalidBabaPosition = await createInvalidBabaPositionAndMoveMarks(
      client,
      correctedAt,
      invalidBabaState,
      physicalMarks,
    );
    await correctPositions(client, correctedAt, retainedBabaState);
    const after = await recomputeAccountAndSnapshot(
      client,
      correctedAt,
      "ledger_correction",
    );
    for (const key of ["cash", "realizedPnl", "fees"] as const) {
      money(after[key], EXPECTED_AFTER[key], `expected after ${key}`);
      money(after[key] - before[key], -plan[`recorded${key === "cash" ? "CashDelta" : key === "realizedPnl" ? "RealizedPnl" : "Fees"}` as keyof typeof plan] as number, `${key} correction delta`);
    }

    await client.query(
      `insert into execution_events
         (id, deployment_id, provider_account_id, event_type, summary, payload,
          occurred_at, created_at, updated_at)
       values ($1, $2, $3, 'signal_options_ledger_correction', $4, $5::jsonb,
               $6, $6, $6)`,
      [
        CORRECTION_ID,
        DEPLOYMENT_ID,
        ACCOUNT_ID,
        "Voided four post-cutoff option-entry lifecycles from 2026-07-14",
        JSON.stringify({
          correctionId: CORRECTION_ID,
          status: "applied",
          reason: "entry_cutoff_window",
          correctedAt: correctedAt.toISOString(),
          voidedLifecycleEventIds: lifecycleEventIds,
          voidedMarkEventIds: markEventIds,
          forwardTestOrderIds: orderIds,
          preservedFillIds: targetEconomics.fillIds,
          validatedRetainedBabaLifecycle: {
            eventIds: [
              RETAINED_BABA_LIFECYCLE.entry.eventId,
              RETAINED_BABA_LIFECYCLE.exit.eventId,
            ],
            orderIds: retainedBabaEconomics.orderIds,
            fillIds: retainedBabaEconomics.fillIds,
            restoredState: retainedBabaState,
          },
          correctedPositionIds: [
            ...LIFECYCLES.map((item) => item.positionId),
            invalidBabaPosition.positionId,
          ],
          invalidBabaPosition,
          preservedPhysicalMarks: {
            count: physicalMarks.count,
            idSha256: physicalMarks.idSha256,
            baba111Count: physicalMarks.baba111Ids.length,
            baba111IdSha256: physicalMarks.baba111IdSha256,
          },
          before,
          after,
          deltas: {
            cash: after.cash - before.cash,
            realizedPnl: after.realizedPnl - before.realizedPnl,
            fees: after.fees - before.fees,
          },
        }),
        correctedAt,
      ],
    );

    if (selectedMode === "dry-run") await client.query("rollback");
    else await client.query("commit");
    return {
      correctionId: CORRECTION_ID,
      mode: selectedMode,
      status: selectedMode === "dry-run" ? "validated_rolled_back" : "applied",
      before,
      after,
      plan,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  correct()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

export const __shadowLedgerLateEntryCorrection20260714InternalsForTests = {
  CORRECTION_ID,
  LIFECYCLES,
  RETAINED_BABA_LIFECYCLE,
  BABA_MARK_EVENT_COUNT,
  BABA_MARK_EVENT_ID_SHA256,
  INVALID_BABA_POSITION_ID,
  INVALID_BABA_POSITION_KEY,
  INVALID_BABA_PHYSICAL_MARK_COUNT,
  INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
  mode,
  validatePlan,
};
