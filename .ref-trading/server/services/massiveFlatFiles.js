import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import {
  buildResearchBarFromEpochMs,
  getDateTextDayOfWeek,
  getMarketTimePartsFromEpochMs,
  isRegularMarketSessionParts,
  offsetDateText,
} from "../../src/research/market/time.js";
import { parseOptionTicker } from "../../src/research/options/optionTicker.js";
import { writeResearchSpotBars } from "./massiveDbCache.js";
import { hydrateRuntimeEnvFromSnapshot } from "./runtimeEnv.js";
import {
  isResearchOptionBarStoreEnabled,
  readMassiveFlatFileIngestState,
  readMassiveFlatFileRegistryEntries,
  upsertMassiveFlatFileIngestState,
  writeResearchOptionBars,
} from "./massiveFlatFileStore.js";
import { MASSIVE_FLAT_FILES_ROOT } from "./runtimePaths.js";

hydrateRuntimeEnvFromSnapshot();

const FLAT_FILE_ARCHIVE_ROOT = MASSIVE_FLAT_FILES_ROOT;
const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");
const SIGNATURE_ALGORITHM = "AWS4-HMAC-SHA256";
const S3_SERVICE = "s3";

export const MASSIVE_FLAT_FILE_DATASETS = {
  equities: {
    asset: "equities",
    datasetKey: "stocks-minute-aggs",
    assetClass: "equity",
    s3Prefix: "us_stocks_sip/minute_aggs_v1",
    archiveDir: "equities",
    source: "massive-flat-file-stocks-minute-aggs",
  },
  options: {
    asset: "options",
    datasetKey: "options-minute-aggs",
    assetClass: "option_underlying",
    s3Prefix: "us_options_opra/minute_aggs_v1",
    archiveDir: "options",
    source: "massive-flat-file-options-minute-aggs",
  },
};

export function resolveMassiveFlatFileConfig({ asset = null } = {}) {
  const normalizedAsset = String(asset || "").trim().toLowerCase();
  const assetPrefixes = normalizedAsset === "options"
    ? ["MASSIVE_OPTIONS_FLAT_FILES", "MASSIVE_OPTIONS_S3"]
    : normalizedAsset === "equities"
      ? ["MASSIVE_EQUITIES_FLAT_FILES", "MASSIVE_EQUITIES_S3"]
      : [];
  const sharedPrefixes = ["MASSIVE_FLAT_FILES", "MASSIVE_S3"];

  const endpoint = resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, "ENDPOINT")
    || "https://files.massive.com";
  const bucket = resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, "BUCKET")
    || "flatfiles";
  const region = resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, "REGION")
    || "us-east-1";
  const accessKeyId = resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, "ACCESS_KEY_ID");
  const secretAccessKey = resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, "SECRET_ACCESS_KEY");
  const sessionToken = resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, "SESSION_TOKEN") || null;

  return {
    asset: normalizedAsset || null,
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    configured: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
  };
}

export function isMassiveFlatFilesConfigured(asset = null) {
  return resolveMassiveFlatFileConfig({ asset }).configured;
}

export function shouldPersistMassiveFlatFileArchives() {
  const override = parseOptionalBooleanEnv(process.env.MASSIVE_FLAT_FILES_PERSIST_ARCHIVES);
  if (override !== null) {
    return override;
  }
  return !String(process.env.REPLIT_SESSION || "").trim();
}

export function buildMassiveFlatFileObjectKey({ asset, tradeDate } = {}) {
  const dataset = resolveDataset(asset);
  const normalizedTradeDate = normalizeDateText(tradeDate);
  if (!normalizedTradeDate) {
    throw new Error("tradeDate is required");
  }
  const year = normalizedTradeDate.slice(0, 4);
  const month = normalizedTradeDate.slice(5, 7);
  const filename = `${normalizedTradeDate}.csv.gz`;
  return `${dataset.s3Prefix}/${year}/${month}/${filename}`;
}

