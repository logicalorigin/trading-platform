import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { isCredentialOnlyBroker, loadOrMigrateBrokerAccounts } from "../lib/accountRegistry.js";
import {
  closePosition,
  getDashboardLayout,
  getAccountPerformance,
  getAccounts,
  getAiFusionStatus,
  getMarketOrderFlow,
  getOrders,
  getOptionChain,
  getPositions,
  preflightOrder,
  previewOrder,
  refreshAccountPerformance,
  runAiFusionNow,
  saveDashboardLayout,
  getSpotQuote,
  rapidOptionOrder,
  submitOrder,
  updateAiFusionConfig,
} from "../lib/brokerClient.js";
import {
  isConnectedAccount,
  isMarketDataReadyAccount,
  isTradingReadyAccount,
} from "../lib/accountStatus.js";
import { normalizeSymbol } from "../lib/marketSymbols.js";
import { clearRuntimeActivity, upsertRuntimeActivity } from "../lib/runtimeDiagnostics.js";
import { APP_THEME } from "../lib/uiTheme.js";
import DraftNumberInput from "./shared/DraftNumberInput.jsx";
import { LiveBrokerTradingViewWidget } from "./TradingViewPanel.jsx";
import MetricFlowEquityChart from "./performance/MetricFlowEquityChart.jsx";

const WORKSPACE_SESSION_KEY = "market-dashboard-session-v1";
const OPTIONS_CHAIN_SCROLL_KEY = "market-dashboard-chain-scroll-v1";
const LEGACY_WORKSPACE_LAYOUT_KEY = "market-dashboard-layout-v10";
const DASHBOARD_CONFIG_KEY = "market-dashboard-config-v1";
const DASHBOARD_ID = "market-dashboard";
const DEFAULT_WORKSPACE_EXPIRY = nextFridays(6)[0];
const ResponsiveGridLayout = Responsive;
const MARKET_WIDGET_IDS = [
  "portfolio",
  "spotChart",
  "optionsChart",
  "orderFlow",
  "strategy",
  "execution",
  "ladder",
];
const GRID_BREAKPOINTS = { lg: 1400, md: 1080, sm: 760, xs: 0 };
const GRID_COLS = { lg: 12, md: 10, sm: 6, xs: 1 };
const GRID_ROW_HEIGHT = 28;
const GRID_MARGIN_DEFAULT = [8, 8];
const GRID_MARGIN_COMPACT = [6, 6];
const GRID_CONTAINER_PADDING = [0, 0];
const MARKET_DATA_BROKER_PREFERENCE = ["etrade", "ibkr", "webull"];
const MARKET_WIDGET_META = {
  portfolio: {
    title: "Portfolio",
    description: "Account matrix, equity reference, and position summary.",
    group: "Portfolio",
  },
  spotChart: {
    title: "Spot Chart",
    description: "Underlying TradingView chart and market controls.",
    group: "Charts",
  },
  optionsChart: {
    title: "Options Chart",
    description: "Selected contract chart and source controls.",
    group: "Charts",
  },
  orderFlow: {
    title: "Order-Flow Hub",
    description: "Order flow distributions and flow history.",
    group: "Flow",
  },
  strategy: {
    title: "AI Fusion",
    description: "Advisory context loop and AI fusion controls.",
    group: "Strategy",
  },
  execution: {
    title: "Execution",
    description: "Order routing, preview, and ticket controls.",
    group: "Execution",
  },
  ladder: {
    title: "Options Ladder",
    description: "Contract ladder with rapid order actions.",
    group: "Execution",
  },
};

const T = {
  ...APP_THEME,
  card2: APP_THEME.cardAlt,
};

