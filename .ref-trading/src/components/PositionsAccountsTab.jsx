import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BROKER_FIELD_CONFIG,
  canonicalBrokerId,
  isCredentialOnlyBroker,
  loadOrMigrateBrokerAccounts,
  saveBrokerAccounts,
  upsertAccountInList,
} from "../lib/accountRegistry.js";
import {
  automateEtradeOAuth,
  closePosition,
  completeEtradeOAuth,
  connectAccount,
  getAccountPerformance,
  getDefaultCredentials,
  getDefaultCredentialStatus,
  getEtradeOAuthStatus,
  getAccounts,
  getPositions,
  getWebullOAuthStatus,
  previewOrder,
  refreshAccountPerformance,
  refreshRuntimeCredentials,
  refreshAccountAuth,
  revokeWebullOAuth,
  startEtradeOAuth,
  startWebullOAuth,
  submitOrder,
  refreshWebullOAuth,
} from "../lib/brokerClient.js";
import {
  getAccountConnectionLabel,
  getAccountConnectionState,
  getAccountMarketDataLabel,
  getAccountMarketDataState,
  getAccountTradingLabel,
  getAccountTradingState,
} from "../lib/accountStatus.js";
import { clearRuntimeActivity, upsertRuntimeActivity } from "../lib/runtimeDiagnostics.js";
import { APP_THEME } from "../lib/uiTheme.js";
import DraftNumberInput from "./shared/DraftNumberInput.jsx";
import LiveWiringBanner from "./LiveWiringBanner.jsx";
import PerformanceHeader from "./performance/PerformanceHeader.jsx";
import PerformanceDataTabs from "./performance/PerformanceDataTabs.jsx";

const T = APP_THEME;
const PERFORMANCE_HISTORY_DAYS = 730;

