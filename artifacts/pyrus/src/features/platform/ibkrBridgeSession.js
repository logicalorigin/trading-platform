export const IBKR_BRIDGE_SESSION_KEYS = {
  activationId: "pyrus.ibkrBridgeActivationId",
  launchUrl: "pyrus.ibkrBridgeLaunchUrl",
  launchInFlightUntil: "pyrus.ibkrBridgeLaunchInFlightUntil",
  managementToken: "pyrus.ibkrBridgeManagementToken",
};

const RETIRED_IBKR_BRIDGE_SESSION_KEYS = {
  activationId: ["ray", "algo.ibkrBridgeActivationId"].join(""),
  launchUrl: ["ray", "algo.ibkrBridgeLaunchUrl"].join(""),
  launchInFlightUntil: ["ray", "algo.ibkrBridgeLaunchInFlightUntil"].join(""),
  managementToken: ["ray", "algo.ibkrBridgeManagementToken"].join(""),
};

export const IBKR_BRIDGE_LAUNCH_COOLDOWN_MS = 90_000;
export const IBKR_BRIDGE_CREDENTIAL_LAUNCH_WINDOW_MS = 10 * 60_000;
export const IBKR_RECONNECT_REQUEST_EVENT = "pyrus:ibkr-reconnect-request";

export const openIbkrProtocolLauncher = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const documentRef = window.document;
  const parent = documentRef?.body || documentRef?.documentElement;
  if (!documentRef?.createElement || !parent?.appendChild) {
    return null;
  }

  const iframe = documentRef.createElement("iframe");
  iframe.setAttribute?.("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.position = "absolute";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.left = "-9999px";
  parent.appendChild(iframe);
  return iframe;
};

export const closeIbkrProtocolLauncher = (launcher) => {
  try {
    launcher?.remove?.();
  } catch {
    // Best effort cleanup for browsers with unusual protocol prompt behavior.
  }
};

export const requestIbkrReconnect = () => {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return false;
  }

  const detail = {
    requestedAt: Date.now(),
    source: "ibkr-reconnect-action",
  };
  const CustomEventCtor = window.CustomEvent || globalThis.CustomEvent;
  if (typeof CustomEventCtor === "function") {
    return window.dispatchEvent(
      new CustomEventCtor(IBKR_RECONNECT_REQUEST_EVENT, { detail }),
    );
  }

  const EventCtor = window.Event || globalThis.Event;
  if (typeof EventCtor === "function") {
    const event = new EventCtor(IBKR_RECONNECT_REQUEST_EVENT);
    Object.defineProperty(event, "detail", {
      configurable: true,
      value: detail,
    });
    return window.dispatchEvent(event);
  }

  return window.dispatchEvent({
    type: IBKR_RECONNECT_REQUEST_EVENT,
    detail,
  });
};

const getIbkrBridgeSessionStorageKeys = (key) => {
  const entries = Object.keys(IBKR_BRIDGE_SESSION_KEYS).map((name) => [
    IBKR_BRIDGE_SESSION_KEYS[name],
    RETIRED_IBKR_BRIDGE_SESSION_KEYS[name],
  ]);
  const match = entries.find(([primary, retired]) => key === primary || key === retired);
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

export const shouldUseRemoteIbkrLaunchBrowser = ({
  desktopAgentCompatible = true,
  desktopAgentOnline = false,
  desktopAgentUpgradeRequired = false,
} = {}) => {
  if (typeof navigator === "undefined") {
    return false;
  }

  // A Windows browser can invoke the registered local protocol directly. The
  // remote desktop-agent path intentionally starts the helper child hidden, so
  // using it for local Windows clicks makes a valid launch look inert.
  if (isWindowsIbkrLaunchBrowser()) {
    return false;
  }

  // Remote launch only works when a desktop helper is actively polling Pyrus.
  // A stale helper cannot claim the queued job, so use the direct protocol path
  // for repair/update launches instead of leaving the UI waiting.
  if (!desktopAgentOnline) {
    return false;
  }
  if (desktopAgentUpgradeRequired || desktopAgentCompatible === false) {
    return false;
  }

  return true;
};

export const navigateIbkrProtocolLauncher = (launcher, url) => {
  if (!url || typeof window === "undefined") {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  if (!/^pyrus-ibkr:\/\//i.test(String(url))) {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  let target = launcher;
  try {
    target = launcher || openIbkrProtocolLauncher();
    if (!target) {
      return false;
    }
    target.src = url;
    window.setTimeout?.(() => closeIbkrProtocolLauncher(target), 5_000);
    return true;
  } catch {
    // Clean up the iframe we created here, not the (possibly null) argument,
    // so a failed src assignment cannot orphan a freshly-created launcher.
    closeIbkrProtocolLauncher(target);
    return false;
  }
};

export const readIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined") {
    return null;
  }

  const [primaryKey, retiredKey] = getIbkrBridgeSessionStorageKeys(key);
  const readFrom = (storage, storageKey) => {
    if (!storage || !storageKey) return null;
    return storage.getItem(storageKey) || null;
  };

  try {
    const value =
      readFrom(window.sessionStorage, primaryKey) ||
      readFrom(window.sessionStorage, retiredKey) ||
      readFrom(window.localStorage, primaryKey) ||
      readFrom(window.localStorage, retiredKey) ||
      null;
    if (value && retiredKey) {
      writeIbkrBridgeSessionValue(primaryKey, value);
    }
    return value;
  } catch {
    try {
      const value =
        readFrom(window.localStorage, primaryKey) ||
        readFrom(window.localStorage, retiredKey) ||
        null;
      if (value && retiredKey) {
        writeIbkrBridgeSessionValue(primaryKey, value);
      }
      return value;
    } catch {
      return null;
    }
  }
};

export const writeIbkrBridgeSessionValue = (key, value) => {
  if (!value || typeof window === "undefined") {
    return;
  }

  const [primaryKey, retiredKey] = getIbkrBridgeSessionStorageKeys(key);
  try {
    window.sessionStorage?.setItem(primaryKey, value);
    if (retiredKey && retiredKey !== primaryKey) {
      window.sessionStorage?.removeItem(retiredKey);
    }
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
  try {
    window.localStorage?.setItem(primaryKey, value);
    if (retiredKey && retiredKey !== primaryKey) {
      window.localStorage?.removeItem(retiredKey);
    }
  } catch {
    // Local storage lets bridge controls survive a reload; ignore write failures.
  }
};

export const removeIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined") {
    return;
  }

  const [primaryKey, retiredKey] = getIbkrBridgeSessionStorageKeys(key);
  try {
    window.sessionStorage?.removeItem(primaryKey);
    if (retiredKey) window.sessionStorage?.removeItem(retiredKey);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
  try {
    window.localStorage?.removeItem(primaryKey);
    if (retiredKey) window.localStorage?.removeItem(retiredKey);
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
      ...Object.values(RETIRED_IBKR_BRIDGE_SESSION_KEYS),
    ].forEach((key) => {
      window.sessionStorage?.removeItem(key);
    });
  } catch {
    // Ignore storage cleanup failures.
  }
  try {
    [
      ...Object.values(IBKR_BRIDGE_SESSION_KEYS),
      ...Object.values(RETIRED_IBKR_BRIDGE_SESSION_KEYS),
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
