import { createDeferredRouteScreen } from "./DeferredRouteScreen.jsx";

const AccountRouteScreen = createDeferredRouteScreen({
  loadModule: () => import("./AccountScreen.jsx"),
  moduleLabel: "AccountScreen",
  loadingText: "Loading account workspace",
  loadingTestId: "account-route-loading",
});

export default AccountRouteScreen;
