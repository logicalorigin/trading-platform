import { Suspense, useEffect, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";
import LogoLoader from "../components/LogoLoader";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import {
  rememberBrowserDiagnosticEvent,
} from "./crashDiagnostics";

type LazyComponentModule = { default: ComponentType };
const ROOT_ROUTE_CHUNK_RETRIES = 4;
const ROOT_ROUTE_CHUNK_RETRY_DELAY_MS = 500;

let platformAppImport: Promise<{ default: ComponentType }> | null = null;
let chartParityLabImport: Promise<LazyComponentModule> | null = null;
let tickerSearchLabImport: Promise<LazyComponentModule> | null = null;
let PlatformAppComponent: ComponentType | null = null;
let ChartParityLabComponent: ComponentType | null = null;
let TickerSearchLabComponent: ComponentType | null = null;

const loadPlatformApp = () => {
  if (!platformAppImport) {
    platformAppImport =
      // @ts-expect-error JSX module has no declaration file in this TS config
      import("../features/platform/PlatformApp.jsx")
        .then((mod) => {
          PlatformAppComponent = mod.default as ComponentType;
          return { default: PlatformAppComponent };
        })
        .catch((error) => {
          platformAppImport = null;
          throw error;
        });
  }
  return platformAppImport;
};

const loadChartParityLab = () => {
  if (!chartParityLabImport) {
    chartParityLabImport = import("../features/charting/ChartParityLab")
      .then((mod) => {
        ChartParityLabComponent = mod.ChartParityLab as ComponentType;
        return { default: ChartParityLabComponent };
      })
      .catch((error) => {
        chartParityLabImport = null;
        throw error;
      });
  }
  return chartParityLabImport;
};

const loadTickerSearchLab = () => {
  if (!tickerSearchLabImport) {
    tickerSearchLabImport =
      // @ts-expect-error JSX module has no declaration file in this TS config
      import("../features/platform/tickerSearch/TickerSearch.jsx")
        .then((mod) => {
          TickerSearchLabComponent = mod.TickerSearchLab as ComponentType;
          return { default: TickerSearchLabComponent };
        })
        .catch((error) => {
          tickerSearchLabImport = null;
          throw error;
        });
  }
  return tickerSearchLabImport;
};

const resolveLabMode = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("lab");
};

export const preloadInitialAppContentRoute = () => {
  const labMode = resolveLabMode();
  if (labMode === "chart-parity") {
    preloadDynamicImport(loadChartParityLab, {
      label: "ChartParityLab",
      retries: ROOT_ROUTE_CHUNK_RETRIES,
      retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
    });
    return;
  }
  if (labMode === "ticker-search") {
    preloadDynamicImport(loadTickerSearchLab, {
      label: "TickerSearchLab",
      retries: ROOT_ROUTE_CHUNK_RETRIES,
      retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
    });
    return;
  }
  preloadDynamicImport(loadPlatformApp, {
    label: "PlatformApp",
    retries: ROOT_ROUTE_CHUNK_RETRIES,
    retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
  });
};

const getPreloadedInitialAppContentRoute = (labMode: string | null) => {
  if (labMode === "chart-parity") {
    return ChartParityLabComponent;
  }
  if (labMode === "ticker-search") {
    return TickerSearchLabComponent;
  }
  return PlatformAppComponent;
};

if (typeof window !== "undefined") {
  preloadInitialAppContentRoute();
}

const PlatformApp = lazyWithRetry(loadPlatformApp, {
  label: "PlatformApp",
  retries: ROOT_ROUTE_CHUNK_RETRIES,
  retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
});

const ChartParityLab = lazyWithRetry(loadChartParityLab, {
  label: "ChartParityLab",
  retries: ROOT_ROUTE_CHUNK_RETRIES,
  retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
});

const TickerSearchLab = lazyWithRetry(loadTickerSearchLab, {
  label: "TickerSearchLab",
  retries: ROOT_ROUTE_CHUNK_RETRIES,
  retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
});

const resolveDevCrashMode = (): string | null => {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("crash");
};

function DevCrashTrigger({ mode }: { mode: string | null }) {
  if (mode === "render") {
    throw new Error("PYRUS dev crash diagnostics trigger");
  }
  return null;
}

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

function AppContent() {
  const labMode = resolveLabMode();
  const crashMode = resolveDevCrashMode();
  const InitialRouteComponent = getPreloadedInitialAppContentRoute(labMode);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onError = (event: ErrorEvent) => {
      const diagnosticEvent = {
        category: "window-error",
        severity: "warning" as const,
        code: diagnosticErrorCode(event.filename, event.lineno, event.colno),
        message: event.message || "Window error",
        raw: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      };
      rememberBrowserDiagnosticEvent(diagnosticEvent);
      postClientDiagnosticEvent({
        ...diagnosticEvent,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      const diagnosticEvent = {
        category: "unhandled-rejection",
        severity: "warning" as const,
        code:
          event.reason instanceof Error && event.reason.name
            ? event.reason.name.slice(0, 96)
            : "unhandled-rejection",
        message: reason || "Unhandled promise rejection",
        raw: { reason },
      };
      rememberBrowserDiagnosticEvent(diagnosticEvent);
      postClientDiagnosticEvent(diagnosticEvent);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <>
      <DevCrashTrigger mode={crashMode} />
      <AppProviders>
        <PlatformErrorBoundary
          label="PYRUS workspace"
          minHeight="100vh"
          reportCategory="react-workspace-chunk"
          reportSeverity="warning"
        >
          {InitialRouteComponent ? (
            <InitialRouteComponent />
          ) : (
            <Suspense fallback={<AppContentRouteFallback />}>
              {labMode === "chart-parity" ? (
                <ChartParityLab />
              ) : labMode === "ticker-search" ? (
                <TickerSearchLab />
              ) : (
                <PlatformApp />
              )}
            </Suspense>
          )}
        </PlatformErrorBoundary>
      </AppProviders>
    </>
  );
}

export default AppContent;

function AppContentRouteFallback() {
  return (
    <LogoLoader
      label="Loading workspace"
      testId="app-content-route-loading"
    />
  );
}
