import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
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
import { T, dim, fs, sp } from "../RayAlgoPlatform";
import AccountHeaderStrip from "./account/AccountHeaderStrip";
import EquityCurvePanel from "./account/EquityCurvePanel";
import AllocationPanel from "./account/AllocationPanel";
import PositionsPanel from "./account/PositionsPanel";
import RiskDashboardPanel from "./account/RiskDashboardPanel";
import CashFundingPanel from "./account/CashFundingPanel";
import SetupHealthPanel from "./account/SetupHealthPanel";
import { ClosedTradesPanel, OrdersPanel } from "./account/TradesOrdersPanel";

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
  onJumpToTrade,
}) => {
  const queryClient = useQueryClient();
  const [accountViewId, setAccountViewId] = useState(
    accounts.length > 1 ? "combined" : selectedAccountId || accounts[0]?.id || "combined",
  );
  const [range, setRange] = useState("1M");
  const [assetFilter, setAssetFilter] = useState("all");
  const [orderTab, setOrderTab] = useState("working");

  useEffect(() => {
    if (!accounts.length && accountViewId !== "combined") {
      setAccountViewId("combined");
      return;
    }
    if (!selectedAccountId && accounts[0]?.id && accountViewId !== "combined") {
      setAccountViewId(accounts[0].id);
    }
  }, [accountViewId, accounts, selectedAccountId]);

  const activeAccountId = accountViewId || selectedAccountId || "combined";
  const liveEnabled = Boolean(brokerConfigured && brokerAuthenticated && activeAccountId);
  const modeParams = useMemo(
    () => ({
      mode: environment || "paper",
    }),
    [environment],
  );

  const healthQuery = useGetFlexHealth({
    query: {
      staleTime: 15_000,
      refetchInterval: 15_000,
      retry: false,
    },
  });
  const summaryQuery = useGetAccountSummary(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      enabled: liveEnabled,
    },
  });
  const equityQuery = useGetAccountEquityHistory(
    activeAccountId,
    {
      ...modeParams,
      range,
      benchmark: "SPY",
    },
    {
      query: {
        ...QUERY_OPTIONS.query,
        enabled: Boolean(activeAccountId),
      },
    },
  );
  const allocationQuery = useGetAccountAllocation(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
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
        enabled: liveEnabled,
      },
    },
  );
  const tradesQuery = useGetAccountClosedTrades(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
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
        enabled: liveEnabled,
      },
    },
  );
  const riskQuery = useGetAccountRisk(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      enabled: liveEnabled,
    },
  });
  const cashQuery = useGetAccountCashActivity(activeAccountId, modeParams, {
    query: {
      ...QUERY_OPTIONS.query,
      enabled: Boolean(activeAccountId),
    },
  });

  const cancelOrderMutation = useCancelAccountOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${activeAccountId}/orders`],
        });
      },
    },
  });
  const testFlexMutation = useTestFlexToken({
    mutation: {
      onSuccess: () => {
        healthQuery.refetch();
        equityQuery.refetch();
        tradesQuery.refetch();
        cashQuery.refetch();
      },
    },
  });

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

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        background:
          "radial-gradient(circle at top left, rgba(14,165,233,0.08), transparent 34%), radial-gradient(circle at top right, rgba(34,197,94,0.06), transparent 26%), linear-gradient(180deg, rgba(2,6,23,0.96), rgba(15,23,42,0.98))",
        padding: sp(14),
      }}
    >
      <div style={{ display: "grid", gap: sp(12) }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            backdropFilter: "blur(10px)",
            background: "rgba(2,6,23,0.86)",
            paddingBottom: sp(4),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: sp(10),
              marginBottom: sp(8),
            }}
          >
            <div>
              <div
                style={{
                  color: T.text,
                  fontSize: fs(18),
                  fontFamily: T.sans,
                  fontWeight: 900,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Account
              </div>
              <div
                style={{
                  color: T.textMuted,
                  fontSize: fs(10),
                  fontFamily: T.sans,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Portfolio, risk, ledger, and funding context for IBKR accounts
              </div>
            </div>
            <div
              style={{
                color: brokerAuthenticated ? T.green : T.textMuted,
                fontSize: fs(10),
                fontFamily: T.sans,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {brokerAuthenticated ? "Bridge live" : "Bridge unavailable"}
            </div>
          </div>
          <AccountHeaderStrip
            accounts={accounts}
            accountId={activeAccountId}
            onAccountIdChange={handleAccountViewChange}
            summary={summaryQuery.data}
            loading={summaryQuery.isLoading}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: sp(12) }}>
          <EquityCurvePanel
            query={equityQuery}
            range={range}
            onRangeChange={setRange}
            currency={currency}
          />
          <AllocationPanel query={allocationQuery} currency={currency} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: sp(12) }}>
          <RiskDashboardPanel query={riskQuery} currency={currency} />
          <SetupHealthPanel
            healthQuery={healthQuery}
            testMutation={testFlexMutation}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
        </div>

        <PositionsPanel
          query={positionsQuery}
          currency={currency}
          assetFilter={assetFilter}
          onAssetFilterChange={setAssetFilter}
          onJumpToChart={(symbol) => onJumpToTrade?.(symbol)}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: sp(12) }}>
          <ClosedTradesPanel query={tradesQuery} currency={currency} />
          <OrdersPanel
            query={ordersQuery}
            tab={orderTab}
            onTabChange={setOrderTab}
            currency={currency}
            onCancelOrder={handleCancelOrder}
            cancelPending={cancelOrderMutation.isPending}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: sp(12) }}>
          <CashFundingPanel query={cashQuery} currency={currency} />
        </div>
      </div>
    </div>
  );
};

export default AccountScreen;
