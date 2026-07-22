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

  assert.match(source, /const children = new Set\(\)/);
  assert.match(source, /children\.add\(entry\)/);
  assert.match(
    source,
    /ibkr: \{[\s\S]*?packageName: "@workspace\/ibkr-session-host"[\s\S]*?generatedEntry: path\.join\(ibkrDir, "dist", "index\.mjs"\)/,
  );
  assert.match(
    source,
    /if \(runtimeEnv\.IBKR_SESSION_HOST_ENABLED === "1"\) \{[\s\S]*?startAuditedRole\(\{[\s\S]*?name: "IBKR session host"[\s\S]*?role: "ibkr"[\s\S]*?build: true[\s\S]*?args: \["--enable-source-maps", ROLE_SPECS\.ibkr\.generatedEntry\]/,
  );
  assert.match(source, /const owned = \[\.\.\.children\]/);
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
