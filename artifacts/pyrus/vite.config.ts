import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const configRequire = createRequire(import.meta.url);
const resolvePackageRoot = (packageName: string): string =>
  path.dirname(configRequire.resolve(`${packageName}/package.json`));
const reactQueryRequire = createRequire(
  configRequire.resolve("@tanstack/react-query/package.json"),
);

const readGitValue = (args: string[]): string => {
  try {
    // `--no-optional-locks` keeps these reads from touching the index lock (so a
    // concurrent git operation can't make config eval hang), and `timeout` bounds
    // each call so a slow/locked repo can never stall vite startup. These values
    // only feed the dev build fingerprint, so failing to "" is always acceptable.
    return execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 800,
    }).trim();
  } catch {
    return "";
  }
};

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const getNodeModulePackageName = (id: string): string | null => {
  const normalizedId = id.replaceAll("\\", "/");
  const nodeModulesIndex = normalizedId.lastIndexOf("/node_modules/");

  if (nodeModulesIndex === -1) {
    return null;
  }

  const packagePath = normalizedId
    .slice(nodeModulesIndex + "/node_modules/".length)
    .split("/");

  if (packagePath[0]?.startsWith("@") && packagePath[1]) {
    return `${packagePath[0]}/${packagePath[1]}`;
  }

  return packagePath[0] ?? null;
};

const DEFERRED_MODULE_PRELOAD_PATTERNS = [
  /feature-backtesting/,
  /feature-charting-lab/,
  /feature-charting-mini/,
  /feature-charting-surface/,
  /feature-pyrus-signals-settings/,
  /pyrus-signals-core/,
  /vendor-d3/,
  /vendor-hls/,
  /vendor-lightweight-charts/,
  /vendor-recharts/,
  /vendor-three/,
  /(^|\/)neural-/,
];

const isolationMode =
  process.env.PYRUS_CROSS_ORIGIN_ISOLATION || "report-only";
const coopPolicy = process.env.PYRUS_COOP_POLICY || "same-origin";
const coepPolicy = process.env.PYRUS_COEP_POLICY || "require-corp";
const reactRoot = resolvePackageRoot("react");
const reactDomRoot = resolvePackageRoot("react-dom");
const reactQueryRoot = resolvePackageRoot("@tanstack/react-query");
const queryCoreRoot = path.dirname(
  reactQueryRequire.resolve("@tanstack/query-core/package.json"),
);
const sourceTreeDirty = readGitValue(["status", "--short"]).length > 0;
const runtimeBuildFingerprint = {
  packageName: "@workspace/pyrus",
  viteConfigPath: "artifacts/pyrus/vite.config.ts",
  gitSha: readGitValue(["rev-parse", "--short=12", "HEAD"]) || "unknown",
  gitBranch: readGitValue(["branch", "--show-current"]) || "unknown",
  sourceTreeStatus: sourceTreeDirty ? "dirty" : "clean",
  devServerStartedAt: new Date().toISOString(),
  port: rawPort,
  basePath,
  proxyApiTarget: process.env.VITE_PROXY_API_TARGET || "http://127.0.0.1:8080",
  nodeEnv: process.env.NODE_ENV || null,
  replitIdPresent: process.env.REPL_ID !== undefined,
};
const enableReplitRuntimeErrorModal =
  process.env.PYRUS_ENABLE_REPLIT_RUNTIME_ERROR_MODAL === "1";
const isolationHeaders =
  isolationMode === "off"
    ? {}
    : isolationMode.startsWith("enforce")
      ? {
          "Cross-Origin-Opener-Policy": coopPolicy,
          "Cross-Origin-Embedder-Policy":
            isolationMode === "enforce-credentialless"
              ? "credentialless"
              : coepPolicy,
          "Cross-Origin-Resource-Policy": "same-origin",
          "Reporting-Endpoints": 'pyrus="/api/diagnostics/browser-reports"',
        }
      : {
          "Cross-Origin-Opener-Policy-Report-Only": `${coopPolicy}; report-to="pyrus"`,
          "Cross-Origin-Embedder-Policy-Report-Only": `${coepPolicy}; report-to="pyrus"`,
          "Reporting-Endpoints": 'pyrus="/api/diagnostics/browser-reports"',
        };

