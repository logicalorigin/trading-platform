import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

const CORRECTION_ID = "597497fa-825a-4a15-921b-b32cc4d699da";
const ACCOUNT_ID = "shadow";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const FORWARD_POSITION_PREFIX = `shadow_equity_forward:ledger_correction:${CORRECTION_ID}:`;

type Mode =
  | "dry-run"
  | "apply"
  | "reconcile"
  | "revert"
  | "revert-dry-run";

type InvalidLifecycle = {
  symbol: string;
  entryEventId: string;
  entryOrderId: string;
  entryFillId: string;
  exitEventId: string;
  exitOrderId: string;
  exitFillId: string;
  positionId: string;
  positionKey: string;
};

const INVALID_LIFECYCLES: readonly InvalidLifecycle[] = [
  {
    symbol: "BMNG",
    entryEventId: "1eee8c60-ce2c-4a34-bd72-054313265406",
    entryOrderId: "af6ed7fe-ce64-44e8-b5d9-df93e44b62d9",
    entryFillId: "2454bf54-af5e-4931-b0db-05c7b172bca3",
    exitEventId: "ff7c049a-634a-4c94-afdd-82cc6d1d35f7",
    exitOrderId: "307ed40c-d539-439c-aeaa-0b2e9c92085a",
    exitFillId: "ab8569fc-9379-425c-8572-3f1d09649263",
    positionId: "e6f07de2-9a2d-42a6-be10-bc095e3b2d17",
    positionKey: "option:BMNG:2026-07-17:11:put:O:BMNG1260717P00011000",
  },
  {
    symbol: "FBTC",
    entryEventId: "0ed59080-9ec0-4387-8c6a-df7d36893c8e",
    entryOrderId: "b020a453-c311-489e-86c3-014a8ba01d00",
    entryFillId: "d45a8162-2fcf-4d5f-83db-0eb84d7118fe",
    exitEventId: "520e8249-c3c4-4f0b-ad93-f092534c5150",
    exitOrderId: "8eb13abd-f27a-4318-9b91-73ba615f8b66",
    exitFillId: "5492f08c-591b-47b9-9be1-07409369ba66",
    positionId: "d30b118e-525f-4436-8ab8-8888b76365d8",
    positionKey: "option:FBTC:2026-07-17:55:put:O:FBTC260717P00055000",
  },
  {
    symbol: "EOG",
    entryEventId: "077bfc57-566f-46a3-af4f-7549a16f93f7",
    entryOrderId: "355cab50-a422-443d-ab73-741906dcdbce",
    entryFillId: "04c773a3-861e-4aa3-a732-2b6b751828ae",
    exitEventId: "eca400c5-15cb-4712-8472-b5b8704e64dd",
    exitOrderId: "b8039464-18a1-4a96-a650-5c4646c3460b",
    exitFillId: "1b4d6ec9-d7c3-4df5-9de6-630514d54127",
    positionId: "c04fca5a-7120-4bcb-b140-7c6e5cdcd54d",
    positionKey: "option:EOG:2026-07-17:135:call:O:EOG260717C00135000",
  },
] as const;

const AAOI_DUPLICATE_EVENT_ID = "8bb4d7ff-7d4b-424b-9dff-d9ff74e6f79f";

type ExitPriceCorrection = {
  symbol: string;
  eventId: string;
  orderId: string;
  fillId: string;
  positionId: string;
  originalPrice: number;
  correctedPrice: number;
  originalGrossPnl: number;
  correctedGrossPnl: number;
  originalFillRealizedPnl: number;
  correctedFillRealizedPnl: number;
  originalCashDelta: number;
  correctedCashDelta: number;
  correctedHardStopPrice: number;
  correctedTrailStopPrice: number | null;
  originalSummary: string;
  correctedSummary: string;
};

const EXIT_PRICE_CORRECTIONS: readonly ExitPriceCorrection[] = [
  {
    symbol: "TSLQ",
    eventId: "52a667d4-340e-40f1-8424-3f3909a6855b",
    orderId: "bbaaaa35-3cdc-46bc-aa4e-0159f8df742c",
    fillId: "6a65560d-90d7-44e4-bf18-0806d313cbb0",
    positionId: "9521e86e-dfd6-4152-bc5c-7a50872ea38c",
    originalPrice: 2.82,
    correctedPrice: 2.94,
    originalGrossPnl: 130,
    correctedGrossPnl: 190,
    originalFillRealizedPnl: 126.64,
    correctedFillRealizedPnl: 186.64,
    originalCashDelta: 1406.64,
    correctedCashDelta: 1466.64,
    correctedHardStopPrice: 2.05,
    correctedTrailStopPrice: 2.94,
    originalSummary: "TSLQ shadow exit runner_trail_stop at 2.82",
    correctedSummary: "TSLQ shadow exit runner_trail_stop at 2.94",
  },
  {
    symbol: "UCTT",
    eventId: "13eaeeed-54a9-4c3e-bde0-3f381f119b04",
    orderId: "c329a95c-e4ab-4af8-ab90-e761bc4dbe14",
    fillId: "88c53bdf-2546-4a92-8f48-c6d9f3256a38",
    positionId: "e46cdc95-2f6b-45d1-a3b6-6f7aa7aaea84",
    originalPrice: 4.71,
    correctedPrice: 6.28,
    originalGrossPnl: -314,
    correctedGrossPnl: -157,
    originalFillRealizedPnl: -314.67,
    correctedFillRealizedPnl: -157.67,
    originalCashDelta: 470.33,
    correctedCashDelta: 627.33,
    correctedHardStopPrice: 6.28,
    correctedTrailStopPrice: null,
    originalSummary: "UCTT shadow exit hard_stop at 4.71",
    correctedSummary: "UCTT shadow exit hard_stop at 6.28",
  },
] as const;

