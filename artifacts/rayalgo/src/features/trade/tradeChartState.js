import {
  getChartBarLimit,
  getChartTimeframeOptions,
} from "../charting/timeframes";
import { RAY_REPLICA_PINE_SCRIPT_KEY } from "../charting/rayReplicaPineAdapter";

export const TRADE_EQUITY_INDICATOR_PRESET_VERSION = 1;

export const DEFAULT_TRADE_EQUITY_STUDIES = [
  "ema-21",
  "ema-55",
  "vwap",
  RAY_REPLICA_PINE_SCRIPT_KEY,
];

export const TRADE_TIMEFRAMES = getChartTimeframeOptions("primary").map(
  (option) => ({
    v: option.value,
    bars: getChartBarLimit(option.value, "primary"),
    tag: option.label,
  }),
);

export const buildTradeBarsPageQueryKey = ({
  queryBase,
  timeframe,
  limit,
  from,
  to,
  historyCursor,
  preferCursor,
  brokerRecentWindowMinutes = null,
}) => [
  ...queryBase,
  timeframe,
  limit,
  from || null,
  to || null,
  historyCursor || null,
  preferCursor ? "cursor" : "window",
  brokerRecentWindowMinutes,
];
