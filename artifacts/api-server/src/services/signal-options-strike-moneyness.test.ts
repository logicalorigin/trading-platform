import assert from "node:assert/strict";
import test from "node:test";

import {
  signalOptionsStrikeStepSize,
  signalOptionsStrikeWithinMoneyness,
} from "./signal-options-automation";

// Regression for the DIA 471P @ spot ~521.8 deep-OTM shadow entry. A stale durable
// option chain carried only strikes 467-471 while the live underlying was ~521.8;
// the legacy slot picker clamped to the top available strike (471, ~9.7% OTM,
// delta ~0). The moneyness guard rejects any selected strike that the chain could
// not have bracketed near the money.
test("rejects the deep-OTM strike from a stale/mis-centered chain (DIA 471P @ ~521.8)", () => {
  const strikes = [467, 468, 469, 470, 471];
  assert.equal(
    signalOptionsStrikeWithinMoneyness({
      strike: 471,
      spot: 521.814715,
      strikes,
    }),
    false,
  );
});

test("accepts a near-ATM strike from a well-centered chain", () => {
  const strikes = [519, 520, 521, 522, 523];
  assert.equal(
    signalOptionsStrikeWithinMoneyness({ strike: 522, spot: 521.8, strikes }),
    true,
  );
});

test("scales by strike step so a near-ATM pick on a low-priced underlying passes", () => {
  // A ~$25 leveraged ETF with $1 strikes: a couple strikes out is a large percent
  // but still a legitimate near-money entry.
  const strikes = [23, 24, 25, 26, 27];
  assert.equal(
    signalOptionsStrikeWithinMoneyness({ strike: 27, spot: 25, strikes }),
    true,
  );
});

test("does not block when the live spot is unknown (guard cannot be applied)", () => {
  assert.equal(
    signalOptionsStrikeWithinMoneyness({
      strike: 471,
      spot: null,
      strikes: [467, 471],
    }),
    true,
  );
});

test("strike step size is the median gap and null for thin chains", () => {
  assert.equal(signalOptionsStrikeStepSize([100, 101, 102, 110]), 1);
  assert.equal(signalOptionsStrikeStepSize([10]), null);
});
