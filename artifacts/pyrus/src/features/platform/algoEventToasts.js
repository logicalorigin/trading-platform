import { formatEnumLabel } from "../../lib/formatters";

const readNumber = (value) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
};

const formatSignedUsd = (value) =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

// Categorize by event-type suffix so this stays robust across the algo event
// family (e.g. signal_options_shadow_exit, signal_options_gateway_blocked,
// signal_options_candidate_skipped). High-frequency mark/candidate events
// return null so they never toast.
const categorize = (eventType) => {
  const type = String(eventType || "");
  if (type.endsWith("_exit")) return "exit";
  if (type.endsWith("_entry")) return "entry";
  if (type.endsWith("_blocked")) return "blocked";
  if (type.endsWith("_skipped")) return "skipped";
  return null;
};

// Drop the verbose "signal_options_" prefix, matching the notifications drawer.
const eventLabel = (eventType) => {
  const stripped = String(eventType || "").replace(/^signal_options_/, "");
  return formatEnumLabel(stripped || eventType || "event");
};

const includesMtfNotAligned = (value) => {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/[_-]+/g, " ");
  return normalized.includes("mtf not aligned");
};

const reasonValues = (value) =>
  Array.isArray(value) ? value : value == null ? [] : [value];

const isMtfNotAlignedControlEvent = (event, summary) => {
  const payload =
    event?.payload && typeof event.payload === "object" ? event.payload : {};
  const entryGate =
    payload?.entryGate && typeof payload.entryGate === "object"
      ? payload.entryGate
      : {};
  const values = [
    event?.reason,
    payload?.reason,
    payload?.skipReason,
    entryGate?.reason,
    ...reasonValues(payload?.reasons),
    ...reasonValues(payload?.reasonCodes),
    ...reasonValues(entryGate?.reasons),
    summary,
  ];
  return values.some(includesMtfNotAligned);
};

export function buildAlgoEventToast(event) {
  const category = categorize(event?.eventType);
  if (!category) return null;

  const summary =
    typeof event?.summary === "string" && event.summary.trim()
      ? event.summary.trim()
      : "";
  const symbol = typeof event?.symbol === "string" ? event.symbol.trim() : "";
  const label = eventLabel(event?.eventType);
  const title = symbol ? `${symbol} · ${label}` : label;

  if (
    (category === "blocked" || category === "skipped") &&
    isMtfNotAlignedControlEvent(event, summary)
  ) {
    return null;
  }

  if (category === "exit") {
    const pnl = readNumber(event?.payload?.pnl);
    const kind =
      pnl == null ? "info" : pnl > 0 ? "success" : pnl < 0 ? "error" : "info";
    // Exit summaries carry the price/reason but not the PnL, so lead the body
    // with the realized PnL when we have it.
    const body =
      pnl == null
        ? summary || "Exit filled"
        : summary
          ? `PnL ${formatSignedUsd(pnl)} · ${summary}`
          : `Exit · PnL ${formatSignedUsd(pnl)}`;
    return { kind, title, body, duration: 5000 };
  }

  if (category === "entry") {
    return {
      kind: "success",
      title,
      body: summary || "Entry filled",
      duration: 5000,
    };
  }

  if (category === "blocked") {
    return {
      kind: "warn",
      title,
      body: summary || "Scan blocked",
      duration: 6000,
    };
  }

  // skipped
  return {
    kind: "info",
    title,
    body: summary || "Candidate skipped",
    duration: 4000,
  };
}
