import {
  asArray,
  asNumber,
  asRecord,
  asString,
  findCaseInsensitiveValue,
  firstDefined,
  normalizeSymbol,
  toDate,
  toIsoDateString,
} from "../../lib/values";
import { fetchJson, withSearchParams, type QueryValue } from "../../lib/http";
import type { FmpRuntimeConfig } from "../../lib/runtime";

export type ResearchFundamentals = {
  symbol: string;
  revenueTTM: number | null;
  grossMarginTTM: number | null;
  netMarginTTM: number | null;
  operMarginTTM: number | null;
  roeTTM: number | null;
  debtToEquity: number | null;
  evToEBITDA: number | null;
  priceToSales: number | null;
  beta: number | null;
  sector: string | null;
  industry: string | null;
  ceo: string | null;
};

export type ResearchSnapshot = {
  symbol: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePercent: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  mc: number | null;
  pe: number | null;
  eps: number | null;
  sharesOut: number | null;
};

export type ResearchIncomeStatementPeriod = {
  rev: number | null;
  cogs: number | null;
  grossProfit: number | null;
  rd: number | null;
  sga: number | null;
  da: number | null;
  totalOpex: number | null;
  opIncome: number | null;
  intExp: number | null;
  otherInc: number | null;
  preTax: number | null;
  tax: number | null;
  netIncome: number | null;
  eps: number | null;
};

export type ResearchBalanceSheetPeriod = {
  ca: number | null;
  cashSTI: number | null;
  cash: number | null;
  sti: number | null;
  recv: number | null;
  inv: number | null;
  invFG: number | null;
  invWIP: number | null;
  invRM: number | null;
  prepaid: number | null;
  ta: number | null;
  ppe: number | null;
  gw: number | null;
  otherLT: number | null;
  cl: number | null;
  ap: number | null;
  stDebt: number | null;
  accrued: number | null;
  ltDebt: number | null;
  tl: number | null;
  equity: number | null;
  tlse: number | null;
};

export type ResearchCashFlowPeriod = {
  netIncome: number | null;
  da: number | null;
  sbc: number | null;
  wcImpact: number | null;
  cfo: number | null;
  capex: number | null;
  cfi: number | null;
  divPaid: number | null;
  buybacks: number | null;
  debtChg: number | null;
  cff: number | null;
  fcf: number | null;
};

export type ResearchRatiosPeriod = {
  roic: number | null;
  fcfMargin: number | null;
  fcfYield: number | null;
  debtEbitda: number | null;
  netDebt: number | null;
  currentRatio: number | null;
  rdIntensity: number | null;
  capexIntensity: number | null;
  gmPct: number | null;
  opmPct: number | null;
  netMargin: number | null;
  runwayQtrs: number | null;
};

export type ResearchQuarterlyEpsPoint = {
  label: string;
  actual: number | null;
  estimate: number | null;
  beat: boolean | null;
  diff: number | null;
};

export type ResearchAnnualEarningsPoint = {
  year: string;
  earnings: number | null;
  isEstimate: boolean;
};

export type ResearchFinancials = {
  symbol: string;
  years: string[];
  revs: Array<number | null>;
  isData: ResearchIncomeStatementPeriod[];
  bsData: ResearchBalanceSheetPeriod[];
  cfData: ResearchCashFlowPeriod[];
  ratiosData: ResearchRatiosPeriod[];
  qEPS: ResearchQuarterlyEpsPoint[];
  annualEarnings: ResearchAnnualEarningsPoint[];
};

export type ResearchCalendarEntry = {
  symbol: string;
  date: string | null;
  time: string | null;
  epsEstimated: number | null;
  revenueEstimated: number | null;
  fiscalDateEnding: string | null;
};

export type ResearchFiling = {
  symbol: string;
  type: string | null;
  filingDate: string | null;
  acceptedDate: string | null;
  finalLink: string | null;
  link: string | null;
};

export type TranscriptDateEntry = {
  year: number | null;
  quarter: number | null;
  date: string | null;
};

export type TranscriptEntry = {
  symbol: string;
  quarter: number | null;
  year: number | null;
  date: string | null;
  content: string | null;
};

const FMP_PROVIDER_SYMBOLS: Record<string, string> = {
  IQE: "IQE.L",
  SOI: "SOI.PA",
  SIVE: "SIVE.ST",
  SKHYNIX: "000660.KS",
  SAMSUNG: "005930.KS",
};

const FMP_PROVIDER_SYMBOLS_REVERSE = Object.fromEntries(
  Object.entries(FMP_PROVIDER_SYMBOLS).map(([internalSymbol, providerSymbol]) => [
    providerSymbol,
    internalSymbol,
  ]),
);

