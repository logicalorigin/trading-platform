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
    width: "136px",
    minWidth: "136px",
    align: "left",
    numeric: false,
    sticky: true,
  }),
  column({ id: "underlyingPrice", label: "Spot", title: "Underlying price", width: "50px", minWidth: "50px" }),
  column({ id: "quantity", label: "Qty", width: "38px", minWidth: "38px" }),
  column({ id: "averageCost", label: "Avg", title: "Average cost", width: "46px", minWidth: "46px" }),
  column({ id: "price", label: "Price", width: "54px", minWidth: "54px" }),
  column({ id: "quote", label: "Bid / Ask", width: "90px", minWidth: "90px" }),
  column({
    id: "stop",
    label: "Stop",
    shortLabel: "SL",
    title: "Stop loss",
    width: "52px",
    minWidth: "52px",
    group: "management",
    groupEdge: "start",
  }),
  column({
    id: "trail",
    label: "Trail",
    shortLabel: "TRL",
    title: "Trailing stop",
    width: "52px",
    minWidth: "52px",
    group: "management",
    groupEdge: "end",
  }),
  column({ id: "day", label: "Day", width: "68px", minWidth: "68px" }),
  column({ id: "unrealized", label: "Unreal", title: "Unrealized P&L", width: "76px", minWidth: "76px" }),
  column({ id: "exposure", label: "Exposure", width: "78px", minWidth: "78px" }),
  column({
    id: "greeks",
    label: "Greeks",
    shortLabel: "Δ/θ",
    title: "Delta / Theta",
    width: "50px",
    minWidth: "50px",
  }),
  column({
    id: "signalContext",
    label: "Signal",
    shortLabel: "Sig",
    title: "Signal score / timeframe",
    width: "66px",
    minWidth: "66px",
    align: "center",
    numeric: false,
    sortable: false,
  }),
  column({
    id: "actions",
    label: "",
    width: "74px",
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
  "underlyingPrice",
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
  "underlyingPrice",
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
