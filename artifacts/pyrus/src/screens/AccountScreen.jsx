import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calculateTransferAdjustedReturnSeries } from "@workspace/account-math";
import {
  getGetAccountAllocationQueryOptions,
  getGetAccountEquityHistoryQueryOptions,
  getGetAccountOrdersQueryOptions,
  getGetAccountPositionsQueryOptions,
  getGetAccountRiskQueryOptions,
  getGetAccountSummaryQueryOptions,
  getGetSnapTradeAccountPortfolioQueryKey,
  getGetSnapTradeRecentOrdersQueryKey,
  useCancelAccountOrder,
  useGetAccountAllocation,
  useGetAccountCashActivity,
  useGetAccountClosedTrades,
  useGetAccountEquityHistory,
  useGetAccountOrders,
  useGetAccountPositions,
  useGetAccountPositionsAtDate,
  useGetAccountRisk,
  useGetAccountSummary,
  useGetSnapTradeAccountPortfolio,
  useGetSnapTradeRecentOrders,
  useGetFlexHealth,
  useListAlgoDeployments,
  useTestFlexToken,
} from "@workspace/api-client-react";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  getAccountPerformanceCalendarEquityQueryKey,
  useAccountPageSnapshotStream,
  useBrokerStreamFreshnessStatus,
} from "../features/platform/live-streams";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import { useToast } from "../features/platform/platformContexts.jsx";
import DeferredRender from "../components/platform/DeferredRender";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import { StatTile } from "../components/platform/primitives.jsx";
import { Button } from "../components/ui/Button.jsx";
import { platformJsonRequest } from "../features/platform/platformJsonRequest";
import { parseRetryAfterMs } from "../features/platform/queryDefaults";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { useAuthSession } from "../features/auth/authSession.jsx";
import {
  responsiveFlags,
  useElementSize,
  useViewport,
} from "../lib/responsive";
import { retryDynamicImport } from "../lib/dynamicImport";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  PYRUS_STORAGE_KEY,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import { formatAppDateTime } from "../lib/timeZone";
import {
  PositionOptionQuoteStreams,
  buildPositionOptionQuoteGroups,
} from "./account/PositionOptionQuoteStreams.jsx";
import { getOpenPositionRows } from "../features/account/accountPositionRows.js";
import {
  ORDER_BLOTTER_CANCELLATION_AVAILABLE,
  ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON,
} from "../features/account/positionOrderActions.js";
import {
  accountPositionTypeParam,
  normalizeAccountPositionTypeFilter,
} from "../features/account/accountPositionTypes";
import { ACCOUNT_RANGES, normalizeAccountRange } from "./account/accountRanges";
import {
  EmptyState,
  Panel,
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
} from "./account/accountUtils";
import {
  buildAccountAnalysisQueryParams,
  defaultTradingAnalysisFilters,
  tradingAnalysisFilterReducer,
} from "./account/tradingAnalysisFilters";
import {
  ACCOUNT_REFRESH_INTERVALS,
  buildAccountPageRestFallback,
  buildAccountRefreshPolicy,
} from "./account/accountRefreshPolicy";
import {
  accountMarketDateKey,
  accountMarketDateNoonMs,
  buildPerformanceCalendarParams,
  resolveReturnsCalendarData,
} from "./account/accountCalendarData";
import { resolveAccountPnlMarketCalendar } from "./account/accountPnlCalendarModel.js";
import { resolveCompleteAccountCurrency } from "./account/accountCurrency.js";
import {
  buildSafeQaPortfolioExposureFixture,
  getSafeQaInitialQueryOptions,
} from "./account/accountSafeQaFixtures.js";
import { useAccountTab } from "../features/platform/useAccountTab.js";
import { AccountTabs } from "./account/AccountTabs.jsx";
import TodaySnapshotPanel from "./account/TodaySnapshotPanel.jsx";
import TaxCenterPanel from "./account/TaxCenterPanel.jsx";
import { OrdersPanel } from "./account/TradesOrdersPanel.jsx";
import {
  buildIdleAccountQuery,
  buildProviderAccountQuery,
  buildSnapTradeAccountPanelData,
  resolveAccountProviderScope,
} from "./account/snapTradeAccountPanelModel.js";
import { cancelSnapTradeOrderRequest } from "./account/snapTradeOrderCancelRequest.js";
import { AccountHeroBlock } from "./account/AccountHeroBlock";
import { AccountReturnsPanel } from "./account/AccountReturnsPanel";
import PositionsPanel, {
  PositionsAtDateInspector,
} from "./account/PositionsPanel";

const EMPTY_ACCOUNT_ORDERS = Object.freeze([]);
const EMPTY_ACCOUNT_TRADES = Object.freeze([]);

let cashFundingPanelImport = null;
const loadCashFundingPanel = () => {
  if (!cashFundingPanelImport) {
    cashFundingPanelImport = retryDynamicImport(
      () => import("./account/CashFundingPanel"),
      { label: "CashFundingPanel" },
    ).catch((error) => {
      cashFundingPanelImport = null;
      throw error;
    });
  }
  return cashFundingPanelImport;
};
let setupHealthPanelImport = null;
const loadSetupHealthPanel = () => {
  if (!setupHealthPanelImport) {
    setupHealthPanelImport = retryDynamicImport(
      () => import("./account/SetupHealthPanel"),
      { label: "SetupHealthPanel" },
    ).catch((error) => {
      setupHealthPanelImport = null;
      throw error;
    });
  }
  return setupHealthPanelImport;
};

// Chart panels carry the heavy chart vendors (recharts via PortfolioExposurePanel,
// lightweight-charts via EquityCurvePanel/EquityCurveChart). Loading them lazily
// keeps those vendors out of the AccountScreen entry chunk so the account chrome
// + positions table paint first while the charts stream into their existing
// DeferredPanelSuspense fallbacks.
let portfolioExposurePanelImport = null;
const loadPortfolioExposurePanel = () => {
  if (!portfolioExposurePanelImport) {
    portfolioExposurePanelImport = retryDynamicImport(
      () => import("./account/PortfolioExposurePanel"),
      { label: "PortfolioExposurePanel" },
    ).catch((error) => {
      portfolioExposurePanelImport = null;
      throw error;
    });
  }
  return portfolioExposurePanelImport;
};
let equityCurvePanelImport = null;
const loadEquityCurvePanel = () => {
  if (!equityCurvePanelImport) {
    equityCurvePanelImport = retryDynamicImport(
      () => import("./account/EquityCurvePanel"),
      { label: "EquityCurvePanel" },
    ).catch((error) => {
      equityCurvePanelImport = null;
      throw error;
    });
  }
  return equityCurvePanelImport;
};
// TradingAnalysisWorkbench also pulls recharts; lazy-load it so recharts stays
// off the Account cold path entirely (it already renders inside a
// DeferredPanelSuspense boundary). Default export, so no named-export mapping.
let tradingAnalysisWorkbenchImport = null;
const loadTradingAnalysisWorkbench = () => {
  if (!tradingAnalysisWorkbenchImport) {
    tradingAnalysisWorkbenchImport = retryDynamicImport(
      () => import("./account/TradingAnalysisWorkbench.jsx"),
      { label: "TradingAnalysisWorkbench" },
    ).catch((error) => {
      tradingAnalysisWorkbenchImport = null;
      throw error;
    });
  }
  return tradingAnalysisWorkbenchImport;
};

const LazyCashFundingPanel = lazy(loadCashFundingPanel);
const LazySetupHealthPanel = lazy(loadSetupHealthPanel);
const LazyPortfolioExposurePanel = lazy(() =>
  loadPortfolioExposurePanel().then((mod) => ({
    default: mod.PortfolioExposurePanel,
  })),
);
const LazyEquityCurvePanel = lazy(() =>
  loadEquityCurvePanel().then((mod) => ({ default: mod.EquityCurvePanel })),
);
const LazyTradingAnalysisWorkbench = lazy(loadTradingAnalysisWorkbench);
export const preloadScreenModules = () =>
  Promise.all([
    loadCashFundingPanel(),
    loadSetupHealthPanel(),
    loadPortfolioExposurePanel(),
    loadEquityCurvePanel(),
    loadTradingAnalysisWorkbench(),
  ]).then(() => undefined);

const finiteAccountNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const withoutFailedQueryData = (query) =>
  query?.isError ? { ...query, data: undefined } : query;

const accountMetricMarketDate = (metric) => {
  const explicit =
    typeof metric?.marketDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(metric.marketDate)
      ? metric.marketDate
      : null;
  if (explicit) return explicit;
  const fieldMatch = /(\d{4}-\d{2}-\d{2})/.exec(String(metric?.field || ""));
  if (fieldMatch?.[1]) return fieldMatch[1];
  return accountMarketDateKey(metric?.updatedAt);
};

const livePositionsNetLiquidation = (
  positionsResponse,
  fallbackValue = null,
) => {
  const totals = positionsResponse?.totals || {};
  const netLiquidation = finiteAccountNumber(totals.netLiquidation);
  if (netLiquidation != null) {
    return netLiquidation;
  }
  const cash = finiteAccountNumber(
    totals.cash ?? totals.totalCash ?? totals.totalCashValue,
  );
  const netExposure = finiteAccountNumber(totals.netExposure);
  if (cash != null && netExposure != null) {
    return cash + netExposure;
  }
  return finiteAccountNumber(fallbackValue);
};

