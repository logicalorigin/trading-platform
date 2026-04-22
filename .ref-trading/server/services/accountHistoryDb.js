import { Pool } from "pg";
import crypto from "node:crypto";

const DEFAULT_APP_NAME = "spy-options-backtest";
const EQUITY_TABLE = "account_equity_history";
const NATIVE_HISTORY_TABLE = "account_native_history_rows";
const POSITION_SNAPSHOT_TABLE = "account_position_snapshots";
const POSITION_SNAPSHOT_ROW_TABLE = "account_position_snapshot_rows";
const ALLOWED_HISTORY_TYPES = new Set(["closed_trades", "cash_ledger"]);

let pool = null;
let initPromise = null;

export function isAccountHistoryDbConfigured() {
  return Boolean(resolvePgConfig());
}

export async function upsertAccountEquityHistory({ accountId, points }) {
  const safeAccountId = String(accountId || "").trim();
  const normalized = (Array.isArray(points) ? points : [])
    .map((row) => normalizeEquityPoint(row))
    .filter(Boolean);

  if (!safeAccountId || !normalized.length) {
    return {
      attempted: 0,
      upserted: 0,
      skipped: normalized.length,
    };
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return {
      attempted: normalized.length,
      upserted: 0,
      skipped: normalized.length,
    };
  }

  await ensureSchema(client);

  const chunkSize = 200;
  let upserted = 0;
  for (let index = 0; index < normalized.length; index += chunkSize) {
    const chunk = normalized.slice(index, index + chunkSize);
    const existingPayloadByEpochMs = await loadExistingEquityPayloadsByEpochMs(
      client,
      safeAccountId,
      chunk.map((row) => row?.epochMs),
    );
    const values = [];
    const params = [];

    for (let rowIndex = 0; rowIndex < chunk.length; rowIndex += 1) {
      const row = mergeExistingNormalizationMetadata(
        chunk[rowIndex],
        existingPayloadByEpochMs.get(Number(chunk[rowIndex]?.epochMs)),
      );
      const base = rowIndex * 8;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}::timestamptz, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, NOW())`);
      params.push(
        safeAccountId,
        row.epochMs,
        row.ts,
        row.equity,
        row.source || null,
        row.stale,
        JSON.stringify(row),
      );
    }

    const result = await client.query(
      `
        INSERT INTO ${EQUITY_TABLE} (
          account_id,
          epoch_ms,
          ts,
          equity,
          source,
          stale,
          payload,
          updated_at
        ) VALUES ${values.join(", ")}
        ON CONFLICT (account_id, epoch_ms)
        DO UPDATE SET
          ts = EXCLUDED.ts,
          equity = EXCLUDED.equity,
          source = EXCLUDED.source,
          stale = EXCLUDED.stale,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `,
      params,
    );
    upserted += Number(result.rowCount || 0);
  }

  return {
    attempted: normalized.length,
    upserted,
    skipped: 0,
  };
}

async function loadExistingEquityPayloadsByEpochMs(client, accountId, epochMsValues) {
  const safeEpochMsValues = Array.from(
    new Set(
      (Array.isArray(epochMsValues) ? epochMsValues : [])
        .map((value) => Number(value))
        .filter(Number.isFinite)
        .map((value) => Math.round(value)),
    ),
  );
  if (!client || !accountId || !safeEpochMsValues.length) {
    return new Map();
  }

  const { rows } = await client.query(
    `
      SELECT epoch_ms, payload
      FROM ${EQUITY_TABLE}
      WHERE account_id = $1
        AND epoch_ms = ANY($2::bigint[])
    `,
    [String(accountId), safeEpochMsValues],
  );

  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [Number(row?.epoch_ms), row?.payload && typeof row.payload === "object" ? row.payload : null]),
  );
}

function mergeExistingNormalizationMetadata(row, existingPayload) {
  const safeRow = row && typeof row === "object" ? { ...row } : null;
  if (!safeRow || !existingPayload || typeof existingPayload !== "object") {
    return safeRow;
  }

  for (const key of ["originalSource", "normalizedSource", "normalizedAt", "normalizedBy"]) {
    if (!firstNonEmpty(safeRow[key]) && firstNonEmpty(existingPayload[key])) {
      safeRow[key] = existingPayload[key];
    }
  }

  return safeRow;
}

export async function loadAccountEquityHistoryFromDb({ accountId, from, to, limit }) {
  const safeAccountId = String(accountId || "").trim();
  if (!safeAccountId) {
    return [];
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return [];
  }
  await ensureSchema(client);

  const conditions = ["account_id = $1"];
  const params = [safeAccountId];

  const fromMs = parseMaybeDate(from);
  if (Number.isFinite(fromMs)) {
    params.push(Math.round(fromMs));
    conditions.push(`epoch_ms >= $${params.length}`);
  }

  const toMs = parseMaybeDate(to);
  if (Number.isFinite(toMs)) {
    params.push(Math.round(toMs));
    conditions.push(`epoch_ms <= $${params.length}`);
  }

  const maxRows = clampInt(limit, 1, 50000, 5000);
  params.push(maxRows);

  const { rows } = await client.query(
    `
      SELECT source, stale, payload
      FROM ${EQUITY_TABLE}
      WHERE ${conditions.join(" AND ")}
      ORDER BY epoch_ms ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const payload = row?.payload;
      if (!payload || typeof payload !== "object") {
        return null;
      }
      return normalizeEquityPoint({
        ...payload,
        source: firstNonEmpty(payload.source, row?.source),
        stale: payload.stale ?? row?.stale,
      });
    })
    .filter(Boolean);
}

