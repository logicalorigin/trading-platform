import os from "node:os";
import path from "node:path";

const APP_DATA_DIR_NAME = process.env.APP_DATA_DIR_NAME || "spy-options-trading-platform";
const REPO_ROOT = path.resolve(process.cwd());
const HOME_DATA_BASE_DIR = path.join(os.homedir(), ".local", "share");
const RESOLVED_XDG_DATA_HOME = process.env.XDG_DATA_HOME
  ? path.resolve(process.env.XDG_DATA_HOME)
  : null;
const XDG_DATA_HOME_IS_REPO_LOCAL = Boolean(
  RESOLVED_XDG_DATA_HOME
  && (RESOLVED_XDG_DATA_HOME === REPO_ROOT || RESOLVED_XDG_DATA_HOME.startsWith(`${REPO_ROOT}${path.sep}`)),
);
const DEFAULT_DATA_BASE_DIR = XDG_DATA_HOME_IS_REPO_LOCAL
  ? HOME_DATA_BASE_DIR
  : RESOLVED_XDG_DATA_HOME || HOME_DATA_BASE_DIR;

export const LEGACY_APP_DATA_ROOT = path.join(process.cwd(), "server", "data");
export const REPO_LOCAL_APP_DATA_ROOT = XDG_DATA_HOME_IS_REPO_LOCAL
  ? path.join(RESOLVED_XDG_DATA_HOME, APP_DATA_DIR_NAME)
  : null;
export const APP_DATA_ROOT = path.resolve(
  process.env.APP_DATA_DIR || path.join(DEFAULT_DATA_BASE_DIR, APP_DATA_DIR_NAME),
);
export const RUNTIME_STATE_PATH = path.join(APP_DATA_ROOT, "runtime-state.json");
export const MASSIVE_CACHE_ROOT = path.join(APP_DATA_ROOT, "massive-cache");
export const MASSIVE_OPTIONS_CACHE_ROOT = path.join(MASSIVE_CACHE_ROOT, "options-bars");
export const MASSIVE_CONTRACT_CACHE_ROOT = path.join(MASSIVE_CACHE_ROOT, "options-contracts");
export const MASSIVE_EQUITY_CACHE_ROOT = path.join(MASSIVE_CACHE_ROOT, "equity-bars");
export const MASSIVE_FLAT_FILES_ROOT = path.join(APP_DATA_ROOT, "massive-flat-files");

export function describeRuntimeDataPaths() {
  return {
    appDataRoot: APP_DATA_ROOT,
    legacyAppDataRoot: LEGACY_APP_DATA_ROOT,
    repoLocalAppDataRoot: REPO_LOCAL_APP_DATA_ROOT,
    runtimeStatePath: RUNTIME_STATE_PATH,
    massiveCacheRoot: MASSIVE_CACHE_ROOT,
    massiveOptionsCacheRoot: MASSIVE_OPTIONS_CACHE_ROOT,
    massiveContractCacheRoot: MASSIVE_CONTRACT_CACHE_ROOT,
    massiveEquityCacheRoot: MASSIVE_EQUITY_CACHE_ROOT,
    massiveFlatFilesRoot: MASSIVE_FLAT_FILES_ROOT,
  };
}
