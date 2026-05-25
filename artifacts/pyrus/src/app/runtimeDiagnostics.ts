export type PyrusBuildFingerprint = {
  packageName: string;
  viteConfigPath: string;
  gitSha: string;
  gitBranch: string;
  sourceTreeStatus: "clean" | "dirty" | "unknown";
  devServerStartedAt: string;
  port: string | null;
  basePath: string | null;
  proxyApiTarget: string | null;
  nodeEnv: string | null;
  replitIdPresent: boolean;
};

export type PyrusRuntimeFingerprint = PyrusBuildFingerprint & {
  entryModuleVersion: string;
  buildMode: "vite-dev" | "built-dist" | "node-test";
  viteMode: string;
  viteBaseUrl: string;
  loadedAt: string;
  observedAt: string;
  currentTheme: string;
  locationHref: string;
};

declare const __PYRUS_BUILD_FINGERPRINT__:
  | Partial<PyrusBuildFingerprint>
  | undefined;

export const PYRUS_ENTRY_MODULE_VERSION =
  "app-entry-20260522-pyrus-runtime-fingerprint-v1";

const runtimeLoadedAt = new Date().toISOString();

const FALLBACK_BUILD_FINGERPRINT: PyrusBuildFingerprint = {
  packageName: "@workspace/pyrus",
  viteConfigPath: "artifacts/pyrus/vite.config.ts",
  gitSha: "unknown",
  gitBranch: "unknown",
  sourceTreeStatus: "unknown",
  devServerStartedAt: "",
  port: null,
  basePath: null,
  proxyApiTarget: null,
  nodeEnv: null,
  replitIdPresent: false,
};

const readBuildFingerprint = (): PyrusBuildFingerprint => {
  const buildFingerprint =
    typeof __PYRUS_BUILD_FINGERPRINT__ !== "undefined"
      ? __PYRUS_BUILD_FINGERPRINT__
      : {};

  return {
    ...FALLBACK_BUILD_FINGERPRINT,
    ...buildFingerprint,
    sourceTreeStatus:
      buildFingerprint?.sourceTreeStatus === "clean" ||
      buildFingerprint?.sourceTreeStatus === "dirty"
        ? buildFingerprint.sourceTreeStatus
        : FALLBACK_BUILD_FINGERPRINT.sourceTreeStatus,
  };
};

const readImportMetaEnv = () =>
  ((import.meta as unknown as { env?: Record<string, unknown> }).env || {}) as {
    DEV?: boolean;
    PROD?: boolean;
    MODE?: string;
    BASE_URL?: string;
  };

const resolveBuildMode = (
  env: ReturnType<typeof readImportMetaEnv>,
): PyrusRuntimeFingerprint["buildMode"] => {
  if (env.DEV === true) {
    return "vite-dev";
  }
  if (env.PROD === true) {
    return "built-dist";
  }
  return "node-test";
};

export const buildPyrusRuntimeFingerprint = (): PyrusRuntimeFingerprint => {
  const env = readImportMetaEnv();
  const buildFingerprint = readBuildFingerprint();
  const root =
    typeof document === "undefined" ? null : document.documentElement;

  return {
    ...buildFingerprint,
    entryModuleVersion: PYRUS_ENTRY_MODULE_VERSION,
    buildMode: resolveBuildMode(env),
    viteMode: env.MODE || "",
    viteBaseUrl: env.BASE_URL || buildFingerprint.basePath || "",
    loadedAt: runtimeLoadedAt,
    observedAt: new Date().toISOString(),
    currentTheme: root?.dataset.pyrusTheme || "",
    locationHref:
      typeof window === "undefined" ? "" : window.location.href || "",
  };
};

const writeDatasetValue = (
  root: HTMLElement,
  key: string,
  value: string | number | boolean | null | undefined,
) => {
  root.dataset[key] = value == null ? "" : String(value);
};

export const installPyrusRuntimeDiagnostics = () => {
  const fingerprint = buildPyrusRuntimeFingerprint();

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    writeDatasetValue(root, "pyrusRuntimeBuildMode", fingerprint.buildMode);
    writeDatasetValue(root, "pyrusRuntimeGitSha", fingerprint.gitSha);
    writeDatasetValue(root, "pyrusRuntimeGitBranch", fingerprint.gitBranch);
    writeDatasetValue(
      root,
      "pyrusRuntimeSourceTreeStatus",
      fingerprint.sourceTreeStatus,
    );
    writeDatasetValue(
      root,
      "pyrusRuntimeDevServerStartedAt",
      fingerprint.devServerStartedAt,
    );
    writeDatasetValue(
      root,
      "pyrusRuntimeEntryModuleVersion",
      fingerprint.entryModuleVersion,
    );
    writeDatasetValue(root, "pyrusRuntimeViteMode", fingerprint.viteMode);
    writeDatasetValue(root, "pyrusRuntimeBasePath", fingerprint.basePath);
    writeDatasetValue(root, "pyrusRuntimePort", fingerprint.port);
    writeDatasetValue(
      root,
      "pyrusRuntimeProxyApiTarget",
      fingerprint.proxyApiTarget,
    );
  }

  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & {
      __PYRUS_RUNTIME_FINGERPRINT__?: PyrusRuntimeFingerprint;
      __PYRUS_GET_RUNTIME_FINGERPRINT__?: () => PyrusRuntimeFingerprint;
    };
    runtimeWindow.__PYRUS_RUNTIME_FINGERPRINT__ = fingerprint;
    runtimeWindow.__PYRUS_GET_RUNTIME_FINGERPRINT__ =
      buildPyrusRuntimeFingerprint;
  }

  return fingerprint;
};
