import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearIbkrBridgeRuntimeOverride,
  getIgnoredIbkrBridgeRuntimeEnvNames,
  getIbkrBridgeProviderRuntimeConfig,
  getIbkrBridgeRuntimeConfig,
  getIbkrBridgeRuntimeOverride,
  getIbkrTwsRuntimeConfig,
  getProviderConfiguration,
  setIbkrBridgeRuntimeOverride,
} from "./runtime";

const ENV_KEYS = [
  "IBKR_TRANSPORT",
  "IBKR_BASE_URL",
  "IBKR_API_BASE_URL",
  "IB_GATEWAY_URL",
  "IBKR_GATEWAY_URL",
  "IBKR_TWS_HOST",
  "IBKR_TWS_PORT",
  "IBKR_TWS_CLIENT_ID",
  "IBKR_TWS_MODE",
  "IBKR_TWS_MARKET_DATA_TYPE",
  "IBKR_BRIDGE_URL",
  "IBKR_BRIDGE_BASE_URL",
  "IBKR_BRIDGE_API_TOKEN",
  "IBKR_BRIDGE_TOKEN",
  "IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
  "TRADING_MODE",
] as const;

function withRuntimeEnv<T>(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  task: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
  }

  const isolatedOverrideDir = mkdtempSync(
    join(tmpdir(), "rayalgo-runtime-env-test-"),
  );
  const isolatedOverrideFile = join(isolatedOverrideDir, "runtime.json");
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = isolatedOverrideFile;
  clearIbkrBridgeRuntimeOverride();

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] =
    values["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] ?? isolatedOverrideFile;

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  try {
    return task();
  } finally {
    clearIbkrBridgeRuntimeOverride();
    rmSync(isolatedOverrideDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("IBKR provider runtime ignores Client Portal configuration", () => {
  withRuntimeEnv(
    {
      IBKR_TRANSPORT: "client_portal",
      IBKR_BASE_URL: "https://localhost:5000/v1/api",
    },
    () => {
      assert.equal(getIbkrBridgeProviderRuntimeConfig(), null);
    },
  );
});

test("legacy IBKR Client Portal environment variables do not configure bridge runtime", () => {
  withRuntimeEnv(
    {
      IBKR_TRANSPORT: "tws",
      IBKR_BASE_URL: "https://localhost:5000/v1/api",
      IBKR_API_BASE_URL: "https://localhost:5000/v1/api",
      IB_GATEWAY_URL: "https://localhost:5000",
      IBKR_GATEWAY_URL: "https://localhost:5000",
    },
    () => {
      assert.equal(getIbkrBridgeRuntimeConfig(), null);
      assert.equal(getProviderConfiguration().ibkr, false);
    },
  );
});

test("IBKR provider runtime requires explicit TWS transport", () => {
  withRuntimeEnv(
    {
      IBKR_TWS_HOST: "127.0.0.1",
      IBKR_TWS_PORT: "4001",
    },
    () => {
      assert.equal(getIbkrTwsRuntimeConfig(), null);
      assert.equal(getIbkrBridgeProviderRuntimeConfig(), null);
    },
  );
});

test("IBKR TWS runtime defaults to live Gateway settings", () => {
  withRuntimeEnv({ IBKR_TRANSPORT: "tws" }, () => {
    const config = getIbkrTwsRuntimeConfig();
    assert.ok(config);
    assert.equal(config.mode, "live");
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 4001);
    assert.equal(config.clientId, 101);

    assert.deepEqual(getIbkrBridgeProviderRuntimeConfig(), {
      transport: "tws",
      config,
    });
  });
});

test("IBKR bridge runtime is absent without environment or override", () => {
  withRuntimeEnv({}, () => {
    assert.equal(getIbkrBridgeRuntimeConfig(), null);
  });
});

test("provider configuration reports IBKR only when bridge override is present", () => {
  withRuntimeEnv({ IBKR_TRANSPORT: "tws" }, () => {
    assert.equal(getProviderConfiguration().ibkr, false);
  });

  withRuntimeEnv(
    {
      IBKR_BRIDGE_URL: "https://env-bridge.example.com/",
      IBKR_BRIDGE_API_TOKEN: "env-token",
    },
    () => {
      assert.equal(getProviderConfiguration().ibkr, false);
      assert.equal(getIbkrBridgeRuntimeConfig(), null);
      assert.deepEqual(getIgnoredIbkrBridgeRuntimeEnvNames(), [
        "IBKR_BRIDGE_URL",
      ]);
    },
  );

  withRuntimeEnv({ IBKR_TRANSPORT: "tws" }, () => {
    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: "runtime-token",
    });
    assert.equal(getProviderConfiguration().ibkr, true);
  });
});