const INTERVALS = [
  { value: "1", label: "1m" },
  { value: "3", label: "3m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "D", label: "1D" },
];

export default function MarketDashboardTab({ isActive = true } = {}) {
  const sessionSeedRef = useRef(readWorkspaceSession());
  const sessionSeed = sessionSeedRef.current || {};
  const initialDashboardConfigRef = useRef(readInitialDashboardConfig());
  const initialDashboardConfig = initialDashboardConfigRef.current;
  const ticketSeed = sessionSeed.ticket && typeof sessionSeed.ticket === "object"
    ? sessionSeed.ticket
    : {};
  const chainScrollContainerRef = useRef(null);
  const restoredChainScrollRef = useRef(false);
  const dashboardSaveTimerRef = useRef(null);
  const fastMarketPollInFlightRef = useRef(false);
  const accountPollInFlightRef = useRef(false);
  const heavyPollInFlightRef = useRef(false);

  const [accounts, setAccounts] = useState([]);
  const [serverAccounts, setServerAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    const candidate = String(sessionSeed.selectedAccountId || "all").trim();
    return candidate || "all";
  });
  const selectedAccountIdRef = useRef(selectedAccountId);
  const [activeMode, setActiveMode] = useState(() => "live");

  const [symbolInput, setSymbolInput] = useState(() => (
    normalizeSymbol(String(sessionSeed.symbolInput || "SPY"))
  ));
  const [interval, setInterval] = useState(() => normalizeWorkspaceInterval(sessionSeed.interval));
  const [theme, setTheme] = useState(() => (sessionSeed.theme === "dark" ? "dark" : "light"));
  const [quote, setQuote] = useState(null);
  const [orderFlow, setOrderFlow] = useState(null);
  const [orderFlowHistory, setOrderFlowHistory] = useState([]);

  const [expiry, setExpiry] = useState(() => normalizeExpiry(sessionSeed.expiry, DEFAULT_WORKSPACE_EXPIRY));
  const [chainFocus, setChainFocus] = useState(() => normalizeChainFocus(sessionSeed.chainFocus));
  const [quickQty, setQuickQty] = useState(() => normalizePositiveInt(sessionSeed.quickQty, 1));
  const [optionChain, setOptionChain] = useState(null);
  const [selectedContractId, setSelectedContractId] = useState(() => (
    sessionSeed.selectedContractId == null ? null : String(sessionSeed.selectedContractId)
  ));
  const [preview, setPreview] = useState(null);
  const [rapidPreflight, setRapidPreflight] = useState(null);
  const [ticketPreview, setTicketPreview] = useState(null);
  const [ticketPreflight, setTicketPreflight] = useState(null);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [performance, setPerformance] = useState(null);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [aiFusionStatus, setAiFusionStatus] = useState(null);
  const [aiFusionBusy, setAiFusionBusy] = useState(false);
  const [aiFusionConfigBusy, setAiFusionConfigBusy] = useState(false);

  const [ticket, setTicket] = useState({
    accountId: String(ticketSeed.accountId || ""),
    symbol: String(ticketSeed.symbol || "SPY"),
    assetType: normalizeTicketAssetType(ticketSeed.assetType),
    side: normalizeTicketSide(ticketSeed.side),
    quantity: normalizePositiveInt(ticketSeed.quantity, 1),
    orderType: normalizeOrderType(ticketSeed.orderType),
    limitPrice: ticketSeed.limitPrice == null ? "" : String(ticketSeed.limitPrice),
    expiry: normalizeExpiry(ticketSeed.expiry, DEFAULT_WORKSPACE_EXPIRY),
    strike: normalizeFiniteNumber(ticketSeed.strike, 600),
    right: normalizeTicketRight(ticketSeed.right),
    executionMode: normalizeExecutionMode(ticketSeed.executionMode, "live"),
    timeInForce: normalizeTimeInForce(ticketSeed.timeInForce),
  });

  const [rapidBusy, setRapidBusy] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshingData, setRefreshingData] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [showWorkspacePositions, setShowWorkspacePositions] = useState(false);
  const [widgetLayouts, setWidgetLayouts] = useState(() => initialDashboardConfig.layouts);
  const [enabledWidgetIds, setEnabledWidgetIds] = useState(() => initialDashboardConfig.enabledWidgetIds);
  const [hiddenWidgetIds, setHiddenWidgetIds] = useState(() => initialDashboardConfig.hiddenWidgetIds);
  const [editMode, setEditMode] = useState(false);
  const [widgetLibraryOpen, setWidgetLibraryOpen] = useState(false);
  const [widgetSearch, setWidgetSearch] = useState("");
  const [dashboardReady, setDashboardReady] = useState(false);
  const [layoutSyncState, setLayoutSyncState] = useState("local");
  const [layoutInteractionState, setLayoutInteractionState] = useState("idle");
  const [activeInteractionWidgetId, setActiveInteractionWidgetId] = useState(null);
  const [localDashboardConfig, setLocalDashboardConfig] = useState(() => initialDashboardConfig);
  const [serverDashboardConfig, setServerDashboardConfig] = useState(null);
  const [qaMode, setQaMode] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search || "");
        const qaParam = String(params.get("qa") || "").trim();
        if (qaParam === "1" || qaParam.toLowerCase() === "true") {
          return true;
        }
      } catch {
        // Ignore malformed URL params.
      }
    }
    return Boolean(sessionSeed.qaMode);
  });
  const [activeBreakpoint, setActiveBreakpoint] = useState("lg");
  const [optionChartSymbolInput, setOptionChartSymbolInput] = useState(() => String(sessionSeed.optionChartSymbol || ""));
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 1440 : window.innerWidth
  ));
  const compactTop = viewportWidth < 1600;
  const mobileTop = viewportWidth < 760;
  const gridMargin = mobileTop ? GRID_MARGIN_COMPACT : GRID_MARGIN_DEFAULT;
  const estimatedGridWidth = Math.max(
    320,
    Math.min(1600, Math.round(viewportWidth - (mobileTop ? 12 : 16))),
  );

  useEffect(() => {
    selectedAccountIdRef.current = selectedAccountId;
  }, [selectedAccountId]);

  const normalizedSymbol = useMemo(() => normalizeSymbol(symbolInput), [symbolInput]);
  const marketSymbol = useMemo(() => normalizedSymbol.split(":").pop() || "SPY", [normalizedSymbol]);

  const serverAccountsById = useMemo(
    () => Object.fromEntries(serverAccounts.map((account) => [account.accountId, account])),
    [serverAccounts],
  );
  const aiFusionConfig = aiFusionStatus?.config || {};
  const aiFusionRuntime = aiFusionStatus?.runtime || {};
  const aiFusionContext = aiFusionStatus?.context || null;
  const aiFusionStale = Boolean(aiFusionStatus?.contextStale);
  const aiFusionStatusText = aiFusionConfig.enabled
    ? String(aiFusionRuntime.status || "idle")
    : "disabled";
  const aiFusionStatusColor =
    aiFusionStatusText === "ok"
      ? T.green
      : aiFusionStatusText === "error"
        ? T.red
        : aiFusionStatusText === "running"
          ? T.blue
          : T.muted;
  const aiFusionIntervalSec = Number(aiFusionConfig.intervalSec);
  const aiFusionIntervalSelectValue = [30, 45, 60, 90, 120].includes(aiFusionIntervalSec)
    ? String(aiFusionIntervalSec)
    : "60";

  const chartAccountId = useMemo(() => {
    if (selectedAccountId !== "all") {
      const selectedRemote = serverAccountsById[selectedAccountId];
      if (isMarketDataReadyAccount(selectedRemote)) {
        return selectedAccountId;
      }
    }
    return (
      pickPreferredAccountId(serverAccounts, { preferBrokers: MARKET_DATA_BROKER_PREFERENCE, requiredCapability: "marketData" })
      || pickPreferredAccountId(serverAccounts, { preferBrokers: MARKET_DATA_BROKER_PREFERENCE, requireConnected: false })
      || pickPreferredAccountId(accounts, { preferBrokers: MARKET_DATA_BROKER_PREFERENCE, requireConnected: false })
      || serverAccounts[0]?.accountId
      || accounts[0]?.accountId
      || undefined
    );
  }, [accounts, selectedAccountId, serverAccounts, serverAccountsById]);

  const visiblePositions = useMemo(() => {
    if (selectedAccountId === "all") {
      return positions;
    }
    return positions.filter((position) => position.accountId === selectedAccountId);
  }, [positions, selectedAccountId]);

  const totalUnrealized = useMemo(
    () => visiblePositions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0),
    [visiblePositions],
  );

  const totalMarketValue = useMemo(
    () => visiblePositions.reduce((sum, position) => sum + Number(position.marketValue || 0), 0),
    [visiblePositions],
  );

  const totalCash = useMemo(() => {
    if (selectedAccountId === "all") {
      return serverAccounts.reduce(
        (sum, account) => sum + Number(account?.summary?.cash ?? account?.summary?.buyingPower ?? 0),
        0,
      );
    }
    return Number(serverAccountsById[selectedAccountId]?.summary?.cash ?? serverAccountsById[selectedAccountId]?.summary?.buyingPower ?? 0);
  }, [selectedAccountId, serverAccounts, serverAccountsById]);
  const totalCashAll = useMemo(
    () => serverAccounts.reduce(
      (sum, account) => sum + Number(account?.summary?.cash ?? account?.summary?.buyingPower ?? 0),
      0,
    ),
    [serverAccounts],
  );
  const totalEquityAll = useMemo(
    () => serverAccounts.reduce((sum, account) => {
      const equity = Number(account?.summary?.equity);
      return Number.isFinite(equity) ? sum + equity : sum;
    }, 0),
    [serverAccounts],
  );
  const accountSnapshots = useMemo(() => {
    const positionsByAccount = new Map();
    for (const row of positions) {
      const accountId = String(row?.accountId || "").trim();
      if (!accountId) {
        continue;
      }
      positionsByAccount.set(accountId, (positionsByAccount.get(accountId) || 0) + 1);
    }

    const rows = accounts.map((account) => {
      const remote = serverAccountsById[account.accountId] || {};
      const summary = remote.summary || {};
      return {
        accountId: account.accountId,
        label: account.label,
        broker: account.broker,
        authState: String(remote.authState || "unknown").toLowerCase(),
        equity: Number(summary.equity),
        cash: Number(summary.cash ?? summary.buyingPower),
        positions: Number(positionsByAccount.get(account.accountId) || 0),
      };
    });

    return [
      {
        accountId: "all",
        label: "All Accounts",
        broker: "combined",
        authState: rows.every((row) => row.authState === "authenticated")
          ? "authenticated"
          : (rows.some((row) => row.authState === "authenticated") ? "mixed" : "degraded"),
        equity: totalEquityAll,
        cash: totalCashAll,
        positions: Number(positions.length || 0),
      },
      ...rows,
    ];
  }, [accounts, positions, serverAccountsById, totalCashAll, totalEquityAll]);
  const accountMatrixColumns = useMemo(() => {
    const positionsByAccount = new Map();
    const byAccount = new Map();
    let marketValueAll = 0;
    let unrealizedAll = 0;

    for (const position of positions) {
      const accountId = String(position?.accountId || "").trim();
      const marketValue = Number(position?.marketValue || 0);
      const unrealizedPnl = Number(position?.unrealizedPnl || 0);
      marketValueAll += marketValue;
      unrealizedAll += unrealizedPnl;
      if (!accountId) {
        continue;
      }
      const scopedPositions = positionsByAccount.get(accountId) || [];
      scopedPositions.push(position);
      positionsByAccount.set(accountId, scopedPositions);
      const previous = byAccount.get(accountId) || { marketValue: 0, unrealizedPnl: 0 };
      byAccount.set(accountId, {
        marketValue: previous.marketValue + marketValue,
        unrealizedPnl: previous.unrealizedPnl + unrealizedPnl,
      });
    }

    return accountSnapshots.map((snapshot) => {
      if (snapshot.accountId === "all") {
        return {
          ...snapshot,
          marketValue: marketValueAll,
          unrealizedPnl: unrealizedAll,
          positionLabels: buildPortfolioPositionPreviewList(positions),
          positionCount: positions.length,
        };
      }
      const row = byAccount.get(snapshot.accountId) || { marketValue: 0, unrealizedPnl: 0 };
      const scopedPositions = positionsByAccount.get(snapshot.accountId) || [];
      return {
        ...snapshot,
        marketValue: row.marketValue,
        unrealizedPnl: row.unrealizedPnl,
        positionLabels: buildPortfolioPositionPreviewList(scopedPositions),
        positionCount: scopedPositions.length,
      };
    });
  }, [accountSnapshots, positions]);
  const selectedAccountLabel = useMemo(
    () => accountSnapshots.find((snapshot) => snapshot.accountId === selectedAccountId)?.label || "All Accounts",
    [accountSnapshots, selectedAccountId],
  );
  const selectedPortfolioAccount = useMemo(
    () => accountMatrixColumns.find((snapshot) => snapshot.accountId === selectedAccountId) || accountMatrixColumns[0] || null,
    [accountMatrixColumns, selectedAccountId],
  );

  const availableExpiries = useMemo(() => {
    const seeded = [...nextFridays(8), expiry].filter(Boolean);
    return [...new Set(seeded)].sort();
  }, [expiry]);

  const optionRows = useMemo(
    () => (Array.isArray(optionChain?.rows) ? optionChain.rows : []),
    [optionChain],
  );
  const optionGrid = useMemo(
    () => buildOptionChainGrid(optionRows, optionChain?.underlyingPrice),
    [optionChain?.underlyingPrice, optionRows],
  );
  const selectedOptionRow = useMemo(() => {
    if (!selectedContractId) {
      return null;
    }
    return optionRows.find((row) => String(row?.contractId) === String(selectedContractId)) || null;
  }, [optionRows, selectedContractId]);
  const optionChartSymbol = useMemo(
    () => deriveOptionChartSymbol(selectedOptionRow, marketSymbol),
    [marketSymbol, selectedOptionRow],
  );
  const normalizedOptionChartOverride = useMemo(
    () => normalizeOptionChartSymbolCandidate(optionChartSymbolInput),
    [optionChartSymbolInput],
  );
  const fallbackOptionChartSymbol = useMemo(
    () => normalizeSymbol(marketSymbol || normalizedSymbol),
    [marketSymbol, normalizedSymbol],
  );
  const optionChartUsesFallback = !normalizedOptionChartOverride && !optionChartSymbol;
  const effectiveOptionChartSymbol = normalizedOptionChartOverride || optionChartSymbol || fallbackOptionChartSymbol;
  const optionChartSymbolSource = normalizedOptionChartOverride
    ? "manual override"
    : optionChartSymbol
      ? "derived from selected contract"
      : "underlying fallback";
  const optionChartContractLabel = useMemo(
    () => (selectedOptionRow ? formatOptionContract(selectedOptionRow) : "Select a call or put from the ladder"),
    [selectedOptionRow],
  );
  const chainDensity = activeBreakpoint === "xs"
    ? "xs"
    : activeBreakpoint === "sm"
      ? "sm"
      : activeBreakpoint === "md"
        ? "md"
        : "lg";
  const chainColumns = useMemo(
    () => getOptionChainColumnConfig(chainFocus, chainDensity),
    [chainDensity, chainFocus],
  );
  const chainTableColCount = chainColumns.call.length + 1 + chainColumns.put.length;
  const chainVisibleRowLimit = chainDensity === "xs"
    ? 7
    : chainDensity === "sm"
      ? 10
      : chainDensity === "md"
        ? 14
        : 18;
  const visibleChainRows = optionGrid.rows.slice(0, chainVisibleRowLimit);
  const chainRowsTrimmed = optionGrid.rows.length > chainVisibleRowLimit;
  const optionsVolumeDistribution = useMemo(
    () => buildOptionsVolumeDistribution(optionRows),
    [optionRows],
  );
  const recentOrders = useMemo(() => (
    Array.isArray(orders) ? orders.slice(0, 10) : []
  ), [orders]);
  const openOrderCount = useMemo(
    () => (Array.isArray(orders)
      ? orders.filter((row) => String(row?.lifecycleState || "").toLowerCase() === "open").length
      : 0),
    [orders],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const resolvedExecutionAccountId = useMemo(() => {
    if (selectedAccountId !== "all") {
      return selectedAccountId;
    }
    return (
      pickPreferredAccountId(serverAccounts, { preferBroker: "webull", requiredCapability: "trading" })
      || pickPreferredAccountId(serverAccounts, { preferBroker: "webull", requireConnected: false })
      || pickPreferredAccountId(accounts, { preferBroker: "webull", requireConnected: false })
      || serverAccounts[0]?.accountId
      || accounts[0]?.accountId
      || undefined
    );
  }, [accounts, selectedAccountId, serverAccounts]);

  const handleChartSymbolChange = useCallback((nextSymbolValue) => {
    const nextNormalized = normalizeSymbol(nextSymbolValue);
    if (!nextNormalized) {
      return;
    }
    setSymbolInput((previous) => {
      const previousNormalized = normalizeSymbol(previous);
      return previousNormalized === nextNormalized ? previous : nextNormalized;
    });
    setSelectedContractId(null);

    const nextMarketSymbol = String(nextNormalized.split(":").pop() || nextNormalized).toUpperCase();
    setTicket((previous) => {
      const previousTicketSymbol = String(previous.symbol || "").toUpperCase();
      const currentMarketSymbol = String(marketSymbol || "").toUpperCase();
      if (previousTicketSymbol !== currentMarketSymbol && previousTicketSymbol !== "") {
        return previous;
      }
      return {
        ...previous,
        symbol: nextMarketSymbol,
      };
    });
    setOptionChartSymbolInput("");
  }, [marketSymbol]);

  const handleChartIntervalChange = useCallback((nextIntervalValue) => {
    const nextInterval = normalizeWorkspaceInterval(nextIntervalValue);
    setInterval((previous) => (previous === nextInterval ? previous : nextInterval));
  }, []);

  const refreshAccountsAndPositions = useCallback(async () => {
    const [remoteAccounts, remotePositionsResponse] = await Promise.all([
      getAccounts(),
      getPositions("all"),
    ]);
    const remotePositions = Array.isArray(remotePositionsResponse?.positions)
      ? remotePositionsResponse.positions
      : [];
    setServerAccounts(remoteAccounts);
    setPositions(remotePositions);
  }, []);

  const refreshOrders = useCallback(async ({ silent = false, accountId } = {}) => {
    const resolvedAccountId = accountId ?? selectedAccountIdRef.current;
    if (!silent) {
      setLoadingOrders(true);
    }
    try {
      const rows = await getOrders({
        accountId: resolvedAccountId === "all" ? null : resolvedAccountId,
        limit: 80,
      });
      setOrders(Array.isArray(rows) ? rows : []);
      return rows;
    } finally {
      if (!silent) {
        setLoadingOrders(false);
      }
    }
  }, []);

  const refreshAiFusionStatus = useCallback(async ({ silent = false } = {}) => {
    try {
      const status = await getAiFusionStatus();
      setAiFusionStatus(status || null);
      return status;
    } catch (fusionError) {
      if (!silent) {
        throw fusionError;
      }
      return null;
    }
  }, []);

  const patchAiFusionConfig = useCallback(async (patch, options = {}) => {
    const noticeText = String(options.noticeText || "").trim();
    setAiFusionConfigBusy(true);
    setError(null);
    try {
      await updateAiFusionConfig(patch);
      await refreshAiFusionStatus({ silent: true });
      if (noticeText) {
        setNotice(noticeText);
      }
    } catch (configError) {
      setError(configError.message);
    } finally {
      setAiFusionConfigBusy(false);
    }
  }, [refreshAiFusionStatus]);

  const triggerAiFusionContextRun = useCallback(async () => {
    setAiFusionBusy(true);
    setError(null);
    try {
      const result = await runAiFusionNow({
        force: true,
        reason: "workspace-manual",
      });
      await refreshAiFusionStatus({ silent: true });
      if (result?.ok) {
        setNotice("AI fusion context updated.");
      } else {
        setNotice(`AI fusion run skipped: ${result?.skipped || "unknown"}.`);
      }
    } catch (runError) {
      setError(runError.message);
    } finally {
      setAiFusionBusy(false);
    }
  }, [refreshAiFusionStatus]);

  const loadPerformance = useCallback(async ({ refresh = false, silent = false, accountId } = {}) => {
    const resolvedAccountId = accountId ?? selectedAccountIdRef.current;
    if (!silent) {
      setLoadingPerformance(true);
    }
    try {
      const response = refresh
        ? await refreshAccountPerformance({
          accountId: resolvedAccountId,
          days: 3650,
          limit: 12000,
          includeBenchmark: false,
          benchmarkSymbol: "SPY",
        })
        : await getAccountPerformance({
          accountId: resolvedAccountId,
          limit: 12000,
          includeBenchmark: false,
          benchmarkSymbol: "SPY",
        });
      setPerformance(response || null);
      return response;
    } finally {
      if (!silent) {
        setLoadingPerformance(false);
      }
    }
  }, []);

  const refreshMarket = useCallback(async () => {
    const marketAccountId = chartAccountId;
    const [nextQuote, nextOptionChain, nextOrderFlow] = await Promise.all([
      getSpotQuote({
        accountId: marketAccountId,
        symbol: marketSymbol,
      }),
      getOptionChain({
        accountId: marketAccountId,
        symbol: marketSymbol,
        expiry,
      }),
      getMarketOrderFlow({
        accountId: marketAccountId,
        symbol: marketSymbol,
        resolution: interval,
        countBack: 40,
      }),
    ]);

    setQuote(nextQuote);
    setOptionChain(nextOptionChain);
    setOrderFlow(nextOrderFlow);
    setOrderFlowHistory((prev) => appendOrderFlowSample(prev, nextOrderFlow));
  }, [chartAccountId, expiry, interval, marketSymbol]);

  useEffect(() => {
    if (!optionRows.length) {
      setSelectedContractId(null);
      return;
    }
    const found = optionRows.find((row) => String(row?.contractId) === String(selectedContractId));
    if (found) {
      return;
    }
    const fallback = pickAtmOptionRow(optionRows, optionChain?.underlyingPrice);
    setSelectedContractId(String(fallback?.contractId || optionRows[0].contractId));
  }, [optionChain?.underlyingPrice, optionRows, selectedContractId]);

  useEffect(() => {
    setPreview(null);
    setRapidPreflight(null);
  }, [selectedContractId]);

  const refreshAll = useCallback(async () => {
    setRefreshingData(true);
    setError(null);
    try {
      await refreshAccountsAndPositions();
      await refreshMarket();
      await loadPerformance({ silent: true });
      await refreshOrders({ silent: true });
      await refreshAiFusionStatus({ silent: true });
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setRefreshingData(false);
    }
  }, [
    loadPerformance,
    qaMode,
    refreshAccountsAndPositions,
    refreshAiFusionStatus,
    refreshMarket,
    refreshOrders,
  ]);

  useEffect(() => {
    setStorageValue(WORKSPACE_SESSION_KEY, JSON.stringify({
      selectedAccountId,
      activeMode,
      symbolInput: normalizedSymbol,
      interval,
      theme,
      expiry,
      chainFocus,
      quickQty,
      selectedContractId,
      qaMode,
      optionChartSymbol: optionChartSymbolInput,
      ticket: {
        accountId: ticket.accountId,
        symbol: ticket.symbol,
        assetType: ticket.assetType,
        side: ticket.side,
        quantity: normalizePositiveInt(ticket.quantity, 1),
        orderType: ticket.orderType,
        limitPrice: ticket.limitPrice,
        expiry: ticket.expiry,
        strike: normalizeFiniteNumber(ticket.strike, 600),
        right: ticket.right,
        executionMode: ticket.executionMode,
        timeInForce: ticket.timeInForce,
      },
      savedAt: new Date().toISOString(),
    }));
  }, [
    activeMode,
    chainFocus,
    expiry,
    interval,
    normalizedSymbol,
    quickQty,
    selectedAccountId,
    selectedContractId,
    qaMode,
    optionChartSymbolInput,
    theme,
    ticket.accountId,
    ticket.assetType,
    ticket.executionMode,
    ticket.expiry,
    ticket.limitPrice,
    ticket.orderType,
    ticket.quantity,
    ticket.right,
    ticket.side,
    ticket.strike,
    ticket.symbol,
    ticket.timeInForce,
  ]);

  useEffect(() => {
    let cancelled = false;

    const hydrateDashboardLayout = async () => {
      try {
        const remote = await getDashboardLayout({ dashboardId: DASHBOARD_ID });
        if (cancelled) {
          return;
        }
        const normalizedRemote = remote ? buildDashboardConfigRecord(remote) : null;
        setServerDashboardConfig(normalizedRemote);
        const preferred = choosePreferredDashboardConfig(
          initialDashboardConfigRef.current,
          normalizedRemote,
        );
        if (preferred) {
          setWidgetLayouts(preferred.layouts);
          setEnabledWidgetIds(preferred.enabledWidgetIds);
          setHiddenWidgetIds(preferred.hiddenWidgetIds);
          setLocalDashboardConfig(preferred);
          writeDashboardConfig(preferred);
        }
        setLayoutSyncState(normalizedRemote ? "synced" : "local");
      } catch {
        if (!cancelled) {
          setLayoutSyncState("degraded");
        }
      } finally {
        if (!cancelled) {
          setDashboardReady(true);
        }
      }
    };

    hydrateDashboardLayout();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dashboardReady) {
      return undefined;
    }
    const nextConfig = buildDashboardConfigRecord({
      dashboardId: DASHBOARD_ID,
      version: 1,
      layouts: widgetLayouts,
      enabledWidgetIds,
      hiddenWidgetIds,
      updatedAt: new Date().toISOString(),
    });
    setLocalDashboardConfig(nextConfig);
    writeDashboardConfig(nextConfig);
    setLayoutSyncState((prev) => (prev === "degraded" ? prev : "local"));

    if (dashboardSaveTimerRef.current) {
      clearTimeout(dashboardSaveTimerRef.current);
    }
    dashboardSaveTimerRef.current = setTimeout(async () => {
      try {
        setLayoutSyncState("syncing");
        const saved = await saveDashboardLayout({
          dashboardId: DASHBOARD_ID,
          layout: nextConfig,
        });
        const normalizedSaved = saved ? buildDashboardConfigRecord(saved) : null;
        if (normalizedSaved) {
          setServerDashboardConfig(normalizedSaved);
        }
        setLayoutSyncState("synced");
      } catch {
        setLayoutSyncState("degraded");
      }
    }, 450);

    return () => {
      if (dashboardSaveTimerRef.current) {
        clearTimeout(dashboardSaveTimerRef.current);
      }
    };
  }, [dashboardReady, enabledWidgetIds, hiddenWidgetIds, widgetLayouts]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      setLoading(true);
      setError(null);
      try {
        const migratedAccounts = (await loadOrMigrateBrokerAccounts()).filter(
          (account) => !isCredentialOnlyBroker(account?.broker),
        );
        if (!mounted) {
          return;
        }

        setAccounts(migratedAccounts);
        const restoredAccountId = String(sessionSeedRef.current?.selectedAccountId || "").trim();
        const hasRestoredAccount = restoredAccountId
          && (restoredAccountId === "all"
            || migratedAccounts.some((row) => row.accountId === restoredAccountId));
        const defaultAccountId = hasRestoredAccount
          ? restoredAccountId
          : (
            pickPreferredAccountId(migratedAccounts, { preferBroker: "webull", requireConnected: true })
            || pickPreferredAccountId(migratedAccounts, { preferBroker: "webull", requireConnected: false })
            || migratedAccounts[0]?.accountId
            || "all"
          );
        setSelectedAccountId(defaultAccountId);
        const defaultAccount = migratedAccounts.find((row) => row.accountId === defaultAccountId) || migratedAccounts[0];
        setActiveMode(defaultAccount?.mode || "live");
        setTicket((prev) => ({
          ...prev,
          accountId: defaultAccount?.accountId || "",
          executionMode: defaultAccount?.mode || "live",
        }));

        await refreshAccountsAndPositions();
        await loadPerformance({ refresh: true, silent: true, accountId: defaultAccountId });
        await refreshOrders({ silent: true, accountId: defaultAccountId });
        await refreshAiFusionStatus({ silent: true });
      } catch (bootError) {
        if (mounted) {
          setError(bootError.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    boot();

    return () => {
      mounted = false;
    };
  }, [loadPerformance, refreshAccountsAndPositions, refreshAiFusionStatus, refreshOrders]);

  useEffect(() => {
    if (selectedAccountId === "all") {
      setActiveMode("live");
      return;
    }

    const account = accounts.find((item) => item.accountId === selectedAccountId);
    setActiveMode(account?.mode || "live");
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    const resolvedAccountId =
      selectedAccountId === "all"
        ? (resolvedExecutionAccountId || "")
        : selectedAccountId;
    setTicket((prev) => ({
      ...prev,
      accountId: resolvedAccountId || prev.accountId,
      executionMode: activeMode,
    }));
  }, [activeMode, resolvedExecutionAccountId, selectedAccountId]);

  useEffect(() => {
    if (!loading) {
      refreshMarket().catch((refreshError) => setError(refreshError.message));
    }
  }, [loading, refreshMarket]);

  useEffect(() => {
    if (loading) {
      return;
    }
    loadPerformance({ silent: true }).catch(() => {});
  }, [loadPerformance, loading, selectedAccountId]);

  useEffect(() => {
    if (loading) {
      return;
    }
    refreshOrders({ silent: true }).catch(() => {});
  }, [loading, refreshOrders, selectedAccountId]);

  useEffect(() => {
    if (loading || restoredChainScrollRef.current) {
      return;
    }
    const target = chainScrollContainerRef.current;
    if (!target) {
      return;
    }
    const saved = readWorkspaceChainScroll();
    if (saved) {
      const x = Number(saved.x);
      const y = Number(saved.y);
      target.scrollLeft = Number.isFinite(x) ? x : 0;
      target.scrollTop = Number.isFinite(y) ? y : 0;
    }
    restoredChainScrollRef.current = true;
  }, [loading]);

  useEffect(() => {
    if (qaMode || !isActive) {
      return undefined;
    }

    upsertRuntimeActivity("poller.market-dashboard.fast-market", {
      kind: "poller",
      label: "Market fast refresh",
      surface: "workspace",
      intervalMs: 5000,
    });
    upsertRuntimeActivity("poller.market-dashboard.accounts", {
      kind: "poller",
      label: "Market accounts refresh",
      surface: "workspace",
      intervalMs: 15000,
    });
    upsertRuntimeActivity("poller.market-dashboard.heavy", {
      kind: "poller",
      label: "Market heavy refresh",
      surface: "workspace",
      intervalMs: 30000,
    });

    const fastMarketTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (fastMarketPollInFlightRef.current) {
        return;
      }
      fastMarketPollInFlightRef.current = true;
      refreshMarket()
        .catch(() => {
          // Fast market refresh is best-effort.
        })
        .finally(() => {
          fastMarketPollInFlightRef.current = false;
        });
    }, 5000);

    const accountTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (accountPollInFlightRef.current) {
        return;
      }
      accountPollInFlightRef.current = true;
      Promise.allSettled([
        refreshAccountsAndPositions(),
        refreshOrders({ silent: true }),
      ])
        .catch(() => {
          // Account refresh is best-effort.
        })
        .finally(() => {
          accountPollInFlightRef.current = false;
        });
    }, 15000);

    const heavyTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (heavyPollInFlightRef.current) {
        return;
      }
      heavyPollInFlightRef.current = true;
      Promise.allSettled([
        loadPerformance({ silent: true }),
        refreshAiFusionStatus({ silent: true }),
      ])
        .catch(() => {
          // Heavy refresh cadence is best-effort.
        })
        .finally(() => {
          heavyPollInFlightRef.current = false;
        });
    }, 30000);

    return () => {
      clearInterval(fastMarketTimer);
      clearInterval(accountTimer);
      clearInterval(heavyTimer);
      clearRuntimeActivity("poller.market-dashboard.fast-market");
      clearRuntimeActivity("poller.market-dashboard.accounts");
      clearRuntimeActivity("poller.market-dashboard.heavy");
    };
  }, [
    isActive,
    loadPerformance,
    refreshAccountsAndPositions,
    refreshAiFusionStatus,
    refreshMarket,
    qaMode,
    refreshOrders,
  ]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timeout = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const runRapidAction = async ({ row, side, orderType, limitPrice, previewOnly }) => {
    const marketAccountId = resolvedExecutionAccountId;
    if (!marketAccountId) {
      setError("Select an account before sending rapid ladder actions.");
      return;
    }

    const actionKey = `${row.contractId}:${side}:${orderType}:${previewOnly ? "preview" : "submit"}`;
    setRapidBusy(actionKey);
    setError(null);

    try {
      const response = await rapidOptionOrder({
        accountId: marketAccountId,
        contractId: row.contractId,
        side,
        quantity: quickQty,
        orderType,
        limitPrice,
        executionMode: activeMode,
        previewOnly,
      });
      setRapidPreflight(response.preflight || null);

      if (previewOnly) {
        setPreview(response.preview || null);
        setNotice(`Preview updated for ${row.contractId}.`);
      } else {
        setNotice(`Rapid ${side} filled: ${response.order.orderId}`);
        setPreview(null);
        setRapidPreflight(response.preflight || null);
        await refreshAll();
      }
    } catch (rapidError) {
      setRapidPreflight(rapidError?.payload?.preflight || null);
      setError(rapidError.message);
    } finally {
      setRapidBusy(null);
    }
  };

  const onTicketChange = (key, value) => {
    setTicket((prev) => ({
      ...prev,
      [key]: value,
    }));
    setTicketPreview(null);
    setTicketPreflight(null);
  };

  const buildTicketPayload = () => {
    const payload = {
      accountId: ticket.accountId,
      symbol: ticket.symbol,
      assetType: ticket.assetType,
      side: ticket.side,
      quantity: Number(ticket.quantity),
      orderType: ticket.orderType,
      limitPrice:
        ticket.orderType === "limit" && ticket.limitPrice !== ""
          ? Number(ticket.limitPrice)
          : null,
      executionMode: ticket.executionMode,
      timeInForce: ticket.timeInForce,
    };

    if (ticket.assetType === "option") {
      payload.expiry = ticket.expiry;
      payload.strike = Number(ticket.strike);
      payload.right = ticket.right;
      payload.contractId = buildOptionContractId(payload.symbol, payload.expiry, payload.strike, payload.right);
    }

    return payload;
  };

  const runTicketPreview = async () => {
    setError(null);
    try {
      const response = await previewOrder(buildTicketPayload());
      setTicketPreview(response.preview || null);
      setTicketPreflight(response.preflight || null);
    } catch (previewError) {
      setError(previewError.message);
    }
  };

  const submitTicketOrder = async () => {
    setSubmittingTicket(true);
    setError(null);
    try {
      const payload = buildTicketPayload();
      const preflight = await preflightOrder(payload);
      setTicketPreflight(preflight?.preflight || null);
      if (preflight?.preflight?.blocking) {
        throw new Error("Order blocked by preflight checks.");
      }

      const order = await submitOrder(payload);
      setNotice(`Order ${order.orderId} filled.`);
      setTicketPreview(null);
      await refreshAll();
    } catch (submitError) {
      setTicketPreflight(submitError?.payload?.preflight || null);
      setError(submitError.message);
    } finally {
      setSubmittingTicket(false);
    }
  };

  const closePositionFromWorkspace = async (position) => {
    const confirmed = window.confirm(
      `Close ${position.qty} of ${position.symbol} on ${position.accountId}?`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await closePosition(position.positionId, {
        accountId: position.accountId,
        quantity: position.qty,
        executionMode: ticket.executionMode,
      });
      await refreshAll();
      setNotice(`Closed ${position.symbol} on ${position.accountId}.`);
    } catch (closeError) {
      setError(closeError.message);
    }
  };

  const handleChainTableScroll = useCallback((event) => {
    const target = event?.currentTarget;
    if (!target) {
      return;
    }
    setStorageValue(OPTIONS_CHAIN_SCROLL_KEY, JSON.stringify({
      x: Math.round(target.scrollLeft || 0),
      y: Math.round(target.scrollTop || 0),
      savedAt: new Date().toISOString(),
    }));
  }, []);

  const defaultWidgetLayouts = useMemo(() => buildDefaultWorkspaceLayouts(), []);
  const mergedWidgetLayouts = useMemo(
    () => normalizeDashboardWidgetLayouts(
      filterLayoutsByWidgetIds(
        mergeWorkspaceLayouts(widgetLayouts, defaultWidgetLayouts),
        enabledWidgetIds,
      ),
      defaultWidgetLayouts,
    ),
    [defaultWidgetLayouts, enabledWidgetIds, widgetLayouts],
  );
  const activeBreakpointRows = useMemo(() => {
    const currentRows = mergedWidgetLayouts?.[activeBreakpoint];
    if (Array.isArray(currentRows) && currentRows.length > 0) {
      return currentRows;
    }
    const lgRows = mergedWidgetLayouts?.lg;
    return Array.isArray(lgRows) ? lgRows : [];
  }, [activeBreakpoint, mergedWidgetLayouts]);
  const activeBreakpointCols = GRID_COLS[activeBreakpoint] || GRID_COLS.lg;

  const handleWidgetLayoutChange = useCallback((_currentLayout, allLayouts) => {
    setWidgetLayouts(sanitizeLayoutsForNoOverlap(allLayouts, GRID_COLS));
  }, []);

  const nudgeWidget = useCallback((widgetId, deltaX, deltaY) => {
    if (!editMode) {
      return;
    }
    setWidgetLayouts((prev) => nudgeWidgetLayouts(prev, {
      widgetId,
      breakpoint: activeBreakpoint,
      colsByBreakpoint: GRID_COLS,
      deltaX,
      deltaY,
    }));
  }, [activeBreakpoint, editMode]);

  const handleWidgetHandleKeyDown = useCallback((event, widgetId) => {
    if (!editMode) {
      return;
    }
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") {
      deltaX = -1;
    } else if (event.key === "ArrowRight") {
      deltaX = 1;
    } else if (event.key === "ArrowUp") {
      deltaY = -1;
    } else if (event.key === "ArrowDown") {
      deltaY = 1;
    }
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    nudgeWidget(widgetId, deltaX, deltaY);
  }, [editMode, nudgeWidget]);

  const stopWidgetBodyDragStart = useCallback((event) => {
    if (!editMode) {
      return;
    }
    event.stopPropagation();
  }, [editMode]);

  const resetWorkspaceLayout = useCallback(() => {
    setEnabledWidgetIds([...MARKET_WIDGET_IDS]);
    setHiddenWidgetIds([]);
    setWidgetLayouts(defaultWidgetLayouts);
    setNotice("Market Dashboard layout reset to default.");
  }, [defaultWidgetLayouts]);

  const applyDashboardConfig = useCallback((config, sourceLabel = "layout") => {
    if (!config || typeof config !== "object") {
      return;
    }
    const normalized = buildDashboardConfigRecord(config);
    setWidgetLayouts(normalized.layouts);
    setEnabledWidgetIds(normalized.enabledWidgetIds);
    setHiddenWidgetIds(normalized.hiddenWidgetIds);
    setLocalDashboardConfig(normalized);
    writeDashboardConfig(normalized);
    setNotice(`Applied ${sourceLabel}.`);
  }, []);

  const addWidgetToDashboard = useCallback((widgetId) => {
    const normalizedId = String(widgetId || "").trim();
    if (!normalizedId || enabledWidgetIds.includes(normalizedId)) {
      return;
    }
    setEnabledWidgetIds((prev) => [...prev, normalizedId]);
    setHiddenWidgetIds((prev) => prev.filter((row) => row !== normalizedId));
    setWidgetLayouts((prev) => addWidgetToLayouts(prev, defaultWidgetLayouts, normalizedId));
    setNotice(`${MARKET_WIDGET_META[normalizedId]?.title || normalizedId} added.`);
  }, [defaultWidgetLayouts, enabledWidgetIds]);

  const removeWidgetFromDashboard = useCallback((widgetId) => {
    const normalizedId = String(widgetId || "").trim();
    if (!normalizedId) {
      return;
    }
    setEnabledWidgetIds((prev) => prev.filter((row) => row !== normalizedId));
    setHiddenWidgetIds((prev) => uniqueStrings([...prev, normalizedId]));
    setWidgetLayouts((prev) => removeWidgetFromLayouts(prev, normalizedId));
    setNotice(`${MARKET_WIDGET_META[normalizedId]?.title || normalizedId} removed.`);
  }, []);

  const visibleWidgetIds = useMemo(
    () => uniqueStrings(enabledWidgetIds).filter((widgetId) => MARKET_WIDGET_META[widgetId]),
    [enabledWidgetIds],
  );

  const filteredWidgetLibrary = useMemo(() => {
    const query = String(widgetSearch || "").trim().toLowerCase();
    const rows = MARKET_WIDGET_IDS.map((widgetId) => ({
      widgetId,
      ...MARKET_WIDGET_META[widgetId],
      enabled: visibleWidgetIds.includes(widgetId),
    }));
    if (!query) {
      return rows;
    }
    return rows.filter((row) => (
      row.title.toLowerCase().includes(query)
      || row.group.toLowerCase().includes(query)
      || row.description.toLowerCase().includes(query)
    ));
  }, [visibleWidgetIds, widgetSearch]);

  const {
    width: measuredGridWidth,
    containerRef: gridContainerRef,
    measureWidth: measureGridWidth,
  } = useContainerWidth({ initialWidth: estimatedGridWidth });

  const gridWidth = Number.isFinite(measuredGridWidth) && measuredGridWidth > 0
    ? measuredGridWidth
    : estimatedGridWidth;

  useEffect(() => {
    if (!isActive || typeof window === "undefined") {
      return undefined;
    }
    const raf = window.requestAnimationFrame(() => {
      measureGridWidth();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isActive, measureGridWidth]);

  const widgetAdaptiveById = useMemo(
    () => buildWidgetAdaptiveProfileMap(activeBreakpointRows, {
      containerWidth: gridWidth,
      cols: activeBreakpointCols,
      rowHeight: GRID_ROW_HEIGHT,
      margin: gridMargin,
      containerPadding: GRID_CONTAINER_PADDING,
    }),
    [activeBreakpointCols, activeBreakpointRows, gridMargin, gridWidth],
  );
  const portfolioAdaptive = widgetAdaptiveById.portfolio || DEFAULT_WIDGET_ADAPTIVE;
  const spotChartAdaptive = widgetAdaptiveById.spotChart || DEFAULT_WIDGET_ADAPTIVE;
  const optionsChartAdaptive = widgetAdaptiveById.optionsChart || DEFAULT_WIDGET_ADAPTIVE;
  const orderFlowAdaptive = widgetAdaptiveById.orderFlow || DEFAULT_WIDGET_ADAPTIVE;
  const executionAdaptive = widgetAdaptiveById.execution || DEFAULT_WIDGET_ADAPTIVE;
  const strategyAdaptive = widgetAdaptiveById.strategy || DEFAULT_WIDGET_ADAPTIVE;
  const spotChartHeight = computeAdaptiveChartHeight(spotChartAdaptive, {
    xs: 250,
    sm: 300,
    md: 390,
    lg: 460,
    min: 220,
    max: 520,
    chromeOffset: 170,
  });
  const optionsChartHeight = computeAdaptiveChartHeight(optionsChartAdaptive, {
    xs: 230,
    sm: 280,
    md: 360,
    lg: 420,
    min: 190,
    max: 480,
    chromeOffset: 150,
  });
  const compactOrderFlow = orderFlowAdaptive.profile === "xs" || orderFlowAdaptive.profile === "sm";
  const compactPortfolio = portfolioAdaptive.profile === "xs" || portfolioAdaptive.profile === "sm";
  const spotCompact = spotChartAdaptive.profile === "xs";
  const optionsCompact = optionsChartAdaptive.profile === "xs";
  const optionsSemiCompact = optionsChartAdaptive.profile === "sm";
  const compactExecution = executionAdaptive.profile === "xs" || executionAdaptive.profile === "sm";
  const compactStrategy = strategyAdaptive.profile === "xs" || strategyAdaptive.profile === "sm";
  const portfolioPreviewLimit = compactPortfolio ? 2 : (portfolioAdaptive.profile === "md" ? 3 : 4);
  const portfolioPreviewRows = useMemo(() => {
    const ranked = [...visiblePositions].sort((left, right) => {
      const leftScore = Math.abs(Number(left?.marketValue ?? left?.markPrice ?? 0));
      const rightScore = Math.abs(Number(right?.marketValue ?? right?.markPrice ?? 0));
      return rightScore - leftScore;
    });
    return ranked.slice(0, portfolioPreviewLimit);
  }, [portfolioPreviewLimit, visiblePositions]);
  const orderFlowInteractionState = activeInteractionWidgetId === "orderFlow"
    ? layoutInteractionState
    : "idle";

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.text, padding: 20 }}>
        Loading Market Dashboard...
      </div>
    );
  }

  const workspaceHeader = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: compactTop ? "flex-start" : "center",
        flexWrap: "wrap",
        gap: 4,
        marginBottom: 4,
      }}
    >
      <div>
        <div style={{ fontSize: mobileTop ? 15 : 17, fontWeight: 700 }}>Market Dashboard</div>
        <div style={{ fontSize: 11, color: T.muted, display: mobileTop ? "none" : "block" }}>
          Customizable trading surface: move, resize, add, and remove widgets in Edit Mode.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: T.muted }}>
          Layout sync: {layoutSyncState}
        </span>
        <button
          style={btnStyle("secondary")}
          onClick={() => refreshAll().catch((refreshError) => setError(refreshError.message))}
          disabled={refreshingData}
        >
          {refreshingData ? "Refreshing..." : "Refresh"}
        </button>
        <button
          style={editMode ? btnStyle("primary") : btnStyle("secondary")}
          onClick={() => {
            setEditMode((prev) => {
              const next = !prev;
              if (!next) {
                setWidgetLibraryOpen(false);
              }
              return next;
            });
          }}
        >
          Edit Mode: {editMode ? "On" : "Off"}
        </button>
        {editMode && (
          <button
            style={btnStyle("secondary")}
            onClick={() => setWidgetLibraryOpen((prev) => !prev)}
          >
            {widgetLibraryOpen ? "Close Library" : "Add Widget"}
          </button>
        )}
        <button
          style={qaMode
            ? {
              ...btnStyle("secondary"),
              border: "1px solid " + T.amber + "66",
              color: "#92400e",
              background: T.amber + "1f",
            }
            : btnStyle("secondary")}
          onClick={() => setQaMode((prev) => !prev)}
        >
          QA Mode: {qaMode ? "On" : "Off"}
        </button>
        <button style={btnStyle("secondary")} onClick={resetWorkspaceLayout}>
          Reset Dashboard
        </button>
        {editMode && localDashboardConfig && (
          <button
            style={btnStyle("secondary")}
            onClick={() => applyDashboardConfig(localDashboardConfig, "local layout")}
          >
            Use Local
          </button>
        )}
        {editMode && serverDashboardConfig && (
          <button
            style={btnStyle("secondary")}
            onClick={() => applyDashboardConfig(serverDashboardConfig, "server layout")}
          >
            Use Server
          </button>
        )}
      </div>
    </div>
  );

  const bannerStack = (
    <>
      {notice && (
        <div
          style={{
            marginBottom: 6,
            border: `1px solid ${T.green}66`,
            background: `${T.green}18`,
            color: T.green,
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 12,
          }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          style={{
            marginBottom: 6,
            border: `1px solid ${T.red}66`,
            background: `${T.red}14`,
            color: T.red,
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      {qaMode && (
        <div
          style={{
            marginBottom: 6,
            border: "1px solid " + T.amber + "66",
            background: T.amber + "16",
            color: "#92400e",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 11,
          }}
        >
          QA mode is active. Auto-refresh is paused so visual review stays stable.
        </div>
      )}
    </>
  );
  const portfolioPanel = (
    <div
      style={{
        ...cardStyle(),
        padding: 5,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        overflowY: showWorkspacePositions ? "auto" : "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Portfolio
          </div>
          <div style={{ fontSize: 10.5, color: T.text, fontWeight: 700 }}>
            {selectedAccountLabel}
          </div>
        </div>
        <button
          type="button"
          style={{ ...btnStyle("secondary"), fontSize: 10.5, padding: "4px 8px" }}
          onClick={() => setShowWorkspacePositions((prev) => !prev)}
        >
          {showWorkspacePositions ? "Hide Positions" : `Positions (${Math.min(visiblePositions.length, 12)}/${visiblePositions.length})`}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 0,
          overflowX: "auto",
          paddingBottom: 1,
          scrollbarWidth: "thin",
          border: `1px solid ${T.border}`,
          borderRadius: 7,
          background: T.card2,
        }}
      >
        {accountMatrixColumns.map((account) => {
          const selected = account.accountId === selectedAccountId;
          const authTone = workspaceAuthTone(account.authState);
          return (
            <button
              key={account.accountId}
              type="button"
              onClick={() => setSelectedAccountId(account.accountId)}
              style={{
                border: "none",
                borderRight: `1px solid ${T.border}`,
                borderRadius: 0,
                background: selected ? "#ffffff" : "transparent",
                boxShadow: selected ? `inset 0 -2px 0 ${T.accent}` : "none",
                padding: "4px 7px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                textAlign: "left",
                cursor: "pointer",
                minWidth: 0,
                flex: "0 0 auto",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: authTone,
                  flex: "0 0 auto",
                }}
              />
              <span style={{ fontSize: 10, fontWeight: 700, color: T.text, maxWidth: compactPortfolio ? 84 : 118, overflow: "hidden", textOverflow: "ellipsis" }}>
                {account.label}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: selected ? T.accent : T.text, fontVariantNumeric: "tabular-nums" }}>
                {formatUsdCompact(account.equity)}
              </span>
              <span style={{ fontSize: 9, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                {account.positionCount || 0}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          border: `1px solid ${T.border}`,
          borderRadius: 7,
          background: "#ffffff",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: compactPortfolio
              ? "1.35fr 0.9fr 0.9fr 0.7fr 1.6fr"
              : "1.35fr 0.9fr 0.9fr 0.9fr 0.7fr 2fr",
            borderBottom: `1px solid ${T.border}`,
            background: T.card2,
          }}
        >
          {(compactPortfolio
            ? ["Account", "Eq", "UPNL", "Qty", "Top"]
            : ["Account", "Eq", "Cash", "UPNL", "Qty", "Top Positions"]
          ).map((label) => (
            <div
              key={label}
              style={{
                padding: "3px 6px",
                fontSize: 9,
                color: T.muted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: compactPortfolio
              ? "1.35fr 0.9fr 0.9fr 0.7fr 1.6fr"
              : "1.35fr 0.9fr 0.9fr 0.9fr 0.7fr 2fr",
            alignItems: "center",
          }}
        >
          <div style={{ padding: "4px 6px", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: T.text }}>
              {selectedPortfolioAccount?.label || selectedAccountLabel}
            </span>
            <span style={{ fontSize: 9.5, color: T.muted }}>
              {" · "}
              {formatBrokerAbbrev(selectedPortfolioAccount?.broker)} / {formatAuthStateAbbrev(selectedPortfolioAccount?.authState)}
            </span>
          </div>

          <div style={{ padding: "4px 6px", fontSize: 10.5, fontWeight: 700, color: T.text, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {formatUsdCompact(selectedPortfolioAccount?.equity)}
          </div>

          {!compactPortfolio && (
            <div style={{ padding: "4px 6px", fontSize: 10.5, fontWeight: 700, color: T.text, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatUsdCompact(selectedPortfolioAccount?.cash)}
            </div>
          )}

          <div
            style={{
              padding: "4px 6px",
              fontSize: 10.5,
              fontWeight: 700,
              color: Number.isFinite(Number(selectedPortfolioAccount?.unrealizedPnl))
                ? (Number(selectedPortfolioAccount?.unrealizedPnl) >= 0 ? T.green : T.red)
                : T.text,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {formatUsdCompact(selectedPortfolioAccount?.unrealizedPnl)}
          </div>

          <div style={{ padding: "4px 6px", fontSize: 10.5, fontWeight: 700, color: T.text, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {String(selectedPortfolioAccount?.positionCount || 0)}
          </div>

          <div style={{ padding: "4px 6px", minWidth: 0, display: "flex", gap: 8, alignItems: "center", overflow: "hidden", whiteSpace: "nowrap" }}>
            {portfolioPreviewRows.length > 0 ? (
              <>
                {portfolioPreviewRows.map((position) => {
                  const previewKey = String(position?.positionId || `${position?.accountId || "acct"}-${position?.symbol || "sym"}-${position?.qty || 0}`);
                  return (
                    <span key={previewKey} style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {formatPortfolioPositionChip(position)}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: Number(position?.unrealizedPnl || 0) >= 0 ? T.green : T.red,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatCompactMoney(position?.unrealizedPnl)}
                      </span>
                    </span>
                  );
                })}
                {Number(selectedPortfolioAccount?.positionCount || 0) > portfolioPreviewLimit && (
                  <span style={{ color: T.muted, fontSize: 9.5, whiteSpace: "nowrap" }}>
                    +{Number(selectedPortfolioAccount?.positionCount || 0) - portfolioPreviewLimit}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 9.5, color: T.muted }}>
                Flat
              </span>
            )}
          </div>
        </div>
      </div>

      {showWorkspacePositions && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, background: "#ffffff", padding: "5px 6px" }}>
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>
            Market routing account: {resolvedExecutionAccountId || "--"} {resolvedExecutionAccountId && selectedAccountId === "all" ? "(auto)" : ""}
          </div>
          <div style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.card2 }}>
                  {["Acct", "Symbol", "Contract", "Type", "Qty", "Avg", "Mark", "UPNL", "Action"].map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: header === "Qty" || header === "Avg" || header === "Mark" || header === "UPNL" ? "right" : "left",
                        color: T.muted,
                        padding: "4px 4px",
                        fontWeight: 600,
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblePositions.slice(0, 12).map((position) => (
                  <tr key={position.positionId} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={cellStyle}>{position.accountId}</td>
                    <td style={cellStyle}>{position.symbol}</td>
                    <td style={{ ...cellStyle, color: T.muted }}>{formatOptionContract(position.option)}</td>
                    <td style={cellStyle}>{position.assetType}</td>
                    <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{position.qty}</td>
                    <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(position.averagePrice)}</td>
                    <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(position.markPrice)}</td>
                    <td
                      style={{
                        ...cellStyle,
                        textAlign: "right",
                        color: Number(position.unrealizedPnl) >= 0 ? T.green : T.red,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(position.unrealizedPnl)}
                    </td>
                    <td style={cellStyle}>
                      <button
                        style={{ ...btnStyle("danger"), padding: "3px 6px", fontSize: 10.5 }}
                        onClick={() => closePositionFromWorkspace(position)}
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
                {visiblePositions.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ ...cellStyle, padding: "8px 3px", color: T.muted }}>
                      No open positions for the selected account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const spotChartPanel = (
    <div style={cardStyle()} className="market-widget-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: spotCompact ? 6 : 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Spot Chart</div>
          {!spotCompact && quote && (
            <div style={{ fontSize: 11, color: T.muted }}>
              {normalizedSymbol} <span style={{ color: T.text, fontWeight: 700 }}>{money(quote.last)}</span>
            </div>
          )}
        </div>
        {!spotCompact && (
          <div style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            {selectedOptionRow ? `Selected contract: ${optionChartContractLabel}` : "No option contract selected"}
          </div>
        )}
      </div>

      <LiveBrokerTradingViewWidget
        symbol={normalizedSymbol}
        interval={interval}
        theme={theme}
        accountId={chartAccountId}
        onSymbolChange={handleChartSymbolChange}
        onIntervalChange={handleChartIntervalChange}
        enginePreference="auto"
        height={`${spotChartHeight}px`}
        showAssetHint={false}
        showSideToolbar={false}
        showTopToolbar={true}
        showLegend={true}
      />
    </div>
  );

  const optionsChartPanel = (
    <div style={cardStyle()} className="market-widget-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Options TradingView (Selected Contract)</div>
        {!optionsCompact && (
          <div style={{ fontSize: 11, color: T.muted }}>
          {selectedOptionRow ? optionChartContractLabel : "No contract selected - showing " + fallbackOptionChartSymbol}
          </div>
        )}
      </div>

      <div className="adaptive-controls-grid" style={{ display: "grid", gridTemplateColumns: optionsCompact ? "1fr" : "1fr auto", gap: 8, alignItems: "end", marginBottom: 10 }}>
        <label style={labelStyle}>
          Symbol Override (optional)
          <input
            value={optionChartSymbolInput}
            onChange={(event) => setOptionChartSymbolInput(event.target.value.toUpperCase())}
            placeholder={optionChartSymbol || "O:SPY..."}
            style={inputStyle}
          />
        </label>
        {!optionsCompact && (
          <button
            style={btnStyle("secondary")}
            onClick={() => setOptionChartSymbolInput("")}
            disabled={!optionChartSymbolInput}
          >
            Clear Override
          </button>
        )}
      </div>

      {!optionsCompact && (
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
        Source symbol: {effectiveOptionChartSymbol} - source: {optionChartSymbolSource} - hosted TradingView mode.
        </div>
      )}

      {optionChartUsesFallback && !optionsSemiCompact && (
        <div
          style={{
            border: `1px dashed ${T.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 11,
            color: T.muted,
            marginBottom: 10,
          }}
        >
          No contract selected or resolved yet. Showing underlying chart until a ladder contract is chosen.
        </div>
      )}

      <LiveBrokerTradingViewWidget
        symbol={effectiveOptionChartSymbol}
        interval={interval}
        theme={theme}
        accountId={chartAccountId}
        onIntervalChange={handleChartIntervalChange}
        enginePreference="widget"
        height={`${optionsChartHeight}px`}
        showAssetHint={false}
        showSideToolbar={false}
        showTopToolbar={true}
        showLegend={true}
      />
    </div>
  );

  const strategyPanel = (
    <div style={cardStyle()}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
        AI Fusion Controls
      </div>

      <div
        style={{
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          background: T.card2,
          padding: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>AI Fusion Context (Advisory)</div>
          <div style={{ fontSize: 10, color: T.muted }}>
            Runtime: {aiFusionStatus?.running ? "worker on" : "worker off"}
          </div>
        </div>

        <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
          30-60s context loop for signal/news/sentiment fusion. Not coupled to trade execution.
        </div>

        <div style={{ marginBottom: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Kpi label="Status" value={aiFusionStatusText} color={aiFusionStatusColor} />
          <Kpi
            label="Regime / Bias"
            value={aiFusionContext ? `${aiFusionContext.regime || "--"} / ${aiFusionContext.bias || "--"}` : "--"}
          />
          <Kpi
            label="Confidence"
            value={Number.isFinite(Number(aiFusionContext?.confidence))
              ? `${Math.round(Number(aiFusionContext.confidence) * 100)}%`
              : "--"}
          />
          <Kpi
            label="Risk Mult"
            value={Number.isFinite(Number(aiFusionContext?.riskMultiplier))
              ? Number(aiFusionContext.riskMultiplier).toFixed(2)
              : "--"}
          />
        </div>

        {!compactStrategy && (
          <>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>
              {String(aiFusionContext?.headline || "No fusion headline yet.")}
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 8 }}>
              Updated: {formatWorkspaceTimestamp(aiFusionContext?.ts)} · Expires: {formatWorkspaceTimestamp(aiFusionContext?.expiresAt)} {aiFusionStale ? "(stale)" : ""}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 1fr))", gap: 8 }}>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={Boolean(aiFusionConfig.enabled)}
                  disabled={aiFusionConfigBusy}
                  onChange={(event) => {
                    void patchAiFusionConfig(
                      { enabled: event.target.checked },
                      { noticeText: `AI fusion ${event.target.checked ? "enabled" : "disabled"}.` },
                    );
                  }}
                />
                Enabled
              </label>

              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={Boolean(aiFusionConfig.dryRun)}
                  disabled={aiFusionConfigBusy}
                  onChange={(event) => {
                    void patchAiFusionConfig(
                      { dryRun: event.target.checked },
                      { noticeText: `AI fusion mode: ${event.target.checked ? "dry-run" : "live provider"}.` },
                    );
                  }}
                />
                Dry Run
              </label>

              <label style={labelStyle}>
                Provider
                <select
                  value={String(aiFusionConfig.provider || "openai")}
                  onChange={(event) => {
                    void patchAiFusionConfig(
                      { provider: event.target.value },
                      { noticeText: `AI fusion provider set to ${event.target.value}.` },
                    );
                  }}
                  style={selectStyle}
                  disabled={aiFusionConfigBusy}
                >
                  <option value="dry-run">dry-run</option>
                  <option value="openai">openai</option>
                </select>
              </label>

              <label style={labelStyle}>
                Interval
                <select
                  value={aiFusionIntervalSelectValue}
                  onChange={(event) => {
                    void patchAiFusionConfig(
                      { intervalSec: Number(event.target.value) },
                      { noticeText: `AI fusion interval set to ${event.target.value}s.` },
                    );
                  }}
                  style={selectStyle}
                  disabled={aiFusionConfigBusy}
                >
                  <option value="30">30s</option>
                  <option value="45">45s</option>
                  <option value="60">60s</option>
                  <option value="90">90s</option>
                  <option value="120">120s</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                style={btnStyle("secondary")}
                onClick={() => refreshAiFusionStatus().catch((statusError) => setError(statusError.message))}
                disabled={aiFusionBusy || aiFusionConfigBusy}
              >
                Refresh Status
              </button>
              <button
                style={btnStyle("primary")}
                onClick={() => triggerAiFusionContextRun().catch((runError) => setError(runError.message))}
                disabled={aiFusionBusy}
              >
                {aiFusionBusy ? "Running..." : "Run Now"}
              </button>
            </div>
          </>
        )}

        {compactStrategy && (
          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 6 }}>
            Expand AI Fusion for full controls.
          </div>
        )}
      </div>
    </div>
  );

  const executionPanel = (
    <div style={cardStyle()}>
      <div style={{ fontSize: compactExecution ? 12.5 : 14, fontWeight: 700, marginBottom: compactExecution ? 6 : 8 }}>
        {compactExecution ? "Execution" : "Execution Panel (Migrated Into Workspace)"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compactExecution ? "1fr" : "repeat(2, minmax(120px, 1fr))", gap: compactExecution ? 6 : 8 }}>
        <label style={labelStyle}>
          Account
          <select
            value={ticket.accountId}
            onChange={(event) => {
              const accountId = event.target.value;
              const account = accounts.find((item) => item.accountId === accountId);
              onTicketChange("accountId", accountId);
              if (account) {
                onTicketChange("executionMode", account.mode);
              }
            }}
            style={selectStyle}
          >
            {accounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Symbol
          <input
            value={ticket.symbol}
            onChange={(event) => onTicketChange("symbol", event.target.value.toUpperCase())}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Asset
          <select value={ticket.assetType} onChange={(event) => onTicketChange("assetType", event.target.value)} style={selectStyle}>
            <option value="option">option</option>
            <option value="equity">equity</option>
          </select>
        </label>

        <label style={labelStyle}>
          Side
          <select value={ticket.side} onChange={(event) => onTicketChange("side", event.target.value)} style={selectStyle}>
            <option value="buy">buy</option>
            <option value="sell">sell</option>
          </select>
        </label>

        {ticket.assetType === "option" && (
          <>
            <label style={labelStyle}>
              Expiry
              <input value={ticket.expiry} onChange={(event) => onTicketChange("expiry", event.target.value)} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Right
              <select value={ticket.right} onChange={(event) => onTicketChange("right", event.target.value)} style={selectStyle}>
                <option value="call">call</option>
                <option value="put">put</option>
              </select>
            </label>
            <label style={labelStyle}>
              Strike
              <DraftNumberInput
                value={ticket.strike}
                onCommit={(nextValue) => onTicketChange("strike", nextValue)}
                style={inputStyle}
              />
            </label>
          </>
        )}

        <label style={labelStyle}>
          Quantity
          <DraftNumberInput
            min={1}
            value={ticket.quantity}
            onCommit={(nextValue) => onTicketChange("quantity", nextValue)}
            normalizeOnBlur={(numeric) => Math.max(1, Math.round(numeric))}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Order Type
          <select value={ticket.orderType} onChange={(event) => onTicketChange("orderType", event.target.value)} style={selectStyle}>
            <option value="market">market</option>
            <option value="limit">limit</option>
          </select>
        </label>

        {ticket.orderType === "limit" && (
          <label style={labelStyle}>
            Limit Price
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={ticket.limitPrice}
              onChange={(event) => onTicketChange("limitPrice", event.target.value)}
              style={inputStyle}
            />
          </label>
        )}

        <label style={labelStyle}>
          Execution
          <select value={ticket.executionMode} onChange={(event) => onTicketChange("executionMode", event.target.value)} style={selectStyle}>
            <option value="live">live</option>
          </select>
        </label>

        <label style={labelStyle}>
          TIF
          <select value={ticket.timeInForce} onChange={(event) => onTicketChange("timeInForce", event.target.value)} style={selectStyle}>
            <option value="day">DAY</option>
            <option value="gtc">GTC</option>
          </select>
        </label>
      </div>

      {ticketPreview && !compactExecution && (
        <div style={{ marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 6, padding: 8, fontSize: 12, background: T.card2 }}>
          <div style={{ color: T.muted }}>Ticket Preview</div>
          <div>Unit Price: {money(ticketPreview.unitPrice)}</div>
          <div>Estimated Notional: {money(ticketPreview.estimatedNotional)}</div>
          <div>Estimated Fees: {money(ticketPreview.estimatedFees)}</div>
          <div style={{ fontWeight: 700 }}>Estimated Total: {money(ticketPreview.estimatedTotal)}</div>
        </div>
      )}

      {ticketPreflight && !compactExecution && (
        <PreflightSummaryCard title="Ticket Preflight" preflight={ticketPreflight} />
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={{ ...btnStyle("secondary"), flex: 1 }} onClick={runTicketPreview}>
          Preview
        </button>
        <button
          style={{ ...btnStyle("primary"), flex: 1 }}
          onClick={submitTicketOrder}
          disabled={submittingTicket}
        >
          {submittingTicket ? "Submitting..." : "Submit Order"}
        </button>
      </div>

      {!compactExecution && (
      <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Order Lifecycle</div>
          <button
            style={btnStyle("secondary")}
            onClick={() => refreshOrders().catch((refreshError) => setError(refreshError.message))}
            disabled={loadingOrders}
          >
            {loadingOrders ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div style={{ marginBottom: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Kpi label="Recent" value={String(recentOrders.length)} />
          <Kpi label="Open" value={String(openOrderCount)} color={openOrderCount > 0 ? T.amber : T.green} />
        </div>

        <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, background: "#ffffff", overflow: "hidden" }}>
          {recentOrders.length === 0 ? (
            <div style={{ padding: "10px 8px", fontSize: 12, color: T.muted }}>
              No recorded orders yet.
            </div>
          ) : (
            recentOrders.map((row) => (
              <div
                key={row.orderId}
                style={{
                  padding: "8px 8px",
                  borderBottom: `1px solid ${T.border}`,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 6,
                  fontSize: 11,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.order?.symbol || row.symbol || "--"} · {String(row.order?.side || row.side || "--").toUpperCase()} {row.order?.quantity || row.quantity || "--"}
                  </div>
                  <div style={{ color: T.muted }}>
                    {row.orderId} · {formatOrderTimestamp(row.updatedAt || row.createdAt || row.filledAt)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: orderStatusTone(row, T), fontWeight: 700 }}>
                    {String(row.status || "--").toUpperCase()}
                  </div>
                  <div style={{ color: T.muted }}>
                    {String(row.lifecycleState || "closed")}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {compactExecution && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: T.muted }}>
          Orders: {recentOrders.length} recent · {openOrderCount} open
        </div>
      )}
    </div>
  );

  const orderFlowHubPanel = (
    <div style={{ ...cardStyle(), height: "100%", overflow: "hidden", padding: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: compactOrderFlow ? 12.5 : 14, fontWeight: 700 }}>
          {compactOrderFlow ? "Order-Flow" : "Order-Flow Hub"}
        </div>
        <div style={{ fontSize: 11, color: T.muted }}>
          Webull source: {orderFlow?.source || "--"}
        </div>
      </div>

      <div style={{ fontSize: compactOrderFlow ? 9.5 : 10, color: T.muted, marginBottom: 6 }}>
        Score {Number.isFinite(Number(orderFlow?.score)) ? Number(orderFlow.score).toFixed(2) : "--"}
        {" · "}
        Aggressor Buy {Number.isFinite(Number(orderFlow?.metrics?.aggressorBuyPct))
          ? `${Number(orderFlow.metrics.aggressorBuyPct).toFixed(1)}%`
          : "--"}
      </div>

      <UnifiedOrderFlowModule
        symbol={marketSymbol}
        orderFlow={orderFlow}
        history={orderFlowHistory}
        distribution={optionsVolumeDistribution}
        expiry={expiry}
        availableExpiries={availableExpiries}
        onExpiryChange={setExpiry}
        compact={compactOrderFlow}
        shape={orderFlowAdaptive.shape}
        interactionState={orderFlowInteractionState}
      />
    </div>
  );

  const ladderPanel = (
    <div style={{ ...cardStyle(), padding: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={chainToolbarButtonStyle}>Settings ▾</button>
          <button type="button" style={chainToolbarButtonStyle}>Filters ▾</button>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5, color: T.text, fontSize: 12 }}>
            Chain Focus
            <select
              value={chainFocus}
              onChange={(event) => setChainFocus(event.target.value)}
              style={{ ...chainToolbarSelectStyle, minWidth: 118 }}
            >
              <option value="price">Price</option>
              <option value="liquidity">Liquidity</option>
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5, color: T.text, fontSize: 12 }}>
            Expiry
            <select
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              style={{ ...chainToolbarSelectStyle, minWidth: 104 }}
            >
              {availableExpiries.map((value) => (
                <option key={value} value={value}>
                  {formatExpiryChipLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5, color: T.text, fontSize: 12 }}>
            Qty
            <DraftNumberInput
              min={1}
              value={quickQty}
              onCommit={setQuickQty}
              normalizeOnBlur={(numeric) => Math.max(1, Math.round(numeric))}
              style={{ ...chainToolbarSelectStyle, width: 64, minWidth: 64, textAlign: "center" }}
            />
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 6, display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
        <div style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {selectedOptionRow
            ? `Selected ${formatOptionContract(selectedOptionRow)} · Bid ${money(selectedOptionRow.bid)} · Ask ${money(selectedOptionRow.ask)}`
            : "Select a call or put from the board"}
        </div>
        {selectedOptionRow && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              style={chainActionButtonStyle("secondary")}
              onClick={() => runRapidAction({ row: selectedOptionRow, side: "buy", orderType: "market", previewOnly: true })}
              disabled={rapidBusy === `${selectedOptionRow.contractId}:buy:market:preview`}
            >
              {rapidBusy === `${selectedOptionRow.contractId}:buy:market:preview` ? "..." : "Preview"}
            </button>
            <button
              style={chainActionButtonStyle("success")}
              onClick={() => runRapidAction({ row: selectedOptionRow, side: "buy", orderType: "market", previewOnly: false })}
              disabled={rapidBusy === `${selectedOptionRow.contractId}:buy:market:submit`}
            >
              {rapidBusy === `${selectedOptionRow.contractId}:buy:market:submit` ? "..." : `Buy ${quickQty}`}
            </button>
            <button
              style={chainActionButtonStyle("danger")}
              onClick={() => runRapidAction({ row: selectedOptionRow, side: "sell", orderType: "market", previewOnly: false })}
              disabled={rapidBusy === `${selectedOptionRow.contractId}:sell:market:submit`}
            >
              {rapidBusy === `${selectedOptionRow.contractId}:sell:market:submit` ? "..." : `Sell ${quickQty}`}
            </button>
            <button
              style={chainActionButtonStyle("secondary")}
              onClick={() =>
                runRapidAction({
                  row: selectedOptionRow,
                  side: "buy",
                  orderType: "limit",
                  limitPrice: selectedOptionRow.ask,
                  previewOnly: false,
                })
              }
            >
              Buy@Ask
            </button>
            <button
              style={chainActionButtonStyle("secondary")}
              onClick={() =>
                runRapidAction({
                  row: selectedOptionRow,
                  side: "sell",
                  orderType: "limit",
                  limitPrice: selectedOptionRow.bid,
                  previewOnly: false,
                })
              }
            >
              Sell@Bid
            </button>
          </div>
        )}
      </div>

      {preview && (
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: "6px 8px",
            marginBottom: 6,
            fontSize: 11,
            background: T.card2,
          }}
        >
          <div style={{ color: T.muted }}>Rapid Preview</div>
          <div>Unit: {money(preview.unitPrice)}</div>
          <div>Notional: {money(preview.estimatedNotional)}</div>
          <div>Fees: {money(preview.estimatedFees)}</div>
          <div style={{ fontWeight: 700 }}>Total: {money(preview.estimatedTotal)}</div>
        </div>
      )}

      {rapidPreflight && (
        <PreflightSummaryCard title="Rapid Preflight" preflight={rapidPreflight} />
      )}

      <div
        ref={chainScrollContainerRef}
        onScroll={handleChainTableScroll}
        style={{
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          maxWidth: "100%",
          overflow: "hidden",
          background: "#ffffff",
        }}
      >
        <table style={{ width: "100%", minWidth: "100%", borderCollapse: "collapse", fontSize: 10.5, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <th
                colSpan={chainColumns.call.length}
                style={{
                  textAlign: "center",
                  color: "#047857",
                  padding: "5px 2px",
                  position: "sticky",
                  top: 0,
                  background: "#f4f6f9",
                  zIndex: 1,
                  borderRight: `1px solid ${T.border}`,
                }}
              >
                CALLS
              </th>
              <th
                colSpan={1}
                style={{
                  textAlign: "center",
                  color: T.text,
                  padding: "5px 2px",
                  position: "sticky",
                  top: 0,
                  background: "#edf1f5",
                  zIndex: 1,
                  borderRight: `1px solid ${T.border}`,
                }}
              >
                Strike
              </th>
              <th
                colSpan={chainColumns.put.length}
                style={{
                  textAlign: "center",
                  color: "#b45309",
                  padding: "5px 2px",
                  position: "sticky",
                  top: 0,
                  background: "#f4f6f9",
                  zIndex: 1,
                }}
              >
                PUTS
              </th>
            </tr>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {chainColumns.call.map((column, index) => (
                <th
                  key={`call-header-${column.key}-${index}`}
                  style={{
                    textAlign: "center",
                    color: T.muted,
                    padding: "5px 4px",
                    position: "sticky",
                    top: 30,
                    background: "#f4f6f9",
                    zIndex: 1,
                    borderRight: index === chainColumns.call.length - 1 ? `1px solid ${T.border}` : "none",
                  }}
                >
                  {column.label}
                </th>
              ))}
              <th
                style={{
                  textAlign: "center",
                  color: T.muted,
                  padding: "5px 4px",
                  position: "sticky",
                  top: 30,
                  background: "#edf1f5",
                  zIndex: 1,
                  borderRight: `1px solid ${T.border}`,
                }}
              >
                Strike
              </th>
              {chainColumns.put.map((column, index) => (
                <th
                  key={`put-header-${column.key}-${index}`}
                  style={{
                    textAlign: "center",
                    color: T.muted,
                    padding: "5px 4px",
                    position: "sticky",
                    top: 30,
                    background: "#f4f6f9",
                    zIndex: 1,
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleChainRows.length === 0 && (
              <tr>
                <td colSpan={chainTableColCount} style={{ padding: "24px 8px", textAlign: "center", color: T.muted }}>
                  No options chain rows available for the selected expiry.
                </td>
              </tr>
            )}
            {visibleChainRows.flatMap((pair, index) => {
              const call = pair.call;
              const put = pair.put;
              const strike = Number(pair.strike);
              const under = Number(optionChain?.underlyingPrice);
              const striped = index % 2 === 1;
              const atm = optionGrid.dividerAfterIndex === index;
              const callActive = String(call?.contractId || "") === String(selectedContractId || "");
              const putActive = String(put?.contractId || "") === String(selectedContractId || "");
              const callItm = Number.isFinite(under) && Number.isFinite(strike) ? under > strike : false;
              const putItm = Number.isFinite(under) && Number.isFinite(strike) ? under < strike : false;

              const strikeRow = (
                <tr key={`strike-${pair.strike}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                  {chainColumns.call.map((column, columnIndex) => {
                    const metric = formatOptionMetricCell(call, column.metric, T);
                    const clickable = Boolean(call?.contractId);
                    return (
                      <td
                        key={`call-${pair.strike}-${column.key}`}
                        style={optionCellStyle({
                          side: "call",
                          active: callActive,
                          itm: callItm,
                          striped,
                          valueTone: column.valueTone,
                          borderRight: columnIndex === chainColumns.call.length - 1,
                          clickable,
                        })}
                        onClick={() => clickable && setSelectedContractId(call.contractId)}
                      >
                        {metric.color ? <span style={{ color: metric.color }}>{metric.text}</span> : metric.text}
                      </td>
                    );
                  })}
                  <td style={{ ...optionStrikeCellStyle(T, { atm, striped }), borderRight: `1px solid ${T.border}` }}>
                    {Number.isFinite(strike) ? strike : "--"}
                  </td>
                  {chainColumns.put.map((column) => {
                    const metric = formatOptionMetricCell(put, column.metric, T);
                    const clickable = Boolean(put?.contractId);
                    return (
                      <td
                        key={`put-${pair.strike}-${column.key}`}
                        style={optionCellStyle({
                          side: "put",
                          active: putActive,
                          itm: putItm,
                          striped,
                          valueTone: column.valueTone,
                          clickable,
                        })}
                        onClick={() => clickable && setSelectedContractId(put.contractId)}
                      >
                        {metric.color ? <span style={{ color: metric.color }}>{metric.text}</span> : metric.text}
                      </td>
                    );
                  })}
                </tr>
              );

              if (optionGrid.dividerAfterIndex !== index) {
                return [strikeRow];
              }
              return [
                strikeRow,
                (
                  <tr key={`underlying-${pair.strike}`}>
                    <td
                      colSpan={chainTableColCount}
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: T.green,
                        padding: "7px 4px",
                        background: "#ffffff",
                        borderTop: `1px solid ${T.border}`,
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      {marketSymbol}: {money(optionChain?.underlyingPrice)} {Number.isFinite(Number(quote?.changePct)) ? `${Number(quote.changePct) >= 0 ? "+" : ""}${Number(quote.changePct).toFixed(2)}%` : ""}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      {chainRowsTrimmed && (
        <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
          Showing {visibleChainRows.length} strikes to fit this layout size.
        </div>
      )}

      <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>
        Source: {optionChain?.source || "--"} {optionChain?.stale ? "(stale)" : ""}
        {" · "}
        Flow: {orderFlow?.source || "--"} {orderFlow?.stale ? "(stale)" : ""}
      </div>
    </div>
  );

  const widgetPanelsById = {
    portfolio: portfolioPanel,
    spotChart: spotChartPanel,
    optionsChart: optionsChartPanel,
    orderFlow: orderFlowHubPanel,
    strategy: strategyPanel,
    execution: executionPanel,
    ladder: ladderPanel,
  };
  const visibleWidgets = visibleWidgetIds
    .map((widgetId) => ({
      widgetId,
      title: MARKET_WIDGET_META[widgetId]?.title || widgetId,
      panel: widgetPanelsById[widgetId] || null,
    }))
    .filter((row) => row.panel);

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        background: T.bg,
        color: T.text,
        padding: mobileTop ? 6 : 8,
      }}
    >
      <style>{MARKET_DASHBOARD_GRID_CSS}</style>
      {workspaceHeader}
      {bannerStack}

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 10, color: T.muted }}>
          {editMode
            ? `Edit Mode active: drag with grip icon or use arrow keys on the grip, resize from corners, remove widgets from card chrome. Breakpoint: ${activeBreakpoint}.`
            : `Layout locked. Enable Edit Mode to move, resize, add, or remove widgets. Breakpoint: ${activeBreakpoint}.`}
        </div>
      </div>

      <div ref={gridContainerRef} style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
        <ResponsiveGridLayout
          width={gridWidth}
          className="market-dashboard-grid"
          layouts={mergedWidgetLayouts}
          breakpoints={GRID_BREAKPOINTS}
          cols={GRID_COLS}
          rowHeight={GRID_ROW_HEIGHT}
          margin={gridMargin}
          containerPadding={GRID_CONTAINER_PADDING}
          dragConfig={{
            enabled: editMode,
            bounded: true,
            handle: ".workspace-grid-handle",
            cancel: ".workspace-grid-body, .workspace-grid-body *, .workspace-grid-remove, .workspace-grid-remove *, .react-resizable-handle, .react-resizable-handle *",
          }}
          resizeConfig={{
            enabled: editMode,
            handles: ["se"],
          }}
          onLayoutChange={handleWidgetLayoutChange}
          onDragStart={(_layout, item) => {
            setLayoutInteractionState("dragging");
            setActiveInteractionWidgetId(String(item?.i || ""));
          }}
          onDragStop={() => {
            setLayoutInteractionState("idle");
            setActiveInteractionWidgetId(null);
          }}
          onResizeStart={(_layout, item) => {
            setLayoutInteractionState("resizing");
            setActiveInteractionWidgetId(String(item?.i || ""));
          }}
          onResizeStop={() => {
            setLayoutInteractionState("idle");
            setActiveInteractionWidgetId(null);
          }}
          onBreakpointChange={(nextBreakpoint) => setActiveBreakpoint(nextBreakpoint)}
          compactor={verticalCompactor}
        >
          {visibleWidgets.map((widget) => {
            const widgetInteractionState = activeInteractionWidgetId === widget.widgetId
              ? layoutInteractionState
              : "idle";
            return (
              <div key={widget.widgetId} style={widgetShellStyle}>
                <button
                  type="button"
                  className={`workspace-grid-handle${editMode ? "" : " workspace-grid-handle-disabled"}`}
                  style={editMode ? widgetHandleStyle : { ...widgetHandleStyle, opacity: 0.5, cursor: "default" }}
                  title={editMode ? `Drag ${widget.title} widget (arrow keys also move while focused)` : "Enable Edit Mode to drag"}
                  aria-label={editMode ? `Drag ${widget.title} widget (arrow keys also move while focused)` : "Enable Edit Mode to drag"}
                  aria-disabled={!editMode}
                  tabIndex={editMode ? 0 : -1}
                  disabled={!editMode}
                  onKeyDown={(event) => handleWidgetHandleKeyDown(event, widget.widgetId)}
                >
                  ⠿
                </button>
                {editMode && (
                  <button
                    type="button"
                    className="workspace-grid-remove"
                    style={widgetRemoveButtonStyle}
                    onClick={() => removeWidgetFromDashboard(widget.widgetId)}
                    title={`Remove ${widget.title} widget`}
                    aria-label={`Remove ${widget.title} widget`}
                  >
                    ×
                  </button>
                )}
                <div
                  className="workspace-grid-body"
                  style={widgetBodyStyle}
                  onMouseDownCapture={stopWidgetBodyDragStart}
                  onTouchStartCapture={stopWidgetBodyDragStart}
                  onPointerDownCapture={stopWidgetBodyDragStart}
                >
                  <div
                    className="market-dashboard-widget"
                    data-widget-id={widget.widgetId}
                    data-profile={widgetAdaptiveById[widget.widgetId]?.profile || "md"}
                    data-shape={widgetAdaptiveById[widget.widgetId]?.shape || "square"}
                    data-interaction-state={widgetInteractionState}
                  >
                    {widget.panel}
                  </div>
                </div>
              </div>
            );
          })}
        </ResponsiveGridLayout>
      </div>
      {visibleWidgets.length === 0 && (
        <div
          style={{
            border: `1px dashed ${T.border}`,
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            color: T.muted,
            background: "#ffffff",
          }}
        >
          No widgets on the dashboard. Enable Edit Mode and use Widget Library to add modules.
        </div>
      )}

      {editMode && widgetLibraryOpen && (
        <>
          <div
            onClick={() => setWidgetLibraryOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.22)",
              zIndex: 70,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: "min(360px, 100vw)",
              height: "100vh",
              background: "#ffffff",
              borderLeft: `1px solid ${T.border}`,
              zIndex: 80,
              padding: 12,
              display: "grid",
              gridTemplateRows: "auto auto 1fr",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Widget Library</div>
              <button type="button" style={btnStyle("secondary")} onClick={() => setWidgetLibraryOpen(false)}>
                Close
              </button>
            </div>
            <input
              value={widgetSearch}
              onChange={(event) => setWidgetSearch(event.target.value)}
              placeholder="Search widgets"
              style={inputStyle}
            />
            <div style={{ overflowY: "auto", display: "grid", gap: 8, alignContent: "start" }}>
              {filteredWidgetLibrary.map((widget) => (
                <div
                  key={widget.widgetId}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: "8px 9px",
                    background: widget.enabled ? `${T.accent}10` : "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{widget.title}</div>
                      <div style={{ fontSize: 10.5, color: T.muted }}>{widget.group}</div>
                    </div>
                    <button
                      type="button"
                      style={btnStyle(widget.enabled ? "danger" : "primary")}
                      onClick={() => (
                        widget.enabled
                          ? removeWidgetFromDashboard(widget.widgetId)
                          : addWidgetToDashboard(widget.widgetId)
                      )}
                    >
                      {widget.enabled ? "Remove" : "Add"}
                    </button>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 11, color: T.muted }}>
                    {widget.description}
                  </div>
                </div>
              ))}
              {filteredWidgetLibrary.length === 0 && (
                <div style={{ fontSize: 11, color: T.muted, padding: "10px 4px" }}>
                  No widgets match your search.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PreflightSummaryCard({ title, preflight }) {
  if (!preflight) {
    return null;
  }

  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
  const blocking = Boolean(preflight.blocking);
  const warningCount = checks.filter((row) => row?.severity === "warning").length;
  const errorCount = checks.filter((row) => row?.severity === "error").length;
  const quote = preflight.quote || null;
  const contract = preflight.contract || null;

  return (
    <div
      style={{
        marginTop: 10,
        border: `1px solid ${blocking ? T.red : T.border}`,
        borderRadius: 6,
        padding: 8,
        fontSize: 12,
        background: blocking ? `${T.red}10` : T.card2,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ color: blocking ? T.red : T.green, fontWeight: 700 }}>
          {blocking ? "BLOCKED" : "PASS"}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, color: T.muted, marginBottom: 4 }}>
        <span>Errors: {errorCount}</span>
        <span>Warnings: {warningCount}</span>
        {quote && (
          <span>
            Spread: {Number.isFinite(Number(quote.spread)) ? money(quote.spread) : "--"}
            {Number.isFinite(Number(quote.spreadPct)) ? ` (${(Number(quote.spreadPct) * 100).toFixed(1)}%)` : ""}
          </span>
        )}
      </div>
      {contract && (
        <div style={{ color: T.muted, marginBottom: checks.length ? 4 : 0 }}>
          {contract.symbol} {contract.expiry} {String(contract.right || "").toUpperCase()} {contract.strike}
        </div>
      )}
      {checks.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          {checks.slice(0, 4).map((check, index) => (
            <div
              key={`${check.code || "check"}-${index}`}
              style={{
                color: check.severity === "error" ? T.red : T.amber,
                fontSize: 11,
              }}
            >
              {String(check.code || "CHECK").toUpperCase()}: {check.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceEquityReferenceCard({
  performance,
  accountId = "all",
  accountOptions = [],
  onAccountChange,
  onRefresh,
  loading = false,
  compact = false,
  embedded = false,
}) {
  const [chartAggregation, setChartAggregation] = useState("raw");
  const series = useMemo(
    () => {
      const layered = Array.isArray(performance?.chart?.layered?.total)
        ? performance.chart.layered.total
        : [];
      if (layered.length) {
        return layered;
      }
      return Array.isArray(performance?.chart?.single) ? performance.chart.single : [];
    },
    [performance],
  );
  const start = Number(series[0]?.equity);
  const end = Number(series[series.length - 1]?.equity);
  const delta = Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;
  const deltaPct = Number.isFinite(start) && start !== 0 && Number.isFinite(end)
    ? ((end - start) / Math.abs(start)) * 100
    : NaN;
  const cents = Number.isFinite(end) ? Math.abs(end).toFixed(2).split(".")[1] : "00";
  const wholeText = Number.isFinite(end)
    ? `${end < 0 ? "-" : ""}$${Math.floor(Math.abs(end)).toLocaleString()}`
    : "--";
  const deltaTone = Number.isFinite(delta) ? (delta >= 0 ? T.green : T.red) : T.muted;
  const directionLabel = Number.isFinite(delta)
    ? (delta >= 0 ? "Increased" : "Decreased")
    : "Updated";
  const deltaPillBg = Number.isFinite(delta) && delta < 0 ? "#fee2e2" : "#dcfce7";
  const showAccountSelector = !embedded;
  const shellBackground = embedded ? "#f8fbff" : (compact ? "transparent" : T.card);
  const shellBorder = embedded ? `1px solid ${T.border}` : (compact ? "none" : `1px solid ${T.border}`);
  const shellRadius = embedded ? 8 : (compact ? 0 : 8);
  const shellPadding = embedded ? "8px" : (compact ? "2px 0 3px" : "9px");

  if (embedded) {
    return (
      <div
        style={{
          background: "#f8fbff",
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: "6px",
          display: "grid",
          gap: 5,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Equity Curve</div>
            <span style={{ fontSize: 20, fontWeight: 700, color: T.text, letterSpacing: "-0.03em" }}>
              {wholeText}
              <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>.{cents}</span>
            </span>
            <span
              style={{
                borderRadius: 999,
                padding: "2px 7px",
                fontSize: 9.5,
                fontWeight: 700,
                color: deltaTone,
                background: deltaPillBg,
              }}
            >
              {Number.isFinite(deltaPct)
                ? `${deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(deltaPct).toFixed(2)}%`
                : "--"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select
              value={chartAggregation}
              onChange={(event) => setChartAggregation(event.target.value)}
              style={{ ...selectStyle, width: 98, minWidth: 98, padding: "4px 6px", fontSize: 10.5 }}
            >
              <option value="raw">Raw</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <button
              style={{ ...btnStyle("secondary"), padding: "4px 7px", fontSize: 10.5 }}
              onClick={() => onRefresh?.()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <MetricFlowEquityChart
          series={series}
          aggregation={chartAggregation}
          showHeader={false}
          compact
          height={116}
          emptyMessage="No equity history available yet."
          title="Workspace Equity"
          subtitle="Reference curve"
          gradientId="workspace-equity-embedded-mini"
        />

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 9.5, color: T.muted }}>
          <span>Points: {series.length}</span>
          <span>Start: {Number.isFinite(start) ? money(start) : "--"}</span>
          <span>Now: {Number.isFinite(end) ? money(end) : "--"}</span>
          <span style={{ color: deltaTone, fontWeight: 700 }}>Delta: {Number.isFinite(delta) ? money(delta) : "--"}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: shellBackground,
        border: shellBorder,
        borderRadius: shellRadius,
        padding: shellPadding,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(210px, 0.95fr) minmax(0, 1.55fr)", gap: 8, alignItems: "stretch" }}>
        <div
          style={{
            minWidth: 0,
            borderRight: `1px solid ${T.border}`,
            padding: "8px 8px 8px 2px",
            display: "grid",
            gap: 8,
            alignContent: "start",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
              {embedded ? "Equity Curve" : "Equity Curve Reference"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: T.text, letterSpacing: "-0.03em" }}>
                {wholeText}
                <span style={{ fontSize: 20, color: "#94a3b8", fontWeight: 400 }}>.{cents}</span>
              </span>
              <span
                style={{
                  borderRadius: 999,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: deltaTone,
                  background: deltaPillBg,
                }}
              >
                {Number.isFinite(deltaPct)
                  ? `${deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(deltaPct).toFixed(2)}%`
                  : "--"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
              {Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${money(delta)} ${directionLabel}` : "No equity history yet."}
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {showAccountSelector && (
              <select
                value={accountId}
                onChange={(event) => onAccountChange?.(event.target.value)}
                style={{ ...selectStyle, width: "100%", minWidth: 0, padding: "6px 8px", fontSize: 11 }}
              >
                <option value="all">All Accounts</option>
                {accountOptions.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.label || account.accountId}
                  </option>
                ))}
              </select>
            )}
            <select
              value={chartAggregation}
              onChange={(event) => setChartAggregation(event.target.value)}
              style={{ ...selectStyle, width: "100%", minWidth: 0, padding: "6px 8px", fontSize: 11 }}
            >
              <option value="raw">Raw</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <button
              style={btnStyle("secondary")}
              onClick={() => onRefresh?.()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : compact || embedded ? "Refresh" : "Refresh Equity"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
            <div style={{ color: T.muted }}>Points</div>
            <div style={{ textAlign: "right", fontWeight: 600 }}>{series.length}</div>
            <div style={{ color: T.muted }}>Start</div>
            <div style={{ textAlign: "right", fontWeight: 600 }}>{Number.isFinite(start) ? money(start) : "--"}</div>
            <div style={{ color: T.muted }}>Now</div>
            <div style={{ textAlign: "right", fontWeight: 600 }}>{Number.isFinite(end) ? money(end) : "--"}</div>
            <div style={{ color: T.muted }}>Delta</div>
            <div style={{ textAlign: "right", fontWeight: 700, color: deltaTone }}>
              {Number.isFinite(delta) ? money(delta) : "--"}
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0, paddingLeft: 2 }}>
          <MetricFlowEquityChart
            series={series}
            aggregation={chartAggregation}
            showHeader={false}
            compact={false}
            height={embedded ? 210 : (compact ? 185 : 220)}
            emptyMessage="No equity history available yet."
            title="Workspace Equity"
            subtitle="Reference curve"
            gradientId={`workspace-equity-${embedded ? "embedded" : "standalone"}`}
          />
        </div>
      </div>
    </div>
  );
}

function UnifiedOrderFlowModule({
  symbol,
  orderFlow,
  history,
  distribution,
  expiry,
  availableExpiries = [],
  onExpiryChange,
  compact = false,
  shape = "square",
  interactionState = "idle",
}) {
  return (
    <div style={orderFlowModuleContainerStyle()}>
      <div style={orderFlowModuleGridStyle({ compact, shape })}>
        <div style={orderFlowModulePanelStyle()}>
          <OrderFlowDistributionCard
            symbol={symbol}
            orderFlow={orderFlow}
            history={history}
            embedded
            compact={compact}
            interactionState={interactionState}
          />
        </div>
        <div style={orderFlowModulePanelStyle()}>
          <OptionsOrderFlowDistributionCard
            distribution={distribution}
            expiry={expiry}
            availableExpiries={availableExpiries}
            onExpiryChange={onExpiryChange}
            embedded
            compact={compact}
            interactionState={interactionState}
          />
        </div>
      </div>
    </div>
  );
}

function OrderFlowDistributionCard({
  symbol,
  orderFlow,
  history,
  embedded = false,
  compact = false,
  interactionState = "idle",
}) {
  const distribution = buildOrderFlowDistribution(orderFlow);
  const donutSegments = buildOrderFlowDonutSegments(distribution);
  const [activeSegmentKey, setActiveSegmentKey] = useState(null);
  const bars = Array.isArray(history) ? history.slice(-5) : [];
  const maxAbsBar = Math.max(
    1,
    ...bars.map((row) => Math.abs(Number(row?.signedLargeNotional || 0))),
  );
  const tickCount = Number(
    orderFlow?.metrics?.tickCount
    ?? orderFlow?.ticks?.ticks?.length
    ?? 0,
  );
  const activeSegments = donutSegments.filter((segment) => isSpotFlowSegmentActive(segment.key, activeSegmentKey));
  const activeTotal = distribution
    ? (activeSegments.length
      ? activeSegments.reduce((sum, row) => sum + Number(row.value || 0), 0)
      : Number(distribution.grandTotal || 0))
    : 0;
  const activeRatio = distribution && Number(distribution.grandTotal || 0) > 0
    ? activeTotal / Number(distribution.grandTotal || 0)
    : 0;
  const centerLabel = activeSegmentKey ? formatFlowPct(activeRatio) : "100.00%";
  const bucketRows = distribution
    ? [
      { key: "large", label: "Large", inflow: Number(distribution.inflow.large || 0), outflow: Number(distribution.outflow.large || 0) },
      { key: "medium", label: "Medium", inflow: Number(distribution.inflow.medium || 0), outflow: Number(distribution.outflow.medium || 0) },
      { key: "small", label: "Small", inflow: Number(distribution.inflow.small || 0), outflow: Number(distribution.outflow.small || 0) },
    ]
    : [];

  return (
    <div
      style={{
        border: embedded ? "none" : `1px solid ${T.border}`,
        borderRadius: embedded ? 0 : 6,
        background: embedded ? "transparent" : "#ffffff",
        padding: embedded ? 0 : 6,
        marginBottom: embedded ? 0 : 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Order Flow Distribution</div>
        <div style={{ fontSize: 10, color: T.muted }}>Million USD</div>
      </div>

      {!distribution && (
        <div style={{ fontSize: 12, color: T.muted, padding: "8px 2px" }}>
          No tick-level order-flow data yet for {symbol}. Tick count: {tickCount}.
        </div>
      )}

      {distribution && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "1fr 126px" : "1fr 126px 1fr",
            gap: 6,
            alignItems: "start",
            marginBottom: 6,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 3 }}>Inflow</div>
            <div style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 700, color: FLOW_PALETTE.inflow.large, marginBottom: 5 }}>
              {formatFlowMillions(distribution.inflowTotal)}
            </div>
            {bucketRows.map((bucket) => {
              const active = isSpotFlowSegmentActive(`in-${bucket.key}`, activeSegmentKey);
              const dimmed = Boolean(activeSegmentKey) && !active;
              const ratio = distribution.grandTotal > 0 ? bucket.inflow / distribution.grandTotal : 0;
              return (
                <div
                  key={`in-${bucket.key}`}
                  onMouseEnter={() => setActiveSegmentKey(bucket.key)}
                  onMouseLeave={() => setActiveSegmentKey(null)}
                  style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 5, alignItems: "center", marginBottom: 4, opacity: dimmed ? 0.35 : 1, cursor: "pointer" }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: FLOW_PALETTE.inflow[bucket.key], display: "inline-block" }} />
                    <span style={{ fontSize: 11, color: T.text }}>
                      {bucket.label} <span style={{ color: T.muted }}>{formatFlowMillions(bucket.inflow)}({formatFlowPct(ratio)})</span>
                    </span>
                </div>
              );
            })}
          </div>

          <div style={{ justifySelf: "center", alignSelf: "center", marginTop: 0 }}>
            <svg width="126" height="120" viewBox="0 0 174 164" aria-label="Spot order-flow distribution donut">
              {donutSegments.map((segment) => {
                const active = isSpotFlowSegmentActive(segment.key, activeSegmentKey);
                const dimmed = Boolean(activeSegmentKey) && !active;
                return (
                  <path
                    key={segment.key}
                    d={segment.path}
                    fill={segment.color}
                    stroke={active ? `${T.text}55` : "transparent"}
                    strokeWidth={active ? 1.1 : 0}
                    style={{
                      cursor: "pointer",
                      opacity: dimmed ? 0.2 : 1,
                      transition: "opacity 120ms ease, stroke-width 120ms ease",
                    }}
                    onMouseEnter={() => setActiveSegmentKey(segment.key)}
                    onMouseLeave={() => setActiveSegmentKey(null)}
                  />
                );
              })}
              <circle cx="82" cy="82" r="31" fill="#f8fafc" />
              <text x="82" y="79" textAnchor="middle" fill={T.text} fontSize="11" fontWeight="700">
                {formatFlowMillions(activeTotal)}
              </text>
              <text x="82" y="92" textAnchor="middle" fill={T.muted} fontSize="8">
                {centerLabel}
              </text>
            </svg>
          </div>

          {!compact && (
            <div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 3, textAlign: "right" }}>Outflow</div>
            <div style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 700, color: FLOW_PALETTE.outflow.large, marginBottom: 5, textAlign: "right" }}>
              {formatFlowMillions(distribution.outflowTotal)}
            </div>
            {bucketRows.map((bucket) => {
              const active = isSpotFlowSegmentActive(`out-${bucket.key}`, activeSegmentKey);
              const dimmed = Boolean(activeSegmentKey) && !active;
              const ratio = distribution.grandTotal > 0 ? bucket.outflow / distribution.grandTotal : 0;
              return (
                <div
                  key={`out-${bucket.key}`}
                  onMouseEnter={() => setActiveSegmentKey(bucket.key)}
                  onMouseLeave={() => setActiveSegmentKey(null)}
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 5, alignItems: "center", marginBottom: 4, opacity: dimmed ? 0.35 : 1, cursor: "pointer" }}
                >
                  <span style={{ fontSize: 11, color: T.text, textAlign: "right" }}>
                    <span style={{ color: T.muted }}>{formatFlowMillions(bucket.outflow)}({formatFlowPct(ratio)})</span> {bucket.label}
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: FLOW_PALETTE.outflow[bucket.key], display: "inline-block" }} />
                </div>
              );
            })}
            </div>
          )}
        </div>
      )}

      {!compact && interactionState !== "resizing" && (
        <>
          <div style={{ borderTop: `1px solid ${T.border}`, marginBottom: 6 }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Large Scale Orders in Last 5 Days</div>
            <div style={{ fontSize: 10, color: T.muted }}>Million USD</div>
          </div>

          <div style={{ position: "relative", height: 118, borderRadius: 6, padding: "8px 4px 6px", background: "#ffffff" }}>
            <div
              style={{
                position: "absolute",
                left: 4,
                right: 4,
                top: "50%",
                borderTop: `1px solid ${T.border}`,
              }}
            />
            <div style={{ height: "100%", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {bars.length === 0 && (
                <div style={{ gridColumn: "1 / -1", alignSelf: "center", textAlign: "center", fontSize: 12, color: T.muted }}>
                  Waiting for order-flow snapshots...
                </div>
              )}
              {bars.map((row) => {
                const value = Number(row?.signedLargeNotional || 0);
                const magnitude = Math.min(1, Math.abs(value) / maxAbsBar);
                const barHeight = Math.max(4, Math.round(magnitude * 40));
                const positive = value >= 0;
                const label = formatFlowSampleLabel(row?.timestamp);
                return (
                  <div key={row.timestamp} style={{ position: "relative", display: "grid", alignItems: "end", justifyItems: "center" }}>
                    <div
                      style={{
                        position: "absolute",
                        bottom: positive ? "50%" : "auto",
                        top: positive ? "auto" : "50%",
                        width: 14,
                        height: barHeight,
                        borderRadius: 4,
                        background: positive ? FLOW_PALETTE.inflow.large : FLOW_PALETTE.outflow.large,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: positive ? `calc(50% - ${barHeight + 15}px)` : `calc(50% + ${barHeight + 3}px)`,
                        fontSize: 10,
                        color: positive ? FLOW_PALETTE.inflow.large : FLOW_PALETTE.outflow.large,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatFlowMillionsSigned(value)}
                    </div>
                    <div style={{ position: "absolute", bottom: 1, fontSize: 10, color: T.muted }}>
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OptionsOrderFlowDistributionCard({
  distribution,
  expiry,
  availableExpiries = [],
  onExpiryChange,
  embedded = false,
  compact = false,
  interactionState = "idle",
}) {
  const [activeKey, setActiveKey] = useState(null);
  const segments = buildOptionsVolumeDonutSegments(distribution);
  const totalVolume = Number(distribution?.totalVolume || 0);
  const totalOpenInterest = Number(distribution?.totalOpenInterest || 0);
  const callVolume = Number(distribution?.call?.totalVolume || 0);
  const putVolume = Number(distribution?.put?.totalVolume || 0);
  const callOpenInterest = Number(distribution?.call?.totalOpenInterest || 0);
  const putOpenInterest = Number(distribution?.put?.totalOpenInterest || 0);
  const activeSegments = segments.filter((segment) => isOptionsFlowSegmentActive(segment.key, activeKey));
  const activeVolume = activeSegments.length
    ? activeSegments.reduce((sum, row) => sum + Number(row.value || 0), 0)
    : totalVolume;
  const activeRatio = totalVolume > 0 ? activeVolume / totalVolume : 0;
  const centerLabel = activeKey
    ? `${formatFlowPct(activeRatio)}`
    : "100.00%";
  const bucketRows = distribution
    ? OPTIONS_VOLUME_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      call: Number(distribution.call[bucket.key] || 0),
      put: Number(distribution.put[bucket.key] || 0),
    }))
    : [];

  return (
    <div
      style={{
        border: embedded ? "none" : `1px solid ${T.border}`,
        borderRadius: embedded ? 0 : 6,
        background: embedded ? "transparent" : "#ffffff",
        padding: embedded ? 0 : 6,
        marginBottom: embedded ? 0 : 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Options Flow Distribution</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 10, color: T.muted }}>Contracts</div>
          <select
            value={expiry}
            onChange={(event) => onExpiryChange && onExpiryChange(event.target.value)}
            style={{
              ...selectStyle,
              width: "auto",
              minWidth: 104,
              padding: "4px 7px",
              fontSize: 11,
            }}
          >
            {availableExpiries.map((value) => (
              <option key={value} value={value}>
                {formatExpiryChipLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11, color: T.muted }}>Options Total Volume</div>
          <div style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 700 }}>{formatOptionCountCompact(totalVolume)}</div>
        </div>
        <div style={{ textAlign: compact ? "left" : "right" }}>
          <div style={{ fontSize: 11, color: T.muted }}>Options Total Open Int.</div>
          <div style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 700 }}>{formatOptionCountCompact(totalOpenInterest)}</div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.border}`, marginBottom: 6 }} />
      {!distribution && (
        <div style={{ fontSize: 12, color: T.muted, padding: "8px 2px" }}>
          No option volume data available for the selected expiry.
        </div>
      )}
      {distribution && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "1fr 126px" : "1fr 126px 1fr",
            gap: 6,
            alignItems: "start",
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 3 }}>Calls</div>
            <div style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 700, color: OPTIONS_FLOW_PALETTE.call.askOrAbove, marginBottom: 3 }}>
              {formatOptionCountCompact(callVolume)}
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 5 }}>
              OI {formatOptionCountCompact(callOpenInterest)}
            </div>

            {bucketRows.map((bucket) => {
              const active = isOptionsFlowSegmentActive(`call-${bucket.key}`, activeKey);
              const dimmed = Boolean(activeKey) && !active;
              return (
                <div
                  key={bucket.key}
                  onMouseEnter={() => setActiveKey(bucket.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: 5,
                    alignItems: "center",
                    marginBottom: 4,
                    opacity: dimmed ? 0.35 : 1,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: OPTIONS_FLOW_PALETTE.call[bucket.key], display: "inline-block" }} />
                  <span style={{ fontSize: 11, color: T.text, whiteSpace: "nowrap" }}>
                    {bucket.label} <span style={{ color: T.muted }}>{formatOptionCountCompact(bucket.call)}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ justifySelf: "center", alignSelf: "center", marginTop: 0 }}>
            <svg width="126" height="120" viewBox="0 0 174 164" aria-label="Options volume distribution donut">
              {segments.map((segment) => {
                const active = isOptionsFlowSegmentActive(segment.key, activeKey);
                const dimmed = Boolean(activeKey) && !active;
                return (
                  <path
                    key={segment.key}
                    d={segment.path}
                    fill={segment.color}
                    stroke={active ? `${T.text}55` : "transparent"}
                    strokeWidth={active ? 1.2 : 0}
                    style={{
                      cursor: "pointer",
                      opacity: dimmed ? 0.25 : 1,
                      transition: "opacity 120ms ease, stroke-width 120ms ease",
                    }}
                    onMouseEnter={() => setActiveKey(segment.key)}
                    onMouseLeave={() => setActiveKey(null)}
                  />
                );
              })}
              <circle cx="82" cy="82" r="31" fill="#f8fafc" />
              <text x="82" y="79" textAnchor="middle" fill={T.text} fontSize="11" fontWeight="700">
                {formatOptionCountCompact(activeVolume)}
              </text>
              <text x="82" y="92" textAnchor="middle" fill={T.muted} fontSize="8">
                {centerLabel}
              </text>
            </svg>
          </div>

          {!compact && interactionState !== "resizing" && (
            <div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 3, textAlign: "right" }}>Puts</div>
            <div style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 700, color: OPTIONS_FLOW_PALETTE.put.askOrAbove, marginBottom: 3, textAlign: "right" }}>
              {formatOptionCountCompact(putVolume)}
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 5, textAlign: "right" }}>
              OI {formatOptionCountCompact(putOpenInterest)}
            </div>

            {bucketRows.map((bucket) => {
              const active = isOptionsFlowSegmentActive(`put-${bucket.key}`, activeKey);
              const dimmed = Boolean(activeKey) && !active;
              return (
                <div
                  key={`put-${bucket.key}`}
                  onMouseEnter={() => setActiveKey(bucket.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 5,
                    alignItems: "center",
                    marginBottom: 4,
                    opacity: dimmed ? 0.35 : 1,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 11, color: T.text, textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ color: T.muted }}>{formatOptionCountCompact(bucket.put)}</span> {bucket.label}
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: OPTIONS_FLOW_PALETTE.put[bucket.key], display: "inline-block" }} />
                </div>
              );
            })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        background: T.card2,
        padding: "5px 7px",
        display: "grid",
        gap: 1,
      }}
    >
      <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || T.text }}>{value}</div>
    </div>
  );
}

function SpotQuoteCell({ quote }) {
  const last = Number(quote?.last);
  const changePct = Number(quote?.changePct);
  const hasChange = Number.isFinite(changePct);

  return (
    <div style={{ ...inputStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span>{Number.isFinite(last) ? money(last) : "--"}</span>
      <span style={{ color: hasChange ? (changePct >= 0 ? T.green : T.red) : T.muted, fontSize: 11 }}>
        {hasChange ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "--"}
      </span>
    </div>
  );
}

function OrderFlowCell({ orderFlow }) {
  const score = Number(orderFlow?.score);
  const buyPct = Number(orderFlow?.metrics?.aggressorBuyPct);
  const hasScore = Number.isFinite(score);
  const hasBuyPct = Number.isFinite(buyPct);
  const tone = orderFlowTone(score, T);

  return (
    <div style={{ ...inputStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: hasScore ? tone : T.muted, fontWeight: 700 }}>
        {hasScore ? score.toFixed(2) : "--"}
      </span>
      <span style={{ color: hasBuyPct ? tone : T.muted, fontSize: 11 }}>
        {hasBuyPct ? `${buyPct.toFixed(1)}% buy` : "--"}
      </span>
    </div>
  );
}

function orderFlowTone(score, palette) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return palette.muted;
  }
  if (numeric >= 0.15) {
    return palette.green;
  }
  if (numeric <= -0.15) {
    return palette.red;
  }
  return palette.blue;
}

function workspaceAuthTone(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "authenticated") {
    return T.green;
  }
  if (normalized === "mixed" || normalized === "needs_login" || normalized === "needs_token" || normalized === "needs_refresh") {
    return T.amber;
  }
  if (normalized === "degraded" || normalized === "error") {
    return T.red;
  }
  return T.muted;
}

const FLOW_PALETTE = {
  inflow: {
    large: "#07b17f",
    medium: "#39c392",
    small: "#8ddfbf",
  },
  outflow: {
    large: "#e8a52b",
    medium: "#efc16d",
    small: "#f4ddb0",
  },
};

const OPTIONS_VOLUME_BUCKETS = [
  { key: "askOrAbove", label: "Ask" },
  { key: "bidOrBelow", label: "Bid" },
  { key: "between", label: "Mid" },
];

const OPTIONS_FLOW_PALETTE = {
  call: {
    askOrAbove: FLOW_PALETTE.inflow.large,
    bidOrBelow: FLOW_PALETTE.inflow.medium,
    between: FLOW_PALETTE.inflow.small,
  },
  put: {
    askOrAbove: FLOW_PALETTE.outflow.large,
    bidOrBelow: FLOW_PALETTE.outflow.medium,
    between: FLOW_PALETTE.outflow.small,
  },
};

function appendOrderFlowSample(history, orderFlow) {
  const rows = Array.isArray(history) ? [...history] : [];
  const timestamp = String(orderFlow?.timestamp || new Date().toISOString());
  const signedLargeNotional = extractLargeNotionalFromTicks(orderFlow?.ticks?.ticks || []);
  const safeScore = Number(orderFlow?.score);
  rows.push({
    timestamp,
    signedLargeNotional: Number.isFinite(signedLargeNotional) ? signedLargeNotional : 0,
    score: Number.isFinite(safeScore) ? safeScore : 0,
  });
  const deduped = [];
  const seen = new Set();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const key = `${row.timestamp}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= 80) {
      break;
    }
  }
  return deduped.reverse();
}

function extractLargeNotionalFromTicks(ticks) {
  let total = 0;
  for (const tick of Array.isArray(ticks) ? ticks : []) {
    const size = Number(tick?.size || tick?.volume || 0);
    const price = Number(tick?.price || 0);
    if (!Number.isFinite(size) || !Number.isFinite(price) || size < 150) {
      continue;
    }
    const notional = Math.abs(size * price);
    if (isSellAggressorSide(tick?.side)) {
      total -= notional;
    } else {
      total += notional;
    }
  }
  return total;
}

function buildOrderFlowDistribution(orderFlow) {
  const ticks = orderFlow?.ticks?.ticks || [];
  if (!Array.isArray(ticks) || ticks.length === 0) {
    return null;
  }

  const inflow = { large: 0, medium: 0, small: 0 };
  const outflow = { large: 0, medium: 0, small: 0 };

  for (const tick of ticks) {
    const size = Number(tick?.size || tick?.volume || 0);
    const price = Number(tick?.price || 0);
    if (!Number.isFinite(size) || !Number.isFinite(price) || size <= 0) {
      continue;
    }
    const notional = Math.abs(size * price);
    const bucket = size >= 150 ? "large" : size >= 75 ? "medium" : "small";
    if (isSellAggressorSide(tick?.side)) {
      outflow[bucket] += notional;
    } else {
      inflow[bucket] += notional;
    }
  }

  const inflowTotal = inflow.large + inflow.medium + inflow.small;
  const outflowTotal = outflow.large + outflow.medium + outflow.small;
  const grandTotal = inflowTotal + outflowTotal;
  if (grandTotal <= 0) {
    return null;
  }

  return {
    inflow,
    outflow,
    inflowTotal,
    outflowTotal,
    grandTotal,
  };
}

function isSellAggressorSide(side) {
  const normalized = String(side || "").trim().toLowerCase();
  return normalized.startsWith("sell")
    || normalized === "s"
    || normalized === "2"
    || normalized === "ask";
}

function buildOrderFlowSegmentStats(distribution) {
  if (!distribution) {
    return {};
  }
  const total = Number(distribution.grandTotal || 0);
  const rows = [
    { key: "in-large", label: "In Large", color: FLOW_PALETTE.inflow.large, value: distribution.inflow.large },
    { key: "in-medium", label: "In Medium", color: FLOW_PALETTE.inflow.medium, value: distribution.inflow.medium },
    { key: "in-small", label: "In Small", color: FLOW_PALETTE.inflow.small, value: distribution.inflow.small },
    { key: "out-large", label: "Out Large", color: FLOW_PALETTE.outflow.large, value: distribution.outflow.large },
    { key: "out-medium", label: "Out Medium", color: FLOW_PALETTE.outflow.medium, value: distribution.outflow.medium },
    { key: "out-small", label: "Out Small", color: FLOW_PALETTE.outflow.small, value: distribution.outflow.small },
  ];
  const out = {};
  for (const row of rows) {
    const numeric = Math.max(0, Number(row.value || 0));
    out[row.key] = {
      ...row,
      value: numeric,
      ratio: total > 0 ? numeric / total : 0,
    };
  }
  return out;
}

function buildOrderFlowDonutSegments(distribution) {
  if (!distribution) {
    return [];
  }
  const rows = Object.values(buildOrderFlowSegmentStats(distribution));
  const total = distribution.grandTotal;
  if (total <= 0) {
    return [];
  }

  let start = 0;
  const segments = [];
  for (const row of rows) {
    const value = Math.max(0, Number(row.value || 0));
    if (value <= 0) {
      continue;
    }
    const sweep = (value / total) * 360;
    const end = start + sweep;
    segments.push({
      key: row.key,
      color: row.color,
      label: row.label,
      value,
      ratio: value / total,
      midAngle: start + sweep / 2,
      path: donutSegmentPath({
        cx: 82,
        cy: 82,
        outerRadius: 55,
        innerRadius: 36,
        startAngle: start,
        endAngle: end,
      }),
    });
    start = end;
  }
  return segments;
}

function isSpotFlowSegmentActive(segmentKey, activeKey) {
  if (!activeKey) {
    return true;
  }
  if (activeKey === segmentKey) {
    return true;
  }
  const bucket = String(segmentKey).split("-").slice(1).join("-");
  return activeKey === bucket;
}

function buildOptionsVolumeDistribution(rows) {
  const data = {
    call: {
      totalVolume: 0,
      totalOpenInterest: 0,
      askOrAbove: 0,
      bidOrBelow: 0,
      between: 0,
    },
    put: {
      totalVolume: 0,
      totalOpenInterest: 0,
      askOrAbove: 0,
      bidOrBelow: 0,
      between: 0,
    },
  };

  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const side = String(row?.right || "").toLowerCase() === "put" ? "put" : "call";
    const volume = Math.max(0, Number(row?.volume || 0));
    const oi = Math.max(0, Number(row?.oi || 0));
    if (Number.isFinite(oi) && oi > 0) {
      data[side].totalOpenInterest += oi;
    }
    if (!Number.isFinite(volume) || volume <= 0) {
      continue;
    }
    data[side].totalVolume += volume;
    const bucket = classifyOptionVolumeBucket(row);
    data[side][bucket] += volume;
  }

  const totalVolume = data.call.totalVolume + data.put.totalVolume;
  const totalOpenInterest = data.call.totalOpenInterest + data.put.totalOpenInterest;
  if (totalVolume <= 0 && totalOpenInterest <= 0) {
    return null;
  }

  return {
    ...data,
    totalVolume,
    totalOpenInterest,
  };
}

function classifyOptionVolumeBucket(row) {
  const bid = Number(row?.bid);
  const ask = Number(row?.ask);
  const last = Number.isFinite(Number(row?.last)) ? Number(row.last) : Number(row?.mark);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(last)) {
    return "between";
  }
  const mid = (bid + ask) / 2;
  const spread = Math.max(0, ask - bid);
  const tolerance = Math.max(0.005, spread * 0.15);
  if (last >= ask - tolerance || last > mid + tolerance) {
    return "askOrAbove";
  }
  if (last <= bid + tolerance || last < mid - tolerance) {
    return "bidOrBelow";
  }
  return "between";
}

function getOptionsVolumeSegmentRows(distribution) {
  if (!distribution) {
    return [];
  }
  const total = Number(distribution.totalVolume || 0);
  const rows = [
    { key: "call-askOrAbove", label: "Calls Ask or Above", color: OPTIONS_FLOW_PALETTE.call.askOrAbove, value: distribution.call.askOrAbove },
    { key: "call-bidOrBelow", label: "Calls Bid or Below", color: OPTIONS_FLOW_PALETTE.call.bidOrBelow, value: distribution.call.bidOrBelow },
    { key: "call-between", label: "Calls Between Bid&Ask", color: OPTIONS_FLOW_PALETTE.call.between, value: distribution.call.between },
    { key: "put-askOrAbove", label: "Puts Ask or Above", color: OPTIONS_FLOW_PALETTE.put.askOrAbove, value: distribution.put.askOrAbove },
    { key: "put-bidOrBelow", label: "Puts Bid or Below", color: OPTIONS_FLOW_PALETTE.put.bidOrBelow, value: distribution.put.bidOrBelow },
    { key: "put-between", label: "Puts Between Bid&Ask", color: OPTIONS_FLOW_PALETTE.put.between, value: distribution.put.between },
  ];
  return rows.map((row) => {
    const value = Math.max(0, Number(row.value || 0));
    return {
      ...row,
      value,
      ratio: total > 0 ? value / total : 0,
    };
  });
}

function buildOptionsVolumeDonutSegments(distribution) {
  if (!distribution) {
    return [];
  }
  const rows = getOptionsVolumeSegmentRows(distribution);
  const total = Number(distribution.totalVolume || 0);
  if (total <= 0) {
    return [];
  }

  let start = 0;
  const segments = [];
  for (const row of rows) {
    if (row.value <= 0) {
      continue;
    }
    const sweep = (row.value / total) * 360;
    const end = start + sweep;
    segments.push({
      key: row.key,
      color: row.color,
      value: row.value,
      ratio: row.ratio,
      label: row.label,
      midAngle: start + sweep / 2,
      path: donutSegmentPath({
        cx: 85,
        cy: 85,
        outerRadius: 55,
        innerRadius: 36,
        startAngle: start,
        endAngle: end,
      }),
    });
    start = end;
  }
  return segments;
}

function isOptionsFlowSegmentActive(segmentKey, activeKey) {
  if (!activeKey) {
    return true;
  }
  if (activeKey === segmentKey) {
    return true;
  }
  const bucket = String(segmentKey).split("-").slice(1).join("-");
  return activeKey === bucket;
}

function buildDonutCallouts(segments, { cx, cy, outerRadius }) {
  const out = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const angle = Number(segment.midAngle);
    if (!Number.isFinite(angle)) {
      continue;
    }
    const from = polarToCartesian(cx, cy, outerRadius + 2, angle);
    const bend = polarToCartesian(cx, cy, outerRadius + 14, angle);
    const toRight = bend.x >= cx;
    const end = {
      x: bend.x + (toRight ? 11 : -11),
      y: bend.y,
    };
    out.push({
      key: segment.key,
      color: segment.color,
      ratio: segment.ratio,
      path: `M ${from.x} ${from.y} L ${bend.x} ${bend.y} L ${end.x} ${end.y}`,
      textX: end.x + (toRight ? 2 : -2),
      textY: end.y + 3,
      anchor: toRight ? "start" : "end",
    });
  }
  return out;
}

function buildOptionsDonutCallouts(segments, { cx, cy, outerRadius }) {
  return buildDonutCallouts(segments, { cx, cy, outerRadius });
}

function donutSegmentPath({ cx, cy, outerRadius, innerRadius, startAngle, endAngle }) {
  const startOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(cx, cy, radius, angle) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function formatFlowPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0.00%";
  }
  return `${(numeric * 100).toFixed(2)}%`;
}

function formatUsdFull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUsdCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000) {
    return `${numeric >= 0 ? "" : "-"}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${numeric >= 0 ? "" : "-"}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${numeric.toFixed(0)}`;
}

function formatFlowSampleLabel(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function pickPreferredAccountId(rows, options = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) {
    return null;
  }

  const preferBroker = String(options.preferBroker || "").trim().toLowerCase();
  const preferBrokers = Array.isArray(options.preferBrokers)
    ? options.preferBrokers
      .map((broker) => String(broker || "").trim().toLowerCase())
      .filter(Boolean)
    : [];
  const requireConnected = Boolean(options.requireConnected);
  const requiredCapability = String(options.requiredCapability || "").trim().toLowerCase();
  const scoped = requiredCapability === "trading"
    ? list.filter((row) => isTradingReadyAccount(row))
    : requiredCapability === "marketdata"
      ? list.filter((row) => isMarketDataReadyAccount(row))
      : requireConnected
        ? list.filter((row) => isTradingReadyAccount(row))
        : list;
  const connected = requireConnected
    ? list.filter((row) => isConnectedAccount(row))
    : list;
  const pool = scoped.length ? scoped : (connected.length ? connected : list);

  for (const broker of preferBrokers) {
    const match = pool.find((row) => String(row?.broker || "").toLowerCase() === broker);
    if (match?.accountId) {
      return String(match.accountId);
    }
  }

  if (preferBroker) {
    const match = pool.find((row) => String(row?.broker || "").toLowerCase() === preferBroker);
    if (match?.accountId) {
      return String(match.accountId);
    }
  }

  if (pool[0]?.accountId) {
    return String(pool[0].accountId);
  }
  return null;
}

const cellStyle = {
  padding: "5px 3px",
  whiteSpace: "nowrap",
};

const labelStyle = {
  fontSize: 12,
  color: T.muted,
  display: "grid",
  gap: 4,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "#ffffff",
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: "7px 8px",
  fontSize: 12,
};

const selectStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "#ffffff",
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: "7px 8px",
  fontSize: 12,
};

const chainToolbarButtonStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  background: "#ffffff",
  color: T.text,
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
};

const chainToolbarSelectStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  background: "#ffffff",
  color: T.text,
  fontSize: 12,
  padding: "4px 7px",
  cursor: "pointer",
};

const widgetShellStyle = {
  position: "relative",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const widgetBodyStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  userSelect: "text",
};

const widgetHandleStyle = {
  position: "absolute",
  top: 4,
  right: 6,
  width: 22,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: 0.2,
  color: "#075985",
  background: "#e0f2fe",
  border: "1px solid #7dd3fc",
  borderRadius: 6,
  cursor: "grab",
  padding: 0,
  appearance: "none",
  WebkitAppearance: "none",
  touchAction: "none",
  userSelect: "none",
  zIndex: 8,
};

const widgetRemoveButtonStyle = {
  position: "absolute",
  top: 4,
  right: 32,
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  lineHeight: 1,
  color: T.red,
  background: "#fff5f5",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  cursor: "pointer",
  padding: 0,
  appearance: "none",
  WebkitAppearance: "none",
  userSelect: "none",
  zIndex: 8,
};

const MARKET_DASHBOARD_GRID_CSS = `
  .market-dashboard-grid .market-dashboard-widget {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    container-type: inline-size;
  }

  .market-dashboard-grid .market-dashboard-widget > * {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .market-dashboard-grid .market-dashboard-widget[data-profile="xs"] .adaptive-hide-xs {
    display: none !important;
  }

  .market-dashboard-grid .market-dashboard-widget[data-profile="sm"] .adaptive-hide-sm,
  .market-dashboard-grid .market-dashboard-widget[data-profile="xs"] .adaptive-hide-sm {
    display: none !important;
  }

  @container (max-width: 420px) {
    .market-widget-panel .adaptive-controls-grid {
      grid-template-columns: 1fr !important;
    }
  }

  .market-dashboard-grid .workspace-grid-body > * {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    box-shadow: none;
  }

  .market-dashboard-grid .workspace-grid-body {
    overflow: hidden;
  }

  .market-dashboard-grid .react-grid-item {
    transition: box-shadow 120ms ease, transform 120ms ease;
    overflow: hidden;
  }

  .market-dashboard-grid .react-grid-item.react-draggable-dragging {
    z-index: 18 !important;
  }

  .market-dashboard-grid .react-grid-item.react-draggable-dragging .workspace-grid-body > * {
    box-shadow: none;
    outline: 2px solid rgba(2, 132, 199, 0.35);
    outline-offset: -1px;
    border-radius: 8px;
  }

  .market-dashboard-grid .react-grid-placeholder {
    background: rgba(2, 132, 199, 0.14) !important;
    border: 1px dashed rgba(2, 132, 199, 0.6) !important;
    border-radius: 8px !important;
    opacity: 1 !important;
  }

  .market-dashboard-grid .react-resizable-handle {
    width: 14px;
    height: 14px;
  }

  .market-dashboard-grid .react-resizable-handle::after {
    border-right: 2px solid #94a3b8;
    border-bottom: 2px solid #94a3b8;
  }

  .market-dashboard-grid .workspace-grid-handle:focus-visible {
    outline: 2px solid #0284c7;
    outline-offset: 1px;
  }
`;

function cardStyle() {
  return {
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    overflow: "hidden",
    padding: 8,
  };
}

function orderFlowModuleGridStyle(options = {}) {
  const compact = Boolean(options?.compact);
  const shape = String(options?.shape || "square");
  const singleColumn = compact || shape === "tall";
  return {
    display: "grid",
    gridTemplateColumns: singleColumn ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 10,
    alignItems: "start",
  };
}

function orderFlowModuleContainerStyle() {
  return {
    border: `1px solid ${T.border}`,
    borderRadius: 6,
    background: "#ffffff",
    padding: 6,
  };
}

function orderFlowModulePanelStyle() {
  return {
    minWidth: 0,
    minHeight: 0,
  };
}

function chainActionButtonStyle(variant) {
  return {
    ...btnStyle(variant),
    padding: "4px 6px",
    fontSize: 11,
    borderRadius: 4,
  };
}

function btnStyle(variant) {
  const base = {
    border: "none",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    padding: "7px 9px",
    cursor: "pointer",
  };

  if (variant === "primary") {
    return {
      ...base,
      background: `${T.accent}20`,
      color: T.accent,
      border: `1px solid ${T.accent}55`,
    };
  }

  if (variant === "success") {
    return {
      ...base,
      background: `${T.green}1c`,
      color: T.green,
      border: `1px solid ${T.green}55`,
    };
  }

  if (variant === "danger") {
    return {
      ...base,
      background: `${T.red}18`,
      color: T.red,
      border: `1px solid ${T.red}50`,
    };
  }

  return {
    ...base,
    background: "transparent",
    color: T.muted,
    border: `1px solid ${T.border}`,
  };
}

function nextFridays(count) {
  const out = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);

  while (out.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() === 5) {
      out.push(cursor.toISOString().slice(0, 10));
    }
  }

  return out;
}

function money(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function formatWorkspaceTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "--";
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    return text;
  }
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCompactMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000_000) {
    return `${numeric < 0 ? "-" : ""}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${numeric < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${numeric < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${numeric < 0 ? "-" : ""}$${abs.toFixed(0)}`;
}

function formatAuthStateAbbrev(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "UNK";
  }
  if (normalized === "authenticated" || normalized === "connected") {
    return "AUTH";
  }
  if (normalized === "degraded" || normalized === "disconnected" || normalized === "error") {
    return "DEG";
  }
  if (normalized === "mixed") {
    return "MIX";
  }
  if (normalized === "pending") {
    return "PEND";
  }
  return normalized.slice(0, 4).toUpperCase();
}

function formatBrokerAbbrev(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "--";
  }
  if (normalized === "etrade") {
    return "ET";
  }
  if (normalized === "webull") {
    return "WB";
  }
  if (normalized === "ibkr") {
    return "IB";
  }
  if (normalized === "combined") {
    return "ALL";
  }
  return normalized.slice(0, 3).toUpperCase();
}

function formatMarketDashboardAccountLabel(account) {
  if (!account || typeof account !== "object") {
    return "--";
  }
  const accountId = String(account.accountId || "").trim();
  if (accountId === "all") {
    return "ALL";
  }
  const label = String(account.label || "").trim();
  if (!label) {
    return accountId || "--";
  }
  if (label.length <= 14) {
    return label;
  }
  return `${label.slice(0, 11)}...`;
}

const DEFAULT_WIDGET_ADAPTIVE = {
  profile: "md",
  shape: "square",
  widthUnits: 4,
  heightUnits: 10,
  widthPx: 560,
  heightPx: 320,
};

const PORTFOLIO_TABLE_COLUMNS = {
  acct: { key: "acct", label: "Acct" },
  brk: { key: "brk", label: "Brk" },
  auth: { key: "auth", label: "Auth" },
  eq: { key: "eq", label: "Eq" },
  cash: { key: "cash", label: "Cash" },
  mkt: { key: "mkt", label: "Mkt" },
  upnl: { key: "upnl", label: "UPNL" },
  pos: { key: "pos", label: "Pos" },
};

function getPortfolioColumnKeysForProfile(profile) {
  const normalized = String(profile || "").toLowerCase();
  if (normalized === "xs") {
    return ["acct", "eq", "pos"];
  }
  if (normalized === "sm") {
    return ["acct", "brk", "auth", "eq", "pos"];
  }
  if (normalized === "md") {
    return ["acct", "brk", "auth", "eq", "cash", "upnl", "pos"];
  }
  return ["acct", "brk", "auth", "eq", "cash", "mkt", "upnl", "pos"];
}

function renderPortfolioColumnValue(columnKey, account, options = {}) {
  const selected = Boolean(options?.selected);
  const onSelect = typeof options?.onSelect === "function" ? options.onSelect : null;
  const borderColor = String(options?.borderColor || "#d6e0ea");
  const accent = String(options?.accent || "#0284c7");
  const text = String(options?.text || "#0f172a");
  switch (columnKey) {
    case "acct":
      return (
        <button
          type="button"
          onClick={() => onSelect && onSelect(account.accountId)}
          style={{
            display: "inline-block",
            textAlign: "left",
            border: `1px solid ${selected ? `${accent}66` : borderColor}`,
            borderRadius: 6,
            background: selected ? `${accent}12` : "#ffffff",
            color: selected ? accent : text,
            padding: "2px 5px",
            fontSize: 9.5,
            fontWeight: 700,
            whiteSpace: "nowrap",
            cursor: "pointer",
            maxWidth: 118,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`Select ${account.label}`}
        >
          {formatMarketDashboardAccountLabel(account)}
        </button>
      );
    case "brk":
      return formatBrokerAbbrev(account.broker);
    case "auth":
      return formatAuthStateAbbrev(account.authState);
    case "eq":
      return formatCompactMoney(account.equity);
    case "cash":
      return formatCompactMoney(account.cash);
    case "mkt":
      return formatCompactMoney(account.marketValue);
    case "upnl":
      return formatCompactMoney(account.unrealizedPnl);
    case "pos":
      return String(account.positions || 0);
    default:
      return "--";
  }
}

function buildWidgetAdaptiveProfileMap(layoutRows, options = {}) {
  const rows = Array.isArray(layoutRows) ? layoutRows : [];
  const containerWidth = Math.max(320, Number(options?.containerWidth || 1280));
  const cols = Math.max(1, Number(options?.cols || 12));
  const rowHeight = Math.max(1, Number(options?.rowHeight || GRID_ROW_HEIGHT));
  const marginPair = Array.isArray(options?.margin) ? options.margin : GRID_MARGIN_DEFAULT;
  const marginX = Math.max(0, Number(marginPair[0] || 0));
  const marginY = Math.max(0, Number(marginPair[1] || 0));
  const containerPaddingPair = Array.isArray(options?.containerPadding)
    ? options.containerPadding
    : GRID_CONTAINER_PADDING;
  const paddingX = Math.max(0, Number(containerPaddingPair[0] || 0));
  const availableWidth = Math.max(
    cols,
    containerWidth - (paddingX * 2) - (Math.max(0, cols - 1) * marginX),
  );
  const colWidth = availableWidth / cols;
  const out = {};
  for (const row of rows) {
    const widgetId = String(row?.i || "").trim();
    if (!widgetId) {
      continue;
    }
    const widthUnits = Math.max(1, Number(row?.w || 1));
    const heightUnits = Math.max(1, Number(row?.h || 1));
    const widthPx = Math.round((widthUnits * colWidth) + (Math.max(0, widthUnits - 1) * marginX));
    const heightPx = Math.round((heightUnits * rowHeight) + (Math.max(0, heightUnits - 1) * marginY));
    const areaUnits = widthUnits * heightUnits;
    const ratio = widthPx / Math.max(1, heightPx);
    const profile = deriveAdaptiveProfile({
      widthPx,
      heightPx,
      areaUnits,
      widthUnits,
      heightUnits,
    });

    let shape = "square";
    if (ratio >= 1.45) {
      shape = "wide";
    } else if (ratio <= 0.82) {
      shape = "tall";
    }

    out[widgetId] = {
      profile,
      shape,
      widthUnits,
      heightUnits,
      widthPx,
      heightPx,
    };
  }
  return out;
}

function deriveAdaptiveProfile(metrics = {}) {
  const widthPx = Math.max(1, Number(metrics?.widthPx || 0));
  const heightPx = Math.max(1, Number(metrics?.heightPx || 0));
  const areaUnits = Math.max(1, Number(metrics?.areaUnits || 1));
  const widthUnits = Math.max(1, Number(metrics?.widthUnits || 1));
  const heightUnits = Math.max(1, Number(metrics?.heightUnits || 1));

  if (widthPx < 360 || heightPx < 220 || areaUnits <= 18 || widthUnits <= 2 || heightUnits <= 6) {
    return "xs";
  }
  if (widthPx < 520 || heightPx < 260 || areaUnits <= 34 || widthUnits <= 3 || heightUnits <= 8) {
    return "sm";
  }
  if (widthPx < 760 || heightPx < 320 || areaUnits <= 60 || widthUnits <= 5 || heightUnits <= 11) {
    return "md";
  }
  return "lg";
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
}

function computeAdaptiveChartHeight(adaptiveState, options = {}) {
  const state = adaptiveState && typeof adaptiveState === "object"
    ? adaptiveState
    : DEFAULT_WIDGET_ADAPTIVE;
  const profile = String(state.profile || "md");
  const shape = String(state.shape || "square");
  const minHeight = Math.max(140, Number(options.min ?? 180));
  const maxHeight = Math.max(minHeight, Number(options.max ?? 560));
  const chromeOffset = Math.max(0, Number(options.chromeOffset ?? 140));
  let base = Number(options[profile] ?? options.md ?? 360);
  if (shape === "tall") {
    base *= 1.1;
  } else if (shape === "wide") {
    base *= 0.92;
  }
  const containerHeight = Number(state?.heightPx);
  if (Number.isFinite(containerHeight) && containerHeight > chromeOffset + 120) {
    const available = containerHeight - chromeOffset;
    base = Math.min(base, available);
  }
  return Math.round(clampNumber(base, minHeight, maxHeight));
}

function formatOrderTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "--";
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    return text;
  }
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function orderStatusTone(order, theme = T) {
  const status = String(order?.status || "").toLowerCase();
  if (status === "filled") {
    return theme.green;
  }
  if (status === "rejected" || status === "cancelled" || status === "canceled") {
    return theme.red;
  }
  if (status === "submitted" || status === "partial_fill" || status === "partial") {
    return theme.amber;
  }
  return theme.muted;
}

function buildOptionContractId(symbol, expiry, strike, right) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedExpiry = String(expiry || "").trim();
  const normalizedRight = String(right || "").trim().toLowerCase();
  const normalizedStrike = Number(strike);
  if (
    !normalizedSymbol
    || !normalizedExpiry
    || !Number.isFinite(normalizedStrike)
    || normalizedStrike <= 0
    || (normalizedRight !== "call" && normalizedRight !== "put")
  ) {
    return null;
  }
  return `${normalizedSymbol}-${normalizedExpiry}-${Number(normalizedStrike).toString()}-${normalizedRight}`;
}

function buildOptionChainGrid(rows, underlyingPrice) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const strike = Number(row?.strike);
    if (!Number.isFinite(strike)) {
      continue;
    }
    const key = strike;
    const existing = map.get(key) || { strike: key, call: null, put: null };
    const side = String(row?.right || "").toLowerCase();
    if (side === "put") {
      existing.put = row;
    } else {
      existing.call = row;
    }
    map.set(key, existing);
  }

  const merged = [...map.values()].sort((a, b) => Number(a.strike) - Number(b.strike));
  if (!merged.length) {
    return { rows: [], dividerAfterIndex: null };
  }

  const under = Number(underlyingPrice);
  let dividerAfterIndex = null;
  if (Number.isFinite(under) && merged.length > 0) {
    for (let index = 0; index < merged.length - 1; index += 1) {
      const current = Number(merged[index].strike);
      const next = Number(merged[index + 1].strike);
      if (current <= under && next > under) {
        dividerAfterIndex = index;
        break;
      }
    }
    if (dividerAfterIndex == null) {
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index < merged.length; index += 1) {
        const distance = Math.abs(Number(merged[index].strike) - under);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      }
      dividerAfterIndex = nearest;
    }
  }

  return {
    rows: merged,
    dividerAfterIndex,
  };
}

function pickAtmOptionRow(rows, underlyingPrice) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return null;
  }
  const under = Number(underlyingPrice);
  const scored = list
    .filter((row) => Number.isFinite(Number(row?.strike)))
    .map((row) => {
      const strike = Number(row.strike);
      const distance = Number.isFinite(under) ? Math.abs(strike - under) : 0;
      const right = String(row?.right || "").toLowerCase();
      const callBias = right === "call" ? 0 : 0.001;
      return { row, score: distance + callBias };
    })
    .sort((a, b) => a.score - b.score);
  return scored[0]?.row || list[0];
}

function getOptionChainColumnConfig(focus, density = "lg") {
  const profile = String(density || "lg").toLowerCase();
  const compactXs = profile === "xs";
  const compactSm = profile === "sm";
  if (String(focus || "").toLowerCase() === "liquidity") {
    if (compactXs) {
      return {
        call: [
          { key: "ask-size", label: "AskSz", metric: "askSize" },
          { key: "oi", label: "OI", metric: "oi" },
        ],
        put: [
          { key: "oi", label: "OI", metric: "oi" },
          { key: "bid-size", label: "BidSz", metric: "bidSize" },
        ],
      };
    }
    if (compactSm) {
      return {
        call: [
          { key: "ask-size", label: "Ask Sz", metric: "askSize" },
          { key: "iv", label: "IV", metric: "iv" },
          { key: "oi", label: "Open Int", metric: "oi" },
        ],
        put: [
          { key: "oi", label: "Open Int", metric: "oi" },
          { key: "iv", label: "IV", metric: "iv" },
          { key: "bid-size", label: "Bid Sz", metric: "bidSize" },
        ],
      };
    }
    return {
      call: [
        { key: "ask-size", label: "Ask Sz", metric: "askSize" },
        { key: "bid-size", label: "Bid Sz", metric: "bidSize" },
        { key: "iv", label: "Impl Vol", metric: "iv" },
        { key: "oi", label: "Open Int", metric: "oi" },
      ],
      put: [
        { key: "oi", label: "Open Int", metric: "oi" },
        { key: "iv", label: "Impl Vol", metric: "iv" },
        { key: "bid-size", label: "Bid Sz", metric: "bidSize" },
        { key: "ask-size", label: "Ask Sz", metric: "askSize" },
      ],
    };
  }

  if (compactXs) {
    return {
      call: [
        { key: "last", label: "Last", metric: "last" },
        { key: "ask", label: "Ask", metric: "ask", valueTone: "ask" },
      ],
      put: [
        { key: "bid", label: "Bid", metric: "bid", valueTone: "bid" },
        { key: "last", label: "Last", metric: "last" },
      ],
    };
  }

  if (compactSm) {
    return {
      call: [
        { key: "pct", label: "%", metric: "changePct" },
        { key: "last", label: "Last", metric: "last" },
        { key: "ask", label: "Ask", metric: "ask", valueTone: "ask" },
      ],
      put: [
        { key: "bid", label: "Bid", metric: "bid", valueTone: "bid" },
        { key: "last", label: "Last", metric: "last" },
        { key: "pct", label: "%", metric: "changePct" },
      ],
    };
  }

  return {
    call: [
      { key: "pct", label: "% Chg", metric: "changePct" },
      { key: "last", label: "Last", metric: "last" },
      { key: "ask", label: "Ask", metric: "ask", valueTone: "ask" },
      { key: "bid", label: "Bid", metric: "bid", valueTone: "bid" },
    ],
    put: [
      { key: "bid", label: "Bid", metric: "bid", valueTone: "bid" },
      { key: "ask", label: "Ask", metric: "ask", valueTone: "ask" },
      { key: "last", label: "Last", metric: "last" },
      { key: "pct", label: "% Chg", metric: "changePct" },
    ],
  };
}

function formatOptionMetricCell(row, metric, palette) {
  if (!row) {
    return { text: "--", color: null };
  }
  switch (metric) {
    case "changePct": {
      const value = getOptionChangePct(row);
      return {
        text: formatChainPct(value),
        color: pctTone(value, palette),
      };
    }
    case "last":
      return {
        text: formatChainMoney(firstFinite(row?.last, row?.mark)),
        color: pctTone(getOptionChangePct(row), palette),
      };
    case "ask":
      return { text: formatChainMoney(row?.ask), color: null };
    case "bid":
      return { text: formatChainMoney(row?.bid), color: null };
    case "mark":
      return { text: formatChainMoney(row?.mark), color: null };
    case "iv":
      return { text: formatChainIv(row?.iv), color: null };
    case "oi":
      return { text: formatChainInt(row?.oi), color: null };
    case "volume":
      return { text: formatChainInt(firstFinite(row?.volume, row?.vol, row?.totalVolume)), color: null };
    case "askSize":
      return { text: formatChainInt(getOptionAskSize(row)), color: null };
    case "bidSize":
      return { text: formatChainInt(getOptionBidSize(row)), color: null };
    case "delta":
      return { text: formatChainSigned(row?.delta, 3), color: null };
    case "gamma":
      return { text: formatChainSigned(row?.gamma, 4), color: null };
    case "theta":
      return { text: formatChainSigned(row?.theta, 4), color: null };
    case "vega":
      return { text: formatChainSigned(row?.vega, 4), color: null };
    default:
      return { text: "--", color: null };
  }
}

function optionCellStyle({
  side,
  active,
  itm,
  striped = false,
  valueTone,
  borderRight = false,
  clickable = true,
}) {
  const baseShade = "#ece9f7";
  const neutralShade = striped ? "#f8f9fc" : "#ffffff";
  const activeShade = "#deecff";
  const color =
    valueTone === "bid"
      ? "#059669"
      : valueTone === "ask"
        ? "#d97706"
        : T.text;
  return {
    ...cellStyle,
    textAlign: "center",
    minWidth: 72,
    cursor: clickable ? "pointer" : "default",
    fontWeight: valueTone ? 600 : 500,
    color,
    background: active ? activeShade : itm ? baseShade : neutralShade,
    transition: "background 120ms ease",
    borderRight: borderRight ? `1px solid ${T.border}` : "none",
  };
}

function optionStrikeCellStyle(theme, options = {}) {
  const atm = Boolean(options?.atm);
  const striped = Boolean(options?.striped);
  return {
    ...cellStyle,
    minWidth: 78,
    textAlign: "center",
    fontWeight: 700,
    color: theme.text,
    background: atm ? "#e8edf3" : (striped ? "#f1f4f8" : "#f5f7fa"),
  };
}

function pctTone(value, palette) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return palette.muted;
  }
  if (numeric > 0) {
    return palette.green;
  }
  if (numeric < 0) {
    return "#d97706";
  }
  return palette.text;
}

function getOptionChangePct(row) {
  const direct = firstFinite(
    row?.changePct,
    row?.percentChange,
    row?.pctChange,
    row?.change_percent,
  );
  if (Number.isFinite(direct)) {
    return direct;
  }
  const change = firstFinite(row?.change, row?.chg);
  const last = firstFinite(row?.last, row?.mark, row?.close);
  if (Number.isFinite(change) && Number.isFinite(last) && Math.abs(last - change) > 0.0001) {
    return (change / (last - change)) * 100;
  }
  return null;
}

function getOptionBidSize(row) {
  return firstFinite(
    row?.bidSize,
    row?.bid_size,
    row?.bidSz,
    row?.bid_qty,
    row?.bidQuantity,
    row?.bidVolume,
    row?.volume,
  );
}

function getOptionAskSize(row) {
  return firstFinite(
    row?.askSize,
    row?.ask_size,
    row?.askSz,
    row?.ask_qty,
    row?.askQuantity,
    row?.askVolume,
    row?.volume,
  );
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function formatChainMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return numeric.toFixed(2);
}

function formatChainPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatChainIv(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return `${(numeric * 100).toFixed(2)}%`;
}

function formatChainInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return Math.round(numeric).toLocaleString();
}

function formatChainSigned(value, decimals = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(decimals)}`;
}

function formatOptionCountCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(numeric / 1_000).toFixed(2)}K`;
  }
  return `${Math.round(numeric)}`;
}

function formatFlowMillions(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const millions = numeric / 1_000_000;
  return millions.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatFlowMillionsSigned(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const millions = numeric / 1_000_000;
  const formatted = Math.abs(millions).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${millions < 0 ? "-" : ""}${formatted}`;
}

function formatOptionContract(option) {
  if (!option || typeof option !== "object") {
    return "--";
  }
  const expiry = option.expiry || "n/a";
  const strike = Number(option.strike);
  const right = option.right || "n/a";
  const strikeText = Number.isFinite(strike) ? String(strike) : "n/a";
  return `${expiry} ${strikeText} ${right}`;
}

function buildPortfolioPositionPreviewList(rows, maxItems = 12) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = formatPortfolioPositionChip(row);
    if (!label) {
      continue;
    }
    out.push(label);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function formatPortfolioPositionChip(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const normalized = normalizeSymbol(String(position.symbol || position.underlying || ""));
  const symbol = String(normalized.split(":").pop() || "").trim().toUpperCase();
  if (!symbol) {
    return null;
  }
  const quantity = Number(position.qty ?? position.quantity);
  const quantityText = Number.isFinite(quantity) ? ` x${Math.abs(quantity)}` : "";
  const option = position.option && typeof position.option === "object" ? position.option : null;
  const rightRaw = String(option?.right || position.right || "").trim().toUpperCase();
  const right = rightRaw.startsWith("P") ? "P" : rightRaw.startsWith("C") ? "C" : "";
  const strike = Number(option?.strike ?? position.strike);
  const strikeText = Number.isFinite(strike) ? formatPortfolioStrikeCompact(strike) : "";
  const contractText = right && strikeText ? ` ${right}${strikeText}` : "";
  return `${symbol}${contractText}${quantityText}`;
}

function formatPortfolioStrikeCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  if (Number.isInteger(numeric)) {
    return String(numeric);
  }
  return numeric.toFixed(2).replace(/\.?0+$/, "");
}

function formatExpiryChipLabel(value) {
  const text = String(value || "").trim();
  const [year, month, day] = text.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return text || "--";
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function buildDefaultWorkspaceLayouts() {
  return {
    lg: [
      { i: "portfolio", x: 0, y: 0, w: 12, h: 4, minW: 6, minH: 4 },
      { i: "spotChart", x: 0, y: 4, w: 6, h: 13, minW: 4, minH: 10 },
      { i: "optionsChart", x: 6, y: 4, w: 3, h: 11, minW: 3, minH: 9 },
      { i: "orderFlow", x: 9, y: 4, w: 3, h: 17, minW: 2, minH: 12 },
      { i: "strategy", x: 0, y: 17, w: 6, h: 10, minW: 3, minH: 8 },
      { i: "execution", x: 6, y: 15, w: 3, h: 10, minW: 2, minH: 8 },
      { i: "ladder", x: 9, y: 21, w: 3, h: 21, minW: 2, minH: 12 },
    ],
    md: [
      { i: "portfolio", x: 0, y: 0, w: 10, h: 4, minW: 5, minH: 4 },
      { i: "spotChart", x: 0, y: 4, w: 4, h: 13, minW: 3, minH: 10 },
      { i: "optionsChart", x: 4, y: 4, w: 3, h: 11, minW: 3, minH: 9 },
      { i: "orderFlow", x: 7, y: 4, w: 3, h: 18, minW: 3, minH: 12 },
      { i: "strategy", x: 0, y: 17, w: 4, h: 10, minW: 3, minH: 7 },
      { i: "execution", x: 4, y: 15, w: 3, h: 10, minW: 3, minH: 7 },
      { i: "ladder", x: 7, y: 22, w: 3, h: 20, minW: 3, minH: 11 },
    ],
    sm: [
      { i: "portfolio", x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 4 },
      { i: "spotChart", x: 0, y: 4, w: 6, h: 14, minW: 4, minH: 10 },
      { i: "optionsChart", x: 0, y: 18, w: 6, h: 12, minW: 4, minH: 9 },
      { i: "orderFlow", x: 0, y: 30, w: 6, h: 17, minW: 4, minH: 11 },
      { i: "strategy", x: 0, y: 47, w: 6, h: 9, minW: 4, minH: 7 },
      { i: "execution", x: 0, y: 56, w: 6, h: 10, minW: 4, minH: 7 },
      { i: "ladder", x: 0, y: 66, w: 6, h: 13, minW: 4, minH: 11 },
    ],
    xs: [
      { i: "portfolio", x: 0, y: 0, w: 1, h: 4, minW: 1, minH: 4 },
      { i: "spotChart", x: 0, y: 4, w: 1, h: 14, minW: 1, minH: 10 },
      { i: "optionsChart", x: 0, y: 18, w: 1, h: 12, minW: 1, minH: 9 },
      { i: "orderFlow", x: 0, y: 30, w: 1, h: 17, minW: 1, minH: 11 },
      { i: "strategy", x: 0, y: 47, w: 1, h: 10, minW: 1, minH: 7 },
      { i: "execution", x: 0, y: 57, w: 1, minH: 7, h: 10, minW: 1 },
      { i: "ladder", x: 0, y: 67, w: 1, h: 13, minW: 1, minH: 11 },
    ],
  };
}

function mergeWorkspaceLayouts(savedLayouts, defaultLayouts) {
  const merged = {};
  const source = savedLayouts && typeof savedLayouts === "object" ? savedLayouts : {};

  for (const breakpoint of Object.keys(defaultLayouts)) {
    const defaults = Array.isArray(defaultLayouts[breakpoint]) ? defaultLayouts[breakpoint] : [];
    const saved = Array.isArray(source[breakpoint]) ? source[breakpoint] : [];
    const savedById = new Map(saved.map((item) => [String(item?.i || ""), item]));
    merged[breakpoint] = defaults.map((item) => {
      const match = savedById.get(item.i);
      if (!match) {
        return item;
      }
      return {
        ...item,
        ...match,
        i: item.i,
      };
    });
  }

  return merged;
}

function filterLayoutsByWidgetIds(layouts, enabledWidgetIds) {
  const source = layouts && typeof layouts === "object" ? layouts : {};
  const enabled = new Set(uniqueStrings(enabledWidgetIds));
  const out = {};
  for (const [breakpoint, rows] of Object.entries(source)) {
    const filtered = (Array.isArray(rows) ? rows : [])
      .filter((row) => enabled.has(String(row?.i || "")));
    out[breakpoint] = filtered;
  }
  return out;
}

function removeWidgetFromLayouts(layouts, widgetId) {
  const source = layouts && typeof layouts === "object" ? layouts : {};
  const targetId = String(widgetId || "").trim();
  if (!targetId) {
    return source;
  }
  const out = {};
  for (const [breakpoint, rows] of Object.entries(source)) {
    out[breakpoint] = (Array.isArray(rows) ? rows : [])
      .filter((row) => String(row?.i || "") !== targetId);
  }
  return out;
}

function addWidgetToLayouts(layouts, defaultLayouts, widgetId) {
  const targetId = String(widgetId || "").trim();
  if (!targetId) {
    return layouts;
  }
  const source = layouts && typeof layouts === "object" ? layouts : {};
  const defaults = defaultLayouts && typeof defaultLayouts === "object" ? defaultLayouts : {};
  const out = {};
  for (const breakpoint of Object.keys(defaults)) {
    const existingRows = Array.isArray(source[breakpoint]) ? [...source[breakpoint]] : [];
    const exists = existingRows.some((row) => String(row?.i || "") === targetId);
    if (exists) {
      out[breakpoint] = existingRows;
      continue;
    }
    const defaultRow = (Array.isArray(defaults[breakpoint]) ? defaults[breakpoint] : [])
      .find((row) => String(row?.i || "") === targetId);
    if (!defaultRow) {
      out[breakpoint] = existingRows;
      continue;
    }
    const nextY = existingRows.reduce((maxY, row) => {
      const y = Number(row?.y || 0);
      const h = Number(row?.h || 0);
      return Math.max(maxY, y + h);
    }, 0);
    out[breakpoint] = [
      ...existingRows,
      {
        ...defaultRow,
        y: Math.max(nextY, Number(defaultRow.y || 0)),
      },
    ];
  }
  return out;
}

function toGridInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.trunc(Number(fallback) || 0);
  }
  return Math.trunc(numeric);
}

function gridRowsOverlap(a, b) {
  if (!a || !b) {
    return false;
  }
  const ax = toGridInt(a.x);
  const ay = toGridInt(a.y);
  const aw = Math.max(1, toGridInt(a.w, 1));
  const ah = Math.max(1, toGridInt(a.h, 1));
  const bx = toGridInt(b.x);
  const by = toGridInt(b.y);
  const bw = Math.max(1, toGridInt(b.w, 1));
  const bh = Math.max(1, toGridInt(b.h, 1));
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function rowCollidesWithRows(candidate, rows, ignoreWidgetId = "") {
  const ignored = String(ignoreWidgetId || "").trim();
  return (Array.isArray(rows) ? rows : []).some((row) => {
    if (!row) {
      return false;
    }
    if (ignored && String(row.i || "") === ignored) {
      return false;
    }
    return gridRowsOverlap(candidate, row);
  });
}

function normalizeGridRow(row, cols) {
  const totalCols = Math.max(1, toGridInt(cols, GRID_COLS.lg));
  const width = clampNumber(toGridInt(row?.w, 1), 1, totalCols);
  const minW = clampNumber(toGridInt(row?.minW, 1), 1, totalCols);
  const maxW = row?.maxW == null ? totalCols : clampNumber(toGridInt(row.maxW, totalCols), minW, totalCols);
  const resolvedW = clampNumber(width, minW, maxW);
  const minH = Math.max(1, toGridInt(row?.minH, 1));
  const rawMaxH = row?.maxH == null ? null : Math.max(minH, toGridInt(row.maxH, minH));
  const height = Math.max(minH, toGridInt(row?.h, minH));
  const resolvedH = rawMaxH == null ? height : clampNumber(height, minH, rawMaxH);
  const x = clampNumber(toGridInt(row?.x, 0), 0, Math.max(0, totalCols - resolvedW));
  const y = Math.max(0, toGridInt(row?.y, 0));
  return {
    ...(row || {}),
    x,
    y,
    w: resolvedW,
    h: resolvedH,
    minW,
    minH,
    ...(rawMaxH == null ? {} : { maxH: rawMaxH }),
    maxW,
  };
}

function placeRowWithoutOverlap(candidate, placedRows, ignoreWidgetId = "") {
  const next = { ...candidate };
  let guard = 0;
  while (rowCollidesWithRows(next, placedRows, ignoreWidgetId) && guard < 5000) {
    next.y += 1;
    guard += 1;
  }
  return next;
}

function sanitizeBreakpointRowsForNoOverlap(rows, cols) {
  const source = Array.isArray(rows) ? rows : [];
  const indexed = source.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const ay = toGridInt(a.row?.y, 0);
    const by = toGridInt(b.row?.y, 0);
    if (ay !== by) {
      return ay - by;
    }
    const ax = toGridInt(a.row?.x, 0);
    const bx = toGridInt(b.row?.x, 0);
    if (ax !== bx) {
      return ax - bx;
    }
    return a.index - b.index;
  });

  const placed = [];
  for (const entry of indexed) {
    const normalized = normalizeGridRow(entry.row, cols);
    const settled = placeRowWithoutOverlap(normalized, placed);
    placed.push(settled);
  }

  return placed.sort((a, b) => {
    const ay = toGridInt(a?.y, 0);
    const by = toGridInt(b?.y, 0);
    if (ay !== by) {
      return ay - by;
    }
    const ax = toGridInt(a?.x, 0);
    const bx = toGridInt(b?.x, 0);
    if (ax !== bx) {
      return ax - bx;
    }
    return String(a?.i || "").localeCompare(String(b?.i || ""));
  });
}

function sanitizeLayoutsForNoOverlap(layouts, colsByBreakpoint = GRID_COLS) {
  const source = layouts && typeof layouts === "object" ? layouts : {};
  const out = {};
  for (const [breakpoint, rows] of Object.entries(source)) {
    const cols = Math.max(1, Number(colsByBreakpoint?.[breakpoint] || GRID_COLS.lg));
    out[breakpoint] = sanitizeBreakpointRowsForNoOverlap(rows, cols);
  }
  return out;
}

function nudgeWidgetLayouts(layouts, options = {}) {
  const source = layouts && typeof layouts === "object" ? layouts : {};
  const widgetId = String(options?.widgetId || "").trim();
  const breakpoint = String(options?.breakpoint || "").trim();
  const colsByBreakpoint = options?.colsByBreakpoint && typeof options.colsByBreakpoint === "object"
    ? options.colsByBreakpoint
    : GRID_COLS;
  const deltaX = Math.trunc(Number(options?.deltaX || 0));
  const deltaY = Math.trunc(Number(options?.deltaY || 0));
  if (!widgetId || !breakpoint || (deltaX === 0 && deltaY === 0)) {
    return source;
  }
  const rows = Array.isArray(source[breakpoint]) ? source[breakpoint] : [];
  const targetIndex = rows.findIndex((row) => String(row?.i || "") === widgetId);
  if (targetIndex < 0) {
    return source;
  }
  const cols = Math.max(1, Number(colsByBreakpoint[breakpoint] || GRID_COLS.lg));
  const out = { ...source };
  const targetRow = rows[targetIndex];
  const normalizedTargetRow = normalizeGridRow(targetRow, cols);
  const candidate = normalizeGridRow({
    ...normalizedTargetRow,
    x: normalizedTargetRow.x + deltaX,
    y: normalizedTargetRow.y + deltaY,
  }, cols);
  if (rowCollidesWithRows(candidate, rows, widgetId)) {
    return source;
  }
  out[breakpoint] = rows.map((row, index) => {
    if (index !== targetIndex) {
      return row;
    }
    return { ...row, x: candidate.x, y: candidate.y };
  });
  return out;
}

function normalizeDashboardWidgetLayouts(layouts, defaultLayouts) {
  const source = layouts && typeof layouts === "object" ? layouts : {};
  const defaults = defaultLayouts && typeof defaultLayouts === "object" ? defaultLayouts : {};
  const legacyPortfolioHeights = { lg: 6, md: 6, sm: 5, xs: 5 };
  const out = {};
  for (const [breakpoint, rows] of Object.entries(source)) {
    const defaultById = new Map(
      (Array.isArray(defaults[breakpoint]) ? defaults[breakpoint] : [])
        .map((row) => [String(row?.i || ""), row]),
    );
    const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => {
      const itemId = String(row?.i || "");
      const base = defaultById.get(itemId);
      if (!base) {
        return row;
      }
      if (itemId !== "portfolio") {
        return row;
      }
      const preferredMinH = Number(base.minH || 4);
      const preferredH = Number(base.h || preferredMinH);
      const legacyDefaultH = Number(legacyPortfolioHeights[breakpoint] || preferredH);
      const currentH = Number(row?.h || preferredH);
      const migratedH = currentH > preferredH && currentH <= legacyDefaultH
        ? preferredH
        : currentH;
      const healedH = migratedH > preferredH + 2 ? preferredH : migratedH;
      return {
        ...row,
        minH: preferredMinH,
        h: Math.max(preferredMinH, healedH),
      };
    });
    const cols = Math.max(1, Number(GRID_COLS[breakpoint] || GRID_COLS.lg));
    out[breakpoint] = sanitizeBreakpointRowsForNoOverlap(normalizedRows, cols);
  }
  return out;
}

function buildDashboardConfigRecord(input = {}) {
  const defaults = buildDefaultWorkspaceLayouts();
  const payload = input && typeof input === "object" ? input : {};
  const hasExplicitEnabledList = Array.isArray(payload.enabledWidgetIds);
  const rawEnabledIds = hasExplicitEnabledList ? payload.enabledWidgetIds : MARKET_WIDGET_IDS;
  const enabledWidgetIds = uniqueStrings(rawEnabledIds)
    .filter((widgetId) => MARKET_WIDGET_META[widgetId]);
  const layouts = filterLayoutsByWidgetIds(
    mergeWorkspaceLayouts(payload.layouts, defaults),
    enabledWidgetIds,
  );
  const hiddenWidgetIds = uniqueStrings(payload.hiddenWidgetIds || [])
    .filter((widgetId) => MARKET_WIDGET_META[widgetId] && !enabledWidgetIds.includes(widgetId));
  const updatedAt = normalizeIsoTimestamp(payload.updatedAt || payload.savedAt || new Date().toISOString());

  return {
    dashboardId: DASHBOARD_ID,
    version: 1,
    updatedAt,
    layouts,
    enabledWidgetIds: hasExplicitEnabledList ? enabledWidgetIds : [...MARKET_WIDGET_IDS],
    hiddenWidgetIds,
  };
}

function choosePreferredDashboardConfig(localConfig, serverConfig) {
  const local = localConfig ? buildDashboardConfigRecord(localConfig) : null;
  const server = serverConfig ? buildDashboardConfigRecord(serverConfig) : null;
  if (local && server) {
    return Date.parse(server.updatedAt) > Date.parse(local.updatedAt) ? server : local;
  }
  if (server) {
    return server;
  }
  if (local) {
    return local;
  }
  return buildDashboardConfigRecord();
}

function readDashboardConfig() {
  const raw = getStorageValue(DASHBOARD_CONFIG_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return buildDashboardConfigRecord(parsed);
  } catch {
    return null;
  }
}

function readLegacyWorkspaceLayout() {
  const raw = getStorageValue(LEGACY_WORKSPACE_LAYOUT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.layouts && typeof parsed.layouts === "object") {
        return parsed.layouts;
      }
      return parsed;
    }
  } catch {
    // ignore malformed layout payloads.
  }
  return null;
}

function readInitialDashboardConfig() {
  const current = readDashboardConfig();
  if (current) {
    return current;
  }
  const legacyLayouts = readLegacyWorkspaceLayout();
  if (legacyLayouts) {
    return buildDashboardConfigRecord({
      layouts: legacyLayouts,
      enabledWidgetIds: [...MARKET_WIDGET_IDS],
      hiddenWidgetIds: [],
      updatedAt: new Date().toISOString(),
    });
  }
  return buildDashboardConfigRecord();
}

function writeDashboardConfig(config) {
  const normalized = buildDashboardConfigRecord(config);
  setStorageValue(DASHBOARD_CONFIG_KEY, JSON.stringify(normalized));
}

function deriveOptionChartSymbol(optionRow, underlyingSymbol) {
  if (!optionRow || typeof optionRow !== "object") {
    return null;
  }

  const directCandidates = [
    optionRow.tradingViewSymbol,
    optionRow.tradingviewSymbol,
    optionRow.tvSymbol,
    optionRow.optionSymbol,
    optionRow.symbol,
    optionRow.contractSymbol,
    optionRow.occSymbol,
    optionRow.occ,
    optionRow.contractId,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeOptionChartSymbolCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const root = String((underlyingSymbol || optionRow.underlying || "SPY") || "SPY")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
  const expiry = String(optionRow.expiry || "").trim();
  const strike = Number(optionRow.strike);
  const right = String(optionRow.right || "").trim().toUpperCase();
  if (!root || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(strike) || !right) {
    return null;
  }

  const yymmdd = expiry.slice(2).replace(/-/g, "");
  const cp = right.startsWith("P") ? "P" : "C";
  const strikeScaled = Math.round(strike * 1000);
  if (!Number.isFinite(strikeScaled) || strikeScaled < 0) {
    return null;
  }

  return "O:" + root + yymmdd + cp + String(strikeScaled).padStart(8, "0");
}

function normalizeOptionChartSymbolCandidate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  if (/^O:/i.test(text)) {
    return text.toUpperCase();
  }

  if (text.includes(":")) {
    return text.toUpperCase();
  }

  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/i.test(text)) {
    return "O:" + text.toUpperCase();
  }

  const collapsed = text.replace(/[^A-Za-z0-9]/g, "");
  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/i.test(collapsed)) {
    return "O:" + collapsed.toUpperCase();
  }

  return null;
}

function readWorkspaceSession() {
  const raw = getStorageValue(WORKSPACE_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readWorkspaceChainScroll() {
  const raw = getStorageValue(OPTIONS_CHAIN_SCROLL_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      x: normalizeFiniteNumber(parsed.x, 0),
      y: normalizeFiniteNumber(parsed.y, 0),
    };
  } catch {
    return null;
  }
}

function normalizeWorkspaceInterval(value) {
  const normalized = String(value || "5").toUpperCase();
  const allowed = new Set(INTERVALS.map((entry) => String(entry.value).toUpperCase()));
  return allowed.has(normalized) ? normalized : "5";
}

function normalizeChainFocus(value) {
  return String(value || "").toLowerCase() === "liquidity" ? "liquidity" : "price";
}

function normalizeExpiry(value, fallback) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  return fallback;
}

function normalizePositiveInt(value, fallback = 1) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.floor(numeric));
  }
  return Math.max(1, Math.floor(Number(fallback) || 1));
}

function normalizeFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return Number(fallback) || 0;
}

function normalizeTicketAssetType(value) {
  return String(value || "").toLowerCase() === "stock" ? "stock" : "option";
}

function normalizeTicketSide(value) {
  return String(value || "").toLowerCase() === "sell" ? "sell" : "buy";
}

function normalizeOrderType(value) {
  return String(value || "").toLowerCase() === "limit" ? "limit" : "market";
}

function normalizeTicketRight(value) {
  return String(value || "").toLowerCase() === "put" ? "put" : "call";
}

function normalizeExecutionMode(_value, _fallback = "live") {
  return "live";
}

function normalizeTimeInForce(value) {
  return String(value || "").toLowerCase() === "gtc" ? "gtc" : "day";
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeIsoTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function getStorageValue(key) {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
}

function setStorageValue(key, value) {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(key, value);
  }
}
