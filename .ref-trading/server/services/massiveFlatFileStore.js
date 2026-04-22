import { Pool } from "pg";
import { buildResearchBarFromEpochMs } from "../../src/research/market/time.js";

const DEFAULT_APP_NAME = "spy-options-backtest";
const FLAT_FILE_REGISTRY_TABLE = "massive_flat_file_registry";
const FLAT_FILE_INGEST_STATE_TABLE = "massive_flat_file_ingest_state";
const RESEARCH_OPTION_BARS_TABLE = "research_option_bars_1m";
const RESEARCH_OPTION_COVERAGE_TABLE = "research_option_bars_coverage";
const OPTION_INSERT_BATCH_SIZE = 5000;

const DEFAULT_REGISTRY_ENTRIES = [
  {
    datasetKey: "stocks-minute-aggs",
    assetClass: "equity",
    symbol: "SPY",
    enabled: true,
    sourceNote: "seeded default tracked universe",
    metadata: { scope: "manual", priority: "core" },
  },
  {
    datasetKey: "stocks-minute-aggs",
    assetClass: "equity",
    symbol: "QQQ",
    enabled: true,
    sourceNote: "seeded default tracked universe",
    metadata: { scope: "manual", priority: "core" },
  },
  {
    datasetKey: "options-minute-aggs",
    assetClass: "option_underlying",
    symbol: "SPY",
    enabled: true,
    sourceNote: "seeded default tracked universe",
    metadata: { scope: "manual", priority: "core" },
  },
  {
    datasetKey: "options-minute-aggs",
    assetClass: "option_underlying",
    symbol: "QQQ",
    enabled: true,
    sourceNote: "seeded default tracked universe",
    metadata: { scope: "manual", priority: "core" },
  },
];

let pool = null;
let initPromise = null;

export function isMassiveFlatFileStoreConfigured() {
  return Boolean(resolvePgConfig());
}

export function isResearchOptionBarStoreEnabled() {
  const explicit = firstNonEmpty(
    process.env.ENABLE_RESEARCH_OPTION_BAR_STORE,
    process.env.MASSIVE_ENABLE_OPTION_BAR_STORE,
  ).toLowerCase();
  if (!explicit) {
    return false;
  }
  return !["0", "false", "no", "off", "disabled"].includes(explicit);
}

export async function readMassiveFlatFileRegistryEntries({
  datasetKey = null,
  assetClass = null,
  enabledOnly = false,
} = {}) {
  const client = await getPoolIfConfigured();
  if (!client) {
    return [];
  }
  await ensureSchema(client);

  const params = [];
  const clauses = [];
  const normalizedDatasetKey = normalizeIdentifier(datasetKey);
  const normalizedAssetClass = normalizeIdentifier(assetClass);
  if (normalizedDatasetKey) {
    clauses.push(`dataset_key = $${params.push(normalizedDatasetKey)}`);
  }
  if (normalizedAssetClass) {
    clauses.push(`asset_class = $${params.push(normalizedAssetClass)}`);
  }
  if (enabledOnly) {
    clauses.push("enabled = TRUE");
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await client.query(
    `
      SELECT
        dataset_key,
        asset_class,
        symbol,
        enabled,
        start_date::text AS start_date,
        end_date::text AS end_date,
        source_note,
        metadata,
        created_at,
        updated_at
      FROM ${FLAT_FILE_REGISTRY_TABLE}
      ${whereClause}
      ORDER BY dataset_key ASC, symbol ASC
    `,
    params,
  );

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    datasetKey: normalizeIdentifier(row?.dataset_key),
    assetClass: normalizeIdentifier(row?.asset_class),
    symbol: normalizeSymbol(row?.symbol),
    enabled: Boolean(row?.enabled),
    startDate: normalizeDateText(row?.start_date),
    endDate: normalizeDateText(row?.end_date),
    sourceNote: String(row?.source_note || "").trim() || null,
    metadata: row?.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: toIsoOrNull(row?.created_at),
    updatedAt: toIsoOrNull(row?.updated_at),
  })).filter((row) => row.datasetKey && row.symbol);
}

