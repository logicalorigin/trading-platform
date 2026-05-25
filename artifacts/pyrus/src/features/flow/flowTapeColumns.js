export const FLOW_TAPE_OPTIONAL_COLUMNS = Object.freeze([
  { id: "side", label: "SIDE", toggleLabel: "Side", width: "56px" },
  { id: "execution", label: "EXEC", toggleLabel: "Exec", width: "56px" },
  { id: "type", label: "TYPE", toggleLabel: "Type", width: "70px" },
  { id: "fill", label: "FILL", toggleLabel: "Fill", width: "78px" },
  { id: "bidAsk", label: "BID/ASK", toggleLabel: "Bid/Ask", width: "118px" },
  { id: "bid", label: "BID", toggleLabel: "Bid", width: "58px", defaultVisible: false },
  { id: "ask", label: "ASK", toggleLabel: "Ask", width: "58px", defaultVisible: false },
  { id: "spread", label: "SPREAD", toggleLabel: "Spread", width: "78px", defaultVisible: false },
  { id: "premium", label: "PREMIUM", toggleLabel: "Prem", width: "76px" },
  { id: "size", label: "SIZE", toggleLabel: "Size", width: "50px" },
  { id: "oi", label: "OI", toggleLabel: "OI", width: "50px" },
  { id: "ratio", label: "V/OI", toggleLabel: "V/OI", width: "50px" },
  { id: "dte", label: "DTE", toggleLabel: "DTE", width: "42px" },
  { id: "iv", label: "IV", toggleLabel: "IV", width: "52px" },
  { id: "spot", label: "SPOT", toggleLabel: "Spot", width: "62px" },
  { id: "moneyness", label: "MNY", toggleLabel: "Mny", width: "54px", defaultVisible: false },
  { id: "distance", label: "DIST", toggleLabel: "Dist", width: "54px", defaultVisible: false },
  { id: "delta", label: "DELTA", toggleLabel: "Delta", width: "56px", defaultVisible: false },
  { id: "gamma", label: "GAMMA", toggleLabel: "Gamma", width: "56px", defaultVisible: false },
  { id: "theta", label: "THETA", toggleLabel: "Theta", width: "56px", defaultVisible: false },
  { id: "vega", label: "VEGA", toggleLabel: "Vega", width: "54px", defaultVisible: false },
  { id: "sourceBasis", label: "SOURCE", toggleLabel: "Source", width: "82px", defaultVisible: false },
  { id: "confidence", label: "CONF", toggleLabel: "Conf", width: "78px", defaultVisible: false },
  { id: "score", label: "SCORE", toggleLabel: "Score", width: "48px" },
]);

export const DEFAULT_FLOW_VISIBLE_COLUMNS = FLOW_TAPE_OPTIONAL_COLUMNS.filter(
  (column) => column.defaultVisible !== false,
).map((column) => column.id);

export const FLOW_COLUMN_BY_ID = new Map(
  FLOW_TAPE_OPTIONAL_COLUMNS.map((column) => [column.id, column]),
);

export const DEFAULT_FLOW_COLUMN_ORDER = FLOW_TAPE_OPTIONAL_COLUMNS.map(
  (column) => column.id,
);

export const FLOW_FIXED_COLUMNS = Object.freeze([
  { id: "time", label: "AGE", width: "58px" },
  { id: "ticker", label: "TICK", width: "62px" },
  { id: "right", label: "C/P", width: "34px" },
  { id: "expiration", label: "EXP", width: "62px" },
  { id: "strike", label: "STRIKE", width: "64px" },
  { id: "otmPercent", label: "% OTM", width: "58px" },
  { id: "mark", label: "MARK", width: "62px" },
  { id: "actions", label: "ACTIONS", width: "76px" },
]);

export const RIGHT_ALIGNED_FLOW_COLUMNS = new Set([
  "actions",
  "ask",
  "bid",
  "bidAsk",
  "delta",
  "distance",
  "dte",
  "fill",
  "gamma",
  "iv",
  "mark",
  "moneyness",
  "oi",
  "otmPercent",
  "premium",
  "ratio",
  "size",
  "spot",
  "spread",
  "strike",
  "theta",
  "vega",
]);

export const CENTER_ALIGNED_FLOW_COLUMNS = new Set([
  "actions",
  "execution",
  "right",
  "score",
  "side",
  "sourceBasis",
  "type",
]);

export const FLOW_SORTABLE_COLUMNS = new Set([
  "confidence",
  "delta",
  "distance",
  "dte",
  "expiration",
  "gamma",
  "iv",
  "mark",
  "moneyness",
  "oi",
  "otmPercent",
  "premium",
  "ratio",
  "right",
  "score",
  "size",
  "spot",
  "strike",
  "ticker",
  "time",
  "theta",
  "vega",
]);

const FLOW_COLUMN_ALIASES = Object.freeze({
  price: ["fill"],
});

export const expandFlowColumnIds = (value, { replaceRawBidAsk = false } = {}) => {
  if (!Array.isArray(value)) return [];
  const expanded = [];
  let insertedBidAsk = false;
  value.forEach((columnId) => {
    if (
      replaceRawBidAsk &&
      ["bid", "ask", "spread"].includes(columnId)
    ) {
      if (!insertedBidAsk) {
        expanded.push("bidAsk");
        insertedBidAsk = true;
      }
      return;
    }
    if (FLOW_COLUMN_BY_ID.has(columnId)) {
      expanded.push(columnId);
      return;
    }
    expanded.push(...(FLOW_COLUMN_ALIASES[columnId] || []));
  });
  return expanded;
};

export const normalizeFlowColumnOrder = (value) => {
  const seen = new Set();
  const ordered = expandFlowColumnIds(value, {
    replaceRawBidAsk: !Array.isArray(value) || !value.includes("bidAsk"),
  }).filter((columnId) => {
    if (!FLOW_COLUMN_BY_ID.has(columnId) || seen.has(columnId)) return false;
    seen.add(columnId);
    return true;
  });
  return [
    ...ordered,
    ...DEFAULT_FLOW_COLUMN_ORDER.filter((columnId) => !seen.has(columnId)),
  ];
};

export const normalizeFlowVisibleColumns = (value) => {
  const columns = Array.isArray(value)
    ? expandFlowColumnIds(value, {
        replaceRawBidAsk: !value.includes("bidAsk"),
      }).filter((columnId) => FLOW_COLUMN_BY_ID.has(columnId))
    : DEFAULT_FLOW_VISIBLE_COLUMNS;
  const visible = columns.length
    ? Array.from(new Set(columns))
    : DEFAULT_FLOW_VISIBLE_COLUMNS;
  if (visible.includes("bidAsk")) return visible;
  const fillIndex = visible.indexOf("fill");
  if (fillIndex < 0) return ["bidAsk", ...visible];
  return [
    ...visible.slice(0, fillIndex + 1),
    "bidAsk",
    ...visible.slice(fillIndex + 1),
  ];
};
