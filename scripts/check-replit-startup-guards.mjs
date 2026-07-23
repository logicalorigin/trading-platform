#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tomlRoot,
  tomlSection,
  validatePyrusArtifactConfig,
  validateReplitStartupConfig,
} from "./replit-config-clobber.mjs";
import { auditPublishContext } from "./publish-context-policy.mjs";

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

const publishContextAudit = auditPublishContext({
  root: repoRoot,
  ignoreText: read(".replitignore"),
});
for (const failure of publishContextAudit.failures) {
  check(false, failure);
}
console.log(
  `[check-replit-startup-guards] publish context estimate: ${publishContextAudit.archiveEstimateBytes} bytes (${publishContextAudit.includedBytes} logical bytes across ${publishContextAudit.includedFiles} files)`,
);

const replit = read(".replit");
const rootPackage = JSON.parse(read("package.json"));
const rootScripts = rootPackage.scripts ?? {};
const nixPath = path.join(repoRoot, "replit.nix");
const replitNix = existsSync(nixPath) ? read("replit.nix") : null;
for (const problem of validateReplitStartupConfig({
  replit,
  nix: replitNix,
})) {
  check(false, `startup config: ${problem}`);
}
check(
  existsSync(path.join(repoRoot, "scripts/replit-config/dot-replit")) &&
    existsSync(path.join(repoRoot, "scripts/replit-config/replit.nix")) &&
    existsSync(
      path.join(repoRoot, "scripts/replit-config/pyrus-artifact.toml"),
    ) &&
    existsSync(path.join(repoRoot, "scripts/restore-replit-config.mjs")),
  "Canonical Replit config snapshots (scripts/replit-config/) and scripts/restore-replit-config.mjs must stay checked in for one-command recovery.",
);
check(
  existsSync(nixPath) &&
    existsSync(path.join(repoRoot, "scripts/replit-config/dot-replit")) &&
    existsSync(path.join(repoRoot, "scripts/replit-config/replit.nix")) &&
    existsSync(
      path.join(repoRoot, "scripts/replit-config/pyrus-artifact.toml"),
    ) &&
    replit === read("scripts/replit-config/dot-replit") &&
    read("replit.nix") === read("scripts/replit-config/replit.nix") &&
    read("artifacts/pyrus/.replit-artifact/artifact.toml") ===
      read("scripts/replit-config/pyrus-artifact.toml"),
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
  pyrusDevReplit.includes("node ./scripts/runDevApp.mjs") &&
    !pyrusDevReplit.includes("PYRUS_REPLIT_RUN") &&
    !pyrusDevReplit.includes("REPLIT_MODE=workflow"),
  "PYRUS dev:replit must run the artifact-owned app launcher without shell-forgeable lifecycle tags.",
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
    pyrusDevWeb.includes("--host 0.0.0.0") &&
    !pyrusDevWeb.includes("runDevApp.mjs") &&
    !pyrusDevWeb.includes("reap-dev-port.mjs"),
  "PYRUS dev:web must remain the Vite-only child; the artifact-owned launcher owns startup port cleanup.",
);

const pyrusArtifact = read("artifacts/pyrus/.replit-artifact/artifact.toml");
for (const problem of validatePyrusArtifactConfig(pyrusArtifact)) {
  check(false, `PYRUS artifact config: ${problem}`);
}
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
  /^\s*run\s*=\s*"(?:trap '' HUP; )?exec pnpm --filter @workspace\/pyrus run dev:replit"\s*$/m.test(
    artifactDevelopment,
  ),
  "PYRUS artifact dev startup must directly exec pnpm --filter @workspace/pyrus run dev:replit; SIGHUP behavior is not a permanent invariant without a Replit signal contract.",
);
check(
  /^\s*args\s*=\s*\["pnpm",\s*"run",\s*"build:pyrus-app"\]\s*$/m.test(
    artifactProductionBuild,
  ),
  "PYRUS production build must use build:pyrus-app so web, API, and session host are built together.",
);
check(
  /^\s*args\s*=\s*\["node",\s*"--enable-source-maps",\s*"artifacts\/pyrus\/scripts\/runProductionApp\.mjs"\]\s*$/m.test(
    artifactProductionRun,
  ) &&
    /^\s*PORT\s*=\s*"18747"\s*$/m.test(artifactProductionRunEnv) &&
    /^\s*PYRUS_SERVE_WEB\s*=\s*"1"\s*$/m.test(artifactProductionRunEnv) &&
    /^\s*path\s*=\s*"\/api\/healthz"\s*$/m.test(artifactProductionHealth),
  "PYRUS production run must start the guarded fullstack supervisor as the single external web service on port 18747.",
);

