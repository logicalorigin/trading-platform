// The boot overlay hides the app ONLY until the app frame can render — i.e. the
// code chunks for the shell. Everything else (session, watchlists, accounts,
// signal data, and the active page's own content) streams in visibly behind the
// frame with its own inline loading, instead of holding a full-screen overlay
// until the slowest data fetch returns. "first-screen" stays a tracked task for
// timing/diagnostics but no longer blocks the overlay.
export const BOOT_INFRA_TASK_IDS = Object.freeze([
  "static-html",
  "react-root",
  "app-content-chunk",
  "workspace-route-chunk",
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
