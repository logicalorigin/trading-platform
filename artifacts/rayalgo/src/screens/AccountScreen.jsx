import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { T, dim, fs, sp } from "../lib/uiTokens";
import AccountHeaderStrip from "./account/AccountHeaderStrip";
import EquityCurvePanel from "./account/EquityCurvePanel";
import AllocationPanel from "./account/AllocationPanel";
import PositionsPanel from "./account/PositionsPanel";
import RiskDashboardPanel from "./account/RiskDashboardPanel";
import CashFundingPanel from "./account/CashFundingPanel";
import SetupHealthPanel from "./account/SetupHealthPanel";
import { ClosedTradesPanel, OrdersPanel } from "./account/TradesOrdersPanel";
import { ACCOUNT_RANGES } from "./account/accountUtils";

const QUERY_OPTIONS = {
  query: {
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  },
};

export const AccountScreen = ({
  accounts = [],
  selectedAccountId,
  onSelectTradingAccount,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  isVisible = false,
  onJumpToTrade,
}) => {
  const queryClient = useQueryClient();
  const [accountViewId, setAccountViewId] = useState(
    accounts.length > 1 ? "combined" : selectedAccountId || accounts[0]?.id || "combined",
  );
  const [range, setRange] = useState("ALL");
  const [assetFilter, setAssetFilter] = useState("all");
  const [orderTab, setOrderTab] = useState("working");
  const [tradeFilters, setTradeFilters] = useState({
    symbol: "",
    assetClass: "all",
    pnlSign: "all",
    from: "",
    to: "",
  });

  useEffect(() => {
    if (!accounts.length && accountViewId !== "combined") {
      setAccountViewId("combined");
      return;
    }
    if (!selectedAccountId && accounts[0]?.id && accountViewId !== "combined") {
      setAccountViewId(accounts[0].id);
    }
  }, [accountViewId, accounts, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId || accountViewId === "combined") {
      return;
    }
    if (selectedAccountId !== accountViewId) {
      setAccountViewId(selectedAccountId);
    }
  }, [accountViewId, selectedAccountId]);

  const activeAccountId = accountViewId || selectedAccountId || "combined";
  const liveEnabled = Boolean(brokerConfigured && brokerAuthenticated && activeAccountId);
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
      refetchInterval: healthRefreshInterval,
      retry: false,
    },
  });
  const summaryQuery = useGetAccountSummary(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: liveEnabled,
    },
  });
  const equityQuery = useGetAccountEquityHistory(
    activeAccountId,
    {
      ...modeParams,
      range,
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(activeAccountId),
        placeholderData: (previousData) => previousData,
      },
    },
  );
  const spyBenchmarkQuery = useGetAccountEquityHistory(
    activeAccountId,
    {
      ...modeParams,
      range,
      benchmark: "SPY",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(activeAccountId),
        placeholderData: (previousData) => previousData,
      },
    },
  );
  const qqqBenchmarkQuery = useGetAccountEquityHistory(
    activeAccountId,
    {
      ...modeParams,
      range,
      benchmark: "QQQ",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(activeAccountId),
        placeholderData: (previousData) => previousData,
      },
    },
  );
  const djiaBenchmarkQuery = useGetAccountEquityHistory(
    activeAccountId,
    {
      ...modeParams,
      range,
      benchmark: "DIA",
    },
    {
      query: {
        ...equityHistoryQuerySettings,
        refetchInterval: chartRefreshInterval,
        enabled: Boolean(activeAccountId),
        placeholderData: (previousData) => previousData,
      },
    },
  );
  const allocationQuery = useGetAccountAllocation(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: liveEnabled,
    },
  });
  const positionsQuery = useGetAccountPositions(
    activeAccountId,
    {
      ...modeParams,
      assetClass: assetFilter === "all" ? undefined : assetFilter,
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: liveEnabled,
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
  const tradesQuery = useGetAccountClosedTrades(activeAccountId, closedTradeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: Boolean(activeAccountId),
    },
  });
  const ordersQuery = useGetAccountOrders(
    activeAccountId,
    {
      ...modeParams,
      tab: orderTab,
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        refetchInterval: liveRefreshInterval,
        enabled: liveEnabled,
      },
    },
  );
  const riskQuery = useGetAccountRisk(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: liveEnabled,
    },
  });
  const cashQuery = useGetAccountCashActivity(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      refetchInterval: liveRefreshInterval,
      enabled: Boolean(activeAccountId),
    },
  });

  const cancelOrderMutation = useCancelAccountOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${activeAccountId}/orders`],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${activeAccountId}/positions`],
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
    if (!activeAccountId) {
      return;
    }

    const rangesToWarm = ACCOUNT_RANGES.filter((candidate) => candidate !== range);
    rangesToWarm.forEach((prefetchRange) => {
      queryClient.prefetchQuery(
        getGetAccountEquityHistoryQueryOptions(
          activeAccountId,
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
          activeAccountId,
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
  }, [activeAccountId, equityHistoryQuerySettings, modeParams, queryClient, range]);

  const currency =
    summaryQuery.data?.currency ||
    equityQuery.data?.currency ||
    cashQuery.data?.currency ||
    accounts[0]?.currency ||
    "USD";

  const handleAccountViewChange = (nextId) => {
    setAccountViewId(nextId);
    if (nextId !== "combined") {
      onSelectTradingAccount?.(nextId);
    }
  };

  const handleCancelOrder = async (order) => {
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
      from: "",
      to: "",
    });
  };

  return (
    <div
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
          padding: sp(8),
          display: "grid",
          gap: sp(8),
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            backdropFilter: "blur(10px)",
            background: `${T.bg1}f2`,
            paddingBottom: sp(2),
          }}
        >
          <AccountHeaderStrip
            accounts={accounts}
            accountId={activeAccountId}
            onAccountIdChange={handleAccountViewChange}
            summary={summaryQuery.data}
            brokerAuthenticated={brokerAuthenticated}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)",
            gap: sp(10),
            alignItems: "stretch",
          }}
        >
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
          />
          <AllocationPanel query={allocationQuery} currency={currency} />
        </div>

        <RiskDashboardPanel query={riskQuery} currency={currency} />

        <PositionsPanel
          query={positionsQuery}
          currency={currency}
          assetFilter={assetFilter}
          onAssetFilterChange={setAssetFilter}
          onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.85fr)",
            gap: sp(10),
            alignItems: "start",
          }}
        >
          <ClosedTradesPanel
            query={tradesQuery}
            currency={currency}
            filters={tradeFilters}
            onFiltersChange={handleTradeFilterChange}
            onResetFilters={handleTradeFilterReset}
          />
          <OrdersPanel
            query={ordersQuery}
            tab={orderTab}
            onTabChange={setOrderTab}
            currency={currency}
            onCancelOrder={handleCancelOrder}
            cancelPending={cancelOrderMutation.isPending}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
            gap: sp(10),
            alignItems: "start",
          }}
        >
          <CashFundingPanel query={cashQuery} currency={currency} />
          <SetupHealthPanel
            healthQuery={healthQuery}
            testMutation={testFlexMutation}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: sp(8),
            flexWrap: "wrap",
            color: T.textMuted,
            fontSize: fs(9),
            fontFamily: T.mono,
            padding: sp("0 2px"),
          }}
        >
          <span>
            RayAlgo · Account view · {activeAccountId === "combined" ? "Aggregated real accounts" : activeAccountId}
          </span>
          <span>
            Base {summaryQuery.data?.fx?.baseCurrency || currency}
            {summaryQuery.data?.fx?.timestamp
              ? ` · FX ${new Date(summaryQuery.data.fx.timestamp).toLocaleString()}`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AccountScreen;
