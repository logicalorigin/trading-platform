export const POSITION_TABLE_SURFACE_ACCOUNT = "account";
export const POSITION_TABLE_SURFACE_ALGO = "algo";

const column = ({
  id,
  label,
  width,
  align = "right",
  sortable = true,
  numeric = true,
  sticky = false,
}) => ({
  id,
  label,
  width,
  align,
  sortable,
  numeric,
  sticky,
});

export const POSITION_TABLE_COLUMNS = [
  column({
    id: "symbol",
    label: "Symbol",
    width: "minmax(188px, 1fr)",
    align: "left",
    numeric: false,
    sticky: true,
  }),
  column({ id: "quantity", label: "Qty", width: "62px" }),
  column({ id: "averageCost", label: "Avg", width: "70px" }),
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
  column({
    id: "signalContext",
    label: "Signal",
    width: "132px",
    align: "left",
    numeric: false,
    sortable: false,
  }),
  column({
    id: "actions",
    label: "",
    width: "54px",
    sortable: false,
    numeric: false,
  }),
];

export const ACCOUNT_POSITION_DEFAULT_COLUMN_IDS = [
  "symbol",
  "quantity",
  "averageCost",
  "last",
  "dayChange",
  "dayChangePercent",
  "unrealizedPnl",
  "unrealizedPnlPercent",
  "marketValue",
  "weightPercent",
  "actions",
];

export const ALGO_POSITION_DEFAULT_COLUMN_IDS = [
  "symbol",
  "quantity",
  "averageCost",
  "last",
  "bid",
  "ask",
  "spreadPercent",
  "dayChange",
  "dayChangePercent",
  "unrealizedPnl",
  "unrealizedPnlPercent",
  "marketValue",
  "weightPercent",
  "delta",
  "theta",
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
