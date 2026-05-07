export type RayalgoBuildFingerprint = {
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

export type RayalgoRuntimeFingerprint = RayalgoBuildFingerprint & {
  entryModuleVersion: string;
  buildMode: "vite-dev" | "built-dist" | "node-test";
  viteMode: string;
  viteBaseUrl: string;
  loadedAt: string;
  observedAt: string;
  currentTheme: string;
  locationHref: string;
};

declare const __RAYALGO_BUILD_FINGERPRINT__:
  | Partial<RayalgoBuildFingerprint>
  | undefined;

export const RAYALGO_ENTRY_MODULE_VERSION =
  "app-entry-20260507-runtime-fingerprint-v1";

const runtimeLoadedAt = new Date().toISOString();

const FALLBACK_BUILD_FINGERPRINT: RayalgoBuildFingerprint = {
  packageName: "@workspace/rayalgo",
  viteConfigPath: "artifacts/rayalgo/vite.config.ts",
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

const readBuildFingerprint = (): RayalgoBuildFingerprint => {
  const buildFingerprint =
    typeof __RAYALGO_BUILD_FINGERPRINT__ === "undefined"
      ? {}
      : __RAYALGO_BUILD_FINGERPRINT__;

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
): RayalgoRuntimeFingerprint["buildMode"] => {
  if (env.DEV === true) {
    return "vite-dev";
  }
  if (env.PROD === true) {
    return "built-dist";
  }
  return "node-test";
};

export const buildRayalgoRuntimeFingerprint = (): RayalgoRuntimeFingerprint => {
  const env = readImportMetaEnv();
  const buildFingerprint = readBuildFingerprint();
  const root =
    typeof document === "undefined" ? null : document.documentElement;

  return {
    ...buildFingerprint,
    entryModuleVersion: RAYALGO_ENTRY_MODULE_VERSION,
    buildMode: resolveBuildMode(env),
    viteMode: env.MODE || "",
    viteBaseUrl: env.BASE_URL || buildFingerprint.basePath || "",
    loadedAt: runtimeLoadedAt,
    observedAt: new Date().toISOString(),
    currentTheme: root?.dataset.rayalgoTheme || "",
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

export const installRayalgoRuntimeDiagnostics = () => {
  const fingerprint = buildRayalgoRuntimeFingerprint();

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    writeDatasetValue(root, "rayalgoRuntimeBuildMode", fingerprint.buildMode);
    writeDatasetValue(root, "rayalgoRuntimeGitSha", fingerprint.gitSha);
    writeDatasetValue(root, "rayalgoRuntimeGitBranch", fingerprint.gitBranch);
    writeDatasetValue(
      root,
      "rayalgoRuntimeSourceTreeStatus",
      fingerprint.sourceTreeStatus,
    );
    writeDatasetValue(
      root,
      "rayalgoRuntimeDevServerStartedAt",
      fingerprint.devServerStartedAt,
    );
    writeDatasetValue(
      root,
      "rayalgoRuntimeEntryModuleVersion",
      fingerprint.entryModuleVersion,
    );
    writeDatasetValue(root, "rayalgoRuntimeViteMode", fingerprint.viteMode);
    writeDatasetValue(root, "rayalgoRuntimeBasePath", fingerprint.basePath);
    writeDatasetValue(root, "rayalgoRuntimePort", fingerprint.port);
    writeDatasetValue(
      root,
      "rayalgoRuntimeProxyApiTarget",
      fingerprint.proxyApiTarget,
    );
  }

  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & {
      __RAYALGO_RUNTIME_FINGERPRINT__?: RayalgoRuntimeFingerprint;
      __RAYALGO_GET_RUNTIME_FINGERPRINT__?: () => RayalgoRuntimeFingerprint;
    };
    runtimeWindow.__RAYALGO_RUNTIME_FINGERPRINT__ = fingerprint;
    runtimeWindow.__RAYALGO_GET_RUNTIME_FINGERPRINT__ =
      buildRayalgoRuntimeFingerprint;
  }

  return fingerprint;
};
