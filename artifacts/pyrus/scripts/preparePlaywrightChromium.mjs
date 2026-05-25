#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPLIT_PATCH_CACHE_ROOT = join(homedir(), ".cache", "playwright-replit");
const NIX_LIB_EXPR = `
let pkgs = import <nixpkgs> {};
in pkgs.lib.makeLibraryPath [
  pkgs.glib
  pkgs.nspr
  pkgs.nss
  pkgs.dbus
  pkgs.atk
  pkgs.at-spi2-atk
  pkgs.at-spi2-core
  pkgs.cups.lib
  pkgs.expat
  pkgs.xorg.libxcb
  pkgs.libxkbcommon
  pkgs.alsa-lib
  pkgs.libgbm
  pkgs.mesa
  pkgs.libdrm
  pkgs.gtk3
  pkgs.pango
  pkgs.cairo
  pkgs.systemd
  pkgs.xorg.libX11
  pkgs.xorg.libXcomposite
  pkgs.xorg.libXdamage
  pkgs.xorg.libXext
  pkgs.xorg.libXfixes
  pkgs.xorg.libXrandr
  pkgs.xorg.libxshmfence
  pkgs.xorg.libXcursor
  pkgs.xorg.libXi
  pkgs.xorg.libXtst
  pkgs.xorg.libXScrnSaver
  pkgs.xorg.libXinerama
]
`.trim();

function trimOutput(text = "") {
  return text.trim();
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function collectAncestorCacheRoots(startPath) {
  const roots = [];
  let cursor = resolve(startPath);

  while (true) {
    roots.push(join(cursor, ".cache", "ms-playwright"));
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return roots;
}

function collectPlaywrightCacheRoots() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const roots = [
    join(homedir(), ".cache", "ms-playwright"),
    ...collectAncestorCacheRoots(process.cwd()),
    ...collectAncestorCacheRoots(scriptDir),
  ];

  return roots.filter((root, index) => roots.indexOf(root) === index);
}

async function listChromiumExecutables() {
  const candidates = [];

  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    candidates.push(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  }

  if (process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    candidates.push(process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  }

  for (const cacheRoot of collectPlaywrightCacheRoots()) {
    if (!(await pathExists(cacheRoot))) {
      continue;
    }

    const entries = await readdir(cacheRoot, { withFileTypes: true });
    const chromiumRoots = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium-"))
      .map((entry) => join(cacheRoot, entry.name, "chrome-linux64", "chrome"))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    for (const candidate of chromiumRoots) {
      candidates.push(candidate);
    }
  }

  const seen = new Set();
  const deduped = candidates.filter((candidate) => {
    if (seen.has(candidate)) {
      return false;
    }

    seen.add(candidate);
    return true;
  });

  const existing = [];
  for (const candidate of deduped) {
    if (await pathExists(candidate)) {
      existing.push(candidate);
    }
  }

  return existing.reverse();
}

async function resolveGlibcRoot(chromeExecutablePath) {
  const { stdout } = await execFileAsync(
    "env",
    ["-u", "LD_LIBRARY_PATH", "ldd", chromeExecutablePath],
  );

  const ldLinuxMatch = stdout.match(
    /(\/nix\/store\/[^/\n]+-glibc-[^/\n]+)\/lib64\/ld-linux-x86-64\.so\.2/,
  );

  if (ldLinuxMatch?.[1]) {
    return ldLinuxMatch[1];
  }

  const libcMatch = stdout.match(
    /(\/nix\/store\/[^/\n]+-glibc-[^/\n]+)\/lib\/libc\.so\.6/,
  );

  if (libcMatch?.[1]) {
    return libcMatch[1];
  }

  throw new Error(
    `Unable to resolve a compatible glibc root for Chromium at ${chromeExecutablePath}.`,
  );
}

async function resolveNixLibraryPath() {
  const { stdout } = await execFileAsync("nix", [
    "eval",
    "--impure",
    "--raw",
    "--expr",
    NIX_LIB_EXPR,
  ]);

  const libraryPath = trimOutput(stdout);

  if (!libraryPath) {
    throw new Error("Failed to resolve the Nix Chromium library path.");
  }

  return libraryPath;
}

async function patchChromiumCopy(sourceExecutablePath, glibcRoot, libraryPath) {
  const sourceBrowserDir = dirname(sourceExecutablePath);
  const glibcInterpreter = join(glibcRoot, "lib64", "ld-linux-x86-64.so.2");
  const rpath = [
    "$ORIGIN",
    "$ORIGIN/lib",
    "$ORIGIN/lib.target",
    join(glibcRoot, "lib"),
    join(glibcRoot, "lib64"),
    libraryPath,
  ].join(":");
  const cacheKey = createHash("sha1")
    .update(sourceExecutablePath)
    .update(glibcRoot)
    .update(libraryPath)
    .digest("hex")
    .slice(0, 12);
  const targetRoot = join(
    REPLIT_PATCH_CACHE_ROOT,
    `${basename(sourceBrowserDir)}-${cacheKey}`,
  );
  const targetExecutable = join(targetRoot, "chrome");

  if (!(await pathExists(targetExecutable))) {
    await mkdir(REPLIT_PATCH_CACHE_ROOT, { recursive: true });
    await cp(sourceBrowserDir, targetRoot, { recursive: true });

    for (const binaryName of ["chrome", "chrome_crashpad_handler"]) {
      await execFileAsync("patchelf", [
        "--set-interpreter",
        glibcInterpreter,
        "--set-rpath",
        rpath,
        join(targetRoot, binaryName),
      ]);
    }
  }

  return targetExecutable;
}

export async function ensurePatchedPlaywrightChromium() {
  const sourceExecutables = await listChromiumExecutables();

  if (sourceExecutables.length === 0) {
    throw new Error(
      "Unable to locate a Playwright Chromium executable. Run `pnpm exec playwright install chromium` first.",
    );
  }

  const libraryPath = await resolveNixLibraryPath();
  const failures = [];

  for (const sourceExecutablePath of sourceExecutables) {
    try {
      const glibcRoot = await resolveGlibcRoot(sourceExecutablePath);
      return await patchChromiumCopy(sourceExecutablePath, glibcRoot, libraryPath);
    } catch (error) {
      failures.push(
        `${sourceExecutablePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Unable to prepare a patched Playwright Chromium executable.\n${failures.join("\n")}`,
  );
}

const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const executablePath = await ensurePatchedPlaywrightChromium();
  process.stdout.write(`${executablePath}\n`);
}
