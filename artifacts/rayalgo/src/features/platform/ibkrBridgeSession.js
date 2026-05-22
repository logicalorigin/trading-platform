export const IBKR_BRIDGE_SESSION_KEYS = {
  activationId: "pyrus.ibkrBridgeActivationId",
  launchUrl: "pyrus.ibkrBridgeLaunchUrl",
  launchInFlightUntil: "pyrus.ibkrBridgeLaunchInFlightUntil",
  managementToken: "pyrus.ibkrBridgeManagementToken",
};

export const LEGACY_IBKR_BRIDGE_SESSION_KEYS = {
  activationId: "rayalgo.ibkrBridgeActivationId",
  launchUrl: "rayalgo.ibkrBridgeLaunchUrl",
  launchInFlightUntil: "rayalgo.ibkrBridgeLaunchInFlightUntil",
  managementToken: "rayalgo.ibkrBridgeManagementToken",
};

export const IBKR_BRIDGE_LAUNCH_COOLDOWN_MS = 90_000;
export const IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS = 10 * 60_000;

export const openIbkrProtocolLauncher = () => {
  return null;
};

export const closeIbkrProtocolLauncher = (launcher) => {
  void launcher;
};

const getIbkrBridgeSessionStorageKeys = (key) => {
  const entries = Object.keys(IBKR_BRIDGE_SESSION_KEYS).map((name) => [
    IBKR_BRIDGE_SESSION_KEYS[name],
    LEGACY_IBKR_BRIDGE_SESSION_KEYS[name],
  ]);
  const match = entries.find(([primary, legacy]) => key === primary || key === legacy);
  return match || [key, null];
};

export const isMobileIbkrLaunchBrowser = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) {
    return true;
  }

  return window.matchMedia?.("(pointer: coarse)")?.matches === true &&
    window.innerWidth <= 900;
};

const isReplitHost = (value) => {
  const hostname = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");

  return (
    hostname === "replit.com" ||
    hostname.endsWith(".replit.com") ||
    hostname === "replit.dev" ||
    hostname.endsWith(".replit.dev") ||
    hostname === "replit.app" ||
    hostname.endsWith(".replit.app") ||
    hostname === "replitusercontent.com" ||
    hostname.endsWith(".replitusercontent.com") ||
    hostname === "repl.co" ||
    hostname.endsWith(".repl.co")
  );
};

const readHostname = (value) => {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
};

export const isReplitPreviewIbkrLaunchBrowser = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const locationHost = window.location?.hostname;
  if (isReplitHost(locationHost)) {
    return true;
  }

  const referrer = window.document?.referrer;
  return isReplitHost(readHostname(referrer));
};

export const isWindowsIbkrLaunchBrowser = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgentDataPlatform = navigator.userAgentData?.platform || "";
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /windows|win32|win64|wow64/i.test(
    `${userAgentDataPlatform} ${platform} ${userAgent}`,
  );
};

export const shouldUseRemoteIbkrLaunchBrowser = () => {
  if (isMobileIbkrLaunchBrowser()) {
    return true;
  }

  return isReplitPreviewIbkrLaunchBrowser() && !isWindowsIbkrLaunchBrowser();
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

  const [primaryKey, legacyKey] = getIbkrBridgeSessionStorageKeys(key);
  const readFrom = (storage, storageKey) => {
    if (!storage || !storageKey) return null;
    return storage.getItem(storageKey) || null;
  };

  try {
    return (
      readFrom(window.sessionStorage, primaryKey) ||
      readFrom(window.sessionStorage, legacyKey) ||
      readFrom(window.localStorage, primaryKey) ||
      readFrom(window.localStorage, legacyKey) ||
      null
    );
  } catch {
    try {
      return (
        readFrom(window.localStorage, primaryKey) ||
        readFrom(window.localStorage, legacyKey) ||
        null
      );
    } catch {
      return null;
    }
  }
};

export const writeIbkrBridgeSessionValue = (key, value) => {
  if (!value || typeof window === "undefined") {
    return;
  }

  const [primaryKey, legacyKey] = getIbkrBridgeSessionStorageKeys(key);
  try {
    window.sessionStorage?.setItem(primaryKey, value);
    if (legacyKey) window.sessionStorage?.removeItem(legacyKey);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
  try {
    window.localStorage?.setItem(primaryKey, value);
    if (legacyKey) window.localStorage?.removeItem(legacyKey);
  } catch {
    // Local storage lets bridge controls survive a reload; ignore write failures.
  }
};

export const removeIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined") {
    return;
  }

  const [primaryKey, legacyKey] = getIbkrBridgeSessionStorageKeys(key);
  try {
    window.sessionStorage?.removeItem(primaryKey);
    if (legacyKey) window.sessionStorage?.removeItem(legacyKey);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
  try {
    window.localStorage?.removeItem(primaryKey);
    if (legacyKey) window.localStorage?.removeItem(legacyKey);
  } catch {
    // Ignore local storage cleanup failures.
  }
};

export const clearIbkrBridgeSessionValues = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    [
      ...Object.values(IBKR_BRIDGE_SESSION_KEYS),
      ...Object.values(LEGACY_IBKR_BRIDGE_SESSION_KEYS),
    ].forEach((key) => {
      window.sessionStorage?.removeItem(key);
    });
  } catch {
    // Ignore storage cleanup failures.
  }
  try {
    [
      ...Object.values(IBKR_BRIDGE_SESSION_KEYS),
      ...Object.values(LEGACY_IBKR_BRIDGE_SESSION_KEYS),
    ].forEach((key) => {
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
