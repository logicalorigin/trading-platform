import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiHealth } from "./lib/brokerClient.js";
import { getRuntimeDiagnosticsSnapshot } from "./lib/runtimeDiagnostics.js";
import { APP_FONT_STACK, APP_THEME } from "./lib/uiTheme.js";

const loadResearchWorkbench = () => import("./components/ResearchWorkbench.jsx");
const loadPositionsAccountsTab = () => import("./components/PositionsAccountsTab.jsx");
const loadTradingViewPanel = () => import("./components/TradingViewPanel.jsx");
const loadMarketDashboardTab = () => import("./components/MarketDashboardTab.jsx");

const ResearchWorkbench = lazy(loadResearchWorkbench);
const PositionsAccountsTab = lazy(loadPositionsAccountsTab);
const TradingViewPanel = lazy(loadTradingViewPanel);
const MarketDashboardTab = lazy(loadMarketDashboardTab);

const LEGACY_TAB_MAP = {
  live: "backtest",
  combined: "backtest",
  optimizer: "backtest",
};

const APP_SESSION_KEY = "spy-options-app-session-v1";
const APP_SCROLL_KEY = "spy-options-app-scroll-v1";
const DEFAULT_SURFACE_BY_MODE = {
  workspace: "workspace",
  research: "backtest",
  accounts: "positions",
};

function normalizeTabId(tabId) {
  if (!tabId) return "workspace";
  return LEGACY_TAB_MAP[tabId] || tabId;
}

const SURFACES = [
  {
    id: "workspace",
    mode: "workspace",
    label: "Market",
    shortLabel: "Market",
    blurb: "Live market dashboard, order-flow, execution ladder, and AI fusion controls.",
    component: MarketDashboardTab,
    preload: loadMarketDashboardTab,
  },
  {
    id: "tradingview",
    mode: "workspace",
    label: "Automation",
    shortLabel: "Automation",
    blurb: "TradingView alerts, webhook approvals, RayAlgo parity, and broker chart context.",
    component: TradingViewPanel,
    preload: loadTradingViewPanel,
  },
  {
    id: "backtest",
    mode: "research",
    label: "Backtest",
    shortLabel: "Backtest",
    blurb: "Backtests, scenario tuning, and the integrated research workbench.",
    component: ResearchWorkbench,
    preload: loadResearchWorkbench,
  },
  {
    id: "positions",
    mode: "accounts",
    label: "Portfolio & Accounts",
    shortLabel: "Accounts",
    blurb: "Broker auth, portfolio performance, cash ledger, and account maintenance.",
    component: PositionsAccountsTab,
    preload: loadPositionsAccountsTab,
  },
];
const PRIMARY_NAV = [
  {
    id: "workspace",
    label: "Trade",
    title: "Trade",
    description: "Operate the live desk, signal bridge, and market surfaces without bouncing between unrelated tabs.",
  },
  {
    id: "research",
    label: "Research",
    title: "Research & Simulation",
    description: "Keep backtests, optimization, and pricing experiments separated from live operations.",
  },
  {
    id: "accounts",
    label: "Accounts",
    title: "Accounts & Performance",
    description: "Manage broker connectivity, portfolio truth, and account-history backfills in one place.",
  },
];
const PERSISTENT_MOUNTED_SURFACE_IDS = new Set(["positions"]);
const SURFACE_MAP = Object.fromEntries(SURFACES.map((surface) => [surface.id, surface]));

function trimText(value) {
  const text = String(value || "").trim();
  return text || null;
}

const IGNORED_GLOBAL_ERROR_PATTERNS = [
  /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)\.?$/i,
];

function isIgnoredGlobalError(errorLike, fallbackMessage = null) {
  const messages = [
    trimText(fallbackMessage),
    trimText(errorLike?.message),
    trimText(errorLike),
  ].filter(Boolean);
  return messages.some((message) => (
    IGNORED_GLOBAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ));
}

