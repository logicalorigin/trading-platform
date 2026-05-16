#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

const replit = read(".replit");
const rootPackage = JSON.parse(read("package.json"));
const rootScripts = rootPackage.scripts ?? {};

check(
  /^\s*stack\s*=\s*"PNPM_WORKSPACE"\s*$/m.test(replit),
  ".replit must keep [agent] stack = \"PNPM_WORKSPACE\" so the RayAlgo web artifact owns app bring-up.",
);
check(
  !/^\s*run\s*=/m.test(replit),
  ".replit must not define a root run command; use Replit's default Run Replit App entry.",
);
check(
  /^\s*\[workflows\]\s*$(?:[\s\S]*?)^\s*runButton\s*=\s*"artifacts\/rayalgo: web"\s*$/m.test(
    replit,
  ),
  ".replit must keep [workflows] runButton = \"artifacts/rayalgo: web\" so the primary Run button targets the single RayAlgo app workflow.",
);
check(
  !/^\s*\[\[workflows\.workflow\]\]\s*$/m.test(replit),
  ".replit must not define repo-tracked workflow tasks; artifact TOMLs are the startup source of truth.",
);
check(
  !/^\s*\[workflows\.workflow\.metadata\]\s*$/m.test(replit) &&
    !/^\s*task\s*=\s*"workflow\.run"\s*$/m.test(replit) &&
    !/^\s*args\s*=\s*"Local Postgres"\s*$/m.test(replit) &&
    !/run-local-postgres\.sh/.test(replit),
  ".replit must not restore the old Project/Local Postgres workflow body; RayAlgo web is the primary Run button target.",
);
check(
  !/^\s*DATABASE_URL\s*=\s*"postgres:\/\/\/dev\?host=\/home\/runner\/workspace\/\.local\/postgres\/run&user=runner"\s*$/m.test(
    replit,
  ),
  ".replit must not force DATABASE_URL to the workspace-local Postgres socket; use Replit's managed PG* env by default.",
);

const apiPackage = JSON.parse(read("artifacts/api-server/package.json"));
const apiDev = apiPackage.scripts?.dev ?? "";
check(
  !apiDev.includes("start-local-postgres.sh") &&
    !apiDev.includes("run-local-postgres.sh") &&
    !apiDev.includes("wait-for-local-postgres.sh"),
  "api-server dev script must not start or require workspace-local Postgres during normal Replit app bring-up.",
);

check(
  !existsSync(
    path.join(repoRoot, "artifacts/api-server/.replit-artifact/artifact.toml"),
  ),
  "api-server must not define a separate Replit artifact; RayAlgo web owns app bring-up.",
);

const rayalgoPackage = JSON.parse(read("artifacts/rayalgo/package.json"));
const rayalgoDev = rayalgoPackage.scripts?.dev ?? "";
const rayalgoDevWeb = rayalgoPackage.scripts?.["dev:web"] ?? "";
check(
  rayalgoDev.includes("node ./scripts/runDevApp.mjs"),
  "RayAlgo dev script must run the web-owned full app supervisor.",
);
check(
  rayalgoDevWeb.includes("vite --config vite.config.ts") &&
    rayalgoDevWeb.includes("reap-dev-port.mjs"),
  "RayAlgo dev:web script must remain the Vite-only dev server with port reaping.",
);

