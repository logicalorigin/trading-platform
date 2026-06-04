import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import { runBackendSettingsAction } from "./backend-settings";

const OVERRIDE_FILE_ENV = "PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE";

async function withIsolatedIbkrRuntimeOverride<T>(
  task: () => Promise<T>,
): Promise<T> {
  const previousOverrideFile = process.env[OVERRIDE_FILE_ENV];
  const dir = mkdtempSync(join(tmpdir(), "pyrus-backend-settings-test-"));
  process.env[OVERRIDE_FILE_ENV] = join(dir, "ibkr-runtime.json");
  clearIbkrBridgeRuntimeOverride();

  try {
    return await task();
  } finally {
    clearIbkrBridgeRuntimeOverride();
    rmSync(dir, { recursive: true, force: true });
    if (previousOverrideFile === undefined) {
      delete process.env[OVERRIDE_FILE_ENV];
    } else {
      process.env[OVERRIDE_FILE_ENV] = previousOverrideFile;
    }
    clearIbkrBridgeRuntimeOverride({ deletePersisted: false });
  }
}

test("IBKR bridge override clear returns without the full backend settings snapshot", async () => {
  await withIsolatedIbkrRuntimeOverride(async () => {
    setIbkrBridgeRuntimeOverride(
      {
        apiToken: "test-token",
        baseUrl: "https://bridge.example.test",
      },
      {
        bridgeId: "activation-test",
        managementTokenHash: "management-token-hash",
      },
    );

    const result = (await runBackendSettingsAction("ibkr.bridgeOverride.clear", {
      force: true,
    })) as {
      cleared: boolean;
      previous: {
        baseUrl: string;
        tokenConfigured: boolean;
      };
      runtimeOverrideActive: boolean;
    };

    assert.equal(result.runtimeOverrideActive, false);
    assert.equal(result.cleared, true);
    assert.equal(result.previous.baseUrl, "https://bridge.example.test");
    assert.equal(result.previous.tokenConfigured, true);
    assert.equal("snapshot" in result, false);
    assert.equal(getIbkrBridgeRuntimeOverride(), null);
  });
});

test("IBKR bridge override clear no-op also returns without the full backend settings snapshot", async () => {
  await withIsolatedIbkrRuntimeOverride(async () => {
    const result = (await runBackendSettingsAction("ibkr.bridgeOverride.clear", {
      force: true,
    })) as {
      cleared: boolean;
      reason: string;
      runtimeOverrideActive: boolean;
    };

    assert.equal(result.runtimeOverrideActive, false);
    assert.equal(result.cleared, false);
    assert.equal(result.reason, "no_override");
    assert.equal("snapshot" in result, false);
  });
});
