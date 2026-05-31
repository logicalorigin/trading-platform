import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePyrusSignalsSettingsWithAlgoDefaults,
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

test("Algo signal settings update default chart Pyrus Signals fields", () => {
  const settings = resolvePyrusSignalsSettingsWithAlgoDefaults({
    currentSettings: {
      timeHorizon: 8,
      bosConfirmation: "wicks",
      chochAtrBuffer: 0,
      showDashboard: false,
      bullColor: "#123456",
    },
    signalMonitorProfile: {
      timeframe: "15m",
      pyrusSignalsSettings: {
        timeHorizon: 12,
        bosConfirmation: "close",
        chochAtrBuffer: 0.25,
        chochBodyExpansionAtr: 1.5,
        chochVolumeGate: 1.2,
      },
    },
  });

  assert.equal(settings.timeHorizon, 12);
  assert.equal(settings.bosConfirmation, "close");
  assert.equal(settings.chochAtrBuffer, 0.25);
  assert.equal(settings.chochBodyExpansionAtr, 1.5);
  assert.equal(settings.chochVolumeGate, 1.2);
  assert.equal(settings.showDashboard, false);
  assert.equal(settings.bullColor, "#123456");
});

test("Algo signal settings preserve chart-local signal overrides", () => {
  const settings = resolvePyrusSignalsSettingsWithAlgoDefaults({
    currentSettings: {
      timeHorizon: 6,
      bosConfirmation: "wicks",
      chochAtrBuffer: 0,
    },
    signalMonitorProfile: {
      pyrusSignalsSettings: {
        timeHorizon: 12,
        bosConfirmation: "close",
        chochAtrBuffer: 0.25,
      },
    },
  });

  assert.equal(settings.timeHorizon, 6);
  assert.equal(settings.bosConfirmation, "close");
  assert.equal(settings.chochAtrBuffer, 0.25);
});

test("Algo signal settings refresh fields previously synced from the Algo profile", () => {
  const settings = resolvePyrusSignalsSettingsWithAlgoDefaults({
    currentSettings: {
      timeHorizon: 12,
      bosConfirmation: "close",
      chochAtrBuffer: 0.25,
    },
    previousAlgoSettings: {
      timeHorizon: 12,
      bosConfirmation: "close",
      chochAtrBuffer: 0.25,
    },
    signalMonitorProfile: {
      pyrusSignalsSettings: {
        timeHorizon: 16,
        bosConfirmation: "wicks",
        chochAtrBuffer: 0.5,
      },
    },
  });

  assert.equal(settings.timeHorizon, 16);
  assert.equal(settings.bosConfirmation, "wicks");
  assert.equal(settings.chochAtrBuffer, 0.5);
});