const INVALID_EVENT_IDS = [
  ...INVALID_LIFECYCLES.flatMap((item) => [
    item.entryEventId,
    item.exitEventId,
  ]),
  AAOI_DUPLICATE_EVENT_ID,
] as const;
const INVALID_ORDER_IDS = INVALID_LIFECYCLES.flatMap((item) => [
  item.entryOrderId,
  item.exitOrderId,
]);
const INVALID_FILL_IDS = INVALID_LIFECYCLES.flatMap((item) => [
  item.entryFillId,
  item.exitFillId,
]);

function readMode(value = process.env.SHADOW_LEDGER_CORRECTION_MODE): Mode {
  const mode = (value?.trim() || "dry-run") as Mode;
  if (
    !["dry-run", "apply", "reconcile", "revert", "revert-dry-run"].includes(
      mode,
    )
  ) {
    throw new Error(
      "SHADOW_LEDGER_CORRECTION_MODE must be dry-run, apply, reconcile, revert, or revert-dry-run.",
    );
  }
  return mode;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a finite numeric database value, received ${String(value)}.`);
  }
  return parsed;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function assertMoney(actual: unknown, expected: number, label: string): void {
  if (Math.abs(numeric(actual) - expected) > 0.000001) {
    throw new Error(`${label}: expected ${expected.toFixed(6)}, received ${String(actual)}.`);
  }
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate identifiers.`);
  }
}

function validatePlan(): void {
  unique(INVALID_EVENT_IDS, "invalid event ids");
  unique(INVALID_ORDER_IDS, "invalid order ids");
  unique(INVALID_FILL_IDS, "invalid fill ids");
  unique(EXIT_PRICE_CORRECTIONS.map((item) => item.eventId), "price event ids");
  for (const item of EXIT_PRICE_CORRECTIONS) {
    assertMoney(
      item.correctedCashDelta - item.originalCashDelta,
      item.correctedFillRealizedPnl - item.originalFillRealizedPnl,
      `${item.symbol} cash/realized correction parity`,
    );
  }
}