function round(value: number | null, digits: number): number | null {
  if (value === null) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function normalizePercent(value: unknown): number | null {
  const numeric = asNumber(value);

  if (numeric === null) {
    return null;
  }

  return Math.abs(numeric) <= 1 ? round(numeric * 100, 1) : round(numeric, 1);
}

function normalizeMillions(value: unknown, digits = 1): number | null {
  const numeric = asNumber(value);

  if (numeric === null) {
    return null;
  }

  return round(numeric / 1_000_000, digits);
}

function getField(record: Record<string, unknown> | null, key: string): unknown {
  if (!record) {
    return undefined;
  }

  const direct = record[key];
  if (direct !== undefined) {
    return direct;
  }

  return findCaseInsensitiveValue(record, key);
}

function getFieldNumber(
  record: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const numeric = asNumber(getField(record, key));
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function getStatementMillions(
  record: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  const numeric = getFieldNumber(record, ...keys);
  return numeric === null ? null : round(numeric / 1_000_000, 1);
}

function toQuarterLabel(value: unknown): string {
  const date = toDate(value);

  if (!date) {
    return "Quarter";
  }

  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${quarter} '${String(date.getUTCFullYear()).slice(2)}`;
}

function toAnnualLabel(record: Record<string, unknown> | null): string {
  const fiscalYear = asString(getField(record, "fiscalYear"));

  if (fiscalYear) {
    return fiscalYear;
  }

  const date = toDate(getField(record, "date"));
  return date ? String(date.getUTCFullYear()) : "Period";
}

function statementSortKey(record: Record<string, unknown> | null): number {
  const date = toDate(getField(record, "date"));
  return date ? date.getTime() : 0;
}

function sumPeriodValues(values: Array<number | null>, digits = 1): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));

  if (finite.length === 0) {
    return null;
  }

  return round(finite.reduce((sum, value) => sum + value, 0), digits);
}

