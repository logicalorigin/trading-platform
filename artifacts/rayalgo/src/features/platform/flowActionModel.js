import {
  normalizeFlowOptionExpirationIso,
  normalizeFlowOptionRight,
  normalizeFlowOptionStrike,
} from "./flowOptionChartIdentity";
import { normalizeTickerSymbol } from "./tickerIdentity";

export const FLOW_ROW_ACTION_IDS = Object.freeze([
  "inspect_option",
  "open_underlying",
  "send_to_ticket",
  "copy_contract",
  "pin",
  "mute_ticker",
]);

export const getFlowEventTicker = (event) =>
  normalizeTickerSymbol(event?.ticker || event?.underlying || event?.symbol || "");

export const getFlowEventOptionCp = (event) => {
  const normalizedRight = normalizeFlowOptionRight(event?.right, event?.cp);
  if (normalizedRight === "put") return "P";
  if (normalizedRight === "call") return "C";
  return null;
};

export const hasFlowOptionIdentity = (event) =>
  Boolean(
    normalizeFlowOptionExpirationIso(event?.expirationDate || event?.exp) &&
      getFlowEventOptionCp(event) &&
      normalizeFlowOptionStrike(event?.strike),
  );

export const buildFlowRowActions = ({
  event = null,
  isCopied = false,
  isMuted = false,
  isPinned = false,
} = {}) => {
  const ticker = getFlowEventTicker(event);
  const optionReady = hasFlowOptionIdentity(event);
  return [
    {
      id: "inspect_option",
      label: "Chart option",
      ariaLabel: "Chart flow option",
      tone: "info",
      disabled: !optionReady,
    },
    {
      id: "open_underlying",
      label: "Open underlying chart",
      ariaLabel: "Open underlying chart",
      tone: "accent",
      disabled: !ticker,
    },
    {
      id: "send_to_ticket",
      label: "Send to ticket",
      ariaLabel: "Send flow contract to ticket",
      tone: "good",
      disabled: !ticker || !optionReady,
    },
    {
      id: "copy_contract",
      label: isCopied ? "Copied" : "Copy contract",
      ariaLabel: "Copy flow contract",
      tone: isCopied ? "good" : "muted",
      active: isCopied,
      disabled: !event,
    },
    {
      id: "pin",
      label: isPinned ? "Unpin row" : "Pin row",
      ariaLabel: isPinned ? "Unpin flow row" : "Pin flow row",
      tone: isPinned ? "warn" : "muted",
      active: isPinned,
      disabled: !event,
    },
    {
      id: "mute_ticker",
      label: isMuted ? `${ticker} muted` : "Mute ticker",
      ariaLabel: "Mute flow ticker",
      tone: isMuted ? "warn" : "bad",
      active: isMuted,
      disabled: !ticker,
    },
  ];
};

export const appendFlowExcludeTicker = (excludeQuery, ticker) => {
  const normalizedTicker = normalizeTickerSymbol(ticker);
  if (!normalizedTicker) {
    return String(excludeQuery || "").trim();
  }
  const tokens = String(excludeQuery || "")
    .split(/[\s,]+/)
    .map((token) => normalizeTickerSymbol(token))
    .filter(Boolean);
  if (!tokens.includes(normalizedTicker)) {
    tokens.push(normalizedTicker);
  }
  return Array.from(new Set(tokens)).join(", ");
};
