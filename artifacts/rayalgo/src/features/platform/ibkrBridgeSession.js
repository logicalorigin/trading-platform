export const IBKR_BRIDGE_SESSION_KEYS = {
  launchUrl: "rayalgo.ibkrBridgeLaunchUrl",
  launchInFlightUntil: "rayalgo.ibkrBridgeLaunchInFlightUntil",
  managementToken: "rayalgo.ibkrBridgeManagementToken",
};

export const IBKR_BRIDGE_LAUNCH_COOLDOWN_MS = 90_000;

export const openIbkrProtocolLauncher = () => {
  return null;
};

export const closeIbkrProtocolLauncher = (launcher) => {
  void launcher;
};

export const navigateIbkrProtocolLauncher = (launcher, url) => {
  if (!url || typeof window === "undefined") {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  if (!/^rayalgo-ibkr:\/\//i.test(String(url))) {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  try {
    const anchor = window.document?.createElement?.("a");
    if (!anchor) {
      return false;
    }
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.target = "_self";
    anchor.style.display = "none";
    const parent = window.document.body || window.document.documentElement;
    parent?.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => anchor.remove(), 250);
    return true;
  } catch {
    try {
      window.location.assign(url);
      return true;
    } catch {
      return false;
    }
  }
};

export const readIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return (
      window.sessionStorage?.getItem(key) ||
      window.localStorage?.getItem(key) ||
      null
    );
  } catch {
    try {
      return window.localStorage?.getItem(key) || null;
    } catch {
      return null;
    }
  }
};

export const writeIbkrBridgeSessionValue = (key, value) => {
  if (!value || typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Local storage lets bridge controls survive a reload; ignore write failures.
  }
};

export const removeIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage?.removeItem(key);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore local storage cleanup failures.
  }
};

export const clearIbkrBridgeSessionValues = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      window.sessionStorage?.removeItem(key);
    });
  } catch {
    // Ignore storage cleanup failures.
  }
  try {
    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      window.localStorage?.removeItem(key);
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
