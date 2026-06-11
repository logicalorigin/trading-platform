export const BOOT_INFRA_TASK_IDS = Object.freeze([
  "static-html",
  "react-root",
  "app-content-chunk",
  "workspace-route-chunk",
  "first-screen",
]);

export const SCREEN_BOOT_DATA_DEPS = Object.freeze({
  market: Object.freeze(["session"]),
  signals: Object.freeze(["session", "signal-profile"]),
  flow: Object.freeze(["session", "watchlists"]),
  gex: Object.freeze(["session", "watchlists"]),
  trade: Object.freeze(["session", "watchlists"]),
  account: Object.freeze(["session", "accounts"]),
  algo: Object.freeze(["session", "accounts", "signal-profile"]),
  research: Object.freeze(["session"]),
  backtest: Object.freeze(["session"]),
  diagnostics: Object.freeze(["session"]),
  settings: Object.freeze(["session"]),
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
