#!/usr/bin/env node

import { importMassiveFlatFiles, resolveMassiveFlatFileConfig } from "../server/services/massiveFlatFiles.js";
import {
  isMassiveFlatFileStoreConfigured,
  readMassiveFlatFileRegistryEntries,
} from "../server/services/massiveFlatFileStore.js";

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
  const normalized = String(value || "equities").trim().toLowerCase();
  if (["equities", "options", "all"].includes(normalized)) {
    return normalized;
  }
  throw new Error("asset must be equities, options, or all");
}

async function main() {
  if (!isMassiveFlatFileStoreConfigured()) {
    throw new Error("Postgres cache is not configured. Set DATABASE_URL or MASSIVE_DB_URL before importing flat files.");
  }

  const asset = normalizeAsset(parseArg("asset", "equities"));
  const from = parseArg("from", null);
  const to = parseArg("to", from);
  const refresh = hasFlag("refresh");
  const listRegistry = hasFlag("list-registry");
  const config = asset === "all"
    ? null
    : resolveMassiveFlatFileConfig({ asset });
  const configByAsset = asset === "all"
    ? {
      equities: resolveMassiveFlatFileConfig({ asset: "equities" }),
      options: resolveMassiveFlatFileConfig({ asset: "options" }),
    }
    : null;

  if (listRegistry) {
    const datasetKeys = asset === "all"
      ? ["stocks-minute-aggs", "options-minute-aggs"]
      : [asset === "equities" ? "stocks-minute-aggs" : "options-minute-aggs"];
    const registry = [];
    for (const datasetKey of datasetKeys) {
      registry.push(...await readMassiveFlatFileRegistryEntries({
        datasetKey,
        enabledOnly: false,
      }));
    }
    console.log(JSON.stringify({
      ok: true,
      asset,
      flatFileConfigured: config?.configured ?? Object.values(configByAsset || {}).every((entry) => entry?.configured),
      endpoint: config?.endpoint || null,
      bucket: config?.bucket || null,
      configByAsset,
      registry,
    }, null, 2));
    return;
  }

  if (!from) {
    throw new Error("--from=YYYY-MM-DD is required unless --list-registry is used.");
  }

  const result = await importMassiveFlatFiles({
    asset,
    from,
    to,
    refresh,
  });

  console.log(JSON.stringify({
    ok: result.ok,
    asset,
    from,
    to,
    refresh,
    flatFileConfigured: config?.configured ?? Object.values(configByAsset || {}).every((entry) => entry?.configured),
    endpoint: config?.endpoint || null,
    bucket: config?.bucket || null,
    configByAsset,
    result,
  }, null, 2));

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