export async function upsertMassiveFlatFileRegistryEntries(entries = []) {
  const preparedEntries = (Array.isArray(entries) ? entries : [])
    .map(normalizeRegistryEntry)
    .filter(Boolean);
  if (!preparedEntries.length) {
    return {
      ok: false,
      count: 0,
    };
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return {
      ok: false,
      count: 0,
    };
  }
  await ensureSchema(client);

  await client.query(
    `
      WITH input_rows AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS row(
          dataset_key text,
          asset_class text,
          symbol text,
          enabled boolean,
          start_date date,
          end_date date,
          source_note text,
          metadata jsonb
        )
      )
      INSERT INTO ${FLAT_FILE_REGISTRY_TABLE} (
        dataset_key,
        asset_class,
        symbol,
        enabled,
        start_date,
        end_date,
        source_note,
        metadata,
        updated_at
      )
      SELECT
        dataset_key,
        asset_class,
        symbol,
        enabled,
        start_date,
        end_date,
        source_note,
        metadata,
        NOW()
      FROM input_rows
      ON CONFLICT (dataset_key, symbol)
      DO UPDATE SET
        asset_class = EXCLUDED.asset_class,
        enabled = EXCLUDED.enabled,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        source_note = EXCLUDED.source_note,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [JSON.stringify(preparedEntries)],
  );

  return {
    ok: true,
    count: preparedEntries.length,
  };
}

export async function readMassiveFlatFileIngestState({
  datasetKey,
  tradeDate,
} = {}) {
  const normalizedDatasetKey = normalizeIdentifier(datasetKey);
  const normalizedTradeDate = normalizeDateText(tradeDate);
  if (!normalizedDatasetKey || !normalizedTradeDate) {
    return null;
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return null;
  }
  await ensureSchema(client);

  const { rows } = await client.query(
    `
      SELECT
        dataset_key,
        trade_date::text AS trade_date,
        status,
        tracked_symbols,
        object_key,
        raw_archive_path,
        file_size_bytes,
        checksum_sha256,
        row_count_total,
        row_count_kept,
        bar_count_written,
        metadata,
        last_error,
        started_at,
        finished_at,
        created_at,
        updated_at
      FROM ${FLAT_FILE_INGEST_STATE_TABLE}
      WHERE dataset_key = $1 AND trade_date = $2::date
      LIMIT 1
    `,
    [normalizedDatasetKey, normalizedTradeDate],
  );
  const row = rows?.[0];
  if (!row) {
    return null;
  }
  return normalizeIngestStateRow(row);
}

export async function upsertMassiveFlatFileIngestState(state = {}) {
  const normalizedState = normalizeIngestStateInput(state);
  if (!normalizedState) {
    return false;
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return false;
  }
  await ensureSchema(client);

  await client.query(
    `
      INSERT INTO ${FLAT_FILE_INGEST_STATE_TABLE} (
        dataset_key,
        trade_date,
        status,
        tracked_symbols,
        object_key,
        raw_archive_path,
        file_size_bytes,
        checksum_sha256,
        row_count_total,
        row_count_kept,
        bar_count_written,
        metadata,
        last_error,
        started_at,
        finished_at,
        updated_at
      ) VALUES (
        $1,
        $2::date,
        $3,
        $4::jsonb,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb,
        $13,
        $14::timestamptz,
        $15::timestamptz,
        NOW()
      )
      ON CONFLICT (dataset_key, trade_date)
      DO UPDATE SET
        status = EXCLUDED.status,
        tracked_symbols = EXCLUDED.tracked_symbols,
        object_key = EXCLUDED.object_key,
        raw_archive_path = EXCLUDED.raw_archive_path,
        file_size_bytes = EXCLUDED.file_size_bytes,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        row_count_total = EXCLUDED.row_count_total,
        row_count_kept = EXCLUDED.row_count_kept,
        bar_count_written = EXCLUDED.bar_count_written,
        metadata = EXCLUDED.metadata,
        last_error = EXCLUDED.last_error,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        updated_at = NOW()
    `,
    [
      normalizedState.datasetKey,
      normalizedState.tradeDate,
      normalizedState.status,
      JSON.stringify(normalizedState.trackedSymbols),
      normalizedState.objectKey,
      normalizedState.rawArchivePath,
      normalizedState.fileSizeBytes,
      normalizedState.checksumSha256,
      normalizedState.rowCountTotal,
      normalizedState.rowCountKept,
      normalizedState.barCountWritten,
      JSON.stringify(normalizedState.metadata),
      normalizedState.lastError,
      normalizedState.startedAt,
      normalizedState.finishedAt,
    ],
  );
  return true;
}

export async function readResearchOptionBarsCoverage({
  optionTicker,
  session = "regular",
  timeframe = "1m",
} = {}) {
  if (!isResearchOptionBarStoreEnabled()) {
    return null;
  }
  const normalizedTicker = normalizeOptionTicker(optionTicker);
  const normalizedSession = normalizeSession(session);
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  if (!normalizedTicker) {
    return null;
  }
  const client = await getPoolIfConfigured();
  if (!client) {
    return null;
  }
  await ensureSchema(client);

  const { rows } = await client.query(
    `
      SELECT
        option_ticker,
        underlying_ticker,
        session,
        timeframe,
        coverage_start::text AS coverage_start,
        coverage_end::text AS coverage_end,
        source,
        fetched_at,
        updated_at
      FROM ${RESEARCH_OPTION_COVERAGE_TABLE}
      WHERE option_ticker = $1 AND session = $2 AND timeframe = $3
      LIMIT 1
    `,
    [normalizedTicker, normalizedSession, normalizedTimeframe],
  );
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  const row = rows[0] || {};
  return {
    optionTicker: normalizedTicker,
    underlyingTicker: normalizeSymbol(row?.underlying_ticker),
    session: normalizedSession,
    timeframe: normalizedTimeframe,
    coverageStart: normalizeDateText(row?.coverage_start),
    coverageEnd: normalizeDateText(row?.coverage_end),
    source: String(row?.source || "").trim() || null,
    fetchedAt: toIsoOrNull(row?.fetched_at),
    updatedAt: toIsoOrNull(row?.updated_at),
  };
}

export async function readResearchOptionBars({
  optionTicker,
  session = "regular",
  from,
  to,
  limit = null,
  sort = "asc",
} = {}) {
  if (!isResearchOptionBarStoreEnabled()) {
    return [];
  }
  const normalizedTicker = normalizeOptionTicker(optionTicker);
  const normalizedSession = normalizeSession(session);
  const fromDate = normalizeDateText(from);
  const toDate = normalizeDateText(to);
  if (!normalizedTicker || !fromDate || !toDate) {
    return [];
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return [];
  }
  await ensureSchema(client);

  const normalizedSort = String(sort || "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
  const params = [normalizedTicker, normalizedSession, fromDate, toDate];
  const limitClause = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? `LIMIT $${params.push(Math.max(1, Math.round(Number(limit))))}`
    : "";

  const { rows } = await client.query(
    `
      SELECT
        bar_time_ms,
        trade_date::text AS trade_date,
        ts,
        hour,
        minute,
        open_price,
        high_price,
        low_price,
        close_price,
        volume,
        trade_count,
        vwap
      FROM ${RESEARCH_OPTION_BARS_TABLE}
      WHERE option_ticker = $1
        AND session = $2
        AND trade_date >= $3::date
        AND trade_date <= $4::date
      ORDER BY bar_time_ms ${normalizedSort}
      ${limitClause}
    `,
    params,
  );

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    time: Number(row?.bar_time_ms),
    ts: String(row?.ts || "").trim() || null,
    date: normalizeDateText(row?.trade_date),
    hour: Number(row?.hour),
    min: Number(row?.minute),
    o: Number(row?.open_price),
    h: Number(row?.high_price),
    l: Number(row?.low_price),
    c: Number(row?.close_price),
    v: Math.max(0, Math.round(Number(row?.volume) || 0)),
    n: Number.isFinite(Number(row?.trade_count)) ? Math.max(0, Math.round(Number(row.trade_count))) : null,
    vw: Number.isFinite(Number(row?.vwap)) ? Number(row.vwap) : null,
  })).filter((bar) => Number.isFinite(bar.time));
}

export async function writeResearchOptionBars({
  optionTicker,
  underlyingTicker = null,
  session = "regular",
  bars = [],
  source = "massive-options-history",
  fetchedAt = null,
} = {}) {
  if (!isResearchOptionBarStoreEnabled()) {
    return {
      ok: false,
      insertedCount: 0,
      coverageStart: null,
      coverageEnd: null,
      skipped: true,
      reason: "disabled",
    };
  }
  const normalizedOptionTicker = normalizeOptionTicker(optionTicker);
  const normalizedUnderlyingTicker = normalizeSymbol(underlyingTicker);
  const normalizedSession = normalizeSession(session);
  const preparedBars = (Array.isArray(bars) ? bars : [])
    .map((bar) => normalizeResearchOptionBarRecord(bar, normalizedOptionTicker, normalizedUnderlyingTicker, normalizedSession))
    .filter(Boolean);
  if (!normalizedOptionTicker || !preparedBars.length) {
    return {
      ok: false,
      insertedCount: 0,
      coverageStart: null,
      coverageEnd: null,
    };
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return {
      ok: false,
      insertedCount: 0,
      coverageStart: null,
      coverageEnd: null,
    };
  }
  await ensureSchema(client);

  const coverageStart = preparedBars[0]?.tradeDate || null;
  const coverageEnd = preparedBars[preparedBars.length - 1]?.tradeDate || null;
  const normalizedFetchedAt = toIsoOrNull(fetchedAt) || new Date().toISOString();

  for (let index = 0; index < preparedBars.length; index += OPTION_INSERT_BATCH_SIZE) {
    const batch = preparedBars.slice(index, index + OPTION_INSERT_BATCH_SIZE);
    await client.query(
      `
        WITH input_rows AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS row(
            option_ticker text,
            underlying_ticker text,
            session text,
            bar_time_ms bigint,
            trade_date date,
            ts text,
            hour smallint,
            minute smallint,
            open_price numeric,
            high_price numeric,
            low_price numeric,
            close_price numeric,
            volume bigint,
            trade_count integer,
            vwap numeric
          )
        )
        INSERT INTO ${RESEARCH_OPTION_BARS_TABLE} (
          option_ticker,
          underlying_ticker,
          session,
          bar_time_ms,
          trade_date,
          ts,
          hour,
          minute,
          open_price,
          high_price,
          low_price,
          close_price,
          volume,
          trade_count,
          vwap,
          source,
          fetched_at,
          updated_at
        )
        SELECT
          option_ticker,
          underlying_ticker,
          session,
          bar_time_ms,
          trade_date,
          ts,
          hour,
          minute,
          open_price,
          high_price,
          low_price,
          close_price,
          volume,
          trade_count,
          vwap,
          $2::text,
          $3::timestamptz,
          NOW()
        FROM input_rows
        ON CONFLICT (option_ticker, session, bar_time_ms)
        DO UPDATE SET
          underlying_ticker = COALESCE(EXCLUDED.underlying_ticker, ${RESEARCH_OPTION_BARS_TABLE}.underlying_ticker),
          trade_date = EXCLUDED.trade_date,
          ts = EXCLUDED.ts,
          hour = EXCLUDED.hour,
          minute = EXCLUDED.minute,
          open_price = EXCLUDED.open_price,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          close_price = EXCLUDED.close_price,
          volume = EXCLUDED.volume,
          trade_count = EXCLUDED.trade_count,
          vwap = EXCLUDED.vwap,
          source = EXCLUDED.source,
          fetched_at = EXCLUDED.fetched_at,
          updated_at = NOW()
      `,
      [JSON.stringify(batch), String(source || "").trim() || null, normalizedFetchedAt],
    );
  }

  await client.query(
    `
      INSERT INTO ${RESEARCH_OPTION_COVERAGE_TABLE} (
        option_ticker,
        underlying_ticker,
        session,
        timeframe,
        coverage_start,
        coverage_end,
        source,
        fetched_at,
        updated_at
      ) VALUES ($1, $2, $3, '1m', $4::date, $5::date, $6, $7::timestamptz, NOW())
      ON CONFLICT (option_ticker, session, timeframe)
      DO UPDATE SET
        underlying_ticker = COALESCE(EXCLUDED.underlying_ticker, ${RESEARCH_OPTION_COVERAGE_TABLE}.underlying_ticker),
        coverage_start = CASE
          WHEN ${RESEARCH_OPTION_COVERAGE_TABLE}.coverage_start IS NULL THEN EXCLUDED.coverage_start
          WHEN EXCLUDED.coverage_start IS NULL THEN ${RESEARCH_OPTION_COVERAGE_TABLE}.coverage_start
          ELSE LEAST(${RESEARCH_OPTION_COVERAGE_TABLE}.coverage_start, EXCLUDED.coverage_start)
        END,
        coverage_end = CASE
          WHEN ${RESEARCH_OPTION_COVERAGE_TABLE}.coverage_end IS NULL THEN EXCLUDED.coverage_end
          WHEN EXCLUDED.coverage_end IS NULL THEN ${RESEARCH_OPTION_COVERAGE_TABLE}.coverage_end
          ELSE GREATEST(${RESEARCH_OPTION_COVERAGE_TABLE}.coverage_end, EXCLUDED.coverage_end)
        END,
        source = COALESCE(EXCLUDED.source, ${RESEARCH_OPTION_COVERAGE_TABLE}.source),
        fetched_at = CASE
          WHEN ${RESEARCH_OPTION_COVERAGE_TABLE}.fetched_at IS NULL THEN EXCLUDED.fetched_at
          WHEN EXCLUDED.fetched_at IS NULL THEN ${RESEARCH_OPTION_COVERAGE_TABLE}.fetched_at
          ELSE GREATEST(${RESEARCH_OPTION_COVERAGE_TABLE}.fetched_at, EXCLUDED.fetched_at)
        END,
        updated_at = NOW()
    `,
    [
      normalizedOptionTicker,
      normalizedUnderlyingTicker,
      normalizedSession,
      coverageStart,
      coverageEnd,
      String(source || "").trim() || null,
      normalizedFetchedAt,
    ],
  );

  return {
    ok: true,
    insertedCount: preparedBars.length,
    coverageStart,
    coverageEnd,
  };
}

async function getPoolIfConfigured() {
  if (pool) {
    return pool;
  }
  const config = resolvePgConfig();
  if (!config) {
    return null;
  }
  pool = new Pool(config);
  pool.on("error", (error) => {
    console.error("[massive-flat-file-store] Postgres pool error:", error);
  });
  return pool;
}

async function ensureSchema(client) {
  if (initPromise) {
    return initPromise;
  }
  initPromise = client.query(`
    CREATE TABLE IF NOT EXISTS ${FLAT_FILE_REGISTRY_TABLE} (
      dataset_key TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      symbol TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      start_date DATE,
      end_date DATE,
      source_note TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (dataset_key, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_${FLAT_FILE_REGISTRY_TABLE}_dataset_enabled
      ON ${FLAT_FILE_REGISTRY_TABLE} (dataset_key, enabled, symbol);
    CREATE INDEX IF NOT EXISTS idx_${FLAT_FILE_REGISTRY_TABLE}_updated
      ON ${FLAT_FILE_REGISTRY_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${FLAT_FILE_INGEST_STATE_TABLE} (
      dataset_key TEXT NOT NULL,
      trade_date DATE NOT NULL,
      status TEXT NOT NULL,
      tracked_symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
      object_key TEXT,
      raw_archive_path TEXT,
      file_size_bytes BIGINT,
      checksum_sha256 TEXT,
      row_count_total BIGINT,
      row_count_kept BIGINT,
      bar_count_written BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (dataset_key, trade_date)
    );
    CREATE INDEX IF NOT EXISTS idx_${FLAT_FILE_INGEST_STATE_TABLE}_status_updated
      ON ${FLAT_FILE_INGEST_STATE_TABLE} (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_${FLAT_FILE_INGEST_STATE_TABLE}_updated
      ON ${FLAT_FILE_INGEST_STATE_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${RESEARCH_OPTION_BARS_TABLE} (
      option_ticker TEXT NOT NULL,
      underlying_ticker TEXT,
      session TEXT NOT NULL DEFAULT 'regular',
      bar_time_ms BIGINT NOT NULL,
      trade_date DATE NOT NULL,
      ts TEXT NOT NULL,
      hour SMALLINT NOT NULL,
      minute SMALLINT NOT NULL,
      open_price NUMERIC NOT NULL,
      high_price NUMERIC NOT NULL,
      low_price NUMERIC NOT NULL,
      close_price NUMERIC NOT NULL,
      volume BIGINT NOT NULL DEFAULT 0,
      trade_count INTEGER,
      vwap NUMERIC,
      source TEXT,
      fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (option_ticker, session, bar_time_ms)
    );
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_OPTION_BARS_TABLE}_underlying_date
      ON ${RESEARCH_OPTION_BARS_TABLE} (underlying_ticker, session, trade_date, bar_time_ms);
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_OPTION_BARS_TABLE}_ticker_date
      ON ${RESEARCH_OPTION_BARS_TABLE} (option_ticker, session, trade_date, bar_time_ms);
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_OPTION_BARS_TABLE}_updated
      ON ${RESEARCH_OPTION_BARS_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${RESEARCH_OPTION_COVERAGE_TABLE} (
      option_ticker TEXT NOT NULL,
      underlying_ticker TEXT,
      session TEXT NOT NULL DEFAULT 'regular',
      timeframe TEXT NOT NULL DEFAULT '1m',
      coverage_start DATE,
      coverage_end DATE,
      source TEXT,
      fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (option_ticker, session, timeframe)
    );
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_OPTION_COVERAGE_TABLE}_underlying_updated
      ON ${RESEARCH_OPTION_COVERAGE_TABLE} (underlying_ticker, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_OPTION_COVERAGE_TABLE}_updated
      ON ${RESEARCH_OPTION_COVERAGE_TABLE} (updated_at DESC);
  `)
    .then(() => seedDefaultRegistryEntries(client))
    .catch((error) => {
      initPromise = null;
      throw error;
    });
  return initPromise;
}

async function seedDefaultRegistryEntries(client) {
  await client.query(
    `
      INSERT INTO ${FLAT_FILE_REGISTRY_TABLE} (
        dataset_key,
        asset_class,
        symbol,
        enabled,
        source_note,
        metadata,
        updated_at
      )
      SELECT
        row.dataset_key,
        row.asset_class,
        row.symbol,
        row.enabled,
        row.source_note,
        row.metadata,
        NOW()
      FROM jsonb_to_recordset($1::jsonb) AS row(
        dataset_key text,
        asset_class text,
        symbol text,
        enabled boolean,
        source_note text,
        metadata jsonb
      )
      ON CONFLICT (dataset_key, symbol)
      DO NOTHING
    `,
    [JSON.stringify(DEFAULT_REGISTRY_ENTRIES.map((entry) => ({
      dataset_key: entry.datasetKey,
      asset_class: entry.assetClass,
      symbol: entry.symbol,
      enabled: entry.enabled,
      source_note: entry.sourceNote,
      metadata: entry.metadata,
    })))],
  );
}

function normalizeRegistryEntry(entry) {
  const normalizedDatasetKey = normalizeIdentifier(entry?.datasetKey);
  const normalizedAssetClass = normalizeIdentifier(entry?.assetClass);
  const normalizedSymbol = normalizeSymbol(entry?.symbol);
  if (!normalizedDatasetKey || !normalizedAssetClass || !normalizedSymbol) {
    return null;
  }
  return {
    dataset_key: normalizedDatasetKey,
    asset_class: normalizedAssetClass,
    symbol: normalizedSymbol,
    enabled: entry?.enabled !== false,
    start_date: normalizeDateText(entry?.startDate),
    end_date: normalizeDateText(entry?.endDate),
    source_note: String(entry?.sourceNote || "").trim() || null,
    metadata: entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
  };
}

function normalizeIngestStateInput(state) {
  const datasetKey = normalizeIdentifier(state?.datasetKey);
  const tradeDate = normalizeDateText(state?.tradeDate);
  const status = normalizeIdentifier(state?.status) || "pending";
  if (!datasetKey || !tradeDate) {
    return null;
  }
  return {
    datasetKey,
    tradeDate,
    status,
    trackedSymbols: normalizeSymbolList(state?.trackedSymbols),
    objectKey: String(state?.objectKey || "").trim() || null,
    rawArchivePath: String(state?.rawArchivePath || "").trim() || null,
    fileSizeBytes: toSafeIntegerOrNull(state?.fileSizeBytes),
    checksumSha256: String(state?.checksumSha256 || "").trim() || null,
    rowCountTotal: toSafeIntegerOrNull(state?.rowCountTotal),
    rowCountKept: toSafeIntegerOrNull(state?.rowCountKept),
    barCountWritten: toSafeIntegerOrNull(state?.barCountWritten),
    metadata: state?.metadata && typeof state.metadata === "object" ? state.metadata : {},
    lastError: String(state?.lastError || "").trim() || null,
    startedAt: toIsoOrNull(state?.startedAt),
    finishedAt: toIsoOrNull(state?.finishedAt),
  };
}

function normalizeIngestStateRow(row) {
  return {
    datasetKey: normalizeIdentifier(row?.dataset_key),
    tradeDate: normalizeDateText(row?.trade_date),
    status: normalizeIdentifier(row?.status),
    trackedSymbols: normalizeSymbolList(row?.tracked_symbols),
    objectKey: String(row?.object_key || "").trim() || null,
    rawArchivePath: String(row?.raw_archive_path || "").trim() || null,
    fileSizeBytes: toSafeIntegerOrNull(row?.file_size_bytes),
    checksumSha256: String(row?.checksum_sha256 || "").trim() || null,
    rowCountTotal: toSafeIntegerOrNull(row?.row_count_total),
    rowCountKept: toSafeIntegerOrNull(row?.row_count_kept),
    barCountWritten: toSafeIntegerOrNull(row?.bar_count_written),
    metadata: row?.metadata && typeof row.metadata === "object" ? row.metadata : {},
    lastError: String(row?.last_error || "").trim() || null,
    startedAt: toIsoOrNull(row?.started_at),
    finishedAt: toIsoOrNull(row?.finished_at),
    createdAt: toIsoOrNull(row?.created_at),
    updatedAt: toIsoOrNull(row?.updated_at),
  };
}

function normalizeResearchOptionBarRecord(bar, optionTicker, underlyingTicker, session) {
  const time = Number(bar?.time);
  const openPrice = Number(bar?.o);
  const highPrice = Number(bar?.h);
  const lowPrice = Number(bar?.l);
  const closePrice = Number(bar?.c);
  if (!optionTicker || ![time, openPrice, highPrice, lowPrice, closePrice].every(Number.isFinite)) {
    return null;
  }

  const normalizedBar = buildResearchBarFromEpochMs(Math.round(time), {
    o: openPrice,
    h: highPrice,
    l: lowPrice,
    c: closePrice,
    v: Math.max(0, Math.round(Number(bar?.v) || 0)),
    n: Number.isFinite(Number(bar?.n)) ? Math.max(0, Math.round(Number(bar.n))) : null,
    vw: Number.isFinite(Number(bar?.vw)) ? Number(bar.vw) : null,
  });
  const tradeDate = normalizeDateText(normalizedBar?.date);
  if (!tradeDate) {
    return null;
  }

  return {
    option_ticker: optionTicker,
    underlying_ticker: underlyingTicker,
    session,
    bar_time_ms: Math.round(normalizedBar.time),
    tradeDate,
    trade_date: tradeDate,
    ts: normalizedBar.ts,
    hour: Math.max(0, Math.min(23, Math.round(Number(normalizedBar.hour) || 0))),
    minute: Math.max(0, Math.min(59, Math.round(Number(normalizedBar.min) || 0))),
    open_price: openPrice,
    high_price: highPrice,
    low_price: lowPrice,
    close_price: closePrice,
    volume: Math.max(0, Math.round(Number(normalizedBar.v) || 0)),
    trade_count: Number.isFinite(Number(normalizedBar?.n)) ? Math.max(0, Math.round(Number(normalizedBar.n))) : null,
    vwap: Number.isFinite(Number(normalizedBar?.vw)) ? Number(normalizedBar.vw) : null,
  };
}

function resolvePgConfig() {
  const disabled = String(process.env.MASSIVE_DB_CACHE_DISABLED || "").trim().toLowerCase();
  if (disabled === "1" || disabled === "true" || disabled === "yes") {
    return null;
  }

  const url = firstNonEmpty(
    process.env.MASSIVE_DB_URL,
    process.env.BACKTEST_DATABASE_URL,
    process.env.DATABASE_URL,
  );
  const ssl = resolveSslConfig();

  if (url) {
    return {
      connectionString: url,
      max: clampInt(process.env.PGPOOL_MAX, 1, 40, 8),
      idleTimeoutMillis: clampInt(process.env.PGPOOL_IDLE_TIMEOUT_MS, 1000, 120000, 15000),
      connectionTimeoutMillis: clampInt(process.env.PGPOOL_CONNECT_TIMEOUT_MS, 1000, 60000, 10000),
      statement_timeout: clampInt(process.env.PG_STATEMENT_TIMEOUT_MS, 1000, 120000, 30000),
      application_name: firstNonEmpty(process.env.PGAPPNAME, `${DEFAULT_APP_NAME}-massive-flat-files`),
      ...(ssl != null ? { ssl } : {}),
    };
  }

  const host = firstNonEmpty(process.env.PGHOST, process.env.POSTGRES_HOST);
  if (!host) {
    return null;
  }

  return {
    host,
    port: clampInt(firstNonEmpty(process.env.PGPORT, process.env.POSTGRES_PORT), 1, 65535, 5432),
    user: firstNonEmpty(process.env.PGUSER, process.env.POSTGRES_USER),
    password: firstNonEmpty(process.env.PGPASSWORD, process.env.POSTGRES_PASSWORD),
    database: firstNonEmpty(process.env.PGDATABASE, process.env.POSTGRES_DB),
    max: clampInt(process.env.PGPOOL_MAX, 1, 40, 8),
    idleTimeoutMillis: clampInt(process.env.PGPOOL_IDLE_TIMEOUT_MS, 1000, 120000, 15000),
    connectionTimeoutMillis: clampInt(process.env.PGPOOL_CONNECT_TIMEOUT_MS, 1000, 60000, 10000),
    statement_timeout: clampInt(process.env.PG_STATEMENT_TIMEOUT_MS, 1000, 120000, 30000),
    application_name: firstNonEmpty(process.env.PGAPPNAME, `${DEFAULT_APP_NAME}-massive-flat-files`),
    ...(ssl != null ? { ssl } : {}),
  };
}

function resolveSslConfig() {
  const mode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
  if (!mode) {
    return null;
  }
  if (mode === "disable" || mode === "false" || mode === "0") {
    return false;
  }
  const rejectUnauthorized = !["allow", "prefer", "require"].includes(mode);
  return { rejectUnauthorized };
}

function clampInt(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeIdentifier(value) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

function normalizeSymbol(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

function normalizeSymbolList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeSymbol).filter(Boolean);
}

function normalizeOptionTicker(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

function normalizeSession(value) {
  const text = String(value || "regular").trim().toLowerCase();
  return text || "regular";
}

function normalizeTimeframe(value) {
  const text = String(value || "1m").trim().toLowerCase();
  return text || "1m";
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toSafeIntegerOrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.round(numeric);
  return rounded < 0 ? 0 : rounded;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
