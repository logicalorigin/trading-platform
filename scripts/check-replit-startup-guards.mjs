#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectReplitConfigClobber,
  tomlRoot,
  tomlSection,
} from "./replit-config-clobber.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
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
const replitRoot = tomlRoot(replit);
const replitAgent = tomlSection(replit, "agent") ?? "";
const replitWorkflows = tomlSection(replit, "workflows") ?? "";
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
  /^\s*stack\s*=\s*"PNPM_WORKSPACE"\s*$/m.test(replitAgent),
  '.replit must keep [agent] stack = "PNPM_WORKSPACE" so the PYRUS web artifact owns app bring-up.',
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
  !/^\s*run\s*=/m.test(replitRoot),
  ".replit must not define a root run command; use Replit's default Run Replit App entry.",
);
check(
  /^\s*runButton\s*=\s*"artifacts\/pyrus: web"\s*$/m.test(replitWorkflows),
  '.replit must keep [workflows] runButton = "artifacts/pyrus: web" so the primary Run button targets the single PYRUS app workflow.',
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

// Platform "Post-Recovery checkpoint" clobber signature (2026-07-09 lockout):
// deleted replit.nix, stripped the [nix] channel, dropped postgresql-16,
// dropped [workflows] runButton, and injected stale [[ports]] blocks. Fail
// loudly on any of it.
for (const problem of detectReplitConfigClobber(repoRoot)) {
  check(false, `recovery-clobber signature: ${problem}`);
}
const nixPath = path.join(repoRoot, "replit.nix");
check(
  existsSync(nixPath) && statSync(nixPath).size > 0,
  "replit.nix must exist and be non-empty; the recovery clobber deletes it and bricks all shells.",
);
check(
  existsSync(path.join(repoRoot, "scripts/replit-config/dot-replit")) &&
    existsSync(path.join(repoRoot, "scripts/replit-config/replit.nix")) &&
    existsSync(path.join(repoRoot, "scripts/restore-replit-config.mjs")),
  "Canonical Replit config snapshots (scripts/replit-config/) and scripts/restore-replit-config.mjs must stay checked in for one-command recovery.",
);
check(
  existsSync(nixPath) &&
    existsSync(path.join(repoRoot, "scripts/replit-config/dot-replit")) &&
    existsSync(path.join(repoRoot, "scripts/replit-config/replit.nix")) &&
    replit === read("scripts/replit-config/dot-replit") &&
    read("replit.nix") === read("scripts/replit-config/replit.nix"),
  "Live Replit startup config must exactly match scripts/replit-config/ so recovery cannot erase active rollout flags.",
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
const artifactTomls = findFiles(
  path.join(repoRoot, "artifacts"),
  "artifact.toml",
)
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
  /\bunset\b[^;]*\bPYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED\b/.test(
    pyrusDevReplit,
  ) &&
    /\bunset\b[^;]*\bSIGNAL_MONITOR_BAR_EVALUATION_ENABLED\b/.test(
      pyrusDevReplit,
    ) &&
    !pyrusDevReplit.includes(
      "export PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED",
    ) &&
    !pyrusDevReplit.includes("export SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"),
  "PYRUS dev:replit must unset both retired Signal Monitor scan flags before startup.",
);
check(
  pyrusDevWeb.includes("vite --config vite.config.ts") &&
    pyrusDevWeb.includes("reap-dev-port.mjs"),
  "PYRUS dev:web script must remain the Vite-only dev server with port reaping.",
);

const pyrusArtifact = read("artifacts/pyrus/.replit-artifact/artifact.toml");
const artifactRoot = tomlRoot(pyrusArtifact);
const artifactDevelopment =
  tomlSection(pyrusArtifact, "services.development") ?? "";
const artifactProductionBuild =
  tomlSection(pyrusArtifact, "services.production.build") ?? "";
const artifactProductionRun =
  tomlSection(pyrusArtifact, "services.production.run") ?? "";
const artifactProductionRunEnv =
  tomlSection(pyrusArtifact, "services.production.run.env") ?? "";
const artifactProductionHealth =
  tomlSection(pyrusArtifact, "services.production.health.startup") ?? "";
check(
  /^\s*kind\s*=\s*"web"\s*$/m.test(artifactRoot),
  'PYRUS artifact must remain kind = "web" so Replit treats it as the platform web surface.',
);
check(
  /^\s*previewPath\s*=\s*"\/"\s*$/m.test(artifactRoot),
  'PYRUS artifact must keep previewPath = "/" so the platform loads at the default app route.',
);
check(
  /^\s*title\s*=\s*"PYRUS Platform"\s*$/m.test(artifactRoot),
  'PYRUS artifact must keep title = "PYRUS Platform" so the workspace identifies the primary web artifact correctly.',
);
check(
  /^\s*id\s*=\s*"artifacts\/pyrus"\s*$/m.test(artifactRoot),
  'PYRUS artifact must keep id = "artifacts/pyrus" so Replit loads it as the platform artifact.',
);
check(
  /^\s*router\s*=\s*"path"\s*$/m.test(artifactRoot),
  'PYRUS artifact must keep router = "path" so it owns the root path without replacing API routing.',
);
check(
  /^\s*run\s*=\s*"trap '' HUP; exec pnpm --filter @workspace\/pyrus run dev:replit"\s*$/m.test(
    artifactDevelopment,
  ),
  "PYRUS artifact dev startup must ignore workflow SIGHUP before running pnpm --filter @workspace/pyrus run dev:replit.",
);
check(
  /^\s*args\s*=\s*\["pnpm",\s*"run",\s*"build:pyrus-app"\]\s*$/m.test(
    artifactProductionBuild,
  ),
  "PYRUS production build must use build:pyrus-app so web and API are built together.",
);
check(
  /^\s*args\s*=\s*\["node",\s*"--enable-source-maps",\s*"artifacts\/api-server\/dist\/index\.mjs"\]\s*$/m.test(
    artifactProductionRun,
  ) &&
    /^\s*PORT\s*=\s*"18747"\s*$/m.test(artifactProductionRunEnv) &&
    /^\s*PYRUS_SERVE_WEB\s*=\s*"1"\s*$/m.test(artifactProductionRunEnv) &&
    /^\s*path\s*=\s*"\/api\/healthz"\s*$/m.test(artifactProductionHealth),
  "PYRUS production run must start the API server as the single fullstack web service on port 18747.",
);

check(
  rootScripts["build:pyrus-app"] ===
    "pnpm --filter @workspace/pyrus run build && pnpm --filter @workspace/api-server run build",
  "package.json must keep build:pyrus-app building web and API without the retired IBKR bridge bundle.",
);
check(
  rootScripts["typecheck:libs"] ===
    "node scripts/run-validation-command.mjs --label typecheck:libs -- tsc --build",
  "package.json typecheck:libs must run through scripts/run-validation-command.mjs so broad lib builds are serialized and logged without live-supervisor admission guards.",
);
const validationRunner = read("scripts/run-validation-command.mjs");
check(
  validationRunner.includes(".pyrus-runtime") &&
    validationRunner.includes("validation.lock") &&
    validationRunner.includes("commands.jsonl") &&
    validationRunner.includes("validation-lock-held") &&
    !validationRunner.includes("live-pyrus-runtime-hot") &&
    !validationRunner.includes("PYRUS_ENFORCE_HOT_VALIDATION") &&
    !validationRunner.includes("PYRUS_ALLOW_HOT_VALIDATION") &&
    !validationRunner.includes("/tmp/pyrus/pyrus-dev-supervisor-8080.lock"),
  "run-validation-command.mjs must keep the validation ledger and single-validation lock without the retired live-supervisor hot-runtime guard.",
);
check(
  rootScripts["typecheck"]?.includes("pnpm run typecheck:libs") &&
    !rootScripts["typecheck"]?.includes("tsc --build"),
  "package.json typecheck must delegate lib validation through the guarded typecheck:libs script.",
);

const apiApp = read("artifacts/api-server/src/app.ts");
const apiIndex = read("artifacts/api-server/src/index.ts");
check(
  !apiIndex.includes("startSignalMonitorEvaluationWorker") &&
    !apiIndex.includes('from "./services/signal-monitor-evaluation-worker"'),
  "API startup must not register the retired Signal Monitor scan worker.",
);
check(
  apiApp.includes('process.env["PYRUS_SERVE_WEB"] === "1"') &&
    apiApp.includes("express.static") &&
    apiApp.includes("index.html"),
  "API app must serve the built PYRUS web app when PYRUS_SERVE_WEB=1.",
);

const reaper = read("scripts/reap-dev-port.mjs");
const replitProcessAuthority = read("scripts/replit-process-authority.mjs");
check(
  reaper.includes("isPid2OwnedReplitWorkflow") &&
    reaper.includes("proc.hasPyrusWorkflowAncestry(pid)") &&
    reaper.includes("revalidateHolder") &&
    reaper.includes("startTimeTicks") &&
    replitProcessAuthority.includes("cmdlineIsPid2") &&
    replitProcessAuthority.includes("hasPyrusWorkflowAncestry") &&
    replitProcessAuthority.includes("@workspace/pyrus") &&
    replitProcessAuthority.includes("dev:replit") &&
    replitProcessAuthority.includes('parentName === "pid1"') &&
    !replitProcessAuthority.includes("pid === 2"),
  "reap-dev-port.mjs must require pid2 argv0 ancestry and stable process/socket identity before a Replit workflow replaces another execution scope.",
);

const replitDocs = read("replit.md");
check(
  replitDocs.includes("pnpm --filter @workspace/pyrus run dev:replit") &&
    replitDocs.includes("PYRUS_REPLIT_RUN=1") &&
    replitDocs.includes("tag only, not restart authority") &&
    replitDocs.includes("PYRUS_DEV_FORCE_RESTART=1") &&
    replitDocs.includes("intentional Run-button restart immediately") &&
    replitDocs.includes("instead of exiting as a duplicate no-op") &&
    replitDocs.includes("PYRUS_DEV_DUPLICATE_CHECK_ONLY=1") &&
    replitDocs.includes("REPLIT_MODE=workflow") &&
    replitDocs.includes("Sanctioned reload = SIGUSR2") &&
    replitDocs.includes("RETIRED"),
  "replit.md must document the dev:replit artifact runner, Replit-owned restart marker, immediate controlled handoff restart path, duplicate-check-only smoke-test marker, the RETIRED REPLIT_MODE=workflow shell-launch restart, and the sanctioned SIGUSR2 in-place reload.",
);
check(
  replitDocs.includes("set/delete Replit env vars") &&
    replitDocs.includes("create/update/remove Replit artifacts") &&
    replitDocs.includes("env/toolchain") &&
    replitDocs.includes("same-container supervisor") &&
    !replitDocs.includes(
      "use `setEnvVars` / `deleteEnvVars` instead when possible because those persist without a reload",
    ),
  "replit.md must document that host-side Replit env/artifact control-plane actions can rewrite env/toolchain state and bounce the same-container supervisor.",
);
check(
  replitDocs.includes("scripts/run-validation-command.mjs") &&
    replitDocs.includes(".pyrus-runtime/validation/commands.jsonl") &&
    replitDocs.includes("single-validation lock") &&
    replitDocs.includes("does not inspect the live PYRUS supervisor") &&
    replitDocs.includes("targeted package checks"),
  "replit.md must document the root validation ledger, single-validation lock, retired supervisor hot guard, and targeted-check preference.",
);
const scriptsReadme = read("scripts/README.md");
check(
  scriptsReadme.includes("REPLIT_MODE=workflow") &&
    scriptsReadme.includes("PYRUS_REPLIT_RUN=1") &&
    scriptsReadme.includes("tag only, not restart authority") &&
    scriptsReadme.includes("PYRUS_DEV_FORCE_RESTART=1") &&
    scriptsReadme.includes("duplicate Replit-owned Run event is treated") &&
    scriptsReadme.includes("restart immediately") &&
    scriptsReadme.includes("uses a controlled handoff") &&
    scriptsReadme.includes("PYRUS_DEV_DUPLICATE_CHECK_ONLY=1") &&
    scriptsReadme.includes("run-validation-command.mjs") &&
    scriptsReadme.includes("single-validation lock") &&
    scriptsReadme.includes("does not inspect the live PYRUS supervisor") &&
    scriptsReadme.includes(".pyrus-runtime/validation/commands.jsonl"),
  "scripts/README.md must document the Replit-owned restart marker, immediate controlled handoff restart path, explicit force-restart marker, duplicate-check-only smoke-test marker, and unguarded validation ledger.",
);
check(
  scriptsReadme.includes("PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP=1") &&
    scriptsReadme.includes("--confirm-control-plane-cleanup") &&
    scriptsReadme.includes("control-plane maintenance window") &&
    scriptsReadme.includes("artifact/env reconciliation"),
  "scripts/README.md must document the explicit control-plane maintenance opt-in required for Scribe artifact cleanup.",
);

const pyrusRunner = read("artifacts/pyrus/scripts/runDevApp.mjs");
check(
  pyrusRunner.includes("apiPortOwnerStatus(apiRootPid)") &&
    pyrusRunner.includes("healthy response came from a previous API process"),
  "runDevApp.mjs must keep API port ownership checks so a stale API health response cannot satisfy a new supervisor.",
);
check(
  pyrusRunner.includes("market-data-worker:run") &&
    pyrusRunner.includes("resolveMarketDataWorkerStartup") &&
    pyrusRunner.includes("worker-started") &&
    pyrusRunner.includes("worker-skipped") &&
    pyrusRunner.includes("MASSIVE_MARKET_DATA_API_KEY") &&
    pyrusRunner.includes("LOCAL_DATABASE_URL") &&
    pyrusRunner.includes("workerPid") &&
    pyrusRunner.includes('watchFatalExit("market-data worker", workerExit)'),
  "runDevApp.mjs must start the market-data worker when database and Massive provider config are present, skip it explicitly when config is missing, and treat a started worker exit as supervisor-fatal (a non-reloadable watchFatalExit watcher).",
);
check(
  pyrusRunner.includes("pyrus-dev-supervisor-${apiPort}.lock") &&
    pyrusRunner.includes("acquireSupervisorLock") &&
    !pyrusRunner.includes("skipDuplicateReplitStart") &&
    pyrusRunner.includes("PYRUS_DEV_FORCE_RESTART") &&
    pyrusRunner.includes("PYRUS_DEV_DUPLICATE_CHECK_ONLY") &&
    !pyrusRunner.includes("PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS") &&
    !pyrusRunner.includes("shouldHandoffDuplicateReplitStart") &&
    pyrusRunner.includes(
      "intentional Run-button restart and requesting controlled handoff",
    ) &&
    pyrusRunner.includes(
      "duplicate-check-only found no valid PYRUS dev supervisor lock",
    ) &&
    pyrusRunner.includes("exiting without starting API/web processes") &&
    pyrusRunner.includes(
      "a real Replit workflow start would request controlled handoff",
    ) &&
    pyrusRunner.includes("supervisor ${ownerPid} already alive") &&
    !pyrusRunner.includes("duplicate Replit workflow start detected") &&
    !pyrusRunner.includes("exiting without restart") &&
    pyrusRunner.includes("requestSupervisorHandoff") &&
    pyrusRunner.includes("pyrus-dev-lifecycle-${apiPort}.jsonl") &&
    pyrusRunner.includes('writeLifecycleEvent("heartbeat"') &&
    pyrusRunner.includes("readPreviousLifecycleState") &&
    pyrusRunner.includes("supervisor-shutdown-complete") &&
    pyrusRunner.includes("isPid2OwnedReplitWorkflow") &&
    pyrusRunner.includes("signalStableProcess") &&
    pyrusRunner.includes("processIdentityMatches") &&
    pyrusRunner.includes("startTimeTicks") &&
    pyrusRunner.includes("shell-forgeable tags") &&
    !pyrusRunner.includes(
      "refusing to start the full app supervisor from a Codex-owned shell",
    ) &&
    pyrusRunner.includes("controlled handoff") &&
    pyrusRunner.includes("overlapping workflow restart cascade") &&
    pyrusRunner.includes("ignoreWorkflowHangup") &&
    pyrusRunner.includes('process.on("SIGHUP", ignoreWorkflowHangup)') &&
    pyrusRunner.includes('process.once("exit", removeSupervisorLock)'),
  "runDevApp.mjs must keep the supervisor single-flight lock, immediate controlled Replit handoff, SIGHUP resilience, and explicit forced recovery handoff so duplicate launches cannot overlap or leave the wrong workflow owning API/web processes.",
);

check(
  rootScripts["replit:config:lock"] ===
    "node scripts/protect-replit-config.mjs lock" &&
    rootScripts["replit:config:unlock"] ===
      "node scripts/protect-replit-config.mjs unlock" &&
    rootScripts["replit:config:status"] ===
      "node scripts/protect-replit-config.mjs status" &&
    rootScripts["replit:config:restore"] ===
      "node scripts/restore-replit-config.mjs",
  "package.json must keep the Replit startup config lock/unlock/status/restore scripts.",
);
check(
  rootScripts["replit:scribe:artifacts"] ===
    "pnpm --filter @workspace/scripts run replit:scribe:artifacts",
  "package.json must keep the guarded Scribe artifact audit/cleanup script entry.",
);

const agentsDoc = read("AGENTS.md");
check(
  agentsDoc.includes("set/delete Replit environment variables") &&
    agentsDoc.includes("create/update/remove Replit artifacts") &&
    agentsDoc.includes("control-plane actions") &&
    agentsDoc.includes("explicit startup maintenance window"),
  "AGENTS.md must forbid Replit env/artifact control-plane actions during routine work and require an explicit startup maintenance window.",
);

const replitScribeArtifacts = read("scripts/src/replit-scribe-artifacts.ts");
check(
  replitScribeArtifacts.includes("PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP") &&
    replitScribeArtifacts.includes("--confirm-control-plane-cleanup") &&
    replitScribeArtifacts.includes(
      "may trigger Replit artifact/env reconciliation",
    ),
  "replit-scribe-artifacts.ts must require explicit control-plane maintenance opt-in before backup-and-clean cleanup.",
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
