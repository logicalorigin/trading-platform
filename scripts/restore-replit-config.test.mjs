import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseRestoreArgs, runRestore } from "./restore-replit-config.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const canonicalSources = {
  ".replit": readFileSync(
    path.join(workspaceRoot, "scripts/replit-config/dot-replit"),
    "utf8",
  ),
  "replit.nix": readFileSync(
    path.join(workspaceRoot, "scripts/replit-config/replit.nix"),
    "utf8",
  ),
};

function makeRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "restore-replit-config-"));
  const canonicalDir = path.join(repoRoot, "scripts/replit-config");
  mkdirSync(canonicalDir, { recursive: true });
  writeFileSync(
    path.join(canonicalDir, "dot-replit"),
    canonicalSources[".replit"],
  );
  writeFileSync(
    path.join(canonicalDir, "replit.nix"),
    canonicalSources["replit.nix"],
  );
  for (const [name, contents] of Object.entries(canonicalSources)) {
    writeFileSync(path.join(repoRoot, name), contents);
    chmodSync(path.join(repoRoot, name), 0o644);
  }
  return repoRoot;
}

function mode(file) {
  return lstatSync(file).mode & 0o777;
}

function capture() {
  const lines = [];
  return {
    lines,
    writeLine: (line) => lines.push(["out", line]),
    warn: (line) => lines.push(["warn", line]),
    error: (line) => lines.push(["error", line]),
  };
}

test("restore-replit-config accepts only diff or explicit write mode", () => {
  assert.deepEqual(parseRestoreArgs([]), { write: false });
  assert.deepEqual(parseRestoreArgs(["--write"]), { write: true });
  assert.throws(() => parseRestoreArgs(["--write", "extra"]), /Usage/);
  assert.throws(() => parseRestoreArgs(["extra"]), /Usage/);
});

