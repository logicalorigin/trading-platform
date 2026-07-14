import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isDeepStrictEqual,
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";

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
};

type OptionContractIdentity = {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  optionTicker: string | null;
};

const DEFAULT_FROM = "2026-05-22";
const DEFAULT_TO = "2026-07-07";
const OPTION_BAR_LIMIT = 5_000;
// ponytail: keep this one-shot utility bounded; keyset-page by occurred_at/id
// if bulk-history enrichment becomes a requirement.
const MAX_EXIT_ROWS = 10_000;
const MAX_DIAGNOSTIC_LENGTH = 500;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const USAGE = `Usage:
  pnpm --filter @workspace/scripts exec tsx ./src/shadow-options-post-exit-enrich.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]`;
const POST_EXIT_OUTCOME_NUMBER_FIELDS = [
  "highPrice",
  "lowPrice",
  "lastClose",
  "highVsExitPct",
  "lastVsExitPct",
] as const;
const POST_EXIT_OUTCOME_DATE_FIELDS = ["highAt", "lowAt", "lastAt"] as const;
const POST_EXIT_OUTCOME_BOOLEAN_FIELDS = [
  "recoveredEntry",
  "reachedTwentyFivePctGain",
  "reachedFiftyPctGain",
  "finalAboveExit",
  "finalAboveEntry",
] as const;

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutCredentials = raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s]*/giu,
      "$1[redacted]",
    );
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown post-exit enrichment error";
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function parseBoundary(
  value: string | undefined,
  fallback: string,
  endOfDay: boolean,
) {
  const source = value ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(source)) {
    throw new Error("Date boundaries must use canonical YYYY-MM-DD values.");
  }
  const normalized = `${source}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== source
  ) {
    throw new Error(`Invalid date boundary: ${source}`);
  }
  return parsed;
}

function readConfig(argv: string[] = process.argv.slice(2)): Config {
  try {
    const parsed = parseNodeArgs({
      args: argv[0] === "--" ? argv.slice(1) : argv,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        from: { type: "string" },
        to: { type: "string" },
      },
    });
    const counts = new Map<string, number>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      counts.set(token.name, (counts.get(token.name) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) {
      throw new Error("Duplicate options are not allowed.");
    }

    const from = parseBoundary(parsed.values.from, DEFAULT_FROM, false);
    const to = parseBoundary(parsed.values.to, DEFAULT_TO, true);
    if (from.getTime() > to.getTime()) {
      throw new Error("--from must be at or before --to");
    }
    return { from, to };
  } catch (error) {
    throw new Error(`${USAGE}\n${errorMessage(error)}`);
  }
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function isPostExitOutcome(value: unknown): value is JsonRecord {
  const outcome = asRecord(value);
  if (
    typeof outcome.bars !== "number" ||
    !Number.isSafeInteger(outcome.bars) ||
    outcome.bars <= 0
  ) {
    return false;
  }
  for (const field of POST_EXIT_OUTCOME_NUMBER_FIELDS) {
    const fieldValue = outcome[field];
    if (
      fieldValue !== null &&
      (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))
    ) {
      return false;
    }
  }
  for (const field of POST_EXIT_OUTCOME_DATE_FIELDS) {
    const fieldValue = outcome[field];
    if (fieldValue === null) continue;
    if (typeof fieldValue !== "string") return false;
    const parsed = new Date(fieldValue);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== fieldValue) {
      return false;
    }
  }
  return POST_EXIT_OUTCOME_BOOLEAN_FIELDS.every(
    (field) => typeof outcome[field] === "boolean",
  );
}

function existingOutcome(
  payload: unknown,
  label: "event" | "order",
): JsonRecord | null {
  const record = asRecord(payload);
  if (
    !Object.hasOwn(record, "postExitOutcome") ||
    record.postExitOutcome == null
  ) {
    return null;
  }
  const outcome = record.postExitOutcome;
  if (!isPostExitOutcome(outcome)) {
    throw new Error(`Invalid existing post-exit outcome in ${label} payload.`);
  }
  return outcome;
}

function selectExistingOutcome(row: ExitRow) {
  const eventOutcome = existingOutcome(row.event_payload, "event");
  const orderOutcome = row.order_id
    ? existingOutcome(row.order_payload, "order")
    : null;
  if (
    eventOutcome &&
    orderOutcome &&
    !isDeepStrictEqual(eventOutcome, orderOutcome)
  ) {
    throw new Error(
      `Conflicting post-exit outcomes for event ${row.event_id} and order ${row.order_id}.`,
    );
  }
  return {
    outcome: eventOutcome ?? orderOutcome,
    eventPresent: Boolean(eventOutcome),
    orderPresent: Boolean(orderOutcome),
  };
}

function optionRight(value: unknown): "call" | "put" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "call" || normalized === "put" ? normalized : null;
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
  const right = optionRight(contract.right ?? contract.optionRight);
  if (
    !underlying ||
    !expirationDate ||
    strike == null ||
    strike <= 0 ||
    !right
  ) {
    return null;
  }
  return {
    underlying,
    expirationDate,
    strike,
    right,
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

type ExitRowsQuery = (
  text: string,
  values: unknown[],
) => Promise<{ rows: ExitRow[] }>;

const queryExitRows: ExitRowsQuery = async (text, values) =>
  pool.query<ExitRow>(text, values);

async function loadExitRows(
  config: Config,
  query: ExitRowsQuery = queryExitRows,
): Promise<ExitRow[]> {
  const result = await query(
    `
      select e.id as event_id,
             e.deployment_id,
             e.symbol,
             e.occurred_at,
             e.payload as event_payload,
             o.id as order_id,
             o.payload as order_payload
      from execution_events e
      left join shadow_orders o on o.source_event_id = e.id
      where e.event_type = 'signal_options_shadow_exit'
        and e.occurred_at >= $1::timestamptz
        and e.occurred_at <= $2::timestamptz
      order by e.occurred_at asc, e.id asc
      limit $3
    `,
    [config.from.toISOString(), config.to.toISOString(), MAX_EXIT_ROWS + 1],
  );
  if (result.rows.length > MAX_EXIT_ROWS) {
    throw new Error(
      `Exit scan exceeded the ${MAX_EXIT_ROWS.toLocaleString("en-US")}-row safety ceiling; narrow --from/--to and retry.`,
    );
  }
  return result.rows;
}

async function updateMissingOutcome(
  row: ExitRow,
  outcome: JsonRecord,
  transactionPool: Pick<typeof pool, "connect"> = pool,
) {
  const client = await transactionPool.connect();
  try {
    await client.query("begin");
    const lockedEvent = await client.query<{ payload: unknown }>(
      `
        select payload
        from execution_events
        where id = $1
        for update
      `,
      [row.event_id],
    );
    if (lockedEvent.rows.length !== 1) {
      throw new Error(`Exit event ${row.event_id} no longer exists.`);
    }
    const lockedOrder = row.order_id
      ? await client.query<{ payload: unknown }>(
          `
            select payload
            from shadow_orders
            where id = $1
            for update
          `,
          [row.order_id],
        )
      : null;
    if (row.order_id && lockedOrder?.rows.length !== 1) {
      throw new Error(`Shadow order ${row.order_id} no longer exists.`);
    }

    const existing = selectExistingOutcome({
      ...row,
      event_payload: lockedEvent.rows[0]?.payload,
      order_payload: lockedOrder?.rows[0]?.payload ?? null,
    });
    const authoritativeOutcome = existing.outcome ?? outcome;
    if (!isPostExitOutcome(authoritativeOutcome)) {
      throw new Error("Refusing to store an invalid post-exit outcome.");
    }
    const json = JSON.stringify(authoritativeOutcome);
    const eventUpdate = existing.eventPresent
      ? { rowCount: 0 }
      : await client.query(
          `
          update execution_events
          set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{postExitOutcome}', $2::jsonb, true),
              updated_at = now()
          where id = $1
            and (
              payload->'postExitOutcome' is null
              or payload->'postExitOutcome' = 'null'::jsonb
            )
        `,
          [row.event_id, json],
        );
    if (!existing.eventPresent && eventUpdate.rowCount !== 1) {
      throw new Error(`Exit event ${row.event_id} changed during enrichment.`);
    }
    const orderUpdate =
      row.order_id && !existing.orderPresent
        ? await client.query(
            `
            update shadow_orders
            set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{postExitOutcome}', $2::jsonb, true),
                updated_at = now()
            where id = $1
              and (
                payload->'postExitOutcome' is null
                or payload->'postExitOutcome' = 'null'::jsonb
              )
          `,
            [row.order_id, json],
          )
        : { rowCount: 0 };
    if (row.order_id && !existing.orderPresent && orderUpdate.rowCount !== 1) {
      throw new Error(
        `Shadow order ${row.order_id} changed during enrichment.`,
      );
    }
    await client.query("commit");
    return {
      eventUpdated: eventUpdate.rowCount ?? 0,
      orderUpdated: orderUpdate.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function computeOutcomeForRow(
  row: ExitRow,
  config: Config,
  getBars: typeof getOptionChartBarsWithDebug = getOptionChartBarsWithDebug,
) {
  const payload = asRecord(row.event_payload);
  const contract = resolveOptionContract(row);
  const entryPrice = entryPriceFromPayload(payload);
  const exitPrice = exitPriceFromPayload(payload);
  if (
    !contract ||
    entryPrice == null ||
    entryPrice <= 0 ||
    exitPrice == null ||
    exitPrice <= 0
  ) {
    return { outcome: null, reason: "missing_contract_or_price" };
  }

  const bars = await getBars({
    underlying: contract.underlying,
    expirationDate: contract.expirationDate,
    strike: contract.strike,
    right: contract.right,
    optionTicker: contract.optionTicker,
    skipBrokerContractResolution: Boolean(contract.optionTicker),
    timeframe: "1m",
    from: row.occurred_at,
    to: config.to,
    limit: OPTION_BAR_LIMIT,
    outsideRth: false,
  });
  if (!bars.bars.length) {
    return { outcome: null, reason: bars.emptyReason ?? "no_option_bars" };
  }
  // ponytail: fail closed at the single-page ceiling; paginate with historyCursor
  // before publishing an outcome when exact long-window coverage is required.
  if (
    bars.bars.length >= OPTION_BAR_LIMIT ||
    bars.debug.capped === true ||
    bars.debug.complete === false ||
    bars.historyPage.providerPageLimitReached
  ) {
    return { outcome: null, reason: "incomplete_option_bar_coverage" };
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
    const existing = selectExistingOutcome(row);
    if (
      existing.eventPresent &&
      (row.order_id == null || existing.orderPresent)
    ) {
      summary.alreadyPresent += 1;
      continue;
    }

    const outcomeResult = existing.outcome
      ? { outcome: existing.outcome, reason: null }
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

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

export const __shadowOptionsPostExitEnrichInternalsForTests = {
  computeOutcomeForRow,
  errorMessage,
  finiteNumber,
  loadExitRows,
  optionRight,
  readConfig,
  selectExistingOutcome,
  updateMissingOutcome,
};

if (import.meta.url === invokedPath) {
  void main()
    .catch((error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await pool.end();
      } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
      }
    });
}
