export const IBKR_BRIDGE_SESSION_KEYS = {
  launchUrl: "rayalgo.ibkrBridgeLaunchUrl",
  launchInFlightUntil: "rayalgo.ibkrBridgeLaunchInFlightUntil",
  managementToken: "rayalgo.ibkrBridgeManagementToken",
};

export const IBKR_BRIDGE_LAUNCH_COOLDOWN_MS = 90_000;

export const openIbkrProtocolLauncher = () => null;

export const closeIbkrProtocolLauncher = (launcher) => {
  if (!launcher || launcher.closed) {
    return;
  }

  try {
    launcher.close();
  } catch {
    // Ignore popup cleanup failures.
  }
};

export const navigateIbkrProtocolLauncher = (launcher, url) => {
  if (!url || typeof window === "undefined") {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  if (launcher && !launcher.closed) {
    try {
      launcher.location.href = url;
      return true;
    } catch {
      // Fall through to same-tab navigation.
    }
  }

  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
};

export const readIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key) || null;
  } catch {
    return null;
  }
};

export const writeIbkrBridgeSessionValue = (key, value) => {
  if (!value || typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
};

export const removeIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
};

export const clearIbkrBridgeSessionValues = () => {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      window.sessionStorage.removeItem(key);
    });
  } catch {
    // Ignore storage cleanup failures.
  }
};

export const invalidateIbkrRuntimeQueries = (queryClient) => {
  const stringPrefixes = [
    "/api/session",
    "/api/broker-connections",
    "/api/accounts",
    "/api/positions",
    "/api/orders",
    "/api/quotes/snapshot",
    "/api/options",
    "/api/flow/events",
  ];

  stringPrefixes.forEach((prefix) => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          typeof key[0] === "string" &&
          key[0].startsWith(prefix)
        );
      },
    });
  });

  [
    "market-sparklines",
    "market-performance-baselines",
    "trade-market-depth",
    "trade-option-chain",
    "broker-executions",
  ].forEach((key) => {
    queryClient.invalidateQueries({ queryKey: [key], exact: false });
  });
};
