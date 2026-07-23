#!/usr/bin/env node
// Shared detection for the Replit platform "Post-Recovery checkpoint" clobber
// signature that rewrote .replit from control-plane state (2026-07-09):
// deleted replit.nix, stripped the [nix] channel, dropped the postgresql-16
// module, dropped [workflows] runButton, and injected stale [[ports]] blocks.
//
// Used by the startup audit and restore command for validation, and by the
// PYRUS dev supervisor for warnings only. Nothing in this module writes
// .replit or replit.nix — a save of either file triggers a full workspace
// reload, so restores must be explicit and batched.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export function detectReplitConfigProblems({ replit, nix }) {
  const problems = [];
  if (typeof nix !== "string" || nix.length === 0) {
    problems.push(
      "replit.nix is missing or empty (recovery clobber deletes it, which bricks all shells)",
    );
  }

  if (typeof replit !== "string") {
    problems.push(".replit is missing entirely");
    return problems;
  }
  const root = tomlRoot(replit);
  const nixSection = tomlSection(replit, "nix") ?? "";
  const workflows = tomlSection(replit, "workflows") ?? "";

  if (!/^\s*channel\s*=\s*"stable-25_05"\s*$/m.test(nixSection)) {
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

function parseNixSyntax(source) {
  const result = spawnSync("nix-instantiate", ["--parse", "-"], {
    encoding: "utf8",
    input: source,
    maxBuffer: 64 * 1024,
    stdio: ["pipe", "ignore", "pipe"],
    timeout: 5_000,
  });
  if (result.error) {
    return `replit.nix Nix syntax could not be validated (${result.error.code ?? result.error.message})`;
  }
  return result.status === 0 ? null : "replit.nix has invalid Nix syntax";
}

export function validateReplitStartupConfig(
  { replit, nix },
  { validateNixSyntax = parseNixSyntax } = {},
) {
  const problems = detectReplitConfigProblems({ replit, nix });
  if (typeof replit === "string") {
    const root = tomlRoot(replit);
    const agent = tomlSection(replit, "agent") ?? "";

    if (!/^\s*stack\s*=\s*"PNPM_WORKSPACE"\s*$/m.test(agent)) {
      problems.push(
        '.replit must keep [agent] stack = "PNPM_WORKSPACE" so the PYRUS artifact owns startup',
      );
    }
    if (/^\s*run\s*=/m.test(root)) {
      problems.push(".replit must not define a root run command");
    }
    if (/^\s*\[\[workflows\.workflow\]\]\s*$/m.test(replit)) {
      problems.push(
        ".replit must not define repo-tracked workflow tasks; artifact TOMLs own startup",
      );
    }
    if (
      /^\s*\[workflows\.workflow\.metadata\]\s*$/m.test(replit) ||
      /^\s*task\s*=\s*"workflow\.run"\s*$/m.test(replit) ||
      /^\s*args\s*=\s*"Local Postgres"\s*$/m.test(replit) ||
      /run-local-postgres\.sh/.test(replit)
    ) {
      problems.push(
        ".replit must not restore the retired Local Postgres workflow",
      );
    }
    if (
      /^\s*DATABASE_URL\s*=\s*"postgres:\/\/\/dev\?host=\/home\/runner\/workspace\/\.local\/postgres\/run&user=runner"\s*$/m.test(
        replit,
      )
    ) {
      problems.push(
        ".replit must not force the retired workspace-local PostgreSQL socket",
      );
    }
  }
  if (typeof nix === "string" && nix.length > 0) {
    const syntaxProblem = validateNixSyntax(nix);
    if (syntaxProblem) problems.push(syntaxProblem);
  }
  return problems;
}

function parseCanonicalArtifactToml(source) {
  // ponytail: the canonical artifact uses this JSON-compatible TOML subset;
  // replace this parser when Node exposes a standard TOML parser.
  const tables = new Map([["", Object.create(null)]]);
  let section = "";
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const arrayHeader = /^\[\[([A-Za-z0-9_.-]+)\]\]$/u.exec(line);
    const tableHeader = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(line);
    if (arrayHeader || tableHeader) {
      section = (arrayHeader ?? tableHeader)[1];
      if (tables.has(section)) {
        throw new Error(`duplicate table ${section} on line ${index + 1}`);
      }
      tables.set(section, Object.create(null));
      continue;
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (!assignment) {
      throw new Error(`invalid TOML syntax on line ${index + 1}`);
    }
    const table = tables.get(section);
    const [, key, rawValue] = assignment;
    if (Object.hasOwn(table, key)) {
      throw new Error(
        `duplicate key ${section ? `${section}.` : ""}${key} on line ${index + 1}`,
      );
    }
    try {
      table[key] = /^-?\d+$/u.test(rawValue)
        ? Number(rawValue)
        : JSON.parse(rawValue);
    } catch {
      throw new Error(`invalid value for ${key} on line ${index + 1}`);
    }
  }
  return tables;
}

export function validatePyrusArtifactConfig(source) {
  if (typeof source !== "string") {
    return ["artifact config is missing"];
  }
  let tables;
  try {
    tables = parseCanonicalArtifactToml(source);
  } catch (error) {
    return [
      `artifact config has invalid TOML (${error instanceof Error ? error.message : String(error)})`,
    ];
  }
  const root = tables.get("") ?? {};
  const service = tables.get("services") ?? {};
  const development = tables.get("services.development") ?? {};
  const productionBuild = tables.get("services.production.build") ?? {};
  const productionRun = tables.get("services.production.run") ?? {};
  const productionRunEnv = tables.get("services.production.run.env") ?? {};
  const productionHealth =
    tables.get("services.production.health.startup") ?? {};
  const expected = [
    [root.kind === "web", 'root kind must be "web"'],
    [root.id === "artifacts/pyrus", 'root id must be "artifacts/pyrus"'],
    [service.localPort === 18747, "web service localPort must be 18747"],
    [
      /^(?:trap '' HUP; )?exec pnpm --filter @workspace\/pyrus run dev:replit$/u.test(
        development.run,
      ),
      "development run command is invalid",
    ],
    [
      JSON.stringify(productionBuild.args) ===
        JSON.stringify(["pnpm", "run", "build:pyrus-app"]),
      "production build args are invalid",
    ],
    [
      JSON.stringify(productionRun.args) ===
        JSON.stringify([
          "node",
          "--enable-source-maps",
          "artifacts/pyrus/scripts/runProductionApp.mjs",
        ]),
      "production run args are invalid",
    ],
    [productionRunEnv.PORT === "18747", 'production PORT must be "18747"'],
    [
      productionRunEnv.PYRUS_SERVE_WEB === "1",
      'production PYRUS_SERVE_WEB must be "1"',
    ],
    [
      productionHealth.path === "/api/healthz",
      'production startup health path must be "/api/healthz"',
    ],
  ];
  return expected.flatMap(([valid, problem]) => (valid ? [] : [problem]));
}

export function detectReplitConfigClobber(repoRoot) {
  function read(relativePath) {
    try {
      return readFileSync(path.join(repoRoot, relativePath), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  return detectReplitConfigProblems({
    replit: read(".replit"),
    nix: read("replit.nix"),
  });
}
