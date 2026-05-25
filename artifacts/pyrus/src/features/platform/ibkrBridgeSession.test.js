import assert from "node:assert/strict";
import test from "node:test";
import {
  IBKR_BRIDGE_SESSION_KEYS,
  IBKR_RECONNECT_REQUEST_EVENT,
  clearIbkrBridgeSessionValues,
  isMobileIbkrLaunchBrowser,
  isReplitPreviewIbkrLaunchBrowser,
  isWindowsIbkrLaunchBrowser,
  navigateIbkrProtocolLauncher,
  readIbkrBridgeSessionValue,
  removeIbkrBridgeSessionValue,
  requestIbkrReconnect,
  shouldUseRemoteIbkrLaunchBrowser,
  writeIbkrBridgeSessionValue,
} from "./ibkrBridgeSession.js";

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const replaceNavigator = (value) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    } else {
      delete globalThis.navigator;
    }
  };
};

test("IBKR bridge session values survive reload fallback through local storage", () => {
  const originalWindow = globalThis.window;
  const sessionStorage = createMemoryStorage();
  const localStorage = createMemoryStorage();
  globalThis.window = {
    sessionStorage,
    localStorage,
  };

  try {
    writeIbkrBridgeSessionValue(
      IBKR_BRIDGE_SESSION_KEYS.managementToken,
      "management-token",
    );

    sessionStorage.removeItem(IBKR_BRIDGE_SESSION_KEYS.managementToken);

    assert.equal(
      readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken),
      "management-token",
    );

    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken);
    assert.equal(
      readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken),
      null,
    );
  } finally {
    globalThis.window = originalWindow;
  }
});

test("IBKR bridge session clear removes launcher values from both storage scopes", () => {
  const originalWindow = globalThis.window;
  const sessionStorage = createMemoryStorage();
  const localStorage = createMemoryStorage();
  globalThis.window = {
    sessionStorage,
    localStorage,
  };

  try {
    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      sessionStorage.setItem(key, `session-${key}`);
      localStorage.setItem(key, `local-${key}`);
    });

    clearIbkrBridgeSessionValues();

    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      assert.equal(sessionStorage.getItem(key), null);
      assert.equal(localStorage.getItem(key), null);
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("IBKR reconnect request dispatches the browser reconnect intent", () => {
  const originalWindow = globalThis.window;
  const events = [];
  globalThis.window = {
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };

  try {
    assert.equal(requestIbkrReconnect(), true);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, IBKR_RECONNECT_REQUEST_EVENT);
    assert.equal(events[0].detail.source, "ibkr-reconnect-action");
    assert.equal(Number.isFinite(events[0].detail.requestedAt), true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("IBKR bridge mobile launch detection covers phone and coarse-pointer browsers", () => {
  const originalWindow = globalThis.window;
  const restoreNavigator = replaceNavigator({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  });
  globalThis.window = {
    innerWidth: 390,
    matchMedia: () => ({ matches: false }),
  };

  try {
    assert.equal(isMobileIbkrLaunchBrowser(), true);

    restoreNavigator();
    replaceNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    globalThis.window = {
      innerWidth: 820,
      matchMedia: () => ({ matches: true }),
    };
    assert.equal(isMobileIbkrLaunchBrowser(), true);

    globalThis.window = {
      innerWidth: 1280,
      matchMedia: () => ({ matches: true }),
    };
    assert.equal(isMobileIbkrLaunchBrowser(), false);
  } finally {
    restoreNavigator();
    globalThis.window = originalWindow;
  }
});

test("IBKR bridge remote launch detection covers Replit preview browsers", () => {
  const originalWindow = globalThis.window;
  const restoreNavigator = replaceNavigator({
    platform: "Linux x86_64",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0.0.0",
  });
  globalThis.window = {
    document: { referrer: "" },
    innerWidth: 1280,
    location: { hostname: "abc-00-example.riker.replit.dev" },
    matchMedia: () => ({ matches: false }),
  };

  try {
    assert.equal(isMobileIbkrLaunchBrowser(), false);
    assert.equal(isReplitPreviewIbkrLaunchBrowser(), true);
    assert.equal(isWindowsIbkrLaunchBrowser(), false);
    assert.equal(shouldUseRemoteIbkrLaunchBrowser(), true);

    globalThis.window = {
      document: { referrer: "https://replit.com/@owner/pyrus" },
      innerWidth: 1280,
      location: { hostname: "localhost" },
      matchMedia: () => ({ matches: false }),
    };
    assert.equal(isReplitPreviewIbkrLaunchBrowser(), true);
    assert.equal(shouldUseRemoteIbkrLaunchBrowser(), true);
  } finally {
    restoreNavigator();
    globalThis.window = originalWindow;
  }
});

test("IBKR bridge remote launch detection uses the desktop agent from non-Windows browsers", () => {
  const originalWindow = globalThis.window;
  const restoreNavigator = replaceNavigator({
    platform: "MacIntel",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  });
  globalThis.window = {
    document: { referrer: "" },
    innerWidth: 1180,
    location: { hostname: "pyrus.example.test" },
    matchMedia: () => ({ matches: true }),
  };

  try {
    assert.equal(isMobileIbkrLaunchBrowser(), false);
    assert.equal(isReplitPreviewIbkrLaunchBrowser(), false);
    assert.equal(isWindowsIbkrLaunchBrowser(), false);
    assert.equal(shouldUseRemoteIbkrLaunchBrowser(), true);
  } finally {
    restoreNavigator();
    globalThis.window = originalWindow;
  }
});

test("IBKR bridge remote launch detection uses the desktop agent from Windows browsers", () => {
  const originalWindow = globalThis.window;
  const restoreNavigator = replaceNavigator({
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0",
  });
  globalThis.window = {
    document: { referrer: "" },
    innerWidth: 1280,
    location: { hostname: "abc-00-example.riker.replit.dev" },
    matchMedia: () => ({ matches: false }),
  };

  try {
    assert.equal(isMobileIbkrLaunchBrowser(), false);
    assert.equal(isReplitPreviewIbkrLaunchBrowser(), true);
    assert.equal(isWindowsIbkrLaunchBrowser(), true);
    assert.equal(shouldUseRemoteIbkrLaunchBrowser(), true);
  } finally {
    restoreNavigator();
    globalThis.window = originalWindow;
  }
});

test("IBKR protocol navigation uses only the Pyrus launch scheme", () => {
  const originalWindow = globalThis.window;
  const clicked = [];
  const removed = [];
  const appended = [];
  globalThis.window = {
    document: {
      body: {
        appendChild: (node) => appended.push(node),
      },
      createElement: () => ({
        click: () => clicked.push(true),
        remove: () => removed.push(true),
        style: {},
      }),
      documentElement: null,
    },
    setTimeout: (fn) => {
      fn();
    },
  };

  try {
    assert.equal(
      navigateIbkrProtocolLauncher(null, "pyrus-ibkr://launch?x=1"),
      true,
    );
    assert.equal(
      navigateIbkrProtocolLauncher(null, "https://example.test/launch"),
      false,
    );
    assert.equal(clicked.length, 1);
    assert.equal(removed.length, 1);
    assert.equal(appended.length, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});
