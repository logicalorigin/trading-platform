import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  detectReplitConfigClobber,
  validatePyrusArtifactConfig,
} from "./replit-config-clobber.mjs";

const canonicalArtifact = readFileSync(
  new URL("./replit-config/pyrus-artifact.toml", import.meta.url),
  "utf8",
);

test("validates the artifact structurally instead of accepting matching text", () => {
  assert.deepEqual(validatePyrusArtifactConfig(canonicalArtifact), []);
  const wrongSection = canonicalArtifact.replace(
    "[services.production.run]\n",
    "[services.production.wrong]\n",
  );
  assert.ok(
    validatePyrusArtifactConfig(wrongSection).some((problem) =>
      problem.includes("production run args"),
    ),
  );
  assert.ok(
    validatePyrusArtifactConfig(`${canonicalArtifact}\nnot valid toml`).some(
      (problem) => problem.includes("invalid TOML"),
    ),
  );
});

test("does not accept Replit settings from the wrong TOML table", () => {
  const root = mkdtempSync(path.join(tmpdir(), "replit-clobber-"));
  try {
    writeFileSync(path.join(root, "replit.nix"), "{}\n");
    writeFileSync(
      path.join(root, ".replit"),
      `modules = ["postgresql-16"]

[other]
channel = "stable-25_05"

[workflows]
runButton = "artifacts/pyrus: web"

[[ports]]
localPort = 8080
externalPort = 8080

[[ports]]
localPort = 18747
externalPort = 3000
`,
    );

    assert.ok(
      detectReplitConfigClobber(root).some((problem) =>
        problem.includes("[nix] channel"),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not disguise unreadable config paths as recovery clobber", () => {
  const root = mkdtempSync(path.join(tmpdir(), "replit-clobber-"));
  try {
    mkdirSync(path.join(root, ".replit"));
    writeFileSync(path.join(root, "replit.nix"), "{}\n");

    assert.throws(
      () => detectReplitConfigClobber(root),
      (error) => error?.code === "EISDIR",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
