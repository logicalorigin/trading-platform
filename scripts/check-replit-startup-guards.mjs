#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function findFiles(dirPath, fileName, results = []) {
  if (!existsSync(dirPath)) return results;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      findFiles(entryPath, fileName, results);
    } else if (entry.isFile() && entry.name === fileName) {
      results.push(path.relative(repoRoot, entryPath));
    }
  }
  return results;
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

const replit = read(".replit");
const rootPackage = JSON.parse(read("package.json"));
const rootScripts = rootPackage.scripts ?? {};

check(
  /^\s*stack\s*=\s*"PNPM_WORKSPACE"\s*$/m.test(replit),
  ".replit must keep [agent] stack = \"PNPM_WORKSPACE\" so the PYRUS web artifact owns app bring-up.",
);
check(
  !/^\s*run\s*=/m.test(replit),
  ".replit must not define a root run command; use Replit's default Run Replit App entry.",
);
check(
  /^\s*\[workflows\]\s*$(?:[\s\S]*?)^\s*runButton\s*=\s*"artifacts\/rayalgo: web"\s*$/m.test(
    replit,
  ),
  ".replit must keep [workflows] runButton = \"artifacts/rayalgo: web\" so the primary Run button targets the single PYRUS app workflow.",
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
  ".replit must not restore the old Project/Local Postgres workflow body; PYRUS web is the primary Run button target.",
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
  "api-server must not define a separate Replit artifact; PYRUS web owns app bring-up.",
);
const artifactTomls = findFiles(path.join(repoRoot, "artifacts"), "artifact.toml")
  .filter((relPath) => relPath.includes("/.replit-artifact/"))
  .sort();
check(
  artifactTomls.length === 1 &&
    artifactTomls[0] === "artifacts/rayalgo/.replit-artifact/artifact.toml",
  `Only the PYRUS web artifact may define a Replit artifact; found ${artifactTomls.join(", ") || "none"}.`,
);

const rayalgoPackage = JSON.parse(read("artifacts/rayalgo/package.json"));
const rayalgoDev = rayalgoPackage.scripts?.dev ?? "";
const rayalgoDevReplit = rayalgoPackage.scripts?.["dev:replit"] ?? "";
const rayalgoDevWeb = rayalgoPackage.scripts?.["dev:web"] ?? "";
check(
  rayalgoPackage.name === "@workspace/pyrus",
  'artifacts/rayalgo/package.json must expose the runtime package as "@workspace/pyrus" while keeping the guarded artifact path stable.',
);
check(
  rayalgoDev.includes("node ./scripts/runDevApp.mjs"),
  "PYRUS dev script must run the web-owned full app supervisor.",
);
check(
  rayalgoDevReplit.includes("PYRUS_REPLIT_RUN=1") &&
    rayalgoDevReplit.includes("RAYALGO_REPLIT_RUN=1") &&
    rayalgoDevReplit.includes("node ./scripts/runDevApp.mjs"),
  "PYRUS dev:replit script must tag the Replit-owned full app supervisor startup.",
);
check(
  rayalgoDevWeb.includes("vite --config vite.config.ts") &&
    rayalgoDevWeb.includes("reap-dev-port.mjs"),
  "PYRUS dev:web script must remain the Vite-only dev server with port reaping.",
);

const rayalgoArtifact = read("artifacts/rayalgo/.replit-artifact/artifact.toml");
check(
  /^\s*kind\s*=\s*"web"\s*$/m.test(rayalgoArtifact),
  "PYRUS artifact must remain kind = \"web\" so Replit treats it as the platform web surface.",
);
check(
  /^\s*previewPath\s*=\s*"\/"\s*$/m.test(rayalgoArtifact),
  "PYRUS artifact must keep previewPath = \"/\" so the platform loads at the default app route.",
);
check(
  /^\s*title\s*=\s*"PYRUS Platform"\s*$/m.test(rayalgoArtifact),
  "PYRUS artifact must keep title = \"PYRUS Platform\" so the workspace identifies the primary web artifact correctly.",
);
check(
  /^\s*id\s*=\s*"artifacts\/rayalgo"\s*$/m.test(rayalgoArtifact),
  "PYRUS artifact must keep id = \"artifacts/rayalgo\" so Replit loads it as the platform artifact.",
);
check(
  /^\s*router\s*=\s*"path"\s*$/m.test(rayalgoArtifact),
  "PYRUS artifact must keep router = \"path\" so it owns the root path without replacing API routing.",
);
check(
  /^\s*run\s*=\s*"pnpm --filter @workspace\/pyrus run dev:replit"\s*$/m.test(
    rayalgoArtifact,
  ),
  "PYRUS artifact dev startup must run pnpm --filter @workspace/pyrus run dev:replit.",
);
check(
  /^\s*args\s*=\s*\["pnpm",\s*"run",\s*"build:pyrus-app"\]\s*$/m.test(
    rayalgoArtifact,
  ),
  "PYRUS production build must use build:pyrus-app so web, API, and bridge bundle are built together.",
);
check(
  /^\s*args\s*=\s*\["node",\s*"--enable-source-maps",\s*"artifacts\/api-server\/dist\/index\.mjs"\]\s*$/m.test(
    rayalgoArtifact,
  ) &&
    /^\s*PORT\s*=\s*"18747"\s*$/m.test(rayalgoArtifact) &&
    /^\s*PYRUS_SERVE_WEB\s*=\s*"1"\s*$/m.test(rayalgoArtifact) &&
    /^\s*RAYALGO_SERVE_WEB\s*=\s*"1"\s*$/m.test(rayalgoArtifact) &&
    /^\s*path\s*=\s*"\/api\/healthz"\s*$/m.test(rayalgoArtifact),
  "PYRUS production run must start the API server as the single fullstack web service on port 18747.",
);

