import { Suspense } from "react";
import LogoLoader from "../components/LogoLoader";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
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
    retries: 4,
    retryDelayMs: 500,
  });
}

const AppContent = lazyWithRetry(async () => {
  return loadAppContent();
}, {
  label: "AppContent",
  retries: 4,
  retryDelayMs: 500,
});

type AppProps = {
  bootLoaderElapsedMs?: number | null;
};

function AppShellFallback({ bootLoaderElapsedMs = null }: AppProps) {
  const progress = useBootProgress();

  return (
    <LogoLoader
      bootHandoffElapsedMs={bootLoaderElapsedMs}
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
      reportSeverity="critical"
      buildReportRaw={buildRootCrashReportRaw}
      onBoundaryError={rememberRootCrashDiagnostic}
      fallbackRender={(props) => <RootCrashDiagnosticsFallback {...props} />}
    >
      <Suspense fallback={<AppShellFallback bootLoaderElapsedMs={bootLoaderElapsedMs} />}>
        <AppContent bootLoaderElapsedMs={bootLoaderElapsedMs} />
      </Suspense>
    </PlatformErrorBoundary>
  );
}

export default App;
