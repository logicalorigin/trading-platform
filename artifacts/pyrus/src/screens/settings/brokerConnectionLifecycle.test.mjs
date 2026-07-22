import assert from "node:assert/strict";
import test from "node:test";

import {
  BROKER_LIFECYCLE_PHASES,
  BROKER_RING_SPECS,
  brokerCardStatusLine,
  deriveBrokerCardPhase,
  successFlashKeys,
} from "./brokerConnectionLifecycle.js";

test("deriveBrokerCardPhase priority: working > awaiting-user > connected > impaired > idle", () => {
  assert.equal(deriveBrokerCardPhase(undefined), "idle");
  assert.equal(deriveBrokerCardPhase({}), "idle");
  assert.equal(deriveBrokerCardPhase({ connected: true }), "connected");
  assert.equal(deriveBrokerCardPhase({ impaired: true }), "impaired");
  // A connected card being re-synced shows motion, not the steady green ring.
  assert.equal(
    deriveBrokerCardPhase({ connected: true, working: true }),
    "working",
  );
  assert.equal(
    deriveBrokerCardPhase({ connected: true, awaitingUser: true }),
    "awaiting-user",
  );
  assert.equal(
    deriveBrokerCardPhase({ working: true, awaitingUser: true }),
    "working",
  );
  // Schwab expired grant: impaired even though not connected.
  assert.equal(
    deriveBrokerCardPhase({ connected: false, impaired: true }),
    "impaired",
  );
});

test("successFlashKeys fires only on a transition into connected", () => {
  const prev = new Map([
    ["IBKR_PORTAL", "awaiting-user"],
    ["ROBINHOOD", "connected"],
    ["SCHWAB", "idle"],
  ]);
  const next = new Map([
    ["IBKR_PORTAL", "connected"], // login just completed → flash
    ["ROBINHOOD", "connected"], // was already connected → no flash
    ["SCHWAB", "idle"],
  ]);
  assert.deepEqual(successFlashKeys(prev, next), ["IBKR_PORTAL"]);
});

test("successFlashKeys never flashes on first observation (initial load)", () => {
  const next = new Map([["ETRADE", "connected"]]);
  assert.deepEqual(successFlashKeys(new Map(), next), []);
});

test("successFlashKeys does not re-flash after the transient success phase", () => {
  const prev = new Map([["ETRADE", "success"]]);
  const next = new Map([["ETRADE", "connected"]]);
  assert.deepEqual(successFlashKeys(prev, next), []);
});

test("ring specs cover every phase and idle renders no ring", () => {
  for (const phase of BROKER_LIFECYCLE_PHASES) {
    assert.ok(phase in BROKER_RING_SPECS, `missing ring spec for ${phase}`);
  }
  assert.equal(BROKER_RING_SPECS.idle, null);
  assert.equal(BROKER_RING_SPECS.connected.tone, "green");
  assert.equal(BROKER_RING_SPECS.connected.sheen, undefined);
  assert.equal(BROKER_RING_SPECS.impaired.dashed, true);
  assert.equal(BROKER_RING_SPECS.working.motion, "arc");
});

test("brokerCardStatusLine speaks only for transitional/impaired phases", () => {
  assert.equal(brokerCardStatusLine("idle"), "");
  assert.equal(brokerCardStatusLine("connected"), "");
  assert.equal(brokerCardStatusLine("success"), "");
  assert.equal(brokerCardStatusLine("working"), "Working…");
  assert.equal(brokerCardStatusLine("awaiting-user"), "Waiting for login…");
  assert.equal(brokerCardStatusLine("impaired"), "Reconnect required");
  assert.equal(
    brokerCardStatusLine("impaired", { impairedLabel: "Weekly reconnect" }),
    "Weekly reconnect",
  );
});
