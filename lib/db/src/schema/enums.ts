import { pgEnum } from "drizzle-orm/pg-core";

export const environmentModeEnum = pgEnum("environment_mode", [
  "paper",
  "live",
]);
export const brokerProviderEnum = pgEnum("broker_provider", ["ibkr"]);
export const marketDataProviderEnum = pgEnum("market_data_provider", [
  "polygon",
]);
export const connectionTypeEnum = pgEnum("connection_type", [
  "broker",
  "market_data",
]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "configured",
  "connected",
  "disconnected",
  "error",
]);
export const assetClassEnum = pgEnum("asset_class", ["equity", "option"]);
export const optionRightEnum = pgEnum("option_right", ["call", "put"]);
export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const orderTypeEnum = pgEnum("order_type", [
  "market",
  "limit",
  "stop",
  "stop_limit",
]);
export const timeInForceEnum = pgEnum("time_in_force", [
  "day",
  "gtc",
  "ioc",
  "fok",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending_submit",
  "submitted",
  "accepted",
  "partially_filled",
  "filled",
  "canceled",
  "rejected",
  "expired",
]);
export const flowSentimentEnum = pgEnum("flow_sentiment", [
  "bullish",
  "bearish",
  "neutral",
]);
export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "high",
  "critical",
]);
export const algoRunStatusEnum = pgEnum("algo_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export const backtestJobStatusEnum = pgEnum("backtest_job_status", [
  "queued",
  "preparing_data",
  "running",
  "aggregating",
  "completed",
  "failed",
  "cancel_requested",
  "canceled",
]);
export const backtestOptimizerModeEnum = pgEnum("backtest_optimizer_mode", [
  "grid",
  "random",
  "walk_forward",
]);
export const backtestDirectionModeEnum = pgEnum("backtest_direction_mode", [
  "long_only",
  "long_short",
]);
export const pineScriptStatusEnum = pgEnum("pine_script_status", [
  "draft",
  "ready",
  "error",
  "archived",
]);
export const pineScriptPaneTypeEnum = pgEnum("pine_script_pane_type", [
  "price",
  "lower",
]);
