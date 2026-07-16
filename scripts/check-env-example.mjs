#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envExamplePath = path.join(repoRoot, ".env.example");
const scanRoots = ["artifacts", "lib", "scripts"];
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const platformProvidedEnvVars = new Set(["REPLIT_MODE"]);
const ignoredDirs = new Set([
  ".git",
  ".turbo",
  "dist",
  "node_modules",
]);
const sourcePatterns = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /\benv\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  /import\.meta\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /\breadImportMetaEnv\(\)\.([A-Z][A-Z0-9_]*)/g,
  /\b[A-Za-z0-9_]*Env[A-Za-z0-9_]*\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /\b[A-Za-z0-9_]*Env\s*:\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /\b(?:readOptionalPositiveInteger|readPositiveInteger|optionalIntegerOption)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
];
const envNameListPattern =
  /\b[A-Z][A-Z0-9_]*(?:ENV_NAMES|ENV_KEYS)\s*=\s*\[([\s\S]*?)\]/g;
const uppercaseStringPattern = /["']([A-Z][A-Z0-9_]*)["']/g;

const readText = (filePath) => fs.readFileSync(filePath, "utf8");

export const isAuditedSourceFile = (fileName) =>
  sourceExtensions.has(path.extname(fileName)) &&
  !/(?:^|\.)(?:test|spec)\./.test(fileName);

const walk = (dirPath, files = []) => {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, files);
    } else if (entry.isFile() && isAuditedSourceFile(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

const collectDocumentedEnvVars = () => {
  const documented = new Set();
  const lines = readText(envExamplePath).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (match) {
      documented.add(match[1]);
    }
  }
  return documented;
};

export const collectReferencedEnvNames = (source) => {
  const names = new Set();

  for (const pattern of sourcePatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      names.add(match[1]);
    }
  }

  envNameListPattern.lastIndex = 0;
  let listMatch;
  while ((listMatch = envNameListPattern.exec(source)) !== null) {
    uppercaseStringPattern.lastIndex = 0;
    let stringMatch;
    while ((stringMatch = uppercaseStringPattern.exec(listMatch[1])) !== null) {
      names.add(stringMatch[1]);
    }
  }

  return names;
};

const collectReferencedEnvVars = () => {
  const references = new Map();
  const files = scanRoots.flatMap((root) => walk(path.join(repoRoot, root)));

  const addReference = (envName, relativePath) => {
    if (!references.has(envName)) {
      references.set(envName, new Set());
    }
    references.get(envName).add(relativePath);
  };

  for (const filePath of files) {
    const relativePath = path.relative(repoRoot, filePath);
    const source = readText(filePath);
    for (const envName of collectReferencedEnvNames(source)) {
      addReference(envName, relativePath);
    }
  }

  return references;
};

const main = () => {
  const documented = collectDocumentedEnvVars();
  const references = collectReferencedEnvVars();
  const missing = [...references.keys()]
    .filter((name) => !platformProvidedEnvVars.has(name))
    .filter((name) => !documented.has(name))
    .sort();

  if (missing.length > 0) {
    console.error(
      `[check-env-example] .env.example is missing ${missing.length} referenced env var(s):`,
    );
    for (const name of missing) {
      const files = [...references.get(name)].sort().join(", ");
      console.error(`  - ${name}: ${files}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-env-example] ok: ${references.size} referenced env var(s) documented in .env.example`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
