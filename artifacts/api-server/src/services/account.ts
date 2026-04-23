import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  flexCashActivityTable,
  flexDividendsTable,
  flexNavHistoryTable,
  flexOpenPositionsTable,
  flexReportRunsTable,
  flexTradesTable,
  instrumentsTable,
  positionLotsTable,
  tickerReferenceCacheTable,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";

const COMBINED_ACCOUNT_ID = "combined";
const FLEX_SEND_REQUEST_URL =
  "https://www.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";
const FLEX_GET_STATEMENT_URL =
  "https://www.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";
const SNAPSHOT_WRITE_INTERVAL_MS = 60_000;
const FLEX_POLL_INTERVAL_MS = 5_000;
const FLEX_MAX_POLLS = 18;

type AccountRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
type OrderTab = "working" | "history";

type FlexRecord = {
  tag: string;
  attributes: Record<string, string>;
};

type AccountMetric = {
  value: number | null;
  currency: string | null;
  source: "IBKR_ACCOUNT_SUMMARY" | "IBKR_POSITIONS" | "FLEX" | "LOCAL_LEDGER";
  field: string;
  updatedAt: Date | null;
};

type AccountUniverse = {
  requestedAccountId: string;
  accountIds: string[];
  isCombined: boolean;
  accounts: BrokerAccountSnapshot[];
  primaryCurrency: string;
};

const snapshotWriteTimestamps = new Map<string, number>();

const ETF_SYMBOLS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "TLT",
  "IEF",
  "GLD",
  "USO",
  "SOXX",
  "VXX",
  "VIXY",
]);

const STATIC_SECTOR_BY_SYMBOL: Record<string, string> = {
  AAPL: "Technology",
  MSFT: "Technology",
  NVDA: "Technology",
  AMD: "Technology",
  AVGO: "Technology",
  META: "Communication Services",
  GOOGL: "Communication Services",
  GOOG: "Communication Services",
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  JPM: "Financials",
  BAC: "Financials",
  XOM: "Energy",
  CVX: "Energy",
  UNH: "Health Care",
  JNJ: "Health Care",
  SPY: "Broad Market ETF",
  QQQ: "Growth ETF",
  IWM: "Small-Cap ETF",
  DIA: "Blue-Chip ETF",
  TLT: "Rates ETF",
  GLD: "Commodity ETF",
  SOXX: "Semiconductor ETF",
};

const BETA_BY_SYMBOL: Record<string, number> = {
  SPY: 1,
  QQQ: 1.15,
  IWM: 1.25,
  AAPL: 1.2,
  MSFT: 0.95,
  NVDA: 1.8,
  AMD: 1.9,
  TSLA: 2.1,
  META: 1.25,
  GOOGL: 1.05,
  AMZN: 1.25,
};

function getIbkrClient(): IbkrBridgeClient {
  return new IbkrBridgeClient();
}

