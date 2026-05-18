import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetAccountEquityHistoryQueryOptions,
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
  useGetAccountTradingPatterns,
  useGetFlexHealth,
  useTestFlexToken,
  useCreateAccountTradingPatternsSnapshot,
} from "@workspace/api-client-react";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  useAccountPageSnapshotStream,
  useBrokerStreamFreshnessSnapshot,
} from "../features/platform/live-streams";
import { useRuntimeControlSnapshot } from "../features/platform/useRuntimeControlSnapshot";
import DeferredRender from "../components/platform/DeferredRender";
import { platformJsonRequest } from "../features/platform/platformJsonRequest";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { responsiveFlags, useElementSize, useViewport } from "../lib/responsive";
import { FONT_WEIGHTS, RADII, RAYALGO_STORAGE_KEY, T, dim, fs, sp, textSize } from "../lib/uiTokens.jsx";
import { formatAppDateTime } from "../lib/timeZone";
import AccountHeaderStrip from "./account/AccountHeaderStrip";
import AccountHeroBlock from "./account/AccountHeroBlock";
import AccountReturnsPanel from "./account/AccountReturnsPanel";
import EquityCurvePanel from "./account/EquityCurvePanel";
import PortfolioExposurePanel from "./account/PortfolioExposurePanel";
import PositionsPanel, { PositionsAtDateInspector } from "./account/PositionsPanel";
import TradingPatternsPanel from "./account/TradingPatternsPanel";
import CashFundingPanel from "./account/CashFundingPanel";
import SetupHealthPanel from "./account/SetupHealthPanel";
import TodaySnapshotPanel from "./account/TodaySnapshotPanel";
import {
  ClosedTradesPanel,
  OrdersPanel,
  SelectedTradeAnalysisPanel,
} from "./account/TradesOrdersPanel";
import { buildAccountReturnsModel } from "./account/accountReturnsModel";
import {
  applyPatternLensToTradeFilters,
  buildAccountPatternLens,
  clearPatternLensFromTradeFilters,
  emptyAccountPatternLens,
} from "./account/accountPatternLens";
import { getOpenPositionRows } from "../features/account/accountPositionRows.js";
import {
  ACCOUNT_RANGES,
  Panel,
  Pill,
  denseButtonStyle,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  normalizeAccountRange,
} from "./account/accountUtils";
import { SegmentedControl } from "../components/platform/primitives.jsx";
import { buildAccountTradingAnalysisModel } from "./account/accountTradingAnalysis";
import { buildAccountRefreshPolicy } from "./account/accountRefreshPolicy";
import {
  accountDateFilterBoundaryIso,
  buildPerformanceCalendarParams,
  performanceCalendarQueriesEnabled as resolvePerformanceCalendarQueriesEnabled,
  resolveReturnsCalendarData,
} from "./account/accountCalendarData";

const QUERY_OPTIONS = {
  query: {
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  },
};

const DEFAULT_EQUITY_BENCHMARK_VISIBILITY = {
  SPY: true,
  QQQ: false,
  DJIA: false,
};

const SHADOW_ACCOUNT_ID = "shadow";
const ACCOUNT_SECTIONS = [
  { value: "real", label: "Real" },
  { value: "shadow", label: "Shadow" },
];

const readAccountWorkspaceDefault = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed[key] ?? fallback;
  } catch {
    return fallback;
  }
};

