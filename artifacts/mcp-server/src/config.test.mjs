import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.ts";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(sourceDir, "..");
const repoRoot = path.resolve(packageDir, "../..");

test("default flight-recorder path is stable when MCP launches from its package", () => {
  assert.equal(process.cwd(), packageDir);
  assert.equal(
    config.flightRecorderDir,
    path.join(repoRoot, ".pyrus-runtime", "flight-recorder"),
  );
});