function metric(
  value: number | null | undefined,
  currency: string | null,
  source: AccountMetric["source"],
  field: string,
  updatedAt: Date | null,
): AccountMetric {
  return {
    value: isFiniteNumber(value) ? Number(value) : null,
    currency,
    source,
    field,
    updatedAt,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[$,%\s,]/g, "");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function numericString(value: unknown): string | null {
  const numeric = toNumber(value);
  return numeric === null ? null : String(numeric);
}

function nonNullNumericString(value: unknown, fallback = 0): string {
  return String(toNumber(value) ?? fallback);
}

function firstString(
  source: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const direct = source[key];
    if (direct?.trim()) {
      return direct.trim();
    }

    const entry = Object.entries(source).find(
      ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (entry?.[1]?.trim()) {
      return entry[1].trim();
    }
  }

  return null;
}

function firstNumber(
  source: Record<string, string>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = firstString(source, [key]);
    const numeric = toNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const raw = value.trim();
  const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    return new Date(
      Date.UTC(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3])),
    );
  }

  const yyyymmddTime = raw.match(
    /^(\d{4})(\d{2})(\d{2})[;\sT]+(\d{2}):?(\d{2}):?(\d{2})?$/,
  );
  if (yyyymmddTime) {
    return new Date(
      Date.UTC(
        Number(yyyymmddTime[1]),
        Number(yyyymmddTime[2]) - 1,
        Number(yyyymmddTime[3]),
        Number(yyyymmddTime[4]),
        Number(yyyymmddTime[5]),
        Number(yyyymmddTime[6] ?? "0"),
      ),
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateFromDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function rangeStart(range: AccountRange): Date | null {
  const now = new Date();
  const start = new Date(now);

  switch (range) {
    case "1W":
      start.setUTCDate(now.getUTCDate() - 7);
      return start;
    case "1M":
      start.setUTCMonth(now.getUTCMonth() - 1);
      return start;
    case "3M":
      start.setUTCMonth(now.getUTCMonth() - 3);
      return start;
    case "YTD":
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case "1Y":
      start.setUTCFullYear(now.getUTCFullYear() - 1);
      return start;
    case "ALL":
      return null;
  }
}

function normalizeRange(raw: unknown): AccountRange {
  const value = typeof raw === "string" ? raw.toUpperCase() : "1M";
  return value === "1W" ||
    value === "1M" ||
    value === "3M" ||
    value === "YTD" ||
    value === "1Y" ||
    value === "ALL"
    ? value
    : "1M";
}

function normalizeOrderTab(raw: unknown): OrderTab {
  return raw === "history" ? "history" : "working";
}

function currencyOf(accounts: BrokerAccountSnapshot[]): string {
  return accounts[0]?.currency || "USD";
}

function accountMetricUpdatedAt(accounts: BrokerAccountSnapshot[]): Date | null {
  const timestamps = accounts
    .map((account) => account.updatedAt?.getTime?.() ?? 0)
    .filter(Boolean);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

function sumAccounts(
  accounts: BrokerAccountSnapshot[],
  key: keyof BrokerAccountSnapshot,
): number | null {
  const values = accounts
    .map((account) => toNumber(account[key]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function weightedAccountAverage(
  accounts: BrokerAccountSnapshot[],
  key: keyof BrokerAccountSnapshot,
): number | null {
  const weighted = accounts
    .map((account) => {
      const value = toNumber(account[key]);
      const nav = toNumber(account.netLiquidation);
      return value === null || nav === null ? null : { value, nav: Math.abs(nav) };
    })
    .filter((entry): entry is { value: number; nav: number } => Boolean(entry));
  const denominator = weighted.reduce((sum, entry) => sum + entry.nav, 0);
  if (!weighted.length || denominator <= 0) {
    return null;
  }
  return (
    weighted.reduce((sum, entry) => sum + entry.value * entry.nav, 0) /
    denominator
  );
}

async function getLiveAccountUniverse(
  accountId: string,
  mode: RuntimeMode,
): Promise<AccountUniverse> {
  const accounts = await getIbkrClient()
    .listAccounts(mode)
    .catch(() => [] as BrokerAccountSnapshot[]);
  const requestedAccountId = accountId || COMBINED_ACCOUNT_ID;
  const isCombined = requestedAccountId === COMBINED_ACCOUNT_ID;
  const selectedAccounts = isCombined
    ? accounts
    : accounts.filter((account) => account.id === requestedAccountId);

  if (!selectedAccounts.length) {
    const flexAccounts = await getFlexBackedAccounts(requestedAccountId, mode);
    if (flexAccounts.length) {
      return {
        requestedAccountId,
        accountIds: flexAccounts.map((account) => account.id),
        isCombined,
        accounts: flexAccounts,
        primaryCurrency: currencyOf(flexAccounts),
      };
    }

    throw new HttpError(404, `Account "${requestedAccountId}" was not found.`, {
      code: "account_not_found",
      expose: true,
    });
  }

  return {
    requestedAccountId,
    accountIds: selectedAccounts.map((account) => account.id),
    isCombined,
    accounts: selectedAccounts,
    primaryCurrency: currencyOf(selectedAccounts),
  };
}

async function getFlexBackedAccounts(
  requestedAccountId: string,
  mode: RuntimeMode,
): Promise<BrokerAccountSnapshot[]> {
  const navRows = await db
    .select({
      providerAccountId: flexNavHistoryTable.providerAccountId,
      currency: flexNavHistoryTable.currency,
      statementDate: flexNavHistoryTable.statementDate,
      netAssetValue: flexNavHistoryTable.netAssetValue,
    })
    .from(flexNavHistoryTable)
    .orderBy(desc(flexNavHistoryTable.statementDate))
    .limit(250);

  const latestByAccount = new Map();
  navRows.forEach((row) => {
    if (
      requestedAccountId !== COMBINED_ACCOUNT_ID &&
      row.providerAccountId !== requestedAccountId
    ) {
      return;
    }
    if (!latestByAccount.has(row.providerAccountId)) {
      latestByAccount.set(row.providerAccountId, row);
    }
  });

  return Array.from(latestByAccount.values()).map((row) => ({
    id: row.providerAccountId,
    providerAccountId: row.providerAccountId,
    provider: "ibkr",
    mode,
    displayName: `IBKR ${row.providerAccountId}`,
    currency: row.currency,
    buyingPower: 0,
    cash: 0,
    netLiquidation: toNumber(row.netAssetValue) ?? 0,
    accountType: inferAccountType(row.providerAccountId),
    totalCashValue: null,
    settledCash: null,
    accruedCash: null,
    initialMargin: null,
    maintenanceMargin: null,
    excessLiquidity: null,
    cushion: null,
    sma: null,
    dayTradingBuyingPower: null,
    regTInitialMargin: null,
    grossPositionValue: null,
    leverage: null,
    dayTradesRemaining: null,
    isPatternDayTrader: null,
    updatedAt: dateFromDateOnly(row.statementDate),
  }));
}

async function listPositionsForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<BrokerPositionSnapshot[]> {
  if (!universe.isCombined && universe.accountIds[0]) {
    return getIbkrClient().listPositions({
      accountId: universe.accountIds[0],
      mode,
    });
  }

  const positions = await Promise.all(
    universe.accountIds.map((accountId) =>
      getIbkrClient().listPositions({ accountId, mode }),
    ),
  );
  return positions.flat();
}

async function listOrdersForUniverse(
  universe: AccountUniverse,
  mode: RuntimeMode,
): Promise<BrokerOrderSnapshot[]> {
  const orders = await Promise.all(
    universe.accountIds.map((accountId) =>
      getIbkrClient().listOrders({ accountId, mode }),
    ),
  );
  return orders.flat();
}

async function listExecutionsForUniverse(
  universe: AccountUniverse,
  options: {
    days?: number;
    limit?: number;
    symbol?: string;
  },
): Promise<BrokerExecutionSnapshot[]> {
  const executions = await Promise.all(
    universe.accountIds.map((accountId) =>
      getIbkrClient().listExecutions({
        accountId,
        days: options.days,
        limit: options.limit,
        symbol: options.symbol,
      }),
    ),
  );
  return executions.flat();
}

function terminalOrderStatus(status: BrokerOrderSnapshot["status"]): boolean {
  return (
    status === "filled" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "expired"
  );
}

function workingOrderStatus(status: BrokerOrderSnapshot["status"]): boolean {
  return !terminalOrderStatus(status);
}

function normalizeAssetClassLabel(position: BrokerPositionSnapshot): string {
  if (position.assetClass === "option") {
    return "Options";
  }
  if (ETF_SYMBOLS.has(position.symbol.toUpperCase())) {
    return "ETF";
  }
  return "Stocks";
}

function sectorForSymbol(symbol: string): string {
  return STATIC_SECTOR_BY_SYMBOL[symbol.toUpperCase()] ?? "Unknown";
}

function betaForSymbol(symbol: string): number {
  return BETA_BY_SYMBOL[symbol.toUpperCase()] ?? 1;
}

function weightPercent(value: number, nav: number | null): number | null {
  if (!nav || nav === 0) {
    return null;
  }
  return (value / nav) * 100;
}

function exposureSummary(positions: BrokerPositionSnapshot[]) {
  const grossLong = positions
    .filter((position) => position.marketValue > 0)
    .reduce((sum, position) => sum + position.marketValue, 0);
  const grossShort = Math.abs(
    positions
      .filter((position) => position.marketValue < 0)
      .reduce((sum, position) => sum + position.marketValue, 0),
  );
  const netExposure = positions.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );

  return {
    grossLong,
    grossShort,
    netExposure,
  };
}

function xmlDecode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = attributePattern.exec(raw);

  while (match) {
    attributes[match[1]] = xmlDecode(match[3] ?? match[4] ?? "");
    match = attributePattern.exec(raw);
  }

  return attributes;
}

function extractFlexRecords(xml: string, tagNames: string[]): FlexRecord[] {
  const tags = tagNames.join("|");
  const pattern = new RegExp(
    `<(${tags})\\b([^>]*?)(?:/>|>[\\s\\S]*?</\\1>)`,
    "gi",
  );
  const records: FlexRecord[] = [];
  let match = pattern.exec(xml);

  while (match) {
    records.push({
      tag: match[1],
      attributes: parseXmlAttributes(match[2] ?? ""),
    });
    match = pattern.exec(xml);
  }

  return records;
}

function extractTagText(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? xmlDecode(match[1].trim()) : null;
}

function getFlexConfig(): { token: string; queryId: string } | null {
  const token = process.env["IBKR_FLEX_TOKEN"]?.trim();
  const queryId = process.env["IBKR_FLEX_QUERY_ID"]?.trim();
  return token && queryId ? { token, queryId } : null;
}

function flexConfigured(): boolean {
  return Boolean(getFlexConfig());
}

async function fetchFlexEndpoint(
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const endpoint = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    endpoint.searchParams.set(key, value);
  });

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "RayAlgo Account Flex Client/1.0",
      Accept: "application/xml,text/xml,*/*",
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new HttpError(
      response.status,
      `IBKR Flex request failed with HTTP ${response.status}.`,
      {
        code: "ibkr_flex_http_error",
        detail: text.slice(0, 500),
        expose: response.status < 500,
      },
    );
  }

  return text;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestFlexReference(config: {
  token: string;
  queryId: string;
}): Promise<{ referenceCode: string; statementUrl: string | null; rawXml: string }> {
  const rawXml = await fetchFlexEndpoint(FLEX_SEND_REQUEST_URL, {
    t: config.token,
    q: config.queryId,
    v: "3",
  });
  const status = extractTagText(rawXml, "Status");
  const referenceCode =
    extractTagText(rawXml, "ReferenceCode") ??
    extractTagText(rawXml, "Reference") ??
    "";
  const statementUrl = extractTagText(rawXml, "Url");

  if (!referenceCode) {
    throw new HttpError(502, "IBKR Flex did not return a reference code.", {
      code: "ibkr_flex_missing_reference",
      detail: rawXml.slice(0, 500),
    });
  }

  if (status && !/^success$/i.test(status)) {
    throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
      code: "ibkr_flex_request_rejected",
      detail: rawXml.slice(0, 500),
    });
  }

  return { referenceCode, statementUrl, rawXml };
}

