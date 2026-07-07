import assert from "node:assert/strict";
import test from "node:test";

import { signalOptionsFinalQuoteDeltaGate } from "./signal-options-automation";

// The greek selector's hard tradeability floor (|delta| >= 0.15) must hold against
// the FINAL fill quote, not just the selection-time snapshot — and must also cover
// the fallback_legacy path, which never scored at all. Regression family: the
// DIA 471P @ spot ~521.8 lottery-ticket entry.

const AT = new Date("2026-07-07T15:00:00Z");
const EXPIRY = new Date("2026-07-09T20:00:00Z");

test("not greek-governed: gate never blocks (pure legacy path untouched)", () => {
  const gate = signalOptionsFinalQuoteDeltaGate({
    greekSelectorGoverned: false,
    entryGreeks: { delta: 0.01 },
    strike: 471,
    expirationDate: EXPIRY,
    fillPrice: 0.04,
    spot: 521.8,
    right: "put",
    at: AT,
  });
  assert.equal(gate.ok, true);
});

test("healthy final-quote delta passes (call and put)", () => {
  for (const [right, delta] of [["call", 0.5], ["put", -0.5]] as const) {
    const gate = signalOptionsFinalQuoteDeltaGate({
      greekSelectorGoverned: true,
      entryGreeks: { delta },
      strike: 100,
      expirationDate: EXPIRY,
      fillPrice: 2.5,
      spot: 100,
      right,
      at: AT,
    });
    assert.equal(gate.ok, true);
    assert.equal(gate.ok && gate.deltaSource, "quote");
  }
});

test("final-quote delta below the floor is rejected", () => {
  const gate = signalOptionsFinalQuoteDeltaGate({
    greekSelectorGoverned: true,
    entryGreeks: { delta: 0.05 },
    strike: 471,
    expirationDate: EXPIRY,
    fillPrice: 0.04,
    spot: 521.8,
    right: "put",
    at: AT,
  });
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.reason, "entry_delta_below_floor");
    assert.equal(gate.floor, 0.15);
    assert.equal(gate.deltaSource, "quote");
  }
});

test("missing greeks: a lottery-ticket premium fails via synthetic delta (DIA 471P shape)", () => {
  const gate = signalOptionsFinalQuoteDeltaGate({
    greekSelectorGoverned: true,
    entryGreeks: null,
    strike: 471,
    expirationDate: EXPIRY,
    fillPrice: 0.04,
    spot: 521.8,
    right: "put",
    at: AT,
  });
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.deltaSource, "synthetic");
    assert.ok(Math.abs(gate.delta) < 0.15, `synthetic delta ${gate.delta}`);
  }
});

test("no delta derivable: gate passes open and reports unavailable (never newly blocks on missing data)", () => {
  const gate = signalOptionsFinalQuoteDeltaGate({
    greekSelectorGoverned: true,
    entryGreeks: null,
    strike: null,
    expirationDate: EXPIRY,
    fillPrice: 0.04,
    spot: 521.8,
    right: "put",
    at: AT,
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.ok && gate.deltaSource, "unavailable");
});
