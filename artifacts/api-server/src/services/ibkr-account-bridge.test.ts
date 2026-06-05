import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";

process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
  tmpdir(),
  `pyrus-ibkr-account-bridge-${process.pid}.json`,
);
process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"] = "5000";
process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = "1";

const { setIbkrBridgeRuntimeOverride, clearIbkrBridgeRuntimeOverride } =
  await import("../lib/runtime");
const { primeBridgeHealthForSession, __setIbkrBridgeClientFactoryForTests } = await import(
  "./platform-bridge-health"
);
const { __resetBridgeGovernorForTests } = await import("./bridge-governor");
const {
  __resetIbkrAccountBridgeCacheForTests,
  listIbkrExecutions,
  listIbkrPositions,
} = await import("./ibkr-account-bridge");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function releaseMaybe(release: (() => void) | null): void {
  if (release) {
    release();
  }
}

function execution(id: string, price: number) {
  return {
    id,
    accountId: "U1",
    symbol: "AAPL",
    assetClass: "equity",
    side: "buy",
    quantity: 1,
    price,
    netAmount: null,
    exchange: null,
    executedAt: "2026-06-02T14:30:00.000Z",
    orderDescription: null,
    contractDescription: null,
    providerContractId: null,
    orderRef: null,
  };
}

function optionPosition(id: string, marketPrice: number) {
  return {
    id,
    accountId: "U1",
    symbol: "F",
    description: "F 2026-06-26 15 C",
    assetClass: "option",
    quantity: 5,
    averagePrice: 1.04,
    marketPrice,
    marketValue: marketPrice * 5 * 100,
    unrealizedPnl: (marketPrice - 1.04) * 5 * 100,
    unrealizedPnlPercent: ((marketPrice - 1.04) / 1.04) * 100,
    currency: "USD",
    updatedAt: "2026-06-04T18:00:00.000Z",
    providerContractId: "880754762",
    optionContract: {
      underlying: "F",
      expirationDate: "2026-06-26T00:00:00.000Z",
      strike: 15,
      right: "call",
      multiplier: 100,
      providerContractId: "880754762",
    },
  };
}

afterEach(() => {
  process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = "1";
  delete process.env["IBKR_ACCOUNT_EXECUTION_INITIAL_WAIT_MS"];
  __resetIbkrAccountBridgeCacheForTests();
  __resetBridgeGovernorForTests();
  __setIbkrBridgeClientFactoryForTests(null);
  clearIbkrBridgeRuntimeOverride();
});

