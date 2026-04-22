import { Pool } from "pg";

const DEFAULT_APP_NAME = "spy-options-backtest";
const OPTIONS_CACHE_TABLE = "massive_options_bars_cache";
const EQUITY_CACHE_TABLE = "massive_equity_bars_cache";
const RESEARCH_SPOT_BARS_TABLE = "research_spot_bars_1m";
const RESEARCH_SPOT_COVERAGE_TABLE = "research_spot_bars_coverage";
const RESEARCH_SPOT_WARM_STATE_TABLE = "research_spot_warm_state";
const RESEARCH_SPOT_INSERT_BATCH_SIZE = 5000;
const RESEARCH_SPOT_WARM_LOCK_NAMESPACE = 48123;
const RESEARCH_SPOT_WARM_LOCK_KEY = 1;

let pool = null;
let initPromise = null;

export function isMassiveDbCacheConfigured() {
  return Boolean(resolvePgConfig());
}

export async function readMassiveDbCache(cacheKey) {
  return readCacheRow({
    tableName: OPTIONS_CACHE_TABLE,
    cacheKey,
  });
}

export async function readMassiveEquityDbCache(cacheKey) {
  return readCacheRow({
    tableName: EQUITY_CACHE_TABLE,
    cacheKey,
  });
}

export async function writeMassiveDbCache({ cacheKey, request, payload }) {
  return writeCacheRow({
    tableName: OPTIONS_CACHE_TABLE,
    cacheKey,
    tickerField: "option_ticker",
    tickerValue: String(request?.optionTicker || payload?.optionTicker || "").trim().toUpperCase() || null,
    request,
    payload,
  });
}

export async function writeMassiveEquityDbCache({ cacheKey, request, payload }) {
  return writeCacheRow({
    tableName: EQUITY_CACHE_TABLE,
    cacheKey,
    tickerField: "ticker",
    tickerValue: String(request?.ticker || payload?.ticker || "").trim().toUpperCase() || null,
    request,
    payload,
  });
}

export async function readResearchSpotBarsCoverage({
  ticker,
  session = "regular",
  timeframe = "1m",
} = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const normalizedSession = String(session || "regular").trim().toLowerCase() || "regular";
  const normalizedTimeframe = String(timeframe || "1m").trim().toLowerCase() || "1m";
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
        ticker,
        session,
        timeframe,
        coverage_start::text AS coverage_start,
        coverage_end::text AS coverage_end,
        source,
        fetched_at,
        updated_at
      FROM ${RESEARCH_SPOT_COVERAGE_TABLE}
      WHERE ticker = $1 AND session = $2 AND timeframe = $3
      LIMIT 1
    `,
    [normalizedTicker, normalizedSession, normalizedTimeframe],
  );
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  const row = rows[0] || {};
  return {
    ticker: normalizedTicker,
    session: normalizedSession,
    timeframe: normalizedTimeframe,
    coverageStart: String(row.coverage_start || "").trim() || null,
    coverageEnd: String(row.coverage_end || "").trim() || null,
    source: String(row.source || "").trim() || null,
    fetchedAt: toIsoOrNull(row.fetched_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function readResearchSpotBars({
  ticker,
  session = "regular",
  from,
  to,
  limit = null,
} = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const normalizedSession = String(session || "regular").trim().toLowerCase() || "regular";
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
      FROM ${RESEARCH_SPOT_BARS_TABLE}
      WHERE ticker = $1
        AND session = $2
        AND trade_date >= $3::date
        AND trade_date <= $4::date
      ORDER BY bar_time_ms ASC
      ${limitClause}
    `,
    params,
  );

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    time: Number(row?.bar_time_ms),
    ts: String(row?.ts || "").trim() || null,
    date: String(row?.trade_date || "").trim() || null,
    hour: Number(row?.hour),
    min: Number(row?.minute),
    o: Number(row?.open_price),
    h: Number(row?.high_price),
    l: Number(row?.low_price),
    c: Number(row?.close_price),
    v: Math.max(0, Math.round(Number(row?.volume) || 0)),
    n: Number.isFinite(Number(row?.trade_count)) ? Math.round(Number(row.trade_count)) : null,
    vw: Number.isFinite(Number(row?.vwap)) ? Number(row.vwap) : null,
  })).filter((bar) => Number.isFinite(bar.time));
}