test("restore-replit-config rejects live symlinks without touching their targets", () => {
  const repoRoot = makeRepo();
  const external = path.join(repoRoot, "external");
  try {
    writeFileSync(external, "do not touch");
    rmSync(path.join(repoRoot, ".replit"));
    symlinkSync(external, path.join(repoRoot, ".replit"));
    const output = capture();

    assert.equal(runRestore({ repoRoot, write: true, ...output }), 1);
    assert.equal(readFileSync(external, "utf8"), "do not touch");
    assert.equal(mode(external), 0o644);
    assert.match(output.lines.flat().join("\n"), /regular file/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rejects canonical symlinks before mutation", () => {
  const repoRoot = makeRepo();
  const external = path.join(repoRoot, "external-canonical");
  try {
    writeFileSync(external, canonicalSources[".replit"]);
    const canonical = path.join(repoRoot, "scripts/replit-config/dot-replit");
    rmSync(canonical);
    symlinkSync(external, canonical);
    const output = capture();

    assert.equal(runRestore({ repoRoot, write: true, ...output }), 1);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      canonicalSources[".replit"],
    );
    assert.equal(mode(path.join(repoRoot, ".replit")), 0o644);
    assert.equal(readFileSync(external, "utf8"), canonicalSources[".replit"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config validates canonical sources before mutation", () => {
  const repoRoot = makeRepo();
  try {
    const invalid = "modules = []\n";
    writeFileSync(
      path.join(repoRoot, "scripts/replit-config/dot-replit"),
      invalid,
    );
    writeFileSync(path.join(repoRoot, ".replit"), invalid);
    const output = capture();

    assert.equal(runRestore({ repoRoot, write: true, ...output }), 1);
    assert.equal(readFileSync(path.join(repoRoot, ".replit"), "utf8"), invalid);
    assert.equal(mode(path.join(repoRoot, ".replit")), 0o644);
    assert.match(output.lines.flat().join("\n"), /canonical.*invalid/i);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rejects canonical config missing startup contracts", () => {
  const repoRoot = makeRepo();
  try {
    const canonicalPath = path.join(
      repoRoot,
      "scripts/replit-config/dot-replit",
    );
    const withoutAgent = canonicalSources[".replit"].replace(
      /\n\[agent\]\n(?:.*\n)+?\n\[postMerge\]/,
      "\n[postMerge]",
    );
    assert.notEqual(withoutAgent, canonicalSources[".replit"]);
    writeFileSync(canonicalPath, withoutAgent);
    const output = capture();

    assert.equal(runRestore({ repoRoot, write: true, ...output }), 1);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      canonicalSources[".replit"],
    );
    assert.equal(mode(path.join(repoRoot, ".replit")), 0o644);
    assert.match(output.lines.flat().join("\n"), /\[agent\].*PNPM_WORKSPACE/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rejects malformed canonical Nix before mutation", () => {
  const repoRoot = makeRepo();
  try {
    writeFileSync(
      path.join(repoRoot, "scripts/replit-config/replit.nix"),
      "{ pkgs }: { deps = [\n",
    );
    const output = capture();

    assert.equal(runRestore({ repoRoot, write: true, ...output }), 1);
    assert.equal(
      readFileSync(path.join(repoRoot, "replit.nix"), "utf8"),
      canonicalSources["replit.nix"],
    );
    assert.equal(mode(path.join(repoRoot, "replit.nix")), 0o644);
    assert.match(output.lines.flat().join("\n"), /replit\.nix.*Nix syntax/i);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rejects invalid canonical UTF-8 before mutation", () => {
  const repoRoot = makeRepo();
  try {
    writeFileSync(
      path.join(repoRoot, "scripts/replit-config/dot-replit"),
      Buffer.from([0xc3, 0x28]),
    );
    const output = capture();

    assert.equal(runRestore({ repoRoot, write: true, ...output }), 1);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      canonicalSources[".replit"],
    );
    assert.match(output.lines.flat().join("\n"), /not valid UTF-8/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config locks matching writable files in explicit write mode", () => {
  const repoRoot = makeRepo();
  try {
    const output = capture();
    assert.equal(runRestore({ repoRoot, write: true, ...output }), 0);
    assert.equal(mode(path.join(repoRoot, ".replit")), 0o444);
    assert.equal(mode(path.join(repoRoot, "replit.nix")), 0o444);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config stages every target before changing live files", () => {
  const repoRoot = makeRepo();
  try {
    writeFileSync(path.join(repoRoot, ".replit"), "old replit");
    writeFileSync(path.join(repoRoot, "replit.nix"), "old nix");
    const output = capture();
    const injected = Object.assign(new Error("staging disk full"), {
      code: "ENOSPC",
    });

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          openSync(file, ...args) {
            if (file.includes(".replit.nix.restore-")) throw injected;
            return openSync(file, ...args);
          },
        },
      }),
      1,
    );
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      "old replit",
    );
    assert.equal(
      readFileSync(path.join(repoRoot, "replit.nix"), "utf8"),
      "old nix",
    );
    const rendered = output.lines.flat().join("\n");
    assert.match(rendered, /ENOSPC|staging disk full/);
    assert.doesNotMatch(rendered, /blocked in this shell context/);
    assert.equal(
      readdirSync(repoRoot).some((entry) => entry.includes(".restore-")),
      false,
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config aborts if canonical config changes during staging", () => {
  const repoRoot = makeRepo();
  try {
    const canonicalReplit = path.join(
      repoRoot,
      "scripts/replit-config/dot-replit",
    );
    let mutated = false;
    const output = capture();

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          openSync(file, ...args) {
            if (!mutated && file.includes(".replit.nix.restore-")) {
              writeFileSync(
                canonicalReplit,
                `${canonicalSources[".replit"]}\n# concurrent change\n`,
              );
              mutated = true;
            }
            return openSync(file, ...args);
          },
        },
      }),
      1,
    );
    assert.equal(mutated, true);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      canonicalSources[".replit"],
    );
    assert.equal(
      readFileSync(path.join(repoRoot, "replit.nix"), "utf8"),
      canonicalSources["replit.nix"],
    );
    assert.match(output.lines.flat().join("\n"), /changed after preflight/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config never follows a replaced stage path", () => {
  const repoRoot = makeRepo();
  const external = path.join(repoRoot, "external-stage-target");
  try {
    writeFileSync(external, "external contents");
    chmodSync(external, 0o640);
    const output = capture();

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          writeFileSync(file, ...args) {
            const result = writeFileSync(file, ...args);
            if (typeof file === "string" && file.includes(".restore-")) {
              rmSync(file);
              symlinkSync(external, file);
            }
            return result;
          },
          fchmodSync(descriptor, requestedMode) {
            const result = fchmodSync(descriptor, requestedMode);
            const staged = readdirSync(repoRoot).find((entry) =>
              entry.includes(".restore-"),
            );
            if (staged) {
              const stagedPath = path.join(repoRoot, staged);
              rmSync(stagedPath);
              symlinkSync(external, stagedPath);
            }
            return result;
          },
        },
      }),
      1,
    );
    assert.equal(readFileSync(external, "utf8"), "external contents");
    assert.equal(mode(external), 0o640);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      canonicalSources[".replit"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config revalidates staged identity before publication", () => {
  const repoRoot = makeRepo();
  try {
    const liveReplit = path.join(repoRoot, ".replit");
    let liveReplitOpens = 0;
    let badPublications = 0;
    const output = capture();

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          openSync(file, ...args) {
            const descriptor = openSync(file, ...args);
            if (file === liveReplit && ++liveReplitOpens === 3) {
              const staged = readdirSync(repoRoot).find((entry) =>
                entry.startsWith(".replit.restore-"),
              );
              assert.ok(staged);
              const stagedPath = path.join(repoRoot, staged);
              rmSync(stagedPath);
              writeFileSync(stagedPath, "replaced stage", { mode: 0o444 });
            }
            return descriptor;
          },
          renameSync(source, destination) {
            if (
              destination === liveReplit &&
              readFileSync(source, "utf8") === "replaced stage"
            ) {
              badPublications += 1;
            }
            return renameSync(source, destination);
          },
        },
      }),
      1,
    );
    assert.equal(badPublications, 0);
    assert.equal(readFileSync(liveReplit, "utf8"), canonicalSources[".replit"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config identifies permission failures without unsafe fallbacks", () => {
  const repoRoot = makeRepo();
  try {
    const output = capture();
    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          openSync(file, ...args) {
            if (file.includes(".restore-")) {
              throw Object.assign(new Error("permission denied"), {
                code: "EACCES",
              });
            }
            return openSync(file, ...args);
          },
        },
      }),
      1,
    );
    const rendered = output.lines.flat().join("\n");
    assert.match(rendered, /EACCES/);
    assert.match(rendered, /may block startup-config writes/);
    assert.doesNotMatch(rendered, /chmod 644|cp scripts\/replit-config/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rolls back the first publication if the second fails", () => {
  const repoRoot = makeRepo();
  try {
    writeFileSync(path.join(repoRoot, ".replit"), "old replit");
    writeFileSync(path.join(repoRoot, "replit.nix"), "old nix");
    chmodSync(path.join(repoRoot, ".replit"), 0o640);
    chmodSync(path.join(repoRoot, "replit.nix"), 0o600);
    const output = capture();
    const publications = [];

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          renameSync(source, destination) {
            if (
              source.includes(".restore-") &&
              destination.endsWith(".replit")
            ) {
              throw Object.assign(new Error("injected rename failure"), {
                code: "EIO",
              });
            }
            if (source.includes(".restore-")) publications.push(destination);
            return renameSync(source, destination);
          },
        },
      }),
      1,
    );
    assert.deepEqual(publications, [path.join(repoRoot, "replit.nix")]);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      "old replit",
    );
    assert.equal(
      readFileSync(path.join(repoRoot, "replit.nix"), "utf8"),
      "old nix",
    );
    assert.equal(mode(path.join(repoRoot, ".replit")), 0o640);
    assert.equal(mode(path.join(repoRoot, "replit.nix")), 0o600);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rolls back both targets after final verification fails", () => {
  const repoRoot = makeRepo();
  try {
    const liveReplit = path.join(repoRoot, ".replit");
    writeFileSync(liveReplit, "old replit");
    writeFileSync(path.join(repoRoot, "replit.nix"), "old nix");
    chmodSync(liveReplit, 0o640);
    chmodSync(path.join(repoRoot, "replit.nix"), 0o600);
    let liveReplitOpens = 0;
    const output = capture();

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          openSync(file, ...args) {
            if (file === liveReplit && ++liveReplitOpens === 4) {
              writeFileSync(file, "corrupted after publication");
            }
            return openSync(file, ...args);
          },
        },
      }),
      1,
    );
    assert.equal(readFileSync(liveReplit, "utf8"), "old replit");
    assert.equal(
      readFileSync(path.join(repoRoot, "replit.nix"), "utf8"),
      "old nix",
    );
    assert.equal(mode(liveReplit), 0o640);
    assert.equal(mode(path.join(repoRoot, "replit.nix")), 0o600);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config reports rollback failure prominently", () => {
  const repoRoot = makeRepo();
  try {
    writeFileSync(path.join(repoRoot, ".replit"), "old replit");
    writeFileSync(path.join(repoRoot, "replit.nix"), "old nix");
    const output = capture();

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          renameSync(source, destination) {
            if (source.includes(".rollback-")) {
              throw new Error("injected rollback failure");
            }
            if (
              source.includes(".restore-") &&
              destination.endsWith(".replit")
            ) {
              throw new Error("injected second publication failure");
            }
            return renameSync(source, destination);
          },
        },
      }),
      1,
    );
    assert.match(output.lines.flat().join("\n"), /ROLLBACK FAILED/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("restore-replit-config rolls a newly created first target back to missing", () => {
  const repoRoot = makeRepo();
  try {
    writeFileSync(path.join(repoRoot, ".replit"), "old replit");
    rmSync(path.join(repoRoot, "replit.nix"));
    const output = capture();

    assert.equal(
      runRestore({
        repoRoot,
        write: true,
        ...output,
        ops: {
          renameSync(source, destination) {
            if (
              source.includes(".restore-") &&
              destination.endsWith(".replit")
            ) {
              throw new Error("injected second publication failure");
            }
            return renameSync(source, destination);
          },
        },
      }),
      1,
    );
    assert.equal(existsSync(path.join(repoRoot, "replit.nix")), false);
    assert.equal(
      readFileSync(path.join(repoRoot, ".replit"), "utf8"),
      "old replit",
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
