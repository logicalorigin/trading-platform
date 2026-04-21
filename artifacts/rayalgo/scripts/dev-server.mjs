import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawPort = process.env.PORT;
const basePath = process.env.BASE_PATH;

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

if (!basePath) {
  throw new Error("BASE_PATH environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const keepAlive = (message) => {
  console.log(message);
  const timer = setInterval(() => {}, 1 << 30);

  const shutdown = () => {
    clearInterval(timer);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

const isPortListening = (targetPort) => new Promise((resolve) => {
  const socket = net.createConnection({ host: "127.0.0.1", port: targetPort });
  const finish = (value) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(value);
  };

  socket.setTimeout(750);
  socket.once("connect", () => finish(true));
  socket.once("timeout", () => finish(false));
  socket.once("error", () => finish(false));
});

const collectResponsePrefix = (stream, maxBytes, resolve) => {
  let collected = 0;
  const chunks = [];

  stream.on("data", (chunk) => {
    if (collected >= maxBytes) {
      return;
    }

    const nextChunk = chunk.subarray(0, Math.max(0, maxBytes - collected));
    collected += nextChunk.length;

    if (nextChunk.length > 0) {
      chunks.push(nextChunk);
    }
  });

  stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
};

const fetchPreviewMarkup = (targetPort) => new Promise((resolve) => {
  const req = http.get(
    {
      host: "127.0.0.1",
      port: targetPort,
      path: "/",
      timeout: 1500,
    },
    (res) => {
      collectResponsePrefix(res, 32_768, resolve);
    },
  );

  req.on("error", () => resolve(null));
  req.on("timeout", () => {
    req.destroy();
    resolve(null);
  });
});

const launch = () => {
  const child = spawn(
    "./node_modules/.bin/vite",
    ["--config", "vite.config.ts", "--host", "0.0.0.0", "--strictPort"],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
};

const main = async () => {
  if (!(await isPortListening(port))) {
    launch();
    return;
  }

  const markup = await fetchPreviewMarkup(port);

  if (markup?.includes("RayAlgo Platform")) {
    keepAlive(`[rayalgo] Reusing existing dev server on port ${port}.`);
    return;
  }

  throw new Error(`Port ${port} is already in use by another process.`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
