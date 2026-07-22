import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

const CORRECTION_ID = "bc095411-907a-4630-a93f-be8ccfeb4f78";
const ACCOUNT_ID = "shadow";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";

const DUPLICATES = [
  {
    symbol: "ABAT",
    candidateId: "SIGOPT-7e2e4e6f-ABAT-sell-1784211900000",
    voidEventId: "77b5492b-0a16-834e-88c2-460c75776163",
    keepEventId: "65322120-cc7f-8a0f-8c29-57bfb71c029b",
  },
  {
    symbol: "CELH",
    candidateId: "SIGOPT-7e2e4e6f-CELH-sell-1784218500000",
    voidEventId: "57df2bc9-3420-83db-bfaf-e73dd2ff8f47",
    keepEventId: "0bfb27f4-6127-8d52-b475-8ae435d9cd19",
  },
] as const;

type Mode = "dry-run" | "apply";

type ExitRow = {
  id: string;
  symbol: string;
  event_type: string;
  occurred_at: Date;
  candidate_id: string | null;
  position_id: string | null;
  opened_at: string | null;
  reason: string | null;
  pnl: string | number | null;
  order_count: number;
  fill_count: number;
};

function mode(): Mode {
  const value = process.env.SHADOW_LEDGER_CORRECTION_MODE?.trim() || "dry-run";
  if (value !== "dry-run" && value !== "apply") {
    throw new Error("SHADOW_LEDGER_CORRECTION_MODE must be dry-run or apply.");
  }
  return value;
}

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(actual)}.`,
    );
  }
}

function finite(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite.`);
  return parsed;
}

async function accountTotals(client: PoolClient) {
  const result = await client.query<{
    cash: string;
    realized_pnl: string;
    fees: string;
  }>(
    "select cash::text, realized_pnl::text, fees::text from shadow_accounts where id = $1",
    [ACCOUNT_ID],
  );
  equal(result.rowCount, 1, "shadow account row count");
  return {
    cash: finite(result.rows[0]!.cash, "cash"),
    realizedPnl: finite(result.rows[0]!.realized_pnl, "realized P&L"),
    fees: finite(result.rows[0]!.fees, "fees"),
  };
}

async function exitRows(client: PoolClient) {
  const ids = DUPLICATES.flatMap((item) => [item.voidEventId, item.keepEventId]);
  const result = await client.query<ExitRow>(
    `select e.id::text,
            e.symbol,
            e.event_type,
            e.occurred_at,
            e.payload->'position'->>'candidateId' as candidate_id,
            e.payload->'position'->>'id' as position_id,
            e.payload->'position'->>'openedAt' as opened_at,
            e.payload->>'reason' as reason,
            e.payload->>'pnl' as pnl,
            count(distinct o.id)::int as order_count,
            count(distinct f.id)::int as fill_count
       from execution_events e
       left join shadow_orders o on o.source_event_id = e.id
       left join shadow_fills f on f.source_event_id = e.id or f.order_id = o.id
      where e.id = any($1::uuid[])
      group by e.id, e.symbol, e.event_type, e.occurred_at, e.payload
      order by e.symbol, e.occurred_at`,
    [ids],
  );
  equal(result.rowCount, ids.length, "duplicate-pair event count");
  return new Map(result.rows.map((row) => [row.id, row]));
}

