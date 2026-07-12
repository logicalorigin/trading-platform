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

test("the session host owns both fixed loopback capsule relays", async () => {
  const source = await readFile(sessionHostEntryPath, "utf8");

  assert.match(
    source,
    /createCapsuleRelayServer\(\(\) =>\s*manager\.getRelayTarget\("cpg"\)\)/,
  );
  assert.match(
    source,
    /createCapsuleRelayServer\(\(\) =>\s*manager\.getRelayTarget\("console"\)\)/,
  );
  assert.match(source, /listenCapsuleRelay\(cpgRelay, 15000\)/);
  assert.match(source, /listenCapsuleRelay\(consoleRelay, 16080\)/);
});
