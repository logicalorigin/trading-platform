import assert from "node:assert/strict";
import test from "node:test";
import {
  PYRUS_ENTRY_MODULE_VERSION,
  buildPyrusRuntimeFingerprint,
} from "./runtimeDiagnostics";

test("runtime diagnostics expose a stable app entry module fingerprint", () => {
  const fingerprint = buildPyrusRuntimeFingerprint();

  assert.equal(
    PYRUS_ENTRY_MODULE_VERSION,
    "app-entry-20260522-pyrus-runtime-fingerprint-v1",
  );
  assert.equal(fingerprint.packageName, "@workspace/pyrus");
  assert.equal(fingerprint.viteConfigPath, "artifacts/rayalgo/vite.config.ts");
  assert.equal(fingerprint.entryModuleVersion, PYRUS_ENTRY_MODULE_VERSION);
  assert.match(fingerprint.loadedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(fingerprint.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(["vite-dev", "built-dist", "node-test"].includes(fingerprint.buildMode));
});
