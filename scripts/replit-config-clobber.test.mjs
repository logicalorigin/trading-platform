import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { detectReplitConfigClobber } from "./replit-config-clobber.mjs";

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