check(
  rootScripts["build:pyrus-app"] ===
    "pnpm --filter @workspace/pyrus run build && pnpm --filter @workspace/api-server run build && pnpm run build:ibkr-bridge-bundle" &&
    rootScripts["build:rayalgo-app"] === "pnpm run build:pyrus-app",
  "package.json must keep build:pyrus-app building web, API, and the IBKR bridge bundle with a legacy build:rayalgo-app alias.",
);

const apiApp = read("artifacts/api-server/src/app.ts");
check(
  apiApp.includes('process.env["PYRUS_SERVE_WEB"] === "1"') &&
    apiApp.includes('process.env["RAYALGO_SERVE_WEB"] === "1"') &&
    apiApp.includes("express.static") &&
    apiApp.includes("index.html"),
  "API app must serve the built PYRUS web app when PYRUS_SERVE_WEB=1, with the legacy RAYALGO_SERVE_WEB alias preserved.",
);

const reaper = read("scripts/reap-dev-port.mjs");
check(
  reaper.includes('process.env.REPLIT_MODE === "workflow"') &&
    reaper.includes('process.env.PYRUS_REPLIT_RUN === "1"') &&
    reaper.includes('process.env.RAYALGO_REPLIT_RUN === "1"') &&
    reaper.includes("another Replit execution scope") &&
    reaper.includes("Shell-launched dev commands must not kill"),
  "reap-dev-port.mjs must allow Replit workflow/artifact restarts to replace previous Replit execution scopes while preserving shell safety.",
);

const replitDocs = read("replit.md");
check(
  replitDocs.includes("pnpm --filter @workspace/pyrus run dev:replit") &&
    replitDocs.includes("PYRUS_REPLIT_RUN=1") &&
    replitDocs.includes("RAYALGO_REPLIT_RUN=1") &&
    replitDocs.includes("REPLIT_MODE=workflow"),
  "replit.md must document the dev:replit artifact runner and both Replit-owned restart markers.",
);
const scriptsReadme = read("scripts/README.md");
check(
  scriptsReadme.includes("REPLIT_MODE=workflow") &&
    scriptsReadme.includes("PYRUS_REPLIT_RUN=1") &&
    scriptsReadme.includes("RAYALGO_REPLIT_RUN=1"),
  "scripts/README.md must document both Replit-owned restart markers for reap-dev-port.mjs.",
);

const rayalgoRunner = read("artifacts/rayalgo/scripts/runDevApp.mjs");
check(
  rayalgoRunner.includes("apiPortOwnerStatus(apiRootPid)") &&
    rayalgoRunner.includes("healthy response came from a previous API process"),
  "runDevApp.mjs must keep API port ownership checks so a stale API health response cannot satisfy a new supervisor.",
);
check(
  rayalgoRunner.includes("rayalgo-dev-supervisor-${apiPort}.lock") &&
    rayalgoRunner.includes("acquireSupervisorLock") &&
    rayalgoRunner.includes("requestSupervisorHandoff") &&
    rayalgoRunner.includes('process.env.REPLIT_MODE === "workflow"') &&
    rayalgoRunner.includes('process.env.PYRUS_REPLIT_RUN === "1"') &&
    rayalgoRunner.includes('process.env.RAYALGO_REPLIT_RUN === "1"') &&
    rayalgoRunner.includes("launchedByCodexAgent") &&
    rayalgoRunner.includes("refusing to start the full app supervisor from a Codex-owned shell") &&
    rayalgoRunner.includes("controlled handoff") &&
    rayalgoRunner.includes("overlapping workflow restart cascade") &&
    rayalgoRunner.includes('process.once("exit", removeSupervisorLock)'),
  "runDevApp.mjs must keep the supervisor single-flight lock and controlled Replit workflow handoff so duplicate launches cannot overlap API/web processes.",
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
