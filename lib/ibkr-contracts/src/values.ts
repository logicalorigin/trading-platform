export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const stripped = trimmed.replace(/^[^0-9.+\-]+/, "").replace(/,/g, "");

    if (!stripped) {
      return null;
    }

    const numeric = Number(stripped);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

export function firstDefined<T>(
  ...values: Array<T | null | undefined>
): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

function normalizeLookupKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function findCaseInsensitiveValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  const normalizedKey = normalizeLookupKey(key);

  const directMatch = record[key];
  if (directMatch !== undefined) {
    return directMatch;
  }

  const entry = Object.entries(record).find(
    ([candidate]) => normalizeLookupKey(candidate) === normalizedKey,
  );

  return entry?.[1];
}

export function getPath(
  value: unknown,
  path: string[],
  { caseInsensitive = false }: { caseInsensitive?: boolean } = {},
): unknown {
  let current: unknown = value;

  for (const segment of path) {
    const record = asRecord(current);

    if (!record) {
      return undefined;
    }

    current = caseInsensitive
      ? findCaseInsensitiveValue(record, segment)
      : record[segment];
  }

  return current;
}

export function getStringPath(
  value: unknown,
  path: string[],
  options?: { caseInsensitive?: boolean },
): string | null {
  return asString(getPath(value, path, options));
}

export function getNumberPath(
  value: unknown,
  path: string[],
  options?: { caseInsensitive?: boolean },
): number | null {
  return asNumber(getPath(value, path, options));
}

export function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const compactText =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isInteger(value)
        ? String(value)
        : null;
  if (compactText && /^\d{8}$/.test(compactText)) {
    const year = Number(compactText.slice(0, 4));
    const month = Number(compactText.slice(4, 6)) - 1;
    const day = Number(compactText.slice(6, 8));
    if (year >= 1970 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month, day));
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  const numeric = asNumber(value);

  if (numeric !== null) {
    let millis = numeric;
    const abs = Math.abs(millis);

    if (abs >= 1e17) {
      millis = millis / 1e6;
    } else if (abs >= 1e14) {
      millis = millis / 1e3;
    } else if (abs >= 1e11) {
      millis = millis;
    } else if (abs >= 1e9) {
      millis = millis * 1e3;
    }

    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = asString(value);

  if (!text) {
    return null;
  }

  if (/^\d{8}$/.test(text)) {
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6)) - 1;
    const day = Number(text.slice(6, 8));
    const date = new Date(Date.UTC(year, month, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();

  if (/^[A-Z]{1,5}[ -][A-Z]{1,2}$/.test(normalized)) {
    return normalized.replace(/[ -]/, ".");
  }

  return normalized;
}

export function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const IBKR_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

export function toIbkrMonthCode(date: Date): string {
  return `${IBKR_MONTHS[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

export function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}
