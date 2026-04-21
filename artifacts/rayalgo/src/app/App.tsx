import "./runtime-config";
import { AppProviders } from "./AppProviders";
import { RayAlgoApp } from "../features/platform/RayAlgoApp";

function App() {
  return (
    <AppProviders>
      <RayAlgoApp />
    </AppProviders>
  );
}

export default App;
