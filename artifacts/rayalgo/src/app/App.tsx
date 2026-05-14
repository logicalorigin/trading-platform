import { Suspense, useEffect, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";
import { lazyWithRetry } from "../lib/dynamicImport";
import { FONT_CSS_VAR, TYPE_CSS_VAR } from "../lib/typography";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";

const PlatformApp = lazyWithRetry(async () => {
  // @ts-expect-error JSX module has no declaration file in this TS config
  const mod = await import("../features/platform/PlatformApp.jsx");

  return { default: mod.default };
}, {
  label: "PlatformApp",
});

const ChartParityLab = lazyWithRetry(async () => {
  const mod = await import("../features/charting/ChartParityLab");

  return { default: mod.ChartParityLab };
}, {
  label: "ChartParityLab",
});

const TickerSearchLab = lazyWithRetry(async () => {
  // @ts-expect-error JSX module has no declaration file in this TS config
  const mod = (await import("../features/platform/tickerSearch/TickerSearch.jsx")) as {
    TickerSearchLab: ComponentType;
  };

  return { default: mod.TickerSearchLab };
}, {
  label: "TickerSearchLab",
});

const resolveLabMode = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("lab");
};

function postClientDiagnosticEvent(input: {
  category: string;
  severity: "info" | "warning" | "critical";
  code?: string | null;
  message: string;
  raw?: Record<string, unknown>;
}) {
  fetch("/api/diagnostics/client-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {});
}

function diagnosticErrorCode(
  filename: string | undefined,
  lineno: number | undefined,
  colno: number | undefined,
): string {
  const file = filename?.split("/").at(-1) || "unknown";
  return `${file}:${lineno ?? 0}:${colno ?? 0}`.slice(0, 96);
}

const APP_SHELL_TABS = [
  "Market",
  "Flow",
  "Trade",
  "Account",
  "Research",
  "Algo",
  "Backtest",
  "Diagnostics",
];

const APP_LOADING_FALLBACK_PALETTES = {
  dark: {
    shellBg: "#16151A",
    headerBg: "#1A191E",
    panelBg: "#1E1D22",
    sidebarBg: "#1A191E",
    cardBg: "#1E1D22",
    activeBg: "#26252B",
    skeletonActiveBg: "#26252B",
    skeletonBg: "#1E1D22",
    border: "#2F2E35",
    borderSoft: "#3A3940",
    controlBorder: "#2F2E35",
    controlBg: "#1E1D22",
    text: "#B8B4AC",
    textStrong: "#F2EFE9",
    textMuted: "#86837D",
    footerText: "#605C57",
    warning: "#D9A864",
    slideGlow: "rgba(224, 143, 118, 0.18)",
    panelGlow: "rgba(224, 143, 118, 0.12)",
  },
  light: {
    shellBg: "#FAFAF7",
    headerBg: "#FFFFFF",
    panelBg: "#FFFFFF",
    sidebarBg: "#F1EFEA",
    cardBg: "#F1EFEA",
    activeBg: "#F2DDD2",
    skeletonActiveBg: "#E8E5DE",
    skeletonBg: "#F1EFEA",
    border: "#E8E5DE",
    borderSoft: "#D9D5CD",
    controlBorder: "#D9D5CD",
    controlBg: "#F1EFEA",
    text: "#4E4B4F",
    textStrong: "#19171A",
    textMuted: "#86837D",
    footerText: "#ACA8A0",
    warning: "#C28526",
    slideGlow: "rgba(217, 119, 87, 0.14)",
    panelGlow: "rgba(217, 119, 87, 0.12)",
  },
} as const;

const resolveAppLoadingFallbackTheme = (): keyof typeof APP_LOADING_FALLBACK_PALETTES => {
  if (typeof document !== "undefined") {
    return document.documentElement.dataset.rayalgoTheme === "light"
      ? "light"
      : "dark";
  }

  return "dark";
};

function AppLoadingFallback() {
  const themeKey = resolveAppLoadingFallbackTheme();
  const palette = APP_LOADING_FALLBACK_PALETTES[themeKey];

  return (
    <div
      data-testid="app-loading-fallback"
      data-theme={themeKey}
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: palette.shellBg,
        color: palette.text,
        fontFamily: FONT_CSS_VAR.sans,
        overflow: "hidden",
      }}
    >
      <style>
        {`
          @keyframes rayalgoAppPulse {
            0%, 100% { opacity: 0.46; }
            50% { opacity: 0.92; }
          }
          @keyframes rayalgoAppSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}
      </style>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          minHeight: 41,
          padding: "4px 8px",
          background: palette.headerBg,
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <div style={{ display: "flex", gap: 3, minWidth: 0, overflow: "hidden" }}>
          {APP_SHELL_TABS.map((tab, index) => (
            <div
              key={tab}
              style={{
                minHeight: 31,
                padding: "6px 8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${palette.controlBorder}`,
                background: index === 0 ? palette.activeBg : "transparent",
                color: index === 0 ? palette.textStrong : palette.textMuted,
                fontSize: TYPE_CSS_VAR.body,
                fontWeight: 400,
                whiteSpace: "nowrap",
              }}
            >
              {tab}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "relative",
            height: 24,
            overflow: "hidden",
            background: palette.controlBg,
            border: `1px solid ${palette.border}`,
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              width: "50%",
              background: `linear-gradient(90deg, transparent, ${palette.slideGlow}, transparent)`,
              animation: "rayalgoAppSlide 1.4s ease-in-out infinite",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 5,
            alignItems: "center",
            color: palette.textMuted,
            fontSize: TYPE_CSS_VAR.body,
            fontWeight: 400,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              background: palette.warning,
              display: "inline-block",
              animation: "rayalgoAppPulse 1.1s ease-in-out infinite",
            }}
          />
          Starting
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: 0 }}>
        <div
          style={{
            borderRight: `1px solid ${palette.border}`,
            background: palette.sidebarBg,
            padding: 10,
            display: "grid",
            gap: 8,
            alignContent: "start",
          }}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              style={{
                height: 30,
                background: index === 0 ? palette.skeletonActiveBg : palette.skeletonBg,
                border: `1px solid ${palette.border}`,
                animation: `rayalgoAppPulse ${1.8 + index * 0.03}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
        <main
          style={{
            minWidth: 0,
            minHeight: 0,
            padding: 12,
            display: "grid",
            gridTemplateRows: "minmax(220px, 42vh) 1fr",
            gap: 10,
          }}
        >
          <section
            style={{
              position: "relative",
              overflow: "hidden",
              border: `1px solid ${palette.borderSoft}`,
              background: palette.panelBg,
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(90deg, transparent, ${palette.panelGlow}, transparent)`,
                animation: "rayalgoAppSlide 1.8s ease-in-out infinite",
              }}
            />
          </section>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              minHeight: 0,
            }}
          >
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                style={{
                  border: `1px solid ${palette.borderSoft}`,
                  background: palette.cardBg,
                  animation: `rayalgoAppPulse ${1.5 + index * 0.12}s ease-in-out infinite`,
                }}
              />
            ))}
          </section>
        </main>
      </div>

      <div
        style={{
          height: 24,
          borderTop: `1px solid ${palette.border}`,
          background: palette.headerBg,
          color: palette.footerText,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 12px",
          fontSize: TYPE_CSS_VAR.label,
          fontWeight: 400,
        }}
      >
        <span>RAYALGO</span>
        <span>LOADING PLATFORM SHELL</span>
      </div>
    </div>
  );
}

function App() {
  const labMode = resolveLabMode();

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onError = (event: ErrorEvent) => {
      postClientDiagnosticEvent({
        category: "window-error",
        severity: "warning",
        code: diagnosticErrorCode(event.filename, event.lineno, event.colno),
        message: event.message || "Window error",
        raw: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      postClientDiagnosticEvent({
        category: "unhandled-rejection",
        severity: "warning",
        code:
          event.reason instanceof Error && event.reason.name
            ? event.reason.name.slice(0, 96)
            : "unhandled-rejection",
        message: reason || "Unhandled promise rejection",
        raw: { reason },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <PlatformErrorBoundary label="Rayalgo app shell" resetKeys={[labMode]}>
      <AppProviders>
        <Suspense fallback={<AppLoadingFallback />}>
          {labMode === "chart-parity" ? (
            <ChartParityLab />
          ) : labMode === "ticker-search" ? (
            <TickerSearchLab />
          ) : (
            <PlatformApp />
          )}
        </Suspense>
      </AppProviders>
    </PlatformErrorBoundary>
  );
}

export default App;
