import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_VALIDATION_LOCK_FILE,
  DEFAULT_VALIDATION_NODE_OPTIONS,
  createValidationLock,
  removeValidationLock,
} from "../../scripts/run-validation-command.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const generatedRoots = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];
const managedFiles = ["lib/api-zod/src/index.ts"];
const normalizedGeneratedFiles = [
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-zod/src/generated/api.ts",
];
const supportFiles = [
  "lib/api-client-react/src/custom-fetch.ts",
  "lib/api-zod/src/index.ts",
];

const comparePaths = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

function managedPath(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Managed output path must be relative: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Managed output path escapes its root: ${relativePath}`);
  }
  return resolved;
}

async function pathState(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertNoSymbolicLinkComponents(root, relativePath) {
  const rootState = await pathState(root);
  if (!rootState?.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error(`Managed output root must be a real directory: ${root}`);
  }
  let currentPath = root;
  for (const component of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, component);
    const state = await pathState(currentPath);
    if (!state) return;
    if (state.isSymbolicLink()) {
      throw new Error(
        `Managed output path contains a symbolic link: ${path.relative(root, currentPath)}`,
      );
    }
  }
}

async function assertManagedPathBoundaries({
  stagingRoot,
  targetRoot,
  recoveryRoot,
  generatedRoots: roots,
  managedFiles: files,
}) {
  for (const relativePath of [...roots, ...files]) {
    await assertNoSymbolicLinkComponents(stagingRoot, relativePath);
    await assertNoSymbolicLinkComponents(targetRoot, relativePath);
  }
  const relativeRecovery = path.relative(targetRoot, recoveryRoot);
  if (
    !relativeRecovery ||
    path.isAbsolute(relativeRecovery) ||
    relativeRecovery === ".." ||
    relativeRecovery.startsWith(`..${path.sep}`) ||
    [...roots, ...files].some(
      (relativePath) =>
        relativeRecovery === relativePath ||
        relativeRecovery.startsWith(`${relativePath}${path.sep}`) ||
        relativePath.startsWith(`${relativeRecovery}${path.sep}`),
    )
  ) {
    throw new Error(
      "API codegen recovery path must be a separate directory inside the target root",
    );
  }
  await assertNoSymbolicLinkComponents(targetRoot, relativeRecovery);
}

async function listFiles(
  directoryPath,
  basePath = directoryPath,
  missingOk = false,
) {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (missingOk && error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) =>
    comparePaths(left.name, right.name),
  )) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath, basePath)));
    } else if (entry.isFile()) {
      files.push(path.relative(basePath, entryPath));
    } else {
      throw new Error(
        `Managed output contains an unsupported entry: ${entryPath}`,
      );
    }
  }
  return files.sort(comparePaths);
}

async function readFileIfPresent(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeFileAtomic(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

const removeTrailingBlankLines = (content) =>
  content.toString("utf8").replace(/\n{2,}$/u, "\n");

export async function normalizeStagedOutputs(stagingRoot) {
  for (const relativePath of normalizedGeneratedFiles) {
    const filePath = managedPath(stagingRoot, relativePath);
    const current = await readFile(filePath);
    const normalized = removeTrailingBlankLines(current);
    if (normalized !== current.toString("utf8")) {
      await writeFileAtomic(filePath, normalized);
    }
  }
}

async function buildPublicationPlan({
  stagingRoot,
  targetRoot,
  generatedRoots: roots,
  managedFiles: files,
}) {
  const writes = [];
  const deletes = [];

  for (const relativeRoot of roots) {
    const sourceRoot = managedPath(stagingRoot, relativeRoot);
    const liveRoot = managedPath(targetRoot, relativeRoot);
    const sourceFiles = await listFiles(sourceRoot);
    const liveFiles = await listFiles(liveRoot, liveRoot, true);
    const sourceFileSet = new Set(sourceFiles);

    for (const relativeFile of sourceFiles) {
      const relativePath = path.join(relativeRoot, relativeFile);
      const content = await readFile(managedPath(stagingRoot, relativePath));
      const liveContent = await readFileIfPresent(
        managedPath(targetRoot, relativePath),
      );
      if (!liveContent?.equals(content)) {
        writes.push({ relativePath, content });
      }
    }
    for (const relativeFile of liveFiles) {
      if (!sourceFileSet.has(relativeFile)) {
        deletes.push(path.join(relativeRoot, relativeFile));
      }
    }
  }

  for (const relativePath of files) {
    const content = await readFile(managedPath(stagingRoot, relativePath));
    const liveContent = await readFileIfPresent(
      managedPath(targetRoot, relativePath),
    );
    if (!liveContent?.equals(content)) {
      writes.push({ relativePath, content });
    }
  }

  writes.sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath),
  );
  deletes.sort(comparePaths);
  return { writes, deletes };
}

async function snapshotManagedOutputs({
  targetRoot,
  recoveryRoot,
  generatedRoots: roots,
  managedFiles: files,
}) {
  const relativeRecovery = path.relative(targetRoot, recoveryRoot);
  await assertNoSymbolicLinkComponents(targetRoot, relativeRecovery);
  await mkdir(recoveryRoot, { recursive: true });
  await assertNoSymbolicLinkComponents(targetRoot, relativeRecovery);
  const snapshotRoot = await mkdtemp(
    path.join(recoveryRoot, "api-codegen-rollback-"),
  );
  const manifest = {
    schemaVersion: 1,
    generatedRoots: [],
    managedFiles: [],
  };
  try {
    for (const relativeRoot of roots) {
      await assertNoSymbolicLinkComponents(targetRoot, relativeRoot);
      const sourcePath = managedPath(targetRoot, relativeRoot);
      const state = await pathState(sourcePath);
      if (state && !state.isDirectory()) {
        throw new Error(
          `Managed generated root is not a directory: ${relativeRoot}`,
        );
      }
      manifest.generatedRoots.push({
        path: relativeRoot,
        existed: Boolean(state),
      });
      if (state) {
        await assertSnapshotPathBoundaries({
          snapshot: { root: snapshotRoot },
          targetRoot,
          recoveryRoot,
        });
        const backupPath = managedPath(
          path.join(snapshotRoot, "contents"),
          relativeRoot,
        );
        await mkdir(path.dirname(backupPath), { recursive: true });
        await assertSnapshotPathBoundaries({
          snapshot: { root: snapshotRoot },
          targetRoot,
          recoveryRoot,
        });
        await cp(sourcePath, backupPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
        });
      }
    }
    for (const relativePath of files) {
      await assertNoSymbolicLinkComponents(targetRoot, relativePath);
      const sourcePath = managedPath(targetRoot, relativePath);
      const state = await pathState(sourcePath);
      if (state && !state.isFile()) {
        throw new Error(
          `Managed output is not a regular file: ${relativePath}`,
        );
      }
      manifest.managedFiles.push({
        path: relativePath,
        existed: Boolean(state),
      });
      if (state) {
        await assertSnapshotPathBoundaries({
          snapshot: { root: snapshotRoot },
          targetRoot,
          recoveryRoot,
        });
        const backupPath = managedPath(
          path.join(snapshotRoot, "contents"),
          relativePath,
        );
        await mkdir(path.dirname(backupPath), { recursive: true });
        await assertSnapshotPathBoundaries({
          snapshot: { root: snapshotRoot },
          targetRoot,
          recoveryRoot,
        });
        await copyFile(sourcePath, backupPath);
      }
    }
    await assertSnapshotPathBoundaries({
      snapshot: { root: snapshotRoot },
      targetRoot,
      recoveryRoot,
    });
    await writeFileAtomic(
      path.join(snapshotRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return { root: snapshotRoot, manifest };
  } catch (error) {
    try {
      await removeRecoverySnapshot(
        { root: snapshotRoot },
        targetRoot,
        recoveryRoot,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `API codegen snapshot failed and safe cleanup could not be proved; partial recovery snapshot retained at ${snapshotRoot}`,
      );
    }
    throw error;
  }
}

async function assertSnapshotPathBoundaries({
  snapshot,
  targetRoot,
  recoveryRoot,
}) {
  const relativeRecovery = path.relative(targetRoot, recoveryRoot);
  const relativeSnapshot = path.relative(recoveryRoot, snapshot.root);
  if (
    !relativeSnapshot ||
    path.isAbsolute(relativeSnapshot) ||
    relativeSnapshot === ".." ||
    relativeSnapshot.startsWith(`..${path.sep}`)
  ) {
    throw new Error("API codegen snapshot escaped its recovery directory");
  }
  await assertNoSymbolicLinkComponents(targetRoot, relativeRecovery);
  await assertNoSymbolicLinkComponents(recoveryRoot, relativeSnapshot);
}

async function assertSnapshotEntry(snapshot, entry, expectedType) {
  const relativeBackup = path.join("contents", entry.path);
  await assertNoSymbolicLinkComponents(snapshot.root, relativeBackup);
  if (!entry.existed) return;
  const state = await pathState(managedPath(snapshot.root, relativeBackup));
  if (
    !state ||
    (expectedType === "directory" ? !state.isDirectory() : !state.isFile())
  ) {
    throw new Error(
      `API codegen recovery snapshot is incomplete: ${entry.path}`,
    );
  }
}

async function removeRecoverySnapshot(snapshot, targetRoot, recoveryRoot) {
  await assertSnapshotPathBoundaries({ snapshot, targetRoot, recoveryRoot });
  // ponytail: Node exposes no dirfd-relative recursive removal; this immediate
  // component recheck is the filesystem ceiling before deleting the snapshot.
  await rm(snapshot.root, { recursive: true, force: true });
}

async function restoreManagedOutputs(snapshot, targetRoot, recoveryRoot) {
  for (const entry of snapshot.manifest.generatedRoots) {
    await assertSnapshotPathBoundaries({ snapshot, targetRoot, recoveryRoot });
    await assertSnapshotEntry(snapshot, entry, "directory");
    await assertNoSymbolicLinkComponents(targetRoot, entry.path);
    const livePath = managedPath(targetRoot, entry.path);
    await rm(livePath, { recursive: true, force: true });
    if (entry.existed) {
      const backupPath = managedPath(
        path.join(snapshot.root, "contents"),
        entry.path,
      );
      await mkdir(path.dirname(livePath), { recursive: true });
      await cp(backupPath, livePath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
    }
  }
  for (const entry of snapshot.manifest.managedFiles) {
    await assertSnapshotPathBoundaries({ snapshot, targetRoot, recoveryRoot });
    await assertSnapshotEntry(snapshot, entry, "file");
    await assertNoSymbolicLinkComponents(targetRoot, entry.path);
    const livePath = managedPath(targetRoot, entry.path);
    await rm(livePath, { recursive: true, force: true });
    if (entry.existed) {
      const backupPath = managedPath(
        path.join(snapshot.root, "contents"),
        entry.path,
      );
      await mkdir(path.dirname(livePath), { recursive: true });
      await copyFile(backupPath, livePath);
    }
  }
}

async function pruneEmptyParents(filePath, generatedRootPath) {
  let directoryPath = path.dirname(filePath);
  while (directoryPath !== generatedRootPath) {
    try {
      await rmdir(directoryPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        directoryPath = path.dirname(directoryPath);
        continue;
      }
      if (error?.code === "ENOTEMPTY" || error?.code === "EEXIST") return;
      throw error;
    }
    directoryPath = path.dirname(directoryPath);
  }
}

async function applyPublicationPlan(plan, targetRoot, roots) {
  for (const relativePath of plan.deletes) {
    await assertNoSymbolicLinkComponents(targetRoot, relativePath);
    const targetPath = managedPath(targetRoot, relativePath);
    await unlink(targetPath);
    const relativeRoot = roots.find(
      (root) =>
        relativePath === root || relativePath.startsWith(`${root}${path.sep}`),
    );
    if (relativeRoot) {
      await pruneEmptyParents(
        targetPath,
        managedPath(targetRoot, relativeRoot),
      );
    }
  }
  for (const entry of plan.writes) {
    await assertNoSymbolicLinkComponents(targetRoot, entry.relativePath);
    await writeFileAtomic(
      managedPath(targetRoot, entry.relativePath),
      entry.content,
    );
  }
}

export async function validatePublishedOutputs(
  targetRoot = repoRoot,
  runCommand = execFileSync,
) {
  runCommand("pnpm", ["--filter", "@workspace/api-zod", "test"], {
    cwd: targetRoot,
    stdio: "inherit",
  });
  runCommand("pnpm", ["exec", "tsc", "--build"], {
    cwd: targetRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? DEFAULT_VALIDATION_NODE_OPTIONS,
    },
    stdio: "inherit",
  });
}

async function publishUnderLock({
  stagingRoot,
  targetRoot,
  recoveryRoot,
  generatedRoots: roots,
  managedFiles: files,
  validate,
}) {
  await assertManagedPathBoundaries({
    stagingRoot,
    targetRoot,
    recoveryRoot,
    generatedRoots: roots,
    managedFiles: files,
  });
  const plan = await buildPublicationPlan({
    stagingRoot,
    targetRoot,
    generatedRoots: roots,
    managedFiles: files,
  });
  const result = {
    written: plan.writes.map((entry) => entry.relativePath),
    deleted: [...plan.deletes],
  };
  if (!plan.writes.length && !plan.deletes.length) {
    await validate();
    return result;
  }

  await assertManagedPathBoundaries({
    stagingRoot,
    targetRoot,
    recoveryRoot,
    generatedRoots: roots,
    managedFiles: files,
  });
  // ponytail: a complete 1.61 MB managed-output snapshot is the filesystem
  // ceiling for simple rollback; use a per-file journal only if this copy cost
  // becomes measurable.
  const snapshot = await snapshotManagedOutputs({
    targetRoot,
    recoveryRoot,
    generatedRoots: roots,
    managedFiles: files,
  });
  try {
    await assertManagedPathBoundaries({
      stagingRoot,
      targetRoot,
      recoveryRoot,
      generatedRoots: roots,
      managedFiles: files,
    });
    await applyPublicationPlan(plan, targetRoot, roots);
    await validate();
  } catch (error) {
    try {
      await restoreManagedOutputs(snapshot, targetRoot, recoveryRoot);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `API codegen failed and rollback failed; recovery snapshot retained at ${snapshot.root}`,
      );
    }
    try {
      await removeRecoverySnapshot(snapshot, targetRoot, recoveryRoot);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `API codegen failed; output was restored but recovery snapshot cleanup failed at ${snapshot.root}`,
      );
    }
    throw error;
  }
  await removeRecoverySnapshot(snapshot, targetRoot, recoveryRoot);
  return result;
}

export async function publishStagedOutputs({
  stagingRoot,
  targetRoot = repoRoot,
  lockFile = DEFAULT_VALIDATION_LOCK_FILE,
  recoveryRoot = path.join(targetRoot, ".pyrus-runtime", "api-codegen"),
  generatedRoots: roots = generatedRoots,
  managedFiles: files = managedFiles,
  validate = () => validatePublishedOutputs(targetRoot),
}) {
  const lock = createValidationLock(lockFile, "api-codegen");
  if (!lock.acquired) {
    const owner = lock.existing;
    const error = new Error(
      `Refusing api-codegen: validation lock is held${owner?.pid ? ` by pid ${owner.pid}` : ""}${owner?.label ? ` (${owner.label})` : ""}`,
    );
    error.exitCode = 75;
    throw error;
  }

  let result;
  let failure = null;
  try {
    result = await publishUnderLock({
      stagingRoot,
      targetRoot,
      recoveryRoot,
      generatedRoots: roots,
      managedFiles: files,
      validate,
    });
  } catch (error) {
    failure = error;
  }

  if (!removeValidationLock(lockFile, lock.lockId)) {
    const releaseError = new Error(
      `API codegen could not release its validation lock: ${lockFile}`,
    );
    failure = failure
      ? new AggregateError(
          [failure, releaseError],
          "API codegen failed and its validation lock could not be released",
        )
      : releaseError;
  }
  if (failure) throw failure;
  return result;
}

async function copySupportFile(tempRoot, relativePath) {
  const sourcePath = managedPath(repoRoot, relativePath);
  const targetPath = managedPath(tempRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function runCodegen() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pyrus-api-codegen-"));
  try {
    await Promise.all(
      supportFiles.map((file) => copySupportFile(tempRoot, file)),
    );
    execFileSync("pnpm", ["exec", "orval", "--config", "./orval.config.ts"], {
      cwd: scriptDir,
      env: {
        ...process.env,
        PYRUS_API_CODEGEN_OUTPUT_ROOT: tempRoot,
      },
      stdio: "inherit",
    });
    execFileSync("node", ["./fix-api-zod-index.mjs"], {
      cwd: scriptDir,
      env: {
        ...process.env,
        PYRUS_API_CODEGEN_OUTPUT_ROOT: tempRoot,
      },
      stdio: "inherit",
    });
    await normalizeStagedOutputs(tempRoot);
    return await publishStagedOutputs({ stagingRoot: tempRoot });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCodegen().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  });
}
