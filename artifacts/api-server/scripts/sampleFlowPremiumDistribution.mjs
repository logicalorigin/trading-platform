#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPolygonRuntimeConfig } from "../src/lib/runtime.ts";
import { aggregateOptionPremiumDistributionSnapshots } from "../src/providers/polygon/market-data.ts";

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "IWM"];
const SNAPSHOT_LIMIT = 250;
const EXPIRATION_LOOKAHEAD_DAYS = 60;

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function parseArgs(argv) {
  const options = {
    symbols: DEFAULT_SYMBOLS,
    timeframe: "today",
    maxPages: 1,
    tradeLimit: 250,
    contractLimit: 8,
    write: false,
    output: join(repoRoot, "tmp", "polygon-premium-distribution-sample.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--symbols" && next) {
      options.symbols = next
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      index += 1;
    } else if (arg === "--timeframe" && next) {
      options.timeframe = next === "week" ? "week" : "today";
      index += 1;
    } else if (arg === "--max-pages" && next) {
      options.maxPages = clampInteger(next, 1, 20, options.maxPages);
      index += 1;
    } else if (arg === "--trade-limit" && next) {
      options.tradeLimit = clampInteger(next, 1, 50_000, options.tradeLimit);
      index += 1;
    } else if (arg === "--contracts" && next) {
      options.contractLimit = clampInteger(next, 1, 60, options.contractLimit);
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--output" && next) {
      options.output = resolve(process.cwd(), next);
      options.write = true;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function toDate(value) {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  if (numeric > 1_000_000_000_000_000) return new Date(numeric / 1_000_000);
  if (numeric > 1_000_000_000_000) return new Date(numeric);
  if (numeric > 1_000_000_000) return new Date(numeric * 1_000);
  return null;
}

function latestDate(values) {
  return values
    .filter((value) => value && !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function buildUrl(config, pathOrUrl, params = {}) {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${config.baseUrl}${pathOrUrl}`);
  Object.entries({ ...params, apiKey: config.apiKey }).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(
      `Polygon request failed with HTTP ${response.status}: ${detail.slice(0, 180)}`,
    );
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

function readDetails(snapshot) {
  const record = asRecord(snapshot);
  return asRecord(record?.details) ?? record ?? {};
}

function readSnapshotTicker(snapshot) {
  return asString(readDetails(snapshot).ticker);
}

function readSharesPerContract(snapshot) {
  const details = readDetails(snapshot);
  const shares =
    asNumber(details.shares_per_contract) ?? asNumber(details.multiplier) ?? 100;
  return shares > 0 ? shares : 100;
}

function getNumberPath(record, path) {
  let current = asRecord(record);
  for (const segment of path) {
    if (!current) return null;
    const value = current[segment];
    if (segment === path[path.length - 1]) return asNumber(value);
    current = asRecord(value);
  }
  return null;
}

function deriveSnapshotTradingDate(snapshots, fallback) {
  const dayDates = [];
  const tradeDates = [];
  snapshots.forEach((snapshot) => {
    const record = asRecord(snapshot);
    const day = asRecord(record?.day);
    const trade = asRecord(record?.last_trade);
    dayDates.push(toDate(getNumberPath(day, ["last_updated"])));
    tradeDates.push(
      firstDefined(
        toDate(getNumberPath(trade, ["sip_timestamp"])),
        toDate(getNumberPath(trade, ["participant_timestamp"])),
        toDate(getNumberPath(trade, ["t"])),
      ),
    );
  });
  return latestDate(dayDates) ?? latestDate(tradeDates) ?? fallback;
}

function snapshotTotalPremium(snapshot) {
  const record = asRecord(snapshot);
  if (!record) return 0;
  const details = readDetails(snapshot);
  const day = asRecord(record.day);
  const session = asRecord(record.session);
  const shares = readSharesPerContract(snapshot);
  const price =
    firstDefined(
      getNumberPath(session, ["vwap"]),
      getNumberPath(session, ["vw"]),
      getNumberPath(day, ["vw"]),
      getNumberPath(day, ["vwap"]),
      getNumberPath(day, ["close"]),
      getNumberPath(day, ["c"]),
    ) ?? null;
  const volume =
    firstDefined(
      getNumberPath(session, ["volume"]),
      getNumberPath(session, ["v"]),
      getNumberPath(day, ["volume"]),
      getNumberPath(day, ["v"]),
    ) ?? null;
  const ticker = asString(details.ticker);
  if (!ticker || price === null || volume === null || price <= 0 || volume <= 0) {
    return 0;
  }
  return price * volume * shares;
}

function summarizeFieldPresence(snapshots) {
  const fields = {
    detailsTicker: 0,
    sessionPrice: 0,
    sessionVolume: 0,
    dayPrice: 0,
    dayVolume: 0,
    lastQuote: 0,
    lastTrade: 0,
    sharesPerContract: 0,
  };

  snapshots.forEach((snapshot) => {
    const record = asRecord(snapshot);
    const details = readDetails(snapshot);
    const session = asRecord(record?.session);
    const day = asRecord(record?.day);
    const quote = asRecord(record?.last_quote);
    const trade = asRecord(record?.last_trade);

    if (asString(details.ticker)) fields.detailsTicker += 1;
    if (getNumberPath(session, ["vwap"]) !== null || getNumberPath(session, ["vw"]) !== null) {
      fields.sessionPrice += 1;
    }
    if (
      getNumberPath(session, ["volume"]) !== null ||
      getNumberPath(session, ["v"]) !== null
    ) {
      fields.sessionVolume += 1;
    }
    if (
      getNumberPath(day, ["vw"]) !== null ||
      getNumberPath(day, ["vwap"]) !== null ||
      getNumberPath(day, ["close"]) !== null ||
      getNumberPath(day, ["c"]) !== null
    ) {
      fields.dayPrice += 1;
    }
    if (getNumberPath(day, ["volume"]) !== null || getNumberPath(day, ["v"]) !== null) {
      fields.dayVolume += 1;
    }
    if (quote) fields.lastQuote += 1;
    if (trade) fields.lastTrade += 1;
    if (
      asNumber(details.shares_per_contract) !== null ||
      asNumber(details.multiplier) !== null
    ) {
      fields.sharesPerContract += 1;
    }
  });

  return fields;
}

function mapTradePrint(trade) {
  const record = asRecord(trade);
  if (!record) return null;
  const price = firstDefined(asNumber(record.price), asNumber(record.p));
  const size = firstDefined(asNumber(record.size), asNumber(record.s));
  const occurredAt = firstDefined(
    toDate(record.sip_timestamp),
    toDate(record.participant_timestamp),
    toDate(record.t),
  );
  if (price === null || price <= 0 || size === null || size <= 0 || !occurredAt) {
    return null;
  }
  return {
    price,
    size,
    occurredAt,
    sequenceNumber: asNumber(record.sequence_number),
    conditionCodes: asArray(record.conditions)
      .map((condition) => asString(condition))
      .filter(Boolean),
    exchange: firstDefined(asString(record.exchange), asString(record.x)),
  };
}

async function fetchOptionTradeConditionMetadata(config) {
  const payload = await fetchJson(
    buildUrl(config, "/v3/reference/conditions", {
      asset_class: "options",
      data_type: "trade",
      limit: 1_000,
    }),
  );
  const metadata = new Map();
  asArray(asRecord(payload)?.results).forEach((result) => {
    const record = asRecord(result);
    if (!record) return;
    const id = asString(record.id);
    if (!id) return;
    const updateRules =
      asRecord(record.update_rules) ?? asRecord(record.updateRules);
    const consolidated = asRecord(updateRules?.consolidated);
    metadata.set(id, {
      updatesVolume:
        typeof consolidated?.updates_volume === "boolean"
          ? consolidated.updates_volume
          : null,
      name: asString(record.name),
    });
  });
  return metadata;
}

function tradePrintEligibility(trade, conditionMetadata) {
  if (!conditionMetadata || !trade.conditionCodes.length) {
    return { eligible: true, unknownCondition: false };
  }

  let unknownCondition = false;
  for (const code of trade.conditionCodes) {
    const condition = conditionMetadata.get(code);
    if (!condition) {
      unknownCondition = true;
      continue;
    }
    if (condition.updatesVolume === false) {
      return { eligible: false, unknownCondition };
    }
  }

  return { eligible: true, unknownCondition };
}

function classifyTradePrints(trades, sharesPerContract, conditionMetadata) {
  const mapped = trades
    .map(mapTradePrint)
    .filter(Boolean)
    .sort((left, right) => {
      const timeDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
      if (timeDelta !== 0) return timeDelta;
      return (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0);
    });
  let previousPrice = null;
  let previousSide = "neutral";
  let buyPremium = 0;
  let sellPremium = 0;
  let tickTestMatchedCount = 0;
  let eligibleTradeCount = 0;
  let ineligibleTradeCount = 0;
  let unknownConditionTradeCount = 0;
  const conditionCodes = new Set();
  const exchangeCodes = new Set();

  mapped.forEach((trade) => {
    trade.conditionCodes.forEach((code) => conditionCodes.add(code));
    if (trade.exchange) exchangeCodes.add(trade.exchange);
    const eligibility = tradePrintEligibility(trade, conditionMetadata);
    if (!eligibility.eligible) {
      ineligibleTradeCount += 1;
      return;
    }
    eligibleTradeCount += 1;
    if (eligibility.unknownCondition) {
      unknownConditionTradeCount += 1;
    }

    let side = "neutral";
    if (previousPrice !== null) {
      if (trade.price > previousPrice) side = "buy";
      else if (trade.price < previousPrice) side = "sell";
      else side = previousSide;
    }
    if (side !== "neutral") {
      const premium = trade.price * trade.size * sharesPerContract;
      if (side === "buy") buyPremium += premium;
      if (side === "sell") sellPremium += premium;
      tickTestMatchedCount += 1;
      previousSide = side;
    }
    previousPrice = trade.price;
  });

  return {
    buyPremium,
    sellPremium,
    tradeCount: mapped.length,
    eligibleTradeCount,
    ineligibleTradeCount,
    unknownConditionTradeCount,
    tickTestMatchedCount,
    conditionCodes: [...conditionCodes].sort(),
    exchangeCodes: [...exchangeCodes].sort(),
  };
}

async function probeOptionQuoteAccess(config, candidate, since) {
  if (!candidate?.ticker) {
    return { status: "not_attempted", message: null };
  }

  try {
    const payload = await fetchJson(
      buildUrl(config, `/v3/quotes/${encodeURIComponent(candidate.ticker)}`, {
        "timestamp.gte": toIsoDate(since),
        order: "desc",
        sort: "timestamp",
        limit: 1,
      }),
    );
    return {
      status: asArray(asRecord(payload)?.results).length
        ? "available"
        : "unavailable",
      message: null,
    };
  } catch (error) {
    if (error?.statusCode === 403) {
      return {
        status: "forbidden",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Option quotes are not available for this Polygon/Massive plan.",
      };
    }
    return {
      status: "failed",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Option quote probe failed.",
    };
  }
}

async function fetchSnapshotPages(config, symbol, options) {
  const now = new Date();
  let nextUrl = buildUrl(config, `/v3/snapshot/options/${encodeURIComponent(symbol)}`, {
    "expiration_date.gte": toIsoDate(now),
    "expiration_date.lte": toIsoDate(addUtcDays(now, EXPIRATION_LOOKAHEAD_DAYS)),
    order: "asc",
    sort: "expiration_date",
    limit: SNAPSHOT_LIMIT,
  });
  const snapshots = [];
  let pageCount = 0;

  while (nextUrl && pageCount < options.maxPages) {
    const payload = await fetchJson(nextUrl);
    const record = asRecord(payload);
    snapshots.push(...asArray(record?.results));
    const next = asString(record?.next_url);
    nextUrl = next ? buildUrl(config, next) : null;
    pageCount += 1;
  }

  return { snapshots, pageCount };
}

async function fetchTradeSamples(config, candidates, options, since) {
  const classifications = new Map();
  const conditionCodes = new Set();
  const exchangeCodes = new Set();
  let tradeCount = 0;
  let eligibleTradeCount = 0;
  let ineligibleTradeCount = 0;
  let unknownConditionTradeCount = 0;
  let tickTestMatchedCount = 0;
  let successCount = 0;
  let forbiddenCount = 0;
  let errorCount = 0;
  let conditionMetadataLoaded = false;
  let conditionMetadata = null;

  try {
    conditionMetadata = await fetchOptionTradeConditionMetadata(config);
    conditionMetadataLoaded = true;
  } catch {
    conditionMetadata = null;
  }

  for (const candidate of candidates) {
    try {
      const payload = await fetchJson(
        buildUrl(config, `/v3/trades/${encodeURIComponent(candidate.ticker)}`, {
          "timestamp.gte": toIsoDate(since),
          order: "asc",
          sort: "timestamp",
          limit: options.tradeLimit,
        }),
      );
      const trades = asArray(asRecord(payload)?.results);
      successCount += 1;
      const summary = classifyTradePrints(
        trades,
        candidate.sharesPerContract,
        conditionMetadata,
      );
      tradeCount += summary.tradeCount;
      eligibleTradeCount += summary.eligibleTradeCount;
      ineligibleTradeCount += summary.ineligibleTradeCount;
      unknownConditionTradeCount += summary.unknownConditionTradeCount;
      tickTestMatchedCount += summary.tickTestMatchedCount;
      summary.conditionCodes.forEach((code) => conditionCodes.add(code));
      summary.exchangeCodes.forEach((code) => exchangeCodes.add(code));
      if (summary.tradeCount > 0) {
        classifications.set(candidate.ticker, summary);
      }
    } catch (error) {
      if (error?.statusCode === 403) forbiddenCount += 1;
      else errorCount += 1;
    }
  }

  return {
    classifications,
    tradeAccess:
      classifications.size > 0
        ? "available"
        : forbiddenCount > 0 && forbiddenCount >= candidates.length - errorCount
          ? "forbidden"
          : "unavailable",
    summary: {
      candidateCount: candidates.length,
      sampledTradeCount: tradeCount,
      eligibleTradeCount,
      ineligibleTradeCount,
      unknownConditionTradeCount,
      tickTestMatchedCount,
      classifiedContractCount: classifications.size,
      conditionMetadataLoaded,
      conditionCodes: [...conditionCodes].sort().slice(0, 40),
      exchangeCodes: [...exchangeCodes].sort().slice(0, 40),
      successCount,
      forbiddenCount,
      errorCount,
    },
  };
}

async function sampleSymbol(config, symbol, options) {
  const { snapshots, pageCount } = await fetchSnapshotPages(config, symbol, options);
  const snapshotTradingDate = deriveSnapshotTradingDate(snapshots, new Date());
  const tradeLookbackStart =
    options.timeframe === "week"
      ? addUtcDays(snapshotTradingDate, -7)
      : snapshotTradingDate;
  const candidates = snapshots
    .map((snapshot) => ({
      ticker: readSnapshotTicker(snapshot),
      sharesPerContract: readSharesPerContract(snapshot),
      totalPremium: snapshotTotalPremium(snapshot),
    }))
    .filter((candidate) => candidate.ticker && candidate.totalPremium > 0)
    .sort((left, right) => right.totalPremium - left.totalPremium)
    .slice(0, options.contractLimit);
  const quoteProbe = await probeOptionQuoteAccess(
    config,
    candidates[0],
    tradeLookbackStart,
  );
  const trades = await fetchTradeSamples(
    config,
    candidates,
    options,
    tradeLookbackStart,
  );
  const aggregate = aggregateOptionPremiumDistributionSnapshots({
    underlying: symbol,
    snapshots,
    tradeClassifications: trades.classifications,
    timeframe: options.timeframe,
    asOf: new Date(),
    delayed: config.baseUrl.includes("massive.com"),
    quoteAccess:
      quoteProbe.status === "available"
        ? "available"
        : quoteProbe.status === "forbidden"
          ? "forbidden"
          : undefined,
    tradeAccess: trades.tradeAccess,
    hydrationDiagnostics: {
      snapshotTradingDate: toIsoDate(snapshotTradingDate),
      tradeLookbackStartDate: toIsoDate(tradeLookbackStart),
      quoteProbeDate: toIsoDate(tradeLookbackStart),
      quoteProbeStatus: quoteProbe.status,
      quoteProbeMessage: quoteProbe.message,
      tradeContractCandidateCount: trades.summary.candidateCount,
      tradeContractHydratedCount: trades.summary.classifiedContractCount,
      tradeCallAttemptCount: trades.summary.candidateCount,
      tradeCallSuccessCount: trades.summary.successCount,
      tradeCallErrorCount: trades.summary.errorCount,
      tradeCallForbiddenCount: trades.summary.forbiddenCount,
      eligibleTradeCount: trades.summary.eligibleTradeCount,
      ineligibleTradeCount: trades.summary.ineligibleTradeCount,
      unknownConditionTradeCount: trades.summary.unknownConditionTradeCount,
      conditionCodes: trades.summary.conditionCodes,
      exchangeCodes: trades.summary.exchangeCodes,
    },
    pageCount,
  });

  return {
    symbol,
    pageCount,
    snapshotCount: snapshots.length,
    snapshotTradingDate: toIsoDate(snapshotTradingDate),
    tradeLookbackStartDate: toIsoDate(tradeLookbackStart),
    fieldPresence: summarizeFieldPresence(snapshots),
    quoteProbe,
    tradeSample: trades.summary,
    aggregate: {
      premiumTotal: aggregate.premiumTotal,
      classifiedPremium: aggregate.classifiedPremium,
      classificationCoverage: aggregate.classificationCoverage,
      classificationConfidence: aggregate.classificationConfidence,
      hydrationWarning: aggregate.hydrationWarning,
      hydrationDiagnostics: aggregate.hydrationDiagnostics,
      sideBasis: aggregate.sideBasis,
      quoteAccess: aggregate.quoteAccess,
      tradeAccess: aggregate.tradeAccess,
      bucketThresholds: aggregate.bucketThresholds,
      contractCount: aggregate.contractCount,
      tradeCount: aggregate.tradeCount,
      quoteMatchedCount: aggregate.quoteMatchedCount,
      tickTestMatchedCount: aggregate.tickTestMatchedCount,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      [
        "Usage: node --import tsx scripts/sampleFlowPremiumDistribution.mjs [options]",
        "",
        "Options:",
        "  --symbols SPY,QQQ,NVDA   Symbols to sample",
        "  --timeframe today|week    Trade lookback for tick-test fallback",
        "  --max-pages 1..20         Option snapshot pages per symbol",
        "  --contracts 1..60         Top option contracts for trade sampling",
        "  --trade-limit 1..50000    Trades per sampled contract",
        "  --write                   Write sanitized JSON to tmp/",
        "  --output PATH             Write sanitized JSON to PATH",
      ].join("\n"),
    );
    return;
  }

  const config = getPolygonRuntimeConfig();
  if (!config) {
    console.error(
      "Polygon/Massive market data is not configured. Set POLYGON_API_KEY, POLYGON_KEY, MASSIVE_API_KEY, or MASSIVE_MARKET_DATA_API_KEY.",
    );
    process.exitCode = 1;
    return;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    baseHost: new URL(config.baseUrl).host,
    timeframe: options.timeframe,
    maxPages: options.maxPages,
    symbols: [],
  };

  for (const symbol of options.symbols) {
    payload.symbols.push(await sampleSymbol(config, symbol, options));
  }

  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.write) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, text, "utf8");
    console.log(`Wrote sanitized Polygon premium distribution sample: ${options.output}`);
  } else {
    process.stdout.write(text);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
