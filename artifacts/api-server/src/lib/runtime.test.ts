import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  __setIbkrBridgeLegacyRuntimeOverrideFileForTests,
  clearIbkrBridgeRuntimeOverride,
  getIgnoredIbkrBridgeRuntimeEnvNames,
  getIbkrBridgeProviderRuntimeConfig,
  getIbkrBridgeRuntimeConfig,
  getIbkrBridgeRuntimeOverride,
  getIbkrTwsRuntimeConfig,
  getMassiveRuntimeConfig,
  getProviderConfiguration,
  onIbkrBridgeRuntimeChanged,
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
  "PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
  "MASSIVE_STOCKS_RECENCY",
  "REPL_HOME",
  "TRADING_MODE",
  "TMPDIR",
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
    join(tmpdir(), "pyrus-runtime-env-test-"),
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

test("provider configuration exposes Massive as the only market data provider", () => {
  withRuntimeEnv({ MASSIVE_API_KEY: "massive-test-key" }, () => {
    assert.equal(getProviderConfiguration().massive, true);
    assert.deepEqual(getMassiveRuntimeConfig(), {
      apiKey: "massive-test-key",
      baseUrl: "https://api.massive.com",
    });
  });

  withRuntimeEnv({ MASSIVE_MARKET_DATA_API_KEY: "massive-market-data-key" }, () => {
    assert.equal(getProviderConfiguration().massive, true);
    assert.deepEqual(getMassiveRuntimeConfig(), {
      apiKey: "massive-market-data-key",
      baseUrl: "https://api.massive.com",
    });
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
  const dir = mkdtempSync(join(tmpdir(), "pyrus-runtime-test-"));
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

test("IBKR bridge runtime migrates legacy tmp override once and does not reload it after clear", () => {
  const replHome = mkdtempSync(join(tmpdir(), "pyrus-runtime-repl-home-"));
  const legacyDir = mkdtempSync(join(tmpdir(), "pyrus-runtime-legacy-tmp-"));
  const legacyFile = join(legacyDir, "ibkr-bridge-runtime-override.json");
  const defaultFile = join(
    replHome,
    "artifacts",
    "api-server",
    "data",
    "ibkr-bridge-runtime-override.json",
  );

  try {
    withRuntimeEnv(
      {
        IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE: "",
        REPL_HOME: replHome,
      },
      () => {
        __setIbkrBridgeLegacyRuntimeOverrideFileForTests(legacyFile);
        mkdirSync(dirname(legacyFile), { recursive: true });
        writeFileSync(
          legacyFile,
          JSON.stringify({
            version: 1,
            baseUrl: "https://legacy-tunnel.example.com/",
            apiToken: "legacy-token",
            updatedAt: "2026-05-26T17:00:00.000Z",
          }),
        );
        clearIbkrBridgeRuntimeOverride({ deletePersisted: false });

        assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
          baseUrl: "https://legacy-tunnel.example.com",
          apiToken: "legacy-token",
        });
        assert.equal(existsSync(defaultFile), true);
        assert.equal(existsSync(legacyFile), false);

        clearIbkrBridgeRuntimeOverride();
        clearIbkrBridgeRuntimeOverride({ deletePersisted: false });
        assert.equal(getIbkrBridgeRuntimeConfig(), null);
      },
    );
  } finally {
    __setIbkrBridgeLegacyRuntimeOverrideFileForTests(null);
    rmSync(replHome, { recursive: true, force: true });
    rmSync(legacyDir, { recursive: true, force: true });
  }
});

test("IBKR bridge runtime env override does not migrate or delete legacy tmp override", () => {
  const dir = mkdtempSync(join(tmpdir(), "pyrus-runtime-env-override-"));
  const legacyDir = mkdtempSync(join(tmpdir(), "pyrus-runtime-env-legacy-tmp-"));
  const overrideFile = join(dir, "runtime.json");
  const legacyFile = join(legacyDir, "ibkr-bridge-runtime-override.json");

  try {
    __setIbkrBridgeLegacyRuntimeOverrideFileForTests(legacyFile);
    withRuntimeEnv(
      {
        IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE: overrideFile,
      },
      () => {
        mkdirSync(dirname(legacyFile), { recursive: true });
        writeFileSync(
          legacyFile,
          JSON.stringify({
            version: 1,
            baseUrl: "https://legacy-tunnel.example.com/",
            apiToken: "legacy-token",
          }),
        );
        clearIbkrBridgeRuntimeOverride({ deletePersisted: false });

        assert.equal(getIbkrBridgeRuntimeConfig(), null);
        assert.equal(existsSync(legacyFile), true);

        setIbkrBridgeRuntimeOverride({
          baseUrl: "https://env-override.example.com",
          apiToken: "env-token",
        });
        clearIbkrBridgeRuntimeOverride();
        assert.equal(existsSync(legacyFile), true);
      },
    );
  } finally {
    __setIbkrBridgeLegacyRuntimeOverrideFileForTests(null);
    rmSync(dir, { recursive: true, force: true });
    rmSync(legacyDir, { recursive: true, force: true });
  }
});

test("IBKR bridge runtime override persistence replaces permissive files with 0600 mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "pyrus-runtime-mode-"));
  const overrideFile = join(dir, "runtime.json");

  try {
    writeFileSync(overrideFile, "{}", { mode: 0o644 });
    chmodSync(overrideFile, 0o644);
    withRuntimeEnv(
      {
        IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE: overrideFile,
      },
      () => {
        setIbkrBridgeRuntimeOverride({
          baseUrl: "https://secure-mode.example.com",
          apiToken: "mode-token",
        });

        assert.equal(statSync(overrideFile).mode & 0o777, 0o600);
        const persisted = JSON.parse(readFileSync(overrideFile, "utf8")) as {
          baseUrl?: string;
        };
        assert.equal(persisted.baseUrl, "https://secure-mode.example.com");
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IBKR bridge runtime change events fire after durable mutation and isolate listener failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "pyrus-runtime-events-"));
  const overrideFile = join(dir, "runtime.json");

  try {
    withRuntimeEnv(
      {
        IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE: overrideFile,
      },
      () => {
        const events: string[] = [];
        const removeBadListener = onIbkrBridgeRuntimeChanged(() => {
          throw new Error("listener failed");
        });
        const removeGoodListener = onIbkrBridgeRuntimeChanged((event) => {
          events.push(event.type);
        });

        try {
          setIbkrBridgeRuntimeOverride({
            baseUrl: "https://events.example.com",
            apiToken: "events-token",
          });
          clearIbkrBridgeRuntimeOverride();
        } finally {
          removeBadListener();
          removeGoodListener();
        }

        assert.deepEqual(events, ["set", "clear"]);
      },
    );

    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const previous = process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
    process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(blocker, "runtime.json");
    clearIbkrBridgeRuntimeOverride({ deletePersisted: false });
    const events: string[] = [];
    const unsubscribe = onIbkrBridgeRuntimeChanged((event) => {
      events.push(event.type);
    });
    try {
      assert.throws(() =>
        setIbkrBridgeRuntimeOverride({
          baseUrl: "https://persist-failure.example.com",
          apiToken: "failure-token",
        }),
      );
      assert.deepEqual(events, []);
    } finally {
      unsubscribe();
      if (previous === undefined) {
        delete process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
      } else {
        process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = previous;
      }
      clearIbkrBridgeRuntimeOverride({ deletePersisted: false });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
