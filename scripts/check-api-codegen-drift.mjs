#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoots = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

const collectFiles = (dirPath, files = []) => {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryPath, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const hashGeneratedOutput = () => {
  const hash = crypto.createHash("sha256");
  for (const root of generatedRoots) {
    const absoluteRoot = path.join(repoRoot, root);
    const files = collectFiles(absoluteRoot).sort();
    hash.update(`${root}\0`);
    for (const filePath of files) {
      hash.update(path.relative(repoRoot, filePath));
      hash.update("\0");
      hash.update(fs.readFileSync(filePath));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
};

const before = hashGeneratedOutput();

execFileSync("pnpm", ["--filter", "@workspace/api-spec", "run", "codegen"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const after = hashGeneratedOutput();

if (before !== after) {
  console.error(
    "[check-api-codegen-drift] generated API clients changed; commit regenerated output",
  );
  process.exit(1);
}

console.log("[check-api-codegen-drift] ok: generated API clients are current");