// The two route chunks that EVERY cold launch needs (AppContent and the
// workspace shell PlatformApp) are dynamic imports, so the browser only
// discovers them after it parses the entry and App.tsx fires its runtime
// preloadDynamicImport calls. Emit <link rel=modulepreload> for their hashed
// chunks in the HTML <head> so fetching starts in parallel with entry parsing,
// shrinking the boot overlay's longest blocking wait. Production build only --
// the dev server serves unbundled modules. The persisted first-screen chunk
// varies per user and stays on App.tsx's synchronous runtime preload path.
const PRIORITY_PRELOAD_SOURCE_MODULES = [
  "/src/app/AppContent.tsx",
  "/src/features/platform/PlatformApp.jsx",
];
const BOOT_NEURAL_SOURCE_MODULE = "/src/boot-neural.tsx";
const BOOT_NEURAL_SCENE_SOURCE_MODULE = "/src/boot-neural-scene.tsx";

function basePrefixFor(resolvedBase: string) {
  return resolvedBase.endsWith("/") ? resolvedBase : `${resolvedBase}/`;
}

function bootNeuralHtmlEntryPlugin(): import("vite").Plugin {
  let resolvedBase = "/";
  return {
    name: "pyrus-boot-neural-html-entry",
    configResolved(config) {
      resolvedBase = config.base || "/";
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const basePrefix = basePrefixFor(resolvedBase);
        const devInjectTo = "head" as const;
        const productionInjectTo = "head-prepend" as const;
        const sceneUrlAssignment = (sceneUrl: string) =>
          `window.__PYRUS_BOOT_NEURAL_SCENE_URL__=${JSON.stringify(sceneUrl)};`;

        if (!ctx.bundle) {
          return {
            html,
            tags: [
              {
                tag: "script",
                children: sceneUrlAssignment(
                  `${basePrefix}${BOOT_NEURAL_SCENE_SOURCE_MODULE.slice(1)}`,
                ),
                injectTo: devInjectTo,
              },
              {
                tag: "script",
                attrs: {
                  type: "module",
                  src: `${basePrefix}${BOOT_NEURAL_SOURCE_MODULE.slice(1)}`,
                },
                injectTo: devInjectTo,
              },
            ],
          };
        }

        const findChunkBySourceModule = (sourceModule: string) =>
          Object.values(ctx.bundle ?? {}).find(
            (file) =>
              file.type === "chunk" &&
              file.facadeModuleId
                ?.replaceAll("\\", "/")
                .endsWith(sourceModule),
          );

        const bootChunk = findChunkBySourceModule(BOOT_NEURAL_SOURCE_MODULE);
        const sceneChunk = findChunkBySourceModule(
          BOOT_NEURAL_SCENE_SOURCE_MODULE,
        );
        if (!bootChunk || bootChunk.type !== "chunk") return html;
        if (!sceneChunk || sceneChunk.type !== "chunk") return html;

        return {
          html,
          tags: [
            {
              tag: "script",
              children: sceneUrlAssignment(`${basePrefix}${sceneChunk.fileName}`),
              injectTo: productionInjectTo,
            },
            {
              tag: "script",
              attrs: {
                type: "module",
                crossorigin: true,
                src: `${basePrefix}${bootChunk.fileName}`,
              },
              injectTo: productionInjectTo,
            },
          ],
        };
      },
    },
  };
}

