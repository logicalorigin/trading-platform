import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

import { recomputeAccountAndSnapshot } from "./correct-shadow-ledger-2026-07-15";

const CORRECTION_ID = "c1f2026f-0715-4e18-9453-048100000001";
const TOMBSTONE_POSITION_ID = "c1f2026f-0715-4e18-9453-048100000002";
const PRIOR_CORRECTION_ID = "ddf5e2af-ab87-4edc-9029-6d5ae9061bd7";
const ACCOUNT_ID = "shadow";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const POSITION_ID = "d7390839-e9a3-433e-9a77-a6eb043d0e6b";
const POSITION_KEY =
  "option:CIFR:2026-07-17:20:call:O:CIFR260717C00020000";
const TOMBSTONE_POSITION_KEY =
  `shadow_equity_forward:ledger_correction:${CORRECTION_ID}:${POSITION_KEY}:replacement`;
const TICKER = "O:CIFR260717C00020000";
const ORIGINAL_CANDIDATE_ID = "SIGOPT-7e2e4e6f-CIFR-buy-1784137800000";
const REPLACEMENT_CANDIDATE_ID = "SIGOPT-7e2e4e6f-CIFR-buy-1784139000000";
const REPLACEMENT_OPENED_AT = "2026-07-15T18:31:57.942Z";
const REPLACEMENT_CLOSED_AT = "2026-07-15T18:46:32.056Z";

type Mode = "dry-run" | "apply";
type JsonRecord = Record<string, unknown>;
type Side = "buy" | "sell";

const REPLAY_EVIDENCE = {
  source: "Massive historical quote replay",
  asOf: "2026-07-15T18:45:30.481Z",
  entryPrice: 0.86,
  exitPrice: 0.99,
  quantity: 11,
  multiplier: 100,
  peakPrice: 1.18,
  bid: 0.93,
  ask: 1.04,
  mark: 0.985,
  stopPrice: 0.99,
  reason: "runner_trail_stop",
  grossPnl: 143,
  exitFees: 7.4,
  fillRealizedPnl: 135.6,
  exitCashDelta: 1081.6,
} as const;

const EXPECTED_BEFORE = {
  cash: 154950.6755,
  realizedPnl: 130742.0755,
  fees: 5456.88,
} as const;
const EXPECTED_AFTER = {
  cash: 155229.4755,
  realizedPnl: 131013.4755,
  fees: 5442.08,
} as const;
const RESTORED_POSITION = {
  averageCost: 0.86,
  mark: 0.99,
  realizedPnl: -102.8,
  fees: 29.6,
  openedAt: "2026-07-15T17:50:53.396Z",
  closedAt: REPLAY_EVIDENCE.asOf,
} as const;

type EconomicLeg = {
  retained: boolean;
  eventId: string;
  eventType: "signal_options_shadow_entry" | "signal_options_shadow_exit";
  candidateId: string;
  orderId?: string;
  fillId?: string;
  occurredAt: string;
  side: Side;
  quantity: number;
  price: number;
  grossAmount: number;
  fees: number;
  realizedPnl: number;
  cashDelta: number;
  correctionId: string | null;
};

const ECONOMIC_LEGS: readonly EconomicLeg[] = [
  {
    retained: true,
    eventId: "d74a19ef-a642-4953-a1af-9d8d2ff36f2e",
    eventType: "signal_options_shadow_entry",
    candidateId: "SIGOPT-7e2e4e6f-CIFR-buy-1784042400000",
    occurredAt: "2026-07-14T15:51:23.283Z",
    side: "buy",
    quantity: 11,
    price: 1.05,
    grossAmount: 1155,
    fees: 7.4,
    realizedPnl: 0,
    cashDelta: -1162.4,
    correctionId: null,
  },
  {
    retained: true,
    eventId: "6751d04d-1d9c-4153-aeec-652f07f31b1c",
    eventType: "signal_options_shadow_exit",
    candidateId: "SIGOPT-7e2e4e6f-CIFR-buy-1784042400000",
    occurredAt: "2026-07-14T16:55:17.552Z",
    side: "sell",
    quantity: 11,
    price: 0.84,
    grossAmount: 924,
    fees: 7.4,
    realizedPnl: -238.4,
    cashDelta: 916.6,
    correctionId: null,
  },
  {
    retained: true,
    eventId: "e37f718b-75f5-4719-9f87-b57b4b9ec13c",
    eventType: "signal_options_shadow_entry",
    candidateId: ORIGINAL_CANDIDATE_ID,
    orderId: "54150824-4906-4038-a1b0-85a914e86c06",
    fillId: "a0face04-b3bc-4c84-87ce-e21fccc347f0",
    occurredAt: "2026-07-15T17:50:53.397Z",
    side: "buy",
    quantity: 11,
    price: 0.86,
    grossAmount: 946,
    fees: 7.4,
    realizedPnl: 0,
    cashDelta: -953.4,
    correctionId: null,
  },
  {
    retained: true,
    eventId: "dd91f1b5-aff6-48ec-803f-c452098e2ee6",
    eventType: "signal_options_shadow_exit",
    candidateId: ORIGINAL_CANDIDATE_ID,
    orderId: "dbf3d5ee-003d-450f-9387-91dea66f1311",
    fillId: "1067d53e-b101-4eec-a1c7-cf296e01cf9e",
    occurredAt: REPLAY_EVIDENCE.asOf,
    side: "sell",
    quantity: 11,
    price: 0.99,
    grossAmount: 1089,
    fees: 7.4,
    realizedPnl: 135.6,
    cashDelta: 1081.6,
    correctionId: PRIOR_CORRECTION_ID,
  },
  {
    retained: false,
    eventId: "9fd33123-2bc7-412b-b77d-8d49bf2fdf13",
    eventType: "signal_options_shadow_entry",
    candidateId: REPLACEMENT_CANDIDATE_ID,
    orderId: "c0207771-26b9-4873-afc4-b2efa9a55a78",
    fillId: "c5c4833f-df1b-4dcc-8982-2c3e855988e5",
    occurredAt: "2026-07-15T18:31:57.943Z",
    side: "buy",
    quantity: 11,
    price: 1.21,
    grossAmount: 1331,
    fees: 7.4,
    realizedPnl: 0,
    cashDelta: -1338.4,
    correctionId: null,
  },
  {
    retained: false,
    eventId: "ff645ee3-3437-454f-bfe2-c8e91b694bd4",
    eventType: "signal_options_shadow_exit",
    candidateId: REPLACEMENT_CANDIDATE_ID,
    orderId: "ade89136-a4fc-4e9f-adb8-52edde94860b",
    fillId: "a711daa0-1f2c-413f-bea3-beead4e78a5b",
    occurredAt: "2026-07-15T18:46:32.056Z",
    side: "sell",
    quantity: 11,
    price: 0.97,
    grossAmount: 1067,
    fees: 7.4,
    realizedPnl: -271.4,
    cashDelta: 1059.6,
    correctionId: null,
  },
] as const;

const INVALID_MARK_EVENTS = [
  {
    id: "91e3ce46-fc94-4716-bb95-5f7c44ee4582",
    occurredAt: "2026-07-15T18:32:10.787Z",
    mark: 1.17,
  },
  {
    id: "f18229b6-4b9d-4219-8866-f3ed81cf73a7",
    occurredAt: "2026-07-15T18:39:11.547Z",
    mark: 1.07,
  },
  {
    id: "81e7cae1-c6d5-4405-881e-b3d2a6061cba",
    occurredAt: "2026-07-15T18:41:41.285Z",
    mark: 1.02,
  },
] as const;
const INVALID_MARK_EVENT_ID_SHA256 =
  "6a96e39bfb418acf3e575d45cfb6cf3a83dcfb97935926fa4d9a2708b7f2c62c";

