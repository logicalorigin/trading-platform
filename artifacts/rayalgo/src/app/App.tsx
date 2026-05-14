import { Suspense, useEffect, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";
import { lazyWithRetry } from "../lib/dynamicImport";
import { FONT_CSS_VAR } from "../lib/typography";
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

const APP_LOADING_FALLBACK_PALETTES = {
  dark: {
    shellBg: "#16151A",
    text: "#B8B4AC",
    border: "#2F2E35",
    accent: "#E08F76",
  },
  light: {
    shellBg: "#FAFAF7",
    text: "#4E4B4F",
    border: "#E8E5DE",
    accent: "#D97757",
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.shellBg,
        color: palette.text,
        fontFamily: FONT_CSS_VAR.sans,
      }}
    >
      <style>
        {`@keyframes rayalgoBootSpin { to { transform: rotate(360deg); } }`}
      </style>
      <span
        aria-label="Loading RayAlgo"
        role="status"
        style={{
          display: "inline-block",
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `2px solid ${palette.border}`,
          borderTopColor: palette.accent,
          animation: "rayalgoBootSpin 900ms linear infinite",
        }}
      />
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
