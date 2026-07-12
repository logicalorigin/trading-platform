#!/usr/bin/env node
// Guard: the canonical signal-monitor environment constant must always be a
// member of the environment_mode DB enum.
//
// Why this exists: HEAD once held CANONICAL_SIGNAL_ENVIRONMENT = "paper" after
// the DB enum was migrated paper -> shadow (enum became {shadow, live}). Building
// or deploying that code against the migrated DB throws an enum violation when it
// resolves/creates the canonical signal profile, which blanks every signal view
// ($0.00 across the STA / signal matrix). This check fails loudly on recurrence.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const servicePath = path.join(
  root,
  "artifacts/api-server/src/services/signal-monitor.ts",
);
const enumPath = path.join(root, "lib/db/src/schema/enums.ts");

// ponytail: these guards read literal declarations; use the TypeScript AST if their source gains comment-like string syntax.
const withoutBlockComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "");

export const extractCanonicalEnvironment = (source) =>
  withoutBlockComments(source).match(
    /^\s*const\s+CANONICAL_SIGNAL_ENVIRONMENT\s*:\s*RuntimeMode\s*=\s*["']([^"']+)["']\s*;?\s*(?:\/\/.*)?$/m,
  )?.[1];

export const extractEnvironmentModeMembers = (source) => {
  const enumBlock = withoutBlockComments(source).match(
    /^\s*export\s+const\s+\w+\s*=\s*pgEnum\(\s*["']environment_mode["']\s*,\s*\[([\s\S]*?)\]/m,
  );
  if (!enumBlock) return null;
  return [
    ...enumBlock[1].matchAll(/^\s*["']([^"']+)["']\s*,?\s*(?:\/\/.*)?$/gm),
  ].map((match) => match[1]);
};

const main = () => {
  const canonical = extractCanonicalEnvironment(
    readFileSync(servicePath, "utf8"),
  );
  if (!canonical) {
    console.error(
      "[check-canonical-signal-env] could not locate CANONICAL_SIGNAL_ENVIRONMENT literal in signal-monitor.ts",
    );
    process.exitCode = 1;
    return;
  }

  const members = extractEnvironmentModeMembers(readFileSync(enumPath, "utf8"));
  if (!members) {
    console.error(
      "[check-canonical-signal-env] could not locate environment_mode pgEnum in lib/db/src/schema/enums.ts",
    );
    process.exitCode = 1;
    return;
  }
  if (members.length === 0) {
    console.error(
      "[check-canonical-signal-env] environment_mode enum appears to have no members",
    );
    process.exitCode = 1;
    return;
  }

  if (!members.includes(canonical)) {
    console.error(
      `[check-canonical-signal-env] CANONICAL_SIGNAL_ENVIRONMENT="${canonical}" is NOT a valid environment_mode enum member (${members.join(
        ", ",
      )}). This blanks every signal view on deploy — fix the constant or the enum migration.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-canonical-signal-env] OK — canonical "${canonical}" is in environment_mode {${members.join(
      ", ",
    )}}`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
