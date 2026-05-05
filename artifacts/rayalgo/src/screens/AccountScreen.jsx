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
import { platformJsonRequest } from "../features/platform/platformJsonRequest";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { WorkspaceLinkChip } from "../features/platform/WorkspaceLinkChip.jsx";
import { RAYALGO_STORAGE_KEY, T, dim, fs, sp } from "../lib/uiTokens";
import { formatAppDateTime } from "../lib/timeZone";
import AccountHeaderStrip from "./account/AccountHeaderStrip";
import AccountReturnsPanel from "./account/AccountReturnsPanel";
import EquityCurvePanel from "./account/EquityCurvePanel";
import AllocationPanel from "./account/AllocationPanel";
import PortfolioRiskStrip from "./account/PortfolioRiskStrip";
import PositionsPanel, { PositionsAtDateInspector } from "./account/PositionsPanel";
import TradingPatternsPanel from "./account/TradingPatternsPanel";
import RiskDashboardPanel from "./account/RiskDashboardPanel";
import CashFundingPanel from "./account/CashFundingPanel";
import SetupHealthPanel from "./account/SetupHealthPanel";
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
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  normalizeAccountRange,
} from "./account/accountUtils";
import { buildAccountTradingAnalysisModel } from "./account/accountTradingAnalysis";

