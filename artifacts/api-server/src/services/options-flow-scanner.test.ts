import assert from "node:assert/strict";
import test from "node:test";

import {
  createOptionsFlowScanner,
  type OptionsFlowScannerRequest,
} from "./options-flow-scanner";

function createScanner() {
  return createOptionsFlowScanner<{ id: string }>({
    fetchSymbol: async () => ({ events: [] }),
    getTransport: async () => ({
      transport: "massive",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      marketDataMode: "live",
    }),
  });
}

test("a shallow expiration snapshot cannot satisfy a deeper request", () => {
  const scanner = createScanner();
  const baseRequest: OptionsFlowScannerRequest = {
    limit: 25,
    lineBudget: 50,
    phase: "manual",
    expirationScanCount: 1,
    strikeCoverage: "standard",
  };

  scanner.storeSnapshot(
    "AAPL",
    baseRequest,
    { events: [{ id: "shallow" }] },
    "massive",
  );

  assert.equal(
    scanner.getSnapshot("AAPL", {
      ...baseRequest,
      expirationScanCount: 3,
    }),
    null,
  );
});

test("a standard-strike snapshot cannot satisfy a full-strike request", () => {
  const scanner = createScanner();
  const baseRequest: OptionsFlowScannerRequest = {
    limit: 25,
    lineBudget: 50,
    phase: "manual",
    expirationScanCount: 3,
    strikeCoverage: "standard",
  };

  scanner.storeSnapshot(
    "AAPL",
    baseRequest,
    { events: [{ id: "standard" }] },
    "massive",
  );

  assert.equal(
    scanner.getSnapshot("AAPL", {
      ...baseRequest,
      strikeCoverage: "full",
    }),
    null,
  );
});

test("queued requests keep the largest requested expiration scan", async () => {
  let releaseFirstScan = () => {};
  let firstScanStarted = () => {};
  const firstScanReady = new Promise<void>((resolve) => {
    firstScanStarted = resolve;
  });
  const firstScanGate = new Promise<void>((resolve) => {
    releaseFirstScan = resolve;
  });
  const fetchedRequests: Array<{
    symbol: string;
    expirationScanCount?: number;
  }> = [];
  const scanner = createOptionsFlowScanner<{ id: string }>({
    fetchSymbol: async ({ symbol, expirationScanCount }) => {
      fetchedRequests.push({ symbol, expirationScanCount });
      if (symbol === "AAPL") {
        firstScanStarted();
        await firstScanGate;
      }
      return { events: [] };
    },
    getTransport: async () => ({
      transport: "massive",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      marketDataMode: "live",
    }),
  });
  const request = (expirationScanCount: number): OptionsFlowScannerRequest => ({
    limit: 25,
    lineBudget: 50,
    phase: "manual",
    expirationScanCount,
    strikeCoverage: "standard",
  });

  const firstRun = scanner.requestScan(["AAPL"], request(1));
  await firstScanReady;
  const deeperRun = scanner.requestScan(["MSFT"], request(5));
  const shallowerRun = scanner.requestScan(["MSFT"], request(2));
  releaseFirstScan();
  await Promise.all([firstRun, deeperRun, shallowerRun]);

  assert.equal(
    fetchedRequests.find(({ symbol }) => symbol === "MSFT")
      ?.expirationScanCount,
    5,
  );
});
