export const POSITION_TABLE_SURFACE_ACCOUNT = "account";
export const POSITION_TABLE_SURFACE_ALGO = "algo";

const column = ({
  id,
  label,
  shortLabel = label,
  title = label,
  width,
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
    width: "156px",
    align: "left",
    numeric: false,
    sticky: true,
  }),
  column({ id: "quantity", label: "Qty", width: "56px" }),
  column({ id: "averageCost", label: "Avg", title: "Average cost", width: "64px" }),
  column({ id: "price", label: "Price", width: "72px" }),
  column({ id: "quote", label: "Bid / Ask", width: "118px" }),
  column({
    id: "stop",
    label: "Stop",
    shortLabel: "SL",
    title: "Stop loss",
    width: "62px",
    group: "management",
    groupEdge: "start",
  }),
  column({
    id: "trail",
    label: "Trail",
    shortLabel: "TRL",
    title: "Trailing stop",
    width: "62px",
    group: "management",
  }),
  column({
    id: "target",
    label: "Target",
    shortLabel: "TP",
    title: "Profit target",
    width: "62px",
    group: "management",
  }),
  column({
    id: "riskDistance",
    label: "Risk / Dist",
    shortLabel: "DIST",
    title: "Risk distance / amount",
    width: "78px",
    group: "management",
    groupEdge: "end",
  }),
  column({ id: "day", label: "Day", width: "86px" }),
  column({ id: "unrealized", label: "Unreal", title: "Unrealized P&L", width: "96px" }),
  column({ id: "exposure", label: "Exposure", width: "96px" }),
  column({ id: "greeks", label: "Greeks", width: "78px" }),
  column({
    id: "signalContext",
    label: "Signal",
    width: "112px",
    align: "left",
    numeric: false,
    sortable: false,
  }),
  column({
    id: "actions",
    label: "",
    width: "42px",
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
  "target",
  "riskDistance",
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
  "target",
  "riskDistance",
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
