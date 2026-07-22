import { OVERLAY_LAYER } from "../../components/platform/overlayLayers.js";

export const TOAST_OVERLAY_Z_INDEX = OVERLAY_LAYER.toast;

const TOAST_KIND_ALIASES = Object.freeze({
  danger: "error",
  warn: "warn",
  warning: "warn",
});

const TOAST_KINDS = new Set(["info", "success", "warn", "error", "algo"]);
const TOAST_PRIORITY = Object.freeze({
  error: 0,
  warn: 1,
  algo: 2,
  success: 3,
  info: 4,
});

export const normalizeToastKind = (kind) => {
  const normalized = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  const canonical = TOAST_KIND_ALIASES[normalized] || normalized;
  return TOAST_KINDS.has(canonical) ? canonical : "info";
};

export const isAlertToastKind = (kind) => normalizeToastKind(kind) === "error";

export const orderToastsForDisplay = (toasts = [], maxVisible = 3) => {
  const source = Array.isArray(toasts) ? toasts : [];
  const requestedLimit = Number(maxVisible);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(source.length, Math.trunc(requestedLimit)))
    : Math.min(source.length, 3);

  return source
    .map((toast, index) => ({ toast, index }))
    .sort((left, right) => {
      const priorityDifference =
        TOAST_PRIORITY[normalizeToastKind(left.toast?.kind)] -
        TOAST_PRIORITY[normalizeToastKind(right.toast?.kind)];
      if (priorityDifference !== 0) return priorityDifference;

      const leftId = Number(left.toast?.id);
      const rightId = Number(right.toast?.id);
      if (
        Number.isFinite(leftId) &&
        Number.isFinite(rightId) &&
        leftId !== rightId
      ) {
        return rightId - leftId;
      }
      return left.index - right.index;
    })
    .slice(0, limit)
    .map(({ toast }) => toast);
};
