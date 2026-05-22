import { Suspense, useEffect, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";
import { lazyWithRetry } from "../lib/dynamicImport";
import LogoLoader from "../components/LogoLoader";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import {
  RootCrashDiagnosticsFallback,
  buildRootCrashReportRaw,
  rememberBrowserDiagnosticEvent,
  rememberRootCrashDiagnostic,
} from "./crashDiagnostics";

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

function App() {
  const labMode = resolveLabMode();
  const crashMode = resolveDevCrashMode();

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
    <PlatformErrorBoundary
      label="PYRUS app shell"
      resetKeys={[labMode, crashMode]}
      reportCategory="react-root-crash"
      reportSeverity="critical"
      buildReportRaw={buildRootCrashReportRaw}
      onBoundaryError={rememberRootCrashDiagnostic}
      fallbackRender={(props) => <RootCrashDiagnosticsFallback {...props} />}
    >
      <DevCrashTrigger mode={crashMode} />
      <AppProviders>
        <Suspense fallback={<LogoLoader testId="app-loading-fallback" />}>
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
