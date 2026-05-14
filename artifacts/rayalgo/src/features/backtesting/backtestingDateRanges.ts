const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const padDatePart = (value: number) => String(value).padStart(2, "0");

const parseDateInputParts = (
  dateValue: string,
): { year: number; monthIndex: number; day: number } | null => {
  const match = DATE_INPUT_RE.exec(dateValue.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return { year, monthIndex, day };
};

const dateInputBoundaryIso = (
  dateValue: string,
  {
    endOfDay = false,
  }: {
    endOfDay?: boolean;
  } = {},
): string | null => {
  const parts = parseDateInputParts(dateValue);
  if (!parts) {
    return null;
  }

  const date = new Date(
    parts.year,
    parts.monthIndex,
    parts.day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return date.toISOString();
};

export function formatDateInputValue(offsetDays: number, now = new Date()): string {
  const value = new Date(now);
  value.setDate(value.getDate() + offsetDays);
  return [
    value.getFullYear(),
    padDatePart(value.getMonth() + 1),
    padDatePart(value.getDate()),
  ].join("-");
}

export function toStartOfDayIso(dateValue: string): string | null {
  return dateInputBoundaryIso(dateValue);
}

export function toEndOfDayIso(dateValue: string): string | null {
  return dateInputBoundaryIso(dateValue, { endOfDay: true });
}
