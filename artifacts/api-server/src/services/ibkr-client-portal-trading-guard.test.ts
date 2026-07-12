import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveIbkrGatewayTradingReadinessForTests } from "./platform";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

test("Client Portal trading guard verifies brokerage session before order actions", () => {
  const start = source.indexOf("export async function assertIbkrGatewayTradingAvailable");
  const end = source.indexOf("async function validateOrderIntentForRouting");

  assert.ok(start >= 0, "trading guard source must exist");
  assert.ok(end > start, "trading guard source boundary must exist");

  const guardSource = source.slice(start, end);

  assert.match(guardSource, /client\.ensureBrokerageSession\(\)/);
  assert.doesNotMatch(guardSource, /client\.listAccounts\(/);
  assert.match(guardSource, /authenticated: session\.authenticated/);
  assert.match(guardSource, /connected: session\.connected/);
});

const liveHealth = {
  connected: true,
  authenticated: true,
  established: true,
  isPaper: false,
  competing: false,
  accountsLoaded: true,
  accounts: ["U1234567", "U7654321"],
  selectedAccountId: "U1234567",
  healthFresh: true,
};

test("Client Portal trading guard requires strict live attestation", () => {
  assert.equal(
    resolveIbkrGatewayTradingReadinessForTests({
      configured: true,
      targetAccountId: "U1234567",
      health: liveHealth,
    }).ready,
    true,
  );

  for (const health of [
    { ...liveHealth, isPaper: true },
    { ...liveHealth, isPaper: null },
    { ...liveHealth, established: false },
    { ...liveHealth, established: null },
  ]) {
    assert.equal(
      resolveIbkrGatewayTradingReadinessForTests({
        configured: true,
        targetAccountId: "U1234567",
        health,
      }).ready,
      false,
    );
  }
});

test("Client Portal trading guard requires the explicit tradable target", () => {
  assert.equal(
    resolveIbkrGatewayTradingReadinessForTests({
      configured: true,
      targetAccountId: "U0000000",
      health: liveHealth,
    }).reason,
    "account_not_tradable",
  );
  assert.equal(
    resolveIbkrGatewayTradingReadinessForTests({
      configured: true,
      targetAccountId: null,
      health: liveHealth,
    }).reason,
    "account_required",
  );
});
