import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BacktestStrategyCatalogItem } from "@workspace/api-client-react";
import { deriveSweepDimensions } from "./sweepDimensions";

function strategy(
  overrides: Partial<BacktestStrategyCatalogItem>,
): BacktestStrategyCatalogItem {
  return {
    strategyId: "test_strategy",
    version: "v1",
    name: "Test strategy",
    description: null,
    defaultParameters: {},
    parameterDefinitions: [],
    ...overrides,
  } as BacktestStrategyCatalogItem;
}

describe("deriveSweepDimensions", () => {
  it("uses contract presets for RayReplica options sweeps", () => {
    const dimensions = deriveSweepDimensions(
      strategy({
        strategyId: "ray_replica_signals",
        parameterDefinitions: [
          {
            key: "contractPresetId",
            label: "Contract preset",
            type: "enum",
            defaultValue: "atm_weekly",
            options: [
              "atm_weekly",
              "delta_30_proxy",
              "delta_60_proxy",
              "lotto_0dte",
              "signal_options_1_3d",
            ],
            min: null,
            max: null,
            step: null,
          },
        ],
      }),
      { executionMode: "options" },
    );

    assert.deepEqual(dimensions, [
      {
        key: "contractPresetId",
        values: [
          "atm_weekly",
          "delta_30_proxy",
          "delta_60_proxy",
          "lotto_0dte",
          "signal_options_1_3d",
        ],
      },
    ]);
  });

  it("uses DTE and strike-slot dimensions for RayReplica signal-options sweeps", () => {
    const dimensions = deriveSweepDimensions(
      strategy({
        strategyId: "ray_replica_signals",
      }),
      { executionMode: "signal_options" },
    );

    assert.deepEqual(dimensions, [
      { key: "signalOptionsTargetDte", values: [1, 2, 3, 5, 7] },
      { key: "signalOptionsCallStrikeSlot", values: [2, 3, 4] },
      { key: "signalOptionsPutStrikeSlot", values: [1, 2, 3] },
    ]);
  });

  it("keeps the generic first-two-parameters fallback for other strategies", () => {
    const dimensions = deriveSweepDimensions(
      strategy({
        parameterDefinitions: [
          {
            key: "lookback",
            label: "Lookback",
            type: "integer",
            defaultValue: 10,
            options: [],
            min: 1,
            max: 20,
            step: 2,
          },
          {
            key: "enabled",
            label: "Enabled",
            type: "boolean",
            defaultValue: true,
            options: [],
            min: null,
            max: null,
            step: null,
          },
          {
            key: "ignored",
            label: "Ignored",
            type: "integer",
            defaultValue: 1,
            options: [],
            min: 0,
            max: 2,
            step: 1,
          },
        ],
      }),
      { lookback: 10, enabled: true },
    );

    assert.deepEqual(dimensions, [
      { key: "lookback", values: [8, 10, 12] },
      { key: "enabled", values: [true, false] },
    ]);
  });
});
