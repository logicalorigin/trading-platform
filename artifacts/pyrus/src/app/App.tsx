import { Suspense } from "react";
import BrandLoader from "../components/BrandLoader";
import { lazyWithRetry } from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import {
  RootCrashDiagnosticsFallback,
  buildRootCrashReportRaw,
  rememberRootCrashDiagnostic,
} from "./crashDiagnostics";

const AppContent = lazyWithRetry(async () => {
  const mod = await import("./AppContent");

  return { default: mod.default };
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