export async function importMassiveFlatFiles({
  asset = "equities",
  from,
  to = null,
  refresh = false,
} = {}) {
  if (String(asset || "").trim().toLowerCase() === "all") {
    const equityResult = await importMassiveFlatFiles({
      asset: "equities",
      from,
      to,
      refresh,
    });
    const optionResult = await importMassiveFlatFiles({
      asset: "options",
      from,
      to,
      refresh,
    });
    const results = [equityResult, optionResult];
    return {
      ok: results.every((result) => result?.ok),
      asset: "all",
      from: normalizeDateText(from),
      to: normalizeDateText(to || from),
      results,
    };
  }

  const dataset = resolveDataset(asset);
  if (dataset.asset === "options" && !isResearchOptionBarStoreEnabled()) {
    return {
      ok: true,
      asset: dataset.asset,
      datasetKey: dataset.datasetKey,
      from: normalizeDateText(from),
      to: normalizeDateText(to || from),
      results: [],
      counts: {
        imported: 0,
        skippedExisting: 0,
        skippedNoRegistry: 0,
        missing: 0,
        failed: 0,
        rowCountTotal: 0,
        rowCountKept: 0,
        barCountWritten: 0,
        skippedDisabled: 1,
      },
      disabled: true,
      reason: "option_bar_store_disabled",
    };
  }
  const normalizedFrom = normalizeDateText(from);
  const normalizedTo = normalizeDateText(to || from);
  if (!normalizedFrom || !normalizedTo) {
    throw new Error("from and to must be valid YYYY-MM-DD dates");
  }
  if (normalizedTo < normalizedFrom) {
    throw new Error("to must be on or after from");
  }

  const registryEntries = await readMassiveFlatFileRegistryEntries({
    datasetKey: dataset.datasetKey,
    enabledOnly: true,
  });
  const tradeDates = enumerateTradeDates(normalizedFrom, normalizedTo);
  const results = [];
  for (const tradeDate of tradeDates) {
    results.push(await importMassiveFlatFileDay({
      asset: dataset.asset,
      tradeDate,
      refresh,
      registryEntries,
    }));
  }

  return {
    ok: results.every((result) => [
      "imported",
      "skipped_existing",
      "skipped_no_registry",
      "missing",
    ].includes(String(result?.status || ""))),
    asset: dataset.asset,
    datasetKey: dataset.datasetKey,
    from: normalizedFrom,
    to: normalizedTo,
    results,
    counts: summarizeImportResults(results),
  };
}

