import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pyrus-api-codegen-"));

const generatedRoots = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];
const supportFiles = [
  "lib/api-client-react/src/custom-fetch.ts",
  "lib/api-zod/src/index.ts",
];

const listFiles = async (directoryPath, basePath = directoryPath) => {
  const files = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath, basePath)));
    } else if (entry.isFile()) {
      files.push(path.relative(basePath, entryPath));
    }
  }
  return files;
};

const copySupportFile = async (relativePath) => {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(tempRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
};

const writeFileAtomic = async (targetPath, content) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  await writeFile(tempPath, content);
  await rename(tempPath, targetPath);
};

const removeTrailingBlankLines = (content) => content.toString("utf8").replace(/\n{2,}$/u, "\n");

const publishGeneratedRoot = async (relativeRoot) => {
  const sourceRoot = path.join(tempRoot, relativeRoot);
  const targetRoot = path.join(repoRoot, relativeRoot);
  const sourceFiles = await listFiles(sourceRoot);
  const sourceFileSet = new Set(sourceFiles);

  await mkdir(targetRoot, { recursive: true });
  await Promise.all(
    sourceFiles.map(async (relativeFile) => {
      const content = await readFile(path.join(sourceRoot, relativeFile));
      await writeFileAtomic(path.join(targetRoot, relativeFile), content);
    }),
  );

  const targetFiles = await listFiles(targetRoot);
  await Promise.all(
    targetFiles
      .filter((relativeFile) => !sourceFileSet.has(relativeFile))
      .map((relativeFile) => unlink(path.join(targetRoot, relativeFile))),
  );
};

try {
  await Promise.all(supportFiles.map(copySupportFile));

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

  await Promise.all(generatedRoots.map(publishGeneratedRoot));

  await writeFileAtomic(
    path.join(repoRoot, "lib/api-client-react/src/generated/api.schemas.ts"),
    removeTrailingBlankLines(
      await readFile(
        path.join(repoRoot, "lib/api-client-react/src/generated/api.schemas.ts"),
      ),
    ),
  );

  const generatedIndex = path.join(tempRoot, "lib/api-zod/src/index.ts");
  const liveIndex = path.join(repoRoot, "lib/api-zod/src/index.ts");
  await writeFileAtomic(liveIndex, await readFile(generatedIndex));

  execFileSync("pnpm", ["-w", "run", "typecheck:libs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
