import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer as createViteServer } from "vite";

import { createApiHandler } from "./routes/api.js";
import { ETradeAdapter } from "./brokers/etradeAdapter.js";
import { WebullAdapter } from "./brokers/webullAdapter.js";
import { IbkrAdapter } from "./brokers/ibkrAdapter.js";
import { RuntimeStore } from "./state/store.js";
import { hydrateRuntimeEnvFromSnapshot } from "./services/runtimeEnv.js";
import { createAiFusionWorker } from "./services/aiFusionWorker.js";
import { createMassiveOptionsTracker } from "./services/massiveOptionsTracker.js";
import { createResearchSpotWarmWorker } from "./services/researchSpotWarmWorker.js";
import { createResearchBacktestJobManager } from "./services/researchBacktestJobManager.js";
import { createResearchScoreStudyService } from "./services/researchScoreStudyService.js";

hydrateRuntimeEnvFromSnapshot();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "0.0.0.0";
const isDev = process.argv.includes("--dev") || process.env.NODE_ENV !== "production";
const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

function resolveDevBackgroundProfile({ isDevRuntime = false, rawProfile = process.env.DEV_BACKGROUND_PROFILE } = {}) {
  if (!isDevRuntime) {
    return "full";
  }
  return String(rawProfile || "").trim().toLowerCase() === "full" ? "full" : "lean";
}

async function bootstrap() {
  const store = new RuntimeStore();
  await store.init();
  const devBackgroundProfile = resolveDevBackgroundProfile({ isDevRuntime: isDev });
  const heavyBackgroundWorkersEnabled = !isDev || devBackgroundProfile === "full";

  const adapters = {
    etrade: new ETradeAdapter(store),
    webull: new WebullAdapter(store),
    ibkr: new IbkrAdapter(store),
  };

  const aiFusion = createAiFusionWorker({ store });
  aiFusion.start();
  const researchSpotWarmWorker = createResearchSpotWarmWorker();
  if (heavyBackgroundWorkersEnabled) {
    researchSpotWarmWorker.start();
  }
  const researchBacktestJobs = createResearchBacktestJobManager({ store });
  await researchBacktestJobs.init();
  const researchScoreStudies = createResearchScoreStudyService({
    keepWorkerAliveWhenIdle: heavyBackgroundWorkersEnabled,
  });
  await researchScoreStudies.init();

  const massiveOptionsTracker = createMassiveOptionsTracker();
  const handleApiRequest = createApiHandler({
    store,
    adapters,
    aiFusion,
    researchSpotWarmWorker,
    massiveOptionsTracker,
    researchBacktestJobs,
    researchScoreStudies,
  });

  const server = http.createServer();

  const vite = isDev
    ? await createViteServer({
        server: {
          middlewareMode: true,
          // Reuse the same HTTP server for HMR to avoid port binding conflicts.
          hmr: { server },
        },
        appType: "spa",
      })
    : null;

  server.on("request", async (req, res) => {
    try {
      if (req.url?.startsWith("/api/")) {
        await handleApiRequest(req, res);
        return;
      }

      if (vite) {
        await new Promise((resolve, reject) => {
          vite.middlewares(req, res, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
        return;
      }

      await serveStaticAsset(req, res);
    } catch (error) {
      if (vite) {
        vite.ssrFixStacktrace(error);
      }

      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: error.message || "Internal server error",
        }),
      );
    }
  });

  server.once("error", (error) => {
    console.error(`Server failed to listen on http://${HOST}:${PORT}:`, error);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const mode = isDev ? "development" : "production";
    if (isDev) {
      console.log(
        `[dev-profile] ${devBackgroundProfile} (${heavyBackgroundWorkersEnabled ? "full background services" : "heavy background workers disabled"})`,
      );
    }
    console.log(`Broker API + UI server (${mode}) running at http://${HOST}:${PORT}`);
  });
}

async function serveStaticAsset(req, res) {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = safeJoin(distDir, pathname);
  const fileToServe =
    (await exists(filePath)) && !(await isDirectory(filePath))
      ? filePath
      : path.join(distDir, "index.html");

  if (!(await exists(fileToServe))) {
    res.statusCode = 404;
    res.end("Build output not found. Run `npm run build` first.");
    return;
  }

  const content = await fs.readFile(fileToServe);
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeTypeFor(fileToServe));
  res.end(content);
}

function safeJoin(basePath, targetPath) {
  const full = path.join(basePath, targetPath);
  const normalizedBase = path.resolve(basePath);
  const normalizedTarget = path.resolve(full);
  if (!normalizedTarget.startsWith(normalizedBase)) {
    return path.join(basePath, "index.html");
  }
  return normalizedTarget;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function mimeTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

bootstrap().catch((error) => {
  console.error("Server bootstrap failed:", error);
  process.exit(1);
});