export default function PositionsAccountsTab({ isActive = true } = {}) {
  const [accounts, setAccounts] = useState([]);
  const [serverAccounts, setServerAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [positionsAvailability, setPositionsAvailability] = useState(null);
  const [defaultCredentialsByBroker, setDefaultCredentialsByBroker] = useState({});
  const [envCredentialStatus, setEnvCredentialStatus] = useState({});
  const [performance, setPerformance] = useState(null);
  const [activeAccountId, setActiveAccountId] = useState("all");
  const [performancePeriod, setPerformancePeriod] = useState("today");
  const [performanceChartMode, setPerformanceChartMode] = useState("layered");
  const [performanceBenchmark, setPerformanceBenchmark] = useState(false);
  const [revealedCredentials, setRevealedCredentials] = useState({});
  const [oauthBusyByAccount, setOauthBusyByAccount] = useState({});
  const [oauthStatusByAccount, setOauthStatusByAccount] = useState({});
  const [oauthFlowModeByAccount, setOauthFlowModeByAccount] = useState({});
  const [verifierByAccount, setVerifierByAccount] = useState({});
  const [busyAccountId, setBusyAccountId] = useState(null);
  const [authBusyAccountId, setAuthBusyAccountId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [refreshingPerformance, setRefreshingPerformance] = useState(false);
  const [reloadingSecrets, setReloadingSecrets] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const isActiveRef = useRef(isActive);
  const hasBootedRef = useRef(false);
  const remoteRefreshInFlightRef = useRef(false);
  const performanceRefreshInFlightRef = useRef(false);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const [ticket, setTicket] = useState({
    accountId: "",
    symbol: "SPY",
    assetType: "option",
    side: "buy",
    quantity: 1,
    orderType: "market",
    limitPrice: "",
    expiry: "2026-03-20",
    strike: 610,
    right: "call",
    executionMode: "live",
    timeInForce: "day",
  });

  const serverAccountsById = useMemo(
    () => Object.fromEntries(serverAccounts.map((account) => [account.accountId, account])),
    [serverAccounts],
  );
  const tradableAccounts = useMemo(
    () => accounts.filter((account) => !isCredentialOnlyBroker(account?.broker)),
    [accounts],
  );

  const visiblePositions = useMemo(() => {
    if (activeAccountId === "all") {
      return positions;
    }
    return positions.filter((position) => position.accountId === activeAccountId);
  }, [positions, activeAccountId]);
  const accountSnapshots = useMemo(() => {
    const positionCountByAccount = new Map();
    for (const position of positions) {
      const accountId = String(position?.accountId || "").trim();
      if (!accountId) {
        continue;
      }
      positionCountByAccount.set(accountId, Number(positionCountByAccount.get(accountId) || 0) + 1);
    }

    const rows = tradableAccounts.map((account) => {
      const remote = serverAccountsById[account.accountId] || {};
      const summary = remote.summary || {};
      const equity = Number(summary.equity);
      const cash = Number(summary.cash ?? summary.buyingPower);
      return {
        accountId: account.accountId,
        label: account.label,
        broker: canonicalBrokerId(account.broker),
        authState: String(remote.authState || "unknown").toLowerCase(),
        equity: Number.isFinite(equity) ? equity : null,
        cash: Number.isFinite(cash) ? cash : null,
        positions: Number(positionCountByAccount.get(account.accountId) || 0),
      };
    });

    const allEquity = rows.reduce((sum, row) => sum + Number(row.equity || 0), 0);
    const allCash = rows.reduce((sum, row) => sum + Number(row.cash || 0), 0);
    const allAuth = rows.length > 0 && rows.every((row) => row.authState === "authenticated")
      ? "authenticated"
      : (rows.some((row) => row.authState === "authenticated") ? "mixed" : "degraded");

    return [
      {
        accountId: "all",
        label: "All Accounts",
        broker: "combined",
        authState: allAuth,
        equity: rows.length > 0 ? allEquity : null,
        cash: rows.length > 0 ? allCash : null,
        positions: positions.length,
      },
      ...rows,
    ];
  }, [positions, serverAccountsById, tradableAccounts]);
  const selectedPositionsAvailability = useMemo(() => {
    if (!positionsAvailability || typeof positionsAvailability !== "object") {
      return null;
    }
    if (activeAccountId === "all") {
      return positionsAvailability;
    }
    return positionsAvailability.byAccount?.[activeAccountId] || null;
  }, [positionsAvailability, activeAccountId]);

  const loadBrokerOAuthStatuses = useCallback(async (remoteAccounts) => {
    const oauthAccounts = (remoteAccounts || []).filter((account) => {
      const broker = canonicalBrokerId(account?.broker);
      return broker === "etrade" || broker === "webull";
    });
    if (!oauthAccounts.length) {
      setOauthStatusByAccount({});
      return {};
    }

    const entries = await Promise.all(
      oauthAccounts.map(async (account) => {
        try {
          const broker = canonicalBrokerId(account?.broker);
          const payload = broker === "webull"
            ? await getWebullOAuthStatus(account.accountId)
            : await getEtradeOAuthStatus(account.accountId);
          return [account.accountId, payload.oauth || payload.session || payload.status || null];
        } catch {
          return [account.accountId, null];
        }
      }),
    );
    const next = Object.fromEntries(entries);
    setOauthStatusByAccount(next);
    return next;
  }, []);

  const loadPerformance = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!silent) {
      setLoadingPerformance(true);
    }
    try {
      const response = refresh
        ? await refreshAccountPerformance({
          accountId: activeAccountId,
          days: PERFORMANCE_HISTORY_DAYS,
          limit: 12000,
          includeBenchmark: performanceBenchmark,
          benchmarkSymbol: "SPY",
        })
        : await getAccountPerformance({
          accountId: activeAccountId,
          days: PERFORMANCE_HISTORY_DAYS,
          limit: 12000,
          includeBenchmark: performanceBenchmark,
          benchmarkSymbol: "SPY",
        });
      setPerformance(response || null);
      return response;
    } finally {
      if (!silent) {
        setLoadingPerformance(false);
      }
    }
  }, [activeAccountId, performanceBenchmark]);

  const refreshRemoteState = useCallback(async () => {
    await refreshRuntimeCredentials().catch(() => null);
    const [remoteAccounts, remotePositionsResponse, envStatus, defaultCredentials] = await Promise.all([
      getAccounts(),
      getPositions("all"),
      getDefaultCredentialStatus().catch(() => ({})),
      getDefaultCredentials().catch(() => ({})),
    ]);
    const remotePositions = Array.isArray(remotePositionsResponse?.positions)
      ? remotePositionsResponse.positions
      : [];
    setServerAccounts(remoteAccounts);
    setPositions(remotePositions);
    setPositionsAvailability(remotePositionsResponse?.availability || null);
    setEnvCredentialStatus(envStatus || {});
    setDefaultCredentialsByBroker(defaultCredentials || {});
    await loadBrokerOAuthStatuses(remoteAccounts);
    setAccounts((prev) => {
      const { accounts: merged, changed } = mergeAccountsWithServerDefaults(
        prev,
        remoteAccounts,
        defaultCredentials || {},
      );
      if (changed) {
        saveBrokerAccounts(merged).catch(() => {});
        return merged;
      }
      return prev;
    });
    return {
      remoteAccounts,
      defaultCredentials: defaultCredentials || {},
    };
  }, [loadBrokerOAuthStatuses]);

  const reloadSecretsFromRuntime = useCallback(async () => {
    setReloadingSecrets(true);
    setError(null);
    try {
      const hydration = await refreshRuntimeCredentials();
      await refreshRemoteState();
      await loadPerformance({ silent: true });
      const merged = Number(hydration?.mergedCount || 0);
      setNotice(
        merged > 0
          ? `Reloaded secrets from runtime (${merged} merged).`
          : "Runtime secrets reloaded.",
      );
    } catch (reloadError) {
      setError(reloadError.message);
    } finally {
      setReloadingSecrets(false);
    }
  }, [loadPerformance, refreshRemoteState]);

  const connectSingleAccount = useCallback(
    async (account) => {
      if (isCredentialOnlyBroker(account?.broker)) {
        return;
      }
      setBusyAccountId(account.accountId);
      try {
        const broker = canonicalBrokerId(account.broker);
        await connectAccount(account.accountId, {
          broker,
          label: account.label,
          mode: account.mode,
          credentials: account.credentials,
        });
        await refreshRemoteState();
        await loadPerformance({ silent: true });
        setNotice(`${account.label} connection updated.`);
      } catch (connectError) {
        setError(`${account.label}: ${connectError.message}`);
      } finally {
        setBusyAccountId(null);
      }
    },
    [loadPerformance, refreshRemoteState],
  );

  const syncAllAccounts = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      for (const account of accounts) {
        if (isCredentialOnlyBroker(account?.broker)) {
          continue;
        }
        try {
          const broker = canonicalBrokerId(account.broker);
          await connectAccount(account.accountId, {
            broker,
            label: account.label,
            mode: account.mode,
            credentials: account.credentials,
          });
        } catch (connectError) {
          setError(`${account.label}: ${connectError.message}`);
        }
      }
      await refreshRemoteState();
      await loadPerformance({ silent: true });
      setNotice("Account sync complete.");
    } finally {
      setSyncing(false);
    }
  }, [accounts, loadPerformance, refreshRemoteState]);

  const refreshSingleAuth = useCallback(
    async (accountId, showNotice = false) => {
      if (!accountId) {
        return;
      }
      const account = accounts.find((item) => item.accountId === accountId);
      if (isCredentialOnlyBroker(account?.broker)) {
        return;
      }
      setAuthBusyAccountId(accountId);
      setError(null);
      try {
        const response = await refreshAccountAuth(accountId);
        await refreshRemoteState();
        await loadPerformance({ silent: true });
        if (showNotice) {
          const state = String(response?.auth?.state || "unknown").toUpperCase();
          setNotice(`Auth refresh ${accountId}: ${state}`);
        }
      } catch (authError) {
        setError(authError.message);
      } finally {
        setAuthBusyAccountId(null);
      }
    },
    [accounts, loadPerformance, refreshRemoteState],
  );

  const setOauthBusy = useCallback((accountId, action, busy) => {
    setOauthBusyByAccount((prev) => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] || {}),
        [action]: busy,
      },
    }));
  }, []);

  const formatOAuthError = useCallback((error) => {
    const message = String(error?.message || "OAuth request failed");
    const status = Number(error?.status || 0);
    if (status === 404 && message.toLowerCase().startsWith("not found")) {
      return `${message}. OAuth API route is unavailable in the running server. Restart dev server and retry.`;
    }
    return message;
  }, []);

  const openBrokerOAuthWindow = useCallback((authorizeUrl, { callbackMode = "oob", windowName = "broker-oauth" } = {}) => {
    if (!authorizeUrl || typeof window === "undefined") {
      return;
    }
    if (callbackMode === "redirect") {
      window.open(
        authorizeUrl,
        windowName,
        "popup=yes,width=760,height=900,resizable=yes,scrollbars=yes",
      );
      return;
    }
    window.open(authorizeUrl, "_blank", "noopener,noreferrer");
  }, []);

  const startManualOAuth = useCallback(async (account) => {
    if (!account || canonicalBrokerId(account.broker) !== "etrade") {
      return;
    }
    setOauthBusy(account.accountId, "start", true);
    setError(null);
    try {
      const response = await startEtradeOAuth(account.accountId, {});
      const authorizeUrl = response?.authorizeUrl;
      const callbackMode = getEtradeCallbackMode(response?.callbackUrl);
      setOauthFlowModeByAccount((prev) => ({
        ...prev,
        [account.accountId]: callbackMode,
      }));
      if (authorizeUrl) {
        openBrokerOAuthWindow(authorizeUrl, {
          callbackMode,
          windowName: `etrade-oauth-${account.accountId}`,
        });
      }
      setNotice(
        callbackMode === "redirect"
          ? "E*TRADE OAuth started. Approve the request in the popup and the server callback will finish the token exchange."
          : "E*TRADE OAuth started. Complete login in the opened page, then paste verifier code.",
      );
      await refreshRemoteState();
      await loadPerformance({ silent: true });
    } catch (oauthError) {
      setError(formatOAuthError(oauthError));
    } finally {
      setOauthBusy(account.accountId, "start", false);
    }
  }, [formatOAuthError, loadPerformance, openBrokerOAuthWindow, refreshRemoteState, setOauthBusy]);

  const completeManualOAuth = useCallback(async (account) => {
    if (!account || canonicalBrokerId(account.broker) !== "etrade") {
      return;
    }
    const verifier = String(
      verifierByAccount[account.accountId]
      || account.credentials?.ETRADE_VERIFIER
      || serverAccountsById[account.accountId]?.credentials?.ETRADE_VERIFIER
      || "",
    ).trim();
    if (!verifier) {
      setError("Verifier code is required to complete E*TRADE OAuth.");
      return;
    }

    setOauthBusy(account.accountId, "complete", true);
    setError(null);
    try {
      await completeEtradeOAuth(account.accountId, { verifier });
      setVerifierByAccount((prev) => ({
        ...prev,
        [account.accountId]: "",
      }));
      setOauthFlowModeByAccount((prev) => {
        const next = { ...prev };
        delete next[account.accountId];
        return next;
      });
      await refreshRemoteState();
      await loadPerformance({ silent: true });
      setNotice("E*TRADE OAuth completed.");
    } catch (oauthError) {
      setError(formatOAuthError(oauthError));
    } finally {
      setOauthBusy(account.accountId, "complete", false);
    }
  }, [formatOAuthError, loadPerformance, refreshRemoteState, setOauthBusy, serverAccountsById, verifierByAccount]);

  const runAutoOAuth = useCallback(async (account) => {
    if (!account || canonicalBrokerId(account.broker) !== "etrade") {
      return;
    }
    setOauthBusy(account.accountId, "auto", true);
    setError(null);
    try {
      const response = await automateEtradeOAuth(account.accountId, {});
      if (response?.automated) {
        setOauthFlowModeByAccount((prev) => {
          const next = { ...prev };
          delete next[account.accountId];
          return next;
        });
        setNotice("E*TRADE auto-auth succeeded.");
      } else {
        const callbackMode = getEtradeCallbackMode(response?.callbackUrl);
        setOauthFlowModeByAccount((prev) => ({
          ...prev,
          [account.accountId]: callbackMode,
        }));
        if (response?.authorizeUrl) {
          openBrokerOAuthWindow(response.authorizeUrl, {
            callbackMode,
            windowName: `etrade-oauth-${account.accountId}`,
          });
        }
        setNotice(
          callbackMode === "redirect"
            ? "Auto-auth could not finish. Approve the request in the popup and the callback will complete the token exchange."
            : "Auto-auth could not finish. Continue in browser and complete with verifier.",
        );
      }
      await refreshRemoteState();
      await loadPerformance({ silent: true });
    } catch (oauthError) {
      setError(formatOAuthError(oauthError));
    } finally {
      setOauthBusy(account.accountId, "auto", false);
    }
  }, [formatOAuthError, loadPerformance, openBrokerOAuthWindow, refreshRemoteState, setOauthBusy]);

  const startEtradeReconnect = useCallback(async (account, options = {}) => {
    if (!account || canonicalBrokerId(account.broker) !== "etrade") {
      return;
    }
    const oauth = options.oauth || oauthStatusByAccount[account.accountId];
    const canAutomate = Boolean(oauth?.playwright?.available)
      && Boolean(oauth?.hasWebUsername)
      && Boolean(oauth?.hasWebPassword);
    if (canAutomate) {
      await runAutoOAuth(account);
      return;
    }
    await startManualOAuth(account);
  }, [oauthStatusByAccount, runAutoOAuth, startManualOAuth]);

  const startWebullConnectOAuth = useCallback(async (account) => {
    if (!account || canonicalBrokerId(account.broker) !== "webull") {
      return;
    }
    setOauthBusy(account.accountId, "start", true);
    setError(null);
    try {
      const response = await startWebullOAuth(account.accountId, {});
      const authorizeUrl = response?.authorizeUrl || response?.oauth?.authorizeUrl;
      if (authorizeUrl) {
        window.open(authorizeUrl, "_blank", "noopener,noreferrer");
      }
      setNotice("Webull Connect OAuth started. Complete login in the opened page to link trading access.");
      await refreshRemoteState();
      await loadPerformance({ silent: true });
    } catch (oauthError) {
      setError(formatOAuthError(oauthError));
    } finally {
      setOauthBusy(account.accountId, "start", false);
    }
  }, [formatOAuthError, loadPerformance, refreshRemoteState, setOauthBusy]);

  const refreshWebullConnectOAuth = useCallback(async (account) => {
    if (!account || canonicalBrokerId(account.broker) !== "webull") {
      return;
    }
    setOauthBusy(account.accountId, "refresh", true);
    setError(null);
    try {
      await refreshWebullOAuth(account.accountId);
      await refreshRemoteState();
      await loadPerformance({ silent: true });
      setNotice("Webull Connect OAuth session refreshed.");
    } catch (oauthError) {
      setError(formatOAuthError(oauthError));
    } finally {
      setOauthBusy(account.accountId, "refresh", false);
    }
  }, [formatOAuthError, loadPerformance, refreshRemoteState, setOauthBusy]);

  const revokeWebullConnectOAuth = useCallback(async (account) => {
    if (!account || canonicalBrokerId(account.broker) !== "webull") {
      return;
    }
    const confirmed = window.confirm("Clear the current Webull Connect OAuth session?");
    if (!confirmed) {
      return;
    }
    setOauthBusy(account.accountId, "revoke", true);
    setError(null);
    try {
      await revokeWebullOAuth(account.accountId);
      await refreshRemoteState();
      await loadPerformance({ silent: true });
      setNotice("Webull Connect OAuth session cleared.");
    } catch (oauthError) {
      setError(formatOAuthError(oauthError));
    } finally {
      setOauthBusy(account.accountId, "revoke", false);
    }
  }, [formatOAuthError, loadPerformance, refreshRemoteState, setOauthBusy]);

  useEffect(() => {
    let mounted = true;
    if (!isActive && !hasBootedRef.current) {
      return () => {
        mounted = false;
      };
    }
    const boot = async () => {
      setLoading(true);
      try {
        const migratedAccounts = await loadOrMigrateBrokerAccounts();
        if (!mounted) {
          return;
        }
        setAccounts(migratedAccounts);
        const firstTradableAccount = migratedAccounts.find(
          (account) => !isCredentialOnlyBroker(account?.broker),
        );
        setTicket((prev) => ({
          ...prev,
          accountId: firstTradableAccount?.accountId || "",
          executionMode: firstTradableAccount?.mode || "live",
        }));
        for (const account of migratedAccounts) {
          if (isCredentialOnlyBroker(account?.broker)) {
            continue;
          }
          try {
            const broker = canonicalBrokerId(account.broker);
            await connectAccount(account.accountId, {
              broker,
              label: account.label,
              mode: account.mode,
              credentials: account.credentials,
            });
          } catch {
            // Keep boot resilient when some accounts are not ready yet.
          }
        }
        const { remoteAccounts, defaultCredentials } = await refreshRemoteState();
        await loadPerformance({ refresh: true, silent: true });
        const { accounts: mergedAccounts, changed } = mergeAccountsWithServerDefaults(
          migratedAccounts,
          remoteAccounts,
          defaultCredentials,
        );
        if (changed) {
          const persisted = await saveBrokerAccounts(mergedAccounts);
          setAccounts(persisted);
        }
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

    if (!hasBootedRef.current) {
      hasBootedRef.current = true;
      boot();
    }

    if (!isActive) {
      return () => {
        mounted = false;
      };
    }

    upsertRuntimeActivity("poller.positions.remote-refresh", {
      kind: "poller",
      label: "Accounts remote refresh",
      surface: "positions",
      intervalMs: 5000,
    });
    upsertRuntimeActivity("poller.positions.performance-refresh", {
      kind: "poller",
      label: "Accounts performance refresh",
      surface: "positions",
      intervalMs: 30000,
    });

    const fastTimer = setInterval(() => {
      if (!isActiveRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (remoteRefreshInFlightRef.current) {
        return;
      }
      remoteRefreshInFlightRef.current = true;
      refreshRemoteState()
        .catch(() => {
          // Polling should not spam errors while user is editing.
        })
        .finally(() => {
          remoteRefreshInFlightRef.current = false;
        });
    }, 5000);

    const heavyTimer = setInterval(() => {
      if (!isActiveRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (performanceRefreshInFlightRef.current) {
        return;
      }
      performanceRefreshInFlightRef.current = true;
      loadPerformance({ silent: true }).catch(() => {
        // Heavy metrics refresh is best-effort.
      }).finally(() => {
        performanceRefreshInFlightRef.current = false;
      });
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(fastTimer);
      clearInterval(heavyTimer);
      clearRuntimeActivity("poller.positions.remote-refresh");
      clearRuntimeActivity("poller.positions.performance-refresh");
    };
  }, [isActive, loadPerformance, refreshRemoteState]);

  useEffect(() => {
    if (loading) {
      return;
    }
    loadPerformance({ silent: true }).catch(() => {});
  }, [activeAccountId, loadPerformance, loading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type !== "etrade-oauth-complete") {
        return;
      }
      const accountId = String(event.data?.accountId || "").trim();
      refreshRemoteState()
        .then(() => loadPerformance({ silent: true }))
        .then(() => {
          setOauthFlowModeByAccount((prev) => {
            const next = { ...prev };
            delete next[accountId];
            return next;
          });
          setNotice(
            accountId
              ? `E*TRADE OAuth completed for ${accountId}.`
              : "E*TRADE OAuth completed.",
          );
        })
        .catch((refreshError) => {
          setError(refreshError.message);
        });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadPerformance, refreshRemoteState]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timeout = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const persistAccounts = useCallback(async (nextAccounts) => {
    const normalized = await saveBrokerAccounts(nextAccounts);
    setAccounts(normalized);
  }, []);

  const updateAccountCredentials = useCallback(
    async (accountId, key, value) => {
      const account = accounts.find((item) => item.accountId === accountId);
      if (!account) {
        return;
      }
      const nextAccount = {
        ...account,
        credentials: {
          ...(account.credentials || {}),
          [key]: value,
        },
      };
      const merged = upsertAccountInList(accounts, nextAccount);
      await persistAccounts(merged);
    },
    [accounts, persistAccounts],
  );

  const onTicketChange = (key, value) => {
    setTicket((prev) => ({
      ...prev,
      [key]: value,
    }));
    setPreview(null);
  };

  const buildOrderPayload = () => {
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
    }

    return payload;
  };

  const runPreview = async () => {
    setError(null);
    try {
      const response = await previewOrder(buildOrderPayload());
      setPreview(response.preview);
    } catch (previewError) {
      setError(previewError.message);
    }
  };

  const placeOrder = async () => {
    setSubmittingOrder(true);
    setError(null);
    try {
      const order = await submitOrder(buildOrderPayload());
      setNotice(`Order ${order.orderId} filled.`);
      setPreview(null);
      await refreshRemoteState();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const closeSinglePosition = async (position) => {
    const confirmed = window.confirm(
      `Close ${position.qty} of ${position.symbol} on ${position.accountId}?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await closePosition(position.positionId, {
        accountId: position.accountId,
        quantity: position.qty,
        executionMode: ticket.executionMode,
      });
      await refreshRemoteState();
      await loadPerformance({ silent: true });
      setNotice(`Closed ${position.symbol} on ${position.accountId}.`);
    } catch (closeError) {
      setError(closeError.message);
    }
  };

  const refreshRealEquity = async () => {
    setRefreshingPerformance(true);
    setError(null);
    try {
      await loadPerformance({ refresh: true });
      setNotice("Equity history refreshed from broker data.");
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setRefreshingPerformance(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.text, padding: 20 }}>
        Loading positions workspace...
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Positions & Accounts</div>
          <div style={{ fontSize: 12, color: T.muted }}>
            Monitor and manage positions across E*Trade, Webull, and IBKR.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() =>
              refreshRemoteState()
                .then(() => loadPerformance({ silent: true }))
                .catch((refreshError) => setError(refreshError.message))
            }
            style={btnStyle("secondary")}
          >
            Refresh
          </button>
          <button
            onClick={reloadSecretsFromRuntime}
            style={btnStyle("secondary")}
            disabled={reloadingSecrets}
          >
            {reloadingSecrets ? "Reloading..." : "Reload Secrets"}
          </button>
          <button onClick={syncAllAccounts} style={btnStyle("primary")} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Accounts"}
          </button>
        </div>
      </div>

      <LiveWiringBanner
        symbol="SPY"
        showRefresh
        enabled={isActive}
        diagnosticsId="positions.live-wiring"
        diagnosticsSurface="positions"
        diagnosticsLabel="Accounts live wiring"
      />

      {notice && (
        <div style={{ marginBottom: 10, border: `1px solid ${T.green}66`, background: `${T.green}1a`, color: T.green, borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 10, border: `1px solid ${T.red}66`, background: `${T.red}14`, color: T.red, borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 8, border: `1px solid ${T.border}`, borderRadius: 8, background: T.card, padding: "6px 7px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: T.muted }}>
            Portfolio Containers
          </div>
          <div style={{ fontSize: 10.5, color: T.muted }}>
            Click a container to scope the performance and position views.
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
          {accountSnapshots.map((snapshot) => {
            const selected = snapshot.accountId === activeAccountId;
            const authColor = authStateColor(snapshot.authState);
            const authLabel = compactAuthStateLabel(snapshot.authState);
            return (
              <button
                key={snapshot.accountId}
                type="button"
                onClick={() => setActiveAccountId(snapshot.accountId)}
                style={{
                  border: `1px solid ${selected ? `${T.accent}70` : T.border}`,
                  borderRadius: 7,
                  background: selected ? `${T.accent}12` : "#ffffff",
                  padding: "6px 8px",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center", minWidth: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {snapshot.label}
                    </div>
                    <div style={{ fontSize: 9.5, color: T.muted, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {snapshot.broker}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: authColor,
                      textTransform: "uppercase",
                      border: `1px solid ${authColor}33`,
                      background: `${authColor}12`,
                      borderRadius: 999,
                      padding: "2px 6px",
                      flexShrink: 0,
                    }}
                    title={String(snapshot.authState || "").replace(/_/g, " ")}
                  >
                    {authLabel}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 10.5, lineHeight: 1.35 }}>
                  <span style={{ color: T.text, fontWeight: 700 }}>
                    Eq {compactMoney(snapshot.equity)}
                  </span>
                  <span style={{ color: T.muted }}>
                    Cash {compactMoney(snapshot.cash)}
                  </span>
                  <span style={{ color: T.muted }}>
                    Pos {snapshot.positions}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <PerformanceHeader
          title="Performance & Cash"
          subtitle="Live broker metrics with derived confidence tags and layered equity tracking."
          performance={performance}
          accountId={activeAccountId}
          accountOptions={tradableAccounts}
          onAccountChange={setActiveAccountId}
          period={performancePeriod}
          onPeriodChange={setPerformancePeriod}
          chartMode={performanceChartMode}
          onChartModeChange={setPerformanceChartMode}
          benchmarkEnabled={performanceBenchmark}
          onBenchmarkToggle={setPerformanceBenchmark}
          loading={loadingPerformance}
          refreshing={refreshingPerformance}
          onReload={() => loadPerformance().catch((refreshError) => setError(refreshError.message))}
          onBackfill={refreshRealEquity}
          showTradeMarkers
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <PerformanceDataTabs
          performance={performance}
          positions={visiblePositions}
          positionsAvailability={selectedPositionsAvailability}
          trackingEnabled={isActive}
          onClosePosition={closeSinglePosition}
        />
      </div>

      <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Connection & Credentials</div>
          <div style={{ fontSize: 12, color: T.muted }}>
            Manage auth and API settings below. Sensitive field values stay masked by default.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 10, marginBottom: 14 }}>
        {accounts.map((account) => {
          const remote = serverAccountsById[account.accountId];
          const broker = canonicalBrokerId(remote?.broker || account.broker);
          const isCredentialOnly = isCredentialOnlyBroker(broker);
          const status = remote?.status || "disconnected";
          const connectionState = getAccountConnectionState(remote || account);
          const connectionLabel = getAccountConnectionLabel(remote || account);
          const tradingState = getAccountTradingState(remote || account);
          const tradingLabel = getAccountTradingLabel(remote || account);
          const marketDataState = getAccountMarketDataState(remote || account);
          const marketDataLabel = getAccountMarketDataLabel(remote || account);
          const authState = String(remote?.authState || "unknown").toLowerCase();
          const summary = remote?.summary;
          const keys = BROKER_FIELD_CONFIG[broker] || [];
          const editableKeys = getVisibleCredentialEditorKeys({
            broker,
            keys,
          });
          const mergedCredentials = mergeCredentialSources(keys, [
            remote?.credentials || {},
            account.credentials || {},
            defaultCredentialsByBroker[broker] || {},
          ]);
          const envStatusByKey = envCredentialStatus[broker] || {};
          const localConfiguredCount = keys.filter((key) => hasCredentialValue(mergedCredentials[key])).length;
          const envConfiguredCount = keys.filter((key) => Boolean(envStatusByKey[key]?.configured)).length;
          const configuredCount = keys.filter((key) => (
            hasCredentialValue(mergedCredentials[key]) || Boolean(envStatusByKey[key]?.configured)
          )).length;
          const configuredLabels = keys
            .filter((key) => hasCredentialValue(mergedCredentials[key]))
            .map((key) => credentialFieldMeta(broker, key).label);
          const envOnlyCount = keys.filter((key) => (
            !hasCredentialValue(mergedCredentials[key]) && Boolean(envStatusByKey[key]?.configured)
          )).length;
          const credentialOnlyState = configuredCount > 0 ? "configured" : "missing_credentials";
          const displayConnectionState = isCredentialOnly ? credentialOnlyState : connectionState;
          const displayConnectionLabel = isCredentialOnly
            ? (configuredCount > 0 ? "Configured" : "Missing Creds")
            : connectionLabel;
          const displayTradingState = isCredentialOnly ? credentialOnlyState : tradingState;
          const displayTradingLabel = isCredentialOnly ? "Research Data" : tradingLabel;
          const displayMarketDataState = isCredentialOnly ? credentialOnlyState : marketDataState;
          const displayMarketDataLabel = isCredentialOnly
            ? (configuredCount > 0 ? "Ready" : "Needs Keys")
            : marketDataLabel;
          const displayAuthState = isCredentialOnly ? credentialOnlyState : authState;
          const authColor = authStateColor(displayAuthState);
          const statusColor = statusLaneColor(displayConnectionState);
          const tradingColor = statusLaneColor(displayTradingState);
          const marketDataColor = statusLaneColor(displayMarketDataState);
          const oauth = (broker === "etrade" || broker === "webull")
            ? oauthStatusByAccount[account.accountId]
            : null;
          const oauthBusy = oauthBusyByAccount[account.accountId] || {};
          const setupActionLabel = getAccountSetupActionLabel({
            configuredCount,
            connectionState: displayConnectionState,
          });
          const authActionLabel = getAccountAuthActionLabel(broker);
          const operationalHint = getBrokerOperationalHint({
            broker,
            authState: displayAuthState,
            tradingState: displayTradingState,
            marketDataState: displayMarketDataState,
            marketDataMessage: remote?.marketDataMessage,
            oauth,
          });
          const canRenewOAuth = broker === "etrade"
            && Boolean(oauth?.hasAccessToken)
            && Boolean(oauth?.hasAccessSecret)
            && !Boolean(oauth?.likelyExpiredByDate)
            && authState !== "needs_token"
            && authState !== "needs_login";
          const canStartWebullOAuth = broker === "webull"
            && Boolean(oauth?.hasClientId)
            && Boolean(oauth?.hasClientSecret);
          const canRefreshWebullOAuth = broker === "webull"
            && Boolean(oauth?.hasRefreshToken || oauth?.hasAccessToken);
          const canAutomateEtradeOAuth = broker === "etrade"
            && Boolean(oauth?.playwright?.available)
            && Boolean(oauth?.hasWebUsername)
            && Boolean(oauth?.hasWebPassword);
          const configuredEtradeCallbackMode = broker === "etrade" && hasCredentialValue(mergedCredentials.ETRADE_AUTH_CALLBACK_URL)
            ? getEtradeCallbackMode(mergedCredentials.ETRADE_AUTH_CALLBACK_URL)
            : "redirect";
          const etradeCallbackMode = broker === "etrade"
            ? (
              oauthFlowModeByAccount[account.accountId]
              || (Boolean(oauth?.requestTokenFresh) ? getEtradeCallbackMode(oauth?.callbackUrl) : configuredEtradeCallbackMode)
            )
            : "oob";
          const hasManualVerifierEntry = hasCredentialValue(verifierByAccount[account.accountId]);
          const needsManualVerifier = broker === "etrade"
            && etradeCallbackMode === "oob"
            && Boolean(oauth?.requestTokenFresh || hasManualVerifierEntry);
          const etradeReconnectBusy = Boolean(oauthBusy.auto) || Boolean(oauthBusy.start);

          return (
            <div key={account.accountId} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{account.label}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{account.accountId}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, textTransform: "uppercase" }}>{displayConnectionLabel}</span>
              </div>

              {isCredentialOnly ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, fontSize: 12 }}>
                  <div style={{ color: T.muted }}>Mode</div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>research</div>
                  <div style={{ color: T.muted }}>Scope</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: tradingColor }}>{displayTradingLabel}</div>
                  <div style={{ color: T.muted }}>Options Replay</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: marketDataColor }}>{displayMarketDataLabel}</div>
                  <div style={{ color: T.muted }}>Status</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: statusColor }}>{displayConnectionLabel}</div>
                  <div style={{ color: T.muted }}>Credentials</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {configuredCount}/{keys.length}
                  </div>
                  <div style={{ color: T.muted }}>Local Overrides</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {localConfiguredCount}/{keys.length}
                  </div>
                  <div style={{ color: T.muted }}>Runtime Secrets</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {envConfiguredCount}/{keys.length}
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, fontSize: 12 }}>
                  <div style={{ color: T.muted }}>Mode</div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>live</div>
                  <div style={{ color: T.muted }}>Link</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: statusColor }}>{displayConnectionLabel}</div>
                  <div style={{ color: T.muted }}>Trading</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: tradingColor }}>{displayTradingLabel}</div>
                  <div style={{ color: T.muted }}>Market Data</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: marketDataColor }}>{displayMarketDataLabel}</div>
                  <div style={{ color: T.muted }}>Buying Power</div>
                  <div style={{ textAlign: "right" }}>{summary ? money(summary.buyingPower) : "-"}</div>
                  <div style={{ color: T.muted }}>Cash</div>
                  <div style={{ textAlign: "right" }}>{summary ? money(summary.cash ?? summary.buyingPower ?? 0) : "-"}</div>
                  <div style={{ color: T.muted }}>Unrealized P/L</div>
                  <div style={{ textAlign: "right", color: summary?.unrealizedPnl >= 0 ? T.green : T.red }}>
                    {summary ? money(summary.unrealizedPnl) : "-"}
                  </div>
                  <div style={{ color: T.muted }}>Auth</div>
                  <div style={{ textAlign: "right", display: "grid", gap: 4, justifyItems: "end" }}>
                    <div style={{ color: authColor, fontWeight: 700, textTransform: "uppercase" }}>
                      {displayAuthState}
                    </div>
                  </div>
                  <div style={{ color: T.muted }}>Credentials</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {configuredCount}/{keys.length}
                  </div>
                  <div style={{ color: T.muted }}>Transport</div>
                  <div style={{ textAlign: "right", color: T.muted }}>
                    {status}
                  </div>
                  <div style={{ color: T.muted }}>Local Overrides</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {localConfiguredCount}/{keys.length}
                  </div>
                  <div style={{ color: T.muted }}>Env Defaults</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {envConfiguredCount}/{keys.length}
                  </div>
                </div>
              )}

              {!isCredentialOnly && (broker === "webull" && marketDataState === "subscription_required"
                ? (remote?.marketDataMessage || remote?.authMessage)
                : remote?.authMessage) && (
                <div style={{ marginTop: 6, fontSize: 11, color: T.muted }}>
                  {broker === "webull" && marketDataState === "subscription_required"
                    ? (remote?.marketDataMessage || remote?.authMessage)
                    : remote?.authMessage}
                </div>
              )}
              {operationalHint && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: T.muted,
                    padding: "7px 8px",
                    borderRadius: 6,
                    background: "#f8fafc",
                    border: `1px solid ${T.border}`,
                  }}
                >
                  {operationalHint}
                </div>
              )}
              {configuredLabels.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: T.muted }}>
                  Loaded fields: {configuredLabels.join(", ")}
                </div>
              )}
              {envOnlyCount > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: T.muted }}>
                  {envOnlyCount} credential{envOnlyCount === 1 ? "" : "s"} loaded from runtime secrets.
                  Values stay hidden in the browser and are still used by the server.
                </div>
              )}

              {!isCredentialOnly && (
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button
                    style={{ ...btnStyle("primary"), flex: 1 }}
                    onClick={() => connectSingleAccount(account)}
                    disabled={busyAccountId === account.accountId}
                  >
                    {busyAccountId === account.accountId ? "Saving..." : setupActionLabel}
                  </button>
                  <button
                    style={{ ...btnStyle("secondary"), flex: 1 }}
                    onClick={() => refreshSingleAuth(account.accountId, true)}
                    disabled={authBusyAccountId === account.accountId}
                  >
                    {authBusyAccountId === account.accountId ? getAccountAuthBusyLabel(broker) : authActionLabel}
                  </button>
                </div>
              )}

              {broker === "etrade" && (
                <div style={{ marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 6, padding: 8, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, color: T.muted }}>E*TRADE OAuth</div>
                    {oauth?.playwright?.available && (
                      <div style={{ fontSize: 11, color: T.muted }}>
                        Auto-auth ready
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    Session date (ET): {oauth?.issuedEtDate || "n/a"}{oauth?.likelyExpiredByDate ? " (expired)" : ""}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    Approval flow: {etradeCallbackMode === "redirect" ? "server callback" : "verifier fallback"}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {canAutomateEtradeOAuth
                      ? "Reauth can run through stored web credentials and browser automation when the session expires."
                      : etradeCallbackMode === "redirect"
                        ? "Reauth opens a popup and stores the new token automatically after approval."
                        : "This account is on manual verifier fallback because callback automation is unavailable."}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
                    <button
                      style={btnStyle("primary")}
                      onClick={() => startEtradeReconnect(account, { oauth })}
                      disabled={etradeReconnectBusy}
                    >
                      {etradeReconnectBusy
                        ? (canAutomateEtradeOAuth ? "Reconnecting..." : "Opening Login...")
                        : (authState === "authenticated" && !oauth?.likelyExpiredByDate ? "Reconnect E*TRADE" : "Connect E*TRADE")}
                    </button>
                  </div>
                  {needsManualVerifier ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                      <input
                        value={verifierByAccount[account.accountId] || ""}
                        onChange={(event) =>
                          setVerifierByAccount((prev) => ({
                            ...prev,
                            [account.accountId]: event.target.value,
                          }))
                        }
                        placeholder="Paste verifier code"
                        style={inputStyle}
                      />
                      <button
                        style={btnStyle("secondary")}
                        onClick={() => completeManualOAuth(account)}
                        disabled={Boolean(oauthBusy.complete)}
                      >
                        {oauthBusy.complete ? "Completing..." : "Complete"}
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: T.muted }}>
                      {canRenewOAuth
                        ? "Use Check / Renew above for same-day token checks. Use Connect E*TRADE only when you need a fresh login."
                        : "No verifier entry is needed unless the flow falls back to manual approval."}
                    </div>
                  )}
                </div>
              )}

              {broker === "webull" && (
                <div style={{ marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 6, padding: 8, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, color: T.muted }}>Webull Connect OAuth</div>
                    <div style={{ fontSize: 11, color: T.muted }}>
                      Trading & portfolio access
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    Market data still uses the Webull OpenAPI token above. Connect OAuth is the trading-side login for account access, balances, positions, and history.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
                    <div style={{ color: T.muted }}>Client Credentials</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: oauth?.hasClientId && oauth?.hasClientSecret ? T.green : T.muted }}>
                      {oauth?.hasClientId && oauth?.hasClientSecret ? "Configured" : "Missing"}
                    </div>
                    <div style={{ color: T.muted }}>Session</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: oauth?.hasAccessToken ? T.green : T.muted }}>
                      {oauth?.hasAccessToken ? "Linked" : "Not Linked"}
                    </div>
                    <div style={{ color: T.muted }}>Refresh Token</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: oauth?.hasRefreshToken ? T.green : T.muted }}>
                      {oauth?.hasRefreshToken ? "Available" : "Missing"}
                    </div>
                    <div style={{ color: T.muted }}>Redirect URI</div>
                    <div style={{ textAlign: "right", color: T.muted }}>
                      {oauth?.redirectUri || "server default"}
                    </div>
                    <div style={{ color: T.muted }}>Access Expires</div>
                    <div style={{ textAlign: "right", color: T.muted }}>
                      {formatOAuthTimestamp(oauth?.accessTokenExpiresAt)}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6 }}>
                    <button
                      style={btnStyle("primary")}
                      onClick={() => startWebullConnectOAuth(account)}
                      disabled={Boolean(oauthBusy.start) || !canStartWebullOAuth}
                      title={canStartWebullOAuth ? "Open Webull Connect OAuth in a new tab." : "Configure Webull Connect client credentials first."}
                    >
                      {oauthBusy.start ? "Starting..." : "Start OAuth"}
                    </button>
                    <button
                      style={btnStyle("secondary")}
                      onClick={() => refreshWebullConnectOAuth(account)}
                      disabled={Boolean(oauthBusy.refresh) || !canRefreshWebullOAuth}
                    >
                      {oauthBusy.refresh ? "Refreshing..." : "Refresh Session"}
                    </button>
                    <button
                      style={btnStyle("danger")}
                      onClick={() => revokeWebullConnectOAuth(account)}
                      disabled={Boolean(oauthBusy.revoke) || !Boolean(oauth?.hasAccessToken || oauth?.hasRefreshToken)}
                    >
                      {oauthBusy.revoke ? "Clearing..." : "Clear Session"}
                    </button>
                  </div>
                  {oauth?.statusMessage && (
                    <div style={{ fontSize: 11, color: T.muted }}>
                      {oauth.statusMessage}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                <div style={{ fontSize: 11, color: T.muted }}>
                  Env sources: {keys
                    .map((key) => envStatusByKey[key]?.sourceEnvKey)
                    .filter(Boolean)
                    .join(", ") || "none detected"}
                </div>
                {broker === "etrade" && (
                  <div style={{ fontSize: 11, color: T.muted }}>
                    E*TRADE session tokens and verifier codes are system-managed and hidden from the editor.
                  </div>
                )}
                {editableKeys.map((key) => {
                  const envConfigured = Boolean(envStatusByKey[key]?.configured);
                  const visibleValue = mergedCredentials[key];
                  const hasVisibleValue = hasCredentialValue(visibleValue);
                  const isConfigured = hasVisibleValue || envConfigured;
                  const fieldMeta = credentialFieldMeta(broker, key);
                  const inputPlaceholder = envConfigured && !hasVisibleValue
                    ? `${fieldMeta.placeholder} (loaded from env)`
                    : fieldMeta.placeholder;
                  return (
                  <label key={key} style={{ fontSize: 11, color: T.muted, display: "grid", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{fieldMeta.label}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: `${T.muted}cc` }}>{key}</span>
                        <span
                          style={{
                            color: isConfigured ? T.green : T.muted,
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          {isConfigured ? "Configured" : "Empty"}
                        </span>
                      </span>
                    </span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                      <input
                        type={revealedCredentials[`${account.accountId}:${key}`] ? "text" : "password"}
                        value={visibleValue || ""}
                        placeholder={inputPlaceholder}
                        onChange={(event) =>
                          updateAccountCredentials(account.accountId, key, event.target.value)
                        }
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        style={btnStyle("secondary")}
                        onClick={() =>
                          setRevealedCredentials((prev) => ({
                            ...prev,
                            [`${account.accountId}:${key}`]: !prev[`${account.accountId}:${key}`],
                          }))
                        }
                      >
                        {revealedCredentials[`${account.accountId}:${key}`] ? "Hide" : "View"}
                      </button>
                    </div>
                  </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Trade Ticket</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={labelStyle}>
              Account
              <select
                value={ticket.accountId}
                onChange={(event) => {
                  const accountId = event.target.value;
                  const account = tradableAccounts.find((item) => item.accountId === accountId);
                  onTicketChange("accountId", accountId);
                  if (account) {
                    onTicketChange("executionMode", account.mode);
                  }
                }}
                style={selectStyle}
              >
                {tradableAccounts.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              Symbol
              <input value={ticket.symbol} onChange={(event) => onTicketChange("symbol", event.target.value.toUpperCase())} style={inputStyle} />
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
                <input type="number" min={0.01} step={0.01} value={ticket.limitPrice} onChange={(event) => onTicketChange("limitPrice", event.target.value)} style={inputStyle} />
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

          {preview && (
            <div style={{ marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 6, padding: 8, fontSize: 12 }}>
              <div style={{ color: T.muted }}>Preview</div>
              <div>Unit Price: {money(preview.unitPrice)}</div>
              <div>Estimated Notional: {money(preview.estimatedNotional)}</div>
              <div>Estimated Fees: {money(preview.estimatedFees)}</div>
              <div style={{ fontWeight: 700 }}>Estimated Total: {money(preview.estimatedTotal)}</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={{ ...btnStyle("secondary"), flex: 1 }} onClick={runPreview}>
              Preview
            </button>
            <button
              style={{ ...btnStyle("primary"), flex: 1 }}
              onClick={placeOrder}
              disabled={submittingOrder}
            >
              {submittingOrder ? "Submitting..." : "Submit Order"}
            </button>
          </div>
        </div>
      </div>
  );
}

function money(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "--";
  }
  const abs = Math.abs(n);
  if (abs < 1000) {
    return money(n);
  }
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: abs < 10000 ? 1 : 0,
  })}`;
}

function mergeAccountsWithServerDefaults(localAccounts, remoteAccounts, defaultCredentialsByBroker = {}) {
  const remoteById = Object.fromEntries(
    (remoteAccounts || []).map((account) => [account.accountId, account]),
  );
  let changed = false;

  const accounts = (localAccounts || []).map((local) => {
    const remote = remoteById[local.accountId];
    const broker = canonicalBrokerId(remote?.broker || local.broker);
    const defaultCredentials = defaultCredentialsByBroker[broker] || {};
    if (!remote) {
      const keys = BROKER_FIELD_CONFIG[broker] || [];
      const mergedCredentials = { ...(local.credentials || {}) };
      for (const key of keys) {
        const localValue = mergedCredentials[key];
        const defaultValue = defaultCredentials[key];
        if (!hasCredentialValue(localValue) && hasCredentialValue(defaultValue)) {
          mergedCredentials[key] = defaultValue;
          changed = true;
        }
      }
      return {
        ...local,
        broker,
        credentials: mergedCredentials,
      };
    }

    const keys = BROKER_FIELD_CONFIG[broker] || [];
    const mergedCredentials = { ...(local.credentials || {}) };

    for (const key of keys) {
      const localValue = mergedCredentials[key];
      const remoteValue = remote.credentials?.[key];
      const defaultValue = defaultCredentials[key];
      if (!hasCredentialValue(localValue) && hasCredentialValue(remoteValue)) {
        mergedCredentials[key] = remoteValue;
        changed = true;
      } else if (!hasCredentialValue(localValue) && !hasCredentialValue(remoteValue) && hasCredentialValue(defaultValue)) {
        mergedCredentials[key] = defaultValue;
        changed = true;
      }
    }

    const mergedMode = "live";
    if (mergedMode !== local.mode) {
      changed = true;
    }

    return {
      ...local,
      broker,
      mode: mergedMode,
      credentials: mergedCredentials,
    };
  });

  const localById = new Set((localAccounts || []).map((account) => account.accountId));
  for (const remote of remoteAccounts || []) {
    if (!remote || localById.has(remote.accountId)) {
      continue;
    }
    const broker = canonicalBrokerId(remote.broker);
    const keys = BROKER_FIELD_CONFIG[broker] || [];
    const defaultCredentials = defaultCredentialsByBroker[broker] || {};
    const credentials = mergeCredentialSources(keys, [
      remote.credentials || {},
      defaultCredentials,
    ]);
    accounts.push({
      accountId: remote.accountId,
      broker,
      label: remote.label || remote.accountId,
      mode: "live",
      credentials,
    });
    changed = true;
  }

  return { accounts, changed };
}

function hasCredentialValue(value) {
  if (value == null) {
    return false;
  }
  const text = String(value).trim();
  if (!text) {
    return false;
  }
  if (isMaskedCredentialPlaceholder(text)) {
    return false;
  }
  return true;
}

function isMaskedCredentialPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (/^(masked|redacted|hidden)$/i.test(text)) {
    return true;
  }
  return /^[*•xX#\-_.]{4,}$/.test(text);
}

function mergeCredentialSources(keys, sources) {
  const merged = {};
  for (const key of keys || []) {
    for (const source of sources || []) {
      const value = source?.[key];
      if (!hasCredentialValue(value)) {
        continue;
      }
      merged[key] = String(value);
      break;
    }
  }
  return merged;
}

const FIELD_META = {
  etrade: {
    ETRADE_PROD_KEY: {
      label: "Prod API Key",
      placeholder: "Production consumer key",
    },
    ETRADE_PROD_SECRET: {
      label: "Prod Secret",
      placeholder: "Production consumer secret",
    },
    ETRADE_SB_KEY: {
      label: "Sandbox Key",
      placeholder: "Sandbox consumer key",
    },
    ETRADE_SB_SECRET: {
      label: "Sandbox Secret",
      placeholder: "Sandbox consumer secret",
    },
    ETRADE_ACCESS_TOKEN: {
      label: "Access Token",
      placeholder: "From OAuth flow (auto-populated)",
    },
    ETRADE_ACCESS_SECRET: {
      label: "Access Secret",
      placeholder: "From OAuth flow (auto-populated)",
    },
    ETRADE_VERIFIER: {
      label: "Verifier Code",
      placeholder: "6-char code from E*Trade auth page",
    },
    ETRADE_ACCOUNT_ID_KEY: {
      label: "Account ID Key",
      placeholder: "Optional specific E*Trade accountIdKey",
    },
    ETRADE_WEB_USERNAME: {
      label: "Web Username",
      placeholder: "E*Trade web login username",
    },
    ETRADE_WEB_PASSWORD: {
      label: "Web Password",
      placeholder: "E*Trade web login password",
    },
    ETRADE_TOTP_SECRET: {
      label: "TOTP Secret",
      placeholder: "Optional MFA TOTP seed",
    },
    ETRADE_AUTH_CALLBACK_URL: {
      label: "OAuth Callback URL",
      placeholder: "Use oob when callback is not registered",
    },
  },
  webull: {
    WEBULL_CLIENT_ID: {
      label: "Connect Client ID",
      placeholder: "Webull Connect client_id",
    },
    WEBULL_CLIENT_SECRET: {
      label: "Connect Client Secret",
      placeholder: "Webull Connect client_secret",
    },
    WEBULL_OAUTH_SCOPE: {
      label: "Connect Scope",
      placeholder: "OAuth scope from Webull Connect",
    },
    WEBULL_OAUTH_REDIRECT_URI: {
      label: "Connect Redirect URI",
      placeholder: "Registered OAuth redirect URI",
    },
    WEBULL_APP_KEY: {
      label: "App Key",
      placeholder: "OpenAPI app key for market data",
    },
    WEBULL_APP_SECRET: {
      label: "App Secret",
      placeholder: "OpenAPI app secret for market data",
    },
    WEBULL_TRADE_PIN: {
      label: "Trade PIN",
      placeholder: "6-digit PIN",
    },
    WEBULL_EMAIL: {
      label: "Email",
      placeholder: "Legacy fallback only",
    },
    WEBULL_PASSWORD: {
      label: "Password",
      placeholder: "Legacy fallback only",
    },
  },
  ibkr: {
    IBKR_BASE_URL: {
      label: "Gateway Base URL",
      placeholder: "https://127.0.0.1:5000 or http://127.0.0.1:5001",
    },
    IBKR_ACCOUNT_ID: {
      label: "Account ID",
      placeholder: "IBKR account code",
    },
    IBKR_USERNAME: {
      label: "Username",
      placeholder: "Optional username",
    },
    IBKR_PASSWORD: {
      label: "Password",
      placeholder: "Optional password",
    },
    IBKR_ALLOW_INSECURE_TLS: {
      label: "Allow Insecure TLS",
      placeholder: "true for local self-signed HTTPS gateway",
    },
  },
  data: {
    MASSIVE_API_KEY: {
      label: "Massive API Key",
      placeholder: "Primary historical options data key",
    },
    POLYGON_API_KEY: {
      label: "Polygon API Key",
      placeholder: "Fallback alias for options history access",
    },
    UW_API_KEY: {
      label: "Unusual Whales Token",
      placeholder: "Optional flow and sentiment token",
    },
  },
};

function credentialFieldMeta(broker, key) {
  const meta = FIELD_META[String(broker || "").toLowerCase()]?.[key];
  if (meta) {
    return meta;
  }
  return {
    label: key,
    placeholder: key,
  };
}

const cellStyle = {
  padding: "6px 4px",
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

function btnStyle(variant) {
  const base = {
    border: "none",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    padding: "8px 10px",
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

  if (variant === "danger") {
    return {
      ...base,
      background: `${T.red}18`,
      color: T.red,
      border: `1px solid ${T.red}50`,
      padding: "4px 8px",
      fontSize: 11,
    };
  }

  return {
    ...base,
    background: "transparent",
    color: T.muted,
    border: `1px solid ${T.border}`,
  };
}

function authStateColor(state) {
  if (state === "authenticated") return T.green;
  if (state === "configured") return T.accent;
  if (state === "needs_login" || state === "needs_token" || state === "subscription_required") return T.amber;
  if (state === "missing_credentials") return T.red;
  if (state === "degraded" || state === "error") return T.red;
  return T.muted;
}

function compactAuthStateLabel(state) {
  switch (String(state || "").toLowerCase()) {
    case "authenticated":
      return "live";
    case "configured":
      return "set";
    case "needs_login":
      return "login";
    case "needs_token":
      return "token";
    case "subscription_required":
      return "sub";
    case "missing_credentials":
      return "missing";
    case "degraded":
      return "degraded";
    case "mixed":
      return "mixed";
    case "error":
      return "error";
    default:
      return String(state || "unknown").replace(/_/g, " ");
  }
}

function statusLaneColor(state) {
  const normalized = String(state || "").toLowerCase();
  if (normalized === "live") return T.green;
  if (normalized === "configured" || normalized === "connecting") return T.accent;
  if (normalized === "needs_login" || normalized === "needs_token" || normalized === "needs_refresh" || normalized === "subscription_required") return T.amber;
  if (normalized === "missing_credentials" || normalized === "degraded" || normalized === "error") return T.red;
  return T.muted;
}

function getAccountSetupActionLabel({ configuredCount, connectionState }) {
  if (Number(configuredCount) > 0 || String(connectionState || "").toLowerCase() !== "disconnected") {
    return "Update Setup";
  }
  return "Connect";
}

function getAccountAuthActionLabel(broker) {
  const normalized = String(broker || "").toLowerCase();
  if (normalized === "webull") {
    return "Refresh Token";
  }
  if (normalized === "etrade") {
    return "Check Session";
  }
  return "Refresh Auth";
}

function getAccountAuthBusyLabel(broker) {
  const normalized = String(broker || "").toLowerCase();
  if (normalized === "webull") {
    return "Refreshing...";
  }
  if (normalized === "etrade") {
    return "Checking...";
  }
  return "Auth...";
}

function getBrokerOperationalHint({
  broker,
  authState,
  tradingState,
  marketDataState,
  marketDataMessage,
  oauth,
}) {
  const normalizedBroker = String(broker || "").toLowerCase();
  if (normalizedBroker === "webull") {
    const hasConnectConfig = Boolean(oauth?.hasClientId) && Boolean(oauth?.hasClientSecret);
    if (marketDataState === "subscription_required") {
      return marketDataMessage || "Webull market data permission is missing. Subscribe to stock quotes in Webull OpenAPI.";
    }
    if (marketDataState === "live" && tradingState !== "live") {
      return "Webull market data is live, but trading is still blocked until the linked brokerage account is resolved.";
    }
    if (!hasConnectConfig) {
      return "Webull market data and Webull trading are tracked separately. Add Webull Connect client credentials for trading/account access, and keep OpenAPI app credentials for market data.";
    }
    if (String(authState || "").toLowerCase() === "needs_login") {
      return "Webull Connect client credentials are present, but trading still needs an OAuth login. Use Start OAuth below to link the brokerage session.";
    }
    return "Webull market data and Webull trading are tracked separately. The OpenAPI token powers market data first; Connect OAuth links the brokerage account for trading.";
  }
  if (normalizedBroker === "etrade") {
    if (Boolean(oauth?.likelyExpiredByDate)) {
      return "Same-day renewal stops working after the ET day rollover. Start a fresh login with Connect E*TRADE.";
    }
    if (String(authState || "").toLowerCase() === "needs_token") {
      return "The stored E*TRADE token is no longer accepted. Start a fresh login with Connect E*TRADE.";
    }
    return "Check Session handles same-day token refresh. Use Connect E*TRADE only when you need a fresh login.";
  }
  if (normalizedBroker === "data") {
    return "Research reads these keys automatically for historical option replay and optional flow datasets. Manage them here instead of in the Research tab.";
  }
  return null;
}

function getVisibleCredentialEditorKeys({ broker, keys }) {
  const normalizedBroker = String(broker || "").toLowerCase();
  if (normalizedBroker !== "etrade") {
    return keys;
  }
  const hiddenManagedKeys = new Set([
    "ETRADE_ACCESS_TOKEN",
    "ETRADE_ACCESS_SECRET",
    "ETRADE_VERIFIER",
  ]);
  return (Array.isArray(keys) ? keys : []).filter((key) => !hiddenManagedKeys.has(key));
}

function getEtradeCallbackMode(callbackUrl) {
  const normalized = String(callbackUrl || "").trim().toLowerCase();
  if (!normalized || normalized === "oob" || normalized === "urn:ietf:wg:oauth:1.0:oob") {
    return "oob";
  }
  return "redirect";
}

function formatOAuthTimestamp(value) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}
