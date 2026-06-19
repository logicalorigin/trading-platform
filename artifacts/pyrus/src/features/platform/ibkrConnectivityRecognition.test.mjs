import assert from "node:assert/strict";
import test from "node:test";

import {
  getIbkrConnectionTone,
  isIbkrGatewayBridgeAttached,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus.jsx";

// Models the freshness-collapse state: the api-server is serving a stale cache, so the
// freshness-derived fields (healthFresh/streamFresh/socketConnected/bridgeReachable) read
// false, but the backend connectivity verdict confirms the bridge is genuinely up.
const baseStaleButUp = {
  configured: true,
  competing: false,
  reachable: false,
  authenticated: true,
  accountsLoaded: true,
  accounts: [{ id: "DU1234567" }],
  bridgeReachable: false,
  socketConnected: false,
  brokerServerConnected: false,
  healthFresh: false,
  streamFresh: false,
  streamState: "stale",
  strictReady: false,
  configuredLiveMarketDataMode: true,
  liveMarketDataAvailable: true,
};

test("header pill recognizes the bridge as online when connectivityUp is true under a stale cache", () => {
  const tone = getIbkrConnectionTone({ ...baseStaleButUp, connectivityUp: true });
  assert.equal(tone.label, "online");
});

test("popover recognizes the bridge as Connected when connectivityUp is true under a stale cache", () => {
  const health = resolveIbkrGatewayHealth({
    connection: { ...baseStaleButUp, connectivityUp: true },
  });
  assert.equal(health.status, "healthy");
  assert.equal(health.label, "Connected");
});

test("isIbkrGatewayBridgeAttached is true when connectivityUp is true under a stale cache", () => {
  assert.equal(
    isIbkrGatewayBridgeAttached({
      connection: { ...baseStaleButUp, connectivityUp: true },
    }),
    true,
  );
});

// Control: WITHOUT the connectivity verdict, the same stale-cache state still produces the
// pre-fix false-negative (pill not online, popover offline), proving connectivityUp is the
// signal that flips recognition, and that behavior is unchanged when the field is absent.
test("without connectivityUp the stale-cache state still reads as not-connected (control)", () => {
  const tone = getIbkrConnectionTone({ ...baseStaleButUp });
  assert.notEqual(tone.label, "online");
  const health = resolveIbkrGatewayHealth({ connection: { ...baseStaleButUp } });
  assert.notEqual(health.status, "healthy");
});

// Delayed market data is preserved as a distinct state even when the connection is up.
test("connectivityUp with delayed market data surfaces Delayed, not Connected", () => {
  const health = resolveIbkrGatewayHealth({
    connection: {
      ...baseStaleButUp,
      connectivityUp: true,
      configuredLiveMarketDataMode: false,
      liveMarketDataAvailable: false,
    },
  });
  assert.equal(health.status, "delayed");
});