export async function importMassiveFlatFileDay({
  asset = "equities",
  tradeDate,
  refresh = false,
  registryEntries = null,
} = {}) {
  const dataset = resolveDataset(asset);
  const persistArchive = shouldPersistMassiveFlatFileArchives();
  const normalizedTradeDate = normalizeDateText(tradeDate);
  if (!normalizedTradeDate) {
    throw new Error("tradeDate must be YYYY-MM-DD");
  }

  const enabledRegistryEntries = Array.isArray(registryEntries)
    ? registryEntries
    : await readMassiveFlatFileRegistryEntries({
      datasetKey: dataset.datasetKey,
      enabledOnly: true,
    });
  const activeEntries = enabledRegistryEntries.filter((entry) => isRegistryEntryActiveOnDate(entry, normalizedTradeDate));
  const trackedSymbols = activeEntries
    .map((entry) => normalizeSymbol(entry?.symbol))
    .filter(Boolean);

  if (!trackedSymbols.length) {
    await upsertMassiveFlatFileIngestState({
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
      status: "skipped_no_registry",
      trackedSymbols: [],
      metadata: {
        reason: "no_active_registry_entries",
        asset: dataset.asset,
      },
      finishedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      asset: dataset.asset,
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
      status: "skipped_no_registry",
      trackedSymbols: [],
    };
  }

  if (!refresh) {
    const priorState = await readMassiveFlatFileIngestState({
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
    });
    if (priorState?.status === "imported") {
      return {
        ok: true,
        asset: dataset.asset,
        datasetKey: dataset.datasetKey,
        tradeDate: normalizedTradeDate,
        status: "skipped_existing",
        trackedSymbols,
        archivePath: priorState.rawArchivePath,
        fileSizeBytes: priorState.fileSizeBytes,
        checksumSha256: priorState.checksumSha256,
        rowCountTotal: priorState.rowCountTotal,
        rowCountKept: priorState.rowCountKept,
        barCountWritten: priorState.barCountWritten,
      };
    }
  }

  const startedAt = new Date().toISOString();
  const objectKey = buildMassiveFlatFileObjectKey({
    asset: dataset.asset,
    tradeDate: normalizedTradeDate,
  });

  await upsertMassiveFlatFileIngestState({
    datasetKey: dataset.datasetKey,
    tradeDate: normalizedTradeDate,
    status: "running",
    trackedSymbols,
    objectKey,
    metadata: {
      asset: dataset.asset,
      refresh: refresh === true,
    },
    startedAt,
  });

  let archive = null;
  try {
    archive = await downloadMassiveFlatFileArchive({
      asset: dataset.asset,
      tradeDate: normalizedTradeDate,
      refresh,
    });
    const persistedArchivePath = persistArchive ? archive.archivePath : null;
    const ingestResult = dataset.asset === "equities"
      ? await importEquityMinuteArchive({
        tradeDate: normalizedTradeDate,
        archivePath: archive.archivePath,
        trackedSymbols,
        source: dataset.source,
        fetchedAt: archive.fetchedAt,
      })
      : await importOptionMinuteArchive({
        tradeDate: normalizedTradeDate,
        archivePath: archive.archivePath,
        trackedSymbols,
        source: dataset.source,
        fetchedAt: archive.fetchedAt,
      });

    const finishedAt = new Date().toISOString();
    await upsertMassiveFlatFileIngestState({
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
      status: "imported",
      trackedSymbols,
      objectKey,
      rawArchivePath: persistedArchivePath,
      fileSizeBytes: archive.fileSizeBytes,
      checksumSha256: archive.checksumSha256,
      rowCountTotal: ingestResult.rowCountTotal,
      rowCountKept: ingestResult.rowCountKept,
      barCountWritten: ingestResult.barCountWritten,
      metadata: ingestResult.metadata,
      startedAt,
      finishedAt,
    });

    return {
      ok: true,
      asset: dataset.asset,
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
      status: "imported",
      trackedSymbols,
      objectKey,
      archivePath: persistedArchivePath,
      fileSizeBytes: archive.fileSizeBytes,
      checksumSha256: archive.checksumSha256,
      rowCountTotal: ingestResult.rowCountTotal,
      rowCountKept: ingestResult.rowCountKept,
      barCountWritten: ingestResult.barCountWritten,
      metadata: ingestResult.metadata,
      startedAt,
      finishedAt,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const missing = Number(error?.status) === 404;
    const status = missing ? "missing" : "failed";
    await upsertMassiveFlatFileIngestState({
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
      status,
      trackedSymbols,
      objectKey,
      lastError: error?.message || String(error),
      metadata: {
        asset: dataset.asset,
        statusCode: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
      },
      startedAt,
      finishedAt,
    });
    return {
      ok: missing,
      asset: dataset.asset,
      datasetKey: dataset.datasetKey,
      tradeDate: normalizedTradeDate,
      status,
      trackedSymbols,
      objectKey,
      error: error?.message || String(error),
      startedAt,
      finishedAt,
    };
  } finally {
    if (!persistArchive && archive?.archivePath) {
      await deleteLocalArchive(archive.archivePath);
    }
  }
}

export async function downloadMassiveFlatFileArchive({
  asset = "equities",
  tradeDate,
  refresh = false,
} = {}) {
  const dataset = resolveDataset(asset);
  const normalizedTradeDate = normalizeDateText(tradeDate);
  if (!normalizedTradeDate) {
    throw new Error("tradeDate must be YYYY-MM-DD");
  }
  const objectKey = buildMassiveFlatFileObjectKey({
    asset: dataset.asset,
    tradeDate: normalizedTradeDate,
  });
  const archivePath = buildLocalArchivePath({
    asset: dataset.asset,
    tradeDate: normalizedTradeDate,
  });

  if (!refresh) {
    const existing = await summarizeLocalArchiveIfPresent(archivePath);
    if (existing) {
      return {
        ...existing,
        archivePath,
        objectKey,
        fetchedAt: existing.fetchedAt || new Date().toISOString(),
        downloaded: false,
      };
    }
  }

  const config = resolveMassiveFlatFileConfig({
    asset: dataset.asset,
  });
  if (!config.configured) {
    const assetPrefix = dataset.asset === "options"
      ? "MASSIVE_OPTIONS_FLAT_FILES_*"
      : dataset.asset === "equities"
        ? "MASSIVE_EQUITIES_FLAT_FILES_*"
        : "MASSIVE_FLAT_FILES_*";
    throw new Error(
      `Massive flat-file credentials are not configured for ${dataset.asset}. Set ${assetPrefix} or the shared MASSIVE_FLAT_FILES_* variables.`,
    );
  }

  await fsp.mkdir(path.dirname(archivePath), { recursive: true });
  const tempPath = `${archivePath}.part`;
  try {
    const response = await fetchMassiveFlatFileObject(objectKey, config);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(text || `Massive flat-file request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    if (!response.body) {
      throw new Error(`Massive flat-file response body was empty for ${objectKey}`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
    await fsp.rename(tempPath, archivePath);
    const summary = await summarizeLocalArchive(archivePath);
    return {
      archivePath,
      objectKey,
      fileSizeBytes: summary.fileSizeBytes,
      checksumSha256: summary.checksumSha256,
      fetchedAt: new Date().toISOString(),
      downloaded: true,
    };
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function importEquityMinuteArchive({
  tradeDate,
  archivePath,
  trackedSymbols,
  source,
  fetchedAt,
} = {}) {
  const trackedSet = new Set((Array.isArray(trackedSymbols) ? trackedSymbols : []).map(normalizeSymbol).filter(Boolean));
  const groupedBars = new Map();
  let rowCountTotal = 0;
  let rowCountKept = 0;

  for await (const row of readCsvRowsFromGzip(archivePath)) {
    rowCountTotal += 1;
    const aggregate = normalizeAggregateCsvRow(row);
    if (!aggregate || !trackedSet.has(aggregate.ticker)) {
      continue;
    }
    if (!isRegularMarketSessionParts(getMarketTimePartsFromEpochMs(aggregate.time))) {
      continue;
    }
    rowCountKept += 1;
    if (!groupedBars.has(aggregate.ticker)) {
      groupedBars.set(aggregate.ticker, []);
    }
    groupedBars.get(aggregate.ticker).push(buildResearchBarFromEpochMs(aggregate.time, {
      o: aggregate.o,
      h: aggregate.h,
      l: aggregate.l,
      c: aggregate.c,
      v: aggregate.v,
      n: aggregate.n,
      vw: aggregate.vw,
    }));
  }

  const symbolBarCounts = {};
  let barCountWritten = 0;
  for (const [ticker, bars] of groupedBars.entries()) {
    bars.sort((left, right) => Number(left?.time) - Number(right?.time));
    symbolBarCounts[ticker] = bars.length;
    const writeResult = await writeResearchSpotBars({
      ticker,
      session: "regular",
      bars,
      source,
      fetchedAt,
    });
    barCountWritten += Number(writeResult?.insertedCount || 0);
  }

  return {
    rowCountTotal,
    rowCountKept,
    barCountWritten,
    metadata: {
      tradeDate,
      symbols: Object.keys(symbolBarCounts).sort(),
      symbolBarCounts,
    },
  };
}

async function importOptionMinuteArchive({
  tradeDate,
  archivePath,
  trackedSymbols,
  source,
  fetchedAt,
} = {}) {
  const trackedSet = new Set((Array.isArray(trackedSymbols) ? trackedSymbols : []).map(normalizeSymbol).filter(Boolean));
  const groupedBars = new Map();
  let rowCountTotal = 0;
  let rowCountKept = 0;

  for await (const row of readCsvRowsFromGzip(archivePath)) {
    rowCountTotal += 1;
    const aggregate = normalizeAggregateCsvRow(row);
    if (!aggregate) {
      continue;
    }
    const parsedTicker = parseOptionTicker(aggregate.ticker);
    const underlyingTicker = normalizeSymbol(parsedTicker?.root);
    if (!underlyingTicker || !trackedSet.has(underlyingTicker)) {
      continue;
    }
    if (!isRegularMarketSessionParts(getMarketTimePartsFromEpochMs(aggregate.time))) {
      continue;
    }
    rowCountKept += 1;
    if (!groupedBars.has(aggregate.ticker)) {
      groupedBars.set(aggregate.ticker, {
        underlyingTicker,
        bars: [],
      });
    }
    groupedBars.get(aggregate.ticker).bars.push(buildResearchBarFromEpochMs(aggregate.time, {
      o: aggregate.o,
      h: aggregate.h,
      l: aggregate.l,
      c: aggregate.c,
      v: aggregate.v,
      n: aggregate.n,
      vw: aggregate.vw,
    }));
  }

  const underlyingBarCounts = {};
  let barCountWritten = 0;
  for (const [optionTicker, payload] of groupedBars.entries()) {
    payload.bars.sort((left, right) => Number(left?.time) - Number(right?.time));
    underlyingBarCounts[payload.underlyingTicker] = Number(underlyingBarCounts[payload.underlyingTicker] || 0) + payload.bars.length;
    const writeResult = await writeResearchOptionBars({
      optionTicker,
      underlyingTicker: payload.underlyingTicker,
      session: "regular",
      bars: payload.bars,
      source,
      fetchedAt,
    });
    barCountWritten += Number(writeResult?.insertedCount || 0);
  }

  return {
    rowCountTotal,
    rowCountKept,
    barCountWritten,
    metadata: {
      tradeDate,
      underlyingBarCounts,
      contractCount: groupedBars.size,
    },
  };
}

async function* readCsvRowsFromGzip(archivePath) {
  const gunzip = createGunzip();
  const stream = fs.createReadStream(archivePath).pipe(gunzip);
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let headers = null;
  for await (const rawLine of reader) {
    const line = String(rawLine || "");
    if (!line) {
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line).map(normalizeCsvHeader);
      continue;
    }
    const values = parseCsvLine(line);
    const row = {};
    for (let index = 0; index < headers.length; index += 1) {
      row[headers[index]] = values[index] ?? "";
    }
    yield row;
  }
}

function normalizeAggregateCsvRow(row) {
  const ticker = normalizeSymbol(firstNonEmpty(
    row?.ticker,
    row?.symbol,
    row?.sym,
    row?.option_ticker,
  ));
  const time = parseWindowStartToEpochMs(firstNonEmpty(
    row?.window_start,
    row?.windowstart,
    row?.timestamp,
    row?.t,
  ));
  const open = Number(firstNonEmpty(row?.open, row?.o));
  const high = Number(firstNonEmpty(row?.high, row?.h));
  const low = Number(firstNonEmpty(row?.low, row?.l));
  const close = Number(firstNonEmpty(row?.close, row?.c));
  if (!ticker || !Number.isFinite(time) || ![open, high, low, close].every(Number.isFinite)) {
    return null;
  }

  return {
    ticker,
    time,
    o: open,
    h: high,
    l: low,
    c: close,
    v: Math.max(0, Math.round(Number(firstNonEmpty(row?.volume, row?.v, 0)) || 0)),
    n: toIntegerOrNull(firstNonEmpty(row?.transactions, row?.transaction_count, row?.trade_count, row?.n)),
    vw: toNumberOrNull(firstNonEmpty(row?.vwap, row?.vw, row?.volume_weighted_average)),
  };
}

function parseWindowStartToEpochMs(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (/^\d+$/.test(text)) {
    try {
      const numeric = BigInt(text);
      if (text.length >= 16) {
        return Number(numeric / 1000000n);
      }
      if (text.length >= 13) {
        return Number(numeric);
      }
      if (text.length >= 10) {
        return Number(numeric * 1000n);
      }
      return Number(numeric);
    } catch {
      return null;
    }
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (character === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  out.push(current);
  return out;
}

function normalizeCsvHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseOptionalBooleanEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

async function summarizeLocalArchiveIfPresent(archivePath) {
  try {
    await fsp.access(archivePath);
    const summary = await summarizeLocalArchive(archivePath);
    return {
      archivePath,
      fileSizeBytes: summary.fileSizeBytes,
      checksumSha256: summary.checksumSha256,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function summarizeLocalArchive(archivePath) {
  const stats = await fsp.stat(archivePath);
  const checksumSha256 = await computeFileSha256(archivePath);
  return {
    fileSizeBytes: Number(stats.size || 0),
    checksumSha256,
  };
}

async function computeFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function deleteLocalArchive(archivePath) {
  try {
    await fsp.rm(archivePath, { force: true });
    await removeEmptyArchiveParents(path.dirname(archivePath));
  } catch (error) {
    console.warn("[massive-flat-files] Failed to delete local archive:", error?.message || error);
  }
}

async function removeEmptyArchiveParents(directoryPath) {
  let currentPath = path.resolve(directoryPath);
  const stopPath = path.resolve(FLAT_FILE_ARCHIVE_ROOT);
  while (currentPath.startsWith(`${stopPath}${path.sep}`) || currentPath === stopPath) {
    try {
      await fsp.rmdir(currentPath);
    } catch (error) {
      if (["ENOTEMPTY", "ENOENT"].includes(error?.code)) {
        return;
      }
      throw error;
    }
    if (currentPath === stopPath) {
      return;
    }
    currentPath = path.dirname(currentPath);
  }
}

async function fetchMassiveFlatFileObject(objectKey, config) {
  const endpoint = new URL(config.endpoint);
  const canonicalUri = "/" + [config.bucket, ...String(objectKey || "").split("/").map(encodeRfc3986)].join("/");
  const url = new URL(config.endpoint);
  url.pathname = canonicalUri;

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = ["host", "x-amz-content-sha256", "x-amz-date"];
  const headers = {
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": amzDate,
  };
  if (config.sessionToken) {
    headers["x-amz-security-token"] = config.sessionToken;
    signedHeaders.push("x-amz-security-token");
  }

  const canonicalHeaders = [
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${EMPTY_SHA256}`,
    `x-amz-date:${amzDate}`,
    ...(config.sessionToken ? [`x-amz-security-token:${config.sessionToken}`] : []),
  ].join("\n") + "\n";
  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    EMPTY_SHA256,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/${S3_SERVICE}/aws4_request`;
  const stringToSign = [
    SIGNATURE_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = buildAwsSigningKey(config.secretAccessKey, dateStamp, config.region, S3_SERVICE);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  headers.Authorization = `${SIGNATURE_ALGORITHM} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
  return fetch(url, {
    method: "GET",
    headers,
  });
}

function buildAwsSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildLocalArchivePath({ asset, tradeDate } = {}) {
  const dataset = resolveDataset(asset);
  const normalizedTradeDate = normalizeDateText(tradeDate);
  const year = normalizedTradeDate?.slice(0, 4);
  const month = normalizedTradeDate?.slice(5, 7);
  if (!year || !month || !normalizedTradeDate) {
    throw new Error("tradeDate is required");
  }
  return path.join(FLAT_FILE_ARCHIVE_ROOT, dataset.archiveDir, year, month, `${normalizedTradeDate}.csv.gz`);
}

function resolveDataset(asset) {
  const normalizedAsset = String(asset || "equities").trim().toLowerCase();
  const dataset = MASSIVE_FLAT_FILE_DATASETS[normalizedAsset];
  if (!dataset) {
    throw new Error(`Unsupported flat-file asset: ${asset}`);
  }
  return dataset;
}

function resolveMassiveFlatFileEnvValue(assetPrefixes, sharedPrefixes, suffix) {
  const prefixes = [...assetPrefixes, ...sharedPrefixes];
  for (const prefix of prefixes) {
    const value = process.env[`${prefix}_${suffix}`];
    if (String(value || "").trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function isRegistryEntryActiveOnDate(entry, tradeDate) {
  const startDate = normalizeDateText(entry?.startDate);
  const endDate = normalizeDateText(entry?.endDate);
  if (startDate && tradeDate < startDate) {
    return false;
  }
  if (endDate && tradeDate > endDate) {
    return false;
  }
  return entry?.enabled !== false;
}

function enumerateTradeDates(from, to) {
  const dates = [];
  for (let cursor = from; cursor && cursor <= to; cursor = offsetDateText(cursor, 1)) {
    const dayOfWeek = getDateTextDayOfWeek(cursor);
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }
    dates.push(cursor);
  }
  return dates;
}

function summarizeImportResults(results = []) {
  const summary = {
    imported: 0,
    skippedExisting: 0,
    skippedNoRegistry: 0,
    missing: 0,
    failed: 0,
    rowCountTotal: 0,
    rowCountKept: 0,
    barCountWritten: 0,
  };
  for (const result of Array.isArray(results) ? results : []) {
    const status = String(result?.status || "");
    if (status === "imported") summary.imported += 1;
    if (status === "skipped_existing") summary.skippedExisting += 1;
    if (status === "skipped_no_registry") summary.skippedNoRegistry += 1;
    if (status === "missing") summary.missing += 1;
    if (status === "failed") summary.failed += 1;
    summary.rowCountTotal += Number(result?.rowCountTotal || 0);
    summary.rowCountKept += Number(result?.rowCountKept || 0);
    summary.barCountWritten += Number(result?.barCountWritten || 0);
  }
  return summary;
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeSymbol(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

function toIntegerOrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.round(numeric));
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
