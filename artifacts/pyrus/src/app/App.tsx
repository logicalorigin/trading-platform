import { Suspense } from "react";
import NeuralBootOverlay from "../components/neural/NeuralBootOverlay";
import { NeuralLoader } from "../components/neural/NeuralLoader";
import {
  lazyWithRetry,
  preloadDynamicImport,
  type DynamicImportAttemptFailure,
  type DynamicImportRetry,
} from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import { useBootHandoffElapsedMs } from "./bootLoaderHandoff";
import {
  completeBootProgressTask,
  failBootProgressTask,
  startBootProgressTask,
  useBootProgress,
} from "./bootProgress";
import {
  RootCrashDiagnosticsFallback,
  buildRootCrashReportRaw,
  rememberRootCrashDiagnostic,
} from "./crashDiagnostics";

let appContentImport: Promise<{ default: typeof import("./AppContent").default }> | null =
  null;

const clearAppContentImportAfterWrapperFailure = (
  _context: DynamicImportAttemptFailure,
) => {
  appContentImport = null;
};

const markAppContentImportRetry = ({ attempt, maxAttempts }: DynamicImportRetry) => {
  appContentImport = null;
  startBootProgressTask("app-content-chunk", {
    detail: `Retrying app shell (attempt ${attempt}/${maxAttempts})`,
  });
};

const loadAppContent = () => {
  if (!appContentImport) {
    startBootProgressTask("app-content-chunk");
    appContentImport = import("./AppContent")
      .then((mod) => {
        completeBootProgressTask("app-content-chunk");
        return { default: mod.default };
      })
      .catch((error) => {
        appContentImport = null;
        failBootProgressTask("app-content-chunk", error);
        throw error;
      });
  }
  return appContentImport;
};

if (typeof window !== "undefined") {
  preloadDynamicImport(loadAppContent, {
    label: "AppContent",
    onAttemptFailure: clearAppContentImportAfterWrapperFailure,
    onRetry: markAppContentImportRetry,
    retries: 4,
    retryDelayMs: 500,
  });
}

const AppContent = lazyWithRetry(async () => {
  return loadAppContent();
}, {
  label: "AppContent",
  onAttemptFailure: clearAppContentImportAfterWrapperFailure,
  onRetry: markAppContentImportRetry,
  retries: 4,
  retryDelayMs: 500,
});

type AppProps = {
  bootLoaderElapsedMs?: number | null;
};

function AppShellFallback({ bootLoaderElapsedMs = null }: AppProps) {
  const progress = useBootProgress();
  const bootHandoffElapsedMs = useBootHandoffElapsedMs(bootLoaderElapsedMs);

  return (
    <NeuralLoader
      bootHandoffElapsedMs={bootHandoffElapsedMs}
      label="Starting PYRUS"
      progress={progress}
      testId="app-loading-fallback"
    />
  );
}

function App({ bootLoaderElapsedMs = null }: AppProps) {
  return (
    <PlatformErrorBoundary
      label="PYRUS app shell"
      reportCategory="react-root-crash"
      reportSeverity="warning"
      buildReportRaw={buildRootCrashReportRaw}
      onBoundaryError={rememberRootCrashDiagnostic}
      fallbackRender={(props) => <RootCrashDiagnosticsFallback {...props} />}
    >
      <Suspense fallback={<AppShellFallback bootLoaderElapsedMs={bootLoaderElapsedMs} />}>
        <AppContent bootLoaderElapsedMs={bootLoaderElapsedMs} />
      </Suspense>
      {/* First-load neural opener: an opaque overlay ABOVE the mounting app
          (so boot progress can reach `complete`) that forms the PYRUS logo and
          parts to reveal the app. No-ops on reduced-motion / no-WebGL / repeat
          loads — the Suspense BrandLoader above handles those. */}
      <NeuralBootOverlay />
    </PlatformErrorBoundary>
  );
}

export default App;