const rayalgoArtifact = read("artifacts/rayalgo/.replit-artifact/artifact.toml");
check(
  /^\s*kind\s*=\s*"web"\s*$/m.test(rayalgoArtifact),
  "RayAlgo artifact must remain kind = \"web\" so Replit treats it as the platform web surface.",
);
check(
  /^\s*previewPath\s*=\s*"\/"\s*$/m.test(rayalgoArtifact),
  "RayAlgo artifact must keep previewPath = \"/\" so the platform loads at the default app route.",
);
check(
  /^\s*title\s*=\s*"RayAlgo Platform"\s*$/m.test(rayalgoArtifact),
  "RayAlgo artifact must keep title = \"RayAlgo Platform\" so the workspace identifies the primary web artifact correctly.",
);
check(
  /^\s*id\s*=\s*"artifacts\/rayalgo"\s*$/m.test(rayalgoArtifact),
  "RayAlgo artifact must keep id = \"artifacts/rayalgo\" so Replit loads it as the platform artifact.",
);
check(
  /^\s*router\s*=\s*"path"\s*$/m.test(rayalgoArtifact),
  "RayAlgo artifact must keep router = \"path\" so it owns the root path without replacing API routing.",
);
check(
  /^\s*run\s*=\s*"pnpm --filter @workspace\/rayalgo run dev"\s*$/m.test(
    rayalgoArtifact,
  ),
  "RayAlgo artifact dev startup must remain pnpm --filter @workspace/rayalgo run dev.",
);
check(
  /^\s*args\s*=\s*\["pnpm",\s*"run",\s*"build:rayalgo-app"\]\s*$/m.test(
    rayalgoArtifact,
  ),
  "RayAlgo production build must use build:rayalgo-app so web, API, and bridge bundle are built together.",
);
check(
  /^\s*args\s*=\s*\["node",\s*"--enable-source-maps",\s*"artifacts\/api-server\/dist\/index\.mjs"\]\s*$/m.test(
    rayalgoArtifact,
  ) &&
    /^\s*PORT\s*=\s*"18747"\s*$/m.test(rayalgoArtifact) &&
    /^\s*RAYALGO_SERVE_WEB\s*=\s*"1"\s*$/m.test(rayalgoArtifact) &&
    /^\s*path\s*=\s*"\/api\/healthz"\s*$/m.test(rayalgoArtifact),
  "RayAlgo production run must start the API server as the single fullstack web service on port 18747.",
);

check(
  rootScripts["build:rayalgo-app"] ===
    "pnpm --filter @workspace/rayalgo run build && pnpm --filter @workspace/api-server run build && pnpm run build:ibkr-bridge-bundle",
  "package.json must keep build:rayalgo-app building web, API, and the IBKR bridge bundle.",
);

const apiApp = read("artifacts/api-server/src/app.ts");
check(
  apiApp.includes('process.env["RAYALGO_SERVE_WEB"] === "1"') &&
    apiApp.includes("express.static") &&
    apiApp.includes("index.html"),
  "API app must serve the built RayAlgo web app when RAYALGO_SERVE_WEB=1.",
);

const reaper = read("scripts/reap-dev-port.mjs");
check(
  reaper.includes('process.env.REPLIT_MODE === "workflow"') &&
    reaper.includes("another Replit execution scope") &&
    reaper.includes("Shell-launched dev commands must not kill"),
  "reap-dev-port.mjs must allow Replit workflow restarts to replace previous Replit execution scopes while preserving shell safety.",
);

check(
  rootScripts["replit:config:lock"] ===
    "node scripts/protect-replit-config.mjs lock" &&
    rootScripts["replit:config:unlock"] ===
      "node scripts/protect-replit-config.mjs unlock" &&
    rootScripts["replit:config:status"] ===
      "node scripts/protect-replit-config.mjs status",
  "package.json must keep the Replit startup config lock/unlock/status scripts.",
);

const configProtector = read("scripts/protect-replit-config.mjs");
for (const relPath of [
  ".replit",
  "replit.nix",
  "artifacts/rayalgo/.replit-artifact/artifact.toml",
]) {
  check(
    configProtector.includes(`"${relPath}"`),
    `protect-replit-config.mjs must protect ${relPath}.`,
  );
}
check(
  configProtector.includes("chmodSync(fullPath, 0o444)") &&
    configProtector.includes("chmodSync(fullPath, 0o644)"),
  "protect-replit-config.mjs must keep lock/unlock chmod behavior.",
);

if (failures.length > 0) {
  console.error("[check-replit-startup-guards] Startup guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-replit-startup-guards] ok");
