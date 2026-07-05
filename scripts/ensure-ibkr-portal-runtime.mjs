#!/usr/bin/env node
// Idempotently provisions the IBKR Client Portal Gateway runtime used by the
// hosted broker connector (services/ibkr-portal-gateway-manager.ts):
//   - IBKR's clientportal.gw distribution (the Java gateway + its jars)
//   - a portable Temurin JRE, ONLY if `java` is not already on PATH
//     (replit.nix provides java in-container; the portable JRE is the fallback
//     for fresh clones / environments without a system JDK).
// Safe to run repeatedly; only downloads what is missing. The runtime lives
// under IBKR_PORTAL_HOME (default <repo>/.pyrus-runtime/ibkr-cpg — gitignored,
// inside the workspace so it survives Replit container resets).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME =
  process.env["IBKR_PORTAL_HOME"] ??
  path.join(REPO_ROOT, ".pyrus-runtime", "ibkr-cpg");
const GW_DIR = path.join(HOME, "gw");
const GW_JAR = path.join(
  GW_DIR,
  "dist",
  "ibgroup.web.core.iblink.router.clientportal.gw.jar",
);
const CPG_URL =
  "https://download2.interactivebrokers.com/portal/clientportal.gw.zip";
const JRE_URL =
  "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jre/hotspot/normal/eclipse";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (status ${r.status})`);
  }
}

function javaOnPath() {
  return spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0;
}

function ensureGateway() {
  if (existsSync(GW_JAR)) {
    console.log(`[ibkr-portal] gateway present: ${GW_DIR}`);
    return;
  }
  console.log(`[ibkr-portal] downloading clientportal.gw -> ${GW_DIR}`);
  mkdirSync(GW_DIR, { recursive: true });
  const zip = path.join(HOME, "clientportal.gw.zip");
  run("curl", ["-fsSL", "-m", "120", "-o", zip, CPG_URL]);
  run("unzip", ["-o", "-q", zip, "-d", GW_DIR]);
  if (!existsSync(GW_JAR)) {
    throw new Error("clientportal.gw extracted but gateway jar still missing");
  }
  console.log("[ibkr-portal] gateway ready");
}

function ensureJava() {
  if (javaOnPath()) {
    console.log("[ibkr-portal] java: found on PATH (system/nix)");
    return;
  }
  const portable = path.join(HOME, "jre", "bin", "java");
  if (existsSync(portable)) {
    console.log(`[ibkr-portal] java: portable JRE present (${portable})`);
    return;
  }
  console.log("[ibkr-portal] java: not found — downloading portable Temurin 17 JRE");
  mkdirSync(HOME, { recursive: true });
  const tgz = path.join(HOME, "jre.tar.gz");
  run("curl", ["-fsSL", "-m", "180", "-o", tgz, JRE_URL]);
  run("tar", ["xzf", tgz, "-C", HOME]);
  // symlink the versioned jdk-*-jre dir to a stable `jre`
  run("bash", [
    "-c",
    `ln -sfn "$(cd '${HOME}' && ls -d jdk-*-jre | head -1)" '${path.join(HOME, "jre")}'`,
  ]);
  if (!existsSync(portable)) {
    throw new Error("portable JRE extracted but java binary still missing");
  }
  console.log("[ibkr-portal] java: portable JRE ready");
}

console.log(`[ibkr-portal] ensuring runtime under ${HOME}`);
ensureJava();
ensureGateway();
console.log("[ibkr-portal] runtime OK");
