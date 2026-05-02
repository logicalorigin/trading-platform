import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

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

const isolationMode = process.env.RAYALGO_CROSS_ORIGIN_ISOLATION || "report-only";
const coopPolicy = process.env.RAYALGO_COOP_POLICY || "same-origin";
const coepPolicy = process.env.RAYALGO_COEP_POLICY || "require-corp";
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
          "Reporting-Endpoints": 'rayalgo="/api/diagnostics/browser-reports"',
        }
      : {
          "Cross-Origin-Opener-Policy-Report-Only": `${coopPolicy}; report-to="rayalgo"`,
          "Cross-Origin-Embedder-Policy-Report-Only": `${coepPolicy}; report-to="rayalgo"`,
          "Reporting-Endpoints": 'rayalgo="/api/diagnostics/browser-reports"',
        };

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay({
      filter: (error) => error.message !== "(unknown runtime error)",
    }),
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
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          const packageName = getNodeModulePackageName(normalizedId);

          if (packageName) {
            if (
              packageName === "lightweight-charts" ||
              packageName === "recharts" ||
              packageName === "recharts-scale" ||
              packageName === "react-resizable-panels" ||
              packageName === "react-smooth" ||
              packageName === "victory-vendor" ||
              packageName === "eventemitter3" ||
              packageName === "react-is" ||
              packageName === "tiny-invariant" ||
              packageName.startsWith("d3")
            ) {
              return "chart-vendor";
            }

            if (
              packageName.startsWith("@radix-ui/") ||
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
              packageName === "date-fns" ||
              packageName === "react-hook-form" ||
              packageName === "zod"
            ) {
              return "data-vendor";
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

          if (normalizedId.includes("/src/features/charting/")) {
            return "feature-charting";
          }

          if (normalizedId.includes("/src/features/backtesting/")) {
            return "feature-backtesting";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: isolationHeaders,
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_API_TARGET || "http://127.0.0.1:8080",
        changeOrigin: true,
        xfwd: true,
        ws: true,
      },
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
