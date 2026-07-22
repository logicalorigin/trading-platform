import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { recomputeAccountAndSnapshot } from "./correct-shadow-ledger-2026-07-15";

const CORRECTION_ID = "ddf5e2af-ab87-4edc-9029-6d5ae9061bd7";
const ACCOUNT_ID = "shadow";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const DUPLICATE_NVO_EXIT_ID = "67aee151-c491-43da-a35a-a9572a8080e0";
const VOID_AXTI_ENTRY_ID = "07a0ba0e-9719-45bc-af0f-0bed9160ffd5";
const VOID_AXTI_EXIT_ID = "95980ca2-604d-4659-98bc-8199a880cbff";
const EOD_START = new Date("2026-07-15T19:45:00.000Z");
const EOD_END = new Date("2026-07-15T20:00:00.000Z");

type Mode = "dry-run" | "apply";
type Correction = {
  symbol: string;
  eventId: string;
  positionId: string;
  occurredAt: string;
  reason: "hard_stop" | "runner_trail_stop" | "overnight_risk_exit";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  peakPrice: number;
  markPrice: number;
  bid: number;
  ask: number;
  stopPrice: number;
};

const CORRECTIONS: readonly Correction[] = [
  {
    symbol: "AXTI",
    eventId: "871c9b38-9781-4c52-8eab-11fb6e8c7c74",
    positionId: "a5bfa555-e674-45da-9fb2-4a560166a7b4",
    occurredAt: "2026-07-15T19:45:49.948Z",
    reason: "overnight_risk_exit",
    entryPrice: 4.57,
    exitPrice: 3.65,
    quantity: 3,
    peakPrice: 4.57,
    markPrice: 4.1,
    bid: 3.6,
    ask: 4.6,
    stopPrice: 3.66,
  },
  {
    symbol: "CIFR",
    eventId: "dd91f1b5-aff6-48ec-803f-c452098e2ee6",
    positionId: "d7390839-e9a3-433e-9a77-a6eb043d0e6b",
    occurredAt: "2026-07-15T18:45:30.481Z",
    reason: "runner_trail_stop",
    entryPrice: 0.86,
    exitPrice: 0.99,
    quantity: 11,
    peakPrice: 1.18,
    markPrice: 0.985,
    bid: 0.93,
    ask: 1.04,
    stopPrice: 0.99,
  },
  {
    symbol: "CLSK",
    eventId: "7a6bff89-99d0-4ae6-993d-080e8d57c686",
    positionId: "31e16c63-1db9-4cb2-bb42-aeadf0faac91",
    occurredAt: "2026-07-15T18:58:17.682Z",
    reason: "hard_stop",
    entryPrice: 0.61,
    exitPrice: 0.49,
    quantity: 11,
    peakPrice: 0.61,
    markPrice: 0.49,
    bid: 0.44,
    ask: 0.54,
    stopPrice: 0.49,
  },
  {
    symbol: "CRCG",
    eventId: "9ea35ec5-694a-4eb7-b0ae-574673a66a98",
    positionId: "006a55cb-6366-4221-9076-05318cab71b3",
    occurredAt: "2026-07-15T19:45:04.170Z",
    reason: "overnight_risk_exit",
    entryPrice: 1.19,
    exitPrice: 1.07,
    quantity: 11,
    peakPrice: 1.25,
    markPrice: 1.25,
    bid: 1.05,
    ask: 1.45,
    stopPrice: 0.95,
  },
] as const;

function mode(): Mode {
  const value = process.env.SHADOW_LEDGER_CORRECTION_MODE?.trim() || "dry-run";
  if (value !== "dry-run" && value !== "apply") {
    throw new Error("SHADOW_LEDGER_CORRECTION_MODE must be dry-run or apply.");
  }
  return value;
}

function finite(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected finite number, got ${String(value)}.`);
  return parsed;
}

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}.`);
}

async function correctionTargets(client: PoolClient) {
  const eod = await client.query<{
    symbol: string;
    entry_event: string;
    exit_event: string;
    position_id: string;
  }>(
    `with events as (
       select id, symbol, event_type, occurred_at, payload,
              payload->'position'->>'candidateId' candidate_id
         from execution_events
        where occurred_at >= $1 and occurred_at < $2
          and event_type in ('signal_options_shadow_entry', 'signal_options_shadow_exit')
     )
     select entry.symbol, entry.id::text entry_event, exit.id::text exit_event,
            position.id::text position_id
       from events entry
       join events exit on exit.candidate_id = entry.candidate_id
                       and exit.event_type = 'signal_options_shadow_exit'
       join shadow_positions position
         on position.symbol = entry.symbol and position.opened_at = entry.occurred_at
      where entry.event_type = 'signal_options_shadow_entry'
      order by entry.symbol`,
    [EOD_START, EOD_END],
  );
  equal(eod.rowCount, 9, "post-cutoff lifecycle count");
  const lifecycleEventIds = eod.rows.flatMap((row) => [row.entry_event, row.exit_event]);
  lifecycleEventIds.push(VOID_AXTI_ENTRY_ID, VOID_AXTI_EXIT_ID);
  const orders = await client.query<{ id: string; source_event_id: string }>(
    `select id::text, source_event_id::text
       from shadow_orders
      where source_event_id = any($1::uuid[])
      order by id
      for update`,
    [lifecycleEventIds],
  );
  equal(orders.rowCount, lifecycleEventIds.length, "void order count");
  return {
    eod: eod.rows,
    lifecycleEventIds,
    orderIds: orders.rows.map((row) => row.id),
    positionIds: eod.rows.map((row) => row.position_id),
  };
}

