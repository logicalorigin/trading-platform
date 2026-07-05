import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  markIbkrBridgeRuntimeStopRequested,
  setIbkrBridgeRuntimeOverride,
} from "./runtime";

const testDataDir = mkdtempSync(join(tmpdir(), "pyrus-override-intent-"));
const overrideFile = join(testDataDir, "ibkr-bridge-runtime-override.json");
const previousOverrideFile =
  process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = overrideFile;

// Drop ONLY the in-memory cache (keep the file) so the next read re-loads from disk.
// This is what exercises the persistence round-trip that the restart-survival
// guarantee depends on — an in-memory-only assertion would pass even if the field
// never reached disk.
const forceDiskReread = () =>
  clearIbkrBridgeRuntimeOverride({ deletePersisted: false });

beforeEach(() => {
  clearIbkrBridgeRuntimeOverride();
});

after(() => {
  clearIbkrBridgeRuntimeOverride();
  if (previousOverrideFile) {
    process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = previousOverrideFile;
  } else {
    delete process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
  }
  rmSync(testDataDir, { recursive: true, force: true });
});

test("attach writes stopRequestedAt=null; the field is omitted-as-null and survives a disk re-read", () => {
  const attached = setIbkrBridgeRuntimeOverride(
    { baseUrl: "https://bridge.example", apiToken: "tok" },
    { bridgeId: "b-1" },
  );
  assert.equal(attached.stopRequestedAt, null);

  forceDiskReread();
  const reread = getIbkrBridgeRuntimeOverride();
  assert.equal(reread?.stopRequestedAt, null);
  assert.equal(reread?.bridgeId, "b-1");
});

test("markIbkrBridgeRuntimeStopRequested persists the intent and it SURVIVES a disk re-read (restart survival)", () => {
  setIbkrBridgeRuntimeOverride(
    { baseUrl: "https://bridge.example", apiToken: "tok" },
    { bridgeId: "b-1" },
  );

  const marked = markIbkrBridgeRuntimeStopRequested(1_700_000_000_000);
  assert.equal(marked?.stopRequestedAt, 1_700_000_000_000);

  // The actual file must carry the field, and version must be bumped.
  const onDisk = JSON.parse(readFileSync(overrideFile, "utf8"));
  assert.equal(onDisk.stopRequestedAt, 1_700_000_000_000);
  assert.equal(onDisk.version, 2);

  // Simulate an api-server restart: in-memory state gone, file remains.
  forceDiskReread();
  const reread = getIbkrBridgeRuntimeOverride();
  assert.equal(
    reread?.stopRequestedAt,
    1_700_000_000_000,
    "stopRequestedAt must survive the disk round-trip or restart can revive an intentionally-stopped bridge",
  );
});

test("a fresh attach (re-connect) clears stopRequestedAt, and the cleared state survives a disk re-read", () => {
  setIbkrBridgeRuntimeOverride(
    { baseUrl: "https://bridge.example", apiToken: "tok" },
    { bridgeId: "b-1" },
  );
  markIbkrBridgeRuntimeStopRequested(1_700_000_000_000);
  forceDiskReread();
  assert.equal(getIbkrBridgeRuntimeOverride()?.stopRequestedAt, 1_700_000_000_000);

  // User reconnects -> a fresh override is written without the intent marker.
  setIbkrBridgeRuntimeOverride(
    { baseUrl: "https://bridge2.example", apiToken: "tok2" },
    { bridgeId: "b-2" },
  );
  forceDiskReread();
  const reread = getIbkrBridgeRuntimeOverride();
  assert.equal(reread?.stopRequestedAt, null);
  assert.equal(reread?.bridgeId, "b-2");
});

test("markIbkrBridgeRuntimeStopRequested is a no-op when no override exists (Detach already deleted the file)", () => {
  assert.equal(getIbkrBridgeRuntimeOverride(), null);
  assert.equal(markIbkrBridgeRuntimeStopRequested(1_700_000_000_000), null);
  assert.equal(getIbkrBridgeRuntimeOverride(), null);
});

test("a legacy version-1 file (no stopRequestedAt) reads as not-stopped", () => {
  writeFileSync(
    overrideFile,
    JSON.stringify({
      version: 1,
      baseUrl: "https://legacy.example",
      apiToken: "tok",
      bridgeId: "b-legacy",
      managementTokenHash: "h",
      updatedAt: new Date(1_699_000_000_000).toISOString(),
    }),
    { mode: 0o600 },
  );
  forceDiskReread();
  const reread = getIbkrBridgeRuntimeOverride();
  assert.equal(reread?.baseUrl, "https://legacy.example");
  assert.equal(reread?.stopRequestedAt, null);
});