const QUERY_OPTIONS = {
  query: {
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  },
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
    minHeight: dim(24),
    padding: sp("3px 8px"),
    border: `1px solid ${running ? T.textMuted : T.pink}`,
    borderRadius: dim(4),
    background: running ? T.bg2 : `${T.pink}22`,
    color: running ? T.textMuted : T.pink,
    fontSize: fs(8),
    fontFamily: T.mono,
    fontWeight: 900,
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
        <div style={{ color: T.textSec, fontSize: fs(9), lineHeight: 1.35 }}>
          Runs all saved watchlists from the New York regular-session open through
          the latest completed bar in the selected window. Rows are written as synthetic Shadow ledger
          activity, isolated from prior backtest rows, and sized around current Shadow exposure.
        </div>
        {run ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: sp(4),
              }}
            >
              {[
                ["Signals", summary.signals, T.cyan],
                ["Orders", summary.ordersCreated, T.text],
                ["Open", summary.openSyntheticPositions, T.purple],
                ["Skipped", summary.skippedSignals, T.amber],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    background: T.bg0,
                    padding: sp("4px 5px"),
                  }}
                >
                  <div style={{ color: T.textMuted, fontSize: fs(7), fontFamily: T.mono }}>
                    {label.toUpperCase()}
                  </div>
                  <div style={{ color, fontSize: fs(12), fontFamily: T.mono, fontWeight: 900 }}>
                    {formatNumber(value || 0, 0)}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: sp(4),
                color: T.textSec,
                fontSize: fs(9),
                fontFamily: T.mono,
              }}
            >
              <div>
                P&L{" "}
                <span style={{ color: pnl >= 0 ? T.green : T.red, fontWeight: 900 }}>
                  {formatAccountMoney(summary.realizedPnl, currency, true, maskValues)}
                </span>
              </div>
              <div>
                Fees {formatAccountMoney(summary.fees, currency, true, maskValues)}
              </div>
              <div>
                Cap {formatAccountPercent((sizing.maxPositionFraction || 0) * 100, 0, maskValues)}
              </div>
              <div>
                Win {formatAccountPercent(summary.winRatePercent, 0, maskValues)}
              </div>
              <div>
                Exp{" "}
                <span style={{ color: Number(summary.expectancy || 0) >= 0 ? T.green : T.red, fontWeight: 900 }}>
                  {formatAccountMoney(summary.expectancy, currency, true, maskValues)}
                </span>
              </div>
              <div>Closed {formatNumber(summary.closedTrades || 0, 0)}</div>
              <div>
                NAV{" "}
                <span style={{ color: T.green, fontWeight: 900 }}>
                  {formatAccountMoney(summary.endingNetLiquidation, currency, true, maskValues)}
                </span>
              </div>
              <div>
                Max DD{" "}
                <span style={{ color: T.red, fontWeight: 900 }}>
                  {formatAccountPercent(summary.maxDrawdownPercent, 1, maskValues)}
                </span>
              </div>
              <div>Proxy fills {formatNumber(summary.proxyFills || 0, 0)}</div>
            </div>
            {run.sweep ? (
              <div
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(4),
                  background: T.bg0,
                  padding: sp(6),
                  display: "grid",
                  gap: sp(4),
                }}
              >
                <div style={{ color: T.text, fontSize: fs(9), fontFamily: T.mono, fontWeight: 900 }}>
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
                      fontSize: fs(8),
                      fontFamily: T.mono,
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
            <div style={{ color: T.textDim, fontSize: fs(8), fontFamily: T.mono }}>
              {formatAppDateTime(run.window?.start)}
              {" -> "}
              {formatAppDateTime(run.window?.end)}
              {" · "}
              {formatNumber(run.universe?.symbolCount || 0, 0)} symbols across{" "}
              {formatNumber(run.universe?.watchlistCount || 0, 0)} watchlists
            </div>
          </>
        ) : (
          <div style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>
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
  linkedContext = null,
  onLinkedWorkspaceGroupChange,
  onLinkedContextChange,
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
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedPatternLens, setSelectedPatternLens] = useState(emptyAccountPatternLens);
  const [selectedAccountTradeId, setSelectedAccountTradeId] = useState("");
  const [hoveredEquityDate, setHoveredEquityDate] = useState(null);
  const [pinnedEquityDate, setPinnedEquityDate] = useState(null);
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
      mode: environment || "paper",
    }),
    [environment],
  );
  const equityHistoryQuerySettings = useMemo(
    () => ({
      staleTime: 60_000,
      retry: false,
    }),
    [],
  );
  const liveRefreshInterval = isVisible ? 5_000 : false;
  const chartRefreshInterval = isVisible ? 60_000 : false;
  const healthRefreshInterval = isVisible ? 15_000 : false;
  useRuntimeWorkloadFlag("account:live", Boolean(liveRefreshInterval), {
    kind: "poll",
    label: "Account live",
    detail: "5s",
    priority: 4,
  });
  useRuntimeWorkloadFlag("account:equity", Boolean(chartRefreshInterval), {
    kind: "poll",
    label: "Account equity",
    detail: "60s",
    priority: 6,
  });

  const healthQuery = useGetFlexHealth({
    query: {
      staleTime: 15_000,
      refetchInterval: shadowMode ? false : healthRefreshInterval,
      enabled: Boolean(isVisible && !shadowMode),
      retry: false,
    },
  });
  const summaryQuery = useGetAccountSummary(accountRequestId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: accountQueriesEnabled,
    },
  });
  const equityQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...modeParams,
      range,
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: accountQueriesEnabled,
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
      },
    },
  );
  const spyBenchmarkQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...modeParams,
      range,
      benchmark: "SPY",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: accountQueriesEnabled,
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
      },
    },
  );
  const qqqBenchmarkQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...modeParams,
      range,
      benchmark: "QQQ",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: accountQueriesEnabled,
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
      },
    },
  );
  const djiaBenchmarkQuery = useGetAccountEquityHistory(
    accountRequestId,
    {
      ...modeParams,
      range,
      benchmark: "DIA",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: accountQueriesEnabled,
        placeholderData: (previousData) =>
          previousData?.range === range ? previousData : undefined,
      },
    },
  );
  const allocationQuery = useGetAccountAllocation(accountRequestId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: accountQueriesEnabled,
    },
  });
  const positionsQuery = useGetAccountPositions(
    accountRequestId,
    {
      ...modeParams,
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
      ...modeParams,
      date: activeEquityInspectionDate || "1970-01-01",
      assetClass: assetFilter === "all" ? undefined : assetFilter,
    },
    {
      query: {
        staleTime: 30_000,
        retry: false,
        enabled: Boolean(accountQueriesEnabled && activeEquityInspectionDate),
      },
    },
  );
  const closedTradeParams = useMemo(
    () => ({
      ...modeParams,
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
      from: tradeFilters.from
        ? new Date(`${tradeFilters.from}T00:00:00.000Z`).toISOString()
        : undefined,
      to: tradeFilters.to
        ? new Date(`${tradeFilters.to}T23:59:59.999Z`).toISOString()
        : undefined,
    }),
    [modeParams, tradeFilters],
  );
  const tradesQuery = useGetAccountClosedTrades(accountRequestId, closedTradeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: Boolean(isVisible && accountRequestId),
    },
  });
  const ordersQuery = useGetAccountOrders(
    accountRequestId,
    {
      ...modeParams,
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
      refetchInterval: liveRefreshInterval,
      enabled: accountQueriesEnabled,
    },
  });
  const cashQuery = useGetAccountCashActivity(accountRequestId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: Boolean(isVisible && accountRequestId),
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
        enabled: Boolean(isVisible && shadowMode && accountRequestId),
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
  const testFlexMutation = useTestFlexToken({
    mutation: {
      onSuccess: () => {
        healthQuery.refetch();
        summaryQuery.refetch();
        equityQuery.refetch();
        spyBenchmarkQuery.refetch();
        qqqBenchmarkQuery.refetch();
        djiaBenchmarkQuery.refetch();
        allocationQuery.refetch();
        tradesQuery.refetch();
        riskQuery.refetch();
        cashQuery.refetch();
      },
    },
  });

  useEffect(() => {
    if (!isVisible || !accountRequestId || shadowMode) {
      return;
    }

    const rangesToWarm = ACCOUNT_RANGES.filter((candidate) => candidate !== range);
    rangesToWarm.forEach((prefetchRange) => {
      queryClient.prefetchQuery(
        getGetAccountEquityHistoryQueryOptions(
          accountRequestId,
          {
            ...modeParams,
            range: prefetchRange,
          },
          {
            query: equityHistoryQuerySettings,
          },
        ),
      );
      queryClient.prefetchQuery(
        getGetAccountEquityHistoryQueryOptions(
          accountRequestId,
          {
            ...modeParams,
            range: prefetchRange,
            benchmark: "SPY",
          },
          {
            query: equityHistoryQuerySettings,
          },
        ),
      );
    });
  }, [
    accountRequestId,
    equityHistoryQuerySettings,
    isVisible,
    modeParams,
    queryClient,
    range,
    shadowMode,
  ]);

  const currency =
    summaryQuery.data?.currency ||
    equityQuery.data?.currency ||
    cashQuery.data?.currency ||
    accounts[0]?.currency ||
    "USD";
  const headerAccounts = shadowMode
    ? [
        {
          id: SHADOW_ACCOUNT_ID,
          displayName: "Shadow",
          currency,
          accountType: "Shadow",
          live: false,
        },
      ]
    : accounts;
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
  const shadowAutomationAudit = {
    automationPositions: openAccountPositions.filter(
      (position) => position.sourceType === "automation",
    ).length,
    backtestPositions: openAccountPositions.filter(
      (position) => position.sourceType === "watchlist_backtest",
    ).length,
    mixedPositions: openAccountPositions.filter(
      (position) => position.sourceType === "mixed",
    ).length,
    automationOrders: (ordersQuery.data?.orders || []).filter(
      (order) => order.sourceType === "automation",
    ).length,
    backtestOrders: (ordersQuery.data?.orders || []).filter(
      (order) => order.sourceType === "watchlist_backtest",
    ).length,
    manualOrders: (ordersQuery.data?.orders || []).filter(
      (order) => order.sourceType === "manual",
    ).length,
  };
  const returnsModel = useMemo(
    () =>
      buildAccountReturnsModel({
        summary: summaryQuery.data,
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
      summaryQuery.data,
      tradesQuery.data,
    ],
  );

  const handleAccountViewChange = (nextId) => {
    setAccountViewId(nextId);
    if (nextId !== "combined") {
      onSelectTradingAccount?.(nextId);
    }
  };

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
    setTradeFilters((current) => ({ ...current, ...patch }));
  };
  const handleTradeFilterReset = () => {
    setSelectedPatternLens(emptyAccountPatternLens());
    setSourceFilter("all");
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
    setSelectedPatternLens(lens);
    setTradeFilters((current) => applyPatternLensToTradeFilters(current, lens));
    setSourceFilter(lens.sourceType || "all");
  };
  const handlePatternLensClear = () => {
    setSelectedPatternLens(emptyAccountPatternLens());
    setSourceFilter("all");
    setTradeFilters((current) =>
      clearPatternLensFromTradeFilters(current, selectedPatternLens),
    );
  };
  const handleAccountSymbolSelect = (symbol) => {
    setTradeFilters((current) => ({
      ...current,
      symbol,
    }));
    onLinkedContextChange?.({ symbol });
  };
  const accountSectionControl = (
    <div
      style={{
        display: "inline-flex",
        gap: 1,
        padding: 2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(4),
        background: T.bg2,
      }}
    >
      {ACCOUNT_SECTIONS.map((section) => {
        const active = accountSection === section.value;
        const accent = section.value === "shadow" ? T.pink : T.accent;
        return (
          <button
            key={section.value}
            data-testid={`account-section-${section.value}`}
            type="button"
            className={active ? "ra-focus-rail ra-interactive" : "ra-interactive"}
            onClick={() => setAccountSection(section.value)}
            style={{
              height: dim(19),
              padding: sp("0 5px"),
              borderRadius: dim(3),
              border: `1px solid ${active ? accent : "transparent"}`,
              background: active ? `${accent}22` : "transparent",
              color: active ? accent : T.textSec,
              fontSize: fs(7),
              fontFamily: T.mono,
              fontWeight: 900,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );

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
      data-testid="account-screen"
      className="ra-panel-enter"
      style={{
        flex: 1,
        width: "100%",
        overflow: "auto",
        background: T.bg1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          maxWidth: dim(1800),
          margin: "0 auto",
          padding: sp(4),
          display: "grid",
          gap: sp(4),
        }}
      >
        <div
          className="ra-panel-enter"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            backdropFilter: "blur(10px)",
            background: `${T.bg1}f2`,
            paddingBottom: sp(1),
          }}
        >
          <AccountHeaderStrip
            accounts={headerAccounts}
            accountId={accountRequestId}
            onAccountIdChange={shadowMode ? () => undefined : handleAccountViewChange}
            summary={summaryQuery.data}
            brokerAuthenticated={shadowMode || brokerAuthenticated}
            showCombined={!shadowMode}
            maskValues={maskAccountValues}
            sectionControl={accountSectionControl}
            linkChip={
              <WorkspaceLinkChip
                panelId="account"
                context={linkedContext}
                compact
                onChangeGroup={onLinkedWorkspaceGroupChange}
              />
            }
          />
        </div>

        <PortfolioRiskStrip
          summary={summaryQuery.data}
          riskData={riskQuery.data}
          positionsResponse={positionsQuery.data}
          accountMode={shadowMode ? "shadow" : "real"}
          brokerAuthenticated={shadowMode || brokerAuthenticated}
          gatewayTradingReady={shadowMode || gatewayTradingReady}
          isLoading={
            summaryQuery.isLoading ||
            riskQuery.isLoading ||
            positionsQuery.isLoading
          }
          maskValues={maskAccountValues}
        />

        <div
          className="ra-panel-enter ra-account-overview-grid"
        >
          <div className="ra-account-overview-cell ra-account-overview-returns">
            <AccountReturnsPanel
              model={returnsModel}
              currency={currency}
              range={range}
              maskValues={maskAccountValues}
              compact
            />
          </div>
          <div className="ra-account-overview-cell ra-account-overview-allocation">
            <AllocationPanel
              query={allocationQuery}
              currency={currency}
              maskValues={maskAccountValues}
              compact
            />
          </div>
          <div className="ra-account-overview-cell ra-account-overview-risk">
            <RiskDashboardPanel
              query={riskQuery}
              positionsResponse={positionsQuery.data}
              currency={currency}
              subtitle={
                shadowMode
                  ? "Cash-account exposure, concentration, and realized Shadow ledger performance"
                  : undefined
              }
              rightRail={shadowMode ? "Internal ledger" : undefined}
              maskValues={maskAccountValues}
              compact
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
              range={range}
              onRangeChange={setRange}
              currency={currency}
              accentColor={shadowMode ? T.pink : T.green}
              rightRail={shadowMode ? "Shadow ledger" : undefined}
              sourceLabel={shadowMode ? "Shadow" : "Flex"}
              maskValues={maskAccountValues}
              currentNetLiquidation={summaryQuery.data?.metrics?.netLiquidation?.value}
              activeInspectionDate={activeEquityInspectionDate}
              pinnedInspectionDate={pinnedEquityDate}
              onHoverInspectionDate={setHoveredEquityDate}
              onPinInspectionDate={setPinnedEquityDate}
              compact
            />
          </div>
        </div>

        <PositionsAtDateInspector
          query={positionsAtDateQuery}
          activeDate={activeEquityInspectionDate}
          pinnedDate={pinnedEquityDate}
          currentPositionsCount={positionsQuery.data?.positions?.length || 0}
          currency={currency}
          maskValues={maskAccountValues}
          onClearPin={() => setPinnedEquityDate(null)}
          onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
        />

        <PositionsPanel
          query={positionsQuery}
          currency={currency}
          assetFilter={assetFilter}
          onAssetFilterChange={setAssetFilter}
          sourceFilter={shadowMode ? sourceFilter : "all"}
          onSourceFilterChange={shadowMode ? setSourceFilter : undefined}
          onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
          rightRail={shadowMode ? "Shadow positions + marks" : undefined}
          emptyBody={
            shadowMode
              ? "Shadow fills from automation and manual tickets will appear here as segregated internal positions."
              : undefined
          }
          maskValues={maskAccountValues}
        />

        <TradingPatternsPanel
          query={accountTradingPatternsQuery}
          snapshotMutation={shadowMode ? tradingPatternsSnapshotMutation : null}
          accountId={accountRequestId}
          range={range}
          currency={currency}
          maskValues={maskAccountValues}
          onSymbolSelect={handleAccountSymbolSelect}
          selectedLens={selectedPatternLens}
          onLensChange={handlePatternLensChange}
          analysis={accountTradingAnalysis}
          onTradeSelect={setSelectedAccountTradeId}
        />

        {selectedPatternLens.kind !== "none" ? (
          <div
            data-testid="account-pattern-lens-strip"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              flexWrap: "wrap",
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg2,
              padding: sp("5px 7px"),
              color: T.textSec,
              fontFamily: T.data,
              fontSize: fs(8),
            }}
          >
            <div style={{ display: "flex", gap: sp(4), alignItems: "center", flexWrap: "wrap" }}>
              <Pill tone="pink">Lens</Pill>
              <span style={{ color: T.text, fontWeight: 900 }}>
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
                border: `1px solid ${T.border}`,
                borderRadius: dim(4),
                background: "transparent",
                color: T.textSec,
                height: dim(20),
                padding: sp("0 7px"),
                fontFamily: T.data,
                fontSize: fs(8),
                fontWeight: 900,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Clear
            </button>
          </div>
        ) : null}

        <div
          className="ra-panel-enter ra-account-detail-grid"
        >
          <ClosedTradesPanel
            query={tradesQuery}
            currency={currency}
            filters={tradeFilters}
            onFiltersChange={handleTradeFilterChange}
            onResetFilters={handleTradeFilterReset}
            sourceFiltersEnabled={shadowMode}
            selectedTradeId={
              accountTradingAnalysis.selectedTradeDetail?.tradeId ||
              selectedAccountTradeId
            }
            onTradeSelect={setSelectedAccountTradeId}
            onJumpToChart={onJumpToTrade}
            emptyBody={
              shadowMode
                ? "Shadow exits will appear here after a manual or automation sell closes part of a position."
                : undefined
            }
            maskValues={maskAccountValues}
          />
          <SelectedTradeAnalysisPanel
            analysis={accountTradingAnalysis}
            currency={currency}
            maskValues={maskAccountValues}
            onJumpToChart={onJumpToTrade}
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
            sourceFilter={shadowMode ? sourceFilter : "all"}
            onSourceFilterChange={shadowMode ? setSourceFilter : undefined}
            onJumpToChart={onJumpToTrade}
            emptyBody={
              shadowMode
                ? "Shadow orders fill immediately into the internal ledger, so working orders are normally empty."
                : undefined
            }
            maskValues={maskAccountValues}
          />
        </div>

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
                    fontSize: fs(9),
                    lineHeight: 1.35,
                  }}
                >
                  Starting balance is tracked at $30,000. Manual tickets and signal-options automation write to this account without touching IBKR paper.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: sp(4),
                    paddingTop: sp(2),
                  }}
                >
                  {[
                    ["Auto Pos", shadowAutomationAudit.automationPositions, T.pink],
                    ["Backtest Pos", shadowAutomationAudit.backtestPositions, T.purple],
                    ["Auto Orders", shadowAutomationAudit.automationOrders, T.cyan],
                    ["Backtest Orders", shadowAutomationAudit.backtestOrders, T.pink],
                  ].map(([label, value, color]) => (
                    <div
                      key={label}
                      style={{
                        border: `1px solid ${T.border}`,
                        borderRadius: dim(4),
                        background: T.bg0,
                        padding: sp("4px 5px"),
                      }}
                    >
                      <div style={{ color: T.textMuted, fontSize: fs(7), fontFamily: T.mono }}>
                        {label.toUpperCase()}
                      </div>
                      <div style={{ color, fontSize: fs(12), fontFamily: T.mono, fontWeight: 900 }}>
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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: sp(6),
            flexWrap: "wrap",
            color: T.textMuted,
            fontSize: fs(8),
            fontFamily: T.mono,
            padding: sp("0 2px"),
          }}
        >
          <span>
            RayAlgo · Account view ·{" "}
            {shadowMode
              ? "Shadow internal paper"
              : activeAccountId === "combined"
                ? "Aggregated real accounts"
                : activeAccountId}
          </span>
          <span>
            Base {summaryQuery.data?.fx?.baseCurrency || currency}
            {summaryQuery.data?.fx?.timestamp
              ? ` · FX ${formatAppDateTime(summaryQuery.data.fx.timestamp)}`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AccountScreen;
