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

function rootReplitPortMappings(source) {
  const mappings = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*\[\[ports\]\]\s*$/.test(line)) {
      if (current) mappings.push(current);
      current = {};
      continue;
    }
    if (/^\s*\[/.test(line)) {
      if (current) mappings.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const match = line.match(
      /^\s*(localPort|externalPort|exposeLocalhost)\s*=\s*(.+?)\s*$/,
    );
    if (match) current[match[1]] = match[2];
  }
  if (current) mappings.push(current);
  return mappings.map((mapping) => {
    const normalized = {
      localPort: Number(mapping.localPort),
    };
    if (mapping.externalPort !== undefined) {
      normalized.externalPort = Number(mapping.externalPort);
    }
    if (mapping.exposeLocalhost !== undefined) {
      normalized.exposeLocalhost = mapping.exposeLocalhost === "true";
    }
    return normalized;
  });
}

check(
  /^\s*stack\s*=\s*"PNPM_WORKSPACE"\s*$/m.test(replit),
  ".replit must keep [agent] stack = \"PNPM_WORKSPACE\" so the PYRUS web artifact owns app bring-up.",
);
check(
  JSON.stringify(rootReplitPortMappings(replit)) ===
    JSON.stringify([
      { localPort: 8080, externalPort: 8080 },
      { localPort: 18747, externalPort: 3000 },
    ]),
  ".replit must expose only the active PYRUS runtime ports: 8080 -> 8080 and 18747 -> 3000. Do not restore stale/generated ports such as 8000, 3002, 3007, 18748, or 18749.",
);
check(
  !/^\s*run\s*=/m.test(replit),
  ".replit must not define a root run command; use Replit's default Run Replit App entry.",
);
check(
  /^\s*\[workflows\]\s*$(?:[\s\S]*?)^\s*runButton\s*=\s*"artifacts\/pyrus: web"\s*$/m.test(
    replit,
  ),
  ".replit must keep [workflows] runButton = \"artifacts/pyrus: web\" so the primary Run button targets the single PYRUS app workflow.",
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
    artifactTomls[0] === "artifacts/pyrus/.replit-artifact/artifact.toml",
  `Only the PYRUS web artifact may define a Replit artifact; found ${artifactTomls.join(", ") || "none"}.`,
);

const pyrusPackage = JSON.parse(read("artifacts/pyrus/package.json"));
const pyrusDev = pyrusPackage.scripts?.dev ?? "";
const pyrusDevReplit = pyrusPackage.scripts?.["dev:replit"] ?? "";
const pyrusDevWeb = pyrusPackage.scripts?.["dev:web"] ?? "";
check(
  pyrusPackage.name === "@workspace/pyrus",
  'artifacts/pyrus/package.json must expose the runtime package as "@workspace/pyrus" while keeping the guarded artifact path stable.',
);
check(
  pyrusDev.includes("node ./scripts/runDevApp.mjs"),
  "PYRUS dev script must run the web-owned full app supervisor.",
);
check(
  pyrusDevReplit.includes("PYRUS_REPLIT_RUN=1") &&
    pyrusDevReplit.includes("node ./scripts/runDevApp.mjs"),
  "PYRUS dev:replit script must tag the Replit-owned full app supervisor startup.",
);
check(
  pyrusDevWeb.includes("vite --config vite.config.ts") &&
    pyrusDevWeb.includes("reap-dev-port.mjs"),
  "PYRUS dev:web script must remain the Vite-only dev server with port reaping.",
);

