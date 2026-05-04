import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { IbkrBridgeClient } from "../providers/ibkr/bridge-client";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
const previousRuntimeOverrideFile =
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
  tmpdir(),
  `rayalgo-runtime-diagnostics-${process.pid}.json`,
);

const runtimeModule = await import("../lib/runtime");
const platformModule = await import("./platform");
const bridgeQuoteStreamModule = await import("./bridge-quote-stream");
const bridgeGovernorModule = await import("./bridge-governor");
const { clearIbkrBridgeRuntimeOverride, setIbkrBridgeRuntimeOverride } =
  runtimeModule;
const {
  __resolveIbkrRuntimeStreamStateForTests,
  __resolveIbkrRuntimeStrictReasonForTests,
  __setIbkrBridgeClientFactoryForTests,
  getSession,
  getRuntimeDiagnostics,
} = platformModule;
const {
  __resetBridgeQuoteStreamForTests,
  __setBridgeQuoteClientForTests,
  subscribeBridgeQuoteSnapshots,
} = bridgeQuoteStreamModule;
const { __resetBridgeGovernorForTests } = bridgeGovernorModule;

test.afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __setBridgeQuoteClientForTests(null);
  __resetBridgeQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  clearIbkrBridgeRuntimeOverride();
  delete process.env["RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_TIMEOUT_MS"];
  delete process.env["RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_STALE_CACHE_MS"];
  delete process.env["IBKR_BRIDGE_HEALTH_FRESH_MS"];
  delete process.env["SESSION_BRIDGE_HEALTH_STALE_TIMEOUT_MS"];
  delete process.env["SESSION_BRIDGE_HEALTH_TIMEOUT_MS"];
});

test.after(() => {
  clearIbkrBridgeRuntimeOverride();
  if (previousRuntimeOverrideFile === undefined) {
    delete process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
  } else {
    process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] =
      previousRuntimeOverrideFile;
  }
});

test("runtime stream state is market-aware", () => {
  const open = new Date("2026-04-28T14:30:00.000Z");
  const closed = new Date("2026-04-28T21:30:00.000Z");
  const base = {
    configured: true,
    healthFresh: true,
    connected: true,
    authenticated: true,
    accountsLoaded: true,
    configuredLiveMarketDataMode: true,
    liveMarketDataAvailable: true,
    streamActive: true,
    desiredSymbolCount: 1,
  };

  assert.equal(
    __resolveIbkrRuntimeStreamStateForTests({
      ...base,
      streamFresh: true,
      now: open,
    }).streamState,
    "live",
  );
  assert.equal(
    __resolveIbkrRuntimeStreamStateForTests({
      ...base,
      streamFresh: false,
      now: open,
    }).streamState,
    "stale",
  );
  const staleHealthState = __resolveIbkrRuntimeStreamStateForTests({
    ...base,
    healthFresh: false,
    bridgeReachable: true,
    streamFresh: false,
    now: open,
  });
  assert.equal(staleHealthState.streamState, "checking");
  assert.equal(staleHealthState.streamStateReason, "health_stale");
  const capacityState = __resolveIbkrRuntimeStreamStateForTests({
    ...base,
    streamFresh: false,
    streamPressure: "backpressure",
    now: open,
  });
  assert.equal(capacityState.streamState, "capacity_limited");
  assert.equal(capacityState.streamStateReason, "backpressure");
  const staleHealthCapacityState = __resolveIbkrRuntimeStreamStateForTests({
    ...base,
    healthFresh: false,
    bridgeReachable: true,
    streamFresh: false,
    streamPressure: "backpressure",
    now: open,
  });
  assert.equal(staleHealthCapacityState.streamState, "capacity_limited");
  assert.equal(staleHealthCapacityState.streamStateReason, "backpressure");
  assert.equal(
    __resolveIbkrRuntimeStreamStateForTests({
      ...base,
      streamFresh: false,
      now: closed,
    }).streamState,
    "quiet",
  );
  assert.equal(
    __resolveIbkrRuntimeStreamStateForTests({
      ...base,
      streamFresh: true,
      now: closed,
    }).streamState,
    "quiet",
  );
  assert.equal(
    __resolveIbkrRuntimeStreamStateForTests({
      ...base,
      streamFresh: false,
      streamLastError: "IBKR bridge quote stream ended.",
      now: closed,
    }).streamState,
    "quiet",
  );
  assert.equal(
    __resolveIbkrRuntimeStreamStateForTests({
      ...base,
      streamFresh: false,
      reconnectScheduled: true,
      now: closed,
    }).streamState,
    "quiet",
  );
  assert.equal(
    __resolveIbkrRuntimeStrictReasonForTests({
      ...base,
      streamFresh: false,
      now: open,
    }),
    "stream_not_fresh",
  );
  assert.equal(
    __resolveIbkrRuntimeStrictReasonForTests({
      ...base,
      streamFresh: false,
      now: closed,
    }),
    "market_session_quiet",
  );
});