export const equityQueryWithLivePositionsTerminal = ({
  query,
  netLiquidation,
  currency,
  updatedAt,
}) => {
  const data = query?.data;
  const nav = finiteAccountNumber(netLiquidation);
  if (!data || nav == null) {
    return query;
  }

  const timestampMs =
    updatedAt == null || updatedAt === ""
      ? null
      : new Date(updatedAt).getTime();
  const terminalCurrency = resolveCompleteAccountCurrency([
    data.currency,
    currency,
  ]);
  if (timestampMs == null || !Number.isFinite(timestampMs) || !terminalCurrency) {
    return query;
  }
  const timestamp = new Date(timestampMs).toISOString();
  const existingPoints = Array.isArray(data.points) ? data.points : [];
  const lastPoint = existingPoints[existingPoints.length - 1] || null;
  const terminalMs = new Date(timestamp).getTime();
  const lastPointMs = new Date(lastPoint?.timestamp).getTime();
  const replacesLastPoint =
    Number.isFinite(terminalMs) &&
    Number.isFinite(lastPointMs) &&
    terminalMs === lastPointMs;
  const terminalPoint = {
    ...(replacesLastPoint ? lastPoint : {}),
    timestamp,
    netLiquidation: nav,
    currency: terminalCurrency,
    source: "LIVE_POSITIONS",
    deposits: replacesLastPoint
      ? finiteAccountNumber(lastPoint?.deposits)
      : null,
    withdrawals: replacesLastPoint
      ? finiteAccountNumber(lastPoint?.withdrawals)
      : null,
    dividends: replacesLastPoint
      ? finiteAccountNumber(lastPoint?.dividends)
      : null,
    fees: replacesLastPoint ? finiteAccountNumber(lastPoint?.fees) : null,
    benchmarkPercent: replacesLastPoint
      ? lastPoint?.benchmarkPercent ?? null
      : null,
    returnPercent: null,
  };
  const withoutPriorTerminal = existingPoints.filter((point, index) => {
    const pointMs = new Date(point?.timestamp).getTime();
    if (
      Number.isFinite(pointMs) &&
      Number.isFinite(terminalMs) &&
      pointMs === terminalMs
    ) {
      return false;
    }
    return !(
      index === existingPoints.length - 1 &&
      ["IBKR_POSITIONS", "LIVE_POSITIONS"].includes(point?.source)
    );
  });
  const points = [...withoutPriorTerminal, terminalPoint]
    .filter((point) => Number.isFinite(new Date(point?.timestamp).getTime()))
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
  const cashFlowPopulationComplete = points.every(
    (point) =>
      finiteAccountNumber(point?.deposits) != null &&
      finiteAccountNumber(point?.withdrawals) != null &&
      finiteAccountNumber(point?.dividends) != null &&
      finiteAccountNumber(point?.fees) != null,
  );
  const adjusted = cashFlowPopulationComplete
    ? calculateTransferAdjustedReturnSeries(points)
    : null;
  return {
    ...query,
    data: {
      ...data,
      currency: terminalCurrency,
      asOf: timestamp,
      terminalPointSource: "live_positions",
      liveTerminalIncluded: true,
      points: points.map((point, index) => ({
        ...point,
        returnPercent: adjusted
          ? adjusted[index]?.returnPercent ?? null
          : point.returnPercent ?? null,
      })),
    },
  };
};

const AccountPanelSuspenseFallback = ({
  detail = "Preparing account data.",
  minHeight = 160,
  title = "Loading account panel",
}) => (
  <div
    className="ra-deferred-render__placeholder"
    role="status"
    aria-live="polite"
    style={{
      minHeight: dim(minHeight),
      display: "grid",
      alignContent: "start",
      gap: sp(6),
      padding: sp("10px 12px"),
      borderRadius: dim(RADII.sm),
      background: CSS_COLOR.bg1,
      color: CSS_COLOR.textSec,
    }}
  >
    <div
      style={{
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontSize: textSize("bodyStrong"),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1.2,
      }}
    >
      {title}
    </div>
    <div
      style={{
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        lineHeight: 1.35,
      }}
    >
      {detail}
    </div>
    <span
      aria-hidden="true"
      className="ra-deferred-render__skeleton ra-skeleton-shimmer"
      style={{ minHeight: dim(Math.max(24, minHeight - 76)) }}
    />
  </div>
);

const DeferredPanelSuspense = ({
  children,
  detail,
  minHeight = 160,
  title,
}) => (
  <PlatformErrorBoundary
    label={title || "Account deferred panel"}
    minHeight={minHeight}
    reportCategory="account-deferred-panel"
    reportSeverity="warning"
  >
    <Suspense
      fallback={
        <AccountPanelSuspenseFallback
          detail={detail}
          minHeight={minHeight}
          title={title}
        />
      }
    >
      {children}
    </Suspense>
  </PlatformErrorBoundary>
);

const ACCOUNT_LIVE_STALE_MS = 15_000;
const ACCOUNT_DERIVED_STALE_MS = 120_000;
const ACCOUNT_RISK_DEGRADED_RETRY_MS = 15_000;

const isDegradedAccountRiskError = (error) => {
  const errorStatus = Number(error?.status ?? error?.response?.status);
  const errorCode = error?.data?.code ?? error?.payload?.code ?? error?.code;
  return errorStatus === 503 && errorCode === "degraded_upstream";
};

const retryDegradedAccountRisk = (failureCount, error) =>
  failureCount < 1 && isDegradedAccountRiskError(error);

const degradedAccountRiskRetryDelay = (_attempt, error) =>
  (Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null) ??
  parseRetryAfterMs(error?.headers?.get?.("retry-after")) ??
  ACCOUNT_RISK_DEGRADED_RETRY_MS;
const ACCOUNT_HISTORY_STALE_MS = 120_000;

const QUERY_OPTIONS = {
  query: {
    staleTime: ACCOUNT_LIVE_STALE_MS,
    refetchInterval: ACCOUNT_LIVE_STALE_MS,
    retry: false,
  },
};
const ACCOUNT_DERIVED_QUERY_OPTIONS = {
  query: {
    staleTime: ACCOUNT_DERIVED_STALE_MS,
    retry: false,
  },
};
const ACCOUNT_SWITCH_PREFETCH_OPTIONS = {
  query: {
    staleTime: 90_000,
    retry: false,
  },
};

const DEFAULT_EQUITY_BENCHMARK_VISIBILITY = {
  SPY: true,
  QQQ: false,
  DJIA: false,
};

const SHADOW_ACCOUNT_ID = "shadow";
const resolveAccountMode = ({ shadowMode = false, environment } = {}) => {
  if (shadowMode) {
    return "shadow";
  }
  return "live";
};

const readAccountWorkspaceDefault = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed[key] ?? fallback;
  } catch {
    return fallback;
  }
};

const writeAccountWorkspaceDefault = (key, value) => {
  try {
    const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(
      PYRUS_STORAGE_KEY,
      JSON.stringify({ ...parsed, [key]: value }),
    );
  } catch {}
};