export async function normalizeAccountEquityHistorySources({
  accountIds,
  brokerByAccountId = {},
  dryRun = true,
} = {}) {
  const client = await getPoolIfConfigured();
  if (!client) {
    return {
      configured: false,
      ready: false,
      ok: false,
      dryRun: Boolean(dryRun),
      scanned: 0,
      eligible: 0,
      updated: 0,
      unchanged: 0,
      bySource: {},
      byAccount: {},
      error: "Pool unavailable",
    };
  }

  await ensureSchema(client);

  const requestedAccountIds = normalizeRequestedAccountIds(accountIds);
  const targetAccountIds = requestedAccountIds.length
    ? requestedAccountIds
    : await listEquityHistoryAccountIds(client);

  const byAccount = {};
  const bySource = {};
  let ok = true;
  let scanned = 0;
  let eligible = 0;
  let updated = 0;
  let unchanged = 0;

  for (const accountId of targetAccountIds) {
    try {
      const result = await normalizeAccountEquityHistorySourcesForAccount({
        client,
        accountId,
        accountBroker: firstNonEmpty(brokerByAccountId?.[accountId]),
        dryRun,
      });
      byAccount[accountId] = result;
      scanned += Number(result.scanned || 0);
      eligible += Number(result.eligible || 0);
      updated += Number(result.updated || 0);
      unchanged += Number(result.unchanged || 0);
      mergeCountMap(bySource, result.bySource || {});
      if (result.ok === false) {
        ok = false;
      }
    } catch (error) {
      ok = false;
      byAccount[accountId] = {
        ok: false,
        scanned: 0,
        eligible: 0,
        updated: 0,
        unchanged: 0,
        bySource: {},
        error: error?.message || "Normalization failed",
      };
    }
  }

  return {
    configured: true,
    ready: true,
    ok,
    dryRun: Boolean(dryRun),
    scanned,
    eligible,
    updated,
    unchanged,
    bySource,
    byAccount,
    error: null,
  };
}

export async function upsertAccountNativeHistoryRows({
  accountId,
  broker,
  historyType,
  rows,
  defaultSource,
}) {
  const safeAccountId = String(accountId || "").trim();
  const safeBroker = String(broker || "").trim().toLowerCase();
  const safeType = String(historyType || "").trim().toLowerCase();
  if (!safeAccountId || !safeBroker || !ALLOWED_HISTORY_TYPES.has(safeType)) {
    return {
      attempted: 0,
      upserted: 0,
      skipped: 0,
    };
  }

  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeNativeHistoryRow({
      accountId: safeAccountId,
      broker: safeBroker,
      historyType: safeType,
      row,
      defaultSource,
    }))
    .filter(Boolean);

  if (!normalizedRows.length) {
    return {
      attempted: 0,
      upserted: 0,
      skipped: 0,
    };
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return {
      attempted: normalizedRows.length,
      upserted: 0,
      skipped: normalizedRows.length,
    };
  }
  await ensureSchema(client);

  const chunkSize = 200;
  let upserted = 0;

  for (let index = 0; index < normalizedRows.length; index += chunkSize) {
    const chunk = normalizedRows.slice(index, index + chunkSize);
    const values = [];
    const params = [];

    for (let rowIndex = 0; rowIndex < chunk.length; rowIndex += 1) {
      const row = chunk[rowIndex];
      const base = rowIndex * 9;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::timestamptz, $${base + 7}, $${base + 8}::jsonb, NOW())`);
      params.push(
        row.rowId,
        row.accountId,
        row.broker,
        row.historyType,
        row.source,
        row.eventTs,
        row.eventEpochMs,
        JSON.stringify(row.payload),
      );
    }

    const result = await client.query(
      `
        INSERT INTO ${NATIVE_HISTORY_TABLE} (
          row_id,
          account_id,
          broker,
          history_type,
          source,
          event_ts,
          event_epoch_ms,
          payload,
          updated_at
        ) VALUES ${values.join(", ")}
        ON CONFLICT (row_id)
        DO UPDATE SET
          source = EXCLUDED.source,
          event_ts = EXCLUDED.event_ts,
          event_epoch_ms = EXCLUDED.event_epoch_ms,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `,
      params,
    );
    upserted += Number(result.rowCount || 0);
  }

  return {
    attempted: normalizedRows.length,
    upserted,
    skipped: 0,
  };
}

export async function loadAccountNativeHistoryRowsFromDb({
  accountId,
  historyType,
  from,
  to,
  limit,
}) {
  const safeAccountId = String(accountId || "").trim();
  const safeType = String(historyType || "").trim().toLowerCase();
  if (!safeAccountId || !ALLOWED_HISTORY_TYPES.has(safeType)) {
    return [];
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return [];
  }
  await ensureSchema(client);

  const conditions = [
    "account_id = $1",
    "history_type = $2",
  ];
  const params = [safeAccountId, safeType];

  const fromMs = parseMaybeDate(from);
  if (Number.isFinite(fromMs)) {
    params.push(Math.round(fromMs));
    conditions.push(`event_epoch_ms >= $${params.length}`);
  }

  const toMs = parseMaybeDate(to);
  if (Number.isFinite(toMs)) {
    params.push(Math.round(toMs));
    conditions.push(`event_epoch_ms <= $${params.length}`);
  }

  const maxRows = clampInt(limit, 1, 10000, 2000);
  params.push(maxRows);

  const { rows } = await client.query(
    `
      SELECT payload
      FROM ${NATIVE_HISTORY_TABLE}
      WHERE ${conditions.join(" AND ")}
      ORDER BY event_epoch_ms DESC NULLS LAST, updated_at DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return (Array.isArray(rows) ? rows : [])
    .map((row) => row?.payload)
    .filter((payload) => payload && typeof payload === "object" && !Array.isArray(payload))
    .map((payload) => ({
      ...payload,
      accountId: payload.accountId || safeAccountId,
      source: firstNonEmpty(payload.source, `${safeType}-db`),
    }));
}