test("runtime diagnostics are read-only and only inspect bridge health", async () => {
  const calls: string[] = [];
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          calls.push("getHealth");
          return {
            configured: true,
            authenticated: true,
            connected: true,
            competing: false,
            selectedAccountId: "DU1234567",
            accounts: ["DU1234567"],
            lastTickleAt: new Date(),
            lastError: null,
            lastRecoveryAttemptAt: null,
            lastRecoveryError: null,
            updatedAt: new Date(),
            transport: "tws",
            connectionTarget: "127.0.0.1:4001",
            sessionMode: "live",
            clientId: 101,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
          };
        },
        listOrders: async () => {
          calls.push("listOrders");
          throw new Error("diagnostics must not read orders");
        },
        previewOrder: async () => {
          calls.push("previewOrder");
          throw new Error("diagnostics must not preview orders");
        },
        placeOrder: async () => {
          calls.push("placeOrder");
          throw new Error("diagnostics must not place orders");
        },
      }) as unknown as IbkrBridgeClient,
  );

  const diagnostics = await getRuntimeDiagnostics();

  assert.deepEqual(calls, ["getHealth"]);
  assert.equal(diagnostics.ibkr.transport, "tws");
  assert.equal(diagnostics.ibkr.orderCapability.orderDataVisible, true);
  assert.equal(diagnostics.ibkr.orderCapability.diagnosticsMutateOrders, false);
  assert.equal(diagnostics.ibkr.selectedAccountId, "DU...4567");
  assert.equal(typeof diagnostics.ibkr.streams.bridgeQuote.streamActive, "boolean");
  assert.equal(
    typeof diagnostics.ibkr.streams.optionQuotes.activeConsumerCount,
    "number",
  );
  assert.equal(typeof diagnostics.ibkr.streams.stockAggregates.activeConsumerCount, "number");
  assert.equal(
    typeof diagnostics.ibkr.streams.marketDataAdmission.activeLineCount,
    "number",
  );
  assert.equal(typeof diagnostics.providers.polygon.configured, "boolean");
  assert.ok(
    ["ok", "degraded", "unconfigured", "unknown"].includes(
      diagnostics.providers.polygon.status,
    ),
  );
});

test("session refreshes stale cached bridge health before reporting status", async () => {
  const calls: string[] = [];
  let updatedAt = new Date(Date.now() - 30_000);
  process.env["SESSION_BRIDGE_HEALTH_STALE_TIMEOUT_MS"] = "25";
  setIbkrBridgeRuntimeOverride({
    baseUrl: "http://127.0.0.1:65535",
    apiToken: "test",
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          calls.push("getHealth");
          return {
            configured: true,
            authenticated: true,
            connected: true,
            competing: false,
            selectedAccountId: "DU1234567",
            accounts: ["DU1234567"],
            lastTickleAt: new Date(),
            lastError: null,
            lastRecoveryAttemptAt: null,
            lastRecoveryError: null,
            updatedAt,
            transport: "tws",
            connectionTarget: "127.0.0.1:4001",
            sessionMode: "live",
            clientId: 101,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
          };
        },
      }) as unknown as IbkrBridgeClient,
  );

  await getRuntimeDiagnostics();
  updatedAt = new Date();

  const session = await getSession();

  assert.deepEqual(calls, ["getHealth", "getHealth"]);
  assert.equal(session.ibkrBridge?.healthFresh, true);
  assert.equal(session.ibkrBridge?.bridgeReachable, true);
});