async function lockAndValidateBaseRows(client: PoolClient): Promise<{
  cash: number;
  realizedPnl: number;
  fees: number;
}> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`shadow-ledger-correction:${CORRECTION_ID}`],
  );
  const accountResult = await client.query(
    `select starting_balance, cash, realized_pnl, fees
       from shadow_accounts where id = $1 for update`,
    [ACCOUNT_ID],
  );
  assertEqual(accountResult.rowCount, 1, "shadow account row count");

  const eventResult = await client.query(
    `select id::text, event_type, symbol, summary, payload
       from execution_events where id = any($1::uuid[]) for update`,
    [INVALID_EVENT_IDS],
  );
  assertEqual(eventResult.rowCount, INVALID_EVENT_IDS.length, "invalid event row count");
  for (const item of INVALID_LIFECYCLES) {
    const entry = eventResult.rows.find((row) => row.id === item.entryEventId);
    const exit = eventResult.rows.find((row) => row.id === item.exitEventId);
    if (!entry || !exit) throw new Error(`Missing ${item.symbol} lifecycle event.`);
    assertEqual(entry.symbol, item.symbol, `${item.symbol} entry event symbol`);
    assertEqual(exit.symbol, item.symbol, `${item.symbol} exit event symbol`);
    assertEqual(
      entry.event_type,
      "signal_options_shadow_entry",
      `${item.symbol} entry event type`,
    );
    assertEqual(
      exit.event_type,
      "signal_options_shadow_exit",
      `${item.symbol} exit event type`,
    );
  }
  const duplicateEvent = eventResult.rows.find(
    (row) => row.id === AAOI_DUPLICATE_EVENT_ID,
  );
  if (!duplicateEvent) throw new Error("Missing AAOI duplicate exit event.");
  assertEqual(duplicateEvent.symbol, "AAOI", "AAOI duplicate event symbol");
  assertEqual(
    duplicateEvent.event_type,
    "signal_options_shadow_exit",
    "AAOI duplicate event type",
  );

  const orderResult = await client.query(
    `select id::text, source_event_id::text, source, status, account_id,
            symbol, side, quantity, filled_quantity, payload
       from shadow_orders where id = any($1::uuid[]) for update`,
    [INVALID_ORDER_IDS],
  );
  assertEqual(orderResult.rowCount, INVALID_ORDER_IDS.length, "invalid order row count");
  for (const row of orderResult.rows) {
    assertEqual(row.account_id, ACCOUNT_ID, `${row.id} account`);
    assertEqual(row.source, "automation", `${row.id} source`);
    assertEqual(row.status, "filled", `${row.id} status`);
  }

  const fillResult = await client.query(
    `select id::text, order_id::text, source_event_id::text, account_id,
            symbol, side, quantity, price, gross_amount, option_contract,
            cash_delta, realized_pnl, fees
       from shadow_fills where id = any($1::uuid[]) for update`,
    [INVALID_FILL_IDS],
  );
  assertEqual(fillResult.rowCount, INVALID_FILL_IDS.length, "invalid fill row count");
  for (const item of INVALID_LIFECYCLES) {
    for (const leg of [
      {
        label: "entry",
        eventId: item.entryEventId,
        orderId: item.entryOrderId,
        fillId: item.entryFillId,
        side: "buy",
      },
      {
        label: "exit",
        eventId: item.exitEventId,
        orderId: item.exitOrderId,
        fillId: item.exitFillId,
        side: "sell",
      },
    ] as const) {
      const order = orderResult.rows.find((row) => row.id === leg.orderId);
      const fill = fillResult.rows.find((row) => row.id === leg.fillId);
      if (!order || !fill) {
        throw new Error(`Missing ${item.symbol} ${leg.label} order/fill.`);
      }
      assertEqual(order.source_event_id, leg.eventId, `${item.symbol} order event`);
      assertEqual(fill.source_event_id, leg.eventId, `${item.symbol} fill event`);
      assertEqual(fill.order_id, leg.orderId, `${item.symbol} fill order`);
      assertEqual(order.symbol, item.symbol, `${item.symbol} order symbol`);
      assertEqual(fill.symbol, item.symbol, `${item.symbol} fill symbol`);
      assertEqual(order.side, leg.side, `${item.symbol} order side`);
      assertEqual(fill.side, leg.side, `${item.symbol} fill side`);
      assertEqual(fill.account_id, ACCOUNT_ID, `${item.symbol} fill account`);
      assertMoney(fill.quantity, numeric(order.quantity), `${item.symbol} quantity`);
      assertMoney(
        order.filled_quantity,
        numeric(order.quantity),
        `${item.symbol} filled quantity`,
      );
      const multiplier = numeric(fill.option_contract?.multiplier ?? 100);
      assertMoney(
        fill.gross_amount,
        numeric(fill.price) * numeric(fill.quantity) * multiplier,
        `${item.symbol} gross amount`,
      );
    }
  }
  const invalidTotals = fillResult.rows.reduce(
    (sum, row) => ({
      cash: sum.cash + numeric(row.cash_delta),
      realizedPnl: sum.realizedPnl + numeric(row.realized_pnl),
      fees: sum.fees + numeric(row.fees),
    }),
    { cash: 0, realizedPnl: 0, fees: 0 },
  );
  assertMoney(invalidTotals.cash, -806.84, "invalid lifecycle cash delta");
  assertMoney(invalidTotals.realizedPnl, -797.42, "invalid lifecycle realized P&L");
  assertMoney(invalidTotals.fees, 18.84, "invalid lifecycle fees");

  const positionResult = await client.query(
    `select id::text, position_key, status, quantity, option_contract
       from shadow_positions
      where id = any($1::uuid[]) for update`,
    [INVALID_LIFECYCLES.map((item) => item.positionId)],
  );
  assertEqual(
    positionResult.rowCount,
    INVALID_LIFECYCLES.length,
    "invalid lifecycle position row count",
  );
  for (const item of INVALID_LIFECYCLES) {
    const row = positionResult.rows.find((candidate) => candidate.id === item.positionId);
    if (!row) throw new Error(`Missing ${item.symbol} position ${item.positionId}.`);
    assertEqual(row.position_key, item.positionKey, `${item.symbol} position key`);
    assertEqual(row.status, "closed", `${item.symbol} position status`);
    assertMoney(row.quantity, 0, `${item.symbol} position quantity`);
  }

  const uniqueContractResult = await client.query(
    `select p.id::text, count(f.id)::int as fill_count
       from shadow_positions p
       join shadow_fills f
         on f.account_id = p.account_id
        and f.option_contract->>'ticker' = p.option_contract->>'ticker'
      where p.id = any($1::uuid[])
      group by p.id`,
    [INVALID_LIFECYCLES.map((item) => item.positionId)],
  );
  assertEqual(
    uniqueContractResult.rowCount,
    INVALID_LIFECYCLES.length,
    "invalid position contract census",
  );
  for (const row of uniqueContractResult.rows) {
    assertEqual(row.fill_count, 2, `${row.id} all-time contract fill count`);
  }

  const priceResult = await client.query(
    `select e.id::text as event_id, e.symbol as event_symbol,
            e.summary as event_summary,
            e.payload->>'exitPrice' as event_price,
            e.payload->>'pnl' as event_pnl,
            e.payload->'stop' = e.payload#>'{position,lastStop}' as event_stops_match,
            o.id::text as order_id, o.symbol as order_symbol, o.side as order_side,
            o.quantity as order_quantity, o.average_fill_price, o.limit_price,
            o.payload->'stop' = o.payload#>'{position,lastStop}' as order_stops_match,
            f.id::text as fill_id, f.symbol as fill_symbol, f.side as fill_side,
            f.quantity as fill_quantity, f.price, f.realized_pnl, f.cash_delta,
            p.id::text as position_id
       from execution_events e
       join shadow_orders o on o.source_event_id = e.id
       join shadow_fills f on f.order_id = o.id
       join shadow_positions p
         on p.account_id = f.account_id
        and p.option_contract->>'ticker' = f.option_contract->>'ticker'
      where e.id = any($1::uuid[])
      for update of e, o, f, p`,
    [EXIT_PRICE_CORRECTIONS.map((item) => item.eventId)],
  );
  assertEqual(
    priceResult.rowCount,
    EXIT_PRICE_CORRECTIONS.length,
    "price correction row count",
  );
  for (const item of EXIT_PRICE_CORRECTIONS) {
    const row = priceResult.rows.find((candidate) => candidate.event_id === item.eventId);
    if (!row) throw new Error(`Missing ${item.symbol} price-correction row.`);
    assertEqual(row.order_id, item.orderId, `${item.symbol} order id`);
    assertEqual(row.fill_id, item.fillId, `${item.symbol} fill id`);
    assertEqual(row.position_id, item.positionId, `${item.symbol} position id`);
    assertEqual(row.event_symbol, item.symbol, `${item.symbol} event symbol`);
    assertEqual(row.order_symbol, item.symbol, `${item.symbol} order symbol`);
    assertEqual(row.fill_symbol, item.symbol, `${item.symbol} fill symbol`);
    assertEqual(row.order_side, "sell", `${item.symbol} order side`);
    assertEqual(row.fill_side, "sell", `${item.symbol} fill side`);
    assertMoney(row.fill_quantity, numeric(row.order_quantity), `${item.symbol} quantity`);
    assertEqual(row.event_summary, item.originalSummary, `${item.symbol} event summary`);
    assertEqual(row.event_stops_match, true, `${item.symbol} event stop parity`);
    assertEqual(row.order_stops_match, true, `${item.symbol} order stop parity`);
    assertMoney(row.event_price, item.originalPrice, `${item.symbol} event price`);
    assertMoney(row.event_pnl, item.originalGrossPnl, `${item.symbol} event P&L`);
    assertMoney(row.average_fill_price, item.originalPrice, `${item.symbol} order price`);
    assertMoney(row.limit_price, item.originalPrice, `${item.symbol} order limit`);
    assertMoney(row.price, item.originalPrice, `${item.symbol} fill price`);
    assertMoney(
      row.realized_pnl,
      item.originalFillRealizedPnl,
      `${item.symbol} fill realized P&L`,
    );
    assertMoney(row.cash_delta, item.originalCashDelta, `${item.symbol} fill cash`);
  }

  const ledgerResult = await client.query(
    `select a.starting_balance + coalesce(sum(f.cash_delta), 0) as cash,
            coalesce(sum(f.realized_pnl), 0) as realized_pnl,
            coalesce(sum(f.fees), 0) as fees
       from shadow_accounts a
       left join shadow_fills f on f.account_id = a.id
      where a.id = $1
      group by a.id`,
    [ACCOUNT_ID],
  );
  const account = accountResult.rows[0]!;
  const ledger = ledgerResult.rows[0]!;
  assertMoney(account.cash, numeric(ledger.cash), "pre-correction account cash fold");
  assertMoney(
    account.realized_pnl,
    numeric(ledger.realized_pnl),
    "pre-correction account realized fold",
  );
  assertMoney(account.fees, numeric(ledger.fees), "pre-correction account fee fold");

  return {
    cash: numeric(account.cash),
    realizedPnl: numeric(account.realized_pnl),
    fees: numeric(account.fees),
  };
}

