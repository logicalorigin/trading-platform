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
const sessionHostEntryPath = path.join(packageDir, "src", "index.ts");

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

test("the session host owns the bounded host-scoped loopback relay fleet", async () => {
  const source = await readFile(sessionHostEntryPath, "utf8");

  assert.match(
    source,
    /new CapsuleFleetManager\(\s*config\.capacity/,
  );
  assert.match(
    source,
    /createCapsuleRelayServer\(\(\) =>\s*fleet\.getRelayTarget\(slotNumber, kind\)/,
  );
  assert.match(
    source,
    /capsuleTargetForSlot\(slotNumber, kind\)\.port/,
  );
  assert.match(source, /Array\.from\(\{ length: config\.capacity \}/);
});

test("the session host owns registration and heartbeat lifecycle", async () => {
  const source = await readFile(sessionHostEntryPath, "utf8");

  assert.match(source, /loadIbkrHostLifecycleConfig/);
  assert.match(source, /createIbkrHostLifecycleClient/);
  assert.match(source, /lifecycle\?\.start\(\)/);
  assert.match(source, /lifecycle\?\.stop\(\)/);
  assert.ok(
    source.indexOf("lifecycle?.start()") > source.indexOf("await Promise.all"),
  );
});
