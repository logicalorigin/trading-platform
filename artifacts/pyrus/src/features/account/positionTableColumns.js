export const POSITION_TABLE_SURFACE_ACCOUNT = "account";
export const POSITION_TABLE_SURFACE_ALGO = "algo";

const column = ({
  id,
  label,
  shortLabel = label,
  title = label,
  width,
  minWidth = width,
  align = "right",
  sortable = true,
  numeric = true,
  sticky = false,
  group = null,
  groupEdge = null,
}) => ({
  id,
  label,
  shortLabel,
  title,
  width,
  minWidth,
  align,
  sortable,
  numeric,
  sticky,
  group,
  groupEdge,
});

export const POSITION_TABLE_COLUMNS = [
  column({
    id: "symbol",
    label: "Symbol",
    width: "clamp(136px, 14vw, 190px)",
    minWidth: "136px",
    align: "left",
    numeric: false,
    sticky: true,
  }),
  column({ id: "quantity", label: "Qty", width: "clamp(38px, 4vw, 48px)", minWidth: "38px" }),
  column({ id: "averageCost", label: "Avg", title: "Average cost", width: "clamp(46px, 5vw, 58px)", minWidth: "46px" }),
  column({ id: "price", label: "Price", width: "clamp(54px, 6vw, 66px)", minWidth: "54px" }),
  column({ id: "quote", label: "Bid / Ask", width: "clamp(90px, 9vw, 112px)", minWidth: "90px" }),
  column({
    id: "stop",
    label: "Stop",
    shortLabel: "SL",
    title: "Stop loss",
    width: "clamp(52px, 5vw, 62px)",
    minWidth: "52px",
    group: "management",
    groupEdge: "start",
  }),
  column({
    id: "trail",
    label: "Trail",
    shortLabel: "TRL",
    title: "Trailing stop",
    width: "clamp(52px, 5vw, 62px)",
    minWidth: "52px",
    group: "management",
    groupEdge: "end",
  }),
  column({ id: "day", label: "Day", width: "clamp(68px, 7vw, 84px)", minWidth: "68px" }),
  column({ id: "unrealized", label: "Unreal", title: "Unrealized P&L", width: "clamp(76px, 8vw, 92px)", minWidth: "76px" }),
  column({ id: "exposure", label: "Exposure", width: "clamp(78px, 8vw, 96px)", minWidth: "78px" }),
  column({
    id: "greeks",
    label: "Greeks",
    shortLabel: "Δ/θ",
    title: "Delta / Theta",
    width: "clamp(50px, 5vw, 64px)",
    minWidth: "50px",
  }),
  column({
    id: "signalContext",
    label: "Signal",
    shortLabel: "Sig",
    title: "Signal score / timeframe",
    width: "clamp(66px, 7vw, 92px)",
    minWidth: "66px",
    align: "center",
    numeric: false,
    sortable: false,
  }),
  column({
    id: "actions",
    label: "",
    width: "clamp(74px, 8vw, 90px)",
    minWidth: "74px",
    sortable: false,
    numeric: false,
  }),
  column({ id: "last", label: "Last", width: "70px" }),
  column({ id: "bid", label: "Bid", width: "62px" }),
  column({ id: "ask", label: "Ask", width: "62px" }),
  column({ id: "spreadPercent", label: "Sprd %", width: "62px" }),
  column({ id: "dayChange", label: "Day $", width: "82px" }),
  column({ id: "dayChangePercent", label: "Day %", width: "58px" }),
  column({ id: "unrealizedPnl", label: "Unreal $", width: "92px" }),
  column({ id: "unrealizedPnlPercent", label: "Unreal %", width: "68px" }),
  column({ id: "marketValue", label: "Value", width: "96px" }),
  column({ id: "weightPercent", label: "Wt %", width: "58px" }),
  column({ id: "delta", label: "Delta", width: "58px" }),
  column({ id: "theta", label: "Theta", width: "58px" }),
];

export const ACCOUNT_POSITION_DEFAULT_COLUMN_IDS = [
  "symbol",
  "quantity",
  "averageCost",
  "price",
  "quote",
  "stop",
  "trail",
  "day",
  "unrealized",
  "exposure",
  "greeks",
  "signalContext",
  "actions",
];

export const ALGO_POSITION_DEFAULT_COLUMN_IDS = [
  "symbol",
  "quantity",
  "averageCost",
  "price",
  "quote",
  "stop",
  "trail",
  "day",
  "unrealized",
  "exposure",
  "greeks",
  "signalContext",
  "actions",
];

const columnById = new Map(POSITION_TABLE_COLUMNS.map((item) => [item.id, item]));

export const positionTableColumnIdsForSurface = (surfaceId) =>
  surfaceId === POSITION_TABLE_SURFACE_ALGO
    ? ALGO_POSITION_DEFAULT_COLUMN_IDS
    : ACCOUNT_POSITION_DEFAULT_COLUMN_IDS;

export const getPositionTableColumns = (surfaceId = POSITION_TABLE_SURFACE_ACCOUNT) =>
  positionTableColumnIdsForSurface(surfaceId)
    .map((id) => columnById.get(id))
    .filter(Boolean);
