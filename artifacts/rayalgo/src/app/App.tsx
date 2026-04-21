import "./runtime-config";
import { AppProviders } from "./AppProviders";
import { RayAlgoApp } from "../features/platform/RayAlgoApp";
import { ChartParityLab } from "../features/charting";

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
      {labMode === "chart-parity" ? <ChartParityLab /> : <RayAlgoApp />}
    </AppProviders>
  );
}

export default App;
