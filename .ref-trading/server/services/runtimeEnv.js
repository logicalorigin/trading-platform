import fs from "node:fs";

const SNAPSHOT_PATHS = [
  process.env.REPLIT_ENV_SNAPSHOT_PATH,
  "/run/replit/env/latest.json",
  "/run/replit/env/last.json",
].filter(Boolean);

let hydrated = false;
let lastHydratedFrom = null;
let lastMergedCount = 0;

export function hydrateRuntimeEnvFromSnapshot(options = {}) {
  const force = Boolean(options.force);
  if (hydrated && !force) {
    return {
      hydrated: true,
      mergedCount: lastMergedCount,
      sourcePath: lastHydratedFrom,
    };
  }

  for (const snapshotPath of SNAPSHOT_PATHS) {
    try {
      if (!fs.existsSync(snapshotPath)) {
        continue;
      }
      const raw = fs.readFileSync(snapshotPath, "utf8");
      if (!raw || !raw.trim()) {
        continue;
      }

      const parsed = JSON.parse(raw);
      const environment = parsed?.environment;
      if (!environment || typeof environment !== "object") {
        continue;
      }

      let mergedCount = 0;
      for (const [key, value] of Object.entries(environment)) {
        if (value == null) {
          continue;
        }
        if (process.env[key] == null || String(process.env[key]).trim() === "") {
          process.env[key] = String(value);
          mergedCount += 1;
        }
      }

      hydrated = true;
      lastHydratedFrom = snapshotPath;
      lastMergedCount = mergedCount;
      return {
        hydrated: true,
        mergedCount,
        sourcePath: snapshotPath,
      };
    } catch {
      // Continue trying alternate snapshot paths.
    }
  }

  hydrated = true;
  lastHydratedFrom = null;
  lastMergedCount = 0;
  return {
    hydrated: false,
    mergedCount: 0,
    sourcePath: null,
  };
}