const RETAINED_PHYSICAL_MARK_IDS = [
  "a3963b4b-7a0f-4eae-bbbf-e8dde0206050",
  "6eb847dd-a263-4356-a667-39027eadaee3",
  "0a4f1dda-d591-4eb2-8b14-c70cfa403f20",
  "64f20a93-32b1-432f-a6fe-aa2eaf6b48df",
  "10a2d70e-81dc-4e62-a383-1e1cc51edbde",
  "50d84dc4-018e-4498-86c0-b22f4a301b4b",
  "ad0c1e34-0ccc-459b-8904-608735b3ab94",
  "07e77cd1-eee3-4250-bdde-a01d519fe7e1",
  "1a261d40-e784-43f0-bd0c-042e05f0ac5a",
  "41ae01c7-c4ea-4a40-8e64-6576353927f3",
  "d26b7f5b-ee34-4eb8-bcc1-f01954ec9620",
  "ccbbdc2c-be35-4050-930d-c62fd6dfde6a",
  "2f53fab3-08f2-47b2-a6c9-fee0055aa651",
  "c3645f19-2776-47ed-b207-7e927c4bcf3a",
  "587963c0-f2ac-4adc-9e0d-b6a85b2908f6",
  "83d13579-19c4-445d-b006-436efcd3c5ef",
  "bb1383b3-4be4-4cad-9406-3901fc4e8130",
  "e1d67e76-dd89-4f81-8d61-607c384089a5",
  "fa77204f-3368-4ff7-8c7b-4301c92f1542",
  "fc275840-9c01-4695-9295-81a74b0e662b",
  "331a9f2f-1b04-4ec1-a624-e10d4037ac14",
  "4c5d44f7-946c-4368-85bd-3fdb5c132b21",
  "92368ca2-e7ae-445e-8286-d33f18322cc7",
  "1d4e8573-96c8-43f0-b7fe-1fad4bcb3d27",
  "1c96dbf9-b366-436a-bc6e-dcbdfc068b96",
  "80141876-4a2f-4542-8f2b-de0ea2c66c53",
  "2133dc87-adbd-4147-a202-181d5cb0d700",
  "bcd31a27-3037-449a-893c-8f655f62fc76",
  "ecefa6cf-7212-4e01-8510-5f3aba1d919c",
  "efb2c290-c45b-404c-8fb5-3f78462ded94",
] as const;
const TAIL_PHYSICAL_MARK_IDS = [
  "610824af-ae5a-4e12-b59c-d0fb59bfc790",
  "227caa3d-d1b8-4007-84a2-3ef52c2aee4d",
] as const;
const RETAINED_PHYSICAL_MARK_ID_SHA256 =
  "f189307bf3501e054a7ea0bf3f23286cb421e398033cbdf88777291fd0c178b5";
const TAIL_PHYSICAL_MARK_ID_SHA256 =
  "457ec63dc79a1d98df77efe14169da5974e85e0be15915f7045fbea0945cd278";
const ALL_PHYSICAL_MARK_ID_SHA256 =
  "6297081065d325b889e65e5e51c8b134343b18502f8ee9bd4f30f652f1910ea4";

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

