#!/usr/bin/env node

import { importMassiveFlatFiles } from "../server/services/massiveFlatFiles.js";
import {
  isMassiveFlatFileStoreConfigured,
  isResearchOptionBarStoreEnabled,
  readMassiveFlatFileRegistryEntries,
} from "../server/services/massiveFlatFileStore.js";

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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeAsset(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (["equities", "options", "all"].includes(normalized)) {
    return normalized;
  }
  throw new Error("asset must be equities, options, or all");
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
  return formatDateText(date) === text ? text : null;
}

function formatDateText(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDateText(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatDateText(date);
}

function computeDefaultToDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return formatDateText(date);
}

function computeChunkEndDate(dateText, chunkMonths) {
  const [yearText, monthText] = String(dateText).split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const end = new Date(Date.UTC(year, monthIndex + chunkMonths, 0));
  return formatDateText(end);
}

function minDate(left, right) {
  return left <= right ? left : right;
}

function buildAssetList(asset) {
  if (asset === "all") {
    return ["equities", "options"];
  }
  return [asset];
}

function buildDatasetKey(asset) {
  return asset === "equities" ? "stocks-minute-aggs" : "options-minute-aggs";
}

function summarizeChunkResults(results = []) {
  return results.reduce((summary, result) => {
    const counts = result?.counts || {};
    summary.imported += Number(counts.imported || 0);
    summary.skippedExisting += Number(counts.skippedExisting || 0);
    summary.skippedNoRegistry += Number(counts.skippedNoRegistry || 0);
    summary.missing += Number(counts.missing || 0);
    summary.failed += Number(counts.failed || 0);
    summary.rowCountTotal += Number(counts.rowCountTotal || 0);
    summary.rowCountKept += Number(counts.rowCountKept || 0);
    summary.barCountWritten += Number(counts.barCountWritten || 0);
    return summary;
  }, {
    imported: 0,
    skippedExisting: 0,
    skippedNoRegistry: 0,
    missing: 0,
    failed: 0,
    rowCountTotal: 0,
    rowCountKept: 0,
    barCountWritten: 0,
  });
}

async function main() {
  if (!isMassiveFlatFileStoreConfigured()) {
    throw new Error("Postgres cache is not configured. Set DATABASE_URL or MASSIVE_DB_URL before backfilling flat files.");
  }

  const asset = normalizeAsset(parseArg("asset", "all"));
  const from = normalizeDateText(parseArg("from", DEFAULT_FROM));
  const to = normalizeDateText(parseArg("to", computeDefaultToDate()));
  const refresh = hasFlag("refresh");
  const chunkMonths = Math.max(1, Math.round(Number(parseArg("chunk-months", "1")) || 1));
  if (!from || !to) {
    throw new Error("--from and --to must be valid YYYY-MM-DD dates.");
  }
  if (to < from) {
    throw new Error("--to must be on or after --from.");
  }

  const assets = buildAssetList(asset);
  const overallResults = [];
  console.log(JSON.stringify({
    event: "backfill_start",
    asset,
    assets,
    from,
    to,
    refresh,
    chunkMonths,
    startedAt: new Date().toISOString(),
  }));

  for (const currentAsset of assets) {
    if (currentAsset === "options" && !isResearchOptionBarStoreEnabled()) {
      console.log(JSON.stringify({
        event: "asset_skipped",
        asset: currentAsset,
        reason: "option_bar_store_disabled",
        skippedAt: new Date().toISOString(),
      }));
      overallResults.push({
        asset: currentAsset,
        summary: {
          imported: 0,
          skippedExisting: 0,
          skippedNoRegistry: 0,
          missing: 0,
          failed: 0,
          rowCountTotal: 0,
          rowCountKept: 0,
          barCountWritten: 0,
        },
      });
      continue;
    }
    const datasetKey = buildDatasetKey(currentAsset);
    const registryEntries = await readMassiveFlatFileRegistryEntries({
      datasetKey,
      enabledOnly: true,
    });
    const symbols = registryEntries
      .map((entry) => String(entry?.symbol || "").trim().toUpperCase())
      .filter(Boolean)
      .sort();
    console.log(JSON.stringify({
      event: "asset_start",
      asset: currentAsset,
      datasetKey,
      symbols,
      startedAt: new Date().toISOString(),
    }));

    const assetResults = [];
    for (let chunkFrom = from; chunkFrom <= to;) {
      const chunkTo = minDate(computeChunkEndDate(chunkFrom, chunkMonths), to);
      console.log(JSON.stringify({
        event: "chunk_start",
        asset: currentAsset,
        datasetKey,
        from: chunkFrom,
        to: chunkTo,
        startedAt: new Date().toISOString(),
      }));
      const result = await importMassiveFlatFiles({
        asset: currentAsset,
        from: chunkFrom,
        to: chunkTo,
        refresh,
      });
      assetResults.push(result);
      console.log(JSON.stringify({
        event: "chunk_complete",
        asset: currentAsset,
        datasetKey,
        from: chunkFrom,
        to: chunkTo,
        ok: result.ok,
        counts: result.counts,
        finishedAt: new Date().toISOString(),
      }));
      if (!result.ok) {
        throw new Error(`Backfill failed for ${currentAsset} ${chunkFrom}..${chunkTo}`);
      }
      chunkFrom = offsetDateText(chunkTo, 1);
    }

    const assetSummary = summarizeChunkResults(assetResults);
    overallResults.push({
      asset: currentAsset,
      summary: assetSummary,
    });
    console.log(JSON.stringify({
      event: "asset_complete",
      asset: currentAsset,
      datasetKey,
      summary: assetSummary,
      finishedAt: new Date().toISOString(),
    }));
  }

  console.log(JSON.stringify({
    event: "backfill_complete",
    asset,
    assets,
    from,
    to,
    refresh,
    chunkMonths,
    results: overallResults,
    finishedAt: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "backfill_error",
    message: error?.message || String(error),
    stack: error?.stack || null,
    failedAt: new Date().toISOString(),
  }));
  process.exit(1);
});