function latestPeriodValue(values: Array<number | null>): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];

    if (value !== null && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function mapIncomeStatementPeriod(
  record: Record<string, unknown> | null,
): ResearchIncomeStatementPeriod {
  const revenue = getStatementMillions(record, "revenue");
  const costOfRevenue = getStatementMillions(record, "costOfRevenue");
  const grossProfit = firstDefined(
    getStatementMillions(record, "grossProfit"),
    revenue !== null && costOfRevenue !== null ? round(revenue - costOfRevenue, 1) : null,
  );
  const rd = getStatementMillions(record, "researchAndDevelopmentExpenses");
  const sga = firstDefined(
    getStatementMillions(
      record,
      "sellingGeneralAndAdministrativeExpenses",
      "sellingAndMarketingExpenses",
    ),
    getStatementMillions(record, "generalAndAdministrativeExpenses"),
  );
  const da = getStatementMillions(record, "depreciationAndAmortization");
  const totalOpex = firstDefined(
    getStatementMillions(record, "operatingExpenses"),
    sumPeriodValues([rd, sga, da]),
  );
  const opIncome = firstDefined(
    getStatementMillions(record, "operatingIncome", "ebit"),
    grossProfit !== null && totalOpex !== null ? round(grossProfit - totalOpex, 1) : null,
  );
  const intExp = getStatementMillions(record, "interestExpense");
  const otherInc = firstDefined(
    getStatementMillions(
      record,
      "totalOtherIncomeExpensesNet",
      "nonOperatingIncomeExcludingInterest",
      "otherNonOperatingIncomeExpenses",
    ),
    getStatementMillions(record, "otherExpenses"),
  );
  const preTax = firstDefined(
    getStatementMillions(record, "incomeBeforeTax"),
    sumPeriodValues([opIncome, otherInc, intExp !== null ? -intExp : null]),
  );
  const tax = getStatementMillions(record, "incomeTaxExpense");
  const netIncome = firstDefined(
    getStatementMillions(
      record,
      "netIncome",
      "netIncomeFromContinuingOperations",
      "bottomLineNetIncome",
    ),
    preTax !== null && tax !== null ? round(preTax - tax, 1) : null,
  );

  return {
    rev: revenue,
    cogs: costOfRevenue,
    grossProfit,
    rd,
    sga,
    da,
    totalOpex,
    opIncome,
    intExp,
    otherInc,
    preTax,
    tax,
    netIncome,
    eps: round(getFieldNumber(record, "eps", "epsDiluted"), 2),
  };
}

function mapBalanceSheetPeriod(
  record: Record<string, unknown> | null,
): ResearchBalanceSheetPeriod {
  const cash = getStatementMillions(record, "cashAndCashEquivalents");
  const sti = getStatementMillions(record, "shortTermInvestments");
  const cashSTI = firstDefined(
    getStatementMillions(record, "cashAndShortTermInvestments"),
    sumPeriodValues([cash, sti]),
  );
  const recv = getStatementMillions(
    record,
    "netReceivables",
    "accountsReceivables",
    "accountReceivables",
  );
  const invFG = getStatementMillions(record, "finishedGoods");
  const invWIP = getStatementMillions(record, "workInProcess");
  const invRM = getStatementMillions(record, "rawMaterials");
  const inv = firstDefined(
    getStatementMillions(record, "inventory", "totalInventory"),
    sumPeriodValues([invFG, invWIP, invRM]),
  );
  const prepaid = getStatementMillions(
    record,
    "prepaids",
    "prepaidExpenses",
    "otherCurrentAssets",
  );
  const ca = firstDefined(
    getStatementMillions(record, "totalCurrentAssets"),
    sumPeriodValues([cashSTI, recv, inv, prepaid]),
  );
  const ppe = getStatementMillions(
    record,
    "propertyPlantEquipmentNet",
    "propertyPlantAndEquipmentNet",
  );
  const gw = firstDefined(
    getStatementMillions(record, "goodwillAndIntangibleAssets"),
    sumPeriodValues([
      getStatementMillions(record, "goodwill"),
      getStatementMillions(record, "intangibleAssets"),
    ]),
  );
  const otherLT = getStatementMillions(
    record,
    "otherNonCurrentAssets",
    "otherAssets",
  );
  const ta = firstDefined(
    getStatementMillions(record, "totalAssets"),
    sumPeriodValues([ca, ppe, gw, otherLT]),
  );
  const ap = getStatementMillions(
    record,
    "accountPayables",
    "accountsPayable",
  );
  const stDebt = getStatementMillions(record, "shortTermDebt");
  const accrued = getStatementMillions(
    record,
    "accruedExpenses",
    "otherCurrentLiabilities",
  );
  const cl = firstDefined(
    getStatementMillions(record, "totalCurrentLiabilities"),
    sumPeriodValues([ap, stDebt, accrued]),
  );
  const totalDebt = getStatementMillions(record, "totalDebt");
  const ltDebt = firstDefined(
    getStatementMillions(record, "longTermDebt"),
    totalDebt !== null && stDebt !== null ? round(totalDebt - stDebt, 1) : totalDebt,
  );
  const tl = firstDefined(
    getStatementMillions(record, "totalLiabilities"),
    sumPeriodValues([cl, ltDebt, getStatementMillions(record, "otherNonCurrentLiabilities")]),
  );
  const equity = firstDefined(
    getStatementMillions(record, "totalStockholdersEquity"),
    getStatementMillions(record, "totalEquity"),
  );
  const tlse = firstDefined(
    getStatementMillions(record, "totalLiabilitiesAndStockholdersEquity"),
    sumPeriodValues([tl, equity]),
  );

  return {
    ca,
    cashSTI,
    cash,
    sti,
    recv,
    inv,
    invFG,
    invWIP,
    invRM,
    prepaid,
    ta,
    ppe,
    gw,
    otherLT,
    cl,
    ap,
    stDebt,
    accrued,
    ltDebt,
    tl,
    equity,
    tlse,
  };
}

function mapCashFlowPeriod(
  record: Record<string, unknown> | null,
  incomeStatement: ResearchIncomeStatementPeriod | null = null,
): ResearchCashFlowPeriod {
  const da = firstDefined(
    getStatementMillions(record, "depreciationAndAmortization"),
    incomeStatement?.da ?? null,
  );
  const netIncome = firstDefined(
    getStatementMillions(record, "netIncome"),
    incomeStatement?.netIncome ?? null,
  );
  const sbc = getStatementMillions(record, "stockBasedCompensation");
  const cfo = firstDefined(
    getStatementMillions(
      record,
      "netCashProvidedByOperatingActivities",
      "netCashProvidedByOperatingActivites",
      "operatingCashFlow",
    ),
    null,
  );
  const capex = firstDefined(
    getStatementMillions(record, "capitalExpenditure", "investmentsInPropertyPlantAndEquipment"),
    null,
  );
  const cfi = getStatementMillions(
    record,
    "netCashUsedForInvestingActivites",
    "netCashUsedForInvestingActivities",
  );
  const divPaid = getStatementMillions(record, "dividendsPaid", "commonDividendsPaid");
  const buybacks = getStatementMillions(
    record,
    "commonStockRepurchased",
    "commonStockRepurchases",
  );
  const debtChg = firstDefined(
    getStatementMillions(
      record,
      "netDebtIssuance",
      "longTermNetDebtIssuance",
    ),
    sumPeriodValues([
      getStatementMillions(record, "shortTermNetDebtIssuance"),
      getStatementMillions(record, "longTermNetDebtIssuance"),
    ]),
  );
  const cff = getStatementMillions(
    record,
    "netCashUsedProvidedByFinancingActivities",
    "netCashUsedForFinancingActivites",
    "netCashUsedForFinancingActivities",
  );
  const fcf = firstDefined(
    getStatementMillions(record, "freeCashFlow"),
    sumPeriodValues([cfo, capex]),
  );
  const wcImpact = firstDefined(
    getStatementMillions(record, "changeInWorkingCapital"),
    cfo !== null && netIncome !== null
      ? round(cfo - netIncome - (da ?? 0) - (sbc ?? 0), 1)
      : null,
  );

  return {
    netIncome,
    da,
    sbc,
    wcImpact,
    cfo,
    capex,
    cfi,
    divPaid,
    buybacks,
    debtChg,
    cff,
    fcf,
  };
}

function buildRatiosPeriod(input: {
  income: ResearchIncomeStatementPeriod;
  balance: ResearchBalanceSheetPeriod;
  cashFlow: ResearchCashFlowPeriod;
}): ResearchRatiosPeriod {
  const { income, balance, cashFlow } = input;
  const revenue = income.rev;
  const totalDebt = sumPeriodValues([balance.ltDebt, balance.stDebt]);
  const ebitda =
    income.opIncome !== null || income.da !== null
      ? round((income.opIncome ?? 0) + (income.da ?? 0), 1)
      : null;
  const taxRate =
    income.preTax !== null && income.preTax > 0 && income.tax !== null
      ? Math.min(Math.max(income.tax / income.preTax, 0), 1)
      : 0.21;
  const nopat = income.opIncome !== null ? round(income.opIncome * (1 - taxRate), 1) : null;
  const investedCapital = sumPeriodValues([balance.equity, balance.ltDebt]);

  return {
    roic:
      nopat !== null && investedCapital !== null && investedCapital > 0
        ? round((nopat / investedCapital) * 100, 1)
        : null,
    fcfMargin:
      cashFlow.fcf !== null && revenue !== null && revenue > 0
        ? round((cashFlow.fcf / revenue) * 100, 1)
        : null,
    fcfYield: null,
    debtEbitda:
      totalDebt !== null && ebitda !== null && ebitda > 0
        ? round(totalDebt / ebitda, 1)
        : null,
    netDebt:
      totalDebt !== null || balance.cashSTI !== null
        ? round((totalDebt ?? 0) - (balance.cashSTI ?? 0), 1)
        : null,
    currentRatio:
      balance.ca !== null && balance.cl !== null && balance.cl > 0
        ? round(balance.ca / balance.cl, 2)
        : null,
    rdIntensity:
      income.rd !== null && revenue !== null && revenue > 0
        ? round((income.rd / revenue) * 100, 1)
        : null,
    capexIntensity:
      cashFlow.capex !== null && revenue !== null && revenue > 0
        ? round((Math.abs(cashFlow.capex) / revenue) * 100, 1)
        : null,
    gmPct:
      income.grossProfit !== null && revenue !== null && revenue > 0
        ? round((income.grossProfit / revenue) * 100, 1)
        : null,
    opmPct:
      income.opIncome !== null && revenue !== null && revenue > 0
        ? round((income.opIncome / revenue) * 100, 1)
        : null,
    netMargin:
      income.netIncome !== null && revenue !== null && revenue > 0
        ? round((income.netIncome / revenue) * 100, 1)
        : null,
    runwayQtrs:
      income.netIncome !== null && income.netIncome < 0 && balance.cashSTI !== null && balance.cashSTI > 0
        ? round(balance.cashSTI / (Math.abs(income.netIncome) / 4), 1)
        : null,
  };
}

function sumIncomeStatementPeriods(
  periods: ResearchIncomeStatementPeriod[],
): ResearchIncomeStatementPeriod {
  return {
    rev: sumPeriodValues(periods.map((period) => period.rev)),
    cogs: sumPeriodValues(periods.map((period) => period.cogs)),
    grossProfit: sumPeriodValues(periods.map((period) => period.grossProfit)),
    rd: sumPeriodValues(periods.map((period) => period.rd)),
    sga: sumPeriodValues(periods.map((period) => period.sga)),
    da: sumPeriodValues(periods.map((period) => period.da)),
    totalOpex: sumPeriodValues(periods.map((period) => period.totalOpex)),
    opIncome: sumPeriodValues(periods.map((period) => period.opIncome)),
    intExp: sumPeriodValues(periods.map((period) => period.intExp)),
    otherInc: sumPeriodValues(periods.map((period) => period.otherInc)),
    preTax: sumPeriodValues(periods.map((period) => period.preTax)),
    tax: sumPeriodValues(periods.map((period) => period.tax)),
    netIncome: sumPeriodValues(periods.map((period) => period.netIncome)),
    eps: sumPeriodValues(periods.map((period) => period.eps), 2),
  };
}

function latestBalanceSheetPeriod(
  periods: ResearchBalanceSheetPeriod[],
): ResearchBalanceSheetPeriod | null {
  return periods.length > 0 ? periods[periods.length - 1] ?? null : null;
}

function sumCashFlowPeriods(periods: ResearchCashFlowPeriod[]): ResearchCashFlowPeriod {
  return {
    netIncome: sumPeriodValues(periods.map((period) => period.netIncome)),
    da: sumPeriodValues(periods.map((period) => period.da)),
    sbc: sumPeriodValues(periods.map((period) => period.sbc)),
    wcImpact: sumPeriodValues(periods.map((period) => period.wcImpact)),
    cfo: sumPeriodValues(periods.map((period) => period.cfo)),
    capex: sumPeriodValues(periods.map((period) => period.capex)),
    cfi: sumPeriodValues(periods.map((period) => period.cfi)),
    divPaid: sumPeriodValues(periods.map((period) => period.divPaid)),
    buybacks: sumPeriodValues(periods.map((period) => period.buybacks)),
    debtChg: sumPeriodValues(periods.map((period) => period.debtChg)),
    cff: sumPeriodValues(periods.map((period) => period.cff)),
    fcf: sumPeriodValues(periods.map((period) => period.fcf)),
  };
}

function normalizeIsoDate(value: unknown): string | null {
  const date = toDate(value);
  return date ? toIsoDateString(date) : null;
}

function getRecordArray(payload: unknown): Record<string, unknown>[] {
  return asArray(payload).flatMap((entry) => {
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}

function mapTranscriptDate(entry: unknown): TranscriptDateEntry | null {
  if (Array.isArray(entry)) {
    return {
      year: asNumber(entry[0]),
      quarter: asNumber(entry[1]),
      date: normalizeIsoDate(entry[2]),
    };
  }

  const record = asRecord(entry);

  if (!record) {
    return null;
  }

  return {
    year: firstDefined(
      asNumber(record["year"]),
      asNumber(record["calendarYear"]),
      asNumber(record["fiscalYear"]),
    ),
    quarter: firstDefined(asNumber(record["quarter"]), asNumber(record["fiscalQuarter"])),
    date: normalizeIsoDate(
      firstDefined(record["date"], record["fillingDate"], record["filingDate"]),
    ),
  };
}

function toProviderSymbol(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  return FMP_PROVIDER_SYMBOLS[normalized] ?? normalized;
}

function fromProviderSymbol(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  return FMP_PROVIDER_SYMBOLS_REVERSE[normalized] ?? normalized;
}

export class FmpResearchClient {
  constructor(private readonly config: FmpRuntimeConfig) {}

  private buildUrl(path: string, params: Record<string, QueryValue> = {}): URL {
    return withSearchParams(`${this.config.baseUrl}${path}`, params);
  }

  private async fetchStable<T>(
    path: string,
    params: Record<string, QueryValue> = {},
  ): Promise<T> {
    return fetchJson<T>(this.buildUrl(path, params), {
      headers: {
        accept: "application/json",
        apikey: this.config.apiKey,
      },
    });
  }

  async getFundamentals(symbol: string): Promise<ResearchFundamentals | null> {
    const normalized = normalizeSymbol(symbol);
    const providerSymbol = toProviderSymbol(normalized);
    const [ratios, metrics, profiles] = await Promise.all([
      this.fetchStable<unknown>("/ratios-ttm", { symbol: providerSymbol }),
      this.fetchStable<unknown>("/key-metrics-ttm", { symbol: providerSymbol }),
      this.fetchStable<unknown>("/profile", { symbol: providerSymbol }),
    ]);

    const ratio = getRecordArray(ratios)[0] ?? null;
    const metric = getRecordArray(metrics)[0] ?? null;
    const profile = getRecordArray(profiles)[0] ?? null;

    if (!ratio && !metric && !profile) {
      return null;
    }

    const marketCap = asNumber(profile?.["mktCap"] ?? profile?.["marketCap"]);
    const price = asNumber(profile?.["price"]);
    const sharesOutstanding = firstDefined(
      asNumber(profile?.["sharesOutstanding"]),
      marketCap !== null && price ? marketCap / price : null,
    );
    const revenuePerShare = asNumber(
      metric?.["revenuePerShareTTM"] ?? metric?.["revenuePerShare"],
    );

    return {
      symbol: normalized,
      revenueTTM:
        revenuePerShare !== null && sharesOutstanding !== null
          ? Math.round((revenuePerShare * sharesOutstanding) / 1_000_000)
          : null,
      grossMarginTTM: normalizePercent(
        ratio?.["grossProfitMarginTTM"] ?? ratio?.["grossProfitMargin"],
      ),
      netMarginTTM: normalizePercent(
        ratio?.["netProfitMarginTTM"] ?? ratio?.["netProfitMargin"],
      ),
      operMarginTTM: normalizePercent(
        ratio?.["operatingProfitMarginTTM"] ?? ratio?.["operatingProfitMargin"],
      ),
      roeTTM: normalizePercent(ratio?.["returnOnEquityTTM"] ?? ratio?.["returnOnEquity"]),
      debtToEquity: round(
        asNumber(ratio?.["debtEquityRatioTTM"] ?? ratio?.["debtEquityRatio"]),
        2,
      ),
      evToEBITDA: round(
        asNumber(
          metric?.["enterpriseValueOverEBITDATTM"] ?? metric?.["enterpriseValueOverEBITDA"],
        ),
        1,
      ),
      priceToSales: round(
        asNumber(metric?.["priceToSalesRatioTTM"] ?? metric?.["priceToSalesRatio"]),
        2,
      ),
      beta: round(asNumber(profile?.["beta"]), 2),
      sector: asString(profile?.["sector"]),
      industry: asString(profile?.["industry"]),
      ceo: asString(profile?.["ceo"]),
    };
  }

  async getFinancials(symbol: string): Promise<ResearchFinancials | null> {
    const normalized = normalizeSymbol(symbol);
    const providerSymbol = toProviderSymbol(normalized);
    const [
      annualIncomePayload,
      annualBalancePayload,
      annualCashPayload,
      quarterlyIncomePayload,
      quarterlyBalancePayload,
      quarterlyCashPayload,
      earningsPayload,
    ] = await Promise.all([
      this.fetchStable<unknown>("/income-statement", { symbol: providerSymbol, limit: 4 }),
      this.fetchStable<unknown>("/balance-sheet-statement", { symbol: providerSymbol, limit: 4 }),
      this.fetchStable<unknown>("/cash-flow-statement", { symbol: providerSymbol, limit: 4 }),
      this.fetchStable<unknown>("/income-statement", {
        symbol: providerSymbol,
        period: "quarter",
        limit: 8,
      }),
      this.fetchStable<unknown>("/balance-sheet-statement", {
        symbol: providerSymbol,
        period: "quarter",
        limit: 4,
      }),
      this.fetchStable<unknown>("/cash-flow-statement", {
        symbol: providerSymbol,
        period: "quarter",
        limit: 8,
      }),
      this.fetchStable<unknown>("/earnings", { symbol: providerSymbol }),
    ]);

    const annualIncomeRecords = getRecordArray(annualIncomePayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-4);
    const annualBalanceRecords = getRecordArray(annualBalancePayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-4);
    const annualCashRecords = getRecordArray(annualCashPayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-4);
    const quarterlyIncomeRecords = getRecordArray(quarterlyIncomePayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-8);
    const quarterlyBalanceRecords = getRecordArray(quarterlyBalancePayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-4);
    const quarterlyCashRecords = getRecordArray(quarterlyCashPayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-8);

    if (
      annualIncomeRecords.length === 0 &&
      annualBalanceRecords.length === 0 &&
      annualCashRecords.length === 0 &&
      quarterlyIncomeRecords.length === 0 &&
      quarterlyBalanceRecords.length === 0 &&
      quarterlyCashRecords.length === 0
    ) {
      return null;
    }

    const annualPeriods = new Map<
      string,
      {
        sortKey: number;
        incomeRecord: Record<string, unknown> | null;
        balanceRecord: Record<string, unknown> | null;
        cashRecord: Record<string, unknown> | null;
      }
    >();

    const registerAnnualRecord = (
      record: Record<string, unknown>,
      kind: "incomeRecord" | "balanceRecord" | "cashRecord",
    ) => {
      const label = toAnnualLabel(record);
      const current = annualPeriods.get(label) ?? {
        sortKey: statementSortKey(record),
        incomeRecord: null,
        balanceRecord: null,
        cashRecord: null,
      };
      current.sortKey = Math.max(current.sortKey, statementSortKey(record));
      current[kind] = record;
      annualPeriods.set(label, current);
    };

    annualIncomeRecords.forEach((record) => registerAnnualRecord(record, "incomeRecord"));
    annualBalanceRecords.forEach((record) => registerAnnualRecord(record, "balanceRecord"));
    annualCashRecords.forEach((record) => registerAnnualRecord(record, "cashRecord"));

    const years: string[] = [];
    const isData: ResearchIncomeStatementPeriod[] = [];
    const bsData: ResearchBalanceSheetPeriod[] = [];
    const cfData: ResearchCashFlowPeriod[] = [];

    Array.from(annualPeriods.entries())
      .sort((left, right) => left[1].sortKey - right[1].sortKey)
      .forEach(([label, period]) => {
        const income = mapIncomeStatementPeriod(period.incomeRecord);
        const balance = mapBalanceSheetPeriod(period.balanceRecord);
        const cashFlow = mapCashFlowPeriod(period.cashRecord, income);

        years.push(label);
        isData.push(income);
        bsData.push(balance);
        cfData.push(cashFlow);
      });

    const quarterlyIncomePeriods = quarterlyIncomeRecords.map((record) =>
      mapIncomeStatementPeriod(record),
    );
    const quarterlyBalancePeriods = quarterlyBalanceRecords.map((record) =>
      mapBalanceSheetPeriod(record),
    );
    const quarterlyCashPeriods = quarterlyCashRecords.map((record) =>
      mapCashFlowPeriod(record),
    );

    if (
      quarterlyIncomePeriods.length > 0 ||
      quarterlyBalancePeriods.length > 0 ||
      quarterlyCashPeriods.length > 0
    ) {
      const ttmIncome = quarterlyIncomePeriods.length
        ? sumIncomeStatementPeriods(quarterlyIncomePeriods.slice(-4))
        : mapIncomeStatementPeriod(null);
      const ttmBalance = latestBalanceSheetPeriod(quarterlyBalancePeriods) ?? mapBalanceSheetPeriod(null);
      const ttmCash = quarterlyCashPeriods.length
        ? sumCashFlowPeriods(quarterlyCashPeriods.slice(-4))
        : mapCashFlowPeriod(null, ttmIncome);

      years.push("TTM");
      isData.push(ttmIncome);
      bsData.push(ttmBalance);
      cfData.push(ttmCash);
    }

    const ratiosData = years.map((_, index) =>
      buildRatiosPeriod({
        income: isData[index] ?? mapIncomeStatementPeriod(null),
        balance: bsData[index] ?? mapBalanceSheetPeriod(null),
        cashFlow: cfData[index] ?? mapCashFlowPeriod(null),
      }),
    );

    const earningsRecords = getRecordArray(earningsPayload)
      .sort((left, right) => statementSortKey(left) - statementSortKey(right))
      .slice(-8);

    const qEPS =
      earningsRecords.length > 0
        ? earningsRecords.map((record) => {
            const actual = round(getFieldNumber(record, "epsActual", "eps"), 2);
            const estimate = round(getFieldNumber(record, "epsEstimated"), 2);
            return {
              label: toQuarterLabel(getField(record, "date") ?? getField(record, "fiscalDateEnding")),
              actual,
              estimate,
              beat: actual !== null && estimate !== null ? actual >= estimate : null,
              diff:
                actual !== null && estimate !== null ? round(actual - estimate, 2) : null,
            };
          })
        : quarterlyIncomeRecords.slice(-8).map((record) => {
            const actual = round(getFieldNumber(record, "eps", "epsDiluted"), 2);
            const period = asString(getField(record, "period"));
            const date = getField(record, "date");
            const dateYear = toDate(date)?.getUTCFullYear();

            return {
              label:
                period && /^Q\d$/i.test(period) && dateYear
                  ? `${period.toUpperCase()} '${String(dateYear).slice(2)}`
                  : toQuarterLabel(date),
              actual,
              estimate: null,
              beat: null,
              diff: null,
            };
          });

    return {
      symbol: normalized,
      years,
      revs: isData.map((period) => period.rev),
      isData,
      bsData,
      cfData,
      ratiosData,
      qEPS,
      annualEarnings: years.map((year, index) => ({
        year,
        earnings: isData[index]?.netIncome ?? null,
        isEstimate: false,
      })),
    };
  }

  async getSnapshots(symbols: string[]): Promise<ResearchSnapshot[]> {
    const normalizedSymbols = [...new Set(
      symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    )];

    if (normalizedSymbols.length === 0) {
      return [];
    }

    const payload = await this.fetchStable<unknown>("/batch-quote", {
      symbols: normalizedSymbols.map((symbol) => toProviderSymbol(symbol)).join(","),
    });

    const snapshots = new Map<string, ResearchSnapshot>();

    getRecordArray(payload).forEach((entry) => {
      const providerSymbol = asString(entry["symbol"]);

      if (!providerSymbol) {
        return;
      }

      const internalSymbol = fromProviderSymbol(providerSymbol);
      const price = round(asNumber(entry["price"]), 2);
      const marketCap = asNumber(entry["marketCap"] ?? entry["mktCap"]);
      const sharesOutstanding = firstDefined(
        asNumber(entry["sharesOutstanding"]),
        marketCap !== null && price && price > 0 ? marketCap / price : null,
      );

      snapshots.set(internalSymbol, {
        symbol: internalSymbol,
        price,
        bid: null,
        ask: null,
        change: round(asNumber(entry["change"]), 2),
        changePercent: normalizePercent(
          entry["changesPercentage"] ?? entry["changePercent"],
        ),
        dayLow: round(asNumber(entry["dayLow"] ?? entry["low"]), 2),
        dayHigh: round(asNumber(entry["dayHigh"] ?? entry["high"]), 2),
        yearLow: round(asNumber(entry["yearLow"]), 2),
        yearHigh: round(asNumber(entry["yearHigh"]), 2),
        mc: normalizeMillions(marketCap, 1),
        pe: round(asNumber(entry["pe"]), 1),
        eps: round(asNumber(entry["eps"]), 2),
        sharesOut: normalizeMillions(sharesOutstanding, 1),
      });
    });

    return normalizedSymbols.map((symbol) => snapshots.get(symbol) ?? {
      symbol,
      price: null,
      bid: null,
      ask: null,
      change: null,
      changePercent: null,
      dayLow: null,
      dayHigh: null,
      yearLow: null,
      yearHigh: null,
      mc: null,
      pe: null,
      eps: null,
      sharesOut: null,
    });
  }

  async getEarningsCalendar(from: Date, to: Date): Promise<ResearchCalendarEntry[]> {
    const payload = await this.fetchStable<unknown>("/earnings-calendar", {
      from: toIsoDateString(from),
      to: toIsoDateString(to),
    });

    return getRecordArray(payload).map((entry) => ({
      symbol: fromProviderSymbol(asString(entry["symbol"]) ?? ""),
      date: normalizeIsoDate(entry["date"]),
      time: asString(entry["time"])?.toLowerCase() ?? null,
      epsEstimated: asNumber(entry["epsEstimated"] ?? entry["eps"]),
      revenueEstimated: asNumber(entry["revenueEstimated"] ?? entry["revenue"]),
      fiscalDateEnding: normalizeIsoDate(
        firstDefined(entry["fiscalDateEnding"], entry["fiscalDate"]),
      ),
    }));
  }

  async getSecFilings(symbol: string, limit = 25): Promise<ResearchFiling[]> {
    const normalized = normalizeSymbol(symbol);
    const payload = await this.fetchStable<unknown>("/sec-filings-search/symbol", {
      symbol: toProviderSymbol(normalized),
      limit,
    });

    return getRecordArray(payload).map((entry) => ({
      symbol: fromProviderSymbol(asString(entry["symbol"]) ?? normalized),
      type: asString(entry["type"] ?? entry["formType"] ?? entry["form"]),
      filingDate: normalizeIsoDate(entry["fillingDate"] ?? entry["filingDate"] ?? entry["date"]),
      acceptedDate: asString(entry["acceptedDate"]),
      finalLink: asString(entry["finalLink"] ?? entry["finalURL"] ?? entry["finalUrl"]),
      link: asString(entry["link"] ?? entry["url"]),
    }));
  }

  async getTranscriptDates(symbol: string): Promise<TranscriptDateEntry[]> {
    const payload = await this.fetchStable<unknown>("/earning-call-transcript-dates", {
      symbol: toProviderSymbol(symbol),
    });

    return asArray(payload).flatMap((entry) => {
      const mapped = mapTranscriptDate(entry);
      return mapped ? [mapped] : [];
    });
  }

  async getTranscript(
    symbol: string,
    quarter?: number,
    year?: number,
  ): Promise<TranscriptEntry | null> {
    const normalized = normalizeSymbol(symbol);
    const payload = await this.fetchStable<unknown>("/earning-call-transcript", {
      symbol: toProviderSymbol(normalized),
      quarter,
      year,
    });

    const record = getRecordArray(payload)[0] ?? asRecord(payload);

    if (!record) {
      return null;
    }

    return {
      symbol: fromProviderSymbol(asString(record["symbol"]) ?? normalized),
      quarter: firstDefined(asNumber(record["quarter"]), asNumber(record["fiscalQuarter"])),
      year: firstDefined(asNumber(record["year"]), asNumber(record["calendarYear"])),
      date: normalizeIsoDate(record["date"]),
      content: asString(
        record["content"] ??
          record["transcript"] ??
          record["text"] ??
          record["body"],
      ),
    };
  }
}
