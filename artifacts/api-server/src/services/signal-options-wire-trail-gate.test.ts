import assert from "node:assert/strict";
import test from "node:test";

import {
  isSignalOptionsWireTrailEnforceEnabled,
  isSignalOptionsWireTrailLiveContextEnabled,
} from "./signal-options-automation";

// The wire trail must stay inert by default: both gates OFF unless explicitly opted in.
// This is the guard that keeps live exit behavior byte-for-byte unchanged until an
// operator deliberately flips a flag.

test("live-context gate is OFF for blank/absent env (default runtime)", () => {
  assert.equal(isSignalOptionsWireTrailLiveContextEnabled({}), false);
  assert.equal(
    isSignalOptionsWireTrailLiveContextEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "",
      SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "",
    }),
    false,
  );
  assert.equal(
    isSignalOptionsWireTrailLiveContextEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "0",
    }),
    false,
  );
  assert.equal(
    isSignalOptionsWireTrailLiveContextEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "false",
    }),
    false,
  );
});

test("live-context gate is ON only for 1/true (case-insensitive)", () => {
  assert.equal(
    isSignalOptionsWireTrailLiveContextEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "1",
    }),
    true,
  );
  assert.equal(
    isSignalOptionsWireTrailLiveContextEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "TRUE",
    }),
    true,
  );
});

test("live-context gate falls back to the non-prefixed sibling", () => {
  assert.equal(
    isSignalOptionsWireTrailLiveContextEnabled({
      SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "1",
    }),
    true,
  );
});

test("enforce gate is OFF by default and ON only for 1/true (shadow-first)", () => {
  assert.equal(isSignalOptionsWireTrailEnforceEnabled({}), false);
  assert.equal(
    isSignalOptionsWireTrailEnforceEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE: "0",
    }),
    false,
  );
  assert.equal(
    isSignalOptionsWireTrailEnforceEnabled({
      PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE: "1",
    }),
    true,
  );
  assert.equal(
    isSignalOptionsWireTrailEnforceEnabled({
      SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE: "true",
    }),
    true,
  );
});

test("live context and enforce are independent gates (decoupled)", () => {
  // Loading live wire context must not imply order placement, and vice versa.
  const liveOnly = {
    PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE: "1",
  };
  assert.equal(isSignalOptionsWireTrailLiveContextEnabled(liveOnly), true);
  assert.equal(isSignalOptionsWireTrailEnforceEnabled(liveOnly), false);
});
