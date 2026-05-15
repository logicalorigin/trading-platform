#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
check(
  /^\s*stack\s*=\s*"PNPM_WORKSPACE"\s*$/m.test(replit),
  ".replit must keep [agent] stack = \"PNPM_WORKSPACE\" so artifacts own app bring-up.",
);
check(
  !/^\s*run\s*=/m.test(replit),
  ".replit must not define a root run command; use Replit's default Run Replit App entry.",
);
check(
  /^\s*\[workflows\]\s*$(?:[\s\S]*?)^\s*runButton\s*=\s*"Project"\s*$/m.test(
    replit,
  ),
  ".replit must keep [workflows] runButton = \"Project\" so the workflow service targets the artifact parent workflow.",
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
  ".replit must not restore the old Project/Local Postgres workflow body; Project is only the primary Run button target.",
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

const apiArtifact = read("artifacts/api-server/.replit-artifact/artifact.toml");
check(
  /^\s*run\s*=\s*"LOG_LEVEL=warn pnpm --filter @workspace\/api-server run dev"\s*$/m.test(
    apiArtifact,
  ),
  "API artifact dev startup must remain LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev.",
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

const reaper = read("scripts/reap-dev-port.mjs");
check(
  reaper.includes('process.env.REPLIT_MODE === "workflow"') &&
    reaper.includes("another Replit execution scope") &&
    reaper.includes("Shell-launched dev commands must not kill"),
  "reap-dev-port.mjs must allow Replit workflow restarts to replace previous Replit execution scopes while preserving shell safety.",
);

if (failures.length > 0) {
  console.error("[check-replit-startup-guards] Startup guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-replit-startup-guards] ok");