export async function loadLatestAccountPositionSnapshotFromDb({ accountId, asOf, snapshotId } = {}) {
  return loadAccountPositionSnapshotFromDb({
    accountId,
    asOf,
    snapshotId,
  });
}

export async function loadAccountPositionSnapshotFromDb({
  accountId,
  asOf,
  snapshotId,
} = {}) {
  const safeAccountId = String(accountId || "").trim();
  if (!safeAccountId) {
    return {
      snapshot: null,
      rows: [],
    };
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return {
      snapshot: null,
      rows: [],
    };
  }
  await ensureSchema(client);

  const snapshot = await selectAccountPositionSnapshot({
    client,
    accountId: safeAccountId,
    asOf,
    snapshotId,
  });
  if (!snapshot) {
    return {
      snapshot: null,
      rows: [],
    };
  }

  const rows = await loadAccountPositionSnapshotRowsBySnapshotId({
    client,
    accountId: safeAccountId,
    snapshotId: snapshot.snapshotId,
  });

  return {
    snapshot,
    rows,
  };
}

export async function loadAccountPositionSnapshotsFromDb({
  accountId,
  from,
  to,
  limit,
} = {}) {
  const safeAccountId = String(accountId || "").trim();
  if (!safeAccountId) {
    return [];
  }

  const client = await getPoolIfConfigured();
  if (!client) {
    return [];
  }
  await ensureSchema(client);

  const conditions = ["account_id = $1"];
  const params = [safeAccountId];

  const fromMs = parseMaybeDate(from);
  if (Number.isFinite(fromMs)) {
    params.push(Math.round(fromMs));
    conditions.push(`captured_epoch_ms >= ${params.length}`);
  }

  const toMs = parseMaybeDate(to);
  if (Number.isFinite(toMs)) {
    params.push(Math.round(toMs));
    conditions.push(`captured_epoch_ms <= ${params.length}`);
  }

  const maxRows = clampInt(limit, 1, 10000, 200);
  params.push(maxRows);

  const { rows } = await client.query(
    `
      SELECT
        snapshot_id,
        account_id,
        broker,
        captured_at,
        captured_epoch_ms,
        source,
        auth_state,
        position_count,
        payload
      FROM ${POSITION_SNAPSHOT_TABLE}
      WHERE ${conditions.join(" AND ")}
      ORDER BY captured_epoch_ms DESC, created_at DESC
      LIMIT ${params.length}
    `,
    params,
  );

  return (Array.isArray(rows) ? rows : [])
    .map(normalizePositionSnapshotRecord)
    .filter(Boolean);
}