check(
  rootScripts["build:pyrus-app"] ===
    "pnpm run audit:guards && pnpm --filter @workspace/pyrus run build && pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/ibkr-session-host run build",
  "package.json must keep build:pyrus-app fail-closed on audit:guards before building web, API, and the co-located IBKR session host without the retired desktop bridge bundle.",
);

const apiRuntime = read("artifacts/api-server/src/lib/runtime.ts");
const headerStatusCluster = read(
  "artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx",
);
const clientPortalPresentation = [
  read("artifacts/pyrus/src/features/platform/clientPortalRuntimeModel.js"),
  read("artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx"),
  read("artifacts/pyrus/src/features/platform/PlatformApp.jsx"),
  read("artifacts/pyrus/src/screens/DiagnosticsScreen.jsx"),
  read("artifacts/pyrus/src/screens/AlgoScreen.jsx"),
].join("\n");
const apiPlatform = read("artifacts/api-server/src/services/platform.ts");
const apiDiagnostics = read("artifacts/api-server/src/services/diagnostics.ts");
const accountService = read("artifacts/api-server/src/services/account.ts");
const tradingSchema = read("lib/db/src/schema/trading.ts");
const flexRawXmlPurgeMigration = read(
  "lib/db/migrations/20260720_purge_flex_report_raw_xml.sql",
);
const safePentestTarget = read("security/pentest/src/safe-target.mjs");
const safePentestStart = safePentestTarget.slice(
  safePentestTarget.indexOf("export async function startHarness"),
  safePentestTarget.indexOf("\nconst isMain"),
);
const apiSpec = read("lib/api-spec/openapi.yaml");
const retiredBridgeConfigText = [
  apiRuntime,
  read(".env.example"),
  read(".gitignore"),
].join("\n");
const retiredBridgeLauncherFiles = [
  "artifacts/api-server/src/lib/runtime-bridge-override-intent.test.ts",
  "artifacts/api-server/src/services/ibkr-connection-audit.ts",
  "artifacts/api-server/src/services/ibkr-connection-audit.test.ts",
  "artifacts/pyrus/src/features/platform/bridgeRuntimeModel.js",
  "artifacts/pyrus/src/features/platform/ibkrBridgeLaunchFeedback.js",
  "artifacts/pyrus/src/features/platform/ibkrBridgeSession.js",
  "artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.js",
  "artifacts/pyrus/src/features/platform/ibkrConnectionInsightModel.js",
  "artifacts/pyrus/src/features/platform/ibkrConnectionOperationStepperModel.js",
  "artifacts/pyrus/src/features/platform/ibkrConnectionSnapshot.js",
  "artifacts/pyrus/src/features/platform/ibkrLoginHandoffErrorModel.js",
  "artifacts/pyrus/src/features/platform/ibkrPopoverModel.js",
];
check(
  !/IbkrBridgeRuntimeOverride|IBKR_BRIDGE_(?:URL|BASE_URL|RUNTIME_OVERRIDE_FILE)|PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE|ibkr-bridge-runtime-override\.json/.test(
    retiredBridgeConfigText,
  ) &&
    !/IBKR_(?:CLIENT_PORTAL_)?(?:USERNAME|PASSWORD)/.test(apiRuntime),
  "The decommissioned IBKR desktop bridge runtime override and credential-handoff environment inputs must stay removed.",
);
check(
  retiredBridgeLauncherFiles.every(
    (relPath) => !existsSync(path.join(repoRoot, relPath)),
  ) &&
    !/IBKR_BRIDGE_|desktopAgent|managementToken|encryptIbkrLoginEnvelope|ibkrBridgeSession/.test(
      headerStatusCluster,
    ) &&
    !/ibkrBridge|bridgeRuntimeModel|Legacy Broker Runtime|Bridge URL|Bridge token/i.test(
      clientPortalPresentation,
    ),
  "The browser bundle must not restore the retired IBKR desktop bridge launcher or its credential-handoff modules.",
);
check(
  !/desktopAgent|desktop bridge/i.test(`${apiPlatform}\n${apiDiagnostics}`) &&
    !/IbkrBridge|IbkrRemoteDesktop|desktopAgent|runtimeOverride|credentialHandoff|managementToken/.test(
      apiSpec,
    ) &&
    !/^\s+ibkrBridge:/m.test(apiSpec),
  "API runtime diagnostics and the published contract must not restore the retired IBKR desktop-helper lifecycle.",
);
check(
  apiRuntime.includes("IBKR_CLIENT_PORTAL_BASE_URL") &&
    read("artifacts/api-server/src/services/ibkr-client-runtime.ts").includes(
      "getIbkrClientPortalGatewaySnapshot",
    ) &&
    read("artifacts/api-server/src/routes/ibkr-portal.ts").includes(
      "/api/broker-execution/ibkr-portal/gateway",
    ) &&
    /enum: \[client_portal\]/.test(apiSpec) &&
    apiSpec.includes(
      "enum: [/api/broker-execution/ibkr-portal/readiness]",
    ),
  "IBKR connectivity must retain the per-user Client Portal gateway as the supported runtime path.",
);
check(
  !/rawXml:\s*text\("raw_xml"\)/.test(tradingSchema) &&
    !/\brawXml:\s*(?:reference\.rawXml|xml)\b/.test(accountService) &&
    /UPDATE\s+flex_report_runs\s+SET\s+raw_xml\s*=\s*NULL/is.test(
      flexRawXmlPurgeMigration,
    ) &&
    /ALTER\s+TABLE\s+flex_report_runs\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+raw_xml/is.test(
      flexRawXmlPurgeMigration,
    ),
  "IBKR Flex XML must remain transient: persist only normalized records and bounded run metadata, and keep the existing-payload purge migration.",
);
const pentestRefusal = safePentestStart.indexOf(
  'throw new Error("safe_pentest_target_disabled")',
);
check(
  pentestRefusal >= 0 &&
    pentestRefusal < safePentestStart.indexOf("assertSyntheticEnvironment") &&
    pentestRefusal < safePentestStart.indexOf("installOutboundTripwire"),
  "The dynamic pentest harness must remain disabled inside startHarness before environment, database, network, or listener side effects.",
);
check(
  rootScripts["audit:guards"]?.includes("audit:replit-startup") &&
    rootScripts["typecheck"]?.includes("audit:replit-startup"),
  "package.json must keep the Replit startup guard in both the release guard chain and root typecheck.",
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
    replitProcessAuthority.includes("parentName") &&
    replitProcessAuthority.includes('"pid1"') &&
    !replitProcessAuthority.includes("pid === 2"),
  "reap-dev-port.mjs must require pid2 argv0 ancestry and stable process/socket identity before a Replit workflow replaces another execution scope.",
);