function criticalChunkModulePreloadPlugin(): import("vite").Plugin {
  let resolvedBase = "/";
  return {
    name: "pyrus-priority-modulepreload",
    apply: "build",
    configResolved(config) {
      resolvedBase = config.base || "/";
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const basePrefix = basePrefixFor(resolvedBase);
        const hrefs: string[] = [];
        for (const file of Object.values(bundle)) {
          if (file.type !== "chunk") continue;
          const facade = file.facadeModuleId?.replaceAll("\\", "/");
          if (
            facade &&
            PRIORITY_PRELOAD_SOURCE_MODULES.some((module) =>
              facade.endsWith(module),
            )
          ) {
            hrefs.push(`${basePrefix}${file.fileName}`);
          }
        }
        if (!hrefs.length) return html;
        return {
          html,
          tags: hrefs.map((href) => ({
            tag: "link",
            attrs: { rel: "modulepreload", href, crossorigin: true },
            injectTo: "head" as const,
          })),
        };
      },
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    __PYRUS_BUILD_FINGERPRINT__: JSON.stringify(runtimeBuildFingerprint),
  },
  plugins: [
    // The IBKR Client Portal gateway popup (served through the API's reverse
    // proxy at this mount) runs IBKR's SPA, which computes root-absolute URLs
    // at runtime (e.g. /en/includes/general/gdpr-am.php). Those escape the
    // subpath mount, land on the dev server, and would otherwise receive the
    // PYRUS index.html shell — which the gateway page then INJECTS into the
    // login popup (PYRUS boots inside the popup and hides the login form).
    // Re-anchor any request whose Referer is inside the gateway mount back
    // into the mount so it resolves against the gateway instead.
    {
      name: "ibkr-gateway-mount-reanchor",
      configureServer(server) {
        const MOUNT = "/api/broker-execution/ibkr-portal/gateway";
        server.middlewares.use((req, res, next) => {
          const referer = req.headers.referer;
          const url = req.url || "";
          if (!referer || url.startsWith(MOUNT)) {
            next();
            return;
          }
          try {
            if (new URL(referer).pathname.startsWith(MOUNT)) {
              // The SPA derives its API base from the page URL's FIRST path
              // segment (host + "/" + pathname.split("/")[1] + "/"). Under
              // this mount that segment is "api", so its auth calls come in as
              // /api/Authenticator when the gateway's real handler is
              // /sso/Authenticator. Restore the intended "sso" prefix, then
              // re-anchor under the mount. 307 preserves method + body (302
              // would turn the credential POST into a bodyless GET).
              const fixed = url.startsWith("/api/")
                ? "/sso/" + url.slice("/api/".length)
                : url;
              res.statusCode = 307;
              res.setHeader("Location", MOUNT + fixed);
              res.end();
              return;
            }
          } catch {
            // Unparseable Referer — treat as unrelated.
          }
          next();
        });
      },
    },
    react(),
    tailwindcss(),
    bootNeuralHtmlEntryPlugin(),
    criticalChunkModulePreloadPlugin(),
    ...(enableReplitRuntimeErrorModal
      ? [
          runtimeErrorOverlay({
            filter: (error) => error.message !== "(unknown runtime error)",
          }),
        ]
      : []),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(import.meta.dirname, "src"),
      },
      {
        find: "react/jsx-runtime",
        replacement: configRequire.resolve("react/jsx-runtime"),
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: configRequire.resolve("react/jsx-dev-runtime"),
      },
      {
        find: "react-dom/client",
        replacement: configRequire.resolve("react-dom/client"),
      },
      {
        find: "react",
        replacement: reactRoot,
      },
      {
        find: "react-dom",
        replacement: reactDomRoot,
      },
      {
        find: "@tanstack/react-query",
        replacement: reactQueryRoot,
      },
      {
        find: "@tanstack/query-core",
        replacement: queryCoreRoot,
      },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 350,
    reportCompressedSize: false,
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter(
          (dep) =>
            !DEFERRED_MODULE_PRELOAD_PATTERNS.some((pattern) =>
              pattern.test(dep),
            ),
        );
      },
    },
    rollupOptions: {
      input: {
        app: path.resolve(import.meta.dirname, "index.html"),
        "boot-neural": path.resolve(import.meta.dirname, "src/boot-neural.tsx"),
        "boot-neural-scene": path.resolve(
          import.meta.dirname,
          "src/boot-neural-scene.tsx",
        ),
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");

          if (
            normalizedId.includes("/src/features/preferences/useUserPreferences") ||
            normalizedId.includes("/src/features/preferences/userPreferenceModel") ||
            normalizedId.includes("/src/lib/motion") ||
            normalizedId.includes("/src/lib/responsive") ||
            normalizedId.includes("/src/lib/timeZone") ||
            normalizedId.includes("/src/lib/uiTokens") ||
            normalizedId.includes("/src/lib/formatters") ||
            normalizedId.includes("/src/lib/tooltipStyles") ||
            normalizedId.includes("/src/lib/workspaceState") ||
            normalizedId.includes("/src/components/LogoLoader") ||
            normalizedId.includes("/src/components/platform/BottomSheet") ||
            normalizedId.includes("/src/components/platform/DeferredRender") ||
            normalizedId.includes("/src/components/platform/Drawer") ||
            normalizedId.includes("/src/components/platform/PlatformErrorBoundary") ||
            normalizedId.includes("/src/components/platform/primitives") ||
            normalizedId.includes("/src/components/platform/InfoTooltipIcon") ||
            normalizedId.includes("/src/components/ui/Button") ||
            normalizedId.includes("/src/components/ui/CockpitHeader") ||
            normalizedId.includes("/src/components/ui/PulseDot") ||
            normalizedId.includes("/src/components/ui/SectionHeader") ||
            normalizedId.includes("/src/components/ui/Stat") ||
            normalizedId.includes("/src/components/ui/dropdown-menu") ||
            normalizedId.includes("/src/components/ui/popover") ||
            normalizedId.includes("/src/components/ui/tabs") ||
            normalizedId.includes("/src/components/ui/tooltip")
          ) {
            return "ui-core";
          }

          if (
            normalizedId.includes("/src/features/platform/live-streams") ||
            normalizedId.includes("/src/features/platform/flowFilterStore") ||
            normalizedId.includes("/src/features/platform/hydrationCoordinator") ||
            normalizedId.includes("/src/features/platform/marketFlowStore") ||
            normalizedId.includes("/src/features/platform/platformContexts") ||
            normalizedId.includes("/src/features/platform/platformJsonRequest") ||
            normalizedId.includes("/src/features/platform/queryDefaults") ||
            normalizedId.includes("/src/features/platform/runtimeCache") ||
            normalizedId.includes("/src/features/platform/runtimeTickerStore") ||
            normalizedId.includes("/src/features/platform/signalMonitorStore") ||
            normalizedId.includes("/src/features/platform/tickerIdentity") ||
            normalizedId.includes("/src/features/platform/tradeFlowStore") ||
            normalizedId.includes("/src/features/platform/tradeOptionChainStore") ||
            normalizedId.includes("/src/features/platform/workloadStats")
          ) {
            return "platform-runtime";
          }

          if (
            normalizedId.includes("/src/features/charting/activeChartBarStore") ||
            normalizedId.includes("/src/features/charting/chartEvents") ||
            normalizedId.includes("/src/features/charting/chartHydrationRuntime") ||
            normalizedId.includes("/src/features/charting/chartHydrationStats") ||
            normalizedId.includes("/src/features/charting/indicators") ||
            normalizedId.includes("/src/features/charting/model") ||
            normalizedId.includes("/src/features/charting/timeframeRollups") ||
            normalizedId.includes("/src/features/charting/useDrawingHistory") ||
            normalizedId.includes("/src/features/charting/useMassiveStockAggregateStream") ||
            normalizedId.includes("/src/features/charting/timeframes")
          ) {
            return "charting-runtime";
          }

          if (
            normalizedId.includes("/src/app/runtime-config") ||
            normalizedId.includes("/src/lib/dynamicImport") ||
            normalizedId.includes("/src/lib/typography")
          ) {
            return "app-runtime";
          }

          // Neural loading-screen engine — only ever reached through the
          // React.lazy boundary in NeuralCanvas, so keep it (and its runtime
          // geometry sampler) out of the eager boot path. NeuralBootOverlay and
          // webglCapability deliberately stay eager (App.tsx imports them) and
          // are NOT matched here.
          if (
            normalizedId.includes("/src/components/neural/neural-core/") ||
            normalizedId.includes("/src/components/neural/NeuralCanvas") ||
            normalizedId.includes("/src/lib/neural-geometry")
          ) {
            return "neural";
          }

          if (normalizedId.includes("/lib/api-client-react/")) {
            return "api-client";
          }

          if (normalizedId.includes("/lib/pyrus-signals-core/")) {
            return "pyrus-signals-core";
          }

          const packageName = getNodeModulePackageName(normalizedId);

          if (packageName) {
            if (packageName === "hls.js") {
              return "vendor-hls";
            }

            // Heavy deps that are only reachable from lazy routes but were being
            // dragged onto the eager boot path: the catch-all "vendor" chunk
            // below merges every unmatched dep into one file, and because the
            // entry statically needs *something* in it, rollup eager-preloads the
            // whole chunk. Give these their own chunks so they load with their
            // real (lazy) consumers instead of on every cold boot.
            if (packageName.startsWith("@dnd-kit/")) {
              // Drag-and-drop: only the Algo operations table + interactive
              // column headers use it.
              return "vendor-dnd-kit";
            }
            if (packageName === "lodash" || packageName === "lodash-es") {
              // No direct src importer — transitive of recharts; keep it lazy.
              return "vendor-recharts";
            }
            if (packageName === "decimal.js-light") {
              // recharts-scale dependency.
              return "vendor-recharts";
            }
            if (packageName === "fancy-canvas") {
              // lightweight-charts dependency.
              return "vendor-lightweight-charts";
            }
            if (packageName === "dexie") {
              // IndexedDB runtime cache; not needed for first paint.
              return "vendor-dexie";
            }

            // three.js neural / 3D mark scenes are lazy-only. Pin the package
            // here so it does not fall into the eager catch-all "vendor" chunk.
            if (
              packageName === "three" ||
              packageName === "buffer" ||
              packageName === "base64-js"
            ) {
              return "vendor-three";
            }

            if (packageName === "lightweight-charts") {
              return "vendor-lightweight-charts";
            }

            if (
              packageName === "recharts" ||
              packageName === "recharts-scale" ||
              packageName === "react-smooth" ||
              packageName === "victory-vendor" ||
              packageName === "eventemitter3" ||
              packageName === "react-is" ||
              packageName === "tiny-invariant"
            ) {
              return "vendor-recharts";
            }

            if (packageName.startsWith("d3")) {
              return "vendor-d3";
            }

            if (packageName === "react-resizable-panels") {
              return "vendor-chart-ui";
            }

            if (
              packageName.startsWith("@radix-ui/") ||
              packageName.startsWith("@floating-ui/") ||
              packageName === "cmdk" ||
              packageName === "input-otp" ||
              packageName === "react-day-picker" ||
              packageName === "vaul"
            ) {
              return "ui-vendor";
            }

            if (
              packageName === "framer-motion" ||
              packageName === "embla-carousel-react" ||
              packageName === "next-themes" ||
              packageName === "sonner"
            ) {
              return "motion-vendor";
            }

            if (
              packageName === "react-icons" ||
              packageName === "lucide-react"
            ) {
              return "icon-vendor";
            }

            if (
              packageName === "@hookform/resolvers" ||
              packageName === "@tanstack/react-query" ||
              packageName === "@tanstack/react-table" ||
              packageName === "@tanstack/react-virtual" ||
              packageName === "@tanstack/table-core" ||
              packageName === "@tanstack/virtual-core" ||
              packageName === "date-fns" ||
              packageName === "react-hook-form" ||
              packageName === "zod"
            ) {
              return "data-vendor";
            }

            if (
              packageName === "clsx" ||
              packageName === "tailwind-merge" ||
              packageName === "class-variance-authority"
            ) {
              return "utility-vendor";
            }

            if (
              packageName === "react" ||
              packageName === "react-dom" ||
              packageName === "scheduler"
            ) {
              return "framework-vendor";
            }

            return "vendor";
          }

          if (normalizedId.includes("/src/features/charting/ChartParityLab")) {
            return "feature-charting-lab";
          }

          if (
            normalizedId.includes("/src/features/charting/PyrusSignalsSettingsMenu") ||
            normalizedId.includes("/src/features/charting/pyrusSignalsPineAdapter")
          ) {
            return "feature-pyrus-signals-settings";
          }

          if (
            normalizedId.includes("/src/features/charting/ResearchChartSurface") ||
            normalizedId.includes("/src/features/charting/ResearchChartFrame") ||
            normalizedId.includes("/src/features/charting/ResearchChartWidgetChrome")
          ) {
            return "feature-charting-surface";
          }

          if (
            normalizedId.includes("/src/features/charting/ResearchMiniChart") ||
            normalizedId.includes("/src/features/charting/ResearchSparkline")
          ) {
            return "feature-charting-mini";
          }

          if (normalizedId.includes("/src/features/backtesting/")) {
            return "feature-backtesting";
          }

          return undefined;
        },
      },
    },
  },
  // Prebundle boot-hot and lazy-only heavy deps at server start so cold
  // dev boot never waits on on-demand prebundling, and chart-lib screens don't
  // trigger a mid-session "new dependencies optimized → reload" full-page stall.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@tanstack/react-query",
      "@tanstack/react-table",
      "@tanstack/react-virtual",
      "lucide-react",
      "recharts",
      "lightweight-charts",
      "d3",
      "hls.js/light",
      "three",
    ],
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: isolationHeaders,
    // Eagerly transform the cold-boot hot path at server start instead of
    // discovering/transforming it serially on first request.
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/app/App.tsx",
        "./src/app/AppContent.tsx",
        "./src/features/platform/PlatformApp.jsx",
        "./src/screens/MarketScreen.jsx",
      ],
    },
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_API_TARGET || "http://127.0.0.1:8080",
        changeOrigin: true,
        xfwd: true,
        ws: true,
      },
    },
    watch: {
      ignored: ["**/dist/**"],
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: isolationHeaders,
  },
});