export async function upsertAccountPositionSnapshot({
  accountId,
  broker,
  authState,
  capturedAt,
  rows,
  source,
} = {}) {
  const safeAccountId = String(accountId || "").trim();
  const safeBroker = String(broker || "").trim().toLowerCase();
  const safeSource = firstNonEmpty(source, safeBroker ? `${safeBroker}-positions` : "positions");
  const capturedEpochMs = parseMaybeDate(capturedAt ?? Date.now());
  const safeCapturedEpochMs = Number.isFinite(capturedEpochMs)
    ? Math.round(capturedEpochMs)
    : Date.now();
  const safeCapturedAt = new Date(safeCapturedEpochMs).toISOString();
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePositionSnapshotRow({
      accountId: safeAccountId,
      row,
    }))
    .filter(Boolean);

  if (!safeAccountId || !safeBroker) {
    return {
      attempted: normalizedRows.length,
      upserted: 0,
      skipped: normalizedRows.length,
      snapshotId: null,
      snapshot: null,
    };
  }

  const client = await getPoolIfConfigured();
  const snapshotPayload = sanitizeJsonValue({
    accountId: safeAccountId,
    broker: safeBroker,
    authState: firstNonEmpty(authState),
    capturedAt: safeCapturedAt,
    capturedEpochMs: safeCapturedEpochMs,
    source: safeSource,
    positionCount: normalizedRows.length,
  });
  const snapshotId = buildPositionSnapshotId({
    accountId: safeAccountId,
    broker: safeBroker,
    capturedEpochMs: safeCapturedEpochMs,
    rows: normalizedRows,
  });
  const snapshot = {
    snapshotId,
    accountId: safeAccountId,
    broker: safeBroker,
    capturedAt: safeCapturedAt,
    capturedEpochMs: safeCapturedEpochMs,
    source: safeSource,
    authState: firstNonEmpty(authState) || null,
    positionCount: normalizedRows.length,
    payload: snapshotPayload,
  };

  if (!client) {
    return {
      attempted: normalizedRows.length,
      upserted: 0,
      skipped: normalizedRows.length,
      snapshotId,
      snapshot,
    };
  }
  await ensureSchema(client);

  await client.query(
    `
      INSERT INTO ${POSITION_SNAPSHOT_TABLE} (
        snapshot_id,
        account_id,
        broker,
        captured_at,
        captured_epoch_ms,
        source,
        auth_state,
        position_count,
        payload,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4::timestamptz,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb,
        NOW()
      )
      ON CONFLICT (snapshot_id)
      DO UPDATE SET
        source = EXCLUDED.source,
        auth_state = EXCLUDED.auth_state,
        position_count = EXCLUDED.position_count,
        payload = EXCLUDED.payload,
        updated_at = NOW()
    `,
    [
      snapshotId,
      safeAccountId,
      safeBroker,
      safeCapturedAt,
      safeCapturedEpochMs,
      safeSource,
      snapshot.authState,
      normalizedRows.length,
      JSON.stringify(snapshotPayload),
    ],
  );

  const chunkSize = 200;
  let upserted = 1;
  for (let index = 0; index < normalizedRows.length; index += chunkSize) {
    const chunk = normalizedRows.slice(index, index + chunkSize);
    const values = [];
    const params = [];

    for (let rowIndex = 0; rowIndex < chunk.length; rowIndex += 1) {
      const row = chunk[rowIndex];
      const base = rowIndex * 17;
      values.push(
        `(${base + 1}, ${base + 2}, ${base + 3}, ${base + 4}, ${base + 5}, ${base + 6}, ${base + 7}, ${base + 8}, ${base + 9}, ${base + 10}, ${base + 11}, ${base + 12}, ${base + 13}, ${base + 14}, ${base + 15}, ${base + 16}, ${base + 17}::jsonb)`,
      );
      params.push(
        snapshotId,
        row.accountId,
        row.positionId,
        row.symbol,
        row.underlyingSymbol,
        row.assetType,
        row.side,
        row.qty,
        row.averagePrice,
        row.markPrice,
        row.marketValue,
        row.unrealizedPnl,
        row.currency,
        row.optionExpiry,
        row.optionStrike,
        row.optionRight,
        JSON.stringify(row.payload),
      );
    }

    const result = await client.query(
      `
        INSERT INTO ${POSITION_SNAPSHOT_ROW_TABLE} (
          snapshot_id,
          account_id,
          position_id,
          symbol,
          underlying_symbol,
          asset_type,
          side,
          qty,
          average_price,
          mark_price,
          market_value,
          unrealized_pnl,
          currency,
          option_expiry,
          option_strike,
          option_right,
          payload
        ) VALUES ${values.join(", ")}
        ON CONFLICT (snapshot_id, position_id)
        DO UPDATE SET
          symbol = EXCLUDED.symbol,
          underlying_symbol = EXCLUDED.underlying_symbol,
          asset_type = EXCLUDED.asset_type,
          side = EXCLUDED.side,
          qty = EXCLUDED.qty,
          average_price = EXCLUDED.average_price,
          mark_price = EXCLUDED.mark_price,
          market_value = EXCLUDED.market_value,
          unrealized_pnl = EXCLUDED.unrealized_pnl,
          currency = EXCLUDED.currency,
          option_expiry = EXCLUDED.option_expiry,
          option_strike = EXCLUDED.option_strike,
          option_right = EXCLUDED.option_right,
          payload = EXCLUDED.payload
      `,
      params,
    );
    upserted += Number(result.rowCount || 0);
  }

  return {
    attempted: normalizedRows.length,
    upserted,
    skipped: 0,
    snapshotId,
    snapshot,
  };
}