const replitDocs = read("replit.md");
check(
  replitDocs.includes("artifacts/pyrus/.replit-artifact/artifact.toml") &&
    replitDocs.includes("native restart-run-workflow") &&
    replitDocs.includes("workspace Run/Stop controls") &&
    replitDocs.includes("never") &&
    replitDocs.includes("signal the launcher or pid2") &&
    replitDocs.includes("shell-launch a competing app copy") &&
    !replitDocs.includes(
      "pnpm --filter @workspace/api-server run dev` — run API server",
    ) &&
    !replitDocs.includes(
      "pnpm --filter @workspace/pyrus run dev` — run the PYRUS web app",
    ) &&
    replitDocs.includes("scripts/replit-config/") &&
    replitDocs.includes("replit:config:restore"),
  "replit.md must document Replit-owned lifecycle controls and the non-launching startup-config recovery path.",
);
check(
  replitDocs.includes("runProductionApp.mjs") &&
    replitDocs.includes("one web service/port") &&
    replitDocs.includes("Reserved VM") &&
    replitDocs.includes("Publishing tool") &&
    replitDocs.includes("Docker daemon/capabilities"),
  "replit.md must document the single-port production supervisor, Publishing-tool Reserved VM requirement, and unproven production Docker preflight.",
);
const scriptsReadme = read("scripts/README.md");
check(
  scriptsReadme.includes("check-replit-startup-guards.mjs") &&
    scriptsReadme.includes("protect-replit-config.mjs") &&
    scriptsReadme.includes("restore-replit-config.mjs") &&
    scriptsReadme.includes("explicit") &&
    scriptsReadme.includes("--write") &&
    scriptsReadme.includes("run-validation-command.mjs") &&
    scriptsReadme.includes("single-validation lock") &&
    scriptsReadme.includes("does not inspect the live PYRUS supervisor") &&
    scriptsReadme.includes(".pyrus-runtime/validation/commands.jsonl") &&
    scriptsReadme.includes("coverageStartedAt") &&
    /evidence\s+is\s+incomplete/.test(scriptsReadme) &&
    /host trigger\s+remains unknown/.test(scriptsReadme),
  "scripts/README.md must document startup recovery controls and the serialized validation ledger.",
);
check(
  scriptsReadme.includes("PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP=1") &&
    scriptsReadme.includes("--confirm-control-plane-cleanup") &&
    scriptsReadme.includes("control-plane maintenance window") &&
    scriptsReadme.includes("artifact/env reconciliation"),
  "scripts/README.md must document the explicit control-plane maintenance opt-in required for Scribe artifact cleanup.",
);
check(
  scriptsReadme.includes("runProductionApp.mjs") &&
    scriptsReadme.includes("one-port production") &&
    scriptsReadme.includes("signed lifecycle configuration") &&
    scriptsReadme.includes("either child exit as fatal"),
  "scripts/README.md must document production supervisor ownership and its fail-closed host boundary.",
);