test("IBKR account bridge reads serve stale cache while a refresh is in flight", async () => {
  let executionRequests = 0;
  let releaseSecondExecution: (() => void) | null = null;
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/executions")) {
      res.writeHead(404).end();
      return;
    }

    executionRequests += 1;
    const send = (id: string, price: number) => {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ executions: [execution(id, price)] }));
    };

    if (executionRequests === 1) {
      send("first", 101);
      return;
    }

    releaseSecondExecution = () => {
      releaseSecondExecution = null;
      send("second", 102);
    };
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    setIbkrBridgeRuntimeOverride({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiToken: "test-token",
    });
    primeBridgeHealthForSession({
      configured: true,
      connected: true,
      authenticated: true,
      competing: false,
      selectedAccountId: "U1",
      accounts: ["U1"],
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
      brokerServerConnected: true,
      socketConnected: true,
      bridgeReachable: true,
      accountsLoaded: true,
      diagnostics: { scheduler: {}, subscriptions: {} },
    });

    const first = await listIbkrExecutions({ accountId: "U1", limit: 10 });
    await wait(5);

    const startedAt = Date.now();
    const second = await listIbkrExecutions({ accountId: "U1", limit: 10 });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(first[0]?.id, "first");
    assert.equal(second[0]?.id, "first");
    assert.equal(elapsedMs < 50, true);
    for (let attempt = 0; attempt < 10 && executionRequests < 2; attempt += 1) {
      await wait(10);
    }
    assert.equal(executionRequests, 2);

    releaseMaybe(releaseSecondExecution);
    await wait(20);

    process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = "1000";
    const refreshed = await listIbkrExecutions({ accountId: "U1", limit: 10 });
    assert.equal(refreshed[0]?.id, "second");
  } finally {
    releaseMaybe(releaseSecondExecution);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("IBKR execution cold reads return quickly while the bridge refresh warms cache", async () => {
  process.env["IBKR_ACCOUNT_EXECUTION_INITIAL_WAIT_MS"] = "10";
  process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = "1000";
  let releaseExecution: (() => void) | null = null;
  let executionRequests = 0;
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/executions")) {
      res.writeHead(404).end();
      return;
    }

    executionRequests += 1;
    releaseExecution = () => {
      releaseExecution = null;
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ executions: [execution("warmed", 103)] }));
    };
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    setIbkrBridgeRuntimeOverride({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiToken: "test-token",
    });
    primeBridgeHealthForSession({
      configured: true,
      connected: true,
      authenticated: true,
      competing: false,
      selectedAccountId: "U1",
      accounts: ["U1"],
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
      brokerServerConnected: true,
      socketConnected: true,
      bridgeReachable: true,
      accountsLoaded: true,
      diagnostics: { scheduler: {}, subscriptions: {} },
    });

    const startedAt = Date.now();
    const cold = await listIbkrExecutions({ accountId: "U1", limit: 10 });
    const elapsedMs = Date.now() - startedAt;

    assert.deepEqual(cold, []);
    assert.equal(elapsedMs < 100, true);
    assert.equal(executionRequests, 1);

    releaseMaybe(releaseExecution);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(10);
      const warmed = await listIbkrExecutions({ accountId: "U1", limit: 10 });
      if (warmed[0]?.id === "warmed") {
        assert.equal(executionRequests, 1);
        return;
      }
    }
    assert.fail("execution cache did not warm after background refresh");
  } finally {
    releaseMaybe(releaseExecution);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("IBKR execution reads preserve non-empty cache when a refresh returns empty", async () => {
  let executionRequests = 0;
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/executions")) {
      res.writeHead(404).end();
      return;
    }

    executionRequests += 1;
    const executions =
      executionRequests === 1 ? [execution("first-execution", 101)] : [];
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ executions }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    setIbkrBridgeRuntimeOverride({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiToken: "test-token",
    });
    primeBridgeHealthForSession({
      configured: true,
      connected: true,
      authenticated: true,
      competing: false,
      selectedAccountId: "U1",
      accounts: ["U1"],
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
      brokerServerConnected: true,
      socketConnected: true,
      bridgeReachable: true,
      accountsLoaded: true,
      diagnostics: { scheduler: {}, subscriptions: {} },
    });

    const first = await listIbkrExecutions({ accountId: "U1", limit: 10 });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.id, "first-execution");
    await wait(5);

    const staleWhileRefreshing = await listIbkrExecutions({
      accountId: "U1",
      limit: 10,
    });
    assert.equal(staleWhileRefreshing.length, 1);

    for (let attempt = 0; attempt < 10 && executionRequests < 2; attempt += 1) {
      await wait(10);
    }
    assert.equal(executionRequests, 2);
    await wait(20);

    process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = "1000";
    const preserved = await listIbkrExecutions({ accountId: "U1", limit: 10 });
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0]?.id, "first-execution");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("IBKR position reads preserve non-empty cache when a refresh returns empty", async () => {
  let positionRequests = 0;
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/positions")) {
      res.writeHead(404).end();
      return;
    }

    positionRequests += 1;
    const positions =
      positionRequests === 1 ? [optionPosition("first-position", 0.82)] : [];
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ positions }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    setIbkrBridgeRuntimeOverride({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiToken: "test-token",
    });
    primeBridgeHealthForSession({
      configured: true,
      connected: true,
      authenticated: true,
      competing: false,
      selectedAccountId: "U1",
      accounts: ["U1"],
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
      brokerServerConnected: true,
      socketConnected: true,
      bridgeReachable: true,
      accountsLoaded: true,
      diagnostics: { scheduler: {}, subscriptions: {} },
    });

    const first = await listIbkrPositions({ accountId: "U1", mode: "live" });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.symbol, "F");
    await wait(5);

    const staleWhileRefreshing = await listIbkrPositions({
      accountId: "U1",
      mode: "live",
    });
    assert.equal(staleWhileRefreshing.length, 1);

    for (let attempt = 0; attempt < 10 && positionRequests < 2; attempt += 1) {
      await wait(10);
    }
    assert.equal(positionRequests, 2);
    await wait(20);

    process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1000";
    const preserved = await listIbkrPositions({ accountId: "U1", mode: "live" });
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0]?.id, "first-position");
  } finally {
    process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("IBKR position reads allow empty payloads without a non-empty stale cache", async () => {
  let positionRequests = 0;
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/positions")) {
      res.writeHead(404).end();
      return;
    }

    positionRequests += 1;
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ positions: [] }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    setIbkrBridgeRuntimeOverride({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiToken: "test-token",
    });
    primeBridgeHealthForSession({
      configured: true,
      connected: true,
      authenticated: true,
      competing: false,
      selectedAccountId: "U1",
      accounts: ["U1"],
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
      brokerServerConnected: true,
      socketConnected: true,
      bridgeReachable: true,
      accountsLoaded: true,
      diagnostics: { scheduler: {}, subscriptions: {} },
    });

    const positions = await listIbkrPositions({ accountId: "U1", mode: "live" });
    assert.deepEqual(positions, []);
    assert.equal(positionRequests, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
