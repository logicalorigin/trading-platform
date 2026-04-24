import { Suspense, lazy, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";

const RayAlgoApp = lazy(async () => {
  const mod = await import("../features/platform/RayAlgoApp");

  return { default: mod.RayAlgoApp };
});

const ChartParityLab = lazy(async () => {
  const mod = await import("../features/charting");

  return { default: mod.ChartParityLab };
});

const TickerSearchLab = lazy(async () => {
  // @ts-expect-error legacy JSX module has no declaration file in this TS config
  const mod = (await import("../RayAlgoPlatform.jsx")) as {
    TickerSearchLab: ComponentType;
  };

  return { default: mod.TickerSearchLab };
});

const resolveLabMode = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("lab");
};

function AppLoadingFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "#080b12",
        color: "#94a3b8",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <style>
        {"@keyframes rayalgoAppSpin { to { transform: rotate(360deg); } }"}
      </style>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "2px solid #1e293b",
          borderTopColor: "#3b82f6",
          animation: "rayalgoAppSpin 900ms linear infinite",
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 700 }}>
        Loading RayAlgo
      </span>
    </div>
  );
}

function App() {
  const labMode = resolveLabMode();

  return (
    <AppProviders>
      <Suspense fallback={<AppLoadingFallback />}>
        {labMode === "chart-parity" ? (
          <ChartParityLab />
        ) : labMode === "ticker-search" ? (
          <TickerSearchLab />
        ) : (
          <RayAlgoApp />
        )}
      </Suspense>
    </AppProviders>
  );
}

export default App;