async function applyInvalidLifecycleTombstones(
  client: PoolClient,
  correctedAt: Date,
): Promise<void> {
  for (const eventId of INVALID_EVENT_IDS) {
    const reason =
      eventId === AAOI_DUPLICATE_EVENT_ID
        ? "duplicate_exit_without_order_or_fill"
        : "prior_session_signal";
    const result = await client.query(
      `update execution_events
          set event_type = event_type || '_voided',
              summary = '[VOIDED ${CORRECTION_ID}] ' || summary,
              payload = payload || jsonb_build_object(
                'ledgerCorrection', jsonb_build_object(
                  'id', $2::text,
                  'status', 'void',
                  'reason', $4::text,
                  'correctedAt', $3::text,
                  'originalEventType', event_type,
                  'originalSummary', summary
                )
              ),
              updated_at = $3::timestamptz
        where id = $1::uuid
          and event_type in ('signal_options_shadow_entry', 'signal_options_shadow_exit')
          and not (payload ? 'ledgerCorrection')`,
      [eventId, CORRECTION_ID, correctedAt.toISOString(), reason],
    );
    assertEqual(result.rowCount, 1, `${eventId} event tombstone update`);
  }

  for (const orderId of INVALID_ORDER_IDS) {
    const result = await client.query(
      `update shadow_orders
          set payload = (payload || jsonb_build_object(
                'forwardTest', true,
                'ledgerCorrection', jsonb_build_object(
                  'id', $2::text,
                  'status', 'void',
                  'reason', 'prior_session_signal',
                  'correctedAt', $3::text,
                  'originalForwardTestPresent', payload ? 'forwardTest',
                  'originalForwardTest', payload->'forwardTest'
                )
              )),
              updated_at = $3::timestamptz
        where id = $1::uuid
          and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'
          and not (payload ? 'ledgerCorrection')`,
      [orderId, CORRECTION_ID, correctedAt.toISOString()],
    );
    assertEqual(result.rowCount, 1, `${orderId} order tombstone update`);
  }

  for (const item of INVALID_LIFECYCLES) {
    const result = await client.query(
      `update shadow_positions
          set position_key = $2,
              option_contract = coalesce(option_contract, '{}'::jsonb) ||
                jsonb_build_object(
                  'ledgerCorrection', jsonb_build_object(
                    'id', $3::text,
                    'status', 'void',
                    'reason', 'prior_session_signal',
                    'correctedAt', $4::text,
                    'originalPositionKey', position_key
                  )
                ),
              updated_at = $4::timestamptz
        where id = $1::uuid
          and position_key = $5
          and status = 'closed'`,
      [
        item.positionId,
        `${FORWARD_POSITION_PREFIX}${item.positionKey}`,
        CORRECTION_ID,
        correctedAt.toISOString(),
        item.positionKey,
      ],
    );
    assertEqual(result.rowCount, 1, `${item.symbol} position tombstone update`);
  }
}

