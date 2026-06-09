import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeaderIbkrPopoverModel,
  buildHeaderIbkrTriggerModel,
} from "./ibkrPopoverModel.js";

const readyConnection = {
  configured: true,
  reachable: true,
  authenticated: true,
  accountsLoaded: true,
  accounts: [{ id: "DU1234567" }],
  bridgeReachable: true,
  socketConnected: true,
  brokerServerConnected: true,
  configuredLiveMarketDataMode: true,
  healthFresh: true,
  streamFresh: true,
  streamState: "live",
  strictReady: true,
  lastPingMs: 42,
};

const compactLineUsageSnapshot = {
  admission: {
    activeLineCount: 12,
    accountMonitorLineCount: 4,
    budget: {
      maxLines: 200,
      accountMonitorLineCap: 30,
      bridgeLineBudget: 200,
    },
    poolUsage: {
      "account-monitor": {
        id: "account-monitor",
        activeLineCount: 4,
        maxLines: 30,
      },
    },
  },
  bridge: {
    activeLineCount: 12,
    lineBudget: 200,
    remainingLineCount: 188,
  },
  drift: {
    reconciliation: {
      status: "matched",
      apiLineCount: 12,
      bridgeLineCount: 12,
      matchedLineCount: 12,
    },
  },
};

test("closed IBKR trigger model avoids detailed popover diagnostics", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
  });

  assert.equal(model.health.status, "healthy");
  assert.deepEqual(model.tiles, []);
  assert.deepEqual(model.providerRows, []);
  assert.deepEqual(model.detailGroups, []);
  assert.equal(model.lineUsage, null);
  assert.equal(model.compactLineUsage, null);
});

test("closed IBKR trigger model exposes compact line usage when a snapshot is available", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: compactLineUsageSnapshot,
  });

  assert.equal(model.health.status, "healthy");
  assert.equal(model.lineUsage?.summary, "12 of 200");
  assert.equal(model.compactLineUsage?.summary, "12 of 200");
});

test("closed IBKR trigger model surfaces live Massive provider status", () => {
  // Regression: the trigger model used to hardcode massive:null, so the
  // always-visible footer showed "No checks yet" while the popover was closed
  // even when Massive was streaming. Massive status comes from runtimeDiagnostics
  // (polled regardless of popover), so it must be populated here.
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: {
      providers: {
        massive: {
          configured: true,
          rest: { status: "ok" },
          websocket: {
            status: "ok",
            configured: true,
            activeChannels: ["AM", "Q", "T"],
          },
        },
      },
    },
    runtimeError: null,
  });

  assert.ok(model.massive, "trigger model should expose massive status");
  assert.equal(model.massive.status, "ok");
});

test("open IBKR popover model keeps detailed stream diagnostics", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: readyConnection,
    latencyStats: {
      bridgeToApiMs: { p50: 10, p95: 15 },
      apiToReactMs: { p50: 4, p95: 8 },
      totalMs: { p50: 20, p95: 30 },
      stream: {
        activeConsumerCount: 1,
        unionSymbolCount: 3,
        eventCount: 7,
        streamGapCount: 0,
        maxGapMs: 0,
        lastEventAgeMs: 100,
      },
    },
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: null,
  });

  assert.ok(model.tiles.some((tile) => tile.label === "Stream"));
  assert.ok(model.detailGroups.some((group) => group.title === "Stream"));
});