test("runtime diagnostics use the active API quote stream as strict stream proof", async () => {
  const calls: string[] = [];
  setIbkrBridgeRuntimeOverride({
    baseUrl: "http://127.0.0.1:65535",
    apiToken: "test",
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          calls.push("getHealth");
          return {
            configured: true,
            authenticated: true,
            connected: true,
            competing: false,
            selectedAccountId: "DU1234567",
            accounts: ["DU1234567"],
            lastTickleAt: new Date(),
            lastError: null,
            lastRecoveryAttemptAt: null,
            lastRecoveryError: null,
            updatedAt: new Date(),
            transport: "tws",
            connectionTarget: "127.0.0.1:4001",
            sessionMode: "live",
            clientId: 101,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
            streamFresh: false,
            lastStreamEventAgeMs: null,
            strictReady: false,
            strictReason: "stream_not_fresh",
            diagnostics: {
              subscriptions: {
                lastQuoteAgeMs: null,
                lastAggregateSourceAgeMs: null,
              },
            },
          };
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setBridgeQuoteClientForTests({
    getQuoteSnapshots: async () => [],
    streamQuoteSnapshots: (_symbols, onSnapshot) => {
      onSnapshot([
        {
          symbol: "NVDA",
          price: 123,
          updatedAt: new Date(),
          freshness: "live",
        } as never,
      ]);
      return () => {};
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["NVDA"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 180));

  const diagnostics = await getRuntimeDiagnostics();
  const session = await getSession();
  unsubscribe();

  assert.deepEqual(calls, ["getHealth"]);
  assert.equal(diagnostics.ibkr.streamFresh, true);
  assert.equal(diagnostics.ibkr.strictReady, true);
  assert.equal(diagnostics.ibkr.strictReason, null);
  assert.ok(["live", "quiet"].includes(diagnostics.ibkr.streamState));
  assert.equal(typeof diagnostics.ibkr.lastStreamEventAgeMs, "number");
  assert.equal(session.ibkrBridge?.streamFresh, true);
  assert.equal(session.ibkrBridge?.strictReady, true);
  assert.ok(["live", "quiet"].includes(session.ibkrBridge?.streamState ?? ""));
  assert.equal(typeof session.ibkrBridge?.lastStreamEventAgeMs, "number");
});

test("runtime diagnostics accept live quote stream heartbeats as strict stream proof", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          configured: true,
          authenticated: true,
          connected: true,
          competing: false,
          selectedAccountId: "DU1234567",
          accounts: ["DU1234567"],
          lastTickleAt: new Date(),
          lastError: null,
          lastRecoveryAttemptAt: null,
          lastRecoveryError: null,
          updatedAt: new Date(),
          transport: "tws",
          connectionTarget: "127.0.0.1:4001",
          sessionMode: "live",
          clientId: 101,
          marketDataMode: "live",
          liveMarketDataAvailable: true,
          streamFresh: false,
          lastStreamEventAgeMs: null,
          strictReady: false,
          strictReason: "stream_not_fresh",
          diagnostics: {
            subscriptions: {
              lastQuoteAgeMs: null,
              lastAggregateSourceAgeMs: null,
            },
          },
        }),
      }) as unknown as IbkrBridgeClient,
  );
  __setBridgeQuoteClientForTests({
    getQuoteSnapshots: async () => [],
    streamQuoteSnapshots: (_symbols, _onSnapshot, _onError, onSignal) => {
      onSignal?.({
        type: "status",
        at: new Date(),
        status: { state: "open", lastEventAgeMs: null },
      });
      return () => {};
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["NVDA"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 180));
  const diagnostics = await getRuntimeDiagnostics();
  unsubscribe();

  assert.equal(diagnostics.ibkr.streamFresh, true);
  assert.equal(diagnostics.ibkr.strictReady, true);
  assert.equal(diagnostics.ibkr.strictReason, null);
  assert.ok(["live", "quiet"].includes(diagnostics.ibkr.streamState));
  assert.equal(typeof diagnostics.ibkr.lastStreamEventAgeMs, "number");
});