const writeAccountWorkspaceDefault = (key, value) => {
  try {
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(
      RAYALGO_STORAGE_KEY,
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
    run?.marketDateFrom && run?.marketDateTo && run.marketDateFrom !== run.marketDateTo
      ? `${run.marketDateFrom} -> ${run.marketDateTo}`
      : run?.marketDate || "One-off ledger run";
  const runButtonStyle = {
    minHeight: dim(32),
    padding: sp("6px 14px"),
    border: `1px solid ${running ? T.textMuted : T.pink}`,
    borderRadius: dim(RADII.sm),
    background: running ? T.bg1 : `${T.pink}22`,
    color: running ? T.textMuted : T.pink,
    fontSize: fs(10),
    fontFamily: T.sans,
    fontWeight: FONT_WEIGHTS.medium,
    letterSpacing: "0.04em",
    cursor: running ? "wait" : "pointer",
    textTransform: "uppercase",
  };
  return (
    <Panel
      title="Watchlist Backtest"
      rightRail={runLabel}
      minHeight={150}
      error={error}
      action={
        <div style={{ display: "flex", gap: sp(3), flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => mutation.mutate({ timeframe: "15m" })}
            disabled={running}
            data-testid="shadow-watchlist-backtest-run-today"
            style={runButtonStyle}
          >
            {running ? "Running" : "Today"}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate({ timeframe: "15m", range: "past_week" })}
            disabled={running}
            data-testid="shadow-watchlist-backtest-run-week"
            style={runButtonStyle}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate({ timeframe: "15m", range: "last_month" })}
            disabled={running}
            data-testid="shadow-watchlist-backtest-run-month"
            style={runButtonStyle}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate({ timeframe: "15m", range: "ytd" })}
            disabled={running}
            data-testid="shadow-watchlist-backtest-run-ytd"
            style={runButtonStyle}
          >
            YTD
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate({ timeframe: "5m", range: "ytd", sweep: true })}
            disabled={running}
            data-testid="shadow-watchlist-backtest-run-ytd-5m-sweep"
            style={{
              ...runButtonStyle,
              borderColor: running ? T.textMuted : T.cyan,
              background: running ? T.bg2 : `${T.cyan}22`,
              color: running ? T.textMuted : T.cyan,
            }}
          >
            5m Sweep
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: sp(6) }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
          <Pill tone="pink">Watchlist Backtest</Pill>
          <Pill tone="green">Spot Equity</Pill>
          <Pill tone="cyan">{run?.timeframe || "15m"} RayReplica</Pill>
          {run?.sweep ? <Pill tone="purple">Regime Sweep</Pill> : null}
          <Pill tone="purple">Ledger Synthetic</Pill>
        </div>
        <div style={{ color: T.textSec, fontSize: textSize("caption"), lineHeight: 1.35 }}>
          Runs all saved watchlists from the New York regular-session open through
          the latest completed bar in the selected window. Rows are written as synthetic Shadow ledger
          activity, isolated from prior backtest rows, and sized around current Shadow exposure.
        </div>
        {run ? (
          <>
            <div
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                overflowX: "auto",
                background: T.bg0,
                borderRadius: dim(RADII.xs),
                minWidth: 0,
              }}
            >
              {[
                ["Signals", summary.signals, T.cyan],
                ["Orders", summary.ordersCreated, T.text],
                ["Open", summary.openSyntheticPositions, T.purple],
                ["Skipped", summary.skippedSignals, T.amber],
              ].map(([label, value, color], index) => (
                <div
                  key={label}
                  style={{
                    flex: "1 1 auto",
                    minWidth: dim(64),
                    padding: sp("4px 9px"),
                    borderLeft: index === 0 ? "none" : `1px solid ${T.border}`,
                  }}
                >
                  <div style={{ color: T.textMuted, fontSize: textSize("caption"), fontFamily: T.sans }}>
                    {label.toUpperCase()}
                  </div>
                  <div style={{ color, fontSize: fs(12), fontFamily: T.sans, fontWeight: FONT_WEIGHTS.regular }}>
                    {formatNumber(value || 0, 0)}
                  </div>
                </div>
              ))}
            </div>
            <div
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                overflowX: "auto",
                gap: sp(8),
                color: T.textSec,
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                minWidth: 0,
              }}
            >
              <span style={{ flexShrink: 0 }}>
                P&L{" "}
                <span style={{ color: pnl >= 0 ? T.green : T.red, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountMoney(summary.realizedPnl, currency, true, maskValues)}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Fees {formatAccountMoney(summary.fees, currency, true, maskValues)}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Cap {formatAccountPercent((sizing.maxPositionFraction || 0) * 100, 0, maskValues)}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Win {formatAccountPercent(summary.winRatePercent, 0, maskValues)}
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Exp{" "}
                <span style={{ color: Number(summary.expectancy || 0) >= 0 ? T.green : T.red, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountMoney(summary.expectancy, currency, true, maskValues)}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>Closed {formatNumber(summary.closedTrades || 0, 0)}</span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                NAV{" "}
                <span style={{ color: T.green, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountMoney(summary.endingNetLiquidation, currency, true, maskValues)}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>
                Max DD{" "}
                <span style={{ color: T.red, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountPercent(summary.maxDrawdownPercent, 1, maskValues)}
                </span>
              </span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ flexShrink: 0 }}>Proxy fills {formatNumber(summary.proxyFills || 0, 0)}</span>
            </div>
            {run.sweep ? (
              <div
                style={{
                  border: "none",
                  borderRadius: dim(RADII.xs),
                  background: T.bg0,
                  padding: sp(6),
                  display: "grid",
                  gap: sp(4),
                }}
              >
                <div style={{ color: T.text, fontSize: textSize("caption"), fontFamily: T.sans, fontWeight: FONT_WEIGHTS.regular }}>
                  Winner {run.sweep.winnerId || "n/a"} · {formatNumber(run.sweep.variantCount || 0, 0)} variants · highest NAV
                </div>
                {(run.sweep.variants || []).slice(0, 3).map((variant) => (
                  <div
                    key={variant.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.5fr) repeat(4, minmax(0, 0.7fr))",
                      gap: sp(4),
                      color: variant.rank === 1 ? T.green : T.textSec,
                      fontSize: textSize("body"),
                      fontFamily: T.sans,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      #{variant.rank} {variant.id}
                    </span>
                    <span>{formatAccountMoney(variant.summary?.endingNetLiquidation, currency, true, maskValues)}</span>
                    <span>DD {formatAccountPercent(variant.summary?.maxDrawdownPercent, 1, maskValues)}</span>
                    <span>Win {formatAccountPercent(variant.summary?.winRatePercent, 0, maskValues)}</span>
                    <span>{formatNumber(variant.summary?.ordersCreated || 0, 0)} fills</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ color: T.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
              {formatAppDateTime(run.window?.start)}
              {" -> "}
              {formatAppDateTime(run.window?.end)}
              {" · "}
              {formatNumber(run.universe?.symbolCount || 0, 0)} symbols across{" "}
              {formatNumber(run.universe?.watchlistCount || 0, 0)} watchlists
            </div>
          </>
        ) : (
          <div style={{ color: T.textDim, fontSize: textSize("caption"), fontFamily: T.sans }}>
            No run has been executed in this browser session.
          </div>
        )}
      </div>
    </Panel>
  );
};

export const AccountScreen = ({
  session,
  accounts = [],
  selectedAccountId,
  onSelectTradingAccount,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  isVisible = false,
  onJumpToTrade,
}) => {
  const queryClient = useQueryClient();
  const { preferences: userPreferences } = useUserPreferences();
  const maskAccountValues = Boolean(
    userPreferences.appearance.maskBalances ||
      userPreferences.privacy.hideAccountValues,
  );
  const [accountViewId, setAccountViewId] = useState("combined");
  const [range, setRange] = useState(() =>
    normalizeAccountRange(readAccountWorkspaceDefault("accountRange", "ALL")),
  );
  const [assetFilter, setAssetFilter] = useState(() =>
    readAccountWorkspaceDefault("accountAssetFilter", "all"),
  );
  const [orderTab, setOrderTab] = useState(() =>
    readAccountWorkspaceDefault("accountOrderTab", "working"),
  );
  const [tradeFilters, setTradeFilters] = useState({
    symbol: "",
    assetClass: "all",
    pnlSign: "all",
    sourceType: "all",
    side: "all",
    holdDuration: "all",
    strategy: "all",
    feeDrag: "all",
    from: "",
    to: "",
    closeHour: null,
  });
  const [selectedPatternLens, setSelectedPatternLens] = useState(emptyAccountPatternLens);
  const [selectedAccountTradeId, setSelectedAccountTradeId] = useState("");
  const [hoveredEquityDate, setHoveredEquityDate] = useState(null);
  const [pinnedEquityDate, setPinnedEquityDate] = useState(null);
  const [visibleEquityBenchmarks, setVisibleEquityBenchmarks] = useState(
    DEFAULT_EQUITY_BENCHMARK_VISIBILITY,
  );
  const [accountLayoutRef, accountLayoutSize] = useElementSize();
  const accountElementFlags = responsiveFlags(accountLayoutSize.width);
  const viewport = useViewport();
  const accountIsPhone = viewport.flags.isPhone || accountElementFlags.isPhone;
  const accountIsNarrow = viewport.flags.isNarrow || accountElementFlags.isNarrow;
  const [accountSection, setAccountSection] = useState(() =>
    readAccountWorkspaceDefault("accountSection", "real"),
  );

  useEffect(() => {
    writeAccountWorkspaceDefault("accountRange", range);
  }, [range]);

  useEffect(() => {
    writeAccountWorkspaceDefault("accountAssetFilter", assetFilter);
  }, [assetFilter]);

  useEffect(() => {
    writeAccountWorkspaceDefault("accountOrderTab", orderTab);
  }, [orderTab]);

  useEffect(() => {
    writeAccountWorkspaceDefault("accountSection", accountSection);
  }, [accountSection]);

  useEffect(() => {
    if (accountSection === "shadow" && orderTab === "working") {
      setOrderTab("history");
    }
  }, [accountSection, orderTab]);

  useEffect(() => {
    const listener = () => {
      setRange(normalizeAccountRange(readAccountWorkspaceDefault("accountRange", "ALL")));
      setAssetFilter(readAccountWorkspaceDefault("accountAssetFilter", "all"));
      setOrderTab(readAccountWorkspaceDefault("accountOrderTab", "working"));
      setAccountSection(readAccountWorkspaceDefault("accountSection", "real"));
    };
    window.addEventListener("rayalgo:workspace-settings-updated", listener);
    return () => window.removeEventListener("rayalgo:workspace-settings-updated", listener);
  }, []);

  useEffect(() => {
    if (!accounts.length && accountViewId !== "combined") {
      setAccountViewId("combined");
    }
  }, [accountViewId, accounts]);

  const activeAccountId = accountViewId || selectedAccountId || "combined";
  const shadowMode = accountSection === "shadow";
  const accountRequestId = shadowMode ? SHADOW_ACCOUNT_ID : activeAccountId;
  const accountQueriesEnabled = Boolean(
    isVisible &&
      accountRequestId &&
      (shadowMode || brokerConfigured || brokerAuthenticated || accounts.length),
  );
  const modeParams = useMemo(
    () => ({
      mode: shadowMode ? "paper" : environment || "paper",
    }),
    [environment, shadowMode],
  );
  const shadowSourceLabel = shadowMode ? "Shadow Ledger" : "Flex";
  const accountDataParams = useMemo(
    () => ({ ...modeParams }),
    [modeParams],
  );
  const equityHistoryQuerySettings = useMemo(
    () => ({
      staleTime: 60_000,
      retry: false,
    }),
    [],
  );
  const closedTradeParams = useMemo(
    () => ({
      ...accountDataParams,
      symbol: tradeFilters.symbol || undefined,
      assetClass:
        tradeFilters.assetClass && tradeFilters.assetClass !== "all"
          ? tradeFilters.assetClass
          : undefined,
      pnlSign:
        tradeFilters.pnlSign && tradeFilters.pnlSign !== "all"
          ? tradeFilters.pnlSign
          : undefined,
      holdDuration:
        tradeFilters.holdDuration && tradeFilters.holdDuration !== "all"
          ? tradeFilters.holdDuration
          : undefined,
      from: accountDateFilterBoundaryIso(tradeFilters.from),
      to: accountDateFilterBoundaryIso(tradeFilters.to, { endOfDay: true }),
    }),
    [accountDataParams, tradeFilters],
  );
  const performanceCalendarParams = useMemo(
    () => buildPerformanceCalendarParams(accountDataParams),
    [accountDataParams],
  );
  const brokerStreamFreshness = useBrokerStreamFreshnessSnapshot(!shadowMode);
  const accountPageStreamEnabled = Boolean(
    isVisible && accountQueriesEnabled,
  );
  const accountPageStreamFreshness = useAccountPageSnapshotStream({
    accountId: accountRequestId,
    mode: modeParams.mode,
    range,
    orderTab,
    assetClass: assetFilter === "all" ? undefined : assetFilter,
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
  const accountRuntimeControl = useRuntimeControlSnapshot({
    enabled: accountPageStreamEnabled && !shadowMode,
    runtimeDiagnosticsEnabled: false,
    lineUsageEnabled: true,
    lineUsageStreamEnabled: true,
    lineUsagePollInterval: 2_000,
  });
  const accountWarmupPending = Boolean(
    accountRuntimeControl.lineUsage?.warmup?.accountPendingLineCount > 0,
  );
  const refreshPolicy = useMemo(
    () =>
      buildAccountRefreshPolicy({
        isVisible,
        accountPageStreamFresh: accountPageStreamFreshness.accountFresh,
        accountWarmupPending,
        accountStreamFresh: brokerStreamFreshness.accountFresh,
        orderStreamFresh: brokerStreamFreshness.orderFresh,
        shadowMode,
      }),
    [
      accountWarmupPending,
      accountPageStreamFreshness.accountFresh,
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
  const equityHistoryQueriesEnabled = Boolean(accountQueriesEnabled);
  const secondaryAccountQueriesEnabled = Boolean(accountQueriesEnabled);
  const benchmarkQueriesEnabled = Boolean(equityHistoryQueriesEnabled);
  const performanceCalendarQueriesEnabled = resolvePerformanceCalendarQueriesEnabled(
    secondaryAccountQueriesEnabled,
  );
  useRuntimeWorkloadFlag("account:live", Boolean(liveRefreshInterval), {
    kind: "poll",
    label: "Account live",
    detail: refreshPolicy.streamBacked
      ? "1s stream"
      : shadowMode
        ? "30s fallback"
        : "10s fallback",
    priority: 4,
  });
  useRuntimeWorkloadFlag("account:equity", Boolean(chartRefreshInterval), {
    kind: "poll",
    label: "Account equity",
    detail: refreshPolicy.streamBacked ? "1s stream" : "60s",
    priority: 6,
  });

  const healthQuery = useGetFlexHealth({
    query: {
      staleTime: 15_000,
      refetchInterval: healthRefreshInterval,
      enabled: Boolean(isVisible && !shadowMode),
      retry: false,
    },
  });
  const summaryQuery = useGetAccountSummary(accountRequestId, accountDataParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: accountQueriesEnabled,
    },
  });
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
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
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
        refetchInterval: liveRefreshInterval,
        enabled: accountQueriesEnabled,
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
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(benchmarkQueriesEnabled && visibleEquityBenchmarks.SPY),
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
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
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(benchmarkQueriesEnabled && visibleEquityBenchmarks.QQQ),
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
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
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(benchmarkQueriesEnabled && visibleEquityBenchmarks.DJIA),
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
      },
    },
  );
  const allocationQuery = useGetAccountAllocation(accountRequestId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: secondaryRefreshInterval,
      enabled: secondaryAccountQueriesEnabled,
    },
  });
  const positionsQuery = useGetAccountPositions(
    accountRequestId,
    {
      ...accountDataParams,
      assetClass: assetFilter === "all" ? undefined : assetFilter,
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: accountQueriesEnabled,
      },
    },
  );
  const activeEquityInspectionDate = pinnedEquityDate || hoveredEquityDate;
  const positionsAtDateQuery = useGetAccountPositionsAtDate(
    accountRequestId,
    {
      ...accountDataParams,
      date: activeEquityInspectionDate || "1970-01-01",
      assetClass: assetFilter === "all" ? undefined : assetFilter,
    },
    {
      query: {
        staleTime: 30_000,
        retry: false,
        enabled: Boolean(
          secondaryAccountQueriesEnabled && activeEquityInspectionDate,
        ),
      },
    },
  );
  const performanceCalendarEquityQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...accountDataParams,
      range: "1Y",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: performanceCalendarQueriesEnabled,
      },
    },
  );
  const performanceCalendarTradesQuery = useGetAccountClosedTrades(
    accountRequestId,
    performanceCalendarParams,
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: chartRefreshInterval,
        enabled: performanceCalendarQueriesEnabled,
      },
    },
  );
  const tradesQuery = useGetAccountClosedTrades(accountRequestId, closedTradeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: tradesRefreshInterval,
      enabled: secondaryAccountQueriesEnabled,
    },
  });
  const ordersQuery = useGetAccountOrders(
    accountRequestId,
    {
      ...accountDataParams,
      tab: orderTab,
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: accountQueriesEnabled,
      },
    },
  );
  const riskQuery = useGetAccountRisk(accountRequestId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: secondaryRefreshInterval,
      enabled: secondaryAccountQueriesEnabled,
    },
  });
  const cashQuery = useGetAccountCashActivity(accountRequestId, accountDataParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: secondaryRefreshInterval,
      enabled: secondaryAccountQueriesEnabled,
    },
  });
  const tradingPatternsQuery = useGetAccountTradingPatterns(
    accountRequestId,
    {
      range,
      snapshotId: "latest",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(
          secondaryAccountQueriesEnabled && shadowMode && accountRequestId,
        ),
        placeholderData: (previousData) =>
          previousData?.context?.range === range ? previousData : undefined,
      },
    },
  );
  const tradingPatternsSnapshotMutation = useCreateAccountTradingPatternsSnapshot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            String(query.queryKey[0] || "").includes("/api/accounts/shadow"),
        });
      },
    },
  });
  const shadowWatchlistBacktestMutation = useMutation({
    mutationFn: (payload = { timeframe: "15m" }) =>
      platformJsonRequest("/api/accounts/shadow/watchlist-backtest/runs", {
        method: "POST",
        body: payload,
        timeoutMs: payload?.sweep ? 600_000 : 120_000,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          String(query.queryKey[0] || "").includes("/api/accounts/shadow"),
      });
    },
  });
  const cancelOrderMutation = useCancelAccountOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${accountRequestId}/orders`],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${accountRequestId}/positions`],
        });
      },
    },
  });

  useEffect(() => {
    setHoveredEquityDate(null);
    setPinnedEquityDate(null);
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
      },
    },
  });

  useEffect(() => {
    if (
      !isVisible ||
      !accountRequestId ||
      shadowMode
    ) {
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
  }, [
    accountRequestId,
    equityHistoryQuerySettings,
    isVisible,
    accountDataParams,
    queryClient,
    shadowMode,
    visibleEquityBenchmarks,
  ]);

  const currency =
    summaryQuery.data?.currency ||
    equityQuery.data?.currency ||
    cashQuery.data?.currency ||
    accounts[0]?.currency ||
    "USD";
  const displaySummaryData = summaryQuery.data;
  const openAccountPositions = useMemo(
    () => getOpenPositionRows(positionsQuery.data?.positions || []),
    [positionsQuery.data],
  );
  const accountTradingAnalysis = useMemo(
    () =>
      buildAccountTradingAnalysisModel({
        trades: tradesQuery.data?.trades || [],
        orders: ordersQuery.data?.orders || [],
        positions: openAccountPositions,
        patternPacket: shadowMode ? tradingPatternsQuery.data : null,
        selectedTradeId: selectedAccountTradeId,
      }),
    [
      openAccountPositions,
      ordersQuery.data,
      selectedAccountTradeId,
      shadowMode,
      tradesQuery.data,
      tradingPatternsQuery.data,
    ],
  );
  const accountTradingPatternsQuery = useMemo(() => {
    if (shadowMode) {
      return tradingPatternsQuery;
    }
    const symbolRows = accountTradingAnalysis.bucketGroups.symbol.map((row) => ({
      symbol: row.key,
      realizedPnl: row.realizedPnl,
      closedTrades: row.count,
      winRatePercent: row.winRatePercent,
      expectancy: row.expectancy,
      profitFactor: row.profitFactor,
      averageHoldMinutes: null,
      openQuantity: openAccountPositions
        .filter((position) => String(position.symbol || "").toUpperCase() === row.key)
        .reduce((sum, position) => sum + Number(position.quantity || 0), 0),
    }));
    const sourceRows = accountTradingAnalysis.bucketGroups.source.map((row) => ({
      key: row.key,
      sourceType: row.key,
      label: row.label,
      realizedPnl: row.realizedPnl,
      closedTrades: row.count,
      winRatePercent: row.winRatePercent,
      expectancy: row.expectancy,
      profitFactor: row.profitFactor,
    }));
    return {
      data: {
        summary: {
          ...accountTradingAnalysis.summary,
          closedTrades: accountTradingAnalysis.summary.count,
          tradeEvents: tradesQuery.data?.summary?.count || accountTradingAnalysis.summary.count,
          symbolsTraded: symbolRows.length,
        },
        snapshot: { persisted: false },
        tickerStats: symbolRows,
        sourceStats: sourceRows,
        timeStats: { byHour: [] },
      },
      isLoading: tradesQuery.isLoading,
      isPending: tradesQuery.isPending,
      error: tradesQuery.error,
      refetch: tradesQuery.refetch,
    };
  }, [
    accountTradingAnalysis,
    openAccountPositions,
    shadowMode,
    tradesQuery.data,
    tradesQuery.error,
    tradesQuery.isLoading,
    tradesQuery.isPending,
    tradesQuery.refetch,
    tradingPatternsQuery,
  ]);
  const shadowAutomationAudit = useMemo(() => {
    const orders = ordersQuery.data?.orders || [];
    return {
      automationPositions: openAccountPositions.filter(
        (position) => position.sourceType === "automation",
      ).length,
      backtestPositions: openAccountPositions.filter(
        (position) => position.sourceType === "watchlist_backtest",
      ).length,
      replayPositions: openAccountPositions.filter(
        (position) => position.sourceType === "signal_options_replay",
      ).length,
      mixedPositions: openAccountPositions.filter(
        (position) => position.sourceType === "mixed",
      ).length,
      automationOrders: orders.filter((order) => order.sourceType === "automation").length,
      backtestOrders: orders.filter((order) => order.sourceType === "watchlist_backtest").length,
      replayOrders: orders.filter((order) => order.sourceType === "signal_options_replay").length,
      manualOrders: orders.filter((order) => order.sourceType === "manual").length,
    };
  }, [openAccountPositions, ordersQuery.data]);
  const { tradesData: returnsCalendarTradesData, equityPoints: returnsCalendarEquityPoints } =
    useMemo(
      () =>
        resolveReturnsCalendarData({
          performanceCalendarTradesData: performanceCalendarTradesQuery.data,
          performanceCalendarEquityData: performanceCalendarEquityQuery.data,
        }),
      [performanceCalendarEquityQuery.data, performanceCalendarTradesQuery.data],
    );
  const returnsModel = useMemo(
    () =>
      buildAccountReturnsModel({
        summary: displaySummaryData,
        equityHistory: equityQuery.data,
        benchmarkHistories: {
          SPY: spyBenchmarkQuery.data,
          QQQ: qqqBenchmarkQuery.data,
          DJIA: djiaBenchmarkQuery.data,
        },
        positionsResponse: positionsQuery.data,
        tradesResponse: tradesQuery.data,
        cashResponse: cashQuery.data,
        range,
      }),
    [
      cashQuery.data,
      djiaBenchmarkQuery.data,
      equityQuery.data,
      positionsQuery.data,
      qqqBenchmarkQuery.data,
      range,
      spyBenchmarkQuery.data,
      displaySummaryData,
      tradesQuery.data,
    ],
  );

  const handleCancelOrder = async (order) => {
    if (!gatewayTradingReady) {
      window.alert(gatewayTradingMessage);
      return;
    }

    if (!window.confirm(`Cancel ${order.symbol} ${order.side} order ${order.id}?`)) {
      return;
    }
    await cancelOrderMutation.mutateAsync({
      accountId: order.accountId,
      orderId: order.id,
      data: { confirm: true },
    });
  };
  const handleTradeFilterChange = (patch) => {
    setTradeFilters((current) => ({ ...current, ...patch, sourceType: "all" }));
  };
  const handleTradeFilterReset = () => {
    setSelectedPatternLens(emptyAccountPatternLens());
    setTradeFilters({
      symbol: "",
      assetClass: "all",
      pnlSign: "all",
      sourceType: "all",
      side: "all",
      holdDuration: "all",
      strategy: "all",
      feeDrag: "all",
      from: "",
      to: "",
      closeHour: null,
    });
    setSelectedAccountTradeId("");
  };
  const handlePatternLensChange = (kind, input) => {
    const lens = buildAccountPatternLens(kind, input);
    if (lens.kind === "source") {
      return;
    }
    setSelectedPatternLens(lens);
    setTradeFilters((current) => ({
      ...applyPatternLensToTradeFilters(current, lens),
      sourceType: "all",
    }));
    setHoveredEquityDate(null);
    setPinnedEquityDate(null);
  };
  const handlePatternLensClear = () => {
    setSelectedPatternLens(emptyAccountPatternLens());
    setHoveredEquityDate(null);
    setPinnedEquityDate(null);
    setTradeFilters((current) =>
      ({
        ...clearPatternLensFromTradeFilters(current, selectedPatternLens),
        sourceType: "all",
      }),
    );
  };
  const accountSectionControl = (
    <div style={{ marginLeft: "auto" }}>
      <SegmentedControl
        options={ACCOUNT_SECTIONS}
        value={accountSection}
        onChange={setAccountSection}
        ariaLabel="Account section"
        buttonTestId="account-section"
      />
    </div>
  );
  const headerSectionControl = accountSectionControl;

  if (!isVisible) {
    return (
      <div
        data-testid="account-screen-suspended"
        style={{ display: "none" }}
      />
    );
  }

  return (
    <div
      ref={accountLayoutRef}
      data-testid="account-screen"
      data-layout={accountIsPhone ? "phone" : accountIsNarrow ? "tablet" : "desktop"}
      className="ra-panel-enter"
      style={{
        flex: 1,
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
        overflowY: "auto",
        background: T.bg0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          padding: sp(accountIsPhone ? "12px 12px" : "20px 28px"),
          display: "grid",
          gap: sp(accountIsPhone ? 12 : 18),
        }}
      >
        <AccountHeroBlock
          summary={displaySummaryData}
          currency={currency}
          maskValues={maskAccountValues}
          shadowMode={shadowMode}
          isPhone={accountIsPhone}
          sectionControl={headerSectionControl}
        />

        <div
          className="ra-panel-enter"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            backdropFilter: "blur(8px)",
            background: `${T.bg0}e6`,
            paddingBottom: sp(4),
          }}
        >
          <AccountHeaderStrip
            summary={displaySummaryData}
            maskValues={maskAccountValues}
            brokerAuthenticated={shadowMode || brokerAuthenticated}
            accountFreshness={accountPageStreamFreshness}
          />
        </div>

        <div
          className="ra-panel-enter ra-account-overview-grid"
        >
          <div className="ra-account-overview-cell ra-account-overview-returns">
            <AccountReturnsPanel
              model={returnsModel}
              currency={currency}
              range={range}
              maskValues={maskAccountValues}
              tradesData={returnsCalendarTradesData}
              equityPoints={returnsCalendarEquityPoints}
              compact
              isPhone={accountIsPhone}
            />
          </div>
          <div className="ra-account-overview-cell ra-account-overview-exposure">
            <PortfolioExposurePanel
              allocationQuery={allocationQuery}
              riskQuery={riskQuery}
              positionsResponse={positionsQuery.data}
              currency={currency}
              subtitle={
                shadowMode
                  ? `${shadowSourceLabel} holdings, risk, and concentration`
                  : undefined
              }
              rightRail={shadowMode ? shadowSourceLabel : undefined}
              maskValues={maskAccountValues}
            />
          </div>
          <div className="ra-account-overview-cell ra-account-overview-equity">
            <EquityCurvePanel
              query={equityQuery}
              benchmarkQueries={{
                SPY: spyBenchmarkQuery,
                QQQ: qqqBenchmarkQuery,
                DJIA: djiaBenchmarkQuery,
              }}
              visibleBenchmarks={visibleEquityBenchmarks}
              onVisibleBenchmarksChange={setVisibleEquityBenchmarks}
              range={range}
              onRangeChange={setRange}
              currency={currency}
              accentColor={shadowMode ? T.pink : T.green}
              rightRail={shadowMode ? shadowSourceLabel : undefined}
              sourceLabel={shadowSourceLabel}
              maskValues={maskAccountValues}
              currentNetLiquidation={
                displaySummaryData?.metrics?.netLiquidation?.value
              }
              activeInspectionDate={activeEquityInspectionDate}
              pinnedInspectionDate={pinnedEquityDate}
              onHoverInspectionDate={setHoveredEquityDate}
              onPinInspectionDate={setPinnedEquityDate}
              dataScopeKey={`${accountRequestId}:${accountDataParams.mode || ""}:${accountSection}`}
              compact
            />
          </div>
        </div>

        <DeferredRender
          minHeight={accountIsPhone ? 340 : 300}
          testId="account-deferred-today"
        >
          <TodaySnapshotPanel
            positionsQuery={positionsQuery}
            intradayQuery={intradayPnlQuery}
            currency={currency}
            maskValues={maskAccountValues}
            emptyHeatmapBody={
              shadowMode
                ? "Treemap renders once Shadow ledger positions are opened or marked."
                : undefined
            }
          />
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 430 : 300}
          testId="account-deferred-positions"
        >
          <PositionsPanel
            query={positionsQuery}
            currency={currency}
            assetFilter={assetFilter}
            onAssetFilterChange={setAssetFilter}
            sourceFilter="all"
            onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
            rightRail={shadowMode ? "Shadow positions + marks" : undefined}
            emptyBody={
              shadowMode
                ? "Shadow fills from automation and manual tickets will appear here as segregated internal positions."
                : undefined
            }
            maskValues={maskAccountValues}
            positionsAtDateQuery={positionsAtDateQuery}
            activeEquityDate={activeEquityInspectionDate}
            pinnedEquityDate={pinnedEquityDate}
            currentPositionsCount={positionsQuery.data?.positions?.length || 0}
            onClearEquityPin={() => setPinnedEquityDate(null)}
            isPhone={accountIsPhone}
          />
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 410 : 280}
          testId="account-deferred-trading-patterns"
        >
          <TradingPatternsPanel
            query={accountTradingPatternsQuery}
            snapshotMutation={shadowMode ? tradingPatternsSnapshotMutation : null}
            accountId={accountRequestId}
            range={range}
            currency={currency}
            maskValues={maskAccountValues}
            onSymbolSelect={(symbol) =>
              setTradeFilters((current) => ({
                ...current,
                symbol,
              }))
            }
            selectedLens={selectedPatternLens}
            onLensChange={handlePatternLensChange}
            analysis={accountTradingAnalysis}
            onTradeSelect={setSelectedAccountTradeId}
            lensFilteredTrades={tradesQuery.data?.trades || []}
            isPhone={accountIsPhone}
          />
        </DeferredRender>

        {selectedPatternLens.kind !== "none" ? (
          <div
            data-testid="account-pattern-lens-strip"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              flexWrap: "wrap",
              border: "none",
              borderRadius: dim(RADII.sm),
              background: T.bg1,
              padding: sp("5px 7px"),
              color: T.textSec,
              fontFamily: T.sans,
              fontSize: textSize("body"),
            }}
          >
            <div style={{ display: "flex", gap: sp(4), alignItems: "center", flexWrap: "wrap" }}>
              <Pill tone="pink">Lens</Pill>
              <span style={{ color: T.text, fontWeight: FONT_WEIGHTS.regular }}>
                {selectedPatternLens.label}
              </span>
              {selectedPatternLens.closeHour ? (
                <span style={{ color: T.textDim }}>
                  Closed trades filtered by New York close hour.
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="ra-interactive"
              onClick={handlePatternLensClear}
              style={{
                border: "none",
                borderRadius: dim(RADII.pill),
                background: T.bg1,
                color: T.text,
                height: dim(22),
                padding: sp("0 12px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Clear
            </button>
          </div>
        ) : null}

        {accountTradingAnalysis.selectedTradeDetail?.trade ? (
          <SelectedTradeAnalysisPanel
            analysis={accountTradingAnalysis}
            currency={currency}
            maskValues={maskAccountValues}
            onJumpToChart={onJumpToTrade}
          />
        ) : null}

        <DeferredRender
          minHeight={accountIsPhone ? 680 : 360}
          testId="account-deferred-trades-orders"
        >
          <div
            className="ra-panel-enter ra-account-detail-grid"
          >
            <ClosedTradesPanel
              query={tradesQuery}
              currency={currency}
              filters={tradeFilters}
              onFiltersChange={handleTradeFilterChange}
              onResetFilters={handleTradeFilterReset}
              sourceFiltersEnabled={false}
              selectedTradeId={
                accountTradingAnalysis.selectedTradeDetail?.tradeId ||
                selectedAccountTradeId
              }
              onTradeSelect={setSelectedAccountTradeId}
              emptyBody={
                shadowMode
                  ? "Shadow exits will appear here after a manual or automation sell closes part of a position."
                  : undefined
              }
              maskValues={maskAccountValues}
              isPhone={accountIsPhone}
            />
            <OrdersPanel
              query={ordersQuery}
              tab={orderTab}
              onTabChange={setOrderTab}
              currency={currency}
              onCancelOrder={handleCancelOrder}
              cancelPending={cancelOrderMutation.isPending}
              cancelDisabled={!gatewayTradingReady}
              cancelDisabledReason={gatewayTradingMessage}
              sourceFilter="all"
              emptyBody={
                shadowMode
                  ? "Shadow orders fill immediately into the internal ledger, so working orders are normally empty."
                  : undefined
              }
              maskValues={maskAccountValues}
              isPhone={accountIsPhone}
            />
          </div>
        </DeferredRender>

        <DeferredRender
          minHeight={accountIsPhone ? 390 : 190}
          testId="account-deferred-support"
        >
          <div
            className="ra-panel-enter ra-account-support-grid"
          >
            <CashFundingPanel
              query={cashQuery}
              currency={currency}
              maskValues={maskAccountValues}
            />
            {shadowMode ? (
              <ShadowWatchlistBacktestPanel
                mutation={shadowWatchlistBacktestMutation}
                currency={currency}
                maskValues={maskAccountValues}
              />
            ) : null}
            {shadowMode ? (
              <Panel title="Shadow Account" rightRail="Internal paper" minHeight={130}>
              <div style={{ display: "grid", gap: sp(5) }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
                  <Pill tone="pink">Shadow</Pill>
                  <Pill tone="green">Cash only</Pill>
                  <Pill tone="cyan">IBKR Pro Fixed fees</Pill>
                </div>
                <div
                  style={{
                    color: T.textSec,
                    fontSize: textSize("caption"),
                    lineHeight: 1.35,
                  }}
                >
                  Starting balance is tracked at $30,000. Manual tickets and signal-options automation write to this account without touching IBKR paper.
                </div>
                <div
                  className="ra-hide-scrollbar"
                  style={{
                    display: "flex",
                    flexWrap: "nowrap",
                    overflowX: "auto",
                    background: T.bg0,
                    borderRadius: dim(RADII.xs),
                    marginTop: sp(2),
                    minWidth: 0,
                  }}
                >
                  {[
                    ["Auto Pos", shadowAutomationAudit.automationPositions, T.pink],
                    ["Backtest Pos", shadowAutomationAudit.backtestPositions, T.purple],
                    ["Options BT Pos", shadowAutomationAudit.replayPositions, T.cyan],
                    ["Auto Orders", shadowAutomationAudit.automationOrders, T.cyan],
                    ["Backtest Orders", shadowAutomationAudit.backtestOrders, T.pink],
                    ["Options BT Orders", shadowAutomationAudit.replayOrders, T.green],
                  ].map(([label, value, color], index) => (
                    <div
                      key={label}
                      style={{
                        flex: "1 1 auto",
                        minWidth: dim(80),
                        padding: sp("4px 9px"),
                        borderLeft: index === 0 ? "none" : `1px solid ${T.border}`,
                      }}
                    >
                      <div style={{ color: T.textMuted, fontSize: textSize("caption"), fontFamily: T.sans }}>
                        {label.toUpperCase()}
                      </div>
                      <div style={{ color, fontSize: fs(12), fontFamily: T.sans, fontWeight: FONT_WEIGHTS.regular }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          ) : (
            <SetupHealthPanel
              session={session}
              healthQuery={healthQuery}
              testMutation={testFlexMutation}
              brokerConfigured={brokerConfigured}
              brokerAuthenticated={brokerAuthenticated}
            />
          )}
        </div>
        </DeferredRender>

      </div>
    </div>
  );
};

export default AccountScreen;
