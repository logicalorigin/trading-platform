import { readFileSync } from "node:fs";
import path from "node:path";

// Per-container dev env overrides (.pyrus-runtime/dev-env.local, KEY=VALUE
// lines, # comments). Loaded as the first import so flag flips (e.g.
// SIGNAL_OPTIONS_TALLY) apply via a SIGUSR2 in-place reload without the full
// workflow restart Replit secrets require. File values win over inherited env
// (the file records deliberate operator flips). Absent file = no-op, so this
// never affects production.
try {
  const text = readFileSync(
    path.resolve(process.cwd(), "../../.pyrus-runtime/dev-env.local"),
    "utf8",
  );
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (m) process.env[m[1]] = m[2];
  }
} catch {
  // no override file — nothing to do
}