function correctedStopPatch(item: ExitPriceCorrection): Record<string, unknown> {
  return item.correctedTrailStopPrice == null
    ? {
        stopPrice: item.correctedPrice,
        hardStopPrice: item.correctedHardStopPrice,
        activeStopPrice: item.correctedPrice,
        activeStopKind: "hard_stop",
      }
    : {
        stopPrice: item.correctedPrice,
        hardStopPrice: item.correctedHardStopPrice,
        trailStopPrice: item.correctedTrailStopPrice,
        activeStopPrice: item.correctedPrice,
        activeStopKind: "trailing_stop",
        progressiveTrailStep: {
          activationPct: 30,
          givebackPct: 25,
          minLockedGainPct: 15,
        },
      };
}

async function applyExitPriceCorrections(
  client: PoolClient,
  correctedAt: Date,
): Promise<void> {
  for (const item of EXIT_PRICE_CORRECTIONS) {
    const correction = {
      id: CORRECTION_ID,
      status: "corrected",
      reason: "tick_manager_used_default_exit_profile",
      correctedAt: correctedAt.toISOString(),
      originalExitPrice: item.originalPrice,
      correctedExitPrice: item.correctedPrice,
      originalGrossPnl: item.originalGrossPnl,
      correctedGrossPnl: item.correctedGrossPnl,
    };
    const eventResult = await client.query(
      `update execution_events
          set summary = $7,
              payload = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        payload || jsonb_build_object(
                          'ledgerCorrection', $2::jsonb || jsonb_build_object(
                            'originalStop', payload->'stop',
                            'originalSummary', summary
                          )
                        ),
                        '{exitPrice}', to_jsonb($3::numeric), true
                      ),
                      '{pnl}', to_jsonb($4::numeric), true
                    ),
                    '{position,stopPrice}', to_jsonb($3::numeric), true
                  ),
                  '{position,lastStop}',
                    coalesce(payload#>'{position,lastStop}', '{}'::jsonb) || $5::jsonb,
                    true
                ),
                '{stop}', coalesce(payload->'stop', '{}'::jsonb) || $5::jsonb, true
              ),
              updated_at = $6::timestamptz
        where id = $1::uuid
          and not (payload ? 'ledgerCorrection')`,
      [
        item.eventId,
        JSON.stringify(correction),
        item.correctedPrice,
        item.correctedGrossPnl,
        JSON.stringify(correctedStopPatch(item)),
        correctedAt.toISOString(),
        item.correctedSummary,
      ],
    );
    assertEqual(eventResult.rowCount, 1, `${item.symbol} event price correction`);

    const orderResult = await client.query(
      `update shadow_orders
          set average_fill_price = $2,
              limit_price = $2,
              payload = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        payload || jsonb_build_object(
                          'ledgerCorrection', $3::jsonb ||
                            jsonb_build_object('originalStop', payload->'stop')
                        ),
                        '{exitPrice}', to_jsonb($2::numeric), true
                      ),
                      '{pnl}', to_jsonb($4::numeric), true
                    ),
                    '{position,stopPrice}', to_jsonb($2::numeric), true
                  ),
                  '{position,lastStop}',
                    coalesce(payload#>'{position,lastStop}', '{}'::jsonb) || $5::jsonb,
                    true
                ),
                '{stop}', coalesce(payload->'stop', '{}'::jsonb) || $5::jsonb, true
              ),
              updated_at = $6::timestamptz
        where id = $1::uuid
          and not (payload ? 'ledgerCorrection')`,
      [
        item.orderId,
        item.correctedPrice,
        JSON.stringify(correction),
        item.correctedGrossPnl,
        JSON.stringify(correctedStopPatch(item)),
        correctedAt.toISOString(),
      ],
    );
    assertEqual(orderResult.rowCount, 1, `${item.symbol} order price correction`);

    const fillResult = await client.query(
      `update shadow_fills
          set price = $2,
              gross_amount = $3,
              realized_pnl = $4,
              cash_delta = $5,
              updated_at = $6::timestamptz
        where id = $1::uuid
          and price = $7::numeric
          and gross_amount = $8::numeric
          and realized_pnl = $9::numeric
          and cash_delta = $10::numeric`,
      [
        item.fillId,
        item.correctedPrice,
        item.correctedPrice * (item.symbol === "TSLQ" ? 500 : 100),
        item.correctedFillRealizedPnl,
        item.correctedCashDelta,
        correctedAt.toISOString(),
        item.originalPrice,
        item.originalPrice * (item.symbol === "TSLQ" ? 500 : 100),
        item.originalFillRealizedPnl,
        item.originalCashDelta,
      ],
    );
    assertEqual(fillResult.rowCount, 1, `${item.symbol} fill price correction`);

    const realizedDelta =
      item.correctedFillRealizedPnl - item.originalFillRealizedPnl;
    const positionResult = await client.query(
      `update shadow_positions
          set mark = $2,
              realized_pnl = realized_pnl + $3::numeric,
              option_contract = coalesce(option_contract, '{}'::jsonb) ||
                jsonb_build_object(
                  'ledgerCorrection', jsonb_build_object(
                    'id', $4::text,
                    'status', 'corrected',
                    'reason', 'tick_manager_used_default_exit_profile',
                    'correctedAt', $5::text,
                    'originalMark', mark,
                    'realizedPnlDelta', $3::numeric
                  )
                ),
              updated_at = $5::timestamptz
        where id = $1::uuid
          and not (coalesce(option_contract, '{}'::jsonb) ? 'ledgerCorrection')`,
      [
        item.positionId,
        item.correctedPrice,
        realizedDelta,
        CORRECTION_ID,
        correctedAt.toISOString(),
      ],
    );
    assertEqual(positionResult.rowCount, 1, `${item.symbol} position price correction`);
  }
}

