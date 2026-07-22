import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";

const CORRECTION_ID = "ddf5e2af-ab87-4edc-9029-6d5ae9061bd7";
const EXPECTED = [
  ["871c9b38-9781-4c52-8eab-11fb6e8c7c74", "overnight_risk_exit"],
  ["dd91f1b5-aff6-48ec-803f-c452098e2ee6", "runner_trail_stop"],
  ["7a6bff89-99d0-4ae6-993d-080e8d57c686", "hard_stop"],
  ["9ea35ec5-694a-4eb7-b0ae-574673a66a98", "overnight_risk_exit"],
] as const;

async function reconcile() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const correction = await client.query(
      "select 1 from execution_events where id = $1 and event_type = 'signal_options_ledger_correction'",
      [CORRECTION_ID],
    );
    if (correction.rowCount !== 1) throw new Error("Applied correction event not found.");

    for (const [eventId, reason] of EXPECTED) {
      const updated = await client.query(
        `update shadow_orders orders
            set payload = jsonb_set(jsonb_set(payload,
                  '{reason}', to_jsonb($2::text), true),
                  '{exitReason}', to_jsonb($2::text), true),
                updated_at = now()
          where orders.source_event_id = $1::uuid
            and orders.payload->'ledgerCorrection'->>'id' = $3
        returning orders.id`,
        [eventId, reason, CORRECTION_ID],
      );
      if (updated.rowCount !== 1) {
        throw new Error(`${eventId}: expected one corrected shadow order.`);
      }
    }
    await client.query("commit");
    return { correctionId: CORRECTION_ID, reconciledOrders: EXPECTED.length };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  reconcile()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