export async function getAccountHistoryDbStats() {
  if (!isAccountHistoryDbConfigured()) {
    return {
      configured: false,
      ready: false,
      equityRows: 0,
      nativeRows: 0,
      positionSnapshots: 0,
      positionSnapshotRows: 0,
      latestEquityAt: null,
      latestNativeAt: null,
      latestPositionSnapshotAt: null,
      error: null,
    };
  }

  try {
    const client = await getPoolIfConfigured();
    if (!client) {
      return {
        configured: true,
        ready: false,
        equityRows: 0,
        nativeRows: 0,
        positionSnapshots: 0,
        positionSnapshotRows: 0,
        latestEquityAt: null,
        latestNativeAt: null,
        latestPositionSnapshotAt: null,
        error: "Pool unavailable",
      };
    }

    await ensureSchema(client);

    const [equity, native, snapshots, snapshotRows] = await Promise.all([
      client.query(`
        SELECT
          COUNT(*)::bigint AS row_count,
          MAX(updated_at) AS latest_updated_at
        FROM ${EQUITY_TABLE}
      `),
      client.query(`
        SELECT
          COUNT(*)::bigint AS row_count,
          MAX(updated_at) AS latest_updated_at
        FROM ${NATIVE_HISTORY_TABLE}
      `),
      client.query(`
        SELECT
          COUNT(*)::bigint AS row_count,
          MAX(updated_at) AS latest_updated_at
        FROM ${POSITION_SNAPSHOT_TABLE}
      `),
      client.query(`
        SELECT COUNT(*)::bigint AS row_count
        FROM ${POSITION_SNAPSHOT_ROW_TABLE}
      `),
    ]);

    const equityRow = equity?.rows?.[0] || {};
    const nativeRow = native?.rows?.[0] || {};
    const snapshotRow = snapshots?.rows?.[0] || {};
    const snapshotRowsRow = snapshotRows?.rows?.[0] || {};

    return {
      configured: true,
      ready: true,
      equityRows: Number(equityRow.row_count || 0),
      nativeRows: Number(nativeRow.row_count || 0),
      positionSnapshots: Number(snapshotRow.row_count || 0),
      positionSnapshotRows: Number(snapshotRowsRow.row_count || 0),
      latestEquityAt: toIsoOrNull(equityRow.latest_updated_at),
      latestNativeAt: toIsoOrNull(nativeRow.latest_updated_at),
      latestPositionSnapshotAt: toIsoOrNull(snapshotRow.latest_updated_at),
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      equityRows: 0,
      nativeRows: 0,
      positionSnapshots: 0,
      positionSnapshotRows: 0,
      latestEquityAt: null,
      latestNativeAt: null,
      latestPositionSnapshotAt: null,
      error: error?.message || "Account history DB stats unavailable",
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
      console.error("[account-history-db] PostgreSQL pool error:", error?.message || error);
    });
  }

  return pool;
}

