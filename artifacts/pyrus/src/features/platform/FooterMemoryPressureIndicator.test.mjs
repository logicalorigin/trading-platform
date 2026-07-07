import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApiSourcePressureBars,
  buildFooterPressureBars,
} from "./FooterMemoryPressureIndicator.jsx";
import { buildMemoryPressureState } from "./memoryPressureModel.js";

test("footer compact pressure bars omit runtime store diagnostics", () => {
  const signal = buildMemoryPressureState({
    browserMemoryMb: 128,
    browserMemoryLimitMb: 4096,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 12,
    queryCount: 0,
    heavyQueryCount: 0,
    storeEntryCount: 273,
  });

  const runtimeStores = signal.pressureDrivers.find(
    (driver) => driver.kind === "runtime-stores",
  );
  const bars = buildFooterPressureBars({
    signal,
    runtimeControl: {},
    nowMs: Date.now(),
  });

  assert.equal(signal.level, "normal");
  assert.equal(signal.storeEntryCount, 273);
  assert.equal(runtimeStores?.level, "high");
  assert.equal(runtimeStores?.contribution, 0);
  assert.equal(
    signal.dominantDrivers.some((driver) => driver.kind === "runtime-stores"),
    false,
  );
  assert.equal(
    bars.some((bar) => bar.key === "app" || bar.driverKind === "runtime-stores"),
    false,
  );
});
