import assert from "node:assert/strict";
import test from "node:test";
import {
  formatIbkrPingMs,
  getIbkrConnection,
  getIbkrConnectionTone,
} from "./IbkrConnectionStatus.jsx";

test("formatIbkrPingMs formats millisecond and second values", () => {
  assert.equal(formatIbkrPingMs(null), "--");
  assert.equal(formatIbkrPingMs(42.4), "42ms");
  assert.equal(formatIbkrPingMs(1_250), "1.3s");
  assert.equal(formatIbkrPingMs(12_500), "13s");
});

test("getIbkrConnectionTone maps configured connection states", () => {
  assert.equal(
    getIbkrConnectionTone({ configured: false }).label,
    "offline",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: false,
      authenticated: false,
      lastError: "socket closed",
    }).label,
    "error",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: false,
    }).label,
    "login",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
    }).label,
    "online",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: false,
    }).label,
    "delayed",
  );
});

test("getIbkrConnection falls back to the active legacy bridge transport", () => {
  const session = {
    environment: "paper",
    configured: { ibkr: true },
    ibkrBridge: {
      transport: "tws",
      connected: true,
      authenticated: true,
      selectedAccountId: "DU123",
      accounts: ["DU123"],
      connectionTarget: "127.0.0.1:4002",
      clientId: 101,
    },
  };

  const tws = getIbkrConnection(session, "tws");
  const clientPortal = getIbkrConnection(session, "clientPortal");

  assert.equal(tws.configured, true);
  assert.equal(tws.authenticated, true);
  assert.equal(tws.target, "127.0.0.1:4002");
  assert.equal(clientPortal.configured, false);
});
