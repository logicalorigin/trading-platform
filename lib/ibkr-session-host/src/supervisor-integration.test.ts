import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supervisorPath = path.resolve(
  packageDir,
  "../../artifacts/pyrus/scripts/runDevApp.mjs",
);

test("the live PYRUS supervisor owns the enabled IBKR session host", async () => {
  const source = await readFile(supervisorPath, "utf8");

  assert.match(source, /let ibkrHostChild = null/);
  assert.match(source, /IBKR_SESSION_HOST_ENABLED.*=== "1"/);
  assert.match(
    source,
    /spawnService\([\s\S]*?"IBKR session host"[\s\S]*?"@workspace\/ibkr-session-host"[\s\S]*?"dev"/,
  );
  assert.match(source, /watchFatalExit\("IBKR session host", ibkrHostExit\)/);
});
