const FLEX_MAX_OVERRIDE_DAYS = 365;
const FLEX_MAX_HISTORY_YEARS = 4;

export type FlexRecord = {
  tag: string;
  attributes: Record<string, string>;
};

export type FlexConfig = { token: string; queryId: string };

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function xmlDecode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseXmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = attributePattern.exec(raw);

  while (match) {
    attributes[match[1]] = xmlDecode(match[3] ?? match[4] ?? "");
    match = attributePattern.exec(raw);
  }

  return attributes;
}

export function extractFlexRecords(xml: string, tagNames: string[]): FlexRecord[] {
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

export function extractTagText(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? xmlDecode(match[1].trim()) : null;
}

export function getFlexConfigs(
  env: Record<string, string | undefined> = process.env,
): FlexConfig[] | null {
  const token = env["IBKR_FLEX_TOKEN"]?.trim();
  const queryIds = (env["IBKR_FLEX_QUERY_ID"] ?? "")
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return token && queryIds.length
    ? queryIds.map((queryId) => ({ token, queryId }))
    : null;
}

export function getFlexConfig(
  env: Record<string, string | undefined> = process.env,
): FlexConfig | null {
  return getFlexConfigs(env)?.[0] ?? null;
}

export function flexConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(getFlexConfigs(env)?.length);
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function buildFlexBackfillWindows(
  reason: string,
  now = new Date(),
): Array<{
  fromDate: string;
  toDate: string;
}> {
  const end = startOfUtcDay(now);
  const manualBackfill =
    /manual|test|backfill|import/i.test(reason) || reason === "scheduled-initial";
  const historyStart = manualBackfill
    ? new Date(Date.UTC(end.getUTCFullYear() - FLEX_MAX_HISTORY_YEARS, 0, 1))
    : addUtcDays(end, -(FLEX_MAX_OVERRIDE_DAYS - 1));
  const windows: Array<{ fromDate: string; toDate: string }> = [];

  for (
    let cursor = historyStart;
    cursor <= end;
    cursor = addUtcDays(cursor, FLEX_MAX_OVERRIDE_DAYS)
  ) {
    const windowEndCandidate = addUtcDays(cursor, FLEX_MAX_OVERRIDE_DAYS - 1);
    const windowEnd = windowEndCandidate <= end ? windowEndCandidate : end;
    windows.push({
      fromDate: formatDateOnly(cursor),
      toDate: formatDateOnly(windowEnd),
    });
  }

  return windows;
}