async function tombstoneInvalidRows(
  client: PoolClient,
  targets: Awaited<ReturnType<typeof correctionTargets>>,
  correctedAt: Date,
) {
  const eventIds = [...targets.lifecycleEventIds, DUPLICATE_NVO_EXIT_ID];
  const events = await client.query(
    `update execution_events
        set event_type = event_type || '_voided',
            summary = '[VOIDED ' || $2 || '] ' || summary,
            payload = payload || jsonb_build_object(
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', case when id = $3::uuid
                  then 'duplicate_exit_without_order_or_fill'
                  else 'invalid_entry_lifecycle' end,
                'correctedAt', $4::text,
                'originalEventType', event_type,
                'originalSummary', summary
              )
            ),
            updated_at = $4::timestamptz
      where id = any($1::uuid[]) and not (payload ? 'ledgerCorrection')`,
    [eventIds, CORRECTION_ID, DUPLICATE_NVO_EXIT_ID, correctedAt],
  );
  equal(events.rowCount, eventIds.length, "void event update count");

  const orders = await client.query(
    `update shadow_orders
        set payload = payload || jsonb_build_object(
              'forwardTest', true,
              'ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', 'invalid_entry_lifecycle', 'correctedAt', $3::text
              )
            ),
            updated_at = $3::timestamptz
      where id = any($1::uuid[])
        and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'
        and not (payload ? 'ledgerCorrection')`,
    [targets.orderIds, CORRECTION_ID, correctedAt],
  );
  equal(orders.rowCount, targets.orderIds.length, "void order update count");

  const positions = await client.query(
    `update shadow_positions
        set position_key = 'shadow_equity_forward:ledger_correction:' || $2 || ':' || position_key,
            option_contract = coalesce(option_contract, '{}'::jsonb) ||
              jsonb_build_object('ledgerCorrection', jsonb_build_object(
                'id', $2::text, 'status', 'void',
                'reason', 'entry_cutoff_window', 'correctedAt', $3::text
              )),
            updated_at = $3::timestamptz
      where id = any($1::uuid[]) and status = 'closed'`,
    [targets.positionIds, CORRECTION_ID, correctedAt],
  );
  equal(positions.rowCount, targets.positionIds.length, "void position update count");
}

async function correctReplayedExits(client: PoolClient, correctedAt: Date) {
  for (const item of CORRECTIONS) {
    const linked = await client.query<{
      order_id: string;
      fill_id: string;
      original_fill_realized: string;
      fees: string;
    }>(
      `select orders.id::text order_id, fills.id::text fill_id,
              fills.realized_pnl::text original_fill_realized, fills.fees::text fees
         from shadow_orders orders
         join shadow_fills fills on fills.order_id = orders.id
        where orders.source_event_id = $1::uuid
        for update of orders, fills`,
      [item.eventId],
    );
    equal(linked.rowCount, 1, `${item.symbol} linked exit rows`);
    const row = linked.rows[0]!;
    const grossPnl = Number(((item.exitPrice - item.entryPrice) * item.quantity * 100).toFixed(2));
    const grossAmount = Number((item.exitPrice * item.quantity * 100).toFixed(2));
    const fillRealized = Number((grossPnl - finite(row.fees)).toFixed(2));
    const cashDelta = Number((grossAmount - finite(row.fees)).toFixed(2));
    const correction = {
      id: CORRECTION_ID,
      status: "corrected",
      reason: "position_lifecycle_peak_cache_reuse",
      correctedAt: correctedAt.toISOString(),
      source: "Massive historical quote replay",
    };
    const event = await client.query(
      `update execution_events
          set occurred_at = $2, summary = $3,
              payload = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
                payload || jsonb_build_object('ledgerCorrection', $4::jsonb),
                '{reason}', to_jsonb($5::text), true),
                '{exitPrice}', to_jsonb($6::numeric), true),
                '{pnl}', to_jsonb($7::numeric), true),
                '{position,peakPrice}', to_jsonb($8::numeric), true),
              updated_at = $9::timestamptz
        where id = $1::uuid and not (payload ? 'ledgerCorrection')`,
      [
        item.eventId,
        item.occurredAt,
        `${item.symbol} shadow exit ${item.reason} at ${item.exitPrice.toFixed(2)}`,
        JSON.stringify(correction),
        item.reason,
        item.exitPrice,
        grossPnl,
        item.peakPrice,
        correctedAt,
      ],
    );
    equal(event.rowCount, 1, `${item.symbol} event correction`);
    const order = await client.query(
      `update shadow_orders
          set limit_price = $2, average_fill_price = $2,
              placed_at = $3, filled_at = $3,
              payload = jsonb_set(jsonb_set(
                jsonb_set(jsonb_set(
                  payload || jsonb_build_object('ledgerCorrection', $4::jsonb),
                  '{reason}', to_jsonb($6::text), true),
                  '{exitReason}', to_jsonb($6::text), true),
                '{exitPrice}', to_jsonb($2::numeric), true),
                '{pnl}', to_jsonb($5::numeric), true),
              updated_at = $7::timestamptz
        where id = $1::uuid and not (payload ? 'ledgerCorrection')`,
      [
        row.order_id,
        item.exitPrice,
        item.occurredAt,
        JSON.stringify(correction),
        grossPnl,
        item.reason,
        correctedAt,
      ],
    );
    equal(order.rowCount, 1, `${item.symbol} order correction`);
    const fill = await client.query(
      `update shadow_fills
          set price = $2, gross_amount = $3, realized_pnl = $4,
              cash_delta = $5, occurred_at = $6::timestamptz,
              updated_at = $7::timestamptz
        where id = $1::uuid`,
      [row.fill_id, item.exitPrice, grossAmount, fillRealized, cashDelta, item.occurredAt, correctedAt],
    );
    equal(fill.rowCount, 1, `${item.symbol} fill correction`);
    const position = await client.query(
      `update shadow_positions
          set mark = $2, realized_pnl = realized_pnl + $3,
              closed_at = case when symbol in ('AXTI', 'CLSK', 'CRCG') then $4 else closed_at end,
              opened_at = case when symbol = 'AXTI' then '2026-07-15T17:17:41.530Z'::timestamptz else opened_at end,
              average_cost = case when symbol = 'AXTI' then 4.57 else average_cost end,
              option_contract = coalesce(option_contract, '{}'::jsonb) ||
                jsonb_build_object('ledgerCorrection', $5::jsonb),
              updated_at = $6::timestamptz
        where id = $1::uuid`,
      [
        item.positionId,
        item.exitPrice,
        fillRealized - finite(row.original_fill_realized),
        item.occurredAt,
        JSON.stringify(correction),
        correctedAt,
      ],
    );
    equal(position.rowCount, 1, `${item.symbol} position correction`);
  }
}

