import assert from "node:assert/strict";
import test from "node:test";

import {
  OVERNIGHT_SPOT_LIVE_CONFIRM_ENV,
  OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
  OVERNIGHT_SPOT_LIVE_ENABLE_ENV,
  resolveEquityExecutionProfile,
  resolveOvernightSpotProfile,
  type EquityExecutionConfig,
} from "./overnight-spot-automation";

test("canonical equity execution composes styles with shared profile and risk settings", () => {
  const equityExecution = {
    styles: ["day", "overnight"],
    enabled: true,
    executionMode: "shadow",
    accountId: "U-CANONICAL",
    requireActionableSignal: false,
    defaultOrderNotional: 750,
    maxOrderNotional: 1_500,
    maxShareQuantity: 12,
    maxSpreadPercent: 0.5,
  } satisfies EquityExecutionConfig;

  const profile = resolveEquityExecutionProfile({
    config: { equityExecution },
    providerAccountId: "U-FALLBACK",
  });

  assert.deepEqual(profile.styles, ["day", "overnight"]);
  assert.equal(profile.enabled, true);
  assert.equal(profile.executionMode, "shadow");
  assert.equal(profile.accountId, "U-CANONICAL");
  assert.equal(profile.requireActionableSignal, false);
  assert.equal(profile.defaultOrderNotional, 750);
  assert.equal(profile.maxOrderNotional, 1_500);
  assert.equal(profile.maxShareQuantity, 12);
  assert.equal(profile.maxSpreadPercent, 0.5);
});

test("user config cannot override server-owned live gates", () => {
  const userSettings = {
    enabled: true,
    liveEnableEnv: "ATTACKER_ENABLE",
    liveConfirmEnv: "ATTACKER_CONFIRM",
    liveConfirmValue: "yes",
  };
  const configs = [
    {
      equityExecution: {
        styles: ["overnight"],
        ...userSettings,
      },
    },
    {
      overnightSpot: {
        tradingSession: "overnight",
        ...userSettings,
      },
    },
  ];

  for (const config of configs) {
    const profile = resolveEquityExecutionProfile({ config });

    assert.equal(profile.liveEnableEnv, OVERNIGHT_SPOT_LIVE_ENABLE_ENV);
    assert.equal(profile.liveConfirmEnv, OVERNIGHT_SPOT_LIVE_CONFIRM_ENV);
    assert.equal(profile.liveConfirmValue, OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE);
  }
});

test("canonical equity execution accepts day-only and overnight-only selections", () => {
  for (const styles of [["day"], ["overnight"]] as const) {
    const profile = resolveEquityExecutionProfile({
      config: {
        equityExecution: {
          styles: [...styles],
          enabled: true,
        } satisfies EquityExecutionConfig,
      },
    });

    assert.deepEqual(profile.styles, styles);
    assert.equal(profile.enabled, true);
    assert.equal(profile.executionMode, "shadow");
  }
});

test("canonical equity execution wins over every legacy alias", () => {
  const profile = resolveEquityExecutionProfile({
    config: {
      equityExecution: {
        styles: ["day"],
        enabled: true,
        defaultOrderNotional: 100,
      } satisfies EquityExecutionConfig,
      overnightSpot: {
        enabled: true,
        tradingSession: "overnight_plus_day",
        defaultOrderNotional: 900,
      },
      parameters: {
        overnightSpot: {
          enabled: true,
          tradingSession: "overnight_plus_day",
          defaultOrderNotional: 800,
        },
        overnightSpotTrading: {
          enabled: true,
          tradingSession: "overnight_plus_day",
          defaultOrderNotional: 700,
        },
      },
    },
  });

  assert.deepEqual(profile.styles, ["day"]);
  assert.equal(profile.defaultOrderNotional, 100);
});

test("malformed canonical styles win and fail closed", () => {
  const malformedCanonicalValues: unknown[] = [
    undefined,
    null,
    true,
    [],
    { enabled: true },
    { enabled: true, styles: null },
    { enabled: true, styles: "overnight" },
    { enabled: true, styles: [] },
    { enabled: true, styles: ["DAY"] },
    { enabled: true, styles: ["day", "extended"] },
    { enabled: true, styles: ["overnight", 1] },
  ];

  for (const equityExecution of malformedCanonicalValues) {
    const profile = resolveEquityExecutionProfile({
      config: {
        equityExecution,
        overnightSpot: {
          enabled: true,
          tradingSession: "overnight",
        },
      },
    });

    assert.deepEqual(profile.styles, []);
    assert.equal(profile.enabled, false);
    assert.equal(profile.executionMode, "disabled");
  }
});

test("legacy overnight aliases decode into canonical style selections", () => {
  const legacyInputs = [
    {
      config: {
        overnightSpot: {
          enabled: true,
          tradingSession: "overnight_plus_day",
          maxOrderNotional: 1_001,
        },
      },
      styles: ["day", "overnight"],
      maxOrderNotional: 1_001,
    },
    {
      config: {
        parameters: {
          overnightSpot: {
            enabled: true,
            tradingSession: "overnight",
            maxOrderNotional: 1_002,
          },
        },
      },
      styles: ["overnight"],
      maxOrderNotional: 1_002,
    },
    {
      config: {
        parameters: {
          overnightSpotTrading: {
            enabled: true,
            tradingSession: "overnight_plus_day",
            maxOrderNotional: 1_003,
          },
        },
      },
      styles: ["day", "overnight"],
      maxOrderNotional: 1_003,
    },
  ] as const;

  for (const legacy of legacyInputs) {
    const profile = resolveEquityExecutionProfile({ config: legacy.config });

    assert.deepEqual(profile.styles, legacy.styles);
    assert.equal(profile.enabled, true);
    assert.equal(profile.executionMode, "shadow");
    assert.equal(profile.maxOrderNotional, legacy.maxOrderNotional);
  }
});

test("legacy profiles retain the overnight default but reject explicit unknown sessions", () => {
  const defaulted = resolveEquityExecutionProfile({
    config: { overnightSpot: { enabled: true } },
  });
  const invalid = resolveEquityExecutionProfile({
    config: {
      overnightSpot: {
        enabled: true,
        tradingSession: "extended",
      },
    },
  });

  assert.deepEqual(defaulted.styles, ["overnight"]);
  assert.equal(defaulted.enabled, true);
  assert.deepEqual(invalid.styles, []);
  assert.equal(invalid.enabled, false);
  assert.equal(invalid.executionMode, "disabled");
});

test("the legacy overnight projection preserves sessions and excludes day-only profiles", () => {
  const legacyOvernight = resolveOvernightSpotProfile({
    config: {
      overnightSpot: {
        enabled: true,
        tradingSession: "overnight",
      },
    },
  });
  const combined = resolveOvernightSpotProfile({
    config: {
      equityExecution: {
        styles: ["day", "overnight"],
        enabled: true,
      } satisfies EquityExecutionConfig,
    },
  });
  const dayOnly = resolveOvernightSpotProfile({
    config: {
      equityExecution: {
        styles: ["day"],
        enabled: true,
      } satisfies EquityExecutionConfig,
    },
  });

  assert.equal(legacyOvernight.tradingSession, "overnight");
  assert.equal(legacyOvernight.enabled, true);
  assert.equal(combined.tradingSession, "overnight_plus_day");
  assert.equal(combined.enabled, true);
  assert.equal(dayOnly.tradingSession, "overnight");
  assert.equal(dayOnly.enabled, false);
  assert.equal(dayOnly.executionMode, "disabled");
});