test("runtime diagnostics ignore request-scoped bridge health errors while connected", async () => {
  setIbkrBridgeRuntimeOverride({
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: "test-token",
  });
  const requestScopedErrors = [
    "Error validating request.-'bO' : cause - Snapshot market data subscription is not applicable to generic ticks",
    "Can't find EId with tickerId:904",
    "Lane timed out after 2000ms. | IBKR bridge lane control lane timed out after 2000ms.",
  ];
  let errorIndex = 0;
  __setIbkrBridgeClientFactoryForTests(
    () => {
      const lastError =
        requestScopedErrors[
          Math.min(errorIndex, requestScopedErrors.length - 1)
        ];
      errorIndex += 1;
      return {
        getHealth: async () => ({
          configured: true,
          authenticated: true,
          connected: true,
          competing: false,
          selectedAccountId: "DU1234567",
          accounts: ["DU1234567"],
          lastTickleAt: new Date(),
          lastError,
          lastRecoveryAttemptAt: null,
          lastRecoveryError: null,
          updatedAt: new Date(),
          transport: "tws",
          connectionTarget: "127.0.0.1:4001",
          sessionMode: "live",
          clientId: 101,
          marketDataMode: "live",
          liveMarketDataAvailable: true,
          connections: {
            tws: {
              transport: "tws",
              role: "market_data",
              configured: true,
              reachable: true,
              authenticated: true,
              competing: false,
              target: "127.0.0.1:4001",
              mode: "live",
              clientId: 101,
              selectedAccountId: "DU1234567",
              accounts: ["DU1234567"],
              lastPingMs: 12,
              lastPingAt: new Date(),
              lastTickleAt: new Date(),
              lastError,
              marketDataMode: "live",
              liveMarketDataAvailable: true,
            },
          },
        }),
      } as unknown as IbkrBridgeClient;
    },
  );

  for (const _requestScopedError of requestScopedErrors) {
    const diagnostics = await getRuntimeDiagnostics();

    assert.equal(diagnostics.ibkr.lastError, null);
    assert.ok(
      diagnostics.ibkr.strictReady ||
        diagnostics.ibkr.strictReason === "market_session_quiet",
    );
    assert.ok([null, "market_session_quiet"].includes(diagnostics.ibkr.strictReason));
    assert.equal(diagnostics.ibkr.streamState, "quiet");
    assert.ok(
      ["no_active_quote_consumers", "market_session_quiet"].includes(
        diagnostics.ibkr.streamStateReason,
      ),
    );
  }
});

test("runtime diagnostics timebox bridge health checks", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: () => new Promise(() => {}),
      }) as unknown as IbkrBridgeClient,
  );
  process.env["RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_TIMEOUT_MS"] = "5";

  const diagnostics = await getRuntimeDiagnostics();

  assert.equal(diagnostics.ibkr.reachable, false);
  assert.equal(diagnostics.ibkr.healthErrorCode, "ibkr_bridge_health_timeout");
  assert.match(diagnostics.ibkr.healthErrorDetail ?? "", /5ms/);
});

test("runtime diagnostics serves stale cached bridge health without blocking", async () => {
  let calls = 0;
  let hang = false;
  const staleUpdatedAt = new Date(Date.now() - 30_000);
  process.env["RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_TIMEOUT_MS"] = "25";
  process.env["RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_STALE_CACHE_MS"] = "120000";
  process.env["IBKR_BRIDGE_HEALTH_FRESH_MS"] = "10000";
  process.env["SESSION_BRIDGE_HEALTH_TIMEOUT_MS"] = "5";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          calls += 1;
          if (hang) {
            return new Promise(() => {});
          }
          return {
            configured: true,
            authenticated: true,
            connected: true,
            competing: false,
            selectedAccountId: "DU1234567",
            accounts: ["DU1234567"],
            lastTickleAt: staleUpdatedAt,
            lastError: null,
            lastRecoveryAttemptAt: null,
            lastRecoveryError: null,
            updatedAt: staleUpdatedAt,
            transport: "tws",
            connectionTarget: "127.0.0.1:4001",
            sessionMode: "live",
            clientId: 101,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
          };
        },
      }) as unknown as IbkrBridgeClient,
  );

  await getRuntimeDiagnostics();
  hang = true;
  const startedAt = Date.now();
  const diagnostics = await getRuntimeDiagnostics();
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 25);
  assert.equal(diagnostics.ibkr.connected, true);
  assert.equal(diagnostics.ibkr.authenticated, true);
  assert.equal(diagnostics.ibkr.reachable, true);
  assert.equal(diagnostics.ibkr.healthFresh, false);
  assert.equal(diagnostics.ibkr.strictReason, "health_stale");
  assert.equal(diagnostics.ibkr.streamState, "checking");
  assert.equal(diagnostics.ibkr.streamStateReason, "health_stale");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
});