const ShadowWatchlistBacktestPanel = ({
  mutation,
  currency,
  maskValues = false,
}) => {
  const run = mutation.data;
  const summary = run?.summary || {};
  const sizing = run?.sizing || {};
  const running = mutation.isPending;
  const error = mutation.error;
  const pnl = Number(summary.realizedPnl || 0);
  const runLabel =
    run?.marketDateFrom &&
    run?.marketDateTo &&
    run.marketDateFrom !== run.marketDateTo
      ? `${run.marketDateFrom} -> ${run.marketDateTo}`
      : run?.marketDate || "One-off ledger run";
  return (
    <Panel
      title="Watchlist Backtest"
      rightRail={runLabel}
      minHeight={150}
      error={error}
      action={
        <div style={{ display: "flex", gap: sp(3), flexWrap: "wrap" }}>
          <Button
            variant="primary"
            color={CSS_COLOR.pink}
            size="sm"
            onClick={() => mutation.mutate({ timeframe: "15m" })}
            loading={running}
            dataTestId="shadow-watchlist-backtest-run-today"
          >
            {running ? "Running" : "Today"}
          </Button>
          <Button
            variant="primary"
            color={CSS_COLOR.pink}
            size="sm"
            onClick={() =>
              mutation.mutate({ timeframe: "15m", range: "past_week" })
            }
            disabled={running}
            dataTestId="shadow-watchlist-backtest-run-week"
          >
            Week
          </Button>
          <Button
            variant="primary"
            color={CSS_COLOR.pink}
            size="sm"
            onClick={() =>
              mutation.mutate({ timeframe: "15m", range: "last_month" })
            }
            disabled={running}
            dataTestId="shadow-watchlist-backtest-run-month"
          >
            Month
          </Button>
          <Button
            variant="primary"
            color={CSS_COLOR.pink}
            size="sm"
            onClick={() => mutation.mutate({ timeframe: "15m", range: "ytd" })}
            disabled={running}
            dataTestId="shadow-watchlist-backtest-run-ytd"
          >
            YTD
          </Button>
          <Button
            variant="primary"
            color={CSS_COLOR.cyan}
            size="sm"
            onClick={() =>
              mutation.mutate({ timeframe: "5m", range: "ytd", sweep: true })
            }
            disabled={running}
            dataTestId="shadow-watchlist-backtest-run-ytd-5m-sweep"
          >
            5m Sweep
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: sp(6) }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
          <Pill tone="pink">Watchlist Backtest</Pill>
          <Pill tone="green">Spot Equity</Pill>
          <Pill tone="cyan">{run?.timeframe || "15m"} Pyrus Signals</Pill>
          {run?.sweep ? <Pill tone="purple">Regime Sweep</Pill> : null}
          <Pill tone="purple">Ledger Synthetic</Pill>
        </div>
        <div
          style={{
            color: CSS_COLOR.textSec,
            fontSize: textSize("caption"),
            lineHeight: 1.35,
          }}
        >
          Runs all saved watchlists from the New York regular-session open
          through the latest completed bar in the selected window. Rows are
          written as synthetic Shadow ledger activity, isolated from prior
          backtest rows, and sized around current Shadow exposure.
        </div>
        {run ? (
          <>
            <div
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                overflowX: "auto",
                background: CSS_COLOR.bg0,
                borderRadius: dim(RADII.xs),
                minWidth: 0,
              }}
            >
              {[
                ["Signals", summary.signals, CSS_COLOR.cyan],
                ["Orders", summary.ordersCreated, CSS_COLOR.text],
                ["Open", summary.openSyntheticPositions, CSS_COLOR.purple],
                ["Skipped", summary.skippedSignals, CSS_COLOR.amber],
              ].map(([label, value, tone], index, arr) => (
                <StatTile
                  key={label}
                  label={label}
                  value={formatNumber(value || 0, 0)}
                  tone={tone}
                  minWidth={64}
                  divider={index < arr.length - 1}
                />
              ))}
            </div>
            <div
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                overflowX: "auto",
                gap: sp(8),
                color: CSS_COLOR.textSec,
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                minWidth: 0,
              }}
            >
              <span style={{ flexShrink: 0 }}>
                P&L{" "}
                <span
                  style={{
                    color: pnl >= 0 ? CSS_COLOR.green : CSS_COLOR.red,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {formatAccountMoney(
                    summary.realizedPnl,
                    currency,
                    true,
                    maskValues,
                  )}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Fees{" "}
                {formatAccountMoney(summary.fees, currency, true, maskValues)}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Cap{" "}
                {formatAccountPercent(
                  (sizing.maxPositionFraction || 0) * 100,
                  0,
                  maskValues,
                )}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Win{" "}
                {formatAccountPercent(summary.winRatePercent, 0, maskValues)}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Exp{" "}
                <span
                  style={{
                    color:
                      Number(summary.expectancy || 0) >= 0
                        ? CSS_COLOR.green
                        : CSS_COLOR.red,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {formatAccountMoney(
                    summary.expectancy,
                    currency,
                    true,
                    maskValues,
                  )}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Closed {formatNumber(summary.closedTrades || 0, 0)}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                NAV{" "}
                <span
                  style={{
                    color: CSS_COLOR.green,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {formatAccountMoney(
                    summary.endingNetLiquidation,
                    currency,
                    true,
                    maskValues,
                  )}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Max DD{" "}
                <span
                  style={{
                    color: CSS_COLOR.red,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {formatAccountPercent(
                    summary.maxDrawdownPercent,
                    1,
                    maskValues,
                  )}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Proxy fills {formatNumber(summary.proxyFills || 0, 0)}
              </span>
            </div>
            {run.sweep ? (
              <div
                style={{
                  border: "none",
                  borderRadius: dim(RADII.xs),
                  background: CSS_COLOR.bg0,
                  padding: sp(6),
                  display: "grid",
                  gap: sp(4),
                }}
              >
                <div
                  style={{
                    color: CSS_COLOR.text,
                    fontSize: textSize("caption"),
                    fontFamily: T.sans,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  Winner {run.sweep.winnerId || "n/a"} ·{" "}
                  {formatNumber(run.sweep.variantCount || 0, 0)} variants ·
                  highest NAV
                </div>
                {(run.sweep.variants || []).slice(0, 3).map((variant) => (
                  <div
                    key={variant.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(0, 1.5fr) repeat(4, minmax(0, 0.7fr))",
                      gap: sp(4),
                      color:
                        variant.rank === 1
                          ? CSS_COLOR.green
                          : CSS_COLOR.textSec,
                      fontSize: textSize("body"),
                      fontFamily: T.sans,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      #{variant.rank} {variant.id}
                    </span>
                    <span>
                      {formatAccountMoney(
                        variant.summary?.endingNetLiquidation,
                        currency,
                        true,
                        maskValues,
                      )}
                    </span>
                    <span>
                      DD{" "}
                      {formatAccountPercent(
                        variant.summary?.maxDrawdownPercent,
                        1,
                        maskValues,
                      )}
                    </span>
                    <span>
                      Win{" "}
                      {formatAccountPercent(
                        variant.summary?.winRatePercent,
                        0,
                        maskValues,
                      )}
                    </span>
                    <span>
                      {formatNumber(variant.summary?.ordersCreated || 0, 0)}{" "}
                      fills
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <div
              style={{
                color: CSS_COLOR.textDim,
                fontSize: textSize("body"),
                fontFamily: T.sans,
              }}
            >
              {formatAppDateTime(run.window?.start)}
              {" -> "}
              {formatAppDateTime(run.window?.end)}
              {" · "}
              {formatNumber(run.universe?.symbolCount || 0, 0)} symbols across{" "}
              {formatNumber(run.universe?.watchlistCount || 0, 0)} watchlists
            </div>
          </>
        ) : (
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontSize: textSize("caption"),
              fontFamily: T.sans,
            }}
          >
            No run has been executed in this browser session.
          </div>
        )}
      </div>
    </Panel>
  );
};

const AccountScreenInner = ({
  session,
  accounts = [],
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "Connect your broker before trading.",
  safeQaMode = false,
  isVisible = false,
  onJumpToTrade,
  onReadinessChange,
}) => {
  const queryClient = useQueryClient();
  const authSession = useAuthSession();
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const maskAccountValues = Boolean(
    userPreferences.appearance.maskBalances ||
      userPreferences.privacy.hideAccountValues,
  );
  const [range, setRange] = useState(() =>
    normalizeAccountRange(readAccountWorkspaceDefault("accountRange", "ALL")),
  );
  const [assetFilter, setAssetFilter] = useState(() =>
    normalizeAccountPositionTypeFilter(
      readAccountWorkspaceDefault("accountAssetFilter", "all"),
    ),
  );
  const [sourceFilter, setSourceFilter] = useState(() =>
    readAccountWorkspaceDefault("accountSourceFilter", "all"),
  );
  const [orderTab, setOrderTab] = useState(() =>
    readAccountWorkspaceDefault("accountOrderTab", "working"),
  );
  const [tradeFilters, dispatchTradeFilters] = useReducer(
    tradingAnalysisFilterReducer,
    undefined,
    defaultTradingAnalysisFilters,
  );
  const [selectedAccountTradeId, setSelectedAccountTradeId] = useState("");
  const [todayView, setTodayView] = useState("heatmap");
  const [tradingAnalysisView, setTradingAnalysisView] = useState("patterns");
  const [accountAnalysisNowMs, setAccountAnalysisNowMs] = useState(() =>
    Date.now(),
  );
  const [hoveredEquityDate, setHoveredEquityDate] = useState(null);
  const [pinnedEquityDate, setPinnedEquityDate] = useState(null);
  const [activatedAccountPanels, setActivatedAccountPanels] = useState({});
  const [visibleEquityBenchmarks, setVisibleEquityBenchmarks] = useState(
    DEFAULT_EQUITY_BENCHMARK_VISIBILITY,
  );
  const [accountLayoutRef, accountLayoutSize] = useElementSize();
  const accountElementFlags = responsiveFlags(accountLayoutSize.width);
  const viewport = useViewport();
  const accountIsPhone = viewport.flags.isPhone || accountElementFlags.isPhone;
  const accountIsNarrow =
    viewport.flags.isNarrow || accountElementFlags.isNarrow;
  // The account tab strip subsumes the old real/shadow SegmentedControl AND
  // account selection: tab id is "all" (cross-account aggregate) | <account.id>
  // | "shadow". It owns this state locally rather than reading the header's
  // selected-account prop, so it is the primary in-page account selector.
  const [accountTabRaw, setAccountTab] = useAccountTab();
  const accountTab = useMemo(() => {
    if (accountTabRaw === "all" || accountTabRaw === "shadow") {
      return accountTabRaw;
    }
    // A persisted account-id tab that is no longer in the live list (or a list
    // that has not loaded yet) falls back to the "All" aggregate.
    return accounts.some((account) => account.id === accountTabRaw)
      ? accountTabRaw
      : "all";
  }, [accountTabRaw, accounts]);
  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === accountTab) || null,
    [accountTab, accounts],
  );
  const returnsCalendarMarketCalendar = useMemo(
    () => resolveAccountPnlMarketCalendar({ accountTab, accounts }),
    [accountTab, accounts],
  );
  const accountDeploymentsQuery = useListAlgoDeployments(undefined, {
    query: {
      enabled: Boolean(isVisible && !safeQaMode),
      staleTime: 30_000,
      retry: false,
    },
  });
  const accountDeploymentInventoryState =
    !isVisible || safeQaMode
      ? "idle"
      : accountDeploymentsQuery.data
        ? "ready"
        : accountDeploymentsQuery.isError
          ? "unavailable"
          : "loading";
  const accountProviderScope = useMemo(
    () => resolveAccountProviderScope({ accountTab, accounts }),
    [accountTab, accounts],
  );
  useEffect(() => {
    writeAccountWorkspaceDefault("accountRange", range);
  }, [range]);

  useEffect(() => {
    const normalizedAssetFilter =
      normalizeAccountPositionTypeFilter(assetFilter);
    if (normalizedAssetFilter !== assetFilter) {
      setAssetFilter(normalizedAssetFilter);
      return;
    }
    writeAccountWorkspaceDefault("accountAssetFilter", normalizedAssetFilter);
  }, [assetFilter]);

  useEffect(() => {
    writeAccountWorkspaceDefault("accountSourceFilter", sourceFilter);
  }, [sourceFilter]);

  useEffect(() => {
    writeAccountWorkspaceDefault("accountOrderTab", orderTab);
  }, [orderTab]);

  useEffect(() => {
    if (accountTab === "shadow" && orderTab === "working") {
      setOrderTab("history");
    }
  }, [accountTab, orderTab]);

  useEffect(() => {
    const listener = () => {
      setRange(
        normalizeAccountRange(
          readAccountWorkspaceDefault("accountRange", "ALL"),
        ),
      );
      setAssetFilter(
        normalizeAccountPositionTypeFilter(
          readAccountWorkspaceDefault("accountAssetFilter", "all"),
        ),
      );
      setSourceFilter(
        readAccountWorkspaceDefault("accountSourceFilter", "all"),
      );
      setOrderTab(readAccountWorkspaceDefault("accountOrderTab", "working"));
    };
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
    };
  }, []);

  const markAccountPanelActivated = useCallback((panelId) => {
    setActivatedAccountPanels((current) =>
      current[panelId] ? current : { ...current, [panelId]: true },
    );
  }, []);

  // "all" and "shadow" both resolve to the server "combined" cross-account
  // aggregate for activeAccountId; a specific account tab resolves to its id.
  // accountRequestId then swaps in the shadow ledger for the shadow tab.
  const activeAccountId =
    accountTab === "all" || accountTab === "shadow" ? "combined" : accountTab;
  const shadowMode = accountTab === "shadow";
  const selectedSnapTradeAccount =
    !shadowMode &&
    accountProviderScope === "snaptrade" &&
    activeAccountId !== "combined"
      ? activeAccount
      : null;
  const snapTradeAccountPanelsEnabled = Boolean(
    isVisible && !safeQaMode && selectedSnapTradeAccount?.id,
  );
  const effectiveOrderTab =
    shadowMode && orderTab === "working" ? "history" : orderTab;
  const accountRequestId = shadowMode ? SHADOW_ACCOUNT_ID : activeAccountId;
  const ibkrAccountRoutesAvailable = Boolean(
    !safeQaMode &&
      brokerConfigured &&
      brokerAuthenticated &&
      activeAccountId &&
      accountProviderScope !== "snaptrade",
  );
  const providerBackedAccountRoutesAvailable = Boolean(
    !safeQaMode &&
      activeAccountId &&
      accountProviderScope !== "unknown" &&
      accountProviderScope !== "shadow" &&
      (accountProviderScope === "snaptrade" ||
        accountProviderScope === "robinhood" ||
        accountProviderScope === "schwab" ||
        accountProviderScope === "mixed"),
  );
  const genericRealAccountDataEnabled = Boolean(
    isVisible &&
      !safeQaMode &&
      !shadowMode &&
      (ibkrAccountRoutesAvailable || providerBackedAccountRoutesAvailable) &&
      accountRequestId,
  );
  const genericAccountQueriesEnabled = Boolean(
    isVisible &&
      !safeQaMode &&
      accountRequestId &&
      (shadowMode || genericRealAccountDataEnabled),
  );
  const modeParams = useMemo(
    () => ({
      mode: resolveAccountMode({ shadowMode, environment }),
    }),
    [environment, shadowMode],
  );
  // Live position management needs a single concrete account; the "All"
  // aggregate ("combined") and shadow tabs have no manageable broker account.
  const positionManagementAccountId =
    shadowMode || activeAccountId === "combined" ? null : activeAccountId;
  const positionManagementGatewayReady = Boolean(
    !shadowMode && gatewayTradingReady,
  );
  const positionManagementGatewayMessage = shadowMode
    ? "Shadow positions cannot be managed with live broker orders."
    : gatewayTradingMessage;
  const riskParams = useMemo(
    () => ({
      ...modeParams,
      detail: "fast",
    }),
    [modeParams],
  );
  const providerAccountSourceLabel = {
    robinhood: "Robinhood",
    schwab: "Schwab",
  }[accountProviderScope];
  const accountSourceLabel = snapTradeAccountPanelsEnabled
    ? "SnapTrade"
    : shadowMode
      ? "Shadow Ledger"
      : (providerAccountSourceLabel ?? "Flex");
  const accountDataParams = useMemo(() => ({ ...modeParams }), [modeParams]);
  const safeQaExposureFixture = useMemo(
    () =>
      safeQaMode
        ? buildSafeQaPortfolioExposureFixture({
            accountId: accountRequestId,
            currency: "USD",
          })
        : null,
    [accountRequestId, safeQaMode],
  );
  const safeQaShadowSummary = useMemo(
    () =>
      safeQaMode
        ? buildSafeQaPortfolioExposureFixture({
            accountId: SHADOW_ACCOUNT_ID,
            currency: "USD",
          }).summary
        : null,
    [safeQaMode],
  );
  const equityHistoryQuerySettings = useMemo(
    () => ({
      staleTime: ACCOUNT_HISTORY_STALE_MS,
      retry: false,
    }),
    [],
  );
  const closedTradeParams = useMemo(
    () =>
      buildAccountAnalysisQueryParams({
        modeParams: accountDataParams,
        filters: tradeFilters,
        range,
        nowMs: accountAnalysisNowMs,
      }),
    [accountAnalysisNowMs, accountDataParams, range, tradeFilters],
  );
  const heroTradeParams = useMemo(
    () =>
      buildAccountAnalysisQueryParams({
        modeParams: accountDataParams,
        filters: defaultTradingAnalysisFilters(),
        range,
        nowMs: accountAnalysisNowMs,
      }),
    [accountAnalysisNowMs, accountDataParams, range],
  );
  const performanceCalendarParams = useMemo(
    () => buildPerformanceCalendarParams(accountDataParams),
    [accountDataParams],
  );
  const getAccountTabRequest = useCallback(
    (tab) => {
      const nextShadowMode = tab === "shadow";
      const nextAccountId = nextShadowMode
        ? SHADOW_ACCOUNT_ID
        : tab === "all"
          ? "combined"
          : tab;
      if (!nextAccountId) {
        return null;
      }
      return {
        accountId: nextAccountId,
        mode: resolveAccountMode({
          shadowMode: nextShadowMode,
          environment,
        }),
        orderTab:
          nextShadowMode && orderTab === "working" ? "history" : orderTab,
        assetClass: accountPositionTypeParam(assetFilter),
      };
    },
    [assetFilter, environment, orderTab],
  );
  const prefetchAccountTabLiveQueries = useCallback(
    (tab) => {
      if (!isVisible || safeQaMode || !tab) {
        return;
      }
      const target = getAccountTabRequest(tab);
      if (!target) {
        return;
      }
      const targetProviderScope = resolveAccountProviderScope({
        accountTab: tab,
        accounts,
      });
      if (targetProviderScope !== "shadow" && !genericAccountQueriesEnabled) {
        return;
      }

      const mode = { mode: target.mode };
      const positionsParams = {
        ...mode,
        assetClass: target.assetClass,
      };
      const queryOptions = [
        getGetAccountSummaryQueryOptions(
          target.accountId,
          mode,
          ACCOUNT_SWITCH_PREFETCH_OPTIONS,
        ),
        getGetAccountAllocationQueryOptions(
          target.accountId,
          mode,
          ACCOUNT_SWITCH_PREFETCH_OPTIONS,
        ),
        getGetAccountRiskQueryOptions(
          target.accountId,
          { ...mode, detail: "fast" },
          ACCOUNT_SWITCH_PREFETCH_OPTIONS,
        ),
        getGetAccountPositionsQueryOptions(
          target.accountId,
          {
            ...positionsParams,
            detail: "fast",
            liveQuotes: false,
          },
          ACCOUNT_SWITCH_PREFETCH_OPTIONS,
        ),
        getGetAccountOrdersQueryOptions(
          target.accountId,
          {
            ...mode,
            tab: target.orderTab,
          },
          ACCOUNT_SWITCH_PREFETCH_OPTIONS,
        ),
        getGetAccountEquityHistoryQueryOptions(
          target.accountId,
          {
            ...mode,
            range: "1D",
          },
          ACCOUNT_SWITCH_PREFETCH_OPTIONS,
        ),
      ];

      queryOptions.forEach((options) => {
        queryClient.prefetchQuery(options);
      });
    },
    [
      accounts,
      genericAccountQueriesEnabled,
      getAccountTabRequest,
      isVisible,
      queryClient,
      safeQaMode,
    ],
  );
  const brokerStreamFreshness = useBrokerStreamFreshnessStatus(
    genericRealAccountDataEnabled,
  );
  const accountPageStreamEnabled = Boolean(
    isVisible && genericAccountQueriesEnabled,
  );
  const accountPageStreamFreshness = useAccountPageSnapshotStream({
    accountId: accountRequestId,
    mode: modeParams.mode,
    range,
    assetClass: accountPositionTypeParam(assetFilter),
    tradeFilters: {
      from: heroTradeParams.from,
      to: heroTradeParams.to,
      symbol: heroTradeParams.symbol,
      assetClass: heroTradeParams.assetClass,
      pnlSign: heroTradeParams.pnlSign,
      holdDuration: heroTradeParams.holdDuration,
    },
    performanceCalendarFrom: performanceCalendarParams.from,
    includeIntraday: Boolean(
      activatedAccountPanels.today && todayView === "intraday",
    ),
    includeWorkingOrders: Boolean(
      activatedAccountPanels.orders && effectiveOrderTab === "working",
    ),
    includeSetupHealth: Boolean(
      activatedAccountPanels.support && !shadowMode,
    ),
    includeSpyBenchmark: Boolean(visibleEquityBenchmarks.SPY),
    includeQqqBenchmark: Boolean(visibleEquityBenchmarks.QQQ),
    includeDiaBenchmark: Boolean(visibleEquityBenchmarks.DJIA),
    enabled: accountPageStreamEnabled,
  });
  const accountPageRestFallback = useMemo(
    () =>
      buildAccountPageRestFallback({
        streamRequested: accountPageStreamEnabled,
        bootstrapping: accountPageStreamFreshness.accountBootstrapping,
        primaryFresh: accountPageStreamFreshness.accountPrimaryFresh,
        liveFresh: accountPageStreamFreshness.accountLiveFresh,
        derivedFresh: accountPageStreamFreshness.accountDerivedFresh,
      }),
    [
      accountPageStreamEnabled,
      accountPageStreamFreshness.accountBootstrapping,
      accountPageStreamFreshness.accountDerivedFresh,
      accountPageStreamFreshness.accountLiveFresh,
      accountPageStreamFreshness.accountPrimaryFresh,
    ],
  );
  const accountTimingStagesRef = useRef(new Set());
  useEffect(() => {
    if (!isVisible) {
      accountTimingStagesRef.current = new Set();
    }
  }, [isVisible]);
  useEffect(() => {
    onReadinessChange?.({
      contentReady: Boolean(isVisible),
      primaryReady: Boolean(isVisible),
      derivedReady: Boolean(isVisible),
      backgroundAllowed: Boolean(isVisible && !safeQaMode),
    });
  }, [isVisible, onReadinessChange, safeQaMode]);
  const markAccountTiming = useCallback((stage, detail) => {
    if (accountTimingStagesRef.current.has(stage)) {
      return;
    }
    accountTimingStagesRef.current.add(stage);
    markRouteDataTiming("account", stage, detail);
  }, []);
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    markAccountTiming("route-module-loaded");
  }, [isVisible, markAccountTiming]);
  useEffect(() => {
    if (
      !isVisible ||
      (accountPageStreamEnabled &&
        !accountPageStreamFreshness.accountPrimaryFresh &&
        !accountPageRestFallback.primary)
    ) {
      return;
    }
    markAccountTiming("primary-data-ready", {
      source: accountPageStreamFreshness.accountPrimaryFresh
        ? "stream"
        : "rest",
    });
  }, [
    accountPageStreamEnabled,
    accountPageStreamFreshness.accountPrimaryFresh,
    accountPageRestFallback.primary,
    isVisible,
    markAccountTiming,
  ]);
  useEffect(() => {
    if (
      !isVisible ||
      (accountPageStreamEnabled &&
        !accountPageStreamFreshness.accountDerivedFresh &&
        !accountPageRestFallback.derived)
    ) {
      return;
    }
    markAccountTiming("derived-data-ready", {
      source: accountPageStreamFreshness.accountDerivedFresh
        ? "stream"
        : "rest",
    });
  }, [
    accountPageStreamEnabled,
    accountPageStreamFreshness.accountDerivedFresh,
    accountPageRestFallback.derived,
    isVisible,
    markAccountTiming,
  ]);
  const refreshPolicy = useMemo(
    () =>
      buildAccountRefreshPolicy({
        isVisible,
        accountPageStreamFresh: accountPageStreamFreshness.accountPrimaryFresh,
        accountStreamFresh: brokerStreamFreshness.accountFresh,
        orderStreamFresh: brokerStreamFreshness.orderFresh,
        shadowMode,
      }),
    [
      accountPageStreamFreshness.accountPrimaryFresh,
      brokerStreamFreshness.accountFresh,
      brokerStreamFreshness.orderFresh,
      isVisible,
      shadowMode,
    ],
  );
  const liveRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.live
      ? ACCOUNT_REFRESH_INTERVALS.primaryFallback
      : false
    : refreshPolicy.primary;
  const primaryRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.primary
      ? ACCOUNT_REFRESH_INTERVALS.primaryFallback
      : false
    : refreshPolicy.primary;
  const primarySecondaryRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.primary
      ? ACCOUNT_REFRESH_INTERVALS.secondaryFallback
      : false
    : refreshPolicy.secondary;
  const secondaryRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.derived
      ? ACCOUNT_REFRESH_INTERVALS.secondaryFallback
      : false
    : refreshPolicy.secondary;
  const tradesRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.derived
      ? ACCOUNT_REFRESH_INTERVALS.tradesFallback
      : false
    : refreshPolicy.trades;
  const chartRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.derived
      ? ACCOUNT_REFRESH_INTERVALS.chart
      : false
    : refreshPolicy.chart;
  const healthRefreshInterval = accountPageStreamEnabled
    ? accountPageRestFallback.derived
      ? refreshPolicy.health
      : false
    : refreshPolicy.health;
  const snapTradeRefreshInterval = snapTradeAccountPanelsEnabled
    ? ACCOUNT_REFRESH_INTERVALS.primaryFallback
    : false;
  const analysisOrderHistoryNeeded = Boolean(
    activatedAccountPanels.tradingAnalysis &&
      tradingAnalysisView === "trades" &&
      selectedAccountTradeId,
  );
  const snapTradePortfolioQuery = useGetSnapTradeAccountPortfolio(
    selectedSnapTradeAccount?.id || "",
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: snapTradeRefreshInterval,
        enabled: snapTradeAccountPanelsEnabled,
      },
    },
  );
  const snapTradeRecentOrdersQuery = useGetSnapTradeRecentOrders(
    selectedSnapTradeAccount?.id || "",
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval:
          activatedAccountPanels.orders && effectiveOrderTab === "working"
            ? snapTradeRefreshInterval
            : false,
        enabled: Boolean(
          snapTradeAccountPanelsEnabled &&
            (activatedAccountPanels.orders ||
              analysisOrderHistoryNeeded),
        ),
      },
    },
  );
  const primaryAccountRestQueriesEnabled = Boolean(
    genericAccountQueriesEnabled && accountPageRestFallback.primary,
  );
  const liveAccountQueriesEnabled = Boolean(
    genericAccountQueriesEnabled && accountPageRestFallback.live,
  );
  const derivedAccountQueriesEnabled = Boolean(
    genericAccountQueriesEnabled && accountPageRestFallback.derived,
  );
  const equityHistoryQueriesEnabled = Boolean(derivedAccountQueriesEnabled);
  const secondaryAccountQueriesEnabled = Boolean(derivedAccountQueriesEnabled);
  const benchmarkQueriesEnabled = Boolean(equityHistoryQueriesEnabled);
  const performanceCalendarQueriesEnabled = Boolean(
    genericAccountQueriesEnabled && accountPageRestFallback.derived,
  );
  const todayPanelQueriesEnabled = Boolean(
    liveAccountQueriesEnabled && activatedAccountPanels.today,
  );
  const tradingAnalysisQueriesEnabled = Boolean(
    genericAccountQueriesEnabled && activatedAccountPanels.tradingAnalysis,
  );
  const ordersPanelQueriesEnabled = Boolean(
    genericAccountQueriesEnabled &&
      activatedAccountPanels.orders &&
      (effectiveOrderTab === "history" || primaryAccountRestQueriesEnabled),
  );
  const positionsRestQueriesEnabled = Boolean(liveAccountQueriesEnabled);
  useRuntimeWorkloadFlag("account:live", Boolean(liveRefreshInterval), {
    kind: "poll",
    label: "Account live",
    detail: refreshPolicy.streamBacked
      ? "1s stream"
      : shadowMode
        ? "30s REST"
        : "15s REST",
    priority: 4,
  });
  useRuntimeWorkloadFlag("account:equity", Boolean(chartRefreshInterval), {
    kind: "poll",
    label: "Account equity",
    detail: refreshPolicy.streamBacked
      ? "stream"
      : chartRefreshInterval
        ? `${Math.round(chartRefreshInterval / 1000)}s`
        : "idle",
    priority: 6,
  });

  // Flex health can diagnose a disconnected broker without generic account data.
  // Start it only when the deferred Support panel is requested; a healthy derived
  // stream supplies the value, while REST remains the explicit fallback.
  const healthQuery = useGetFlexHealth({
    query: {
      staleTime: 15_000,
      refetchInterval: healthRefreshInterval,
      enabled: Boolean(
        isVisible &&
          activatedAccountPanels.support &&
          !shadowMode &&
          !safeQaMode &&
          (!accountPageStreamEnabled || accountPageRestFallback.derived),
      ),
      retry: false,
    },
  });
  const summaryQuery = useGetAccountSummary(
    accountRequestId,
    accountDataParams,
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: primaryRefreshInterval,
        enabled: primaryAccountRestQueriesEnabled,
        ...getSafeQaInitialQueryOptions(safeQaExposureFixture?.summary),
      },
    },
  );
  const shadowTabSummaryQuery = useGetAccountSummary(
    SHADOW_ACCOUNT_ID,
    { mode: "shadow" },
    {
      query: {
        staleTime: 60_000,
        refetchInterval: false,
        retry: false,
        enabled: Boolean(isVisible && !shadowMode && !safeQaMode),
        ...getSafeQaInitialQueryOptions(safeQaShadowSummary),
      },
    },
  );
  const equityQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...accountDataParams,
      range,
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: equityHistoryQueriesEnabled,
      },
    },
  );
  const intradayPnlQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...accountDataParams,
      range: "1D",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(
          todayPanelQueriesEnabled && todayView === "intraday"
        ),
      },
    },
  );
  const spyBenchmarkQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...accountDataParams,
      range,
      benchmark: "SPY",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: false,
        enabled: Boolean(
          benchmarkQueriesEnabled && visibleEquityBenchmarks.SPY,
        ),
      },
    },
  );
  const qqqBenchmarkQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...accountDataParams,
      range,
      benchmark: "QQQ",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: false,
        enabled: Boolean(
          benchmarkQueriesEnabled && visibleEquityBenchmarks.QQQ,
        ),
      },
    },
  );
  const djiaBenchmarkQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...accountDataParams,
      range,
      benchmark: "DIA",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: false,
        enabled: Boolean(
          benchmarkQueriesEnabled && visibleEquityBenchmarks.DJIA,
        ),
      },
    },
  );
  const allocationQuery = useGetAccountAllocation(
    accountRequestId,
    modeParams,
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: primarySecondaryRefreshInterval,
        enabled: primaryAccountRestQueriesEnabled,
        ...getSafeQaInitialQueryOptions(safeQaExposureFixture?.allocation),
      },
    },
  );
  const positionsQuery = useGetAccountPositions(
    accountRequestId,
    {
      ...accountDataParams,
      assetClass: accountPositionTypeParam(assetFilter),
      detail: "fast",
      liveQuotes: false,
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: positionsRestQueriesEnabled,
        ...getSafeQaInitialQueryOptions(safeQaExposureFixture?.positions),
      },
    },
  );
  const activeEquityInspectionDate = pinnedEquityDate || hoveredEquityDate;
  const positionsAtDateQuery = useGetAccountPositionsAtDate(
    accountRequestId,
    {
      ...accountDataParams,
      date: activeEquityInspectionDate || "1970-01-01",
      assetClass: accountPositionTypeParam(assetFilter),
    },
    {
      query: {
        staleTime: ACCOUNT_HISTORY_STALE_MS,
        retry: false,
        enabled: Boolean(
          genericAccountQueriesEnabled && activeEquityInspectionDate,
        ),
      },
    },
  );
  const performanceCalendarEquityRuntimeQueryKey = useMemo(
    () =>
      getAccountPerformanceCalendarEquityQueryKey(
        accountRequestId,
        accountDataParams,
      ),
    [accountDataParams, accountRequestId],
  );
  const performanceCalendarEquityQuery = useQuery({
    ...getGetAccountEquityHistoryQueryOptions(
      accountRequestId,
      {
        ...accountDataParams,
        range: "1Y",
      },
      {
        query: {
          ...equityHistoryQuerySettings,
          refetchInterval: false,
          enabled: performanceCalendarQueriesEnabled,
        },
      },
    ),
    queryKey: performanceCalendarEquityRuntimeQueryKey,
  });
  const performanceCalendarTradesQuery = useGetAccountClosedTrades(
    accountRequestId,
    performanceCalendarParams,
    {
      query: {
        ...ACCOUNT_DERIVED_QUERY_OPTIONS.query,
        staleTime: ACCOUNT_LIVE_STALE_MS,
        refetchInterval: chartRefreshInterval,
        enabled: performanceCalendarQueriesEnabled,
      },
    },
  );
  const tradesQuery = useGetAccountClosedTrades(
    accountRequestId,
    heroTradeParams,
    {
      query: {
        ...ACCOUNT_DERIVED_QUERY_OPTIONS.query,
        staleTime: ACCOUNT_LIVE_STALE_MS,
        refetchInterval: tradesRefreshInterval,
        enabled: derivedAccountQueriesEnabled,
      },
    },
  );
  const analysisTradesQuery = useGetAccountClosedTrades(
    accountRequestId,
    closedTradeParams,
    {
      query: {
        ...ACCOUNT_DERIVED_QUERY_OPTIONS.query,
        staleTime: ACCOUNT_LIVE_STALE_MS,
        refetchInterval: false,
        enabled: tradingAnalysisQueriesEnabled,
      },
    },
  );
  const ordersQuery = useGetAccountOrders(
    accountRequestId,
    {
      ...accountDataParams,
      tab: effectiveOrderTab,
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval:
          effectiveOrderTab === "working" ? liveRefreshInterval : false,
        enabled: ordersPanelQueriesEnabled,
      },
    },
  );
  const analysisOrdersQuery = useGetAccountOrders(
    accountRequestId,
    {
      ...accountDataParams,
      tab: "history",
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: false,
        enabled: Boolean(
          genericAccountQueriesEnabled && analysisOrderHistoryNeeded,
        ),
      },
    },
  );
  const riskQuery = useGetAccountRisk(accountRequestId, riskParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: primarySecondaryRefreshInterval,
      enabled: primaryAccountRestQueriesEnabled,
      ...getSafeQaInitialQueryOptions(safeQaExposureFixture?.risk),
      retry: retryDegradedAccountRisk,
      retryDelay: degradedAccountRiskRetryDelay,
    },
  });
  const cashQuery = useGetAccountCashActivity(
    accountRequestId,
    accountDataParams,
    {
      query: {
        ...ACCOUNT_DERIVED_QUERY_OPTIONS.query,
        refetchInterval: secondaryRefreshInterval,
        enabled: secondaryAccountQueriesEnabled,
      },
    },
  );
  const snapTradePortfolioQueryForDisplay = withoutFailedQueryData(
    snapTradePortfolioQuery,
  );
  const snapTradeRecentOrdersQueryForDisplay = withoutFailedQueryData(
    snapTradeRecentOrdersQuery,
  );
  const snapTradeOrderCancellationReady = Boolean(
    snapTradeAccountPanelsEnabled &&
      snapTradeRecentOrdersQueryForDisplay.data?.account?.executionReady,
  );
  const snapTradeOrderCancellationMessage =
    "Select an execution-ready SnapTrade account in Settings before canceling an order.";
  const snapTradePanelData = useMemo(
    () =>
      selectedSnapTradeAccount && snapTradePortfolioQueryForDisplay.data
        ? buildSnapTradeAccountPanelData({
            account: selectedSnapTradeAccount,
            portfolio: snapTradePortfolioQueryForDisplay.data,
            recentOrders: snapTradeRecentOrdersQueryForDisplay.data,
            orderTab: effectiveOrderTab,
          })
        : null,
    [
      effectiveOrderTab,
      selectedSnapTradeAccount,
      snapTradePortfolioQueryForDisplay.data,
      snapTradeRecentOrdersQueryForDisplay.data,
    ],
  );
  const snapTradeAnalysisPanelData = useMemo(
    () =>
      selectedSnapTradeAccount && snapTradePortfolioQueryForDisplay.data
        ? buildSnapTradeAccountPanelData({
            account: selectedSnapTradeAccount,
            portfolio: snapTradePortfolioQueryForDisplay.data,
            recentOrders: snapTradeRecentOrdersQueryForDisplay.data,
            orderTab: "history",
          })
        : null,
    [
      selectedSnapTradeAccount,
      snapTradePortfolioQueryForDisplay.data,
      snapTradeRecentOrdersQueryForDisplay.data,
    ],
  );
  const healthQueryForDisplay = withoutFailedQueryData(healthQuery);
  const summaryQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildProviderAccountQuery(
        snapTradePortfolioQueryForDisplay,
        snapTradePanelData?.summary,
      )
    : withoutFailedQueryData(summaryQuery);
  const shadowTabSummaryForDisplay = withoutFailedQueryData(
    shadowTabSummaryQuery,
  );
  const equityQueryForPanel = withoutFailedQueryData(equityQuery);
  const intradayPnlQueryForDisplay = withoutFailedQueryData(intradayPnlQuery);
  const spyBenchmarkQueryForDisplay = withoutFailedQueryData(spyBenchmarkQuery);
  const qqqBenchmarkQueryForDisplay = withoutFailedQueryData(qqqBenchmarkQuery);
  const djiaBenchmarkQueryForDisplay =
    withoutFailedQueryData(djiaBenchmarkQuery);
  const allocationQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildProviderAccountQuery(
        snapTradePortfolioQueryForDisplay,
        snapTradePanelData?.allocation,
      )
    : withoutFailedQueryData(allocationQuery);
  const positionsQueryForDisplay = withoutFailedQueryData(positionsQuery);
  const positionsAtDateQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildIdleAccountQuery(snapTradePanelData?.positionsAtDate)
    : withoutFailedQueryData(positionsAtDateQuery);
  const tradesQueryForDisplay = withoutFailedQueryData(tradesQuery);
  const analysisTradesQueryForDisplay = withoutFailedQueryData(
    analysisTradesQuery,
  );
  const performanceCalendarTradesQueryForDisplay = withoutFailedQueryData(
    performanceCalendarTradesQuery,
  );
  const performanceCalendarEquityQueryForDisplay = withoutFailedQueryData(
    performanceCalendarEquityQuery,
  );
  const snapTradeOrdersPanelData =
    snapTradeAccountPanelsEnabled && snapTradeRecentOrdersQueryForDisplay.data
      ? snapTradePanelData?.orders
      : undefined;
  const ordersQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildProviderAccountQuery(
        snapTradeRecentOrdersQueryForDisplay,
        snapTradeOrdersPanelData,
      )
    : withoutFailedQueryData(ordersQuery);
  const analysisOrdersQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildProviderAccountQuery(
        snapTradeRecentOrdersQueryForDisplay,
        snapTradeAnalysisPanelData?.orders,
      )
    : withoutFailedQueryData(analysisOrdersQuery);
  const riskQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildIdleAccountQuery(null)
    : withoutFailedQueryData(riskQuery);
  const cashQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildIdleAccountQuery(snapTradePanelData?.cash)
    : withoutFailedQueryData(cashQuery);
  const cancelSnapTradeOrderMutation = useMutation({
    mutationFn: (variables) =>
      cancelSnapTradeOrderRequest({
        ...variables,
        csrfToken: authSession.csrfToken,
      }),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/accounts/${variables.accountId}/orders`],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/accounts/${variables.accountId}/positions`],
      });
      queryClient.invalidateQueries({
        queryKey: getGetSnapTradeAccountPortfolioQueryKey(variables.accountId),
      });
      toast.push({
        kind: "success",
        title: "Order cancel submitted",
        body: variables.orderId,
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Cancellation not confirmed",
        body: `${error?.message || "SnapTrade did not confirm the order cancellation."} Refresh recent orders before trying again.`,
      });
    },
    onSettled: (_response, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: getGetSnapTradeRecentOrdersQueryKey(variables.accountId),
      });
    },
  });
  const shadowWatchlistBacktestMutation = useMutation({
    mutationFn: (payload = { timeframe: "15m" }) =>
      platformJsonRequest("/api/accounts/shadow/watchlist-backtest/runs", {
        method: "POST",
        body: payload,
        csrfToken: authSession.csrfToken,
        timeoutMs: payload?.sweep ? 600_000 : 120_000,
      }),
    onSuccess: (payload, variables) => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          String(query.queryKey[0] || "").includes("/api/accounts/shadow"),
      });
      toast.push({
        kind: "success",
        title: "Shadow backtest complete",
        body: `${variables?.range || "today"} ${variables?.timeframe || "15m"} ledger run updated.`,
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Shadow backtest failed",
        body:
          error?.message || "The Shadow watchlist backtest could not finish.",
      });
    },
  });
  const cancelOrderMutation = useCancelAccountOrder({
    request: {
      headers: authSession.csrfToken
        ? { "x-csrf-token": authSession.csrfToken }
        : {},
    },
    mutation: {
      onSuccess: (_response, variables) => {
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${accountRequestId}/orders`],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${accountRequestId}/positions`],
        });
        toast.push({
          kind: "success",
          title: "Order cancel submitted",
          body: variables?.orderId || "The account order cancel was accepted.",
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Order cancel failed",
          body:
            error?.message ||
            "The broker did not accept the account order cancel.",
        });
      },
    },
  });

  useEffect(() => {
    const clearInspection = () => {
      setHoveredEquityDate(null);
      setPinnedEquityDate(null);
    };
    const useAnimationFrame =
      typeof window.requestAnimationFrame === "function";
    const frameId = useAnimationFrame
      ? window.requestAnimationFrame(clearInspection)
      : window.setTimeout(clearInspection, 0);
    return () => {
      if (
        useAnimationFrame &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(frameId);
      } else {
        window.clearTimeout(frameId);
      }
    };
  }, [accountRequestId, range]);
  const testFlexMutation = useTestFlexToken({
    request: {
      headers: authSession.csrfToken
        ? { "x-csrf-token": authSession.csrfToken }
        : {},
    },
    mutation: {
      onSuccess: () => {
        healthQuery.refetch();
        summaryQuery.refetch();
        equityQuery.refetch();
        if (visibleEquityBenchmarks.SPY) {
          spyBenchmarkQuery.refetch();
        }
        if (visibleEquityBenchmarks.QQQ) {
          qqqBenchmarkQuery.refetch();
        }
        if (visibleEquityBenchmarks.DJIA) {
          djiaBenchmarkQuery.refetch();
        }
        allocationQuery.refetch();
        tradesQuery.refetch();
        riskQuery.refetch();
        cashQuery.refetch();
        toast.push({
          kind: "success",
          title: "Flex token verified",
          body: "Account data refresh has been requested.",
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Flex token failed",
          body: error?.message || "The Flex token check did not complete.",
        });
      },
    },
  });

  useEffect(() => {
    if (
      !isVisible ||
      !accountRequestId ||
      shadowMode ||
      !accountPageStreamFreshness.accountDerivedFresh
    ) {
      return undefined;
    }

    let cancelled = false;
    const runPrefetch = () => {
      if (cancelled) {
        return;
      }
      ACCOUNT_RANGES.forEach((prefetchRange) => {
        queryClient.prefetchQuery(
          getGetAccountEquityHistoryQueryOptions(
            accountRequestId,
            {
              ...accountDataParams,
              range: prefetchRange,
            },
            {
              query: equityHistoryQuerySettings,
            },
          ),
        );
        [
          ["SPY", "SPY"],
          ["QQQ", "QQQ"],
          ["DJIA", "DIA"],
        ].forEach(([key, benchmark]) => {
          if (!visibleEquityBenchmarks[key]) {
            return;
          }
          queryClient.prefetchQuery(
            getGetAccountEquityHistoryQueryOptions(
              accountRequestId,
              {
                ...accountDataParams,
                range: prefetchRange,
                benchmark,
              },
              {
                query: equityHistoryQuerySettings,
              },
            ),
          );
        });
      });
    };
    const idleId =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(runPrefetch, { timeout: 4_000 })
        : window.setTimeout(runPrefetch, 1_500);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [
    accountRequestId,
    accountPageStreamFreshness.accountDerivedFresh,
    equityHistoryQuerySettings,
    isVisible,
    accountDataParams,
    queryClient,
    shadowMode,
    visibleEquityBenchmarks,
  ]);

  const scopedAccountCurrencyAuthorities = shadowMode
    ? []
    : accountTab === "all"
      ? accounts.map((account) => account?.currency)
      : activeAccount
        ? [activeAccount.currency]
        : [];
  const populatedCurrencyPayloads = [
    summaryQueryForDisplay.data,
    equityQueryForPanel.data,
    cashQueryForDisplay.data,
    allocationQueryForDisplay.data,
    positionsQueryForDisplay.data,
    tradesQueryForDisplay.data,
    analysisTradesQueryForDisplay.data,
    ordersQueryForDisplay.data,
    performanceCalendarTradesQueryForDisplay.data,
    performanceCalendarEquityQueryForDisplay.data,
    positionsAtDateQueryForDisplay.data,
    riskQueryForDisplay.data,
    intradayPnlQueryForDisplay.data,
  ].filter((payload) => payload != null);
  const currencyAuthorities = [
    ...scopedAccountCurrencyAuthorities,
    ...populatedCurrencyPayloads.map((payload) => payload.currency),
  ];
  const currency = resolveCompleteAccountCurrency(currencyAuthorities);
  const displaySummaryData = summaryQueryForDisplay.data;
  const displaySummaryDayPnlMetric = displaySummaryData?.metrics?.dayPnl;
  const displaySummaryDayPnlMarketDate = useMemo(
    () => accountMetricMarketDate(displaySummaryDayPnlMetric),
    [
      displaySummaryDayPnlMetric?.field,
      displaySummaryDayPnlMetric?.marketDate,
      displaySummaryDayPnlMetric?.updatedAt,
    ],
  );
  useEffect(() => {
    const nextNowMs = accountMarketDateNoonMs(displaySummaryDayPnlMarketDate);
    if (nextNowMs == null) {
      return;
    }
    setAccountAnalysisNowMs((current) =>
      Math.abs(current - nextNowMs) < 1_000 ? current : nextNowMs,
    );
  }, [displaySummaryDayPnlMarketDate]);
  const shadowStartingBalance = useMemo(() => {
    const netLiquidation = Number(
      displaySummaryData?.metrics?.netLiquidation?.value,
    );
    const totalPnl = Number(displaySummaryData?.metrics?.totalPnl?.value);
    if (!Number.isFinite(netLiquidation) || !Number.isFinite(totalPnl)) {
      return null;
    }
    return netLiquidation - totalPnl;
  }, [displaySummaryData]);
  const openAccountPositions = useMemo(
    () => getOpenPositionRows(positionsQueryForDisplay.data?.positions || []),
    [positionsQueryForDisplay.data],
  );
  const openAccountPositionCount = Array.isArray(
    positionsQueryForDisplay.data?.positions,
  )
    ? openAccountPositions.length
    : null;
  const livePositionNetLiquidation = useMemo(
    () =>
      livePositionsNetLiquidation(
        positionsQueryForDisplay.data,
        displaySummaryData?.metrics?.netLiquidation?.value,
      ),
    [
      displaySummaryData?.metrics?.netLiquidation?.value,
      positionsQueryForDisplay.data,
    ],
  );
  const equityQueryForDisplay = useMemo(
    () =>
      shadowMode
        ? equityQueryForPanel
        : equityQueryWithLivePositionsTerminal({
            query: equityQueryForPanel,
            netLiquidation: livePositionNetLiquidation,
            currency,
            updatedAt:
              positionsQueryForDisplay.data?.updatedAt ||
              displaySummaryData?.updatedAt,
          }),
    [
      currency,
      displaySummaryData?.updatedAt,
      equityQueryForPanel,
      livePositionNetLiquidation,
      positionsQueryForDisplay.data?.updatedAt,
      shadowMode,
    ],
  );
  const accountAnalysisQueryForDisplay = analysisTradesQueryForDisplay;
  const accountAnalysisTradesForDisplay =
    analysisTradesQueryForDisplay.data?.trades || EMPTY_ACCOUNT_TRADES;
  const accountOptionQuoteGroups = useMemo(
    () => buildPositionOptionQuoteGroups(openAccountPositions),
    [openAccountPositions],
  );
  const accountOptionQuoteOwner = useMemo(
    () =>
      `account-position-option-quotes:${accountRequestId || SHADOW_ACCOUNT_ID}`,
    [accountRequestId],
  );
  const accountLiveOptionQuotesEnabled = Boolean(
    genericAccountQueriesEnabled || snapTradeAccountPanelsEnabled,
  );
  const shadowAutomationAudit = useMemo(() => {
    const orders = ordersQueryForDisplay.data?.orders || EMPTY_ACCOUNT_ORDERS;
    return {
      automationPositions: openAccountPositions.filter(
        (position) => position.sourceType === "automation",
      ).length,
      backtestPositions: openAccountPositions.filter(
        (position) => position.sourceType === "watchlist_backtest",
      ).length,
      mixedPositions: openAccountPositions.filter(
        (position) => position.sourceType === "mixed",
      ).length,
      automationOrders: orders.filter(
        (order) => order.sourceType === "automation",
      ).length,
      backtestOrders: orders.filter(
        (order) => order.sourceType === "watchlist_backtest",
      ).length,
      manualOrders: orders.filter((order) => order.sourceType === "manual")
        .length,
    };
  }, [openAccountPositions, ordersQueryForDisplay.data]);
  const {
    tradesData: returnsCalendarTradesData,
    equityPoints: returnsCalendarEquityPoints,
  } = useMemo(
    () =>
      resolveReturnsCalendarData({
        performanceCalendarTradesData:
          performanceCalendarTradesQueryForDisplay.data,
        performanceCalendarEquityData:
          performanceCalendarEquityQueryForDisplay.data,
      }),
    [
      performanceCalendarEquityQueryForDisplay.data,
      performanceCalendarTradesQueryForDisplay.data,
    ],
  );
  const handleCancelOrder = async (order) => {
    const cancellationReady = snapTradeAccountPanelsEnabled
      ? snapTradeOrderCancellationReady
      : ORDER_BLOTTER_CANCELLATION_AVAILABLE;
    const cancellationMessage = snapTradeAccountPanelsEnabled
      ? snapTradeOrderCancellationMessage
      : ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON;
    if (!cancellationReady) {
      window.alert(cancellationMessage);
      return;
    }
    if (snapTradeAccountPanelsEnabled && !order.brokerOrderId) {
      window.alert(
        "SnapTrade did not return a cancelable broker order id. Refresh the order list before trying again.",
      );
      return;
    }

    if (
      !window.confirm(`Cancel ${order.symbol} ${order.side} order ${order.id}?`)
    ) {
      return;
    }
    try {
      if (snapTradeAccountPanelsEnabled) {
        await cancelSnapTradeOrderMutation.mutateAsync({
          accountId: order.accountId,
          orderId: order.brokerOrderId,
          assetClass: order.assetClass,
        });
        return;
      }
      const orderMode =
        order.mode === "live" || order.mode === "shadow"
          ? order.mode
          : modeParams.mode;
      await cancelOrderMutation.mutateAsync({
        accountId: order.accountId,
        orderId: order.id,
        data: { mode: orderMode, confirm: true },
      });
    } catch {}
  };
  return (
    <div
      ref={accountLayoutRef}
      data-testid="account-screen"
      data-layout={
        accountIsPhone ? "phone" : accountIsNarrow ? "tablet" : "desktop"
      }
      className="ra-panel-enter"
      style={{
        flex: 1,
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
        overflowY: "auto",
        background: CSS_COLOR.bg0,
        minWidth: 0,
        WebkitOverflowScrolling: accountIsPhone ? "touch" : undefined,
      }}
    >
      <div
        style={{
          width: "100%",
          padding: sp(accountIsPhone ? "8px 8px 18px" : "16px 24px"),
          display: "grid",
          gap: sp(accountIsPhone ? 8 : 12),
        }}
      >
        <PositionOptionQuoteStreams
          groups={accountOptionQuoteGroups}
          enabled={accountLiveOptionQuotesEnabled}
          owner={accountOptionQuoteOwner}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <AccountTabs
            accounts={accounts}
            shadowSummary={shadowTabSummaryForDisplay.data}
            deployments={accountDeploymentsQuery.data?.deployments || []}
            deploymentInventoryState={accountDeploymentInventoryState}
            activeTabId={accountTab}
            onSelectTab={setAccountTab}
            onTabIntent={prefetchAccountTabLiveQueries}
            accountIsPhone={viewport.flags.isPhone}
            maskValues={maskAccountValues}
          />
        </div>

        <DeferredPanelSuspense
          minHeight={accountIsPhone ? 58 : 42}
          title="Loading account summary"
          detail="Preparing balances and account status."
        >
          <AccountHeroBlock
            summary={displaySummaryData}
            equityHistory={equityQueryForPanel.data}
            positionsResponse={positionsQueryForDisplay.data}
            tradesResponse={tradesQueryForDisplay.data}
            cashResponse={cashQueryForDisplay.data}
            range={range}
            currency={currency}
            maskValues={maskAccountValues}
            isPhone={accountIsPhone}
          />
        </DeferredPanelSuspense>

        <div className="ra-panel-enter ra-account-overview-grid">
          <div className="ra-account-overview-cell ra-account-overview-returns">
            <DeferredPanelSuspense
              minHeight={accountIsPhone ? 310 : 350}
              title="Loading returns calendar"
              detail="Preparing realized P&L and equity history."
            >
              <AccountReturnsPanel
                currency={currency}
                maskValues={maskAccountValues}
                tradesData={returnsCalendarTradesData}
                equityPoints={returnsCalendarEquityPoints}
                marketCalendar={returnsCalendarMarketCalendar}
                isPhone={accountIsPhone}
              />
            </DeferredPanelSuspense>
          </div>
          <div className="ra-account-overview-cell ra-account-overview-exposure">
            <DeferredPanelSuspense
              minHeight={accountIsPhone ? 174 : 246}
              title="Loading exposure"
              detail="Preparing allocation and risk charts."
            >
              <LazyPortfolioExposurePanel
                allocationQuery={allocationQueryForDisplay}
                riskQuery={riskQueryForDisplay}
                positionsResponse={positionsQueryForDisplay.data}
                currency={currency}
                subtitle={
                  shadowMode
                    ? `${accountSourceLabel} holdings, risk, and concentration`
                    : snapTradeAccountPanelsEnabled
                      ? "SnapTrade holdings, risk, and concentration"
                      : undefined
                }
                rightRail={
                  shadowMode || snapTradeAccountPanelsEnabled
                    ? accountSourceLabel
                    : undefined
                }
                maskValues={maskAccountValues}
                isPhone={accountIsPhone}
              />
            </DeferredPanelSuspense>
          </div>
          <div
            className="ra-account-overview-cell ra-account-overview-equity"
            style={{ display: "grid", gap: sp(5) }}
          >
            <DeferredPanelSuspense
              minHeight={accountIsPhone ? 280 : 314}
              title="Loading equity curve"
              detail="Preparing account chart and date inspector."
            >
              <LazyEquityCurvePanel
                query={equityQueryForDisplay}
                benchmarkQueries={{
                  SPY: spyBenchmarkQueryForDisplay,
                  QQQ: qqqBenchmarkQueryForDisplay,
                  DJIA: djiaBenchmarkQueryForDisplay,
                }}
                visibleBenchmarks={visibleEquityBenchmarks}
                onVisibleBenchmarksChange={setVisibleEquityBenchmarks}
                range={range}
                onRangeChange={setRange}
                currency={currency}
                accentColor={shadowMode ? CSS_COLOR.pink : CSS_COLOR.green}
                rightRail={
                  shadowMode || snapTradeAccountPanelsEnabled
                    ? accountSourceLabel
                    : undefined
                }
                sourceLabel={accountSourceLabel}
                maskValues={maskAccountValues}
                currentNetLiquidation={
                  shadowMode ? null : livePositionNetLiquidation
                }
                activeInspectionDate={activeEquityInspectionDate}
                pinnedInspectionDate={pinnedEquityDate}
                onHoverInspectionDate={setHoveredEquityDate}
                onPinInspectionDate={setPinnedEquityDate}
                compact
              />
              <PositionsAtDateInspector
                query={positionsAtDateQueryForDisplay}
                activeDate={activeEquityInspectionDate}
                pinnedDate={pinnedEquityDate}
                currentPositionsCount={openAccountPositionCount}
                currency={currency}
                maskValues={maskAccountValues}
                onClearPin={() => setPinnedEquityDate(null)}
                onJumpToChart={(symbol, tradeIntent) =>
                  onJumpToTrade?.(symbol, tradeIntent)
                }
              />
            </DeferredPanelSuspense>
          </div>
        </div>

        <DeferredPanelSuspense
          minHeight={accountIsPhone ? 430 : 300}
          title="Current Positions"
        >
          <PositionsPanel
            query={positionsQueryForDisplay}
            currency={currency}
            assetFilter={assetFilter}
            onAssetFilterChange={setAssetFilter}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            onJumpToChart={(symbol, tradeIntent) =>
              onJumpToTrade?.(symbol, tradeIntent)
            }
            accountId={positionManagementAccountId}
            accountProvider={accountProviderScope}
            environment={modeParams.mode}
            gatewayTradingReady={positionManagementGatewayReady}
            gatewayTradingMessage={positionManagementGatewayMessage}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            rightRail={shadowMode ? "Shadow positions + marks" : undefined}
            emptyBody={
              shadowMode
                ? "Shadow fills from automation and manual tickets will appear here as segregated internal positions."
                : undefined
            }
            maskValues={maskAccountValues}
            isPhone={accountIsPhone}
            liveOptionQuotesEnabled={accountLiveOptionQuotesEnabled}
            streamLiveOptionQuotes={false}
          />
        </DeferredPanelSuspense>

        <DeferredRender
          minHeight={accountIsPhone ? 340 : 300}
          onActivate={() => markAccountPanelActivated("today")}
          testId="account-deferred-today"
        >
          <DeferredPanelSuspense
            minHeight={accountIsPhone ? 340 : 300}
            title="Loading today snapshot"
            detail="Preparing intraday P&L and position treemap."
          >
            <TodaySnapshotPanel
              positionsQuery={positionsQueryForDisplay}
              intradayQuery={intradayPnlQueryForDisplay}
              currency={currency}
              maskValues={maskAccountValues}
              marketCalendar={returnsCalendarMarketCalendar}
              tab={todayView}
              onTabChange={setTodayView}
              liveOptionQuotesEnabled={accountLiveOptionQuotesEnabled}
              streamLiveOptionQuotes={false}
              emptyHeatmapBody={
                shadowMode
                  ? "Treemap renders once Shadow ledger positions are opened or marked."
                  : undefined
              }
            />
          </DeferredPanelSuspense>
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 760 : 540}
          onActivate={() => markAccountPanelActivated("tradingAnalysis")}
          testId="account-deferred-trading-analysis"
        >
          <DeferredPanelSuspense
            minHeight={accountIsPhone ? 760 : 540}
            title="Loading trading analysis"
            detail="Preparing trade lifecycle charts and filters."
          >
            <LazyTradingAnalysisWorkbench
              query={accountAnalysisQueryForDisplay}
              trades={accountAnalysisTradesForDisplay}
              allTrades={accountAnalysisTradesForDisplay}
              orders={analysisOrdersQueryForDisplay.data?.orders ?? null}
              filters={tradeFilters}
              dispatchFilters={dispatchTradeFilters}
              range={range}
              onRangeChange={setRange}
              currency={currency}
              maskValues={maskAccountValues}
              selectedTradeId={selectedAccountTradeId}
              onTradeSelect={setSelectedAccountTradeId}
              onActiveViewChange={setTradingAnalysisView}
              onJumpToChart={onJumpToTrade}
              isPhone={accountIsPhone}
              nowMs={accountAnalysisNowMs}
            />
          </DeferredPanelSuspense>
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 360 : 240}
          onActivate={() => markAccountPanelActivated("orders")}
          testId="account-deferred-orders"
        >
          <DeferredPanelSuspense
            minHeight={accountIsPhone ? 360 : 240}
            title="Loading orders"
            detail="Preparing working orders and order history."
          >
            <OrdersPanel
              query={ordersQueryForDisplay}
              tab={effectiveOrderTab}
              onTabChange={setOrderTab}
              currency={currency}
              onCancelOrder={handleCancelOrder}
              cancelPending={
                snapTradeAccountPanelsEnabled
                  ? cancelSnapTradeOrderMutation.isPending
                  : cancelOrderMutation.isPending
              }
              cancelDisabled={
                snapTradeAccountPanelsEnabled
                  ? !snapTradeOrderCancellationReady
                  : !ORDER_BLOTTER_CANCELLATION_AVAILABLE
              }
              cancelDisabledReason={
                snapTradeAccountPanelsEnabled
                  ? snapTradeOrderCancellationMessage
                  : ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON
              }
              sourceFilter="all"
              emptyBody={
                shadowMode
                  ? "Shadow orders fill immediately into the internal ledger, so working orders are normally empty."
                  : undefined
              }
              maskValues={maskAccountValues}
              isPhone={accountIsPhone}
            />
          </DeferredPanelSuspense>
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 390 : 190}
          onActivate={() => markAccountPanelActivated("support")}
          testId="account-deferred-support"
        >
          <div className="ra-panel-enter ra-account-support-grid">
            <DeferredPanelSuspense
              minHeight={168}
              title="Loading cash activity"
              detail="Preparing deposits, withdrawals, and funding history."
            >
              <LazyCashFundingPanel
                query={cashQueryForDisplay}
                currency={currency}
                maskValues={maskAccountValues}
              />
            </DeferredPanelSuspense>
            {shadowMode ? (
              <ShadowWatchlistBacktestPanel
                mutation={shadowWatchlistBacktestMutation}
                currency={currency}
                maskValues={maskAccountValues}
              />
            ) : null}
            {shadowMode ? (
              <Panel
                title="Shadow Account"
                rightRail="Internal shadow"
                minHeight={130}
              >
                <div style={{ display: "grid", gap: sp(5) }}>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}
                  >
                    <Pill tone="pink">Shadow</Pill>
                    <Pill tone="green">Cash only</Pill>
                    <Pill tone="cyan">Fixed fees</Pill>
                  </div>
                  <div
                    style={{
                      color: CSS_COLOR.textSec,
                      fontSize: textSize("caption"),
                      lineHeight: 1.35,
                    }}
                  >
                    Starting balance is{" "}
                    {shadowStartingBalance == null
                      ? "tracked in the shadow ledger"
                      : `tracked at ${formatAccountMoney(
                          shadowStartingBalance,
                          currency,
                          true,
                          maskAccountValues,
                        )}`}
                    {". "}Manual tickets and signal-options automation write to
                    this account without touching your live broker account.
                  </div>
                  <div
                    className="ra-hide-scrollbar"
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      overflowX: "auto",
                      background: CSS_COLOR.bg0,
                      borderRadius: dim(RADII.xs),
                      marginTop: sp(2),
                      minWidth: 0,
                    }}
                  >
                    {[
                      [
                        "Auto Pos",
                        shadowAutomationAudit.automationPositions,
                        CSS_COLOR.pink,
                      ],
                      [
                        "Backtest Pos",
                        shadowAutomationAudit.backtestPositions,
                        CSS_COLOR.purple,
                      ],
                      [
                        "Auto Orders",
                        shadowAutomationAudit.automationOrders,
                        CSS_COLOR.cyan,
                      ],
                      [
                        "Backtest Orders",
                        shadowAutomationAudit.backtestOrders,
                        CSS_COLOR.pink,
                      ],
                    ].map(([label, value, tone], index, arr) => (
                      <StatTile
                        key={label}
                        label={label}
                        value={value}
                        tone={tone}
                        minWidth={80}
                        divider={index < arr.length - 1}
                      />
                    ))}
                  </div>
                </div>
              </Panel>
            ) : snapTradeAccountPanelsEnabled ? (
              <Panel
                title="SnapTrade Account"
                rightRail="Provider scoped"
                minHeight={130}
              >
                <EmptyState
                  title="SnapTrade account connected"
                  body="Portfolio balances, positions, and recent orders are loaded through SnapTrade for this selected account."
                />
              </Panel>
            ) : (
              <DeferredPanelSuspense
                minHeight={130}
                title="Loading setup health"
                detail="Preparing broker and Flex health checks."
              >
                <LazySetupHealthPanel
                  healthQuery={healthQueryForDisplay}
                  testMutation={testFlexMutation}
                  brokerConfigured={brokerConfigured}
                  brokerAuthenticated={brokerAuthenticated}
                />
              </DeferredPanelSuspense>
            )}
          </div>
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 360 : 280}
          onActivate={() => markAccountPanelActivated("tax")}
          testId="account-deferred-tax"
        >
          <DeferredPanelSuspense
            minHeight={accountIsPhone ? 360 : 280}
            title="Loading tax center"
            detail="Preparing tax estimates and reserve status."
          >
            <TaxCenterPanel
              accountId={accountTab || "all"}
              currency={currency}
              maskValues={maskAccountValues}
              isPhone={accountIsPhone}
            />
          </DeferredPanelSuspense>
        </DeferredRender>
      </div>
    </div>
  );
};

export const AccountScreen = (props) => {
  const { isVisible = false, onReadinessChange } = props;

  useEffect(() => {
    if (!isVisible) {
      onReadinessChange?.({
        contentReady: false,
        primaryReady: false,
        derivedReady: false,
        backgroundAllowed: false,
      });
    }
    return undefined;
  }, [isVisible, onReadinessChange]);

  return <AccountScreenInner {...props} />;
};

export default AccountScreen;
