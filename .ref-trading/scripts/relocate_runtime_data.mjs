import fs from "node:fs/promises";
import path from "node:path";
import {
  APP_DATA_ROOT,
  LEGACY_APP_DATA_ROOT,
  REPO_LOCAL_APP_DATA_ROOT,
  describeRuntimeDataPaths,
} from "../server/services/runtimePaths.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const showOnly = args.has("--show");
const purgeFlatFiles = args.has("--purge-flat-files");

async function main() {
  const paths = describeRuntimeDataPaths();
  console.log(`appDataRoot=${paths.appDataRoot}`);
  console.log(`legacyAppDataRoot=${paths.legacyAppDataRoot}`);
  if (paths.repoLocalAppDataRoot) {
    console.log(`repoLocalAppDataRoot=${paths.repoLocalAppDataRoot}`);
  }
  const persistFlatFileArchives = shouldPersistFlatFileArchives();
  console.log(`persistFlatFileArchives=${persistFlatFileArchives}`);

  if (showOnly) {
    return;
  }

  await fs.mkdir(APP_DATA_ROOT, { recursive: true });

  let movedCount = 0;
  let skippedCount = 0;
  const sourceRoots = [
    LEGACY_APP_DATA_ROOT,
    REPO_LOCAL_APP_DATA_ROOT,
  ].filter((rootPath, index, array) => rootPath && array.indexOf(rootPath) === index && rootPath !== APP_DATA_ROOT);

  if (purgeFlatFiles && !dryRun) {
    await purgeLegacyFlatFiles(sourceRoots, { dryRun: false });
    console.log(`done moved=${movedCount} skipped=${skippedCount}`);
    return;
  }

  for (const sourceRoot of sourceRoots) {
    const candidates = [
      "massive-cache",
      "runtime-state.json",
      ...(await listCorruptSnapshots(sourceRoot)),
    ];
    if (persistFlatFileArchives) {
      candidates.unshift("massive-flat-files");
    }
    for (const name of candidates) {
      const sourcePath = path.join(sourceRoot, name);
      const targetPath = path.join(APP_DATA_ROOT, name);
      if (!(await pathExists(sourcePath))) {
        continue;
      }
      if (await pathExists(targetPath)) {
        console.log(`skip-existing ${name}`);
        skippedCount += 1;
        continue;
      }
      if (dryRun) {
        console.log(`dry-run move ${sourcePath} -> ${targetPath}`);
        movedCount += 1;
        continue;
      }
      await movePath(sourcePath, targetPath);
      console.log(`moved ${sourcePath} -> ${targetPath}`);
      movedCount += 1;
    }
  }

  if (!persistFlatFileArchives) {
    console.log("skip-flat-files relocation because archive retention is disabled in this environment");
  }
  if (purgeFlatFiles) {
    await purgeLegacyFlatFiles(sourceRoots, { dryRun });
  }

  console.log(`done moved=${movedCount} skipped=${skippedCount}`);
}

async function listCorruptSnapshots(rootPath) {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.startsWith("runtime-state.corrupt-"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function movePath(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    await fs.rm(sourcePath, { recursive: true, force: true });
  }
}

async function purgeLegacyFlatFiles(sourceRoots, { dryRun: useDryRun = false } = {}) {
  const purgeRoots = [
    APP_DATA_ROOT,
    ...sourceRoots,
  ].filter((rootPath, index, array) => rootPath && array.indexOf(rootPath) === index);
  for (const rootPath of purgeRoots) {
    const archiveRoot = path.join(rootPath, "massive-flat-files");
    if (!(await pathExists(archiveRoot))) {
      continue;
    }
    if (useDryRun) {
      console.log(`dry-run purge ${archiveRoot}`);
      continue;
    }
    await fs.rm(archiveRoot, { recursive: true, force: true });
    console.log(`purged ${archiveRoot}`);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function shouldPersistFlatFileArchives() {
  const override = parseOptionalBooleanEnv(process.env.MASSIVE_FLAT_FILES_PERSIST_ARCHIVES);
  if (override !== null) {
    return override;
  }
  return !String(process.env.REPLIT_SESSION || "").trim();
}

function parseOptionalBooleanEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
