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

function tomlHeader(line) {
  return (
    line.match(/^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/)?.[1] ??
    line.match(/^\s*\[\[([^\[\]]+)\]\]\s*(?:#.*)?$/)?.[1] ??
    null
  );
}

export function tomlRoot(source) {
  const lines = [];
  for (const line of source.split(/\r?\n/)) {
    if (tomlHeader(line)) break;
    lines.push(line);
  }
  return lines.join("\n");
}

export function tomlSection(source, section) {
  const lines = [];
  let active = false;
  for (const line of source.split(/\r?\n/)) {
    const header = tomlHeader(line);
    if (header) {
      if (active) break;
      active = header === section;
      continue;
    }
    if (active) lines.push(line);
  }
  return active ? lines.join("\n") : null;
}

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
  const root = tomlRoot(replit);
  const nix = tomlSection(replit, "nix") ?? "";
  const workflows = tomlSection(replit, "workflows") ?? "";

  if (!/^\s*channel\s*=\s*"stable-25_05"\s*$/m.test(nix)) {
    problems.push('.replit is missing [nix] channel = "stable-25_05"');
  }
  if (!/^modules\s*=\s*\[[^\]]*"postgresql-16"[^\]]*\]/m.test(root)) {
    problems.push(
      '.replit modules is missing "postgresql-16" (psql/client tooling)',
    );
  }
  if (!/^\s*runButton\s*=\s*"artifacts\/pyrus: web"\s*$/m.test(workflows)) {
    problems.push(
      '.replit is missing [workflows] runButton = "artifacts/pyrus: web" (Run button no longer targets the PYRUS web workflow)',
    );
  }
  const ports = parsePortMappings(replit);
  if (JSON.stringify(ports) !== JSON.stringify(EXPECTED_PORT_MAPPINGS)) {
    problems.push(
      `.replit [[ports]] blocks do not match the expected pair (8080 -> 8080, 18747 -> 3000); found ${ports.length} mapping(s). Recovery clobbers inject stale generated ports.`,
    );
  }

  return problems;
}
