import type { GexProjectionRatesInput } from "./gex-projection";

const TREASURY_YIELD_CURVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TREASURY_YIELD_CURVE_SOURCE = "treasury_daily_par_yield_curve";
const TREASURY_YIELD_CURVE_BASE_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

type TreasuryYieldCurveCacheEntry = {
  expiresAt: number;
  value: GexProjectionRatesInput;
};

let treasuryYieldCurveCache: TreasuryYieldCurveCacheEntry | null = null;

const TENOR_TAGS = [
  ["BC_1MONTH", 1 / 12],
  ["BC_2MONTH", 2 / 12],
  ["BC_3MONTH", 3 / 12],
  ["BC_4MONTH", 4 / 12],
  ["BC_6MONTH", 6 / 12],
  ["BC_1YEAR", 1],
  ["BC_2YEAR", 2],
  ["BC_3YEAR", 3],
  ["BC_5YEAR", 5],
  ["BC_7YEAR", 7],
  ["BC_10YEAR", 10],
  ["BC_20YEAR", 20],
  ["BC_30YEAR", 30],
] as const;

function unavailableRates(message: string): GexProjectionRatesInput {
  return {
    status: "unavailable",
    source: TREASURY_YIELD_CURVE_SOURCE,
    asOf: null,
    points: [],
    message,
  };
}

function encodeMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

function defaultTreasuryYieldCurveUrl(date: Date): string {
  const url = new URL(TREASURY_YIELD_CURVE_BASE_URL);
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value_month", encodeMonth(date));
  return url.toString();
}

function readXmlTag(row: string, tag: string): string | null {
  const expression = new RegExp(`<[^>]*:?${tag}[^>]*>([^<]*)<\\/[^>]+>`, "i");
  const match = expression.exec(row);
  return match?.[1]?.trim() || null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function parseTreasuryYieldCurveXml(
  xml: string,
): GexProjectionRatesInput {
  const rows = String(xml || "")
    .split(/<entry\b/i)
    .slice(1)
    .map((row) => `<entry${row}`)
    .map((row) => {
      const asOf = parseDate(
        readXmlTag(row, "NEW_DATE") ?? readXmlTag(row, "Id"),
      );
      const points = TENOR_TAGS.flatMap(([tag, tenorYears]) => {
        const value = readXmlTag(row, tag);
        if (!value || value.toUpperCase() === "N/A") return [];
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return [];
        return [{ tenorYears, rate: numeric / 100 }];
      });
      return { asOf, points };
    })
    .filter((row) => row.asOf && row.points.length);

  const latest = rows.sort((left, right) =>
    String(right.asOf).localeCompare(String(left.asOf)),
  )[0];

  if (!latest) {
    return unavailableRates("Treasury yield curve response did not include usable rows.");
  }

  return {
    status: "ok",
    source: TREASURY_YIELD_CURVE_SOURCE,
    asOf: latest.asOf,
    points: latest.points,
  };
}

export async function fetchTreasuryYieldCurveRates(input: {
  asOf?: Date;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
} = {}): Promise<GexProjectionRatesInput> {
  const now = input.asOf ?? new Date();
  const cached = treasuryYieldCurveCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return unavailableRates("Runtime fetch is unavailable.");
  }

  const url =
    process.env["TREASURY_YIELD_CURVE_URL"] ||
    defaultTreasuryYieldCurveUrl(now);
  try {
    const response = await fetchImpl(url, { signal: input.signal });
    if (!response.ok) {
      return unavailableRates(
        `Treasury yield curve request failed with ${response.status}.`,
      );
    }
    const parsed = parseTreasuryYieldCurveXml(await response.text());
    treasuryYieldCurveCache = {
      expiresAt: Date.now() + TREASURY_YIELD_CURVE_CACHE_TTL_MS,
      value: parsed,
    };
    return parsed;
  } catch (error) {
    return unavailableRates(
      error instanceof Error
        ? error.message
        : "Treasury yield curve request failed.",
    );
  }
}

export function __clearTreasuryYieldCurveCacheForTests(): void {
  treasuryYieldCurveCache = null;
}
