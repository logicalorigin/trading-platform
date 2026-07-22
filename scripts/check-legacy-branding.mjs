#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

const ignoredPaths = new Set(["scripts/check-legacy-branding.mjs"]);
const ignoredRootPrefixes = ["AGENT_CHAT_", "SESSION_HANDOFF_"];

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".dmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".log",
]);

const forbidden = [
  /ray[-_ ]?algo/i,
  /ray[-_ ]?replica/i,
  /rayReplica/,
  /RAY_REPLICA/,
  /\bray\b.{0,80}\balgo\b/i,
  /\bray\b.{0,80}\breplica\b/i,
  /\bRAY\b\s*·/,
];

const allowed = [
  {
    path: "artifacts/api-server/src/services/algo-branding.ts",
    line: /./,
  },
  {
    path: "artifacts/api-server/src/services/algo-branding.test.ts",
    line: /./,
  },
  {
    path: "artifacts/pyrus/src/screens/algo/algoBranding.js",
    line: /./,
  },
  {
    path: "artifacts/api-server/src/services/user-preferences-model.ts",
    line: /RETIRED_DASHBOARD_SETTING_KEY/,
  },
  {
    path: "artifacts/pyrus/src/features/preferences/userPreferenceModel.ts",
    line: /RETIRED_(WORKSPACE_STORAGE_KEY|DASHBOARD_SETTING_KEY)/,
  },
  {
    path: "artifacts/pyrus/src/features/preferences/userPreferenceModel.test.mjs",
    line: /RETIRED_WORKSPACE_STORAGE_KEY|retired Ray workspace migration key/,
  },
  {
    path: "artifacts/pyrus/src/lib/workspaceStorage.ts",
    line: /RETIRED_WORKSPACE_STORAGE_KEY/,
  },
  {
    path: "artifacts/pyrus/src/lib/uiTokens.jsx",
    line: /RETIRED_WORKSPACE_STORAGE_KEY/,
  },
];

export function shouldIgnore(relPath) {
  if (ignoredPaths.has(relPath)) return true;
  if (
    !relPath.includes("/") &&
    ignoredRootPrefixes.some((prefix) => relPath.startsWith(prefix))
  ) {
    return true;
  }
  return binaryExtensions.has(path.extname(relPath).toLowerCase());
}

function isAllowed(relPath, line) {
  return allowed.some(
    (entry) => entry.path === relPath && entry.line.test(line),
  );
}

function listFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((relPath) => !shouldIgnore(relPath))
    .map((relPath) => ({
      fullPath: path.join(repoRoot, relPath),
      relPath,
    }));
}

const main = () => {
  const failures = [];

  for (const { fullPath, relPath } of listFiles()) {
    if (!existsSync(fullPath) || statSync(fullPath).size > 2_000_000) continue;
    const source = readFileSync(fullPath, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!forbidden.some((pattern) => pattern.test(line))) return;
      if (isAllowed(relPath, line)) return;
      failures.push(`${relPath}:${index + 1}: ${line.trim()}`);
    });
  }

  if (failures.length > 0) {
    console.error(
      "[check-legacy-branding] retired branding remains outside the compatibility allowlist:",
    );
    for (const failure of failures.slice(0, 80)) {
      console.error(`  ${failure}`);
    }
    if (failures.length > 80) {
      console.error(`  ...and ${failures.length - 80} more`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[check-legacy-branding] ok: no retired branding remains");
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
