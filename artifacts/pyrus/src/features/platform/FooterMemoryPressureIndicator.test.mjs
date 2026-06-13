import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApiSourcePressureBars,
  buildFooterPressureBars,
} from "./FooterMemoryPressureIndicator.jsx";
import { buildMemoryPressureState } from "./memoryPressureModel.js";

const findIbkrBar = (runtimeControl) =>
  buildApiSourcePressureBars(runtimeControl, Date.now()).find((bar) => bar.key === "ibkr");

test("footer IBKR source bar uses bridge line counts when present", () => {
  const ibkr = findIbkrBar({
    lineUsage: {
      available: true,
      bridge: {
        used: 77,
        cap: 200,
        streamState: "capacity-limited",
      },
      allocation: {
        bridgeLineBudget: 200,
        targetFillLines: 200,
        remainingToTargetLineCount: 123,
      },
    },
  });

  assert.equal(ibkr.label, "IBKR 77/200");
  assert.equal(ibkr.detail, "IBKR 77 of 200 · 123 free");
});

test("footer IBKR source bar treats full bridge allocation as normal without pressure", () => {
  const ibkr = findIbkrBar({
    lineUsage: {
      available: true,
      bridge: {
        used: 200,
        cap: 200,
        free: 0,
        streamState: "healthy",
      },
      allocation: {
        bridgeLineBudget: 200,
        targetFillLines: 200,
      },
    },
  });

  assert.equal(ibkr.label, "IBKR 200/200");
  assert.equal(ibkr.level, "normal");
});

test("footer IBKR source bar still warns on explicit limited bridge state", () => {
  const ibkr = findIbkrBar({
    lineUsage: {
      available: true,
      warnings: 1,
      bridge: {
        used: 200,
        cap: 200,
        free: 0,
        streamState: "capacity-limited",
      },
    },
  });

  assert.equal(ibkr.label, "IBKR 200/200");
  assert.equal(ibkr.level, "high");
});

test("footer IBKR source bar uses bridge usage over app admission demand", () => {
  const ibkr = findIbkrBar({
    lineUsage: {
      available: true,
      activeLineCount: 5,
      total: {
        used: 77,
        cap: 200,
        free: 123,
      },
      bridge: {
        used: 11,
        cap: 150,
        free: 139,
        streamState: "capacity-limited",
      },
      allocation: {
        bridgeLineBudget: 150,
        targetFillLines: 150,
        remainingToTargetLineCount: 139,
      },
    },
  });

  assert.equal(ibkr.label, "IBKR 11/150");
  assert.match(ibkr.detail, /IBKR 11 of 150/);
});

test("footer IBKR source bar labels derived Trade Options Chain demand as active", () => {
  const ibkr = findIbkrBar({
    lineUsage: {
      available: true,
      total: {
        used: 77,
        cap: 200,
        free: 123,
      },
      bridge: {
        used: 77,
        cap: 200,
        free: 123,
      },
      allocation: {
        tradeOptionsChainReserveLineCount: 12,
      },
    },
  });

  assert.match(ibkr.detail, /12 Trade Options Chain active/);
  assert.doesNotMatch(ibkr.detail, /reserved/);
});

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