const pyrusRunner = read("artifacts/pyrus/scripts/runDevApp.mjs");
const pyrusFlightRecorder = read(
  "artifacts/pyrus/scripts/flightRecorder.mjs",
);
const pyrusProductionRunner = read(
  "artifacts/pyrus/scripts/runProductionApp.mjs",
);
check(
  pyrusProductionRunner.includes("resolveProductionServices") &&
    pyrusProductionRunner.includes("IBKR_SESSION_HOST_ENABLED") &&
    pyrusProductionRunner.includes("IBKR_GATEWAY_FLEET_ENABLED") &&
    pyrusProductionRunner.includes("REQUIRED_SIGNED_HOST_ENV") &&
    pyrusProductionRunner.includes("HOST_RUNTIME_ENV") &&
    pyrusProductionRunner.includes("productionHostControlKeys") &&
    pyrusProductionRunner.includes("createHmac") &&
    pyrusProductionRunner.includes(
      "PYRUS-IBKR-HOST-CONTROL-KEY-V1",
    ) &&
    !pyrusProductionRunner.includes('name.startsWith("IBKR_SESSION_")') &&
    pyrusProductionRunner.includes(
      'DOCKER_HOST: "unix:///var/run/docker.sock"',
    ) &&
    pyrusProductionRunner.includes("spawn(process.execPath") &&
    pyrusProductionRunner.includes('child.kill("SIGTERM")') &&
    pyrusProductionRunner.includes('child.kill("SIGKILL")'),
  "runProductionApp.mjs must own the single-port API/session-host process tree, derive host-bound keys, minimize host env authority, and bound child shutdown.",
);
const apiBuild = read("artifacts/api-server/build.mjs");
check(
  apiBuild.includes('"ibkr-gateway-host-admin"') &&
    apiBuild.includes('"src/scripts/ibkr-gateway-host-admin.ts"'),
  "The API production build must include the non-network IBKR fleet host operator CLI.",
);
check(
  pyrusRunner.includes('from "./flightRecorder.mjs"') &&
    pyrusRunner.includes("createBootBoundaryRecorder") &&
    pyrusRunner.includes("resolveFlightRecorderDir") &&
    pyrusRunner.includes("recorderHeartbeat") &&
    pyrusRunner.indexOf("bootBoundaryRecorder.record()") >
      pyrusRunner.indexOf("async function main()") &&
    pyrusRunner.indexOf("bootBoundaryRecorder.record()") <
      pyrusRunner.indexOf("assertAuditedPackage(ROLE_SPECS.api)") &&
    pyrusFlightRecorder.includes('match(/^btime\\s+(\\d+)$/mu)') &&
    pyrusFlightRecorder.includes('"boot-markers"') &&
    pyrusFlightRecorder.includes("coverageStartedAt") &&
    pyrusFlightRecorder.includes("schemaVersion: 2") &&
    pyrusFlightRecorder.includes("fsyncDirectory") &&
    pyrusFlightRecorder.includes('"container-replaced"') &&
    pyrusFlightRecorder.includes('hostTrigger: "unknown"'),
  "runDevApp.mjs must durably and continuously classify guest boot changes before package checks or child startup, without inventing the host trigger.",
);
check(
  pyrusRunner.includes("procInspector.portOwnerStatus") &&
    pyrusRunner.includes("healthy response came from a previous API process"),
  "runDevApp.mjs must keep API port ownership checks so a stale API health response cannot satisfy a new supervisor.",
);
check(
  pyrusRunner.includes("market-data-worker:run") &&
    pyrusRunner.includes("workerConfigured") &&
    pyrusRunner.includes("market-data worker skipped") &&
    pyrusRunner.includes("MASSIVE_MARKET_DATA_API_KEY") &&
    pyrusRunner.includes("LOCAL_DATABASE_URL") &&
    pyrusRunner.includes('"market-data worker"') &&
    pyrusRunner.includes("firstFailure"),
  "runDevApp.mjs must start the market-data worker only when database and Massive provider config are present, report skips, and treat every started child exit as fatal.",
);
check(
  pyrusRunner.includes("reapStaleListeners") &&
    pyrusRunner.includes("detached: true") &&
    pyrusRunner.includes("readProcessGroupIdentity") &&
    pyrusRunner.includes("signalOwnedGroup") &&
    pyrusRunner.includes("process.kill(-entry.groupIdentity.pid, signal)") &&
    pyrusRunner.includes("waitForOwnedGroupToClear") &&
    pyrusRunner.includes("cleanOwnedGroup") &&
    pyrusRunner.includes('"SIGTERM"') &&
    pyrusRunner.includes('"SIGKILL"') &&
    pyrusRunner.includes("IBKR_SESSION_HOST_ENABLED") &&
    pyrusRunner.includes('"IBKR session host"') &&
    pyrusRunner.includes('process.on("SIGTERM"') &&
    !pyrusRunner.includes("requestSupervisorHandoff") &&
    !pyrusRunner.includes("signalStableProcess"),
  "runDevApp.mjs must own and bound its child process groups, optionally include the IBKR host, and leave outer launcher/workflow replacement to Replit.",
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
  agentsDoc.includes("Replit owns the outer dev-app lifecycle") &&
    agentsDoc.includes("restart-run-workflow") &&
    agentsDoc.includes("Run/Stop controls") &&
    agentsDoc.includes("Never signal the launcher or pid2") &&
    agentsDoc.includes("never shell-launch") &&
    agentsDoc.includes("second app copy"),
  "AGENTS.md must reserve the outer lifecycle for Replit and forbid agents from signaling or shell-launching the app.",
);
const claudeDoc = read("CLAUDE.md");
check(
  claudeDoc.includes("current headroom and observed pressure") &&
    !claudeDoc.includes("require at least 6 GiB"),
  "CLAUDE.md must use the adaptive shared-memory rule instead of stale fixed thresholds.",
);
const activeTaskBoardPath = path.join(repoRoot, "AGENT_TASK_BOARD.md");
if (existsSync(activeTaskBoardPath)) {
  const activeTaskBoard = read("AGENT_TASK_BOARD.md");
  check(
    activeTaskBoard.includes(
      "historical rows preserve results, not executable restart",
    ) &&
      !activeTaskBoard.includes("same-PID `SIGUSR2` reload") &&
      !activeTaskBoard.includes("Reuse the same sanctioned procedure"),
    "The local task board must subordinate historical reload notes to the current Replit-owned lifecycle rule.",
  );
}

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
const configRestore = read("scripts/restore-replit-config.mjs");
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
check(
  configRestore.includes('"pyrus-artifact.toml"') &&
    configRestore.includes("mode-only drift") &&
    configRestore.includes("targetsToRestore"),
  "restore-replit-config.mjs must cover the PYRUS artifact config and avoid replacing files for mode-only drift.",
);

if (failures.length > 0) {
  console.error("[check-replit-startup-guards] Startup guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-replit-startup-guards] ok");
