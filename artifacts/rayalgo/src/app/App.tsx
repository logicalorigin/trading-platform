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

function App() {
  const labMode = resolveLabMode();

  return (
    <AppProviders>
      <Suspense fallback={null}>
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