test("IBKR bridge runtime override takes precedence over environment", () => {
  withRuntimeEnv(
    {
      IBKR_BRIDGE_URL: "https://env-bridge.example.com/",
      IBKR_BRIDGE_API_TOKEN: "env-token",
    },
    () => {
      const override = setIbkrBridgeRuntimeOverride({
        baseUrl: "https://runtime-bridge.example.com/",
        apiToken: "runtime-token",
      });

      assert.equal(override.baseUrl, "https://runtime-bridge.example.com");
      assert.equal(override.apiToken, "runtime-token");
      assert.equal(getIbkrBridgeRuntimeOverride()?.baseUrl, override.baseUrl);
      assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
        baseUrl: "https://runtime-bridge.example.com",
        apiToken: "runtime-token",
      });
      assert.equal(getProviderConfiguration().ibkr, true);

      clearIbkrBridgeRuntimeOverride();
      assert.equal(getIbkrBridgeRuntimeConfig(), null);
      assert.deepEqual(getIgnoredIbkrBridgeRuntimeEnvNames(), [
        "IBKR_BRIDGE_URL",
      ]);
    },
  );
});

test("IBKR bridge runtime removes whitespace from wrapped tunnel URLs", () => {
  withRuntimeEnv(
    {
      IBKR_BRIDGE_URL:
        "https://mold-spirits-seeks-   mattress.trycloudflare.com/",
    },
    () => {
      assert.equal(getIbkrBridgeRuntimeConfig(), null);

      const override = setIbkrBridgeRuntimeOverride({
        baseUrl: "https://fresh-   tunnel.trycloudflare.com/",
        apiToken: "token",
      });

      assert.equal(override.baseUrl, "https://fresh-tunnel.trycloudflare.com");
    },
  );
});

test("IBKR bridge runtime override configures IBKR without environment", () => {
  withRuntimeEnv({}, () => {
    assert.equal(getProviderConfiguration().ibkr, false);

    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: null,
    });

    assert.equal(getProviderConfiguration().ibkr, true);
    assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: null,
    });
  });
});

test("IBKR bridge runtime override persists across API process restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "rayalgo-runtime-test-"));
  const overrideFile = join(dir, "ibkr-bridge-runtime.json");

  withRuntimeEnv(
    {
      IBKR_BRIDGE_URL: "https://stale-env.example.com",
      IBKR_BRIDGE_API_TOKEN: "stale-token",
      IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE: overrideFile,
    },
    () => {
      setIbkrBridgeRuntimeOverride({
        baseUrl: "https://fresh-tunnel.trycloudflare.com/",
        apiToken: "fresh-token",
      });

      assert.equal(existsSync(overrideFile), true);
      clearIbkrBridgeRuntimeOverride({ deletePersisted: false });

      assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
        baseUrl: "https://fresh-tunnel.trycloudflare.com",
        apiToken: "fresh-token",
      });

      clearIbkrBridgeRuntimeOverride();
      assert.equal(getIbkrBridgeRuntimeConfig(), null);
      assert.deepEqual(getIgnoredIbkrBridgeRuntimeEnvNames(), [
        "IBKR_BRIDGE_URL",
      ]);
    },
  );
});