async function apply(modeValue = mode()) {
  const client = await pool.connect();
  const correctedAt = new Date();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '60s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `shadow-ledger-correction:${CORRECTION_ID}`,
    ]);
    await client.query(
      "lock table execution_events, shadow_orders, shadow_fills, shadow_positions, shadow_accounts in share row exclusive mode",
    );
    const existing = await client.query("select 1 from execution_events where id = $1", [CORRECTION_ID]);
    equal(existing.rowCount, 0, "existing correction event count");
    const account = await client.query<{
      cash: string;
      realized_pnl: string;
      fees: string;
    }>(
      "select cash::text, realized_pnl::text, fees::text from shadow_accounts where id = $1 for update",
      [ACCOUNT_ID],
    );
    equal(account.rowCount, 1, "shadow account row count");
    const before = {
      cash: finite(account.rows[0]!.cash),
      realizedPnl: finite(account.rows[0]!.realized_pnl),
      fees: finite(account.rows[0]!.fees),
    };
    const targets = await correctionTargets(client);
    await tombstoneInvalidRows(client, targets, correctedAt);
    await correctReplayedExits(client, correctedAt);
    const after = await recomputeAccountAndSnapshot(client, correctedAt, "ledger_correction");
    await client.query(
      `insert into execution_events
         (id, deployment_id, provider_account_id, event_type, summary, payload,
          occurred_at, created_at, updated_at)
       values ($1, $2, $3, 'signal_options_ledger_correction', $4, $5::jsonb, $6, $6, $6)`,
      [
        CORRECTION_ID,
        DEPLOYMENT_ID,
        ACCOUNT_ID,
        "Corrected duplicate exits, stale lifecycle peaks, and post-cutoff entries from 2026-07-15",
        JSON.stringify({
          correctionId: CORRECTION_ID,
          status: "applied",
          correctedAt: correctedAt.toISOString(),
          replayedExitEventIds: CORRECTIONS.map((item) => item.eventId),
          voidedLifecycleEventIds: targets.lifecycleEventIds,
          voidedDuplicateExitEventId: DUPLICATE_NVO_EXIT_ID,
          before,
          after,
        }),
        correctedAt,
      ],
    );
    if (modeValue === "dry-run") await client.query("rollback");
    else await client.query("commit");
    return {
      correctionId: CORRECTION_ID,
      mode: modeValue,
      status: modeValue === "dry-run" ? "validated_rolled_back" : "applied",
      before,
      after,
      delta: {
        cash: Number((after.cash - before.cash).toFixed(2)),
        realizedPnl: Number((after.realizedPnl - before.realizedPnl).toFixed(2)),
        fees: Number((after.fees - before.fees).toFixed(2)),
      },
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
  apply()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

export const __shadowLedgerStopEodCorrection20260715InternalsForTests = {
  CORRECTION_ID,
  CORRECTIONS,
  mode,
};
