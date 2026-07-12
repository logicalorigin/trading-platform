#!/usr/bin/env node
// Shared detection for the Replit platform "Post-Recovery checkpoint" clobber
// signature that rewrote .replit from control-plane state (2026-07-09):
// deleted replit.nix, stripped the [nix] channel, dropped the postgresql-16
// module, dropped [workflows] runButton, and injected stale [[ports]] blocks.
//
// Used by scripts/restore-replit-config.mjs and the PYRUS dev supervisor
// (artifacts/pyrus/scripts/runDevApp.mjs) to detect-and-warn only. Nothing in
// this module writes .replit or replit.nix — a save of either file triggers a
// full workspace reload, so restores must be explicit and batched.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const RESTORE_COMMAND = "pnpm run replit:config:restore -- --write";

const EXPECTED_PORT_MAPPINGS = [
  { localPort: 8080, externalPort: 8080 },
  { localPort: 18747, externalPort: 3000 },
];

function parsePortMappings(source) {
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
    const match = line.match(/^\s*(localPort|externalPort)\s*=\s*(.+?)\s*$/);
    if (match) current[match[1]] = Number(match[2]);
  }
  if (current) mappings.push(current);
  return mappings;
}

export function detectReplitConfigClobber(repoRoot) {
  const problems = [];
  const replitPath = path.join(repoRoot, ".replit");
  const nixPath = path.join(repoRoot, "replit.nix");

  if (!existsSync(nixPath) || statSync(nixPath).size === 0) {
    problems.push(
      "replit.nix is missing or empty (recovery clobber deletes it, which bricks all shells)",
    );
  }

  if (!existsSync(replitPath)) {
    problems.push(".replit is missing entirely");
    return problems;
  }

  const replit = readFileSync(replitPath, "utf8");

  if (!/^\s*channel\s*=\s*"stable-25_05"\s*$/m.test(replit)) {
    problems.push('.replit is missing [nix] channel = "stable-25_05"');
  }
  if (!/^modules\s*=\s*\[[^\]]*"postgresql-16"[^\]]*\]/m.test(replit)) {
    problems.push('.replit modules is missing "postgresql-16" (psql/client tooling)');
  }
  if (
    !/^\s*\[workflows\]\s*\r?\n(?:(?!\s*\[)[^\n]*\r?\n)*?\s*runButton\s*=\s*"artifacts\/pyrus: web"\s*(?:\r?\n|$)/m.test(
      replit,
    )
  ) {
    problems.push(
      '.replit is missing [workflows] runButton = "artifacts/pyrus: web" (Run button no longer targets the PYRUS web workflow)',
    );
  }
  const ports = parsePortMappings(replit);
  if (
    JSON.stringify(ports) !== JSON.stringify(EXPECTED_PORT_MAPPINGS)
  ) {
    problems.push(
      `.replit [[ports]] blocks do not match the expected pair (8080 -> 8080, 18747 -> 3000); found ${ports.length} mapping(s). Recovery clobbers inject stale generated ports.`,
    );
  }

  return problems;
}