function normalizeErrorDetails(errorLike, fallbackMessage = "Unknown error") {
  if (errorLike instanceof Error) {
    return {
      errorName: trimText(errorLike.name) || "Error",
      message: trimText(errorLike.message) || fallbackMessage,
      stack: trimText(errorLike.stack),
    };
  }
  if (typeof errorLike === "string") {
    return {
      errorName: "Error",
      message: trimText(errorLike) || fallbackMessage,
      stack: null,
    };
  }
  if (errorLike && typeof errorLike === "object") {
    return {
      errorName: trimText(errorLike.name) || "Error",
      message: trimText(errorLike.message) || fallbackMessage,
      stack: trimText(errorLike.stack),
    };
  }
  return {
    errorName: "Error",
    message: fallbackMessage,
    stack: null,
  };
}

function toDiagnosticValue(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Error) {
    return normalizeErrorDetails(value);
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function safePrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildCrashReport({
  kind = "unknown",
  surfaceLabel = null,
  activeSurface = null,
  activeMode = null,
  error = null,
  componentStack = null,
  extraContext = null,
} = {}) {
  const errorDetails = normalizeErrorDetails(error, "Unknown runtime failure");
  const href = typeof window !== "undefined" ? window.location.href : null;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
  const viewport = typeof window !== "undefined"
    ? {
      width: Number(window.innerWidth) || null,
      height: Number(window.innerHeight) || null,
      scrollX: Math.round(window.scrollX || 0),
      scrollY: Math.round(window.scrollY || 0),
    }
    : null;

  return {
    crashId: `crash-${Date.now()}`,
    kind,
    surfaceLabel: trimText(surfaceLabel),
    activeSurface: trimText(activeSurface),
    activeMode: trimText(activeMode),
    href,
    userAgent,
    viewport,
    capturedAt: new Date().toISOString(),
    errorName: errorDetails.errorName,
    message: errorDetails.message,
    stack: errorDetails.stack,
    componentStack: trimText(componentStack),
    extraContext: toDiagnosticValue(extraContext),
  };
}

export default function App() {
  const initialSnapshot = readStoredJson(APP_SESSION_KEY);
  const initialActiveSurface = normalizeTabId(initialSnapshot?.activeTab);
  const [activeSurface, setActiveSurface] = useState(() => initialActiveSurface);
  const [lastSurfaceByMode, setLastSurfaceByMode] = useState(() => {
    const snapshotRows = initialSnapshot?.lastSurfaceByMode;
    const next = { ...DEFAULT_SURFACE_BY_MODE };
    for (const [mode, surfaceId] of Object.entries(snapshotRows || {})) {
      const normalizedSurface = normalizeTabId(surfaceId);
      if (SURFACE_MAP[normalizedSurface]?.mode === mode) {
        next[mode] = normalizedSurface;
      }
    }
    next[SURFACE_MAP[initialActiveSurface]?.mode || "workspace"] = initialActiveSurface;
    return next;
  });
  const loggedLegacyTabs = useRef(new Set());
  const scrollPositionsRef = useRef(readStoredJson(APP_SCROLL_KEY) || {});
  const activeMode = SURFACE_MAP[activeSurface]?.mode || "workspace";
  const modeSurfaces = useMemo(
    () => SURFACES.filter((surface) => surface.mode === activeMode),
    [activeMode],
  );
  const [mountedTabs, setMountedTabs] = useState(() => ({
    [initialActiveSurface]: true,
  }));
  const [headerUtility, setHeaderUtility] = useState(null);
  const [fatalCrashReport, setFatalCrashReport] = useState(null);
  const mountTab = useCallback((tabId) => {
    const normalized = normalizeTabId(tabId);
    if (!SURFACE_MAP[normalized]) {
      return;
    }
    setMountedTabs((prev) => {
      if (prev[normalized]) {
        return prev;
      }
      return {
        ...prev,
        [normalized]: true,
      };
    });
  }, []);

  const setSurface = useCallback((nextSurface) => {
    const normalized = normalizeTabId(nextSurface);
    const surface = SURFACE_MAP[normalized];
    if (!surface) {
      return;
    }
    setLastSurfaceByMode((prev) => ({
      ...prev,
      [surface.mode]: normalized,
    }));
    setActiveSurface(normalized);
  }, []);

  const setPrimaryMode = useCallback((nextMode) => {
    const preferredSurface = lastSurfaceByMode[nextMode] || DEFAULT_SURFACE_BY_MODE[nextMode] || "workspace";
    setSurface(preferredSurface);
  }, [lastSurfaceByMode, setSurface]);

  const preloadTab = useCallback((tabId) => {
    const normalized = normalizeTabId(tabId);
    const row = SURFACE_MAP[normalized];
    if (!row?.preload) {
      return;
    }
    row.preload().catch(() => {});
  }, []);

  const clearFatalCrash = useCallback(() => {
    if (typeof window !== "undefined") {
      delete window.__lastCrashDiagnostics;
    }
    setHeaderUtility(null);
    setFatalCrashReport(null);
  }, []);

  const mergeRuntimeExtraContext = useCallback((extraContext = null) => {
    const runtimeDiagnostics = getRuntimeDiagnosticsSnapshot();
    if (extraContext == null) {
      return { runtimeDiagnostics };
    }
    if (typeof extraContext === "object" && !Array.isArray(extraContext)) {
      return {
        ...extraContext,
        runtimeDiagnostics,
      };
    }
    return {
      value: extraContext,
      runtimeDiagnostics,
    };
  }, []);

  const captureFatalCrash = useCallback((reportInput = {}) => {
    const resolvedSurfaceLabel = reportInput.surfaceLabel
      || SURFACE_MAP[normalizeTabId(reportInput.activeSurface || activeSurface)]?.label
      || SURFACE_MAP[activeSurface]?.label
      || activeSurface;
    const report = buildCrashReport({
      ...reportInput,
      surfaceLabel: resolvedSurfaceLabel,
      activeSurface: reportInput.activeSurface || activeSurface,
      activeMode: reportInput.activeMode || activeMode,
      extraContext: mergeRuntimeExtraContext(reportInput.extraContext),
    });
    if (typeof window !== "undefined") {
      window.__lastCrashDiagnostics = report;
      window.requestAnimationFrame(() => {
        window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      });
    }
    setHeaderUtility(null);
    setFatalCrashReport((previous) => previous || report);
  }, [activeMode, activeSurface, mergeRuntimeExtraContext]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    window.__getRuntimeDiagnostics = async () => {
      const client = getRuntimeDiagnosticsSnapshot();
      try {
        const server = await getApiHealth();
        return { client, server };
      } catch (error) {
        return {
          client,
          server: {
            ok: false,
            error: error?.message || "Failed to load /api/health",
          },
        };
      }
    };
    return () => {
      if (window.__getRuntimeDiagnostics) {
        delete window.__getRuntimeDiagnostics;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const previousBg = document.body.style.background;
    const previousColor = document.body.style.color;
    const previousFont = document.body.style.fontFamily;
    document.body.style.background = APP_THEME.bg;
    document.body.style.color = APP_THEME.text;
    document.body.style.fontFamily = APP_FONT_STACK;
    return () => {
      document.body.style.background = previousBg;
      document.body.style.color = previousColor;
      document.body.style.fontFamily = previousFont;
    };
  }, []);

  useEffect(() => {
    const snapshot = readStoredJson(APP_SESSION_KEY);
    const storedActiveTab = normalizeTabId(snapshot?.activeTab);
    if (storedActiveTab !== snapshot?.activeTab && import.meta.env.DEV && !loggedLegacyTabs.current.has(snapshot?.activeTab)) {
      loggedLegacyTabs.current.add(snapshot?.activeTab);
      console.info(`[nav] mapped legacy tab "${snapshot?.activeTab}" to "${storedActiveTab}"`);
    }
  }, []);

  useEffect(() => {
    writeStoredJson(APP_SESSION_KEY, {
      activeTab: activeSurface,
      activeMode,
      lastSurfaceByMode,
      savedAt: new Date().toISOString(),
    });
  }, [activeMode, activeSurface, lastSurfaceByMode]);

  useEffect(() => {
    mountTab(activeSurface);
  }, [activeSurface]);

  useEffect(() => {
    let cancelled = false;
    const preloadIdleTabs = async () => {
      for (const row of SURFACES) {
        if (cancelled || row.id === activeSurface || typeof row.preload !== "function") {
          continue;
        }
        try {
          await row.preload();
        } catch {
          // Keep preloading best-effort.
        }
      }
    };

    if (typeof window === "undefined") {
      return undefined;
    }

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => {
        void preloadIdleTabs();
      }, { timeout: 2500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
      };
    }

    const timer = window.setTimeout(() => {
      void preloadIdleTabs();
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSurface]);

  useEffect(() => {
    if (fatalCrashReport) {
      return undefined;
    }
    const onScroll = () => {
      scrollPositionsRef.current = {
        ...(scrollPositionsRef.current || {}),
        [activeSurface]: {
          x: Math.round(window.scrollX || 0),
          y: Math.round(window.scrollY || 0),
          savedAt: new Date().toISOString(),
        },
      };
      writeStoredJson(APP_SCROLL_KEY, scrollPositionsRef.current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      onScroll();
    };
  }, [activeSurface, fatalCrashReport]);

  useEffect(() => {
    if (fatalCrashReport) {
      return undefined;
    }
    const saved = scrollPositionsRef.current?.[activeSurface];
    const x = Number(saved?.x);
    const y = Number(saved?.y);
    const raf = window.requestAnimationFrame(() => {
      window.scrollTo({
        left: Number.isFinite(x) ? x : 0,
        top: Number.isFinite(y) ? y : 0,
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeSurface, fatalCrashReport]);

  useEffect(() => {
    if (!fatalCrashReport || typeof window === "undefined") {
      return undefined;
    }
    const raf = window.requestAnimationFrame(() => {
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [fatalCrashReport]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleWindowError = (event) => {
      const target = event?.target;
      if (target && target !== window) {
        return;
      }
      const rawMessage = trimText(event?.message);
      const errorLike = event?.error || (rawMessage ? { message: rawMessage, name: "Error" } : null);
      if (!errorLike) {
        return;
      }
      // Chromium can emit ResizeObserver loop warnings during dense layout updates.
      // They are noisy but non-fatal, so keep the workspace mounted instead of swapping
      // the app into crash diagnostics for this specific browser warning.
      if (isIgnoredGlobalError(errorLike, rawMessage)) {
        return;
      }
      captureFatalCrash({
        kind: "window-error",
        error: errorLike,
        extraContext: {
          filename: trimText(event?.filename),
          line: Number.isFinite(Number(event?.lineno)) ? Number(event.lineno) : null,
          column: Number.isFinite(Number(event?.colno)) ? Number(event.colno) : null,
        },
      });
    };

    const handleUnhandledRejection = (event) => {
      const reason = event?.reason;
      if (trimText(reason?.name) === "AbortError") {
        return;
      }
      if (isIgnoredGlobalError(reason)) {
        return;
      }
      captureFatalCrash({
        kind: "unhandled-rejection",
        error: reason instanceof Error
          ? reason
          : { message: trimText(reason?.message) || trimText(reason) || "Unhandled promise rejection", name: "UnhandledRejection" },
        extraContext: {
          reason: toDiagnosticValue(reason),
        },
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.__openCrashDiagnostics = (payload = {}) => {
      captureFatalCrash({
        kind: trimText(payload.kind) || "manual-trigger",
        surfaceLabel: trimText(payload.surfaceLabel) || SURFACE_MAP[activeSurface]?.label || activeSurface,
        activeSurface: trimText(payload.activeSurface) || activeSurface,
        activeMode: trimText(payload.activeMode) || activeMode,
        error: payload.error || {
          name: trimText(payload.errorName) || "Error",
          message: trimText(payload.message) || "Manual diagnostics trigger",
          stack: trimText(payload.stack),
        },
        componentStack: trimText(payload.componentStack),
        extraContext: payload.extraContext || null,
      });
    };
    window.__clearCrashDiagnostics = clearFatalCrash;

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      if (window.__openCrashDiagnostics) {
        delete window.__openCrashDiagnostics;
      }
      if (window.__clearCrashDiagnostics) {
        delete window.__clearCrashDiagnostics;
      }
    };
  }, [activeMode, activeSurface, captureFatalCrash, clearFatalCrash]);

  if (fatalCrashReport) {
    return (
      <CrashDiagnosticsPage
        report={fatalCrashReport}
        onRetry={() => {
          const nextSurface = fatalCrashReport.activeSurface || activeSurface;
          clearFatalCrash();
          if (SURFACE_MAP[nextSurface]) {
            mountTab(nextSurface);
            setSurface(nextSurface);
          }
        }}
        onReload={() => window.location.reload()}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${APP_THEME.shell} 0%, ${APP_THEME.bg} 96px, ${APP_THEME.bgAlt} 100%)`, color: APP_THEME.text, fontFamily: APP_FONT_STACK }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          backdropFilter: "blur(12px)",
          background: "rgba(251, 253, 255, 0.92)",
          borderBottom: `1px solid ${APP_THEME.border}`,
          boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)",
        }}
      >
        <div style={{ padding: "8px clamp(10px, 2.2vw, 18px)", display: "grid", gap: modeSurfaces.length > 1 ? 6 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", flexWrap: "nowrap", maxWidth: "100%" }}>
              {PRIMARY_NAV.map((entry) => {
                const active = activeMode === entry.id;
                return (
                  <button
                    key={entry.id}
                    onClick={() => setPrimaryMode(entry.id)}
                    onMouseEnter={() => preloadTab(lastSurfaceByMode[entry.id] || DEFAULT_SURFACE_BY_MODE[entry.id])}
                    onFocus={() => preloadTab(lastSurfaceByMode[entry.id] || DEFAULT_SURFACE_BY_MODE[entry.id])}
                    style={primaryNavButtonStyle(active)}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            {activeSurface === "backtest" && headerUtility ? (
              <div
                style={{
                  marginLeft: "auto",
                  flex: "1 1 320px",
                  minWidth: 220,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                {headerUtility}
              </div>
            ) : null}
          </div>

          {modeSurfaces.length > 1 && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 1 }}>
              {modeSurfaces.map((surface) => (
                <button
                  key={surface.id}
                  onClick={() => setSurface(surface.id)}
                  onMouseEnter={() => preloadTab(surface.id)}
                  onFocus={() => preloadTab(surface.id)}
                  style={secondaryNavButtonStyle(activeSurface === surface.id)}
                  title={surface.label}
                >
                  {surface.shortLabel}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main style={{ padding: "8px clamp(8px, 2vw, 16px) 24px" }}>
        {SURFACES.map((row) => {
          const isActive = activeSurface === row.id;
          const shouldRender = isActive
            || (PERSISTENT_MOUNTED_SURFACE_IDS.has(row.id) && mountedTabs[row.id]);
          if (!shouldRender) {
            return null;
          }
          const TabComponent = row.component;
          return (
            <section
              key={row.id}
              style={{ display: isActive ? "block" : "none" }}
              aria-hidden={!isActive}
            >
              <PageErrorBoundary
                surfaceLabel={row.label || row.id}
                surfaceId={row.id}
                activeSurface={activeSurface}
                activeMode={activeMode}
                onFatalError={captureFatalCrash}
              >
                <Suspense fallback={(
                  <div style={{ padding: 20, color: APP_THEME.muted, fontSize: 13 }}>
                    Loading {row.label || "surface"}...
                  </div>
                )}
                >
                  <TabComponent isActive={isActive} navigateToSurface={setSurface} setHeaderUtility={setHeaderUtility} />
                </Suspense>
              </PageErrorBoundary>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function CrashDiagnosticsPage({ report, onRetry, onReload }) {
  const [copyState, setCopyState] = useState("idle");
  const payloadText = useMemo(() => safePrettyJson(report), [report]);
  const handleCopy = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyState("unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(payloadText);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2200);
    }
  }, [payloadText]);

  return (
    <div
      data-crash-diagnostics="true"
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${APP_THEME.shell} 0%, ${APP_THEME.bg} 220px, ${APP_THEME.bgAlt} 100%)`,
        color: APP_THEME.text,
        fontFamily: APP_FONT_STACK,
        padding: "24px clamp(14px, 3vw, 28px) 32px",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ border: `1px solid ${APP_THEME.border}`, borderRadius: 18, background: APP_THEME.card, boxShadow: "0 24px 64px rgba(15, 23, 42, 0.14)", overflow: "hidden" }}>
          <div style={{ padding: "18px 20px 16px", borderBottom: `1px solid ${APP_THEME.border}`, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: APP_THEME.red }}>
                  Fatal Diagnostics
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.05 }}>
                  Crash capture mode
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ ...compactModeBadgeStyle, color: APP_THEME.text, background: APP_THEME.cardAlt }}>
                  {report.surfaceLabel || report.activeSurface || "Unknown surface"}
                </span>
                <span style={{ ...compactModeBadgeStyle, color: APP_THEME.muted }}>
                  {report.kind || "unknown"}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 14, color: APP_THEME.muted, maxWidth: 820 }}>
              The app switched into a dedicated diagnostics surface after a fatal render/runtime failure so the normal workspace cannot be pushed below an inline fallback.
            </div>
          </div>

          <div style={{ padding: 20, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <DiagnosticCard label="Surface" value={report.surfaceLabel || report.activeSurface || "Unknown"} />
              <DiagnosticCard label="Mode" value={report.activeMode || "Unknown"} />
              <DiagnosticCard label="Captured" value={report.capturedAt || "Unknown"} />
              <DiagnosticCard label="Viewport" value={report.viewport ? `${report.viewport.width || "?"}x${report.viewport.height || "?"}` : "Unknown"} />
              <DiagnosticCard label="Scroll" value={report.viewport ? `${report.viewport.scrollX || 0}, ${report.viewport.scrollY || 0}` : "Unknown"} />
              <DiagnosticCard label="Crash ID" value={report.crashId || "Unknown"} />
            </div>

            <div style={{ border: `1px solid ${APP_THEME.border}`, borderRadius: 12, background: APP_THEME.cardAlt, padding: 14, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: APP_THEME.muted }}>
                Error
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: APP_THEME.red }}>
                {(report.errorName || "Error") + ": " + (report.message || "Unknown runtime failure")}
              </div>
              {report.href ? (
                <div style={{ fontSize: 12, color: APP_THEME.muted, overflowWrap: "anywhere" }}>{report.href}</div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={onRetry} style={primaryNavButtonStyle(true)}>Retry App</button>
              <button onClick={onReload} style={secondaryNavButtonStyle(false)}>Reload Page</button>
              <button onClick={handleCopy} style={secondaryNavButtonStyle(false)}>
                {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy Failed" : copyState === "unavailable" ? "Clipboard Unavailable" : "Copy Diagnostics"}
              </button>
            </div>

            <DiagnosticSection title="Component Stack" value={report.componentStack} />
            <DiagnosticSection title="Stack Trace" value={report.stack} />
            <DiagnosticSection title="Extra Context" value={report.extraContext ? safePrettyJson(report.extraContext) : null} />
            <DiagnosticSection title="Full Payload" value={payloadText} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DiagnosticCard({ label, value }) {
  return (
    <div style={{ border: `1px solid ${APP_THEME.border}`, borderRadius: 12, background: APP_THEME.cardAlt, padding: "12px 14px", display: "grid", gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: APP_THEME.muted }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: APP_THEME.text, overflowWrap: "anywhere" }}>{value || "Unknown"}</div>
    </div>
  );
}

function DiagnosticSection({ title, value = null }) {
  if (!value) {
    return null;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: APP_THEME.muted }}>{title}</div>
      <pre style={{ margin: 0, padding: 14, borderRadius: 12, border: `1px solid ${APP_THEME.border}`, background: APP_THEME.cardAlt, color: APP_THEME.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.45 }}>
        {value}
      </pre>
    </div>
  );
}

function primaryNavButtonStyle(active) {  return {
    padding: "7px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? APP_THEME.accent : APP_THEME.border}`,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    background: active ? APP_THEME.accentSoft : APP_THEME.card,
    color: active ? APP_THEME.accentStrong : APP_THEME.muted,
    transition: "all 0.16s ease",
    whiteSpace: "nowrap",
    boxShadow: active ? "inset 0 0 0 1px rgba(2, 132, 199, 0.08)" : "none",
  };
}

function secondaryNavButtonStyle(active) {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${active ? APP_THEME.borderStrong : APP_THEME.border}`,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    background: active ? APP_THEME.cardAlt : APP_THEME.card,
    color: active ? APP_THEME.text : APP_THEME.muted,
    transition: "all 0.16s ease",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };
}

const compactModeBadgeStyle = {
  padding: "4px 8px",
  borderRadius: 999,
  border: `1px solid ${APP_THEME.border}`,
  background: APP_THEME.cardAlt,
  color: APP_THEME.muted,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      message: null,
      errorName: null,
      stack: null,
      componentStack: null,
      capturedAt: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "Unknown error",
      errorName: error?.name || "Error",
      stack: String(error?.stack || "").trim() || null,
      capturedAt: new Date().toISOString(),
    };
  }

  componentDidCatch(error, errorInfo) {
    const componentStack = String(errorInfo?.componentStack || "").trim() || null;
    this.setState({
      message: error?.message || "Unknown error",
      errorName: error?.name || "Error",
      stack: String(error?.stack || "").trim() || null,
      componentStack,
      capturedAt: new Date().toISOString(),
    });
    if (typeof this.props.onFatalError === "function") {
      this.props.onFatalError({
        kind: "react-boundary",
        surfaceLabel: this.props.surfaceLabel || this.props.surfaceId || "surface",
        activeSurface: this.props.activeSurface || null,
        activeMode: this.props.activeMode || null,
        error,
        componentStack,
        extraContext: {
          boundary: this.props.surfaceLabel || this.props.surfaceId || "surface",
        },
      });
    }
    console.error(`[PageErrorBoundary:${this.props.surfaceLabel || "surface"}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.onFatalError === "function") {
        return null;
      }
      return (
        <div style={{ padding: 20, color: APP_THEME.red, background: APP_THEME.card, border: `1px solid ${APP_THEME.border}`, margin: 16, borderRadius: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>This page failed to render.</div>
          <div style={{ fontSize: 12, color: APP_THEME.muted, marginBottom: 6 }}>
            Surface: {this.props.surfaceLabel || "Unknown"}
          </div>
          <div style={{ fontSize: 12, color: APP_THEME.muted, marginBottom: 6 }}>
            Runtime State: Render error
          </div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{this.state.message}</div>
          <div style={{ fontSize: 12, color: APP_THEME.muted, marginBottom: 10 }}>
            If this happened after live edits, try a hard reload to rule out Fast Refresh state corruption.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => this.setState({
                hasError: false,
                message: null,
                errorName: null,
                stack: null,
                componentStack: null,
                capturedAt: null,
              })}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: `1px solid ${APP_THEME.border}`,
                background: APP_THEME.cardAlt,
                color: APP_THEME.text,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Retry Surface
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: `1px solid ${APP_THEME.border}`,
                background: APP_THEME.card,
                color: APP_THEME.text,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Reload Page
            </button>
          </div>
          <details style={{ fontSize: 12, color: APP_THEME.text }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Diagnostics</summary>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: APP_THEME.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                  Error
                </div>
                <div style={{ fontSize: 12 }}>
                  {this.state.errorName || "Error"}: {this.state.message}
                </div>
                {this.state.capturedAt && (
                  <div style={{ marginTop: 4, color: APP_THEME.muted }}>
                    Captured: {this.state.capturedAt}
                  </div>
                )}
              </div>
              {this.state.componentStack && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: APP_THEME.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                    Component Stack
                  </div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: APP_THEME.cardAlt, padding: 10, borderRadius: 6, border: `1px solid ${APP_THEME.border}` }}>
                    {this.state.componentStack}
                  </pre>
                </div>
              )}
              {this.state.stack && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: APP_THEME.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                    Stack Trace
                  </div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: APP_THEME.cardAlt, padding: 10, borderRadius: 6, border: `1px solid ${APP_THEME.border}` }}>
                    {this.state.stack}
                  </pre>
                </div>
              )}
            </div>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

function readStoredJson(key) {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredJson(key, value) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in constrained environments.
  }
}
