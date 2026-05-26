import { Suspense } from "react";
import BrandLoader from "../components/BrandLoader";
import { lazyWithRetry } from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import {
  RootCrashDiagnosticsFallback,
  buildRootCrashReportRaw,
  rememberRootCrashDiagnostic,
} from "./crashDiagnostics";

let appContentImport: Promise<{ default: typeof import("./AppContent").default }> | null =
  null;

const loadAppContent = () => {
  if (!appContentImport) {
    appContentImport = import("./AppContent")
      .then((mod) => ({ default: mod.default }))
      .catch((error) => {
        appContentImport = null;
        throw error;
      });
  }
  return appContentImport;
};

if (typeof window !== "undefined") {
  void loadAppContent();
}

const AppContent = lazyWithRetry(async () => {
  return loadAppContent();
}, {
  label: "AppContent",
});

function RootBootFallback() {
  return <BrandLoader label="Loading PYRUS" testId="app-loading-fallback" />;
}

function App() {
  return (
    <PlatformErrorBoundary
      label="PYRUS app shell"
      reportCategory="react-root-crash"
      reportSeverity="critical"
      buildReportRaw={buildRootCrashReportRaw}
      onBoundaryError={rememberRootCrashDiagnostic}
      fallbackRender={(props) => <RootCrashDiagnosticsFallback {...props} />}
    >
      <Suspense fallback={<RootBootFallback />}>
        <AppContent />
      </Suspense>
    </PlatformErrorBoundary>
  );
}

export default App;