function idHash(ids: readonly string[]): string {
  return createHash("sha256").update(`${[...ids].sort().join("\n")}\n`).digest("hex");
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function assertIdSet(actual: readonly string[], expected: readonly string[], label: string) {
  equal(JSON.stringify([...actual].sort()), JSON.stringify([...expected].sort()), label);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function pathValue(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) current = record(current, path.join("."))[part];
  return current;
}

function validatePlan() {
  equal(idHash(INVALID_MARK_EVENTS.map((item) => item.id)), INVALID_MARK_EVENT_ID_SHA256, "mark event id hash");
  equal(idHash(RETAINED_PHYSICAL_MARK_IDS), RETAINED_PHYSICAL_MARK_ID_SHA256, "retained mark id hash");
  equal(idHash(TAIL_PHYSICAL_MARK_IDS), TAIL_PHYSICAL_MARK_ID_SHA256, "tail mark id hash");
  equal(
    idHash([...RETAINED_PHYSICAL_MARK_IDS, ...TAIL_PHYSICAL_MARK_IDS]),
    ALL_PHYSICAL_MARK_ID_SHA256,
    "all mark id hash",
  );
  const invalid = ECONOMIC_LEGS.filter((item) => !item.retained);
  const replacementCashDelta = invalid.reduce((sum, item) => sum + item.cashDelta, 0);
  const replacementRealizedPnl = invalid.reduce((sum, item) => sum + item.realizedPnl, 0);
  const replacementFees = invalid.reduce((sum, item) => sum + item.fees, 0);
  money(replacementCashDelta, -278.8, "replacement cash");
  money(replacementRealizedPnl, -271.4, "replacement realized P&L");
  money(replacementFees, 14.8, "replacement fees");
  money(EXPECTED_AFTER.cash, EXPECTED_BEFORE.cash - replacementCashDelta, "after cash");
  money(
    EXPECTED_AFTER.realizedPnl,
    EXPECTED_BEFORE.realizedPnl - replacementRealizedPnl,
    "after realized P&L",
  );
  money(EXPECTED_AFTER.fees, EXPECTED_BEFORE.fees - replacementFees, "after fees");
  return {
    invalidLifecycleEventCount: invalid.length,
    invalidMarkEventCount: INVALID_MARK_EVENTS.length,
    invalidOrderCount: invalid.length,
    preservedFillCount: invalid.length,
    retainedPhysicalMarkCount: RETAINED_PHYSICAL_MARK_IDS.length,
    reparentedPhysicalMarkCount: TAIL_PHYSICAL_MARK_IDS.length,
    replacementCashDelta: roundMoney(replacementCashDelta),
    replacementRealizedPnl: roundMoney(replacementRealizedPnl),
    replacementFees: roundMoney(replacementFees),
    correctionCashDelta: roundMoney(-replacementCashDelta),
    correctionRealizedPnlDelta: roundMoney(-replacementRealizedPnl),
    correctionFeesDelta: roundMoney(-replacementFees),
    expectedBefore: { ...EXPECTED_BEFORE },
    expectedAfter: { ...EXPECTED_AFTER },
    restoredPosition: { ...RESTORED_POSITION },
  };
}

function optionalPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

type EventRow = {
  id: string;
  deployment_id: string | null;
  provider_account_id: string | null;
  symbol: string;
  event_type: string;
  summary: string | null;
  payload: JsonRecord;
  occurred_at: Date;
  created_at: Date;
};
type OrderRow = {
  id: string;
  source_event_id: string;
  account_id: string;
  source: string;
  status: string;
  symbol: string;
  side: string;
  quantity: string;
  filled_quantity: string;
  limit_price: string | null;
  average_fill_price: string | null;
  fees: string;
  placed_at: Date;
  filled_at: Date | null;
  created_at: Date;
  payload: JsonRecord;
};
type FillRow = {
  id: string;
  order_id: string;
  source_event_id: string;
  account_id: string;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  gross_amount: string;
  fees: string;
  realized_pnl: string;
  cash_delta: string;
  occurred_at: Date;
  ticker: string | null;
};
type PositionRow = {
  id: string;
  account_id: string;
  position_key: string;
  symbol: string;
  asset_class: string;
  position_type: string | null;
  status: string;
  quantity: string;
  average_cost: string;
  mark: string | null;
  market_value: string | null;
  unrealized_pnl: string;
  realized_pnl: string;
  fees: string;
  option_contract: JsonRecord | null;
  opened_at: Date;
  closed_at: Date | null;
  as_of: Date;
};
type MarkRow = {
  id: string;
  account_id: string;
  position_id: string;
  mark: string;
  market_value: string;
  unrealized_pnl: string;
  source: string;
  as_of: Date;
};

function validatePrematureReplayPayload(
  payload: JsonRecord,
  kind: "event" | "order",
): void {
  equal(
    optionalPath(payload, ["ledgerCorrection", "id"]),
    PRIOR_CORRECTION_ID,
    `${kind} prior correction`,
  );
  money(payload.markPrice, 0.85, `${kind} premature mark`);
  money(pathValue(payload, ["quote", "bid"]), 0.84, `${kind} premature bid`);
  money(pathValue(payload, ["quote", "ask"]), 0.86, `${kind} premature ask`);
  money(pathValue(payload, ["quote", "mark"]), 0.85, `${kind} premature quote mark`);
  equal(
    pathValue(payload, ["quote", "updatedAt"]),
    "2026-07-15T17:50:37.862Z",
    `${kind} premature quote time`,
  );
  money(pathValue(payload, ["position", "stopPrice"]), 0.86, `${kind} premature position stop`);
  money(pathValue(payload, ["position", "lastMarkPrice"]), 0.85, `${kind} premature last mark`);
  money(pathValue(payload, ["stop", "stopPrice"]), 0.86, `${kind} premature stop`);
  money(
    pathValue(payload, ["position", "peakPrice"]),
    kind === "event" ? 1.18 : 1.105,
    `${kind} current peak`,
  );
}

function replayPayload(
  original: JsonRecord,
  createdAt: Date,
  correctedAt: Date,
): JsonRecord {
  const payload = structuredClone(original);
  const position = record(payload.position, "position");
  const stop = record(payload.stop, "stop");
  const lastStop = record(position.lastStop, "position.lastStop");
  const priorCorrection = record(payload.ledgerCorrection, "ledgerCorrection");
  const prematureExitEvidence = {
    createdAt: createdAt.toISOString(),
    markPrice: payload.markPrice,
    quote: payload.quote,
    liquidity: payload.liquidity,
    markResolution: payload.markResolution,
    fillQuoteSource: payload.fillQuoteSource,
    quoteFreshness: payload.quoteFreshness,
    stop: payload.stop,
    metadata: payload.metadata,
    position: {
      peakPrice: position.peakPrice,
      stopPrice: position.stopPrice,
      lastMarkedAt: position.lastMarkedAt,
      lastMarkPrice: position.lastMarkPrice,
      lastStop: position.lastStop,
      lastWireTrail: position.lastWireTrail,
    },
  };
  const peakReturnPct = ((REPLAY_EVIDENCE.peakPrice - REPLAY_EVIDENCE.entryPrice) /
    REPLAY_EVIDENCE.entryPrice) * 100;
  const markReturnPct = ((REPLAY_EVIDENCE.mark - REPLAY_EVIDENCE.entryPrice) /
    REPLAY_EVIDENCE.entryPrice) * 100;
  const replayQuote = {
    bid: REPLAY_EVIDENCE.bid,
    ask: REPLAY_EVIDENCE.ask,
    mark: REPLAY_EVIDENCE.mark,
    updatedAt: REPLAY_EVIDENCE.asOf,
    source: REPLAY_EVIDENCE.source,
  };
  payload.markPrice = REPLAY_EVIDENCE.mark;
  payload.quote = replayQuote;
  payload.liquidity = {
    bid: REPLAY_EVIDENCE.bid,
    ask: REPLAY_EVIDENCE.ask,
    mid: REPLAY_EVIDENCE.mark,
    mark: REPLAY_EVIDENCE.mark,
    spread: REPLAY_EVIDENCE.ask - REPLAY_EVIDENCE.bid,
    spreadPctOfMid:
      ((REPLAY_EVIDENCE.ask - REPLAY_EVIDENCE.bid) / REPLAY_EVIDENCE.mark) * 100,
    source: REPLAY_EVIDENCE.source,
  };
  payload.markResolution = { source: REPLAY_EVIDENCE.source, quote: replayQuote };
  payload.fillQuoteSource = REPLAY_EVIDENCE.source;
  payload.quoteFreshness = "historical_replay";
  Object.assign(stop, {
    returnPct: peakReturnPct,
    stopPrice: REPLAY_EVIDENCE.stopPrice,
    markReturnPct,
    trailStopPrice: REPLAY_EVIDENCE.stopPrice,
    activeStopPrice: REPLAY_EVIDENCE.stopPrice,
    enforcementSource: REPLAY_EVIDENCE.source,
  });
  delete stop.greekManagement;
  delete stop.wireTrail;
  Object.assign(lastStop, {
    returnPct: peakReturnPct,
    stopPrice: REPLAY_EVIDENCE.stopPrice,
    markReturnPct,
    trailStopPrice: REPLAY_EVIDENCE.stopPrice,
    activeStopPrice: REPLAY_EVIDENCE.stopPrice,
    enforcementSource: REPLAY_EVIDENCE.source,
  });
  delete lastStop.greekManagement;
  delete lastStop.wireTrail;
  Object.assign(position, {
    peakPrice: REPLAY_EVIDENCE.peakPrice,
    stopPrice: REPLAY_EVIDENCE.stopPrice,
    lastMarkedAt: REPLAY_EVIDENCE.asOf,
    lastMarkPrice: REPLAY_EVIDENCE.mark,
    lastStop,
  });
  delete position.lastWireTrail;
  payload.stop = stop;
  payload.position = position;
  payload.ledgerCorrection = {
    id: CORRECTION_ID,
    status: "corrected",
    reason: "counterfactual_reentry_overlap",
    correctedAt: correctedAt.toISOString(),
    priorCorrection,
    replayEvidence: REPLAY_EVIDENCE,
    prematureExitEvidence,
  };
  return payload;
}

async function validatePriorCorrection(client: PoolClient): Promise<void> {
  const result = await client.query<{ event_type: string; status: string | null }>(
    `select event_type, payload->>'status' as status
       from execution_events where id = $1::uuid for update`,
    [PRIOR_CORRECTION_ID],
  );
  equal(result.rowCount, 1, "prior correction event count");
  equal(result.rows[0]!.event_type, "signal_options_ledger_correction", "prior correction type");
  equal(result.rows[0]!.status, "applied", "prior correction status");
}

async function validateEvents(client: PoolClient): Promise<Map<string, EventRow>> {
  const eventIds = [
    ...ECONOMIC_LEGS.map((item) => item.eventId),
    ...INVALID_MARK_EVENTS.map((item) => item.id),
  ];
  const result = await client.query<EventRow>(
    `select id::text, deployment_id::text, provider_account_id, symbol, event_type,
            summary, payload, occurred_at, created_at
       from execution_events where id = any($1::uuid[]) for update`,
    [eventIds],
  );
  equal(result.rowCount, eventIds.length, "CIFR event census count");
  const rows = new Map(result.rows.map((row) => [row.id, row]));
  for (const leg of ECONOMIC_LEGS) {
    const row = rows.get(leg.eventId);
    if (!row) throw new Error(`Missing event ${leg.eventId}.`);
    equal(row.deployment_id, DEPLOYMENT_ID, `${leg.eventId} deployment`);
    equal(row.provider_account_id, ACCOUNT_ID, `${leg.eventId} account`);
    equal(row.symbol, "CIFR", `${leg.eventId} symbol`);
    equal(row.event_type, leg.eventType, `${leg.eventId} type`);
    equal(iso(row.occurred_at), leg.occurredAt, `${leg.eventId} occurredAt`);
    equal(pathValue(row.payload, ["position", "candidateId"]), leg.candidateId, `${leg.eventId} candidate`);
    equal(
      optionalPath(row.payload, ["selectedContract", "ticker"]) ??
        optionalPath(row.payload, ["position", "selectedContract", "ticker"]),
      TICKER,
      `${leg.eventId} ticker`,
    );
    money(pathValue(row.payload, ["position", "quantity"]), leg.quantity, `${leg.eventId} quantity`);
    money(
      leg.side === "buy"
        ? pathValue(row.payload, ["position", "entryPrice"])
        : row.payload.exitPrice,
      leg.price,
      `${leg.eventId} price`,
    );
    if (leg.eventId === "e37f718b-75f5-4719-9f87-b57b4b9ec13c") {
      equal(
        pathValue(row.payload, ["position", "openedAt"]),
        RESTORED_POSITION.openedAt,
        "retained CIFR openedAt",
      );
    }
    equal(optionalPath(row.payload, ["ledgerCorrection", "id"]) ?? null, leg.correctionId, `${leg.eventId} correction`);
  }
  for (const expected of INVALID_MARK_EVENTS) {
    const row = rows.get(expected.id);
    if (!row) throw new Error(`Missing mark event ${expected.id}.`);
    equal(row.deployment_id, DEPLOYMENT_ID, `${expected.id} deployment`);
    equal(row.provider_account_id, ACCOUNT_ID, `${expected.id} account`);
    equal(row.symbol, "CIFR", `${expected.id} symbol`);
    equal(row.event_type, "signal_options_shadow_mark", `${expected.id} type`);
    equal(iso(row.occurred_at), expected.occurredAt, `${expected.id} occurredAt`);
    equal(pathValue(row.payload, ["position", "candidateId"]), REPLACEMENT_CANDIDATE_ID, `${expected.id} candidate`);
    money(pathValue(row.payload, ["position", "lastMarkPrice"]), expected.mark, `${expected.id} mark`);
    equal(optionalPath(row.payload, ["ledgerCorrection", "id"]), undefined, `${expected.id} correction`);
  }
  equal(
    idHash(INVALID_MARK_EVENTS.map((item) => rows.get(item.id)!.id)),
    INVALID_MARK_EVENT_ID_SHA256,
    "locked mark event hash",
  );
  const markCensus = await client.query<{ id: string }>(
    `select id::text
       from execution_events
      where deployment_id = $1::uuid
        and event_type = 'signal_options_shadow_mark'
        and payload#>>'{position,candidateId}' = $2
      order by id
      for update`,
    [DEPLOYMENT_ID, REPLACEMENT_CANDIDATE_ID],
  );
  equal(markCensus.rowCount, INVALID_MARK_EVENTS.length, "replacement candidate mark census count");
  assertIdSet(
    markCensus.rows.map((row) => row.id),
    INVALID_MARK_EVENTS.map((item) => item.id),
    "replacement candidate mark census ids",
  );
  equal(
    idHash(markCensus.rows.map((row) => row.id)),
    INVALID_MARK_EVENT_ID_SHA256,
    "replacement candidate mark census hash",
  );
  return rows;
}

type EconomicState = {
  ordersByEvent: Map<string, OrderRow>;
  fillsByEvent: Map<string, FillRow>;
  retainedFillIds: string[];
  invalidFillIds: string[];
};

async function validateEconomics(client: PoolClient): Promise<EconomicState> {
  const allTargetEventIds = [
    ...ECONOMIC_LEGS.map((item) => item.eventId),
    ...INVALID_MARK_EVENTS.map((item) => item.id),
  ];
  const orders = await client.query<OrderRow>(
    `select id::text, source_event_id::text, account_id, source, status, symbol,
            side::text, quantity::text, filled_quantity::text, limit_price::text,
            average_fill_price::text, fees::text, placed_at, filled_at, created_at,
            payload
       from shadow_orders
      where source_event_id = any($1::uuid[])
      order by source_event_id, id
      for update`,
    [allTargetEventIds],
  );
  equal(orders.rowCount, ECONOMIC_LEGS.length, "all-orders-per-event census count");
  const ordersByEvent = new Map<string, OrderRow>();
  for (const row of orders.rows) {
    if (ordersByEvent.has(row.source_event_id)) {
      throw new Error(`Multiple orders link to event ${row.source_event_id}.`);
    }
    ordersByEvent.set(row.source_event_id, row);
  }
  for (const mark of INVALID_MARK_EVENTS) {
    equal(ordersByEvent.has(mark.id), false, `${mark.id} mark-event order absence`);
  }

  const fills = await client.query<FillRow>(
    `select f.id::text, f.order_id::text, f.source_event_id::text, f.account_id,
            f.symbol, f.side::text, f.quantity::text, f.price::text,
            f.gross_amount::text, f.fees::text, f.realized_pnl::text,
            f.cash_delta::text, f.occurred_at,
            f.option_contract->>'ticker' as ticker
       from shadow_fills f
      where f.order_id = any($1::uuid[])
      order by f.order_id, f.id
      for update`,
    [orders.rows.map((row) => row.id)],
  );
  equal(fills.rowCount, ECONOMIC_LEGS.length, "target fill census count");
  const fillsByEvent = new Map<string, FillRow>();
  for (const row of fills.rows) {
    if (fillsByEvent.has(row.source_event_id)) {
      throw new Error(`Multiple fills link to event ${row.source_event_id}.`);
    }
    fillsByEvent.set(row.source_event_id, row);
  }

  for (const leg of ECONOMIC_LEGS) {
    const order = ordersByEvent.get(leg.eventId);
    const fill = fillsByEvent.get(leg.eventId);
    if (!order || !fill) throw new Error(`Missing economics for event ${leg.eventId}.`);
    if (leg.orderId) equal(order.id, leg.orderId, `${leg.eventId} order id`);
    if (leg.fillId) equal(fill.id, leg.fillId, `${leg.eventId} fill id`);
    equal(order.account_id, ACCOUNT_ID, `${order.id} account`);
    equal(order.source, "automation", `${order.id} source`);
    equal(order.status, "filled", `${order.id} status`);
    equal(order.symbol, "CIFR", `${order.id} symbol`);
    equal(order.side, leg.side, `${order.id} side`);
    money(order.quantity, leg.quantity, `${order.id} quantity`);
    money(order.filled_quantity, leg.quantity, `${order.id} filled quantity`);
    money(order.limit_price, leg.price, `${order.id} limit price`);
    money(order.average_fill_price, leg.price, `${order.id} average price`);
    money(order.fees, leg.fees, `${order.id} fees`);
    equal(iso(order.placed_at), leg.occurredAt, `${order.id} placedAt`);
    equal(iso(order.filled_at!), leg.occurredAt, `${order.id} filledAt`);
    equal(String(order.payload.forwardTest ?? "false").toLowerCase(), "false", `${order.id} forwardTest`);
    equal(
      optionalPath(order.payload, ["ledgerCorrection", "id"]) ?? null,
      leg.correctionId,
      `${order.id} correction`,
    );
    equal(fill.order_id, order.id, `${fill.id} order`);
    equal(fill.source_event_id, leg.eventId, `${fill.id} event`);
    equal(fill.account_id, ACCOUNT_ID, `${fill.id} account`);
    equal(fill.symbol, "CIFR", `${fill.id} symbol`);
    equal(fill.side, leg.side, `${fill.id} side`);
    equal(fill.ticker, TICKER, `${fill.id} ticker`);
    money(fill.quantity, leg.quantity, `${fill.id} quantity`);
    money(fill.price, leg.price, `${fill.id} price`);
    money(fill.gross_amount, leg.grossAmount, `${fill.id} gross amount`);
    money(fill.fees, leg.fees, `${fill.id} fees`);
    money(fill.realized_pnl, leg.realizedPnl, `${fill.id} realized P&L`);
    money(fill.cash_delta, leg.cashDelta, `${fill.id} cash delta`);
    equal(iso(fill.occurred_at), leg.occurredAt, `${fill.id} occurredAt`);
  }

  const contractCensus = await client.query<{ source_event_id: string; fill_id: string }>(
    `select o.source_event_id::text, f.id::text as fill_id
       from shadow_fills f
       join shadow_orders o on o.id = f.order_id
      where f.option_contract->>'ticker' = $1
      order by o.source_event_id, f.id
      for update of o, f`,
    [TICKER],
  );
  equal(contractCensus.rowCount, ECONOMIC_LEGS.length, "all-time CIFR contract fill count");
  assertIdSet(
    contractCensus.rows.map((row) => row.source_event_id),
    ECONOMIC_LEGS.map((item) => item.eventId),
    "all-time CIFR source-event census",
  );

  const replayOrder = ordersByEvent.get("dd91f1b5-aff6-48ec-803f-c452098e2ee6")!;
  validatePrematureReplayPayload(replayOrder.payload, "order");
  const retainedFillIds = ECONOMIC_LEGS.filter((item) => item.retained).map(
    (item) => fillsByEvent.get(item.eventId)!.id,
  );
  const invalidFillIds = ECONOMIC_LEGS.filter((item) => !item.retained).map(
    (item) => fillsByEvent.get(item.eventId)!.id,
  );
  equal(retainedFillIds.length, 4, "retained fill count");
  equal(invalidFillIds.length, 2, "invalid preserved fill count");
  return { ordersByEvent, fillsByEvent, retainedFillIds, invalidFillIds };
}

async function validateAccountBefore(client: PoolClient) {
  const account = await client.query<{ cash: string; realized_pnl: string; fees: string }>(
    `select cash::text, realized_pnl::text, fees::text
       from shadow_accounts where id = $1 for update`,
    [ACCOUNT_ID],
  );
  equal(account.rowCount, 1, "shadow account row count");
  const before = {
    cash: finite(account.rows[0]!.cash, "account cash"),
    realizedPnl: finite(account.rows[0]!.realized_pnl, "account realized P&L"),
    fees: finite(account.rows[0]!.fees, "account fees"),
  };
  const folded = await client.query<{ cash: string; realized_pnl: string; fees: string }>(
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
  for (const [key, column] of [
    ["cash", "cash"],
    ["realizedPnl", "realized_pnl"],
    ["fees", "fees"],
  ] as const) {
    money(
      before[key],
      finite(folded.rows[0]![column], `folded ${key}`),
      `${key} account/fold parity`,
    );
    money(before[key], EXPECTED_BEFORE[key], `expected before ${key}`);
  }
  return before;
}

async function validatePosition(client: PoolClient): Promise<PositionRow> {
  const result = await client.query<PositionRow>(
    `select id::text, account_id, position_key, symbol, asset_class, position_type,
            status, quantity::text, average_cost::text, mark::text,
            market_value::text, unrealized_pnl::text, realized_pnl::text,
            fees::text, option_contract, opened_at, closed_at, as_of
       from shadow_positions where id = $1::uuid for update`,
    [POSITION_ID],
  );
  equal(result.rowCount, 1, "CIFR position count");
  const row = result.rows[0]!;
  equal(row.account_id, ACCOUNT_ID, "CIFR position account");
  equal(row.position_key, POSITION_KEY, "CIFR position key");
  equal(row.symbol, "CIFR", "CIFR position symbol");
  equal(row.asset_class, "option", "CIFR asset class");
  equal(row.status, "closed", "CIFR position status");
  money(row.quantity, 0, "CIFR quantity");
  money(row.average_cost, 1.21, "CIFR current average cost");
  money(row.mark, 0.99, "CIFR current mark");
  money(row.market_value, 0, "CIFR current market value");
  money(row.unrealized_pnl, 0, "CIFR current unrealized P&L");
  money(row.realized_pnl, -374.2, "CIFR current realized P&L");
  money(row.fees, 44.4, "CIFR current fees");
  equal(iso(row.opened_at), "2026-07-15T18:31:57.943Z", "CIFR current openedAt");
  equal(iso(row.closed_at!), "2026-07-15T18:46:32.056Z", "CIFR current closedAt");
  equal(iso(row.as_of), "2026-07-15T18:46:32.056Z", "CIFR current asOf");
  equal(optionalPath(row.option_contract, ["ticker"]), TICKER, "CIFR position ticker");
  equal(
    optionalPath(row.option_contract, ["ledgerCorrection", "id"]),
    PRIOR_CORRECTION_ID,
    "CIFR position prior correction",
  );
  const tombstone = await client.query(
    `select 1 from shadow_positions where id = $1::uuid or position_key = $2`,
    [TOMBSTONE_POSITION_ID, TOMBSTONE_POSITION_KEY],
  );
  equal(tombstone.rowCount, 0, "existing CIFR tombstone count");
  return row;
}

async function validatePhysicalMarks(client: PoolClient): Promise<MarkRow[]> {
  const allIds = [...RETAINED_PHYSICAL_MARK_IDS, ...TAIL_PHYSICAL_MARK_IDS];
  const result = await client.query<MarkRow>(
    `select id::text, account_id, position_id::text, mark::text,
            market_value::text, unrealized_pnl::text, source, as_of
       from shadow_position_marks
      where position_id = $1::uuid
        and as_of >= $2::timestamptz
        and as_of <= $3::timestamptz
      order by id for update`,
    [POSITION_ID, REPLACEMENT_OPENED_AT, REPLACEMENT_CLOSED_AT],
  );
  equal(result.rowCount, allIds.length, "CIFR physical mark count");
  assertIdSet(result.rows.map((row) => row.id), allIds, "CIFR physical mark census ids");
  equal(idHash(result.rows.map((row) => row.id)), ALL_PHYSICAL_MARK_ID_SHA256, "CIFR physical mark hash");
  for (const row of result.rows) {
    equal(row.account_id, ACCOUNT_ID, `${row.id} account`);
    equal(row.position_id, POSITION_ID, `${row.id} position`);
    if (row.source !== "automation" && row.source !== "option_quote") {
      throw new Error(`${row.id} unexpected source ${row.source}.`);
    }
    money(row.market_value, finite(row.mark, `${row.id} mark`) * 1100, `${row.id} market value`);
    money(
      row.unrealized_pnl,
      (finite(row.mark, `${row.id} mark`) - 1.21) * 1100,
      `${row.id} replacement unrealized P&L`,
    );
  }
  const retained = result.rows.filter((row) => RETAINED_PHYSICAL_MARK_IDS.includes(row.id as never));
  const tail = result.rows.filter((row) => TAIL_PHYSICAL_MARK_IDS.includes(row.id as never));
  equal(retained.length, RETAINED_PHYSICAL_MARK_IDS.length, "retained physical mark count");
  equal(tail.length, TAIL_PHYSICAL_MARK_IDS.length, "tail physical mark count");
  equal(idHash(retained.map((row) => row.id)), RETAINED_PHYSICAL_MARK_ID_SHA256, "retained physical mark hash");
  equal(idHash(tail.map((row) => row.id)), TAIL_PHYSICAL_MARK_ID_SHA256, "tail physical mark hash");
  for (const row of retained) {
    if (row.as_of.getTime() > Date.parse(REPLAY_EVIDENCE.asOf)) {
      throw new Error(`${row.id} is after the replayed exit.`);
    }
  }
  for (const row of tail) {
    if (row.as_of.getTime() <= Date.parse(REPLAY_EVIDENCE.asOf)) {
      throw new Error(`${row.id} is not after the replayed exit.`);
    }
  }
  return result.rows;
}

async function correctReplayEvidence(
  client: PoolClient,
  correctedAt: Date,
  events: Map<string, EventRow>,
  economics: EconomicState,
): Promise<void> {
  const eventId = "dd91f1b5-aff6-48ec-803f-c452098e2ee6";
  const event = events.get(eventId)!;
  const order = economics.ordersByEvent.get(eventId)!;
  validatePrematureReplayPayload(event.payload, "event");
  const eventPayload = replayPayload(event.payload, event.created_at, correctedAt);
  const orderPayload = replayPayload(order.payload, order.created_at, correctedAt);
  const eventResult = await client.query<{ payload: JsonRecord }>(
    `update execution_events
        set payload = $2::jsonb, updated_at = $3::timestamptz
      where id = $1::uuid
        and payload#>>'{ledgerCorrection,id}' = $4
      returning payload`,
    [eventId, JSON.stringify(eventPayload), correctedAt.toISOString(), PRIOR_CORRECTION_ID],
  );
  equal(eventResult.rowCount, 1, "CIFR replay event evidence update");
  const orderResult = await client.query<{ payload: JsonRecord }>(
    `update shadow_orders
        set payload = $2::jsonb, updated_at = $3::timestamptz
      where id = $1::uuid
        and payload#>>'{ledgerCorrection,id}' = $4
      returning payload`,
    [order.id, JSON.stringify(orderPayload), correctedAt.toISOString(), PRIOR_CORRECTION_ID],
  );
  equal(orderResult.rowCount, 1, "CIFR replay order evidence update");
  for (const [kind, payload] of [
    ["event", eventResult.rows[0]!.payload],
    ["order", orderResult.rows[0]!.payload],
  ] as const) {
    equal(optionalPath(payload, ["ledgerCorrection", "id"]), CORRECTION_ID, `${kind} correction`);
    equal(
      optionalPath(payload, ["ledgerCorrection", "priorCorrection", "id"]),
      PRIOR_CORRECTION_ID,
      `${kind} prior correction chain`,
    );
    money(payload.markPrice, REPLAY_EVIDENCE.mark, `${kind} replay mark`);
    money(pathValue(payload, ["quote", "bid"]), REPLAY_EVIDENCE.bid, `${kind} replay bid`);
    money(pathValue(payload, ["quote", "ask"]), REPLAY_EVIDENCE.ask, `${kind} replay ask`);
    equal(optionalPath(payload, ["quote", "last"]), undefined, `${kind} replay last omission`);
    equal(optionalPath(payload, ["quote", "delta"]), undefined, `${kind} replay Greek omission`);
    money(pathValue(payload, ["position", "peakPrice"]), REPLAY_EVIDENCE.peakPrice, `${kind} replay peak`);
    money(pathValue(payload, ["position", "stopPrice"]), REPLAY_EVIDENCE.stopPrice, `${kind} replay stop`);
  }
}

async function tombstoneReplacement(
  client: PoolClient,
  correctedAt: Date,
  economics: EconomicState,
) {
  const lifecycleIds = ECONOMIC_LEGS.filter((item) => !item.retained).map((item) => item.eventId);
  const markIds = INVALID_MARK_EVENTS.map((item) => item.id);
  const events = await client.query<{ id: string }>(
    `update execution_events
        set event_type = event_type || '_voided',
            summary = '[VOIDED ' || $2 || '] ' || coalesce(summary, ''),
            payload = payload || jsonb_build_object(
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', case when id = any($3::uuid[])
                  then 'counterfactual_reentry_mark'
                  else 'counterfactual_reentry_while_prior_position_open' end,
                'correctedAt', $4::text,
                'priorCorrectionId', $5::text,
                'originalEventType', event_type,
                'originalSummary', summary
              )
            ),
            updated_at = $4::timestamptz
      where id = any($1::uuid[])
        and event_type in (
          'signal_options_shadow_entry',
          'signal_options_shadow_exit',
          'signal_options_shadow_mark'
        )
        and not (payload ? 'ledgerCorrection')
      returning id::text`,
    [[...lifecycleIds, ...markIds], CORRECTION_ID, markIds, correctedAt.toISOString(), PRIOR_CORRECTION_ID],
  );
  equal(events.rowCount, lifecycleIds.length + markIds.length, "void replacement event count");
  assertIdSet(
    events.rows.map((row) => row.id),
    [...lifecycleIds, ...markIds],
    "void replacement event ids",
  );

  const orderIds = lifecycleIds.map((eventId) => economics.ordersByEvent.get(eventId)!.id);
  const orders = await client.query<{ id: string }>(
    `update shadow_orders
        set payload = payload || jsonb_build_object(
              'forwardTest', true,
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', 'counterfactual_reentry_while_prior_position_open',
                'correctedAt', $3::text,
                'priorCorrectionId', $4::text,
                'originalForwardTestPresent', payload ? 'forwardTest',
                'originalForwardTest', payload->'forwardTest'
              )
            ),
            updated_at = $3::timestamptz
      where id = any($1::uuid[])
        and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'
        and not (payload ? 'ledgerCorrection')
      returning id::text`,
    [orderIds, CORRECTION_ID, correctedAt.toISOString(), PRIOR_CORRECTION_ID],
  );
  equal(orders.rowCount, orderIds.length, "forwardTest replacement order count");
  assertIdSet(orders.rows.map((row) => row.id), orderIds, "forwardTest replacement order ids");
  return { lifecycleIds, markIds, orderIds, fillIds: economics.invalidFillIds };
}

function correctionContract(
  current: JsonRecord | null,
  correctedAt: Date,
  status: "corrected" | "void",
  reason: string,
): JsonRecord {
  const contract = current ? structuredClone(current) : {};
  const priorCorrection = contract.ledgerCorrection;
  contract.ledgerCorrection = {
    id: CORRECTION_ID,
    status,
    reason,
    correctedAt: correctedAt.toISOString(),
    priorCorrection,
  };
  return contract;
}

async function correctPositionAndMarks(
  client: PoolClient,
  correctedAt: Date,
  position: PositionRow,
) {
  const tombstoneContract = correctionContract(
    position.option_contract,
    correctedAt,
    "void",
    "counterfactual_reentry_while_prior_position_open",
  );
  const inserted = await client.query(
    `insert into shadow_positions
       (id, account_id, position_key, symbol, asset_class, position_type,
        quantity, average_cost, mark, market_value, unrealized_pnl,
        realized_pnl, fees, option_contract, opened_at, closed_at, as_of,
        status, created_at, updated_at)
     values ($1::uuid, $2, $3, 'CIFR', 'option', $4,
             0, 1.21, 0.97, 0, 0, -271.4, 14.8, $5::jsonb,
             '2026-07-15T18:31:57.942Z'::timestamptz,
             '2026-07-15T18:46:32.056Z'::timestamptz,
             '2026-07-15T18:46:32.056Z'::timestamptz,
             'closed',
             '2026-07-15T18:31:57.942Z'::timestamptz,
             $6::timestamptz)`,
    [
      TOMBSTONE_POSITION_ID,
      ACCOUNT_ID,
      TOMBSTONE_POSITION_KEY,
      position.position_type,
      JSON.stringify(tombstoneContract),
      correctedAt.toISOString(),
    ],
  );
  equal(inserted.rowCount, 1, "CIFR tombstone position insert");

  const moved = await client.query<{ id: string }>(
    `update shadow_position_marks
        set position_id = $2::uuid, updated_at = $3::timestamptz
      where id = any($1::uuid[]) and position_id = $4::uuid
      returning id::text`,
    [TAIL_PHYSICAL_MARK_IDS, TOMBSTONE_POSITION_ID, correctedAt.toISOString(), POSITION_ID],
  );
  equal(moved.rowCount, TAIL_PHYSICAL_MARK_IDS.length, "reparented tail mark count");
  equal(idHash(moved.rows.map((row) => row.id)), TAIL_PHYSICAL_MARK_ID_SHA256, "reparented tail mark hash");

  const correctedMarks = await client.query<MarkRow>(
    `update shadow_position_marks
        set unrealized_pnl = (mark - $2::numeric) * $3::numeric,
            updated_at = $4::timestamptz
      where id = any($1::uuid[]) and position_id = $5::uuid
      returning id::text, account_id, position_id::text, mark::text,
                market_value::text, unrealized_pnl::text, source, as_of`,
    [
      RETAINED_PHYSICAL_MARK_IDS,
      RESTORED_POSITION.averageCost,
      REPLAY_EVIDENCE.quantity * REPLAY_EVIDENCE.multiplier,
      correctedAt.toISOString(),
      POSITION_ID,
    ],
  );
  equal(correctedMarks.rowCount, RETAINED_PHYSICAL_MARK_IDS.length, "corrected retained mark count");
  equal(
    idHash(correctedMarks.rows.map((row) => row.id)),
    RETAINED_PHYSICAL_MARK_ID_SHA256,
    "corrected retained mark hash",
  );
  for (const row of correctedMarks.rows) {
    money(
      row.unrealized_pnl,
      (finite(row.mark, `${row.id} mark`) - RESTORED_POSITION.averageCost) * 1100,
      `${row.id} restored unrealized P&L`,
    );
  }

  const restoredContract = correctionContract(
    position.option_contract,
    correctedAt,
    "corrected",
    "restore_retained_cifr_lifecycles_after_overlap",
  );
  const restored = await client.query(
    `update shadow_positions
        set quantity = 0, average_cost = $2, mark = $3,
            market_value = 0, unrealized_pnl = 0,
            realized_pnl = $4, fees = $5,
            opened_at = $6::timestamptz,
            closed_at = $7::timestamptz,
            as_of = $7::timestamptz,
            status = 'closed', option_contract = $8::jsonb,
            updated_at = $9::timestamptz
      where id = $1::uuid and position_key = $10 and status = 'closed'
        and average_cost = 1.21 and realized_pnl = -374.2 and fees = 44.4
        and option_contract#>>'{ledgerCorrection,id}' = $11`,
    [
      POSITION_ID,
      RESTORED_POSITION.averageCost,
      RESTORED_POSITION.mark,
      RESTORED_POSITION.realizedPnl,
      RESTORED_POSITION.fees,
      RESTORED_POSITION.openedAt,
      RESTORED_POSITION.closedAt,
      JSON.stringify(restoredContract),
      correctedAt.toISOString(),
      POSITION_KEY,
      PRIOR_CORRECTION_ID,
    ],
  );
  equal(restored.rowCount, 1, "restore CIFR position count");
  return {
    tombstonePositionId: TOMBSTONE_POSITION_ID,
    correctedPhysicalMarkIds: [...RETAINED_PHYSICAL_MARK_IDS],
    reparentedPhysicalMarkIds: [...TAIL_PHYSICAL_MARK_IDS],
  };
}

function validateFillDerivations(economics: EconomicState): void {
  const retained = ECONOMIC_LEGS.filter((item) => item.retained).map(
    (item) => economics.fillsByEvent.get(item.eventId)!,
  );
  money(
    retained.reduce((sum, row) => sum + finite(row.realized_pnl, `${row.id} realized P&L`), 0),
    RESTORED_POSITION.realizedPnl,
    "retained-fill realized P&L derivation",
  );
  money(
    retained.reduce((sum, row) => sum + finite(row.fees, `${row.id} fees`), 0),
    RESTORED_POSITION.fees,
    "retained-fill fee derivation",
  );
  money(
    economics.fillsByEvent.get("e37f718b-75f5-4719-9f87-b57b4b9ec13c")!.price,
    RESTORED_POSITION.averageCost,
    "retained latest-entry cost derivation",
  );
  money(
    economics.fillsByEvent.get("dd91f1b5-aff6-48ec-803f-c452098e2ee6")!.price,
    RESTORED_POSITION.mark,
    "retained latest-exit mark derivation",
  );
  const invalid = ECONOMIC_LEGS.filter((item) => !item.retained).map(
    (item) => economics.fillsByEvent.get(item.eventId)!,
  );
  money(
    invalid.reduce((sum, row) => sum + finite(row.cash_delta, `${row.id} cash delta`), 0),
    -278.8,
    "replacement cash derivation",
  );
  money(
    invalid.reduce((sum, row) => sum + finite(row.realized_pnl, `${row.id} realized P&L`), 0),
    -271.4,
    "replacement realized P&L derivation",
  );
  money(
    invalid.reduce((sum, row) => sum + finite(row.fees, `${row.id} fees`), 0),
    14.8,
    "replacement fee derivation",
  );
}

async function validatePostState(client: PoolClient): Promise<void> {
  const invalidEvents = [
    ...ECONOMIC_LEGS.filter((item) => !item.retained).map((item) => item.eventId),
    ...INVALID_MARK_EVENTS.map((item) => item.id),
  ];
  const events = await client.query<{ id: string; event_type: string; correction_id: string | null }>(
    `select id::text, event_type, payload#>>'{ledgerCorrection,id}' as correction_id
       from execution_events where id = any($1::uuid[]) order by id`,
    [invalidEvents],
  );
  equal(events.rowCount, invalidEvents.length, "post-state invalid event count");
  assertIdSet(events.rows.map((row) => row.id), invalidEvents, "post-state invalid event ids");
  for (const row of events.rows) {
    if (!row.event_type.endsWith("_voided")) throw new Error(`${row.id} is not voided.`);
    equal(row.correction_id, CORRECTION_ID, `${row.id} post-state correction`);
  }

  const invalidOrders = ECONOMIC_LEGS.filter((item) => !item.retained).map((item) => item.orderId!);
  const orders = await client.query<{ id: string; forward_test: string | null; correction_id: string | null }>(
    `select id::text, payload->>'forwardTest' as forward_test,
            payload#>>'{ledgerCorrection,id}' as correction_id
       from shadow_orders where id = any($1::uuid[]) order by id`,
    [invalidOrders],
  );
  equal(orders.rowCount, invalidOrders.length, "post-state invalid order count");
  for (const row of orders.rows) {
    equal(row.forward_test, "true", `${row.id} post-state forwardTest`);
    equal(row.correction_id, CORRECTION_ID, `${row.id} post-state correction`);
  }

  const positions = await client.query<PositionRow>(
    `select id::text, account_id, position_key, symbol, asset_class, position_type,
            status, quantity::text, average_cost::text, mark::text,
            market_value::text, unrealized_pnl::text, realized_pnl::text,
            fees::text, option_contract, opened_at, closed_at, as_of
       from shadow_positions where id = any($1::uuid[]) order by id`,
    [[POSITION_ID, TOMBSTONE_POSITION_ID]],
  );
  equal(positions.rowCount, 2, "post-state CIFR position count");
  const restored = positions.rows.find((row) => row.id === POSITION_ID)!;
  const tombstone = positions.rows.find((row) => row.id === TOMBSTONE_POSITION_ID)!;
  money(restored.average_cost, RESTORED_POSITION.averageCost, "post-state restored average cost");
  money(restored.mark, RESTORED_POSITION.mark, "post-state restored mark");
  money(restored.realized_pnl, RESTORED_POSITION.realizedPnl, "post-state restored realized P&L");
  money(restored.fees, RESTORED_POSITION.fees, "post-state restored fees");
  equal(iso(restored.opened_at), RESTORED_POSITION.openedAt, "post-state restored openedAt");
  equal(iso(restored.closed_at!), RESTORED_POSITION.closedAt, "post-state restored closedAt");
  equal(iso(restored.as_of), RESTORED_POSITION.closedAt, "post-state restored asOf");
  equal(optionalPath(restored.option_contract, ["ledgerCorrection", "id"]), CORRECTION_ID, "restored correction");
  equal(tombstone.position_key, TOMBSTONE_POSITION_KEY, "tombstone position key");
  money(tombstone.average_cost, 1.21, "tombstone average cost");
  money(tombstone.mark, 0.97, "tombstone mark");
  money(tombstone.realized_pnl, -271.4, "tombstone realized P&L");
  money(tombstone.fees, 14.8, "tombstone fees");
  equal(optionalPath(tombstone.option_contract, ["ledgerCorrection", "id"]), CORRECTION_ID, "tombstone correction");

  const marks = await client.query<MarkRow>(
    `select id::text, account_id, position_id::text, mark::text,
            market_value::text, unrealized_pnl::text, source, as_of
       from shadow_position_marks
      where id = any($1::uuid[]) order by id`,
    [[...RETAINED_PHYSICAL_MARK_IDS, ...TAIL_PHYSICAL_MARK_IDS]],
  );
  equal(marks.rowCount, 32, "post-state physical mark count");
  for (const row of marks.rows) {
    if (TAIL_PHYSICAL_MARK_IDS.includes(row.id as never)) {
      equal(row.position_id, TOMBSTONE_POSITION_ID, `${row.id} tombstone position`);
    } else {
      equal(row.position_id, POSITION_ID, `${row.id} restored position`);
      money(
        row.unrealized_pnl,
        (finite(row.mark, `${row.id} mark`) - RESTORED_POSITION.averageCost) * 1100,
        `${row.id} post-state unrealized P&L`,
      );
    }
  }
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
      "shadow-ledger-correction:shadow",
    ]);
    await client.query(
      "lock table execution_events, shadow_orders, shadow_fills, shadow_positions, shadow_position_marks, shadow_accounts, shadow_balance_snapshots in share row exclusive mode",
    );
    const existing = await client.query(
      `select 1 from execution_events where id = $1::uuid`,
      [CORRECTION_ID],
    );
    equal(existing.rowCount, 0, "existing CIFR follow-up correction count");
    await validatePriorCorrection(client);
    const before = await validateAccountBefore(client);
    const events = await validateEvents(client);
    validatePrematureReplayPayload(
      events.get("dd91f1b5-aff6-48ec-803f-c452098e2ee6")!.payload,
      "event",
    );
    const economics = await validateEconomics(client);
    validateFillDerivations(economics);
    const position = await validatePosition(client);
    await validatePhysicalMarks(client);

    await correctReplayEvidence(client, correctedAt, events, economics);
    const voided = await tombstoneReplacement(client, correctedAt, economics);
    const positionCorrection = await correctPositionAndMarks(client, correctedAt, position);
    const after = await recomputeAccountAndSnapshot(
      client,
      correctedAt,
      "ledger_correction",
    );
    for (const key of ["cash", "realizedPnl", "fees"] as const) {
      money(after[key], EXPECTED_AFTER[key], `expected after ${key}`);
      money(after[key] - before[key], EXPECTED_AFTER[key] - EXPECTED_BEFORE[key], `${key} correction delta`);
    }
    await validatePostState(client);

    const auditPayload = {
      correctionId: CORRECTION_ID,
      priorCorrectionId: PRIOR_CORRECTION_ID,
      status: "applied",
      reason: "counterfactual_reentry_overlap",
      correctedAt: correctedAt.toISOString(),
      replayEvidence: REPLAY_EVIDENCE,
      retainedLifecycleEventIds: ECONOMIC_LEGS.filter((item) => item.retained).map((item) => item.eventId),
      voidedLifecycleEventIds: voided.lifecycleIds,
      voidedMarkEventIds: voided.markIds,
      forwardTestOrderIds: voided.orderIds,
      preservedInvalidFillIds: voided.fillIds,
      retainedFillIds: economics.retainedFillIds,
      restoredPositionId: POSITION_ID,
      tombstonePositionId: TOMBSTONE_POSITION_ID,
      correctedPhysicalMarkIds: positionCorrection.correctedPhysicalMarkIds,
      correctedPhysicalMarkIdSha256: RETAINED_PHYSICAL_MARK_ID_SHA256,
      reparentedPhysicalMarkIds: positionCorrection.reparentedPhysicalMarkIds,
      reparentedPhysicalMarkIdSha256: TAIL_PHYSICAL_MARK_ID_SHA256,
      allPhysicalMarkIdSha256: ALL_PHYSICAL_MARK_ID_SHA256,
      restoredPosition: RESTORED_POSITION,
      before,
      after,
      deltas: {
        cash: after.cash - before.cash,
        realizedPnl: after.realizedPnl - before.realizedPnl,
        fees: after.fees - before.fees,
      },
    };
    const audit = await client.query(
      `insert into execution_events
         (id, deployment_id, provider_account_id, event_type, summary, payload,
          occurred_at, created_at, updated_at)
       values ($1::uuid, $2::uuid, $3, 'signal_options_ledger_correction',
               $4, $5::jsonb, $6::timestamptz, $6::timestamptz, $6::timestamptz)`,
      [
        CORRECTION_ID,
        DEPLOYMENT_ID,
        ACCOUNT_ID,
        "Corrected the overlapping CIFR replay/re-entry lifecycles from 2026-07-15",
        JSON.stringify(auditPayload),
        correctedAt.toISOString(),
      ],
    );
    equal(audit.rowCount, 1, "CIFR correction audit event count");

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

export const __shadowLedgerCifrReplayOverlapCorrection20260715InternalsForTests = {
  CORRECTION_ID,
  TOMBSTONE_POSITION_ID,
  PRIOR_CORRECTION_ID,
  REPLAY_EVIDENCE,
  mode,
  validatePlan,
  replayPayload,
};
