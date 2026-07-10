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
  useGetSnapTradeAccountHistory,
  useGetSnapTradeAccountPortfolio,
  useGetSnapTradeRecentOrders,
  useGetFlexHealth,
  useTestFlexToken,
} from "@workspace/api-client-react";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  getAccountPerformanceCalendarEquityQueryKey,
  useAccountPageSnapshotStream,
  useBrokerStreamFreshnessSnapshot,
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
import { buildAccountRefreshPolicy } from "./account/accountRefreshPolicy";
import {
  buildPerformanceCalendarParams,
  performanceCalendarQueriesEnabled as resolvePerformanceCalendarQueriesEnabled,
  resolveReturnsCalendarData,
} from "./account/accountCalendarData";
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
import { AccountHeroBlock } from "./account/AccountHeroBlock";
import { AccountReturnsPanel } from "./account/AccountReturnsPanel";
import PositionsPanel, {
  PositionsAtDateInspector,
} from "./account/PositionsPanel";

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

const ACCOUNT_MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const accountMarketDateKey = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return ACCOUNT_MARKET_DATE_FORMATTER.format(date);
};

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

const accountMarketDateNoonMs = (marketDate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(marketDate || ""))) {
    return null;
  }
  const timestamp = new Date(`${marketDate}T12:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const accountTradeActivityDate = (trade) =>
  trade?.closeDate ??
  trade?.filledAt ??
  trade?.executedAt ??
  trade?.updatedAt ??
  trade?.openDate;

const realizedTradeSummaryForMarketDate = (trades = [], marketDate = null) => {
  if (!marketDate) {
    return { realizedPnl: null, trades: null };
  }
  let realizedPnl = 0;
  let tradeCount = 0;
  let realizedCount = 0;
  trades.forEach((trade) => {
    if (accountMarketDateKey(accountTradeActivityDate(trade)) !== marketDate) {
      return;
    }
    tradeCount += 1;
    const pnl = finiteAccountNumber(trade?.realizedPnl ?? trade?.pnl);
    if (pnl == null) {
      return;
    }
    realizedPnl += pnl;
    realizedCount += 1;
  });
  return {
    realizedPnl: realizedCount ? realizedPnl : null,
    trades: tradeCount || null,
  };
};

export const livePositionsDayPnlMetric = ({
  positionsResponse,
  fallbackMetric,
  tradesResponse,
  currency,
}) => {
  const rows = getOpenPositionRows(positionsResponse?.positions || []);
  let hasDayChange = false;
  let dayChangeBasis = 0;
  let dayChangeBasisComplete = true;
  const openPositionsDayPnl = rows.reduce((sum, row) => {
    const dayChange = finiteAccountNumber(row?.dayChange);
    if (dayChange == null) return sum;
    hasDayChange = true;
    const dayChangePercent = finiteAccountNumber(row?.dayChangePercent);
    const marketValue = finiteAccountNumber(row?.marketValue);
    const rowBasis =
      dayChangePercent != null && dayChangePercent !== 0
        ? Math.abs((dayChange * 100) / dayChangePercent)
        : dayChange === 0 && marketValue != null
          ? Math.abs(marketValue)
          : null;
    if (rowBasis != null && rowBasis > 0) {
      dayChangeBasis += rowBasis;
    } else {
      dayChangeBasisComplete = false;
    }
    return sum + dayChange;
  }, 0);
  const fallbackValue =
    finiteAccountNumber(fallbackMetric?.totalDayPnl) ??
    finiteAccountNumber(fallbackMetric?.value);
  if (!hasDayChange && fallbackValue == null) {
    return fallbackMetric;
  }
  const marketDate = accountMetricMarketDate(fallbackMetric);
  const realizedSummary = realizedTradeSummaryForMarketDate(
    tradesResponse?.trades || [],
    marketDate,
  );
  const totalDayPnl = hasDayChange ? openPositionsDayPnl : fallbackValue;
  return {
    ...(fallbackMetric || {}),
    value: totalDayPnl,
    totalDayPnl,
    marketDate: marketDate || fallbackMetric?.marketDate,
    realizedDayPnl:
      realizedSummary.realizedPnl ?? fallbackMetric?.realizedDayPnl,
    realizedTradeCount:
      realizedSummary.trades ?? fallbackMetric?.realizedTradeCount,
    openPositionsDayPnl: hasDayChange ? openPositionsDayPnl : null,
    openPositionsDayPnlPercent:
      hasDayChange && dayChangeBasisComplete && dayChangeBasis > 0
        ? (openPositionsDayPnl / dayChangeBasis) * 100
        : null,
    currency:
      currency ||
      fallbackMetric?.currency ||
      positionsResponse?.currency ||
      "USD",
    source: fallbackMetric?.source || "IBKR_POSITIONS",
    field: fallbackMetric?.field || "OpenPositionsDayChange",
    updatedAt:
      positionsResponse?.updatedAt ||
      fallbackMetric?.updatedAt ||
      new Date().toISOString(),
  };
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

const equityQueryWithLivePositionsTerminal = ({
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

  const timestamp = updatedAt || new Date().toISOString();
  const existingPoints = Array.isArray(data.points) ? data.points : [];
  const lastPoint = existingPoints[existingPoints.length - 1] || null;
  const terminalPoint = {
    ...(lastPoint || {}),
    timestamp,
    netLiquidation: nav,
    currency: currency || data.currency || "USD",
    source: "IBKR_POSITIONS",
    deposits: finiteAccountNumber(lastPoint?.deposits) ?? 0,
    withdrawals: finiteAccountNumber(lastPoint?.withdrawals) ?? 0,
    dividends: finiteAccountNumber(lastPoint?.dividends) ?? 0,
    fees: finiteAccountNumber(lastPoint?.fees) ?? 0,
    benchmarkPercent: lastPoint?.benchmarkPercent ?? null,
  };
  const terminalMs = new Date(timestamp).getTime();
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
      index === existingPoints.length - 1 && point?.source === "IBKR_POSITIONS"
    );
  });
  const points = [...withoutPriorTerminal, terminalPoint]
    .filter((point) => Number.isFinite(new Date(point?.timestamp).getTime()))
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
  const adjusted = calculateTransferAdjustedReturnSeries(points);
  return {
    ...query,
    data: {
      ...data,
      currency: terminalPoint.currency,
      asOf: timestamp,
      terminalPointSource: "live_positions",
      liveTerminalIncluded: true,
      points: points.map((point, index) => ({
        ...point,
        returnPercent:
          adjusted[index]?.returnPercent ?? point.returnPercent ?? 0,
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
const ACCOUNT_SWITCH_KEEP_WARM_MS = 60_000;

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
  // The opposite-mode tab to keep warm: from shadow, prewarm the live "All"
  // aggregate; from any live tab, prewarm shadow.
  const inactiveAccountTab = shadowMode
    ? ibkrAccountRoutesAvailable
      ? "all"
      : null
    : "shadow";
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
  const accountQueriesEnabled = Boolean(
    genericAccountQueriesEnabled || snapTradeAccountPanelsEnabled,
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
  const inactiveAccountPageRequest = useMemo(
    () =>
      inactiveAccountTab ? getAccountTabRequest(inactiveAccountTab) : null,
    [getAccountTabRequest, inactiveAccountTab],
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
            liveQuotes: true,
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
  const brokerStreamFreshness = useBrokerStreamFreshnessSnapshot(
    genericRealAccountDataEnabled,
  );
  const accountPageStreamEnabled = Boolean(
    isVisible && genericAccountQueriesEnabled,
  );
  const accountPageStreamFreshness = useAccountPageSnapshotStream({
    accountId: accountRequestId,
    mode: modeParams.mode,
    range,
    orderTab: effectiveOrderTab,
    assetClass: accountPositionTypeParam(assetFilter),
    tradeFilters: {
      from: closedTradeParams.from,
      to: closedTradeParams.to,
      symbol: closedTradeParams.symbol,
      assetClass: closedTradeParams.assetClass,
      pnlSign: closedTradeParams.pnlSign,
      holdDuration: closedTradeParams.holdDuration,
    },
    performanceCalendarFrom: performanceCalendarParams.from,
    enabled: accountPageStreamEnabled,
  });
  const accountTimingStagesRef = useRef(new Set());
  useEffect(() => {
    if (!isVisible) {
      accountTimingStagesRef.current = new Set();
    }
  }, [isVisible]);
  const inactiveAccountPageStreamEnabled = Boolean(
    accountPageStreamEnabled &&
      accountPageStreamFreshness.accountPrimaryFresh &&
      inactiveAccountPageRequest,
  );
  const inactiveAccountPageStreamFreshness = useAccountPageSnapshotStream({
    accountId: inactiveAccountPageRequest?.accountId,
    mode: inactiveAccountPageRequest?.mode || modeParams.mode,
    range,
    orderTab: inactiveAccountPageRequest?.orderTab,
    assetClass: inactiveAccountPageRequest?.assetClass,
    tradeFilters: {
      from: closedTradeParams.from,
      to: closedTradeParams.to,
      symbol: closedTradeParams.symbol,
      assetClass: closedTradeParams.assetClass,
      pnlSign: closedTradeParams.pnlSign,
      holdDuration: closedTradeParams.holdDuration,
    },
    performanceCalendarFrom: performanceCalendarParams.from,
    enabled: inactiveAccountPageStreamEnabled,
  });
  const inactiveAccountPrewarmEnabled = Boolean(
    isVisible &&
      accountQueriesEnabled &&
      inactiveAccountTab &&
      !inactiveAccountPageStreamFreshness.accountPrimaryFresh,
  );
  useEffect(() => {
    onReadinessChange?.({
      contentReady: Boolean(isVisible),
      primaryReady: Boolean(isVisible),
      derivedReady: Boolean(isVisible),
      backgroundAllowed: Boolean(isVisible && !safeQaMode),
    });
  }, [isVisible, onReadinessChange, safeQaMode]);
  useEffect(() => {
    if (!inactiveAccountPrewarmEnabled) {
      return undefined;
    }
    prefetchAccountTabLiveQueries(inactiveAccountTab);
    return undefined;
  }, [
    inactiveAccountPrewarmEnabled,
    inactiveAccountTab,
    prefetchAccountTabLiveQueries,
  ]);
  useEffect(() => {
    if (!inactiveAccountPrewarmEnabled) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      prefetchAccountTabLiveQueries(inactiveAccountTab);
    }, ACCOUNT_SWITCH_KEEP_WARM_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    inactiveAccountPrewarmEnabled,
    inactiveAccountTab,
    prefetchAccountTabLiveQueries,
  ]);
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
    if (!isVisible) {
      return;
    }
    markAccountTiming("primary-data-ready", {
      source: accountPageStreamFreshness.accountPrimaryFresh
        ? "stream"
        : "rest",
    });
  }, [
    accountPageStreamFreshness.accountPrimaryFresh,
    isVisible,
    markAccountTiming,
  ]);
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    markAccountTiming("derived-data-ready", {
      source: accountPageStreamFreshness.accountDerivedFresh
        ? "stream"
        : "rest",
    });
  }, [
    accountPageStreamFreshness.accountDerivedFresh,
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
  const liveRefreshInterval = refreshPolicy.primary;
  const secondaryRefreshInterval = refreshPolicy.secondary;
  const tradesRefreshInterval = refreshPolicy.trades;
  const chartRefreshInterval = refreshPolicy.chart;
  const healthRefreshInterval = refreshPolicy.health;
  const snapTradePortfolioQuery = useGetSnapTradeAccountPortfolio(
    selectedSnapTradeAccount?.id || "",
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: snapTradeAccountPanelsEnabled,
      },
    },
  );
  const snapTradeRecentOrdersQuery = useGetSnapTradeRecentOrders(
    selectedSnapTradeAccount?.id || "",
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: Boolean(
          snapTradeAccountPanelsEnabled &&
            (activatedAccountPanels.orders ||
              activatedAccountPanels.tradingAnalysis),
        ),
      },
    },
  );
  const snapTradeHistoryParams = useMemo(
    () => ({
      from: performanceCalendarParams.from,
      range,
    }),
    [performanceCalendarParams.from, range],
  );
  const snapTradeHistoryQuery = useGetSnapTradeAccountHistory(
    selectedSnapTradeAccount?.id || "",
    snapTradeHistoryParams,
    {
      query: {
        ...ACCOUNT_DERIVED_QUERY_OPTIONS.query,
        staleTime: ACCOUNT_HISTORY_STALE_MS,
        refetchInterval: false,
        retry: false,
        enabled: snapTradeAccountPanelsEnabled,
      },
    },
  );
  const primaryAccountRestQueriesEnabled = Boolean(
    genericAccountQueriesEnabled &&
      (!accountPageStreamEnabled ||
        !accountPageStreamFreshness.accountPrimaryFresh),
  );
  const liveAccountQueriesEnabled = Boolean(
    genericAccountQueriesEnabled &&
      (!accountPageStreamEnabled ||
        !accountPageStreamFreshness.accountLiveFresh),
  );
  const derivedAccountQueriesEnabled = Boolean(
    genericAccountQueriesEnabled &&
      (!accountPageStreamEnabled ||
        !accountPageStreamFreshness.accountDerivedFresh),
  );
  const equityHistoryQueriesEnabled = Boolean(derivedAccountQueriesEnabled);
  const secondaryAccountQueriesEnabled = Boolean(derivedAccountQueriesEnabled);
  const benchmarkQueriesEnabled = Boolean(equityHistoryQueriesEnabled);
  const performanceCalendarQueriesEnabled =
    resolvePerformanceCalendarQueriesEnabled(genericAccountQueriesEnabled);
  const todayPanelQueriesEnabled = Boolean(
    liveAccountQueriesEnabled && activatedAccountPanels.today,
  );
  const tradingAnalysisQueriesEnabled = Boolean(genericAccountQueriesEnabled);
  const ordersPanelQueriesEnabled = Boolean(primaryAccountRestQueriesEnabled);
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

  // Flex health is the diagnostic that explains why the broker session is disconnected, and
  // GET /accounts/flex/health is a plain server route that responds regardless of
  // broker state. Gate it only on the Account screen being visible (not on the
  // broker being connected via accountQueriesEnabled, nor on the Setup & Health
  // accordion being expanded) so a disconnected broker can still be diagnosed and
  // reconnected instead of the diagnostic being gated behind the very state it
  // would explain.
  const healthQuery = useGetFlexHealth({
    query: {
      staleTime: 15_000,
      refetchInterval: healthRefreshInterval,
      enabled: Boolean(isVisible && !shadowMode && !safeQaMode),
      retry: false,
    },
  });
  const summaryQuery = useGetAccountSummary(
    accountRequestId,
    accountDataParams,
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: primaryAccountRestQueriesEnabled,
        ...getSafeQaInitialQueryOptions(safeQaExposureFixture?.summary),
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
        enabled: todayPanelQueriesEnabled,
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
        refetchInterval: secondaryRefreshInterval,
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
      liveQuotes: true,
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
    closedTradeParams,
    {
      query: {
        ...ACCOUNT_DERIVED_QUERY_OPTIONS.query,
        staleTime: ACCOUNT_LIVE_STALE_MS,
        refetchInterval: tradesRefreshInterval,
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
        refetchInterval: liveRefreshInterval,
        enabled: ordersPanelQueriesEnabled,
      },
    },
  );
  const riskQuery = useGetAccountRisk(accountRequestId, riskParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: secondaryRefreshInterval,
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
  const snapTradeHistoryQueryForDisplay = withoutFailedQueryData(
    snapTradeHistoryQuery,
  );
  const snapTradePanelData = useMemo(
    () =>
      selectedSnapTradeAccount && snapTradePortfolioQueryForDisplay.data
        ? buildSnapTradeAccountPanelData({
            account: selectedSnapTradeAccount,
            portfolio: snapTradePortfolioQueryForDisplay.data,
            recentOrders: snapTradeRecentOrdersQueryForDisplay.data,
            history: snapTradeHistoryQueryForDisplay.data,
            orderTab: effectiveOrderTab,
            range,
          })
        : null,
    [
      effectiveOrderTab,
      range,
      selectedSnapTradeAccount,
      snapTradeHistoryQueryForDisplay.data,
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
  const riskQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildIdleAccountQuery(null)
    : withoutFailedQueryData(riskQuery);
  const cashQueryForDisplay = snapTradeAccountPanelsEnabled
    ? buildIdleAccountQuery(snapTradePanelData?.cash)
    : withoutFailedQueryData(cashQuery);
  const shadowWatchlistBacktestMutation = useMutation({
    mutationFn: (payload = { timeframe: "15m" }) =>
      platformJsonRequest("/api/accounts/shadow/watchlist-backtest/runs", {
        method: "POST",
        body: payload,
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

  const currency =
    summaryQueryForDisplay.data?.currency ||
    equityQueryForPanel.data?.currency ||
    cashQueryForDisplay.data?.currency ||
    accounts[0]?.currency ||
    "USD";
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
  const livePositionsDayPnl = useMemo(
    () =>
      livePositionsDayPnlMetric({
        positionsResponse: positionsQueryForDisplay.data,
        fallbackMetric: displaySummaryData?.metrics?.dayPnl,
        tradesResponse: performanceCalendarTradesQueryForDisplay.data,
        currency,
      }),
    [
      currency,
      displaySummaryData?.metrics?.dayPnl,
      performanceCalendarTradesQueryForDisplay.data,
      positionsQueryForDisplay.data,
    ],
  );
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
  // Owner ruling (2026-07-09, Riley): day P&L on this screen means the positions-table
  // number — the open positions' day change — NOT the equity-history NLV move the
  // backend summary metric carries (that one also folds in realized P&L from exited
  // positions; the two read +$2.0K vs -$3.7K on 2026-07-09). The hero pill must read
  // the same source as the P&L calendar so the two surfaces can never disagree.
  const heroSummaryData = useMemo(() => {
    const openDayPnl = finiteAccountNumber(
      livePositionsDayPnl?.openPositionsDayPnl,
    );
    if (!displaySummaryData || openDayPnl == null) {
      return displaySummaryData;
    }
    const openDayPnlPercent = finiteAccountNumber(
      livePositionsDayPnl?.openPositionsDayPnlPercent,
    );
    return {
      ...displaySummaryData,
      metrics: {
        ...displaySummaryData.metrics,
        dayPnl: {
          ...(displaySummaryData.metrics?.dayPnl || {}),
          value: openDayPnl,
          source: "positions_table",
          field: "OpenPositionsDayChange",
        },
        dayPnlPercent: {
          ...(displaySummaryData.metrics?.dayPnlPercent || {}),
          value: openDayPnlPercent,
          source: "positions_table",
          field: "OpenPositionsDayChangePercent",
        },
      },
    };
  }, [displaySummaryData, livePositionsDayPnl]);
  const equityQueryForDisplay = useMemo(
    () =>
      equityQueryWithLivePositionsTerminal({
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
    ],
  );
  const accountAnalysisQueryForDisplay = tradesQueryForDisplay;
  const accountAnalysisTradesForDisplay =
    tradesQueryForDisplay.data?.trades || [];
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
    const orders = ordersQueryForDisplay.data?.orders || [];
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
    if (!gatewayTradingReady) {
      window.alert(gatewayTradingMessage);
      return;
    }

    if (
      !window.confirm(`Cancel ${order.symbol} ${order.side} order ${order.id}?`)
    ) {
      return;
    }
    try {
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
  const accountActivePrefetchEnabled = Boolean(
    accountQueriesEnabled &&
      (!accountPageStreamEnabled ||
        !accountPageStreamFreshness.accountPrimaryFresh),
  );
  useEffect(() => {
    if (!accountActivePrefetchEnabled) {
      return;
    }
    prefetchAccountTabLiveQueries(accountTab);
  }, [accountActivePrefetchEnabled, accountTab, prefetchAccountTabLiveQueries]);

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
            activeTabId={accountTab}
            onSelectTab={setAccountTab}
            onTabIntent={prefetchAccountTabLiveQueries}
            accountIsPhone={accountIsPhone}
            maskValues={maskAccountValues}
          />
        </div>

        <DeferredPanelSuspense
          minHeight={accountIsPhone ? 58 : 42}
          title="Loading account summary"
          detail="Preparing balances and account status."
        >
          <AccountHeroBlock
            summary={heroSummaryData}
            equityHistory={equityQueryForPanel.data}
            benchmarkHistories={{
              SPY: spyBenchmarkQueryForDisplay.data,
              QQQ: qqqBenchmarkQueryForDisplay.data,
              DJIA: djiaBenchmarkQueryForDisplay.data,
            }}
            positionsResponse={positionsQueryForDisplay.data}
            tradesResponse={tradesQueryForDisplay.data}
            cashResponse={cashQueryForDisplay.data}
            range={range}
            currency={currency}
            maskValues={maskAccountValues}
            shadowMode={shadowMode}
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
                dailyPnl={livePositionsDayPnl}
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
                currentNetLiquidation={livePositionNetLiquidation}
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
                currentPositionsCount={openAccountPositions.length}
                currency={currency}
                maskValues={maskAccountValues}
                onClearPin={() => setPinnedEquityDate(null)}
                onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
              />
            </DeferredPanelSuspense>
          </div>
        </div>

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
            onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
            accountId={positionManagementAccountId}
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
              orders={ordersQueryForDisplay.data?.orders || []}
              positions={openAccountPositions}
              filters={tradeFilters}
              dispatchFilters={dispatchTradeFilters}
              range={range}
              onRangeChange={setRange}
              currency={currency}
              maskValues={maskAccountValues}
              selectedTradeId={selectedAccountTradeId}
              onTradeSelect={setSelectedAccountTradeId}
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
              cancelPending={cancelOrderMutation.isPending}
              cancelDisabled={
                snapTradeAccountPanelsEnabled || !gatewayTradingReady
              }
              cancelDisabledReason={
                snapTradeAccountPanelsEnabled
                  ? "SnapTrade order cancellation is handled outside this panel."
                  : gatewayTradingMessage
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
                  session={session}
                  healthQuery={healthQueryForDisplay}
                  testMutation={testFlexMutation}
                  brokerConfigured={brokerConfigured}
                  brokerAuthenticated={brokerAuthenticated}
                />
              </DeferredPanelSuspense>
            )}
          </div>
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
