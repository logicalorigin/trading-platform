export const STRIKE_SLOT_MIN = 0;
export const STRIKE_SLOT_MAX = 5;
export const DEFAULT_STRIKE_SLOT = 3;
export const AUTO_STRIKE_SLOT_LABEL = "ATM Auto";

export const STRIKE_SLOT_SPECS = [
  { slot: 0, shortLabel: "-2", label: "2 Below ATM" },
  { slot: 1, shortLabel: "-1", label: "1 Below ATM" },
  { slot: 2, shortLabel: "ATM-", label: "ATM Below" },
  { slot: 3, shortLabel: "ATM+", label: "ATM Above" },
  { slot: 4, shortLabel: "+1", label: "1 Above ATM" },
  { slot: 5, shortLabel: "+2", label: "2 Above ATM" },
];

export function clampStrikeSlot(value, fallback = DEFAULT_STRIKE_SLOT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(STRIKE_SLOT_MAX, Math.max(STRIKE_SLOT_MIN, Math.round(numeric)));
}

export function getStrikeSlotSpec(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return STRIKE_SLOT_SPECS.find((spec) => spec.slot === clampStrikeSlot(numeric)) || null;
}

export function formatStrikeSlotLabel(value, options = {}) {
  const spec = getStrikeSlotSpec(value);
  if (!spec) {
    return options.short ? "AUTO" : AUTO_STRIKE_SLOT_LABEL;
  }
  return options.short ? spec.shortLabel : spec.label;
}