function validatePairs(rows: Map<string, ExitRow>) {
  for (const pair of DUPLICATES) {
    const duplicate = rows.get(pair.voidEventId);
    const keeper = rows.get(pair.keepEventId);
    if (!duplicate || !keeper) throw new Error(`${pair.symbol} pair is incomplete.`);
    for (const row of [duplicate, keeper]) {
      equal(row.symbol, pair.symbol, `${pair.symbol} symbol`);
      equal(row.event_type, "signal_options_shadow_exit", `${row.id} event type`);
      equal(row.candidate_id, pair.candidateId, `${row.id} candidate`);
      equal(row.reason, "overnight_risk_exit", `${row.id} reason`);
    }
    equal(
      duplicate.position_id,
      keeper.position_id,
      `${pair.symbol} position identity`,
    );
    equal(
      finite(duplicate.pnl, `${pair.symbol} duplicate P&L`),
      finite(keeper.pnl, `${pair.symbol} keeper P&L`),
      `${pair.symbol} P&L`,
    );
    equal(duplicate.order_count, 0, `${pair.symbol} duplicate order count`);
    equal(duplicate.fill_count, 0, `${pair.symbol} duplicate fill count`);
    equal(keeper.order_count, 1, `${pair.symbol} keeper order count`);
    equal(keeper.fill_count, 1, `${pair.symbol} keeper fill count`);
    const duplicateOpenedAt = Date.parse(duplicate.opened_at ?? "");
    const keeperOpenedAt = Date.parse(keeper.opened_at ?? "");
    equal(
      Math.abs(duplicateOpenedAt - keeperOpenedAt),
      1,
      `${pair.symbol} lifecycle timestamp drift ms`,
    );
    if (duplicate.occurred_at >= keeper.occurred_at) {
      throw new Error(`${pair.symbol} orphan duplicate must precede the economic exit.`);
    }
  }
}

async function correct() {
  const selectedMode = mode();
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
      "lock table execution_events, shadow_orders, shadow_fills, shadow_accounts in share row exclusive mode",
    );
    const existing = await client.query(
      "select 1 from execution_events where id = $1",
      [CORRECTION_ID],
    );
    equal(existing.rowCount, 0, "existing correction event count");

    const before = await accountTotals(client);
    const rows = await exitRows(client);
    validatePairs(rows);
    const voidEventIds = DUPLICATES.map((item) => item.voidEventId);
    const updated = await client.query(
      `update execution_events
          set event_type = event_type || '_voided',
              summary = '[VOIDED ' || $2 || '] ' || summary,
              payload = payload || jsonb_build_object(
                'ledgerCorrection', jsonb_build_object(
                  'id', $2::text,
                  'status', 'void',
                  'reason', 'duplicate_exit_without_order_or_fill',
                  'correctedAt', $3::text,
                  'originalEventType', event_type,
                  'originalSummary', summary
                )
              ),
              updated_at = $3::timestamptz
        where id = any($1::uuid[])
          and event_type = 'signal_options_shadow_exit'
          and not (payload ? 'ledgerCorrection')`,
      [voidEventIds, CORRECTION_ID, correctedAt.toISOString()],
    );
    equal(updated.rowCount, voidEventIds.length, "voided duplicate event count");

    const after = await accountTotals(client);
    equal(after.cash, before.cash, "cash after event-only correction");
    equal(after.realizedPnl, before.realizedPnl, "realized P&L after event-only correction");
    equal(after.fees, before.fees, "fees after event-only correction");

    await client.query(
      `insert into execution_events
         (id, deployment_id, provider_account_id, event_type, summary, payload,
          occurred_at, created_at, updated_at)
       values ($1, $2, $3, 'signal_options_ledger_correction', $4, $5::jsonb, $6, $6, $6)`,
      [
        CORRECTION_ID,
        DEPLOYMENT_ID,
        ACCOUNT_ID,
        "Voided orphan duplicate ABAT and CELH exits from 2026-07-16",
        JSON.stringify({
          correctionId: CORRECTION_ID,
          status: "applied",
          correctedAt: correctedAt.toISOString(),
          reason: "lifecycle_opened_at_mirror_drift",
          voidedEventIds: voidEventIds,
          retainedEventIds: DUPLICATES.map((item) => item.keepEventId),
          before,
          after,
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
      voidedEventIds: voidEventIds,
      before,
      after,
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

export const __shadowLedgerDuplicateExitCorrection20260716InternalsForTests = {
  CORRECTION_ID,
  DUPLICATES,
  mode,
  validatePairs,
};
