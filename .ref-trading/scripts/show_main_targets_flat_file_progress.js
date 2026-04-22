#!/usr/bin/env node

import { Pool } from "pg";
import { isResearchOptionBarStoreEnabled } from "../server/services/massiveFlatFileStore.js";

const DEFAULT_FROM = "2024-03-20";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  if (!match) {
    return fallback;
  }
  const value = match.slice(prefix.length).trim();
  return value || fallback;
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}` === text ? text : null;
}

function computeDefaultToDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readDatasetProgress(pool, datasetKey, from, to) {
  const summarySql = `
    SELECT
      status,
      COUNT(*)::int AS count,
      MIN(trade_date)::text AS min_date,
      MAX(trade_date)::text AS max_date,
      MAX(updated_at)::text AS updated_at
    FROM massive_flat_file_ingest_state
    WHERE dataset_key = $1
      AND trade_date >= $2::date
      AND trade_date <= $3::date
    GROUP BY status
    ORDER BY status
  `;
  const latestImportedSql = `
    SELECT MAX(trade_date)::text AS latest_imported
    FROM massive_flat_file_ingest_state
    WHERE dataset_key = $1
      AND trade_date >= $2::date
      AND trade_date <= $3::date
      AND status = 'imported'
  `;
  const runningSql = `
    SELECT COALESCE(array_agg(trade_date::text ORDER BY trade_date), ARRAY[]::text[]) AS dates
    FROM massive_flat_file_ingest_state
    WHERE dataset_key = $1
      AND trade_date >= $2::date
      AND trade_date <= $3::date
      AND status = 'running'
  `;
  const missingSql = `
    SELECT COALESCE(array_agg(trade_date::text ORDER BY trade_date), ARRAY[]::text[]) AS dates
    FROM (
      SELECT trade_date
      FROM massive_flat_file_ingest_state
      WHERE dataset_key = $1
        AND trade_date >= $2::date
        AND trade_date <= $3::date
        AND status = 'missing'
      ORDER BY trade_date
      LIMIT 15
    ) missing
  `;

  const [summaryResult, latestImportedResult, runningResult, missingResult] = await Promise.all([
    pool.query(summarySql, [datasetKey, from, to]),
    pool.query(latestImportedSql, [datasetKey, from, to]),
    pool.query(runningSql, [datasetKey, from, to]),
    pool.query(missingSql, [datasetKey, from, to]),
  ]);

  return {
    datasetKey,
    latestImported: latestImportedResult.rows?.[0]?.latest_imported || null,
    runningDates: runningResult.rows?.[0]?.dates || [],
    missingDatesSample: missingResult.rows?.[0]?.dates || [],
    statuses: summaryResult.rows || [],
  };
}

async function main() {
  const from = normalizeDateText(parseArg("from", DEFAULT_FROM));
  const to = normalizeDateText(parseArg("to", computeDefaultToDate()));
  if (!from || !to) {
    throw new Error("--from and --to must be valid YYYY-MM-DD dates.");
  }
  if (to < from) {
    throw new Error("--to must be on or after --from.");
  }

  const connectionString = process.env.DATABASE_URL || process.env.MASSIVE_DB_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL or MASSIVE_DB_URL is required.");
  }

  const pool = new Pool({
    connectionString,
    application_name: "core-flat-file-progress",
  });

  try {
    const [equities, options] = await Promise.all([
      readDatasetProgress(pool, "stocks-minute-aggs", from, to),
      isResearchOptionBarStoreEnabled()
        ? readDatasetProgress(pool, "options-minute-aggs", from, to)
        : Promise.resolve({
          datasetKey: "options-minute-aggs",
          disabled: true,
          reason: "api_only_mode",
          latestImported: null,
          runningDates: [],
          missingDatesSample: [],
          statuses: [],
        }),
    ]);

    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      from,
      to,
      datasets: {
        equities,
        options,
      },
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
