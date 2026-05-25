import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetApiResourcePressureForTests,
  getApiResourcePressureSnapshot,
  updateApiResourcePressure,
} from "./resource-pressure";

afterEach(() => {
  __resetApiResourcePressureForTests();
});

test("resource pressure escalates from API RSS", () => {
  assert.equal(updateApiResourcePressure({ rssMb: 950 }).level, "watch");
  assert.equal(updateApiResourcePressure({ rssMb: 1_250 }).level, "high");
  assert.equal(updateApiResourcePressure({ rssMb: 1_650 }).level, "critical");
});

test("resource pressure caps speculative filler at high pressure", () => {
  updateApiResourcePressure({ rssMb: 1_250 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "high");
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, true);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
  assert.equal(snapshot.caps.watchlistFillerMaxSymbols, 0);
  assert.equal("optionsFlow" in snapshot.caps, false);
});

test("watch pressure does not cap watchlist filler slack", () => {
  updateApiResourcePressure({ dominantSlowRouteP95Ms: 12_000 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "watch");
  assert.equal(snapshot.drivers[0]?.kind, "api-latency");
  assert.equal(snapshot.drivers[0]?.level, "watch");
  assert.equal(snapshot.caps.watchlistFillerMaxSymbols, null);
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.skipDeploymentScans, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, false);
});

test("critical RSS pressure disables speculative filler", () => {
  updateApiResourcePressure({ rssMb: 1_650 });

  const snapshot = getApiResourcePressureSnapshot();

  assert.equal(snapshot.level, "critical");
  assert.equal(snapshot.caps.watchlistFillerMaxSymbols, 0);
  assert.equal("optionsFlow" in snapshot.caps, false);
  assert.equal(snapshot.caps.signalOptions.maintenanceOnly, true);
});
