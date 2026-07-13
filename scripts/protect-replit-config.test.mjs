import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROTECTED_FILES,
  parseAction,
  runConfigProtection,
} from "./protect-replit-config.mjs";

function makeRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "protect-replit-config-"));
  for (const relPath of PROTECTED_FILES) {
    const fullPath = path.join(repoRoot, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, relPath);
    chmodSync(fullPath, 0o644);
  }
  return repoRoot;
}

function mode(repoRoot, relPath) {
  return lstatSync(path.join(repoRoot, relPath)).mode & 0o777;
}

test("protect-replit-config rejects extra or unknown arguments", () => {
  assert.equal(parseAction([]), "status");
  assert.equal(parseAction(["lock"]), "lock");
  assert.throws(() => parseAction(["lock", "typo"]), /Usage/);
  assert.throws(() => parseAction(["typo"]), /Usage/);
});

test("protect-replit-config changes every regular target and reports advisory scope", () => {
  const repoRoot = makeRepo();
  const output = [];
  try {
    runConfigProtection({
      action: "lock",
      repoRoot,
      writeLine: (line) => output.push(line),
    });
    assert.deepEqual(
      PROTECTED_FILES.map((relPath) => mode(repoRoot, relPath)),
      [0o444, 0o444, 0o444],
    );
    assert.match(output.join("\n"), /write bits clear/);
    assert.match(output.join("\n"), /ordinary in-session writes only/);
    assert.match(output.join("\n"), /audit:replit-startup/);
    assert.match(output.join("\n"), /replit:config:restore/);

    runConfigProtection({ action: "unlock", repoRoot, writeLine() {} });
    assert.deepEqual(
      PROTECTED_FILES.map((relPath) => mode(repoRoot, relPath)),
      [0o644, 0o644, 0o644],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("protect-replit-config preflights every target before changing modes", () => {
  const repoRoot = makeRepo();
  try {
    rmSync(path.join(repoRoot, PROTECTED_FILES[1]));
    assert.throws(
      () => runConfigProtection({ action: "lock", repoRoot, writeLine() {} }),
      /regular file/,
    );
    assert.equal(mode(repoRoot, PROTECTED_FILES[0]), 0o644);
    assert.equal(mode(repoRoot, PROTECTED_FILES[2]), 0o644);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("protect-replit-config rejects symlinks without changing their targets", () => {
  const repoRoot = makeRepo();
  const target = path.join(repoRoot, "redirect-target");
  try {
    writeFileSync(target, "target");
    chmodSync(target, 0o644);
    rmSync(path.join(repoRoot, PROTECTED_FILES[1]));
    symlinkSync(target, path.join(repoRoot, PROTECTED_FILES[1]));

    assert.throws(
      () => runConfigProtection({ action: "lock", repoRoot, writeLine() {} }),
      /regular file/,
    );
    assert.equal(mode(repoRoot, PROTECTED_FILES[0]), 0o644);
    assert.equal(lstatSync(target).mode & 0o777, 0o644);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("protect-replit-config rolls back earlier targets after a chmod failure", () => {
  const repoRoot = makeRepo();
  let failed = false;
  try {
    assert.throws(
      () =>
        runConfigProtection({
          action: "lock",
          repoRoot,
          writeLine() {},
          changeMode(fullPath, nextMode) {
            if (!failed && fullPath.endsWith(PROTECTED_FILES[1])) {
              failed = true;
              throw new Error("injected chmod failure");
            }
            chmodSync(fullPath, nextMode);
          },
        }),
      /injected chmod failure/,
    );
    assert.deepEqual(
      PROTECTED_FILES.map((relPath) => mode(repoRoot, relPath)),
      [0o644, 0o644, 0o644],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