const pyrusArtifact = read("artifacts/pyrus/.replit-artifact/artifact.toml");
check(
  /^\s*kind\s*=\s*"web"\s*$/m.test(pyrusArtifact),
  "PYRUS artifact must remain kind = \"web\" so Replit treats it as the platform web surface.",
);
check(
  /^\s*previewPath\s*=\s*"\/"\s*$/m.test(pyrusArtifact),
  "PYRUS artifact must keep previewPath = \"/\" so the platform loads at the default app route.",
);
check(
  /^\s*title\s*=\s*"PYRUS Platform"\s*$/m.test(pyrusArtifact),
  "PYRUS artifact must keep title = \"PYRUS Platform\" so the workspace identifies the primary web artifact correctly.",
);
check(
  /^\s*id\s*=\s*"artifacts\/pyrus"\s*$/m.test(pyrusArtifact),
  "PYRUS artifact must keep id = \"artifacts/pyrus\" so Replit loads it as the platform artifact.",
);
check(
  /^\s*router\s*=\s*"path"\s*$/m.test(pyrusArtifact),
  "PYRUS artifact must keep router = \"path\" so it owns the root path without replacing API routing.",
);
check(
  /^\s*run\s*=\s*"trap '' HUP; exec pnpm --filter @workspace\/pyrus run dev:replit"\s*$/m.test(
    pyrusArtifact,
  ),
  "PYRUS artifact dev startup must ignore workflow SIGHUP before running pnpm --filter @workspace/pyrus run dev:replit.",
);
check(
  /^\s*args\s*=\s*\["pnpm",\s*"run",\s*"build:pyrus-app"\]\s*$/m.test(
    pyrusArtifact,
  ),
  "PYRUS production build must use build:pyrus-app so web, API, and bridge bundle are built together.",
);
check(
  /^\s*args\s*=\s*\["node",\s*"--enable-source-maps",\s*"artifacts\/api-server\/dist\/index\.mjs"\]\s*$/m.test(
    pyrusArtifact,
  ) &&
    /^\s*PORT\s*=\s*"18747"\s*$/m.test(pyrusArtifact) &&
    /^\s*PYRUS_SERVE_WEB\s*=\s*"1"\s*$/m.test(pyrusArtifact) &&
    /^\s*path\s*=\s*"\/api\/healthz"\s*$/m.test(pyrusArtifact),
  "PYRUS production run must start the API server as the single fullstack web service on port 18747.",
);

check(
  rootScripts["build:pyrus-app"] ===
    "pnpm --filter @workspace/pyrus run build && pnpm --filter @workspace/api-server run build && pnpm run build:ibkr-bridge-bundle",
  "package.json must keep build:pyrus-app building web, API, and the IBKR bridge bundle.",
);

const apiApp = read("artifacts/api-server/src/app.ts");
check(
  apiApp.includes('process.env["PYRUS_SERVE_WEB"] === "1"') &&
    apiApp.includes("express.static") &&
    apiApp.includes("index.html"),
  "API app must serve the built PYRUS web app when PYRUS_SERVE_WEB=1.",
);

const reaper = read("scripts/reap-dev-port.mjs");
check(
  reaper.includes('process.env.REPLIT_MODE === "workflow"') &&
    !reaper.includes('process.env.REPLIT_MODE === "workflow" ||') &&
    reaper.includes("Current PYRUS_REPLIT_RUN") &&
    reaper.includes("another Replit execution scope") &&
    reaper.includes("Shell-launched dev commands must not kill"),
  "reap-dev-port.mjs must allow only true Replit workflow restarts to replace previous Replit execution scopes while preserving shell safety.",
);

const replitDocs = read("replit.md");
check(
  replitDocs.includes("pnpm --filter @workspace/pyrus run dev:replit") &&
    replitDocs.includes("PYRUS_REPLIT_RUN=1") &&
    replitDocs.includes("tag only, not restart authority") &&
    replitDocs.includes("PYRUS_DEV_FORCE_RESTART=1") &&
    replitDocs.includes("PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS") &&
    replitDocs.includes("intentional Run-button restart") &&
    replitDocs.includes("exits without restarting API/Vite") &&
    replitDocs.includes("PYRUS_DEV_DUPLICATE_CHECK_ONLY=1") &&
    replitDocs.includes("REPLIT_MODE=workflow"),
  "replit.md must document the dev:replit artifact runner, Replit-owned restart marker, bounded duplicate-start no-op policy, controlled handoff restart path, and duplicate-check-only smoke-test marker.",
);
const scriptsReadme = read("scripts/README.md");
check(
  scriptsReadme.includes("REPLIT_MODE=workflow") &&
    scriptsReadme.includes("PYRUS_REPLIT_RUN=1") &&
    scriptsReadme.includes("tag only, not restart authority") &&
    scriptsReadme.includes("PYRUS_DEV_FORCE_RESTART=1") &&
    scriptsReadme.includes("PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS") &&
    scriptsReadme.includes("intentional Run-button restart") &&
    scriptsReadme.includes("duplicate Replit-owned Run event exits without restart") &&
    scriptsReadme.includes("PYRUS_DEV_DUPLICATE_CHECK_ONLY=1"),
  "scripts/README.md must document the Replit-owned restart marker, bounded duplicate-start no-op policy, controlled handoff restart path, explicit force-restart marker, and duplicate-check-only smoke-test marker.",
);