export async function recomputeAccountAndSnapshot(
  client: PoolClient,
  correctedAt: Date,
  source:
    | "ledger_correction"
    | "ledger_correction_post_reload"
    | "ledger_correction_reverted",
): Promise<{
  cash: number;
  realizedPnl: number;
  fees: number;
  unrealizedPnl: number;
  marketValue: number;
  netLiquidation: number;
}> {
  const totalsResult = await client.query(
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
  const totals = totalsResult.rows[0]!;
  await client.query(
    `update shadow_accounts
        set cash = $2, realized_pnl = $3, fees = $4, updated_at = $5
      where id = $1`,
    [
      ACCOUNT_ID,
      totals.cash,
      totals.realized_pnl,
      totals.fees,
      correctedAt.toISOString(),
    ],
  );

  const openResult = await client.query(
    `select coalesce(sum(market_value), 0) as market_value,
            coalesce(sum(unrealized_pnl), 0) as unrealized_pnl
       from shadow_positions
      where account_id = $1
        and status = 'open'
        and position_key not like 'shadow_equity_forward:%'`,
    [ACCOUNT_ID],
  );
  const open = openResult.rows[0]!;
  const cash = numeric(totals.cash);
  const realizedPnl = numeric(totals.realized_pnl);
  const fees = numeric(totals.fees);
  const marketValue = numeric(open.market_value);
  const unrealizedPnl = numeric(open.unrealized_pnl);
  const netLiquidation = cash + marketValue;
  await client.query(
    `insert into shadow_balance_snapshots
       (account_id, currency, cash, buying_power, net_liquidation,
        realized_pnl, unrealized_pnl, fees, source, as_of)
     values ($1, 'USD', $2, greatest($2::numeric, 0), $3, $4, $5, $6, $7, $8)`,
    [
      ACCOUNT_ID,
      cash,
      netLiquidation,
      realizedPnl,
      unrealizedPnl,
      fees,
      source,
      correctedAt.toISOString(),
    ],
  );
  return { cash, realizedPnl, fees, unrealizedPnl, marketValue, netLiquidation };
}

async function lockLedgerWriters(client: PoolClient): Promise<void> {
  await client.query(
    `lock table shadow_orders, shadow_fills, shadow_positions, shadow_accounts
       in share row exclusive mode`,
  );
}

async function reconcileAfterReload(
  client: PoolClient,
  correctedAt: Date,
): Promise<{
  before: { cash: number; realizedPnl: number; fees: number };
  after: Awaited<ReturnType<typeof recomputeAccountAndSnapshot>>;
}> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`shadow-ledger-correction:${CORRECTION_ID}`],
  );
  const correctionResult = await client.query(
    `select event_type from execution_events where id = $1::uuid for update`,
    [CORRECTION_ID],
  );
  assertEqual(correctionResult.rowCount, 1, "applied correction event row count");
  assertEqual(
    correctionResult.rows[0]!.event_type,
    "signal_options_ledger_correction",
    "applied correction event type",
  );

  const tombstoneResult = await client.query(
    `select
       (select count(*)::int from execution_events
         where id = any($1::uuid[])
           and payload#>>'{ledgerCorrection,id}' = $2) as events,
       (select count(*)::int from shadow_orders
         where id = any($3::uuid[])
           and lower(coalesce(payload->>'forwardTest', 'false')) = 'true'
           and payload#>>'{ledgerCorrection,id}' = $2) as orders`,
    [INVALID_EVENT_IDS, CORRECTION_ID, INVALID_ORDER_IDS],
  );
  assertEqual(
    tombstoneResult.rows[0]!.events,
    INVALID_EVENT_IDS.length,
    "post-reload event tombstones",
  );
  assertEqual(
    tombstoneResult.rows[0]!.orders,
    INVALID_ORDER_IDS.length,
    "post-reload order tombstones",
  );

  const accountResult = await client.query(
    `select cash, realized_pnl, fees from shadow_accounts where id = $1 for update`,
    [ACCOUNT_ID],
  );
  assertEqual(accountResult.rowCount, 1, "post-reload account row count");
  const before = {
    cash: numeric(accountResult.rows[0]!.cash),
    realizedPnl: numeric(accountResult.rows[0]!.realized_pnl),
    fees: numeric(accountResult.rows[0]!.fees),
  };
  const after = await recomputeAccountAndSnapshot(
    client,
    correctedAt,
    "ledger_correction_post_reload",
  );
  await client.query(
    `update execution_events
        set payload = jsonb_set(
              payload,
              '{postReloadReconciliation}',
              $2::jsonb,
              true
            ),
            updated_at = $3
      where id = $1::uuid`,
    [
      CORRECTION_ID,
      JSON.stringify({ reconciledAt: correctedAt.toISOString(), before, after }),
      correctedAt.toISOString(),
    ],
  );
  return { before, after };
}

