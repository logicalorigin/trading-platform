import { pool } from "@workspace/db";

import {
  computeSignalOptionsPostExitOutcomeFromBars,
  type SignalOptionsPostExitOutcomeBar,
} from "../../artifacts/api-server/src/services/signal-options-automation";
import { getOptionChartBarsWithDebug } from "../../artifacts/api-server/src/services/platform";

type JsonRecord = Record<string, unknown>;

type Config = {
  from: Date;
  to: Date;
};

type ExitRow = {
  event_id: string;
  deployment_id: string | null;
  symbol: string | null;
  occurred_at: Date;
  event_payload: unknown;
  order_id: string | null;
  order_payload: unknown;
  event_has_outcome: boolean;
  order_has_outcome: boolean | null;
};

type OptionContractIdentity = {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  optionTicker: string | null;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function parseBoundary(value: string | null, fallback: string, endOfDay: boolean) {
  const source = value ?? fallback;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(source)
    ? `${source}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : source;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date boundary: ${source}`);
  }
  return parsed;
}

function readConfig(): Config {
  const from = parseBoundary(argValue("--from"), "2026-05-22", false);
  const to = parseBoundary(argValue("--to"), "2026-07-07", true);
  if (from.getTime() > to.getTime()) {
    throw new Error("--from must be at or before --to");
  }
  return { from, to };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function compactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function firstRecord(...values: unknown[]): JsonRecord {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length) return record;
  }
  return {};
}

function optionRight(value: unknown): "call" | "put" {
  return String(value ?? "").toLowerCase() === "put" ? "put" : "call";
}

function resolveOptionContract(row: ExitRow): OptionContractIdentity | null {
  const payload = asRecord(row.event_payload);
  const orderPayload = asRecord(row.order_payload);
  const position = asRecord(payload.position);
  const contract = firstRecord(
    payload.selectedContract,
    position.selectedContract,
    orderPayload.selectedContract,
    orderPayload.optionContract,
  );
  const underlying =
    compactString(contract.underlying) ??
    compactString(contract.symbol) ??
    compactString(row.symbol);
  const expirationDate = dateOrNull(contract.expirationDate ?? contract.expiry);
  const strike = finiteNumber(contract.strike);
  if (!underlying || !expirationDate || strike == null || strike <= 0) {
    return null;
  }
  return {
    underlying,
    expirationDate,
    strike,
    right: optionRight(contract.right ?? contract.optionRight),
    optionTicker:
      compactString(contract.ticker) ??
      compactString(contract.optionTicker) ??
      compactString(contract.providerContractId),
  };
}

function entryPriceFromPayload(payload: JsonRecord): number | null {
  const position = asRecord(payload.position);
  return finiteNumber(position.entryPrice ?? payload.entryPrice);
}

function exitPriceFromPayload(payload: JsonRecord): number | null {
  return finiteNumber(payload.exitPrice ?? payload.price);
}

async function loadExitRows(config: Config): Promise<ExitRow[]> {
  const result = await pool.query<ExitRow>(
    `
      select e.id as event_id,
             e.deployment_id,
             e.symbol,
             e.occurred_at,
             e.payload as event_payload,
             o.id as order_id,
             o.payload as order_payload,
             (e.payload ? 'postExitOutcome') as event_has_outcome,
             case when o.id is null then null else (o.payload ? 'postExitOutcome') end as order_has_outcome
      from execution_events e
      left join shadow_orders o on o.source_event_id = e.id
      where e.event_type = 'signal_options_shadow_exit'
        and e.occurred_at >= $1::timestamptz
        and e.occurred_at <= $2::timestamptz
      order by e.occurred_at asc, e.id asc
    `,
    [config.from.toISOString(), config.to.toISOString()],
  );
  return result.rows;
}

async function updateMissingOutcome(row: ExitRow, outcome: JsonRecord) {
  const json = JSON.stringify(outcome);
  const eventUpdate = row.event_has_outcome
    ? { rowCount: 0 }
    : await pool.query(
        `
          update execution_events
          set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{postExitOutcome}', $2::jsonb, true),
              updated_at = now()
          where id = $1
            and payload->'postExitOutcome' is null
        `,
        [row.event_id, json],
      );
  const orderUpdate =
    !row.order_id || row.order_has_outcome
      ? { rowCount: 0 }
      : await pool.query(
          `
            update shadow_orders
            set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{postExitOutcome}', $2::jsonb, true),
                updated_at = now()
            where id = $1
              and payload->'postExitOutcome' is null
          `,
          [row.order_id, json],
        );
  return {
    eventUpdated: eventUpdate.rowCount ?? 0,
    orderUpdated: orderUpdate.rowCount ?? 0,
  };
}

async function computeOutcomeForRow(row: ExitRow, config: Config) {
  const payload = asRecord(row.event_payload);
  const contract = resolveOptionContract(row);
  const entryPrice = entryPriceFromPayload(payload);
  const exitPrice = exitPriceFromPayload(payload);
  if (!contract || entryPrice == null || exitPrice == null || exitPrice <= 0) {
    return { outcome: null, reason: "missing_contract_or_price" };
  }

  const bars = await getOptionChartBarsWithDebug({
    underlying: contract.underlying,
    expirationDate: contract.expirationDate,
    strike: contract.strike,
    right: contract.right,
    optionTicker: contract.optionTicker,
    skipBrokerContractResolution: Boolean(contract.optionTicker),
    timeframe: "1m",
    from: row.occurred_at,
    to: config.to,
    limit: 5_000,
    outsideRth: false,
  });
  if (!bars.bars.length) {
    return { outcome: null, reason: bars.emptyReason ?? "no_option_bars" };
  }

  const outcome = computeSignalOptionsPostExitOutcomeFromBars({
    optionBars: bars.bars as SignalOptionsPostExitOutcomeBar[],
    entryPrice,
    exitAt: row.occurred_at,
    exitPrice,
  });
  if (outcome.bars <= 0) {
    return { outcome: null, reason: "no_post_exit_bars" };
  }
  return { outcome: outcome as JsonRecord, reason: null };
}

async function main() {
  const config = readConfig();
  const rows = await loadExitRows(config);
  const summary = {
    from: config.from.toISOString(),
    to: config.to.toISOString(),
    scanned: rows.length,
    alreadyPresent: 0,
    enriched: 0,
    skippedNoData: 0,
    eventPayloadsUpdated: 0,
    orderPayloadsUpdated: 0,
    skipReasons: {} as Record<string, number>,
  };

  for (const row of rows) {
    if (row.event_has_outcome && (row.order_id == null || row.order_has_outcome)) {
      summary.alreadyPresent += 1;
      continue;
    }

    const existingOutcome = asRecord(asRecord(row.event_payload).postExitOutcome);
    const outcomeResult = Object.keys(existingOutcome).length
      ? { outcome: existingOutcome, reason: null }
      : await computeOutcomeForRow(row, config);

    if (!outcomeResult.outcome) {
      const reason = outcomeResult.reason ?? "unknown";
      summary.skippedNoData += 1;
      summary.skipReasons[reason] = (summary.skipReasons[reason] ?? 0) + 1;
      continue;
    }

    const updated = await updateMissingOutcome(row, outcomeResult.outcome);
    if (updated.eventUpdated || updated.orderUpdated) {
      summary.enriched += 1;
      summary.eventPayloadsUpdated += updated.eventUpdated;
      summary.orderPayloadsUpdated += updated.orderUpdated;
    } else {
      summary.alreadyPresent += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
