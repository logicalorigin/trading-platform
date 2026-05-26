import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePersistedPyrusSignalsSettings,
} from "./chartIndicatorPersistence.js";

test("Pyrus Signals chart defaults align with the signal-monitor profile", () => {
  const settings = resolvePersistedPyrusSignalsSettings(null);

  assert.equal(settings.timeHorizon, 8);
  assert.equal(settings.bosConfirmation, "wicks");
});

test("legacy chart signal defaults migrate to the signal-monitor profile defaults", () => {
  const settings = resolvePersistedPyrusSignalsSettings({
    timeHorizon: 10,
    bosConfirmation: "close",
    showDashboard: false,
  });

  assert.equal(settings.timeHorizon, 8);
  assert.equal(settings.bosConfirmation, "wicks");
  assert.equal(settings.showDashboard, false);
});