async function insertCorrectionEvent(
  client: PoolClient,
  correctedAt: Date,
  before: { cash: number; realizedPnl: number; fees: number },
  after: Awaited<ReturnType<typeof recomputeAccountAndSnapshot>>,
): Promise<void> {
  const result = await client.query(
    `insert into execution_events
       (id, deployment_id, provider_account_id, event_type, summary, payload,
        occurred_at, created_at, updated_at)
     values ($1, $2, $3, 'signal_options_ledger_correction', $4, $5::jsonb,
             $6, $6, $6)`,
    [
      CORRECTION_ID,
      DEPLOYMENT_ID,
      ACCOUNT_ID,
      "Voided three prior-session lifecycles and one duplicate AAOI exit event; corrected two tick-profile exit fills",
      JSON.stringify({
        correctionId: CORRECTION_ID,
        status: "applied",
        reason: "two-day trading audit 2026-07-13 through 2026-07-14",
        correctedAt: correctedAt.toISOString(),
        voidedLifecycleEventIds: INVALID_LIFECYCLES.flatMap((item) => [
          item.entryEventId,
          item.exitEventId,
        ]),
        voidedDuplicateExitEventId: AAOI_DUPLICATE_EVENT_ID,
        invalidLifecycleOrderIds: INVALID_ORDER_IDS,
        invalidLifecycleFillIds: INVALID_FILL_IDS,
        priceCorrectionEventIds: EXIT_PRICE_CORRECTIONS.map((item) => item.eventId),
        before,
        after,
        deltas: {
          cash: after.cash - before.cash,
          realizedPnl: after.realizedPnl - before.realizedPnl,
          fees: after.fees - before.fees,
        },
      }),
      correctedAt.toISOString(),
    ],
  );
  assertEqual(result.rowCount, 1, "correction audit event insert");
}

async function revertCorrection(client: PoolClient, correctedAt: Date): Promise<void> {
  const correctionResult = await client.query(
    `select id::text, event_type, payload from execution_events
      where id = $1::uuid for update`,
    [CORRECTION_ID],
  );
  assertEqual(correctionResult.rowCount, 1, "applied correction event row count");
  assertEqual(
    correctionResult.rows[0]!.event_type,
    "signal_options_ledger_correction",
    "applied correction event type",
  );

  const invalidEventResult = await client.query(
    `update execution_events
        set event_type = payload#>>'{ledgerCorrection,originalEventType}',
            summary = payload#>>'{ledgerCorrection,originalSummary}',
            payload = payload - 'ledgerCorrection',
            updated_at = $2::timestamptz
      where id = any($1::uuid[])
        and payload#>>'{ledgerCorrection,id}' = $3`,
    [INVALID_EVENT_IDS, correctedAt.toISOString(), CORRECTION_ID],
  );
  assertEqual(
    invalidEventResult.rowCount,
    INVALID_EVENT_IDS.length,
    "invalid event tombstone revert count",
  );

  const invalidOrderResult = await client.query(
    `update shadow_orders
        set payload = (
              payload - 'ledgerCorrection' - 'forwardTest'
            ) || case
              when (payload#>>'{ledgerCorrection,originalForwardTestPresent}')::boolean
                then jsonb_build_object(
                  'forwardTest', payload#>'{ledgerCorrection,originalForwardTest}'
                )
              else '{}'::jsonb
            end,
            updated_at = $2::timestamptz
      where id = any($1::uuid[])
        and payload#>>'{ledgerCorrection,id}' = $3`,
    [INVALID_ORDER_IDS, correctedAt.toISOString(), CORRECTION_ID],
  );
  assertEqual(
    invalidOrderResult.rowCount,
    INVALID_ORDER_IDS.length,
    "invalid order tombstone revert count",
  );

  for (const item of INVALID_LIFECYCLES) {
    const result = await client.query(
      `update shadow_positions
          set position_key = option_contract#>>'{ledgerCorrection,originalPositionKey}',
              option_contract = option_contract - 'ledgerCorrection',
              updated_at = $2::timestamptz
        where id = $1::uuid
          and option_contract#>>'{ledgerCorrection,id}' = $3`,
      [item.positionId, correctedAt.toISOString(), CORRECTION_ID],
    );
    assertEqual(result.rowCount, 1, `${item.symbol} position tombstone revert`);
  }

  for (const item of EXIT_PRICE_CORRECTIONS) {
    for (const [table, id] of [
      ["execution_events", item.eventId],
      ["shadow_orders", item.orderId],
    ] as const) {
      const priceColumns =
        table === "shadow_orders"
          ? ", average_fill_price = $3, limit_price = $3"
          : "";
      const summaryColumn =
        table === "execution_events"
          ? ", summary = payload#>>'{ledgerCorrection,originalSummary}'"
          : "";
      const result = await client.query(
        `update ${table}
            set payload = jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(payload - 'ledgerCorrection',
                          '{exitPrice}', to_jsonb($3::numeric), true),
                        '{pnl}', to_jsonb($4::numeric), true),
                      '{position,stopPrice}', to_jsonb($3::numeric), true),
                    '{position,lastStop}',
                      coalesce(payload#>'{ledgerCorrection,originalStop}', '{}'::jsonb),
                      true),
                  '{stop}',
                    coalesce(payload#>'{ledgerCorrection,originalStop}', '{}'::jsonb),
                    true),
                updated_at = $2::timestamptz
                ${priceColumns}
                ${summaryColumn}
          where id = $1::uuid
            and payload#>>'{ledgerCorrection,id}' = $5`,
        [
          id,
          correctedAt.toISOString(),
          item.originalPrice,
          item.originalGrossPnl,
          CORRECTION_ID,
        ],
      );
      assertEqual(result.rowCount, 1, `${item.symbol} ${table} price revert`);
    }

    const fillResult = await client.query(
      `update shadow_fills
          set price = $2, gross_amount = $3, realized_pnl = $4,
              cash_delta = $5, updated_at = $6::timestamptz
        where id = $1::uuid
          and price = $7::numeric
          and gross_amount = $8::numeric
          and realized_pnl = $9::numeric
          and cash_delta = $10::numeric`,
      [
        item.fillId,
        item.originalPrice,
        item.originalPrice * (item.symbol === "TSLQ" ? 500 : 100),
        item.originalFillRealizedPnl,
        item.originalCashDelta,
        correctedAt.toISOString(),
        item.correctedPrice,
        item.correctedPrice * (item.symbol === "TSLQ" ? 500 : 100),
        item.correctedFillRealizedPnl,
        item.correctedCashDelta,
      ],
    );
    assertEqual(fillResult.rowCount, 1, `${item.symbol} fill price revert`);

    const positionResult = await client.query(
      `update shadow_positions
          set mark = (option_contract#>>'{ledgerCorrection,originalMark}')::numeric,
              realized_pnl = realized_pnl -
                (option_contract#>>'{ledgerCorrection,realizedPnlDelta}')::numeric,
              option_contract = option_contract - 'ledgerCorrection',
              updated_at = $2::timestamptz
        where id = $1::uuid
          and option_contract#>>'{ledgerCorrection,id}' = $3`,
      [item.positionId, correctedAt.toISOString(), CORRECTION_ID],
    );
    assertEqual(positionResult.rowCount, 1, `${item.symbol} position price revert`);
  }

  const after = await recomputeAccountAndSnapshot(
    client,
    correctedAt,
    "ledger_correction_reverted",
  );
  await client.query(
    `update execution_events
        set event_type = 'signal_options_ledger_correction_reverted',
            summary = '[REVERTED] ' || summary,
            payload = payload || jsonb_build_object(
              'status', 'reverted', 'revertedAt', $2::text, 'afterRevert', $3::jsonb
            ),
            updated_at = $2::timestamptz
      where id = $1::uuid`,
    [CORRECTION_ID, correctedAt.toISOString(), JSON.stringify(after)],
  );
}

