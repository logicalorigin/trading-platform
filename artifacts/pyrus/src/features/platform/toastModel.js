export const TOAST_OVERLAY_Z_INDEX = 11_000;

const TOAST_KIND_ALIASES = Object.freeze({
  danger: "error",
  warn: "warn",
  warning: "warn",
});

const TOAST_KINDS = new Set(["info", "success", "warn", "error", "algo"]);

export const normalizeToastKind = (kind) => {
  const normalized = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  const canonical = TOAST_KIND_ALIASES[normalized] || normalized;
  return TOAST_KINDS.has(canonical) ? canonical : "info";
};

export const isAlertToastKind = (kind) => normalizeToastKind(kind) === "error";
