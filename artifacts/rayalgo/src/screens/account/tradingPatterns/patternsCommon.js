export const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const arrayValue = (value) => (Array.isArray(value) ? value : []);

export const startOfIsoWeek = (input) => {
  const dateOnly = typeof input === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim())
    : null;
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : input instanceof Date
      ? new Date(input.getTime())
      : new Date(input);
  if (
    Number.isNaN(d.getTime()) ||
    (dateOnly &&
      (d.getFullYear() !== Number(dateOnly[1]) ||
        d.getMonth() !== Number(dateOnly[2]) - 1 ||
        d.getDate() !== Number(dateOnly[3])))
  ) {
    return null;
  }
  d.setHours(0, 0, 0, 0);
  const dayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOffset);
  return d;
};

export const isoWeekKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