const pyrusRunner = read("artifacts/pyrus/scripts/runDevApp.mjs");
check(
  pyrusRunner.includes("apiPortOwnerStatus(apiRootPid)") &&
    pyrusRunner.includes("healthy response came from a previous API process"),
  "runDevApp.mjs must keep API port ownership checks so a stale API health response cannot satisfy a new supervisor.",
);
check(
  pyrusRunner.includes("pyrus-dev-supervisor-${apiPort}.lock") &&
    pyrusRunner.includes("acquireSupervisorLock") &&
    pyrusRunner.includes("skipDuplicateReplitStart") &&
    pyrusRunner.includes("PYRUS_DEV_FORCE_RESTART") &&
    pyrusRunner.includes("PYRUS_DEV_DUPLICATE_CHECK_ONLY") &&
    pyrusRunner.includes("PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS") &&
    pyrusRunner.includes("shouldHandoffDuplicateReplitStart") &&
    pyrusRunner.includes("intentional Run-button restart after") &&
    pyrusRunner.includes("duplicate-check-only found no valid PYRUS dev supervisor lock") &&
    pyrusRunner.includes("exiting without starting API/web processes") &&
    pyrusRunner.includes("supervisor ${ownerPid} is already alive") &&
    pyrusRunner.includes("duplicate Replit workflow start detected") &&
    pyrusRunner.includes("exiting without restart") &&
    pyrusRunner.includes("Set PYRUS_DEV_FORCE_RESTART=1 only for an intentional supervisor takeover") &&
    pyrusRunner.includes("requestSupervisorHandoff") &&
    pyrusRunner.includes("pyrus-dev-lifecycle-${apiPort}.jsonl") &&
    pyrusRunner.includes("writeLifecycleEvent(\"heartbeat\"") &&
    pyrusRunner.includes("readPreviousLifecycleState") &&
    pyrusRunner.includes("supervisor-shutdown-complete") &&
    pyrusRunner.includes('process.env.REPLIT_MODE === "workflow"') &&
    !pyrusRunner.includes('process.env.REPLIT_MODE === "workflow" ||') &&
    pyrusRunner.includes("not authority to") &&
    pyrusRunner.includes("launchedByCodexAgent") &&
    pyrusRunner.includes("refusing to start the full app supervisor from a Codex-owned shell") &&
    pyrusRunner.includes("controlled handoff") &&
    pyrusRunner.includes("overlapping workflow restart cascade") &&
    pyrusRunner.includes("ignoreWorkflowHangup") &&
    pyrusRunner.includes('process.on("SIGHUP", ignoreWorkflowHangup)') &&
    pyrusRunner.includes('process.once("exit", removeSupervisorLock)'),
  "runDevApp.mjs must keep the supervisor single-flight lock, bounded duplicate Replit workflow no-op, controlled Replit handoff, SIGHUP resilience, and explicit forced recovery handoff so duplicate launches cannot overlap or leave the wrong workflow owning API/web processes.",
);

const playwrightConfig = read("artifacts/pyrus/playwright.config.ts");
check(
  playwrightConfig.includes("PYRUS_PLAYWRIGHT_NO_WEB_SERVER") &&
    playwrightConfig.includes("PYRUS_PLAYWRIGHT_ALLOW_WEB_SERVER") &&
    playwrightConfig.includes("runningInReplit") &&
    playwrightConfig.includes("REPLIT_MODE === \"workflow\"") &&
    playwrightConfig.includes("disableWebServer") &&
    playwrightConfig.includes("webServer:"),
  "PYRUS Playwright config must disable its webServer inside Replit unless PYRUS_PLAYWRIGHT_ALLOW_WEB_SERVER=1 is explicitly set.",
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
check(
  rootScripts["replit:scribe:artifacts"] ===
    "pnpm --filter @workspace/scripts run replit:scribe:artifacts",
  "package.json must keep the guarded Scribe artifact audit/cleanup script entry.",
);

const configProtector = read("scripts/protect-replit-config.mjs");
for (const relPath of [
  ".replit",
  "replit.nix",
  "artifacts/pyrus/.replit-artifact/artifact.toml",
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
