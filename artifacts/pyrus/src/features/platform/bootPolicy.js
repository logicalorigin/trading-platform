// The boot overlay hides the app until the frame and the actual first screen
// component can render. Data still streams through each page's inline states;
// the blocker is only the real route component, not session/watchlist/account
// fetches. This avoids showing the workspace frame with an interim route
// skeleton where the page should be.
export const BOOT_INFRA_TASK_IDS = Object.freeze([
  "static-html",
  "react-root",
  "app-content-chunk",
  "workspace-route-chunk",
  "first-screen",
]);

// No screen blocks the overlay on data anymore. Kept as an explicit, testable map
// so the policy is visible and a screen can opt back into a hard data gate later
// if a real product reason requires it.
export const SCREEN_BOOT_DATA_DEPS = Object.freeze({
  market: Object.freeze([]),
  signals: Object.freeze([]),
  flow: Object.freeze([]),
  gex: Object.freeze([]),
  trade: Object.freeze([]),
  account: Object.freeze([]),
  algo: Object.freeze([]),
  research: Object.freeze([]),
  backtest: Object.freeze([]),
  diagnostics: Object.freeze([]),
  settings: Object.freeze([]),
});

export const normalizeBootScreenId = (screenId) =>
  screenId === "unusual" ? "flow" : screenId;

export const resolveScreenBootDataDeps = (screenId) => {
  const normalizedScreenId = normalizeBootScreenId(screenId);
  return SCREEN_BOOT_DATA_DEPS[normalizedScreenId] || SCREEN_BOOT_DATA_DEPS.market;
};

export const resolveBootBlockingTaskIds = (screenId) => [
  ...BOOT_INFRA_TASK_IDS,
  ...resolveScreenBootDataDeps(screenId),
];