export async function writeResearchSpotBars({
  ticker,
  session = "regular",
  bars = [],
  source = "massive-equity-history",
  fetchedAt = null,
} = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const normalizedSession = String(session || "regular").trim().toLowerCase() || "regular";
  const preparedBars = (Array.isArray(bars) ? bars : [])
    .map((bar) => normalizeResearchSpotBarRecord(bar, normalizedTicker, normalizedSession))
    .filter(Boolean);
  if (!normalizedTicker || !preparedBars.length) {
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

  for (let index = 0; index < preparedBars.length; index += RESEARCH_SPOT_INSERT_BATCH_SIZE) {
    const batch = preparedBars.slice(index, index + RESEARCH_SPOT_INSERT_BATCH_SIZE);
    await client.query(
      `
        WITH input_rows AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS row(
            ticker text,
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
        INSERT INTO ${RESEARCH_SPOT_BARS_TABLE} (
          ticker,
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
          ticker,
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
        ON CONFLICT (ticker, session, bar_time_ms)
        DO UPDATE SET
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
      INSERT INTO ${RESEARCH_SPOT_COVERAGE_TABLE} (
        ticker,
        session,
        timeframe,
        coverage_start,
        coverage_end,
        source,
        fetched_at,
        updated_at
      ) VALUES ($1, $2, '1m', $3::date, $4::date, $5, $6::timestamptz, NOW())
      ON CONFLICT (ticker, session, timeframe)
      DO UPDATE SET
        coverage_start = CASE
          WHEN ${RESEARCH_SPOT_COVERAGE_TABLE}.coverage_start IS NULL THEN EXCLUDED.coverage_start
          WHEN EXCLUDED.coverage_start IS NULL THEN ${RESEARCH_SPOT_COVERAGE_TABLE}.coverage_start
          ELSE LEAST(${RESEARCH_SPOT_COVERAGE_TABLE}.coverage_start, EXCLUDED.coverage_start)
        END,
        coverage_end = CASE
          WHEN ${RESEARCH_SPOT_COVERAGE_TABLE}.coverage_end IS NULL THEN EXCLUDED.coverage_end
          WHEN EXCLUDED.coverage_end IS NULL THEN ${RESEARCH_SPOT_COVERAGE_TABLE}.coverage_end
          ELSE GREATEST(${RESEARCH_SPOT_COVERAGE_TABLE}.coverage_end, EXCLUDED.coverage_end)
        END,
        source = COALESCE(EXCLUDED.source, ${RESEARCH_SPOT_COVERAGE_TABLE}.source),
        fetched_at = CASE
          WHEN ${RESEARCH_SPOT_COVERAGE_TABLE}.fetched_at IS NULL THEN EXCLUDED.fetched_at
          WHEN EXCLUDED.fetched_at IS NULL THEN ${RESEARCH_SPOT_COVERAGE_TABLE}.fetched_at
          ELSE GREATEST(${RESEARCH_SPOT_COVERAGE_TABLE}.fetched_at, EXCLUDED.fetched_at)
        END,
        updated_at = NOW()
    `,
    [normalizedTicker, normalizedSession, coverageStart, coverageEnd, String(source || "").trim() || null, normalizedFetchedAt],
  );

  return {
    ok: true,
    insertedCount: preparedBars.length,
    coverageStart,
    coverageEnd,
  };
}

export async function readResearchSpotWarmState({
  ticker,
  session = "regular",
  timeframe = "1m",
} = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const normalizedSession = String(session || "regular").trim().toLowerCase() || "regular";
  const normalizedTimeframe = String(timeframe || "1m").trim().toLowerCase() || "1m";
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
        ticker,
        session,
        timeframe,
        target_start::text AS target_start,
        target_end::text AS target_end,
        next_cursor_date::text AS next_cursor_date,
        last_window_from::text AS last_window_from,
        last_window_to::text AS last_window_to,
        last_status,
        last_error,
        last_run_at,
        completed_at,
        daily_warmed_at,
        updated_at
      FROM ${RESEARCH_SPOT_WARM_STATE_TABLE}
      WHERE ticker = $1 AND session = $2 AND timeframe = $3
      LIMIT 1
    `,
    [normalizedTicker, normalizedSession, normalizedTimeframe],
  );
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  const row = rows[0] || {};
  return {
    ticker: normalizedTicker,
    session: normalizedSession,
    timeframe: normalizedTimeframe,
    targetStart: normalizeDateText(row.target_start),
    targetEnd: normalizeDateText(row.target_end),
    nextCursorDate: normalizeDateText(row.next_cursor_date),
    lastWindowFrom: normalizeDateText(row.last_window_from),
    lastWindowTo: normalizeDateText(row.last_window_to),
    lastStatus: String(row.last_status || "").trim() || null,
    lastError: String(row.last_error || "").trim() || null,
    lastRunAt: toIsoOrNull(row.last_run_at),
    completedAt: toIsoOrNull(row.completed_at),
    dailyWarmedAt: toIsoOrNull(row.daily_warmed_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function upsertResearchSpotWarmState({
  ticker,
  session = "regular",
  timeframe = "1m",
  targetStart = null,
  targetEnd = null,
  nextCursorDate = null,
  lastWindowFrom = null,
  lastWindowTo = null,
  lastStatus = null,
  lastError = null,
  lastRunAt = null,
  completedAt = null,
  dailyWarmedAt = null,
} = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const normalizedSession = String(session || "regular").trim().toLowerCase() || "regular";
  const normalizedTimeframe = String(timeframe || "1m").trim().toLowerCase() || "1m";
  if (!normalizedTicker) {
    return false;
  }
  const client = await getPoolIfConfigured();
  if (!client) {
    return false;
  }
  await ensureSchema(client);
  await client.query(
    `
      INSERT INTO ${RESEARCH_SPOT_WARM_STATE_TABLE} (
        ticker,
        session,
        timeframe,
        target_start,
        target_end,
        next_cursor_date,
        last_window_from,
        last_window_to,
        last_status,
        last_error,
        last_run_at,
        completed_at,
        daily_warmed_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4::date,
        $5::date,
        $6::date,
        $7::date,
        $8::date,
        $9,
        $10,
        $11::timestamptz,
        $12::timestamptz,
        $13::timestamptz,
        NOW()
      )
      ON CONFLICT (ticker, session, timeframe)
      DO UPDATE SET
        target_start = EXCLUDED.target_start,
        target_end = EXCLUDED.target_end,
        next_cursor_date = EXCLUDED.next_cursor_date,
        last_window_from = EXCLUDED.last_window_from,
        last_window_to = EXCLUDED.last_window_to,
        last_status = EXCLUDED.last_status,
        last_error = EXCLUDED.last_error,
        last_run_at = EXCLUDED.last_run_at,
        completed_at = EXCLUDED.completed_at,
        daily_warmed_at = EXCLUDED.daily_warmed_at,
        updated_at = NOW()
    `,
    [
      normalizedTicker,
      normalizedSession,
      normalizedTimeframe,
      normalizeDateText(targetStart),
      normalizeDateText(targetEnd),
      normalizeDateText(nextCursorDate),
      normalizeDateText(lastWindowFrom),
      normalizeDateText(lastWindowTo),
      String(lastStatus || "").trim() || null,
      String(lastError || "").trim() || null,
      toIsoOrNull(lastRunAt),
      toIsoOrNull(completedAt),
      toIsoOrNull(dailyWarmedAt),
    ],
  );
  return true;
}

export async function acquireResearchSpotWarmLease() {
  const connectionPool = await getPoolIfConfigured();
  if (!connectionPool) {
    return null;
  }
  const client = await connectionPool.connect();
  let locked = false;
  try {
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [RESEARCH_SPOT_WARM_LOCK_NAMESPACE, RESEARCH_SPOT_WARM_LOCK_KEY],
    );
    locked = Boolean(rows?.[0]?.locked);
    if (!locked) {
      client.release();
      return null;
    }
    return {
      async release() {
        try {
          await client.query("SELECT pg_advisory_unlock($1, $2)", [
            RESEARCH_SPOT_WARM_LOCK_NAMESPACE,
            RESEARCH_SPOT_WARM_LOCK_KEY,
          ]);
        } finally {
          client.release();
        }
      },
    };
  } catch (error) {
    if (!locked) {
      client.release();
    } else {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [
          RESEARCH_SPOT_WARM_LOCK_NAMESPACE,
          RESEARCH_SPOT_WARM_LOCK_KEY,
        ]);
      } finally {
        client.release();
      }
    }
    throw error;
  }
}

async function readCacheRow({ tableName, cacheKey }) {
  const key = String(cacheKey || "").trim();
  if (!key) {
    return null;
  }
  const client = await getPoolIfConfigured();
  if (!client) {
    return null;
  }
  await ensureSchema(client);
  const { rows } = await client.query(
    `SELECT payload, fetched_at FROM ${tableName} WHERE cache_key = $1 LIMIT 1`,
    [key],
  );
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  const row = rows[0];
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : null;
  if (!payload) {
    return null;
  }
  if (!payload.fetchedAt && row?.fetched_at) {
    payload.fetchedAt = toIsoOrNull(row.fetched_at);
  }
  return payload;
}

async function writeCacheRow({
  tableName,
  cacheKey,
  tickerField,
  tickerValue,
  request,
  payload,
}) {
  const key = String(cacheKey || "").trim();
  if (!key || !payload || typeof payload !== "object") {
    return false;
  }
  const client = await getPoolIfConfigured();
  if (!client) {
    return false;
  }
  await ensureSchema(client);

  const fetchedAt = toIsoOrNull(payload?.fetchedAt) || new Date().toISOString();
  const barsCount = Array.isArray(payload?.bars) ? payload.bars.length : 0;

  await client.query(
    `
      INSERT INTO ${tableName} (
        cache_key,
        ${tickerField},
        request_params,
        payload,
        bars_count,
        fetched_at,
        updated_at
      ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::timestamptz, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET
        ${tickerField} = EXCLUDED.${tickerField},
        request_params = EXCLUDED.request_params,
        payload = EXCLUDED.payload,
        bars_count = EXCLUDED.bars_count,
        fetched_at = EXCLUDED.fetched_at,
        updated_at = NOW()
    `,
    [
      key,
      tickerValue,
      JSON.stringify(request && typeof request === "object" ? request : {}),
      JSON.stringify(payload),
      barsCount,
      fetchedAt,
    ],
  );

  return true;
}

export async function getMassiveDbCacheStats() {
  const configured = isMassiveDbCacheConfigured();
  if (!configured) {
    return {
      configured: false,
      ready: false,
      rowCount: 0,
      totalBytesEstimate: 0,
      lastUpdatedAt: null,
      error: null,
    };
  }

  try {
    const client = await getPoolIfConfigured();
    if (!client) {
      return {
        configured: true,
        ready: false,
        rowCount: 0,
        totalBytesEstimate: 0,
        lastUpdatedAt: null,
        error: "Pool unavailable",
      };
    }
    await ensureSchema(client);
    const [optionsStats, equityStats, researchSpotStats, researchSpotCoverageStats, researchSpotWarmStateStats] = await Promise.all([
      loadTableStats(client, OPTIONS_CACHE_TABLE),
      loadTableStats(client, EQUITY_CACHE_TABLE),
      loadTableStats(client, RESEARCH_SPOT_BARS_TABLE, "to_jsonb(t)::text"),
      loadTableStats(client, RESEARCH_SPOT_COVERAGE_TABLE, "to_jsonb(t)::text"),
      loadTableStats(client, RESEARCH_SPOT_WARM_STATE_TABLE, "to_jsonb(t)::text"),
    ]);
    return {
      configured: true,
      ready: true,
      rowCount:
        Number(optionsStats.rowCount || 0)
        + Number(equityStats.rowCount || 0)
        + Number(researchSpotStats.rowCount || 0)
        + Number(researchSpotCoverageStats.rowCount || 0)
        + Number(researchSpotWarmStateStats.rowCount || 0),
      totalBytesEstimate:
        Number(optionsStats.totalBytesEstimate || 0)
        + Number(equityStats.totalBytesEstimate || 0)
        + Number(researchSpotStats.totalBytesEstimate || 0)
        + Number(researchSpotCoverageStats.totalBytesEstimate || 0)
        + Number(researchSpotWarmStateStats.totalBytesEstimate || 0),
      lastUpdatedAt: [
        optionsStats.lastUpdatedAt,
        equityStats.lastUpdatedAt,
        researchSpotStats.lastUpdatedAt,
        researchSpotCoverageStats.lastUpdatedAt,
        researchSpotWarmStateStats.lastUpdatedAt,
      ]
        .filter(Boolean)
        .sort()
        .pop() || null,
      options: optionsStats,
      equity: equityStats,
      researchSpot: researchSpotStats,
      researchSpotCoverage: researchSpotCoverageStats,
      researchSpotWarmState: researchSpotWarmStateStats,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      rowCount: 0,
      totalBytesEstimate: 0,
      lastUpdatedAt: null,
      error: error?.message || "Database cache stats unavailable",
    };
  }
}

async function getPoolIfConfigured() {
  const config = resolvePgConfig();
  if (!config) {
    return null;
  }
  if (!pool) {
    pool = new Pool(config);
    pool.on("error", (error) => {
      console.error("[massive-db-cache] PostgreSQL pool error:", error?.message || error);
    });
  }
  return pool;
}

async function ensureSchema(client) {
  if (initPromise) {
    return initPromise;
  }
  initPromise = client.query(`
    CREATE TABLE IF NOT EXISTS ${OPTIONS_CACHE_TABLE} (
      cache_key TEXT PRIMARY KEY,
      option_ticker TEXT,
      request_params JSONB NOT NULL,
      payload JSONB NOT NULL,
      bars_count INTEGER NOT NULL DEFAULT 0,
      fetched_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_${OPTIONS_CACHE_TABLE}_ticker_fetched
      ON ${OPTIONS_CACHE_TABLE} (option_ticker, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_${OPTIONS_CACHE_TABLE}_updated
      ON ${OPTIONS_CACHE_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${EQUITY_CACHE_TABLE} (
      cache_key TEXT PRIMARY KEY,
      ticker TEXT,
      request_params JSONB NOT NULL,
      payload JSONB NOT NULL,
      bars_count INTEGER NOT NULL DEFAULT 0,
      fetched_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_${EQUITY_CACHE_TABLE}_ticker_fetched
      ON ${EQUITY_CACHE_TABLE} (ticker, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_${EQUITY_CACHE_TABLE}_updated
      ON ${EQUITY_CACHE_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${RESEARCH_SPOT_BARS_TABLE} (
      ticker TEXT NOT NULL,
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
      PRIMARY KEY (ticker, session, bar_time_ms)
    );
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_SPOT_BARS_TABLE}_ticker_date
      ON ${RESEARCH_SPOT_BARS_TABLE} (ticker, session, trade_date, bar_time_ms);
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_SPOT_BARS_TABLE}_updated
      ON ${RESEARCH_SPOT_BARS_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${RESEARCH_SPOT_COVERAGE_TABLE} (
      ticker TEXT NOT NULL,
      session TEXT NOT NULL DEFAULT 'regular',
      timeframe TEXT NOT NULL DEFAULT '1m',
      coverage_start DATE,
      coverage_end DATE,
      source TEXT,
      fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ticker, session, timeframe)
    );
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_SPOT_COVERAGE_TABLE}_updated
      ON ${RESEARCH_SPOT_COVERAGE_TABLE} (updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${RESEARCH_SPOT_WARM_STATE_TABLE} (
      ticker TEXT NOT NULL,
      session TEXT NOT NULL DEFAULT 'regular',
      timeframe TEXT NOT NULL DEFAULT '1m',
      target_start DATE,
      target_end DATE,
      next_cursor_date DATE,
      last_window_from DATE,
      last_window_to DATE,
      last_status TEXT,
      last_error TEXT,
      last_run_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      daily_warmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ticker, session, timeframe)
    );
    CREATE INDEX IF NOT EXISTS idx_${RESEARCH_SPOT_WARM_STATE_TABLE}_updated
      ON ${RESEARCH_SPOT_WARM_STATE_TABLE} (updated_at DESC);
  `).catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

async function loadTableStats(client, tableName, byteSourceExpr = "payload::text") {
  const { rows } = await client.query(`
    SELECT
      COUNT(*)::bigint AS row_count,
      COALESCE(SUM(octet_length(${byteSourceExpr})), 0)::bigint AS bytes_estimate,
      MAX(updated_at) AS last_updated_at
    FROM ${tableName} t
  `);
  const row = rows?.[0] || {};
  return {
    rowCount: Number(row.row_count || 0),
    totalBytesEstimate: Number(row.bytes_estimate || 0),
    lastUpdatedAt: toIsoOrNull(row.last_updated_at),
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
      application_name: firstNonEmpty(process.env.PGAPPNAME, `${DEFAULT_APP_NAME}-massive-cache`),
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
    application_name: firstNonEmpty(process.env.PGAPPNAME, `${DEFAULT_APP_NAME}-massive-cache`),
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

function normalizeDateText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeResearchSpotBarRecord(bar, ticker, session) {
  const time = Number(bar?.time);
  const tradeDate = normalizeDateText(bar?.date);
  const hour = Number(bar?.hour);
  const minute = Number(bar?.min);
  const openPrice = Number(bar?.o);
  const highPrice = Number(bar?.h);
  const lowPrice = Number(bar?.l);
  const closePrice = Number(bar?.c);
  if (!ticker || !tradeDate || ![time, hour, minute, openPrice, highPrice, lowPrice, closePrice].every(Number.isFinite)) {
    return null;
  }
  return {
    ticker,
    session,
    bar_time_ms: Math.round(time),
    tradeDate,
    trade_date: tradeDate,
    ts: String(bar?.ts || `${tradeDate} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`),
    hour: Math.max(0, Math.min(23, Math.round(hour))),
    minute: Math.max(0, Math.min(59, Math.round(minute))),
    open_price: openPrice,
    high_price: highPrice,
    low_price: lowPrice,
    close_price: closePrice,
    volume: Math.max(0, Math.round(Number(bar?.v) || 0)),
    trade_count: Number.isFinite(Number(bar?.n)) ? Math.max(0, Math.round(Number(bar.n))) : null,
    vwap: Number.isFinite(Number(bar?.vw)) ? Number(bar.vw) : null,
  };
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