async function run(mode = readMode()): Promise<Record<string, unknown>> {
  validatePlan();
  const client = await pool.connect();
  const correctedAt = new Date();
  const shouldRollback = mode === "dry-run" || mode === "revert-dry-run";
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '30s'");
    if (mode === "apply" || mode === "reconcile" || mode === "revert") {
      await lockLedgerWriters(client);
    }
    if (mode === "reconcile") {
      const reconciliation = await reconcileAfterReload(client, correctedAt);
      await client.query("commit");
      return {
        correctionId: CORRECTION_ID,
        mode,
        status: "reconciled_after_reload",
        ...reconciliation,
      };
    }
    if (mode === "revert" || mode === "revert-dry-run") {
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`shadow-ledger-correction:${CORRECTION_ID}`],
      );
      await revertCorrection(client, correctedAt);
      if (shouldRollback) await client.query("rollback");
      else await client.query("commit");
      return {
        correctionId: CORRECTION_ID,
        mode,
        status: shouldRollback ? "revert_validated_rolled_back" : "reverted",
      };
    }

    const existing = await client.query(
      "select event_type from execution_events where id = $1::uuid",
      [CORRECTION_ID],
    );
    assertEqual(existing.rowCount, 0, "existing correction event count");
    const before = await lockAndValidateBaseRows(client);
    await applyInvalidLifecycleTombstones(client, correctedAt);
    await applyExitPriceCorrections(client, correctedAt);
    const after = await recomputeAccountAndSnapshot(
      client,
      correctedAt,
      "ledger_correction",
    );
    await insertCorrectionEvent(client, correctedAt, before, after);

    assertMoney(after.cash, before.cash + 1023.84, "corrected cash");
    assertMoney(
      after.realizedPnl,
      before.realizedPnl + 1014.42,
      "corrected realized P&L",
    );
    assertMoney(after.fees, before.fees - 18.84, "corrected fees");
    if (shouldRollback) await client.query("rollback");
    else await client.query("commit");
    return {
      correctionId: CORRECTION_ID,
      mode,
      status: shouldRollback ? "validated_rolled_back" : "applied",
      before,
      after,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const __shadowLedgerCorrection20260715InternalsForTests = {
  CORRECTION_ID,
  EXIT_PRICE_CORRECTIONS,
  INVALID_EVENT_IDS,
  INVALID_FILL_IDS,
  INVALID_LIFECYCLES,
  INVALID_ORDER_IDS,
  readMode,
  validatePlan,
};

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : "";

if (import.meta.url === invokedPath) {
  run()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
