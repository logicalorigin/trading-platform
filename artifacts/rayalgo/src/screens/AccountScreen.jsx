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
  useGetAccountRisk,
  useGetAccountSummary,
  useGetFlexHealth,
  useTestFlexToken,
} from "@workspace/api-client-react";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import { platformJsonRequest } from "../features/platform/platformJsonRequest";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { RAYALGO_STORAGE_KEY, T, dim, fs, sp } from "../lib/uiTokens";
import { formatAppDateTime } from "../lib/timeZone";
import AccountHeaderStrip from "./account/AccountHeaderStrip";
import AccountReturnsPanel from "./account/AccountReturnsPanel";
import EquityCurvePanel from "./account/EquityCurvePanel";
import AllocationPanel from "./account/AllocationPanel";
import PositionsPanel from "./account/PositionsPanel";
import RiskDashboardPanel from "./account/RiskDashboardPanel";
import CashFundingPanel from "./account/CashFundingPanel";
import SetupHealthPanel from "./account/SetupHealthPanel";
import { ClosedTradesPanel, OrdersPanel } from "./account/TradesOrdersPanel";
import { buildAccountReturnsModel } from "./account/accountReturnsModel";
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
        </div>
      }
    >
      <div style={{ display: "grid", gap: sp(6) }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
          <Pill tone="pink">Watchlist Backtest</Pill>
          <Pill tone="green">Spot Equity</Pill>
          <Pill tone="cyan">15m RayReplica</Pill>
          <Pill tone="purple">Ledger Synthetic</Pill>
        </div>
        <div style={{ color: T.textSec, fontSize: fs(9), lineHeight: 1.35 }}>
          Runs all saved watchlists from the New York regular-session open through
          the latest completed bar in the selected window. Rows are written as synthetic Shadow ledger
          activity and kept separate from existing Shadow positions.
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
            </div>
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
    from: "",
    to: "",
  });
  const [sourceFilter, setSourceFilter] = useState("all");
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
        enabled: Boolean(isVisible && accountRequestId),
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
        enabled: Boolean(isVisible && accountRequestId && !shadowMode),
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
        enabled: Boolean(isVisible && accountRequestId && !shadowMode),
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
        enabled: Boolean(isVisible && accountRequestId && !shadowMode),
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
  const shadowWatchlistBacktestMutation = useMutation({
    mutationFn: (payload = { timeframe: "15m" }) =>
      platformJsonRequest("/api/accounts/shadow/watchlist-backtest/runs", {
        method: "POST",
        body: payload,
        timeoutMs: 120_000,
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
    setTradeFilters({
      symbol: "",
      assetClass: "all",
      pnlSign: "all",
      sourceType: "all",
      from: "",
      to: "",
    });
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
        overflow: "auto",
        background: T.bg1,
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
              compact
            />
          </div>
        </div>

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
            emptyBody={
              shadowMode
                ? "Shadow exits will appear here after a manual or automation sell closes part of a position."
                : undefined
            }
            maskValues={maskAccountValues}
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