async function ensureSchema(client) {
  if (initPromise) {
    return initPromise;
  }

  initPromise = client.query(`
    CREATE TABLE IF NOT EXISTS ${EQUITY_TABLE} (
      account_id TEXT NOT NULL,
      epoch_ms BIGINT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      equity DOUBLE PRECISION NOT NULL,
      source TEXT,
      stale BOOLEAN NOT NULL DEFAULT FALSE,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_id, epoch_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_${EQUITY_TABLE}_account_epoch
      ON ${EQUITY_TABLE} (account_id, epoch_ms DESC);

    CREATE INDEX IF NOT EXISTS idx_${EQUITY_TABLE}_updated
      ON ${EQUITY_TABLE} (updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${NATIVE_HISTORY_TABLE} (
      row_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      broker TEXT NOT NULL,
      history_type TEXT NOT NULL,
      source TEXT,
      event_ts TIMESTAMPTZ,
      event_epoch_ms BIGINT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_${NATIVE_HISTORY_TABLE}_account_type_epoch
      ON ${NATIVE_HISTORY_TABLE} (account_id, history_type, event_epoch_ms DESC);

    CREATE INDEX IF NOT EXISTS idx_${NATIVE_HISTORY_TABLE}_updated
      ON ${NATIVE_HISTORY_TABLE} (updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${POSITION_SNAPSHOT_TABLE} (
      snapshot_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      broker TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      captured_epoch_ms BIGINT NOT NULL,
      source TEXT,
      auth_state TEXT,
      position_count INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_${POSITION_SNAPSHOT_TABLE}_account_epoch
      ON ${POSITION_SNAPSHOT_TABLE} (account_id, captured_epoch_ms DESC);

    CREATE INDEX IF NOT EXISTS idx_${POSITION_SNAPSHOT_TABLE}_updated
      ON ${POSITION_SNAPSHOT_TABLE} (updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${POSITION_SNAPSHOT_ROW_TABLE} (
      snapshot_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      position_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      underlying_symbol TEXT,
      asset_type TEXT NOT NULL,
      side TEXT NOT NULL,
      qty DOUBLE PRECISION NOT NULL,
      average_price DOUBLE PRECISION,
      mark_price DOUBLE PRECISION,
      market_value DOUBLE PRECISION,
      unrealized_pnl DOUBLE PRECISION,
      currency TEXT,
      option_expiry DATE,
      option_strike DOUBLE PRECISION,
      option_right TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (snapshot_id, position_id)
    );

    CREATE INDEX IF NOT EXISTS idx_${POSITION_SNAPSHOT_ROW_TABLE}_account_symbol
      ON ${POSITION_SNAPSHOT_ROW_TABLE} (account_id, symbol, snapshot_id);

    CREATE INDEX IF NOT EXISTS idx_${POSITION_SNAPSHOT_ROW_TABLE}_account_underlying
      ON ${POSITION_SNAPSHOT_ROW_TABLE} (account_id, underlying_symbol, snapshot_id);
  `).catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

function resolvePgConfig() {
  const disabled = String(process.env.ACCOUNT_HISTORY_DB_DISABLED || "").trim().toLowerCase();
  if (disabled === "1" || disabled === "true" || disabled === "yes") {
    return null;
  }

  const url = firstNonEmpty(
    process.env.BACKTEST_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.MASSIVE_DB_URL,
  );
  const ssl = resolveSslConfig();

  if (url) {
    return {
      connectionString: url,
      max: clampInt(process.env.PGPOOL_MAX, 1, 40, 8),
      idleTimeoutMillis: clampInt(process.env.PGPOOL_IDLE_TIMEOUT_MS, 1000, 120000, 15000),
      connectionTimeoutMillis: clampInt(process.env.PGPOOL_CONNECT_TIMEOUT_MS, 1000, 60000, 10000),
      statement_timeout: clampInt(process.env.PG_STATEMENT_TIMEOUT_MS, 1000, 120000, 30000),
      application_name: firstNonEmpty(process.env.PGAPPNAME, `${DEFAULT_APP_NAME}-account-history`),
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
    application_name: firstNonEmpty(process.env.PGAPPNAME, `${DEFAULT_APP_NAME}-account-history`),
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

function normalizeEquityPoint(row, options = {}) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const epochMs = parseMaybeDate(
    row.epochMs
    ?? row.ts
    ?? row.timestamp
    ?? row.time
    ?? row.lastSync
    ?? row.updatedAt,
  );

  const equity = Number(
    row.equity
    ?? row.netLiquidation
    ?? row.net_liquidation
    ?? row.totalAsset
    ?? row.total_assets
    ?? NaN,
  );

  if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
    return null;
  }

  const buyingPower = Number(row.buyingPower ?? row.buying_power);
  const cash = Number(row.cash ?? row.cash_balance ?? row.cashBalance);
  const settledCash = Number(row.settledCash ?? row.settled_cash ?? row.settled);
  const unsettledCash = Number(row.unsettledCash ?? row.unsettled_cash ?? row.unsettled);
  const cashAvailableToTrade = Number(
    row.cashAvailableToTrade
    ?? row.cash_available_to_trade
    ?? row.availableToTrade,
  );
  const cashAvailableToWithdraw = Number(
    row.cashAvailableToWithdraw
    ?? row.cash_available_to_withdraw
    ?? row.availableToWithdraw,
  );
  const marginAvailable = Number(row.marginAvailable ?? row.margin_available);
  const marketValue = Number(row.marketValue ?? row.market_value);
  const unrealizedPnl = Number(
    row.unrealizedPnl
    ?? row.unrealized_pnl
    ?? row.total_unrealized_profit_loss,
  );
  const positions = Number(row.positions);
  const sourceNormalization = normalizeEquityHistorySource(firstNonEmpty(row.source), {
    accountBroker: firstNonEmpty(options.accountBroker),
  });
  const normalizedSource = sourceNormalization.source;
  const normalizedStale = sourceNormalization.forceStale
    ? true
    : Boolean(row.stale);

  const out = {
    ts: new Date(Math.round(epochMs)).toISOString(),
    epochMs: Math.round(epochMs),
    equity: round2(equity),
    buyingPower: Number.isFinite(buyingPower) ? round2(buyingPower) : null,
    cash: Number.isFinite(cash) ? round2(cash) : null,
    settledCash: Number.isFinite(settledCash) ? round2(settledCash) : null,
    unsettledCash: Number.isFinite(unsettledCash) ? round2(unsettledCash) : null,
    cashAvailableToTrade: Number.isFinite(cashAvailableToTrade) ? round2(cashAvailableToTrade) : null,
    cashAvailableToWithdraw: Number.isFinite(cashAvailableToWithdraw) ? round2(cashAvailableToWithdraw) : null,
    marginAvailable: Number.isFinite(marginAvailable) ? round2(marginAvailable) : null,
    marketValue: Number.isFinite(marketValue) ? round2(marketValue) : null,
    unrealizedPnl: Number.isFinite(unrealizedPnl) ? round2(unrealizedPnl) : null,
    positions: Number.isFinite(positions) ? Math.max(0, Math.round(positions)) : null,
    source: normalizedSource,
    stale: normalizedStale,
  };

  if (options.preserveNormalizationMetadata && sourceNormalization.changed) {
    const originalSource = firstNonEmpty(
      row.originalSource,
      row.payload?.originalSource,
      firstNonEmpty(row.source),
    );
    out.originalSource = originalSource || null;
    out.normalizedSource = normalizedSource;
    out.normalizedAt = firstNonEmpty(options.normalizedAt) || new Date().toISOString();
    out.normalizedBy = "account-history-normalizer";
  } else {
    const originalSource = firstNonEmpty(row.originalSource);
    const normalizedSourceMeta = firstNonEmpty(row.normalizedSource);
    const normalizedAt = firstNonEmpty(row.normalizedAt);
    const normalizedBy = firstNonEmpty(row.normalizedBy);
    if (originalSource) {
      out.originalSource = originalSource;
    }
    if (normalizedSourceMeta) {
      out.normalizedSource = normalizedSourceMeta;
    }
    if (normalizedAt) {
      out.normalizedAt = normalizedAt;
    }
    if (normalizedBy) {
      out.normalizedBy = normalizedBy;
    }
  }

  return out;
}

async function normalizeAccountEquityHistorySourcesForAccount({
  client,
  accountId,
  accountBroker,
  dryRun,
}) {
  const safeAccountId = String(accountId || "").trim();
  if (!safeAccountId) {
    return {
      ok: true,
      scanned: 0,
      eligible: 0,
      updated: 0,
      unchanged: 0,
      bySource: {},
      error: null,
    };
  }

  const { rows } = await client.query(
    `
      SELECT account_id, epoch_ms, source, stale, payload
      FROM ${EQUITY_TABLE}
      WHERE account_id = $1
      ORDER BY epoch_ms ASC
    `,
    [safeAccountId],
  );

  const normalizedAt = new Date().toISOString();
  const bySource = {};
  let eligible = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const sourceBefore = firstNonEmpty(payload.source, row?.source);
    const base = {
      ...payload,
      source: sourceBefore,
      stale: payload.stale ?? row?.stale,
    };
    const normalized = normalizeEquityPoint(base, {
      accountBroker,
      preserveNormalizationMetadata: true,
      normalizedAt,
    });
    if (!normalized) {
      unchanged += 1;
      continue;
    }

    const currentSource = firstNonEmpty(row?.source, payload.source, "unknown-history");
    const currentStale = Boolean(row?.stale ?? payload.stale);
    const changed = currentSource !== normalized.source
      || currentStale !== Boolean(normalized.stale)
      || stableStringify(base) !== stableStringify(normalized);

    if (!changed) {
      unchanged += 1;
      continue;
    }

    eligible += 1;
    const transitionKey = `${currentSource || "(missing)"} -> ${normalized.source}`;
    bySource[transitionKey] = Number(bySource[transitionKey] || 0) + 1;

    if (dryRun) {
      continue;
    }

    await client.query(
      `
        UPDATE ${EQUITY_TABLE}
        SET
          source = $3,
          stale = $4,
          payload = $5::jsonb,
          updated_at = NOW()
        WHERE account_id = $1 AND epoch_ms = $2
      `,
      [
        safeAccountId,
        Number(row?.epoch_ms),
        normalized.source,
        Boolean(normalized.stale),
        JSON.stringify(normalized),
      ],
    );
    updated += 1;
  }

  return {
    ok: true,
    scanned: Array.isArray(rows) ? rows.length : 0,
    eligible,
    updated,
    unchanged,
    bySource,
    error: null,
  };
}

async function listEquityHistoryAccountIds(client) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT account_id
      FROM ${EQUITY_TABLE}
      ORDER BY account_id ASC
    `,
  );
  return (Array.isArray(rows) ? rows : [])
    .map((row) => firstNonEmpty(row?.account_id))
    .filter(Boolean);
}

function normalizeRequestedAccountIds(accountIds) {
  const values = Array.isArray(accountIds) ? accountIds : [];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const accountId = String(value || "").trim();
    if (!accountId || seen.has(accountId)) {
      continue;
    }
    seen.add(accountId);
    out.push(accountId);
  }
  return out;
}

function normalizeEquityHistorySource(source, options = {}) {
  const normalized = String(source || "").trim().toLowerCase();
  const broker = String(options.accountBroker || "").trim().toLowerCase();
  if (!normalized) {
    return {
      source: "unknown-history",
      changed: true,
      forceStale: true,
    };
  }
  if (normalized === "ibkr-summary") {
    return { source: "ibkr-cached-summary", changed: true, forceStale: true };
  }
  if (normalized === "etrade-summary") {
    return { source: "etrade-cached-summary", changed: true, forceStale: true };
  }
  if (normalized === "webull-cached") {
    return { source: "webull-cached-summary", changed: true, forceStale: true };
  }
  if (normalized === "account-summary" || normalized === "unknown-summary") {
    return { source: "unknown-history", changed: true, forceStale: true };
  }
  if (normalized.endsWith("-fallback-summary")) {
    const fallbackBroker = firstNonEmpty(normalized.split("-")[0], broker);
    return {
      source: fallbackBroker ? `${fallbackBroker}-cached-summary` : "unknown-history",
      changed: true,
      forceStale: true,
    };
  }
  return {
    source: normalized,
    changed: false,
    forceStale: false,
  };
}

function mergeCountMap(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = Number(target[key] || 0) + Number(value || 0);
  }
}

function normalizeNativeHistoryRow({
  accountId,
  broker,
  historyType,
  row,
  defaultSource,
}) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const eventEpochMs = parseMaybeDate(
    row.ts
    ?? row.timestamp
    ?? row.time
    ?? row.date
    ?? row.datetime
    ?? row.filledAt
    ?? row.tradeDate
    ?? row.executionTime
    ?? row.execTime
    ?? row.settlementDate
    ?? row.transactionDate
    ?? row.postedAt
    ?? row.createdAt
    ?? row.updatedAt,
  );
  const eventTs = Number.isFinite(eventEpochMs)
    ? new Date(Math.round(eventEpochMs)).toISOString()
    : null;

  const source = firstNonEmpty(
    row.source,
    defaultSource,
    `${broker}-${historyType}`,
  );

  const payload = sanitizeJsonValue(row);
  const rowId = buildNativeRowId({
    accountId,
    broker,
    historyType,
    eventEpochMs,
    payload,
  });

  return {
    rowId,
    accountId,
    broker,
    historyType,
    source,
    eventTs,
    eventEpochMs: Number.isFinite(eventEpochMs) ? Math.round(eventEpochMs) : null,
    payload,
  };
}

function normalizePositionSnapshotRecord(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const capturedEpochMs = Number(row.captured_epoch_ms ?? row.capturedEpochMs);
  const capturedAt = toIsoOrNull(row.captured_at ?? row.capturedAt);
  if (!capturedAt || !Number.isFinite(capturedEpochMs)) {
    return null;
  }
  return {
    snapshotId: firstNonEmpty(row.snapshot_id, row.snapshotId),
    accountId: firstNonEmpty(row.account_id, row.accountId),
    broker: firstNonEmpty(row.broker).toLowerCase(),
    capturedAt,
    capturedEpochMs: Math.round(capturedEpochMs),
    source: firstNonEmpty(row.source, "positions-db"),
    authState: firstNonEmpty(row.auth_state, row.authState) || null,
    positionCount: clampInt(row.position_count ?? row.positionCount, 0, 100000, 0),
    payload: row.payload && typeof row.payload === "object" ? row.payload : null,
  };
}

async function selectAccountPositionSnapshot({ client, accountId, asOf, snapshotId }) {
  const conditions = ["account_id = $1"];
  const params = [accountId];

  if (snapshotId) {
    params.push(String(snapshotId));
    conditions.push(`snapshot_id = ${params.length}`);
  } else {
    const asOfEpochMs = parseMaybeDate(asOf);
    if (Number.isFinite(asOfEpochMs)) {
      params.push(Math.round(asOfEpochMs));
      conditions.push(`captured_epoch_ms <= ${params.length}`);
    }
  }

  const { rows } = await client.query(
    `
      SELECT
        snapshot_id,
        account_id,
        broker,
        captured_at,
        captured_epoch_ms,
        source,
        auth_state,
        position_count,
        payload
      FROM ${POSITION_SNAPSHOT_TABLE}
      WHERE ${conditions.join(" AND ")}
      ORDER BY captured_epoch_ms DESC, created_at DESC
      LIMIT 1
    `,
    params,
  );

  return normalizePositionSnapshotRecord(rows?.[0] || null);
}

async function loadAccountPositionSnapshotRowsBySnapshotId({ client, accountId, snapshotId }) {
  const { rows } = await client.query(
    `
      SELECT payload
      FROM ${POSITION_SNAPSHOT_ROW_TABLE}
      WHERE snapshot_id = $1 AND account_id = $2
      ORDER BY symbol ASC, position_id ASC
    `,
    [snapshotId, accountId],
  );

  return (Array.isArray(rows) ? rows : [])
    .map((row) => row?.payload)
    .filter((payload) => payload && typeof payload === "object" && !Array.isArray(payload))
    .map((payload) => ({
      ...payload,
      accountId: payload.accountId || accountId,
      snapshotId,
    }));
}

function normalizePositionSnapshotRow({ accountId, row }) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const positionId = firstNonEmpty(row.positionId, row.id);
  const symbol = firstNonEmpty(row.symbol, row.ticker).toUpperCase();
  if (!positionId || !symbol) {
    return null;
  }

  const qty = Number(row.qty);
  if (!Number.isFinite(qty)) {
    return null;
  }

  return {
    accountId,
    positionId,
    symbol,
    underlyingSymbol: firstNonEmpty(row.underlyingSymbol, row.option?.symbol, row.symbol).toUpperCase() || null,
    assetType: firstNonEmpty(row.assetType, "equity").toLowerCase(),
    side: firstNonEmpty(row.side, "long").toLowerCase(),
    qty,
    averagePrice: finiteOrNull(row.averagePrice),
    markPrice: finiteOrNull(row.markPrice),
    marketValue: finiteOrNull(row.marketValue),
    unrealizedPnl: finiteOrNull(row.unrealizedPnl),
    currency: firstNonEmpty(row.currency, "USD").toUpperCase(),
    optionExpiry: firstNonEmpty(row.option?.expiry) || null,
    optionStrike: finiteOrNull(row.option?.strike),
    optionRight: firstNonEmpty(row.option?.right).toLowerCase() || null,
    payload: sanitizeJsonValue(row),
  };
}

function buildPositionSnapshotId({ accountId, broker, capturedEpochMs, rows }) {
  const base = [
    String(accountId || "").trim(),
    String(broker || "").trim().toLowerCase(),
    Number.isFinite(capturedEpochMs) ? String(Math.round(capturedEpochMs)) : "",
    stableStringify((Array.isArray(rows) ? rows : []).map((row) => row?.payload || row)),
  ].join("|");

  return crypto.createHash("sha1").update(base).digest("hex");
}

function buildNativeRowId({ accountId, broker, historyType, eventEpochMs, payload }) {
  const base = [
    String(accountId || "").trim(),
    String(broker || "").trim().toLowerCase(),
    String(historyType || "").trim().toLowerCase(),
    Number.isFinite(eventEpochMs) ? String(Math.round(eventEpochMs)) : "",
    stableStringify(payload),
  ].join("|");

  return crypto.createHash("sha1").update(base).digest("hex");
}

function sanitizeJsonValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {
      value: String(value || ""),
    };
  }
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${pairs.join(",")}}`;
}

function parseMaybeDate(value) {
  if (value == null || value === "") {
    return NaN;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) {
      return Math.round(numeric);
    }
    if (numeric > 1_000_000_000) {
      return Math.round(numeric * 1000);
    }
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampInt(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
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
