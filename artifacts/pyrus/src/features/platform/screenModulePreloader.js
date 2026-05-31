import {
  BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID,
  completeBootProgressTask,
  failBootProgressTask,
  startBootProgressTask,
} from "../../app/bootProgress";
import { retryDynamicImport } from "../../lib/dynamicImport";

const SCREEN_LOADERS = {
  market: () => import("../../screens/MarketScreen.jsx"),
  signals: () => import("../../screens/SignalsScreen.jsx"),
  flow: () => import("../../screens/FlowScreen.jsx"),
  gex: () => import("../../screens/GexScreen.jsx"),
  trade: () => import("../../screens/TradeScreen.jsx"),
  account: () => import("../../screens/AccountScreen.jsx"),
  research: () => import("../../screens/ResearchScreen.jsx"),
  algo: () => import("../../screens/AlgoScreen.jsx"),
  backtest: () => import("../../screens/BacktestScreen.jsx"),
  diagnostics: () => import("../../screens/DiagnosticsScreen.jsx"),
  settings: () => import("../../screens/SettingsScreen.jsx"),
};

const SCREEN_MODULE_PRELOADS = new Map();
const SCREEN_MODULE_PRELOAD_STATE = new Map();
const SCREEN_MODULE_COMPONENTS = new Map();

const screenModuleLabel = (screenId) => `${screenId}ScreenPreload`;

export const getPreloadedScreenComponent = (screenId) =>
  SCREEN_MODULE_COMPONENTS.get(screenId) || null;

export const loadScreenModule = (
  screenId,
  { label = screenModuleLabel(screenId), reloadOnFailure = true } = {},
) => {
  const loader = SCREEN_LOADERS[screenId];
  if (!loader) return Promise.resolve(null);
  const existing = SCREEN_MODULE_PRELOADS.get(screenId);
  if (existing) return existing;

  SCREEN_MODULE_PRELOAD_STATE.set(screenId, {
    status: "loading",
    startedAt: Date.now(),
    label,
  });
  const bootProgressTaskId =
    BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID[screenId];
  if (bootProgressTaskId) {
    startBootProgressTask(bootProgressTaskId);
  }
  const promise = retryDynamicImport(loader, {
    label,
    reloadOnFailure,
  })
    .then((mod) => {
      if (mod?.default) {
        SCREEN_MODULE_COMPONENTS.set(screenId, mod.default);
      }
      SCREEN_MODULE_PRELOAD_STATE.set(screenId, {
        status: "ready",
        startedAt: SCREEN_MODULE_PRELOAD_STATE.get(screenId)?.startedAt || null,
        completedAt: Date.now(),
        label,
      });
      if (bootProgressTaskId) {
        completeBootProgressTask(bootProgressTaskId);
      }
      return mod;
    })
    .catch((error) => {
      SCREEN_MODULE_PRELOADS.delete(screenId);
      SCREEN_MODULE_PRELOAD_STATE.set(screenId, {
        status: "failed",
        startedAt: SCREEN_MODULE_PRELOAD_STATE.get(screenId)?.startedAt || null,
        completedAt: Date.now(),
        label,
        error: error instanceof Error ? error.message : String(error),
      });
      if (bootProgressTaskId) {
        failBootProgressTask(bootProgressTaskId, error);
      }
      throw error;
    });

  SCREEN_MODULE_PRELOADS.set(screenId, promise);
  return promise;
};

export const preloadScreenModule = (screenId) =>
  loadScreenModule(screenId, {
    label: screenModuleLabel(screenId),
    reloadOnFailure: false,
  });

export const getScreenModulePreloadSnapshot = () =>
  Array.from(SCREEN_MODULE_PRELOAD_STATE.entries()).reduce(
    (acc, [screenId, state]) => {
      acc[screenId] = { ...state };
      return acc;
    },
    {},
  );
