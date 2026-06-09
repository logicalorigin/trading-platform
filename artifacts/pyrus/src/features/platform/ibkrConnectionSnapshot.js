const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const firstBoolean = (...values) =>
  values.find((value) => typeof value === "boolean");

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const countAccounts = (...values) => {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 0;
};

const defaultActivationDiagnostics = {
  active: false,
  latestActivation: null,
  latestProgress: null,
  recentProgress: [],
};

const hasLaunchActivity = (input = {}, nowMs = Date.now()) => {
  const launch = input || {};
  return Boolean(
    launch.busy ||
      launch.cancelInFlight ||
      launch.activationId ||
      launch.managementToken ||
      launch.inFlight ||
      (Number.isFinite(launch.inFlightUntil) && launch.inFlightUntil > nowMs),
  );
};

export const buildIbkrConnectionSnapshot = ({
  session = null,
  connection = null,
  runtime = null,
  launch = null,
  nowMs = Date.now(),
} = {}) => {
  const bridge = session?.ibkrBridge || null;
  const runtimeIbkr = runtime || session?.runtime?.ibkr || {};
  const activation =
    runtimeIbkr.activation || defaultActivationDiagnostics;
  const configured = Boolean(
    firstBoolean(
      connection?.configured,
      bridge?.configured,
      session?.configured?.ibkr,
    ),
  );
  const accountCount = countAccounts(
    runtimeIbkr.accountCount,
    bridge?.accountCount,
    bridge?.accounts,
    connection?.accounts,
  );
  const bridgeReachable = firstBoolean(
    connection?.bridgeReachable,
    bridge?.bridgeReachable,
    runtimeIbkr.bridgeReachable,
    runtimeIbkr.reachable,
    connection?.reachable,
    bridge?.connected,
  );
  const socketConnected = firstBoolean(
    connection?.socketConnected,
    bridge?.socketConnected,
    runtimeIbkr.socketConnected,
    runtimeIbkr.connected,
    bridge?.socketConnected,
    connection?.reachable,
    bridge?.connected,
  );
  const brokerServerConnected = firstBoolean(
    connection?.brokerServerConnected,
    bridge?.brokerServerConnected,
    runtimeIbkr.brokerServerConnected,
    socketConnected === true ? true : undefined,
  );
  const authenticated = firstBoolean(
    connection?.authenticated,
    bridge?.authenticated,
    runtimeIbkr.authenticated,
  );
  const accountsLoaded = firstBoolean(
    connection?.accountsLoaded,
    bridge?.accountsLoaded,
    runtimeIbkr.accountsLoaded,
    accountCount > 0 ? true : undefined,
  );
  const marketDataMode = firstValue(
    connection?.marketDataMode,
    bridge?.marketDataMode,
    runtimeIbkr.marketDataMode,
  );
  const liveMarketDataAvailable = firstBoolean(
    connection?.liveMarketDataAvailable,
    bridge?.liveMarketDataAvailable,
    runtimeIbkr.liveMarketDataAvailable,
  );
  const configuredLiveMarketDataMode = firstBoolean(
    connection?.configuredLiveMarketDataMode,
    bridge?.configuredLiveMarketDataMode,
    runtimeIbkr.configuredLiveMarketDataMode,
    String(marketDataMode || "").toLowerCase() === "live"
      ? true
      : liveMarketDataAvailable === false
        ? false
        : undefined,
  );
  const streamFresh = firstBoolean(
    connection?.streamFresh,
    bridge?.streamFresh,
    runtimeIbkr.streamFresh,
  );
  const streamState = firstValue(
    connection?.streamState,
    bridge?.streamState,
    runtimeIbkr.streamState,
  );
  const streamStateReason = firstValue(
    connection?.streamStateReason,
    bridge?.streamStateReason,
    runtimeIbkr.streamStateReason,
  );
  const healthFresh = firstBoolean(
    connection?.healthFresh,
    bridge?.healthFresh,
    runtimeIbkr.healthFresh,
  );
  const strictReady = firstBoolean(
    connection?.strictReady,
    bridge?.strictReady,
    runtimeIbkr.strictReady,
    healthFresh === true &&
      bridgeReachable === true &&
      socketConnected === true &&
      brokerServerConnected !== false &&
      authenticated === true &&
      accountsLoaded === true &&
      configuredLiveMarketDataMode === true &&
      streamFresh === true
      ? true
      : undefined,
  );
  const connected = firstBoolean(
    connection?.connected,
    bridge?.connected,
    runtimeIbkr.connected,
    socketConnected,
    connection?.reachable,
  );
  const brokerProofEnabled = configured === true;
  const effectiveBridgeReachable = brokerProofEnabled ? bridgeReachable : false;
  const effectiveSocketConnected = brokerProofEnabled ? socketConnected : false;
  const effectiveBrokerServerConnected = brokerProofEnabled
    ? brokerServerConnected
    : false;
  const effectiveAuthenticated = brokerProofEnabled ? authenticated : false;
  const effectiveAccountsLoaded = brokerProofEnabled ? accountsLoaded : false;
  const effectiveConfiguredLiveMarketDataMode = brokerProofEnabled
    ? configuredLiveMarketDataMode
    : false;
  const effectiveStreamFresh = brokerProofEnabled ? streamFresh : false;
  const effectiveHealthFresh = brokerProofEnabled ? healthFresh : false;
  const effectiveStrictReady = brokerProofEnabled ? strictReady : false;
  const effectiveConnected = brokerProofEnabled ? connected : false;
  const launchActivityPresent = hasLaunchActivity(launch, nowMs);
  const activationActive = Boolean(activation?.active || activation?.latestActivation);
  const activityPresent = Boolean(
    launchActivityPresent ||
      activationActive ||
      configured ||
      effectiveConnected ||
      effectiveAuthenticated ||
      effectiveBridgeReachable ||
      effectiveSocketConnected ||
      runtimeIbkr.desktopAgentOnline ||
      runtimeIbkr.runtimeOverrideActive,
  );
  const selectedAccountId = firstValue(
    runtimeIbkr.selectedAccountId,
    bridge?.selectedAccountId,
    connection?.selectedAccountId,
  );
  const target = firstValue(
    runtimeIbkr.connectionTarget,
    bridge?.connectionTarget,
    connection?.target,
  );
  const sessionMode = firstValue(
    runtimeIbkr.sessionMode,
    bridge?.sessionMode,
    connection?.mode,
    session?.environment,
  );
  const clientId = firstValue(
    runtimeIbkr.clientId,
    bridge?.clientId,
    connection?.clientId,
  );

  return {
    available: activityPresent,
    activityPresent,
    lineUsageEnabled: Boolean(configured || activityPresent),
    source: "session",
    runtimeDiagnostics: {
      timestamp: session?.timestamp || new Date(nowMs).toISOString(),
      ibkr: {
        transport: "tws",
        configured,
        bridgeUrlConfigured: Boolean(
          runtimeIbkr.runtimeOverrideActive ||
            (brokerProofEnabled && (bridge || effectiveBridgeReachable)),
        ),
        bridgeTokenConfigured: runtimeIbkr.bridgeTokenConfigured,
        runtimeOverrideActive: Boolean(runtimeIbkr.runtimeOverrideActive),
        runtimeOverrideUpdatedAt: runtimeIbkr.runtimeOverrideUpdatedAt ?? null,
        desktopAgentOnline: Boolean(runtimeIbkr.desktopAgentOnline),
        desktopAgentRegistered: Boolean(runtimeIbkr.desktopAgentRegistered),
        desktopAgentRegisteredCount:
          toFiniteNumber(runtimeIbkr.desktopAgentRegisteredCount) ?? 0,
        desktopAgentCompatibility:
          runtimeIbkr.desktopAgentCompatibility ?? null,
        desktopAgentCompatible: Boolean(runtimeIbkr.desktopAgentCompatible),
        desktopAgentHelperVersion:
          runtimeIbkr.desktopAgentHelperVersion ?? null,
        desktopAgentKnownBad: Boolean(runtimeIbkr.desktopAgentKnownBad),
        desktopAgentExpectedHelperVersion:
          runtimeIbkr.desktopAgentExpectedHelperVersion || "",
        desktopAgentUpgradeRequired: Boolean(
          runtimeIbkr.desktopAgentUpgradeRequired,
        ),
        reconnectAvailable: Boolean(runtimeIbkr.reconnectAvailable),
        activation,
        reachable: Boolean(effectiveBridgeReachable || effectiveConnected),
        healthError: firstValue(
          runtimeIbkr.healthError,
          bridge?.healthError,
          bridge?.lastError,
          bridge?.lastRecoveryError,
          connection?.lastError,
        ) || null,
        healthErrorCode: runtimeIbkr.healthErrorCode,
        healthErrorStatusCode: runtimeIbkr.healthErrorStatusCode,
        healthErrorDetail: runtimeIbkr.healthErrorDetail,
        connected: Boolean(effectiveConnected),
        authenticated: Boolean(effectiveAuthenticated),
        competing: brokerProofEnabled
          ? Boolean(
              firstBoolean(
                connection?.competing,
                bridge?.competing,
                runtimeIbkr.competing,
              ),
            )
          : false,
        selectedAccountId: brokerProofEnabled ? selectedAccountId || null : null,
        accountCount: brokerProofEnabled ? accountCount : 0,
        connectionTarget: brokerProofEnabled ? target || null : null,
        sessionMode: brokerProofEnabled ? sessionMode || null : null,
        clientId: brokerProofEnabled ? clientId ?? null : null,
        marketDataMode: brokerProofEnabled ? marketDataMode || null : null,
        liveMarketDataAvailable: brokerProofEnabled
          ? liveMarketDataAvailable ?? null
          : null,
        healthFresh: effectiveHealthFresh ?? false,
        healthAgeMs: brokerProofEnabled
          ? firstValue(
              connection?.healthAgeMs,
              bridge?.healthAgeMs,
              runtimeIbkr.healthAgeMs,
            ) ?? null
          : null,
        stale: firstBoolean(
          connection?.stale,
          bridge?.stale,
          runtimeIbkr.stale,
          effectiveHealthFresh === false ? true : undefined,
        ) ?? false,
        bridgeReachable: Boolean(effectiveBridgeReachable),
        socketConnected: Boolean(effectiveSocketConnected),
        brokerServerConnected: Boolean(effectiveBrokerServerConnected),
        serverConnectivity:
          brokerProofEnabled
            ? firstValue(
                connection?.serverConnectivity,
                bridge?.serverConnectivity,
                runtimeIbkr.serverConnectivity,
              ) || null
            : null,
        lastServerConnectivityAt:
          brokerProofEnabled
            ? firstValue(
                connection?.lastServerConnectivityAt,
                bridge?.lastServerConnectivityAt,
                runtimeIbkr.lastServerConnectivityAt,
              ) || null
            : null,
        lastServerConnectivityError:
          brokerProofEnabled
            ? firstValue(
                connection?.lastServerConnectivityError,
                bridge?.lastServerConnectivityError,
                runtimeIbkr.lastServerConnectivityError,
              ) || null
            : null,
        accountsLoaded: Boolean(effectiveAccountsLoaded),
        configuredLiveMarketDataMode: Boolean(
          effectiveConfiguredLiveMarketDataMode,
        ),
        streamFresh: Boolean(effectiveStreamFresh),
        streamState: brokerProofEnabled ? streamState || "offline" : "offline",
        streamStateReason: brokerProofEnabled
          ? streamStateReason || null
          : "bridge_not_configured",
        lastStreamEventAgeMs:
          brokerProofEnabled
            ? toFiniteNumber(
                firstValue(
                  connection?.lastStreamEventAgeMs,
                  bridge?.lastStreamEventAgeMs,
                  runtimeIbkr.lastStreamEventAgeMs,
                ),
              ) ?? null
            : null,
        strictReady: Boolean(effectiveStrictReady),
        strictReason:
          brokerProofEnabled
            ? firstValue(
                connection?.strictReason,
                bridge?.strictReason,
                runtimeIbkr.strictReason,
              ) || null
            : "ibkr_bridge_not_configured",
        lastTickleAt:
          brokerProofEnabled
            ? firstValue(
                connection?.lastTickleAt,
                bridge?.lastTickleAt,
                runtimeIbkr.lastTickleAt,
              ) || null
            : null,
        lastRecoveryAttemptAt:
          brokerProofEnabled
            ? firstValue(
                connection?.lastRecoveryAttemptAt,
                bridge?.lastRecoveryAttemptAt,
                runtimeIbkr.lastRecoveryAttemptAt,
              ) || null
            : null,
        lastRecoveryError:
          brokerProofEnabled
            ? firstValue(
                connection?.lastRecoveryError,
                bridge?.lastRecoveryError,
                runtimeIbkr.lastRecoveryError,
              ) || null
            : null,
        lastError:
          brokerProofEnabled
            ? firstValue(
                connection?.lastError,
                bridge?.lastError,
                runtimeIbkr.lastError,
              ) || null
            : null,
      },
    },
  };
};
