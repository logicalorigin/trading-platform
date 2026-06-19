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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const servicePath = path.join(
  root,
  "artifacts/api-server/src/services/signal-monitor.ts",
);
const enumPath = path.join(root, "lib/db/src/schema/enums.ts");

const service = readFileSync(servicePath, "utf8");
const canonMatch = service.match(
  /CANONICAL_SIGNAL_ENVIRONMENT\s*:\s*RuntimeMode\s*=\s*["']([^"']+)["']/,
);
if (!canonMatch) {
  console.error(
    "[check-canonical-signal-env] could not locate CANONICAL_SIGNAL_ENVIRONMENT literal in signal-monitor.ts",
  );
  process.exit(1);
}
const canonical = canonMatch[1];

const enumSrc = readFileSync(enumPath, "utf8");
const enumBlock = enumSrc.match(
  /pgEnum\(\s*["']environment_mode["']\s*,\s*\[([\s\S]*?)\]/,
);
if (!enumBlock) {
  console.error(
    "[check-canonical-signal-env] could not locate environment_mode pgEnum in lib/db/src/schema/enums.ts",
  );
  process.exit(1);
}
const members = [...enumBlock[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
if (members.length === 0) {
  console.error(
    "[check-canonical-signal-env] environment_mode enum appears to have no members",
  );
  process.exit(1);
}

if (!members.includes(canonical)) {
  console.error(
    `[check-canonical-signal-env] CANONICAL_SIGNAL_ENVIRONMENT="${canonical}" is NOT a valid environment_mode enum member (${members.join(
      ", ",
    )}). This blanks every signal view on deploy — fix the constant or the enum migration.`,
  );
  process.exit(1);
}

console.log(
  `[check-canonical-signal-env] OK — canonical "${canonical}" is in environment_mode {${members.join(
    ", ",
  )}}`,
);
