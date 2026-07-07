import { Suspense } from "react";
import NeuralBootOverlay from "../components/neural/NeuralBootOverlay";
import { NeuralLoader } from "../components/neural/NeuralLoader";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";
import { PlatformErrorBoundary } from "../components/platform/PlatformErrorBoundary";
import { readInitialPlatformScreen } from "../features/platform/initialPlatformScreen";
// @ts-ignore JS module keeps screen chunk preload state outside the React registry.
import { preloadScreenModule } from "../features/platform/screenModulePreloader";
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
  // Warm the workspace route chunk (PlatformApp) in parallel with AppContent so
  // its download overlaps instead of waiting for AppContent to finish loading —
  // the cold-launch hot path is two serial lazy boundaries otherwise. Same
  // module specifier AppContent uses, so Vite serves the one shared chunk.
  preloadDynamicImport(
    () =>
      // @ts-expect-error JSX module has no declaration file in this TS config
      import("../features/platform/PlatformApp.jsx"),
    {
      label: "PlatformApp-warm",
      retries: 1,
    },
  );
  // Warm the persisted first screen in the same startup turn as the frame. If
  // this waits for AppContent, PlatformApp can render its shell first and leave
  // the user staring at the screen skeleton while the route chunk starts late.
  void preloadScreenModule(readInitialPlatformScreen())?.catch?.(() => {});
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
      <NeuralBootOverlay bootLoaderElapsedMs={bootLoaderElapsedMs} />
    </PlatformErrorBoundary>
  );
}

export default App;