async function downloadFlexStatement(input: {
  token: string;
  referenceCode: string;
  statementUrl?: string | null;
  maxPolls?: number;
  pollIntervalMs?: number;
}): Promise<string> {
  const maxPolls = input.maxPolls ?? FLEX_MAX_POLLS;
  const pollIntervalMs = input.pollIntervalMs ?? FLEX_POLL_INTERVAL_MS;
  let lastXml = "";

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const rawXml = await fetchFlexEndpoint(
      input.statementUrl || FLEX_GET_STATEMENT_URL,
      {
        t: input.token,
        q: input.referenceCode,
        v: "3",
      },
    );
    lastXml = rawXml;

    if (/<FlexStatements?\b/i.test(rawXml) || /<Trade\b/i.test(rawXml)) {
      return rawXml;
    }

    const status = extractTagText(rawXml, "Status");
    const errorCode = extractTagText(rawXml, "ErrorCode");

    if (
      status &&
      /^fail|error$/i.test(status) &&
      !["1018", "1001", "1002"].includes(errorCode ?? "")
    ) {
      throw new HttpError(502, `IBKR Flex returned status "${status}".`, {
        code: "ibkr_flex_statement_failed",
        detail: rawXml.slice(0, 500),
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new HttpError(504, "IBKR Flex report was not ready before timeout.", {
    code: "ibkr_flex_timeout",
    detail: lastXml.slice(0, 500),
  });
}

async function upsertFlexReport(xml: string, runId: string): Promise<{
  navRows: number;
  trades: number;
  cashActivities: number;
  dividends: number;
  openPositions: number;
}> {
  const navRecords = extractFlexRecords(xml, [
    "ChangeInNAV",
    "NetAssetValue",
    "NAV",
    "EquitySummary",
    "EquitySummaryByReportDateInBase",
  ]);
  const tradeRecords = extractFlexRecords(xml, ["Trade"]);
  const cashRecords = extractFlexRecords(xml, [
    "CashTransaction",
    "CashReport",
    "DepositWithdraw",
  ]);
  const dividendRecords = cashRecords.filter((record) => {
    const type = firstString(record.attributes, ["type", "activityType"]) ?? "";
    const description = firstString(record.attributes, ["description"]) ?? "";
    return /dividend/i.test(`${type} ${description}`);
  });
  const openPositionRecords = extractFlexRecords(xml, ["OpenPosition"]);

  const navValues = navRecords.flatMap((record) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const statementDate =
      parseDate(firstString(attrs, ["date", "reportDate", "toDate", "asOfDate"])) ??
      null;
    const netAssetValue = firstNumber(attrs, [
      "netAssetValue",
      "endingValue",
      "total",
      "totalEquity",
      "value",
      "endingNAV",
    ]);

    if (!statementDate || netAssetValue === null) {
      return [];
    }

    return [
      {
        providerAccountId,
        statementDate: formatDateOnly(statementDate),
        currency: firstString(attrs, ["currency", "currencyPrimary"]) ?? "USD",
        netAssetValue: String(netAssetValue),
        cash: numericString(firstNumber(attrs, ["cash", "cashValue"])),
        securities: numericString(
          firstNumber(attrs, ["securities", "stockValue", "positionValue"]),
        ),
        deposits: numericString(
          firstNumber(attrs, [
            "deposits",
            "depositsWithdrawals",
            "depositsAndWithdrawals",
          ]),
        ),
        withdrawals: numericString(firstNumber(attrs, ["withdrawals"])),
        dividends: numericString(firstNumber(attrs, ["dividends"])),
        fees: numericString(
          firstNumber(attrs, ["fees", "commissions", "advisorFees"]),
        ),
        realizedPnl: numericString(
          firstNumber(attrs, ["realizedPnl", "realizedPnL", "fifoPnlRealized"]),
        ),
        changeInNav: numericString(firstNumber(attrs, ["change", "changeInNAV"])),
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (navValues.length) {
    await db
      .insert(flexNavHistoryTable)
      .values(navValues)
      .onConflictDoUpdate({
        target: [
          flexNavHistoryTable.providerAccountId,
          flexNavHistoryTable.statementDate,
          flexNavHistoryTable.currency,
        ],
        set: {
          netAssetValue: sql`excluded.net_asset_value`,
          cash: sql`excluded.cash`,
          securities: sql`excluded.securities`,
          deposits: sql`excluded.deposits`,
          withdrawals: sql`excluded.withdrawals`,
          dividends: sql`excluded.dividends`,
          fees: sql`excluded.fees`,
          realizedPnl: sql`excluded.realized_pnl`,
          changeInNav: sql`excluded.change_in_nav`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const tradeValues = tradeRecords.flatMap((record, index) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const symbol =
      normalizeSymbol(
        firstString(attrs, ["symbol", "underlyingSymbol", "conid"]) ?? "",
      ) || "UNKNOWN";
    const tradeDate =
      parseDate(
        [
          firstString(attrs, ["tradeDate", "date"]),
          firstString(attrs, ["tradeTime"]),
        ]
          .filter(Boolean)
          .join(" "),
      ) ?? parseDate(firstString(attrs, ["dateTime", "when"]));

    if (!tradeDate) {
      return [];
    }

    const tradeId =
      firstString(attrs, ["tradeID", "tradeId", "execID", "ibExecID"]) ??
      `${providerAccountId}:${symbol}:${tradeDate.toISOString()}:${index}`;
    const rawSide =
      firstString(attrs, ["buySell", "side", "transactionType"]) ?? "";
    const side = /^s/i.test(rawSide) ? "sell" : "buy";

    return [
      {
        providerAccountId,
        tradeId,
        symbol,
        description: firstString(attrs, ["description"]),
        assetClass:
          firstString(attrs, ["assetCategory", "assetClass", "secType"]) ??
          "stock",
        side,
        quantity: nonNullNumericString(firstNumber(attrs, ["quantity", "qty"])),
        price: numericString(firstNumber(attrs, ["tradePrice", "price"])),
        amount: numericString(firstNumber(attrs, ["amount", "proceeds"])),
        commission: numericString(
          firstNumber(attrs, ["ibCommission", "commission", "commissions"]),
        ),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        tradeDate,
        settleDate:
          parseDate(firstString(attrs, ["settleDate"])) ? formatDateOnly(parseDate(firstString(attrs, ["settleDate"])) as Date) : null,
        openClose: firstString(attrs, ["openCloseIndicator", "openClose"]),
        realizedPnl: numericString(
          firstNumber(attrs, ["fifoPnlRealized", "realizedPnl", "realizedPnL"]),
        ),
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (tradeValues.length) {
    await db
      .insert(flexTradesTable)
      .values(tradeValues)
      .onConflictDoUpdate({
        target: [flexTradesTable.providerAccountId, flexTradesTable.tradeId],
        set: {
          price: sql`excluded.price`,
          amount: sql`excluded.amount`,
          commission: sql`excluded.commission`,
          realizedPnl: sql`excluded.realized_pnl`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const cashValues = cashRecords.flatMap((record, index) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const amount = firstNumber(attrs, ["amount", "proceeds", "value"]);
    const activityDate =
      parseDate(firstString(attrs, ["dateTime", "date", "reportDate"])) ?? null;

    if (amount === null || !activityDate) {
      return [];
    }

    const description = firstString(attrs, ["description"]) ?? "";
    const activityType =
      firstString(attrs, ["type", "activityType", "transactionType"]) ??
      "cash";
    const activityId =
      firstString(attrs, ["transactionID", "transactionId", "id"]) ??
      `${providerAccountId}:${activityType}:${activityDate.toISOString()}:${amount}:${index}`;

    return [
      {
        providerAccountId,
        activityId,
        activityType,
        description,
        amount: String(amount),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        activityDate,
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (cashValues.length) {
    await db
      .insert(flexCashActivityTable)
      .values(cashValues)
      .onConflictDoUpdate({
        target: [
          flexCashActivityTable.providerAccountId,
          flexCashActivityTable.activityId,
        ],
        set: {
          amount: sql`excluded.amount`,
          description: sql`excluded.description`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const dividendValues = dividendRecords.flatMap((record, index) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const amount = firstNumber(attrs, ["amount", "proceeds", "value"]);
    const paidDate =
      parseDate(firstString(attrs, ["dateTime", "date", "reportDate"])) ?? null;

    if (amount === null || !paidDate) {
      return [];
    }

    const symbol = normalizeSymbol(firstString(attrs, ["symbol"]) ?? "");
    const dividendId =
      firstString(attrs, ["transactionID", "transactionId", "id"]) ??
      `${providerAccountId}:${symbol || "CASH"}:${paidDate.toISOString()}:${amount}:${index}`;

    return [
      {
        providerAccountId,
        dividendId,
        symbol: symbol || null,
        description: firstString(attrs, ["description"]),
        amount: String(amount),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        paidDate,
        exDate:
          parseDate(firstString(attrs, ["exDate"])) ? formatDateOnly(parseDate(firstString(attrs, ["exDate"])) as Date) : null,
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (dividendValues.length) {
    await db
      .insert(flexDividendsTable)
      .values(dividendValues)
      .onConflictDoUpdate({
        target: [
          flexDividendsTable.providerAccountId,
          flexDividendsTable.dividendId,
        ],
        set: {
          amount: sql`excluded.amount`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  const openPositionValues = openPositionRecords.flatMap((record) => {
    const attrs = record.attributes;
    const providerAccountId =
      firstString(attrs, ["accountId", "account", "acctId"]) ?? "UNKNOWN";
    const symbol =
      normalizeSymbol(firstString(attrs, ["symbol", "underlyingSymbol"]) ?? "") ||
      "UNKNOWN";
    const quantity = firstNumber(attrs, ["quantity", "qty", "position"]);
    const asOf =
      parseDate(firstString(attrs, ["reportDate", "date", "asOfDate"])) ??
      new Date();

    if (quantity === null) {
      return [];
    }

    return [
      {
        providerAccountId,
        symbol,
        description: firstString(attrs, ["description"]),
        assetClass:
          firstString(attrs, ["assetCategory", "assetClass", "secType"]) ??
          "stock",
        quantity: String(quantity),
        costBasis: numericString(
          firstNumber(attrs, ["costBasisMoney", "costBasis", "cost"]),
        ),
        marketValue: numericString(firstNumber(attrs, ["marketValue", "value"])),
        currency: firstString(attrs, ["currency"]) ?? "USD",
        asOf,
        sourceRunId: runId,
        raw: attrs,
      },
    ];
  });

  if (openPositionValues.length) {
    await db
      .insert(flexOpenPositionsTable)
      .values(openPositionValues)
      .onConflictDoUpdate({
        target: [
          flexOpenPositionsTable.providerAccountId,
          flexOpenPositionsTable.symbol,
          flexOpenPositionsTable.asOf,
        ],
        set: {
          quantity: sql`excluded.quantity`,
          costBasis: sql`excluded.cost_basis`,
          marketValue: sql`excluded.market_value`,
          raw: sql`excluded.raw`,
          sourceRunId: sql`excluded.source_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  return {
    navRows: navValues.length,
    trades: tradeValues.length,
    cashActivities: cashValues.length,
    dividends: dividendValues.length,
    openPositions: openPositionValues.length,
  };
}

export async function refreshFlexReport(reason = "scheduled"): Promise<{
  ok: boolean;
  runId: string;
  referenceCode: string;
  counts: Awaited<ReturnType<typeof upsertFlexReport>>;
}> {
  const config = getFlexConfig();
  if (!config) {
    throw new HttpError(503, "IBKR Flex is not configured.", {
      code: "ibkr_flex_not_configured",
      detail: "Set IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID.",
      expose: true,
    });
  }

  const [run] = await db
    .insert(flexReportRunsTable)
    .values({
      queryId: config.queryId,
      status: "requested",
      metadata: { reason },
    })
    .returning({ id: flexReportRunsTable.id });

  try {
    const reference = await requestFlexReference(config);
    await db
      .update(flexReportRunsTable)
      .set({
        referenceCode: reference.referenceCode,
        status: "polling",
        rawXml: reference.rawXml,
        updatedAt: new Date(),
      })
      .where(eq(flexReportRunsTable.id, run.id));

    const xml = await downloadFlexStatement({
      token: config.token,
      referenceCode: reference.referenceCode,
      statementUrl: reference.statementUrl,
    });
    const counts = await upsertFlexReport(xml, run.id);

    await db
      .update(flexReportRunsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        rawXml: xml,
        metadata: { reason, counts },
        updatedAt: new Date(),
      })
      .where(eq(flexReportRunsTable.id, run.id));

    return {
      ok: true,
      runId: run.id,
      referenceCode: reference.referenceCode,
      counts,
    };
  } catch (error) {
    await db
      .update(flexReportRunsTable)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        updatedAt: new Date(),
      })
      .where(eq(flexReportRunsTable.id, run.id));
    throw error;
  }
}

export function startAccountFlexRefreshScheduler(): void {
  if (!flexConfigured()) {
    logger.info("IBKR Flex env vars are not configured; daily Flex refresh disabled");
    return;
  }

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(7, 0, 0, 0);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    const timeout = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      refreshFlexReport("scheduled")
        .catch((error) => {
          logger.warn({ err: error }, "Scheduled IBKR Flex refresh failed");
        })
        .finally(scheduleNext);
    }, timeout);
    timer.unref?.();
  };

  scheduleNext();
}

export async function recordAccountSnapshots(
  accounts: BrokerAccountSnapshot[],
): Promise<void> {
  const now = Date.now();
  const dueAccounts = accounts.filter((account) => {
    const last = snapshotWriteTimestamps.get(account.id) ?? 0;
    return now - last >= SNAPSHOT_WRITE_INTERVAL_MS;
  });

  if (!dueAccounts.length) {
    return;
  }

  const mode = dueAccounts[0]?.mode ?? getRuntimeMode();
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      name: "Interactive Brokers Bridge",
      connectionType: "broker",
      brokerProvider: "ibkr",
      mode,
      status: "connected",
      capabilities: ["accounts", "positions", "orders", "executions"],
      isDefault: true,
    })
    .onConflictDoUpdate({
      target: [
        brokerConnectionsTable.connectionType,
        brokerConnectionsTable.mode,
        brokerConnectionsTable.name,
      ],
      set: {
        status: "connected",
        updatedAt: new Date(),
      },
    })
    .returning({ id: brokerConnectionsTable.id });

  for (const account of dueAccounts) {
    const [brokerAccount] = await db
      .insert(brokerAccountsTable)
      .values({
        connectionId: connection.id,
        providerAccountId: account.providerAccountId,
        displayName: account.displayName,
        mode: account.mode,
        baseCurrency: account.currency,
        lastSyncedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: brokerAccountsTable.providerAccountId,
        set: {
          displayName: account.displayName,
          mode: account.mode,
          baseCurrency: account.currency,
          lastSyncedAt: new Date().toISOString(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: brokerAccountsTable.id });

    await db.insert(balanceSnapshotsTable).values({
      accountId: brokerAccount.id,
      currency: account.currency,
      cash: String(account.cash),
      buyingPower: String(account.buyingPower),
      netLiquidation: String(account.netLiquidation),
      maintenanceMargin:
        account.maintenanceMargin === null || account.maintenanceMargin === undefined
          ? null
          : String(account.maintenanceMargin),
      asOf: account.updatedAt ?? new Date(),
    });
    snapshotWriteTimestamps.set(account.id, now);
  }
}

export async function getAccountSummary(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const updatedAt = accountMetricUpdatedAt(universe.accounts) ?? new Date();
  const currency = universe.primaryCurrency;
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const initialNav = await getInitialFlexNav(universe.accountIds);
  const totalPnl = initialNav === null ? null : nav - initialNav;

  const dayPnl = positions.reduce(
    (sum, position) => sum + (position.unrealizedPnl ?? 0),
    0,
  );

  const accountTypes = Array.from(
    new Set(
      universe.accounts
        .map((account) => account.accountType || inferAccountType(account.id))
        .filter(Boolean),
    ),
  );
  const remainingDayTrades = universe.accounts
    .map((account) => account.dayTradesRemaining)
    .filter((value): value is number => isFiniteNumber(value));

  return {
    accountId: universe.requestedAccountId,
    isCombined: universe.isCombined,
    mode,
    currency,
    accounts: universe.accounts.map((account) => ({
      id: account.id,
      displayName: account.displayName,
      currency: account.currency,
      live: true,
      accountType: account.accountType || inferAccountType(account.id),
      updatedAt: account.updatedAt,
    })),
    updatedAt,
    fx: {
      baseCurrency: currency,
      timestamp: updatedAt,
      rates: Object.fromEntries(
        Array.from(new Set(universe.accounts.map((account) => account.currency))).map(
          (accountCurrency) => [accountCurrency, accountCurrency === currency ? 1 : null],
        ),
      ),
      warning:
        new Set(universe.accounts.map((account) => account.currency)).size > 1
          ? "Multiple account currencies detected; non-base conversion requires a bridge FX quote feed."
          : null,
    },
    badges: {
      accountTypes,
      pdt: {
        isPatternDayTrader:
          universe.accounts.some((account) => account.isPatternDayTrader === true) ||
          null,
        dayTradesRemainingThisWeek: remainingDayTrades.length
          ? Math.min(...remainingDayTrades)
          : null,
      },
    },
    metrics: {
      netLiquidation: metric(
        nav,
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "NetLiquidation",
        updatedAt,
      ),
      totalCash: metric(
        sumAccounts(universe.accounts, "totalCashValue") ??
          sumAccounts(universe.accounts, "cash"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "TotalCashValue",
        updatedAt,
      ),
      buyingPower: metric(
        sumAccounts(universe.accounts, "buyingPower"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "BuyingPower",
        updatedAt,
      ),
      marginUsed: metric(
        sumAccounts(universe.accounts, "initialMargin") ??
          sumAccounts(universe.accounts, "maintenanceMargin"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "InitMarginReq",
        updatedAt,
      ),
      maintenanceMargin: metric(
        sumAccounts(universe.accounts, "maintenanceMargin"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "MaintMarginReq",
        updatedAt,
      ),
      maintenanceMarginCushionPercent: metric(
        weightedAccountAverage(universe.accounts, "cushion"),
        null,
        "IBKR_ACCOUNT_SUMMARY",
        "Cushion",
        updatedAt,
      ),
      dayPnl: metric(dayPnl, currency, "IBKR_POSITIONS", "UnrealizedPnL", updatedAt),
      dayPnlPercent: metric(
        nav ? (dayPnl / nav) * 100 : null,
        null,
        "IBKR_POSITIONS",
        "UnrealizedPnL/NetLiquidation",
        updatedAt,
      ),
      totalPnl: metric(totalPnl, currency, "FLEX", "ChangeInNAV", updatedAt),
      totalPnlPercent: metric(
        initialNav && totalPnl !== null ? (totalPnl / initialNav) * 100 : null,
        null,
        "FLEX",
        "ChangeInNAV/InitialNAV",
        updatedAt,
      ),
      settledCash: metric(
        sumAccounts(universe.accounts, "settledCash"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "SettledCash",
        updatedAt,
      ),
      unsettledCash: metric(
        null,
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "UnsettledCash",
        updatedAt,
      ),
      sma: metric(
        sumAccounts(universe.accounts, "sma"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "SMA",
        updatedAt,
      ),
      dayTradingBuyingPower: metric(
        sumAccounts(universe.accounts, "dayTradingBuyingPower"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "DayTradingBuyingPower",
        updatedAt,
      ),
      regTInitialMargin: metric(
        sumAccounts(universe.accounts, "regTInitialMargin"),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "RegTMargin",
        updatedAt,
      ),
      leverage: metric(
        weightedAccountAverage(universe.accounts, "leverage"),
        null,
        "IBKR_ACCOUNT_SUMMARY",
        "Leverage",
        updatedAt,
      ),
      grossPositionValue: metric(
        sumAccounts(universe.accounts, "grossPositionValue") ??
          positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0),
        currency,
        "IBKR_ACCOUNT_SUMMARY",
        "GrossPositionValue",
        updatedAt,
      ),
    },
  };
}

function inferAccountType(accountId: string): string {
  if (/du|paper/i.test(accountId)) {
    return "Paper";
  }
  if (/ira/i.test(accountId)) {
    return "IRA";
  }
  return "Margin";
}

async function getInitialFlexNav(accountIds: string[]): Promise<number | null> {
  if (!accountIds.length) {
    return null;
  }

  const rows = await db
    .select({
      providerAccountId: flexNavHistoryTable.providerAccountId,
      statementDate: flexNavHistoryTable.statementDate,
      netAssetValue: flexNavHistoryTable.netAssetValue,
    })
    .from(flexNavHistoryTable)
    .where(inArray(flexNavHistoryTable.providerAccountId, accountIds))
    .orderBy(flexNavHistoryTable.statementDate)
    .limit(accountIds.length);

  const values = rows
    .map((row) => toNumber(row.netAssetValue))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export async function getAccountEquityHistory(input: {
  accountId: string;
  range?: AccountRange;
  benchmark?: string | null;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const range = normalizeRange(input.range);
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const start = rangeStart(range);
  const flexConditions = [inArray(flexNavHistoryTable.providerAccountId, universe.accountIds)];
  if (start) {
    flexConditions.push(
      gte(flexNavHistoryTable.statementDate, formatDateOnly(start)),
    );
  }

  const flexRows = await db
    .select()
    .from(flexNavHistoryTable)
    .where(and(...flexConditions))
    .orderBy(flexNavHistoryTable.statementDate);

  const snapshotConditions = [
    inArray(brokerAccountsTable.providerAccountId, universe.accountIds),
  ];
  if (start) {
    snapshotConditions.push(gte(balanceSnapshotsTable.asOf, start));
  }

  const snapshotRows = await db
    .select({
      providerAccountId: brokerAccountsTable.providerAccountId,
      asOf: balanceSnapshotsTable.asOf,
      currency: balanceSnapshotsTable.currency,
      netLiquidation: balanceSnapshotsTable.netLiquidation,
    })
    .from(balanceSnapshotsTable)
    .innerJoin(
      brokerAccountsTable,
      eq(balanceSnapshotsTable.accountId, brokerAccountsTable.id),
    )
    .where(and(...snapshotConditions))
    .orderBy(balanceSnapshotsTable.asOf)
    .limit(1000);

  const byTimestamp = new Map<
    string,
    {
      timestamp: Date;
      netLiquidation: number;
      currency: string;
      source: "FLEX" | "LOCAL_LEDGER";
      deposits: number;
      withdrawals: number;
      dividends: number;
      fees: number;
    }
  >();

  flexRows.forEach((row) => {
    const timestamp = dateFromDateOnly(row.statementDate);
    const key = timestamp.toISOString();
    const current = byTimestamp.get(key);
    const netLiquidation = toNumber(row.netAssetValue) ?? 0;
    const deposits = toNumber(row.deposits) ?? 0;
    const withdrawals = toNumber(row.withdrawals) ?? 0;
    const dividends = toNumber(row.dividends) ?? 0;
    const fees = toNumber(row.fees) ?? 0;
    byTimestamp.set(key, {
      timestamp,
      netLiquidation: (current?.netLiquidation ?? 0) + netLiquidation,
      currency: row.currency,
      source: "FLEX",
      deposits: (current?.deposits ?? 0) + deposits,
      withdrawals: (current?.withdrawals ?? 0) + withdrawals,
      dividends: (current?.dividends ?? 0) + dividends,
      fees: (current?.fees ?? 0) + fees,
    });
  });

  snapshotRows.forEach((row) => {
    const key = row.asOf.toISOString();
    const current = byTimestamp.get(key);
    byTimestamp.set(key, {
      timestamp: row.asOf,
      netLiquidation:
        (current?.netLiquidation ?? 0) + (toNumber(row.netLiquidation) ?? 0),
      currency: row.currency,
      source: "LOCAL_LEDGER",
      deposits: current?.deposits ?? 0,
      withdrawals: current?.withdrawals ?? 0,
      dividends: current?.dividends ?? 0,
      fees: current?.fees ?? 0,
    });
  });

  const points = Array.from(byTimestamp.values())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((point, index, rows) => {
      const first = rows[0]?.netLiquidation || point.netLiquidation;
      return {
        timestamp: point.timestamp,
        netLiquidation: point.netLiquidation,
        currency: point.currency,
        source: point.source,
        deposits: point.deposits,
        withdrawals: point.withdrawals,
        dividends: point.dividends,
        fees: point.fees,
        returnPercent: first ? ((point.netLiquidation - first) / first) * 100 : 0,
        benchmarkPercent: null,
      };
    });

  const [lastRun] = await db
    .select()
    .from(flexReportRunsTable)
    .orderBy(desc(flexReportRunsTable.requestedAt))
    .limit(1);

  return {
    accountId: universe.requestedAccountId,
    range,
    currency: universe.primaryCurrency,
    flexConfigured: flexConfigured(),
    lastFlexRefreshAt: lastRun?.completedAt ?? null,
    benchmark: input.benchmark || null,
    points,
    events: points
      .filter(
        (point) =>
          Math.abs(point.deposits) > 0 ||
          Math.abs(point.withdrawals) > 0 ||
          Math.abs(point.dividends) > 0,
      )
      .map((point) => ({
        timestamp: point.timestamp,
        type:
          Math.abs(point.dividends) > 0
            ? "dividend"
            : point.deposits >= Math.abs(point.withdrawals)
              ? "deposit"
              : "withdrawal",
        amount:
          point.dividends || point.deposits || point.withdrawals * -1 || 0,
        currency: point.currency,
        source: "FLEX",
      })),
  };
}

export async function getAccountAllocation(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;

  await upsertTickerReferenceCache(positions);

  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positions.forEach((position) => {
    const assetClass = normalizeAssetClassLabel(position);
    const sector = sectorForSymbol(position.symbol);
    assetBuckets.set(assetClass, (assetBuckets.get(assetClass) ?? 0) + position.marketValue);
    sectorBuckets.set(sector, (sectorBuckets.get(sector) ?? 0) + position.marketValue);
  });

  const cash = sumAccounts(universe.accounts, "cash") ?? 0;
  assetBuckets.set("Cash", (assetBuckets.get("Cash") ?? 0) + cash);

  const bucketRows = (buckets: Map<string, number>) =>
    Array.from(buckets.entries())
      .map(([label, value]) => ({
        label,
        value,
        weightPercent: weightPercent(value, nav),
        source: label === "Cash" ? "IBKR_ACCOUNT_SUMMARY" : "IBKR_POSITIONS",
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    assetClass: bucketRows(assetBuckets),
    sector: bucketRows(sectorBuckets),
    exposure: exposureSummary(positions),
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

async function upsertTickerReferenceCache(
  positions: BrokerPositionSnapshot[],
): Promise<void> {
  const symbols = Array.from(new Set(positions.map((position) => position.symbol)));
  if (!symbols.length) {
    return;
  }

  for (const symbol of symbols) {
    await db
      .insert(tickerReferenceCacheTable)
      .values({
        symbol,
        name: symbol,
        assetClass: ETF_SYMBOLS.has(symbol) ? "ETF" : "Stock",
        sector: sectorForSymbol(symbol),
        beta: String(betaForSymbol(symbol)),
        raw: { source: "static-fallback" },
      })
      .onConflictDoNothing();
  }
}

export async function getAccountPositions(input: {
  accountId: string;
  assetClass?: string | null;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const [positions, orders, lots] = await Promise.all([
    listPositionsForUniverse(universe, mode),
    listOrdersForUniverse(universe, mode),
    getPositionLots(universe.accountIds),
  ]);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const filteredPositions =
    input.assetClass && input.assetClass !== "all"
      ? positions.filter(
          (position) =>
            normalizeAssetClassLabel(position).toLowerCase() ===
            input.assetClass?.toLowerCase(),
        )
      : positions;

  const openOrdersBySymbol = new Map<string, BrokerOrderSnapshot[]>();
  orders.filter((order) => workingOrderStatus(order.status)).forEach((order) => {
    const key = order.symbol.toUpperCase();
    openOrdersBySymbol.set(key, [...(openOrdersBySymbol.get(key) ?? []), order]);
  });

  const lotRowsBySymbol = new Map<string, typeof lots>();
  lots.forEach((lot) => {
    const key = lot.symbol.toUpperCase();
    lotRowsBySymbol.set(key, [...(lotRowsBySymbol.get(key) ?? []), lot]);
  });

  const rows = filteredPositions.map((position) => {
    const marketValue = position.marketValue ?? 0;
    const beta = betaForSymbol(position.symbol);
    return {
      id: position.id,
      accountId: position.accountId,
      accounts: [position.accountId],
      symbol: position.symbol,
      description: position.optionContract
        ? `${position.optionContract.underlying} ${formatDateOnly(position.optionContract.expirationDate)} ${position.optionContract.strike} ${position.optionContract.right}`
        : position.symbol,
      assetClass: normalizeAssetClassLabel(position),
      sector: sectorForSymbol(position.symbol),
      quantity: position.quantity,
      averageCost: position.averagePrice,
      mark: position.marketPrice,
      dayChange: null,
      dayChangePercent: null,
      unrealizedPnl: position.unrealizedPnl,
      unrealizedPnlPercent: position.unrealizedPnlPercent,
      marketValue,
      weightPercent: weightPercent(marketValue, nav),
      betaWeightedDelta: position.assetClass === "option" ? null : marketValue * beta,
      lots: lotRowsBySymbol.get(position.symbol.toUpperCase()) ?? [],
      openOrders: openOrdersBySymbol.get(position.symbol.toUpperCase()) ?? [],
      source: "IBKR_POSITIONS",
    };
  });

  const exposure = exposureSummary(filteredPositions);
  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    positions: rows,
    totals: {
      weightPercent: rows.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: rows.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: exposure.grossLong,
      grossShort: exposure.grossShort,
      netExposure: exposure.netExposure,
    },
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

async function getPositionLots(accountIds: string[]) {
  if (!accountIds.length) {
    return [];
  }

  const rows = await db
    .select({
      providerAccountId: brokerAccountsTable.providerAccountId,
      symbol: instrumentsTable.symbol,
      quantity: positionLotsTable.quantity,
      averageCost: positionLotsTable.averageCost,
      marketPrice: positionLotsTable.marketPrice,
      marketValue: positionLotsTable.marketValue,
      unrealizedPnl: positionLotsTable.unrealizedPnl,
      asOf: positionLotsTable.asOf,
    })
    .from(positionLotsTable)
    .innerJoin(
      brokerAccountsTable,
      eq(positionLotsTable.accountId, brokerAccountsTable.id),
    )
    .innerJoin(
      instrumentsTable,
      eq(positionLotsTable.instrumentId, instrumentsTable.id),
    )
    .where(inArray(brokerAccountsTable.providerAccountId, accountIds))
    .orderBy(desc(positionLotsTable.asOf))
    .limit(500);

  return rows.map((row) => ({
    accountId: row.providerAccountId,
    symbol: row.symbol,
    quantity: toNumber(row.quantity) ?? 0,
    averageCost: toNumber(row.averageCost) ?? 0,
    marketPrice: toNumber(row.marketPrice),
    marketValue: toNumber(row.marketValue),
    unrealizedPnl: toNumber(row.unrealizedPnl),
    asOf: row.asOf,
    source: "LOCAL_LEDGER",
  }));
}

export async function getAccountClosedTrades(input: {
  accountId: string;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
  holdDuration?: string | null;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const conditions = [inArray(flexTradesTable.providerAccountId, universe.accountIds)];
  if (input.from) {
    conditions.push(gte(flexTradesTable.tradeDate, input.from));
  }
  if (input.to) {
    conditions.push(lte(flexTradesTable.tradeDate, input.to));
  }
  if (input.symbol) {
    conditions.push(eq(flexTradesTable.symbol, normalizeSymbol(input.symbol)));
  }

  const flexRows = await db
    .select()
    .from(flexTradesTable)
    .where(and(...conditions))
    .orderBy(desc(flexTradesTable.tradeDate))
    .limit(500);

  const liveExecutions = await listExecutionsForUniverse(universe, {
    days: 7,
    limit: 250,
    symbol: input.symbol ?? undefined,
  }).catch(() => []);

  const trades = [
    ...flexRows.map((row) => ({
      id: row.tradeId,
      source: "FLEX",
      accountId: row.providerAccountId,
      symbol: row.symbol,
      side: row.side,
      assetClass: row.assetClass,
      quantity: toNumber(row.quantity) ?? 0,
      openDate: null,
      closeDate: row.tradeDate,
      avgOpen: null,
      avgClose: toNumber(row.price),
      realizedPnl: toNumber(row.realizedPnl),
      realizedPnlPercent: null,
      holdDurationMinutes: null,
      commissions: toNumber(row.commission),
      currency: row.currency,
    })),
    ...liveExecutions.map((execution) => ({
      id: execution.id,
      source: "LIVE",
      accountId: execution.accountId,
      symbol: execution.symbol,
      side: execution.side,
      assetClass: execution.assetClass,
      quantity: execution.quantity,
      openDate: null,
      closeDate: execution.executedAt,
      avgOpen: null,
      avgClose: execution.price,
      realizedPnl: execution.netAmount,
      realizedPnlPercent: null,
      holdDurationMinutes: null,
      commissions: null,
      currency: universe.primaryCurrency,
    })),
  ].filter((trade) => {
    if (input.pnlSign === "winners") {
      return (trade.realizedPnl ?? 0) > 0;
    }
    if (input.pnlSign === "losers") {
      return (trade.realizedPnl ?? 0) < 0;
    }
    return true;
  });

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    trades,
    summary: {
      count: trades.length,
      winners: trades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length,
      losers: trades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length,
      realizedPnl: trades.reduce(
        (sum, trade) => sum + (trade.realizedPnl ?? 0),
        0,
      ),
      commissions: trades.reduce((sum, trade) => sum + (trade.commissions ?? 0), 0),
    },
    updatedAt: new Date(),
  };
}

export async function getAccountOrders(input: {
  accountId: string;
  tab?: OrderTab;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const tab = normalizeOrderTab(input.tab);
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const orders = await listOrdersForUniverse(universe, mode);
  const filtered = orders.filter((order) =>
    tab === "working" ? workingOrderStatus(order.status) : terminalOrderStatus(order.status),
  );

  return {
    accountId: universe.requestedAccountId,
    tab,
    currency: universe.primaryCurrency,
    orders: filtered.map((order) => ({
      id: order.id,
      accountId: order.accountId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      assetClass: order.assetClass,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce,
      status: order.status,
      placedAt: order.placedAt,
      filledAt: order.status === "filled" ? order.updatedAt : null,
      updatedAt: order.updatedAt,
      averageFillPrice: null,
      commission: null,
      source: "LIVE",
    })),
    updatedAt: new Date(),
  };
}

export async function cancelAccountOrder(input: {
  accountId: string;
  orderId: string;
  confirm?: boolean | null;
}) {
  if (getRuntimeMode() === "live" && input.confirm !== true) {
    throw new HttpError(409, "Live order cancellation requires confirmation.", {
      code: "ibkr_live_cancel_confirmation_required",
      expose: true,
    });
  }

  return getIbkrClient().cancelOrder({
    accountId: input.accountId,
    orderId: input.orderId,
    confirm: input.confirm,
  });
}

export async function getAccountRisk(input: {
  accountId: string;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const positions = await listPositionsForUniverse(universe, mode);
  const nav = sumAccounts(universe.accounts, "netLiquidation") ?? 0;
  const exposure = exposureSummary(positions);
  const sectorMap = new Map<string, number>();
  positions.forEach((position) => {
    const sector = sectorForSymbol(position.symbol);
    sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + position.marketValue);
  });

  const positionRows = positions
    .map((position) => ({
      symbol: position.symbol,
      marketValue: position.marketValue,
      weightPercent: weightPercent(position.marketValue, nav),
      unrealizedPnl: position.unrealizedPnl,
      sector: sectorForSymbol(position.symbol),
    }))
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));

  const rawDelta = positions.reduce((sum, position) => {
    if (position.assetClass === "option") {
      return sum;
    }
    return sum + position.marketValue;
  }, 0);
  const betaWeightedDelta = positions.reduce((sum, position) => {
    if (position.assetClass === "option") {
      return sum;
    }
    return sum + position.marketValue * betaForSymbol(position.symbol);
  }, 0);

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    concentration: {
      topPositions: positionRows.slice(0, 5),
      sectors: Array.from(sectorMap.entries())
        .map(([sector, value]) => ({
          sector,
          value,
          weightPercent: weightPercent(value, nav),
        }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    },
    winnersLosers: {
      todayWinners: positionRows
        .filter((row) => row.unrealizedPnl > 0)
        .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
        .slice(0, 5),
      todayLosers: positionRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
        .slice(0, 5),
      allTimeWinners: positionRows
        .filter((row) => row.unrealizedPnl > 0)
        .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
        .slice(0, 5),
      allTimeLosers: positionRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
        .slice(0, 5),
    },
    margin: {
      leverageRatio: nav ? exposure.netExposure / nav : null,
      marginUsed: sumAccounts(universe.accounts, "initialMargin"),
      marginAvailable: sumAccounts(universe.accounts, "excessLiquidity"),
      maintenanceMargin: sumAccounts(universe.accounts, "maintenanceMargin"),
      maintenanceCushionPercent: weightedAccountAverage(universe.accounts, "cushion"),
      dayTradingBuyingPower: sumAccounts(universe.accounts, "dayTradingBuyingPower"),
      sma: sumAccounts(universe.accounts, "sma"),
      regTInitialMargin: sumAccounts(universe.accounts, "regTInitialMargin"),
      pdtDayTradeCount: null,
      providerFields: {
        marginUsed: "InitMarginReq",
        marginAvailable: "ExcessLiquidity",
        maintenanceMargin: "MaintMarginReq",
        maintenanceCushionPercent: "Cushion",
        dayTradingBuyingPower: "DayTradingBuyingPower",
        sma: "SMA",
        regTInitialMargin: "RegTMargin",
      },
    },
    greeks: {
      delta: rawDelta,
      betaWeightedDelta,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      source: "IBKR_POSITIONS",
      warning:
        positions.some((position) => position.assetClass === "option")
          ? "Option position Greeks require quote-derived fields; unavailable rows are shown as null."
          : null,
    },
    expiryConcentration: buildExpiryConcentration(positions),
    updatedAt: accountMetricUpdatedAt(universe.accounts) ?? new Date(),
  };
}

function buildExpiryConcentration(positions: BrokerPositionSnapshot[]) {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  };

  positions.forEach((position) => {
    const expiry = position.optionContract?.expirationDate?.getTime?.();
    if (!expiry) {
      return;
    }
    const notional = Math.abs(position.marketValue);
    if (expiry <= week) {
      buckets.thisWeek += notional;
    }
    if (expiry <= month) {
      buckets.thisMonth += notional;
    }
    if (expiry <= ninety) {
      buckets.next90Days += notional;
    }
  });

  return buckets;
}

export async function getAccountCashActivity(input: {
  accountId: string;
  from?: Date | null;
  to?: Date | null;
  mode?: RuntimeMode;
}) {
  const mode = input.mode ?? getRuntimeMode();
  const universe = await getLiveAccountUniverse(input.accountId, mode);
  const conditions = [
    inArray(flexCashActivityTable.providerAccountId, universe.accountIds),
  ];
  if (input.from) {
    conditions.push(gte(flexCashActivityTable.activityDate, input.from));
  }
  if (input.to) {
    conditions.push(lte(flexCashActivityTable.activityDate, input.to));
  }

  const [activities, dividends] = await Promise.all([
    db
      .select()
      .from(flexCashActivityTable)
      .where(and(...conditions))
      .orderBy(desc(flexCashActivityTable.activityDate))
      .limit(200),
    db
      .select()
      .from(flexDividendsTable)
      .where(inArray(flexDividendsTable.providerAccountId, universe.accountIds))
      .orderBy(desc(flexDividendsTable.paidDate))
      .limit(100),
  ]);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const dividendAmount = (from: Date) =>
    dividends
      .filter((row) => row.paidDate >= from)
      .reduce((sum, row) => sum + (toNumber(row.amount) ?? 0), 0);

  const feeYtd = activities
    .filter((row) => row.activityDate >= yearStart)
    .filter((row) => /fee|commission/i.test(`${row.activityType} ${row.description ?? ""}`))
    .reduce((sum, row) => sum + Math.abs(toNumber(row.amount) ?? 0), 0);

  return {
    accountId: universe.requestedAccountId,
    currency: universe.primaryCurrency,
    settledCash: sumAccounts(universe.accounts, "settledCash"),
    unsettledCash: null,
    totalCash: sumAccounts(universe.accounts, "cash"),
    dividendsMonth: dividendAmount(monthStart),
    dividendsYtd: dividendAmount(yearStart),
    interestPaidEarnedYtd: activities
      .filter((row) => row.activityDate >= yearStart)
      .filter((row) => /interest/i.test(`${row.activityType} ${row.description ?? ""}`))
      .reduce((sum, row) => sum + (toNumber(row.amount) ?? 0), 0),
    feesYtd: feeYtd,
    activities: activities.map((row) => ({
      id: row.activityId,
      accountId: row.providerAccountId,
      date: row.activityDate,
      type: row.activityType,
      description: row.description,
      amount: toNumber(row.amount) ?? 0,
      currency: row.currency,
      source: "FLEX",
    })),
    dividends: dividends.map((row) => ({
      id: row.dividendId,
      accountId: row.providerAccountId,
      symbol: row.symbol,
      description: row.description,
      paidDate: row.paidDate,
      amount: toNumber(row.amount) ?? 0,
      currency: row.currency,
      source: "FLEX",
    })),
    updatedAt: new Date(),
  };
}

export async function getFlexHealth() {
  const [lastRun] = await db
    .select()
    .from(flexReportRunsTable)
    .orderBy(desc(flexReportRunsTable.requestedAt))
    .limit(1);
  const latestSnapshot = await db
    .select({ asOf: balanceSnapshotsTable.asOf })
    .from(balanceSnapshotsTable)
    .orderBy(desc(balanceSnapshotsTable.asOf))
    .limit(1);

  return {
    bridgeConnected: null,
    flexConfigured: flexConfigured(),
    flexTokenPresent: Boolean(process.env["IBKR_FLEX_TOKEN"]?.trim()),
    flexQueryIdPresent: Boolean(process.env["IBKR_FLEX_QUERY_ID"]?.trim()),
    lastSuccessfulRefreshAt:
      lastRun?.status === "completed" ? lastRun.completedAt : null,
    lastAttemptAt: lastRun?.requestedAt ?? null,
    lastStatus: lastRun?.status ?? null,
    lastError: lastRun?.errorMessage ?? null,
    snapshotsRecording: Boolean(latestSnapshot[0]),
    lastSnapshotAt: latestSnapshot[0]?.asOf ?? null,
  };
}

export async function testFlexToken() {
  const result = await refreshFlexReport("manual-test");
  return {
    message: "Flex report pulled and normalized successfully.",
    ...result,
  };
}
