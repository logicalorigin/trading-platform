import { createDeferredRouteScreen } from "./DeferredRouteScreen.jsx";

const AlgoRouteScreen = createDeferredRouteScreen({
  loadModule: () => import("./AlgoScreen.jsx"),
  moduleLabel: "AlgoScreen",
  loadingText: "Loading algo workspace",
  loadingTestId: "algo-route-loading",
});

export default AlgoRouteScreen;
