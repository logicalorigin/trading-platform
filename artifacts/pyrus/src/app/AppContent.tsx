import { Suspense, useEffect, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";
import LogoLoader from "../components/LogoLoader";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import { LoginGate } from "../features/auth/LoginGate.jsx";
import { useBootHandoffElapsedMs } from "./bootLoaderHandoff";
// @ts-ignore JS module keeps screen chunk preload state outside the React registry.
import { preloadScreenModule } from "../features/platform/screenModulePreloader";
import { readInitialPlatformScreen } from "../features/platform/initialPlatformScreen";
import {
  BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
  completeBootProgressTask,
  failBootProgressTask,
  skipBootProgressTasks,
  startBootProgressTask,
  useBootProgress,
  type BootProgressTaskId,
} from "./bootProgress";
import {
  rememberBrowserDiagnosticEvent,
} from "./crashDiagnostics";

type LazyComponentModule = { default: ComponentType };
const ROOT_ROUTE_CHUNK_RETRIES = 4;
const ROOT_ROUTE_CHUNK_RETRY_DELAY_MS = 500;
const PLATFORM_BOOT_PROGRESS_TASK_IDS = [
  "session",
  "watchlists",
  "accounts",
  "signal-profile",
  "signal-state",
  "first-screen",
  ...BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
] as const satisfies readonly BootProgressTaskId[];

let platformAppImport: Promise<{ default: ComponentType }> | null = null;
let chartParityLabImport: Promise<LazyComponentModule> | null = null;
let tickerSearchLabImport: Promise<LazyComponentModule> | null = null;
let PlatformAppComponent: ComponentType | null = null;
let ChartParityLabComponent: ComponentType | null = null;
let TickerSearchLabComponent: ComponentType | null = null;

const loadPlatformApp = () => {
  if (!platformAppImport) {
    startBootProgressTask("workspace-route-chunk", {
      detail: "Loading workspace",
    });
    platformAppImport =
      // @ts-expect-error JSX module has no declaration file in this TS config
      import("../features/platform/PlatformApp.jsx")
        .then((mod) => {
          PlatformAppComponent = mod.default as ComponentType;
          completeBootProgressTask("workspace-route-chunk", {
            detail: "Workspace loaded",
          });
          return { default: PlatformAppComponent };
        })
        .catch((error) => {
          platformAppImport = null;
          failBootProgressTask("workspace-route-chunk", error, {
            detail: "Workspace failed to load",
          });
          throw error;
        });
  }
  return platformAppImport;
};

const loadChartParityLab = () => {
  if (!chartParityLabImport) {
    startBootProgressTask("workspace-route-chunk", {
      detail: "Loading chart lab",
    });
    chartParityLabImport = import("../features/charting/ChartParityLab")
      .then((mod) => {
        ChartParityLabComponent = mod.ChartParityLab as ComponentType;
        completeBootProgressTask("workspace-route-chunk", {
          detail: "Chart lab loaded",
        });
        return { default: ChartParityLabComponent };
      })
      .catch((error) => {
        chartParityLabImport = null;
        failBootProgressTask("workspace-route-chunk", error, {
          detail: "Chart lab failed to load",
        });
        throw error;
      });
  }
  return chartParityLabImport;
};

const loadTickerSearchLab = () => {
  if (!tickerSearchLabImport) {
    startBootProgressTask("workspace-route-chunk", {
      detail: "Loading ticker search lab",
    });
    tickerSearchLabImport =
      // @ts-expect-error JSX module has no declaration file in this TS config
      import("../features/platform/tickerSearch/TickerSearch.jsx")
        .then((mod) => {
          TickerSearchLabComponent = mod.TickerSearchLab as ComponentType;
          completeBootProgressTask("workspace-route-chunk", {
            detail: "Ticker search lab loaded",
          });
          return { default: TickerSearchLabComponent };
        })
        .catch((error) => {
          tickerSearchLabImport = null;
          failBootProgressTask("workspace-route-chunk", error, {
            detail: "Ticker search lab failed to load",
          });
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

const preloadPlatformScreenModule = (screenId: string) => {
  const preload = preloadScreenModule(screenId);
  if (preload && typeof preload.catch === "function") {
    void preload.catch(() => {});
  }
};

const preloadInitialPlatformScreenModule = (initialScreen = readInitialPlatformScreen()) => {
  preloadPlatformScreenModule(initialScreen);
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
  const initialScreen = readInitialPlatformScreen();
  preloadInitialPlatformScreenModule(initialScreen);
  preloadDynamicImport(loadPlatformApp, {
    label: "PlatformApp",
    retries: ROOT_ROUTE_CHUNK_RETRIES,
    retryDelayMs: ROOT_ROUTE_CHUNK_RETRY_DELAY_MS,
  });
  // Non-initial screens load on the user's navigation path. Warming them here at
  // module-load time raced first paint (requestIdleCallback's 2s timeout
  // force-fired mid-boot, saturating the connection pool), so it is intentionally
  // not done on this path.
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

type AppContentProps = {
  bootLoaderElapsedMs?: number | null;
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
  severity: "info" | "warning";
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

const VITE_OVERLAY_SELECTOR = "vite-error-overlay";
const VITE_ERROR_RAW_TEXT_LIMIT = 4_000;
const VITE_ERROR_MESSAGE_LIMIT = 320;

const diagnosticRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const diagnosticString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const compactDiagnosticText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

function readViteOverlayText(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const overlay = document.querySelector(VITE_OVERLAY_SELECTOR);
  if (!overlay) {
    return null;
  }
  const text =
    overlay.shadowRoot?.textContent || overlay.textContent || "";
  return compactDiagnosticText(text);
}

function viteDiagnosticCode(text: string, err: Record<string, unknown>): string {
  const pluginMatch = text.match(/\[plugin:[^\]]+\]/);
  const id = diagnosticString(err["id"]);
  const plugin = diagnosticString(err["plugin"]);
  const location =
    typeof err["loc"] === "object" && err["loc"] !== null
      ? diagnosticRecord(err["loc"])
      : null;
  const line =
    typeof location?.["line"] === "number" ? location["line"] : null;
  const column =
    typeof location?.["column"] === "number" ? location["column"] : null;
  const file = id?.split("/").at(-1);
  const fileCode = file ? `${file}:${line ?? 0}:${column ?? 0}` : null;
  return (
    pluginMatch?.[0] ||
    (plugin ? `[plugin:${plugin}]` : null) ||
    fileCode ||
    "vite-dev-overlay"
  ).slice(0, 96);
}

function buildViteDiagnosticEvent(payload: unknown, fallbackText: string | null) {
  const record = diagnosticRecord(payload);
  const err = diagnosticRecord(record["err"]);
  const message = diagnosticString(err["message"]);
  const stack = diagnosticString(err["stack"]);
  const text = compactDiagnosticText(
    [message, stack, fallbackText].filter(Boolean).join(" "),
  );
  if (!text) {
    return null;
  }
  const rawText = text.slice(0, VITE_ERROR_RAW_TEXT_LIMIT);
  return {
    category: "vite-dev-overlay",
    severity: "warning" as const,
    code: viteDiagnosticCode(text, err),
    message:
      text.length > VITE_ERROR_MESSAGE_LIMIT
        ? `${text.slice(0, VITE_ERROR_MESSAGE_LIMIT)}...`
        : text,
    raw: {
      route: typeof window === "undefined" ? "" : window.location.href,
      source: "vite:error",
      text: rawText,
      file: diagnosticString(err["id"]),
      plugin: diagnosticString(err["plugin"]),
    },
  };
}

function AppContent({ bootLoaderElapsedMs = null }: AppContentProps) {
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

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") {
      return undefined;
    }

    let lastSignature = "";
    let shadowObserver: MutationObserver | null = null;
    const reportViteDiagnostic = (payload: unknown = null) => {
      const overlayText = readViteOverlayText();
      const diagnosticEvent = buildViteDiagnosticEvent(payload, overlayText);
      if (!diagnosticEvent) {
        return;
      }
      const signature = `${diagnosticEvent.code}:${diagnosticEvent.message}`;
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      rememberBrowserDiagnosticEvent(diagnosticEvent);
      postClientDiagnosticEvent(diagnosticEvent);
    };
    const attachOverlayObserver = () => {
      if (typeof MutationObserver === "undefined") {
        return;
      }
      const overlay = document.querySelector(VITE_OVERLAY_SELECTOR);
      const root = overlay?.shadowRoot;
      if (!root || shadowObserver) {
        return;
      }
      shadowObserver = new MutationObserver(() => reportViteDiagnostic());
      shadowObserver.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    };
    const onViteError = (payload: unknown) => {
      reportViteDiagnostic(payload);
      attachOverlayObserver();
    };
    import.meta.hot?.on("vite:error", onViteError);
    reportViteDiagnostic();
    attachOverlayObserver();

    if (typeof MutationObserver === "undefined") {
      return () => {
        import.meta.hot?.off("vite:error", onViteError);
      };
    }
    const observer = new MutationObserver(() => {
      reportViteDiagnostic();
      attachOverlayObserver();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    return () => {
      import.meta.hot?.off("vite:error", onViteError);
      observer.disconnect();
      shadowObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (labMode === "chart-parity" || labMode === "ticker-search") {
      skipBootProgressTasks(
        PLATFORM_BOOT_PROGRESS_TASK_IDS,
        `Workspace startup skipped for ${labMode} lab`,
      );
    }
  }, [labMode]);

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
            labMode === "chart-parity" || labMode === "ticker-search" ? (
              <InitialRouteComponent />
            ) : (
              // Same login gate as the Suspense path below — the preloaded
              // fast-path must not render the workspace for a signed-out visitor.
              <LoginGate>
                <InitialRouteComponent />
              </LoginGate>
            )
          ) : (
            <Suspense fallback={<AppContentRouteFallback bootLoaderElapsedMs={bootLoaderElapsedMs} />}>
              {labMode === "chart-parity" ? (
                <ChartParityLab />
              ) : labMode === "ticker-search" ? (
                <TickerSearchLab />
              ) : (
                <LoginGate>
                  <PlatformApp />
                </LoginGate>
              )}
            </Suspense>
          )}
        </PlatformErrorBoundary>
      </AppProviders>
    </>
  );
}

export default AppContent;

function AppContentRouteFallback({ bootLoaderElapsedMs = null }: AppContentProps) {
  const progress = useBootProgress();
  const bootHandoffElapsedMs = useBootHandoffElapsedMs(bootLoaderElapsedMs);

  return (
    <LogoLoader
      bootHandoffElapsedMs={bootHandoffElapsedMs}
      label="Loading workspace"
      progress={progress}
      testId="app-content-route-loading"
    />
  );
}
