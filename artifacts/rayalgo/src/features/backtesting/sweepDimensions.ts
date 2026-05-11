import type { BacktestStrategyCatalogItem } from "@workspace/api-client-react";

type ScalarParameter = string | number | boolean;

type SweepDimension = {
  key: string;
  values: ScalarParameter[];
};

const RAY_REPLICA_OPTIONS_PRESETS = [
  "atm_weekly",
  "delta_30_proxy",
  "delta_60_proxy",
  "lotto_0dte",
  "signal_options_1_3d",
] as const;

const SIGNAL_OPTIONS_SWEEP_DIMENSIONS: SweepDimension[] = [
  { key: "signalOptionsTargetDte", values: [1, 2, 3, 5, 7] },
  { key: "signalOptionsCallStrikeSlot", values: [2, 3, 4] },
  { key: "signalOptionsPutStrikeSlot", values: [1, 2, 3] },
];

function scalarFromUnknown(
  value: unknown,
  fallback: ScalarParameter,
): ScalarParameter {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return fallback;
}

function optionValuesForKey(
  strategy: BacktestStrategyCatalogItem,
  key: string,
): ScalarParameter[] {
  const definition = strategy.parameterDefinitions.find(
    (parameterDefinition) => parameterDefinition.key === key,
  );

  if (!definition) {
    return [];
  }

  return definition.options.filter(
    (value): value is ScalarParameter =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean",
  );
}

function deriveRayReplicaSweepDimensions(
  strategy: BacktestStrategyCatalogItem,
  parameters: Record<string, unknown>,
): SweepDimension[] | null {
  if (strategy.strategyId !== "ray_replica_signals") {
    return null;
  }

  if (parameters.executionMode === "signal_options") {
    return SIGNAL_OPTIONS_SWEEP_DIMENSIONS.map((dimension) => ({
      ...dimension,
      values: [...dimension.values],
    }));
  }

  if (parameters.executionMode === "options") {
    const catalogPresets = optionValuesForKey(strategy, "contractPresetId");
    const presetValues = RAY_REPLICA_OPTIONS_PRESETS.filter((preset) =>
      catalogPresets.length === 0 ? true : catalogPresets.includes(preset),
    );

    return [{ key: "contractPresetId", values: [...presetValues] }];
  }

  return null;
}

export function deriveSweepDimensions(
  strategy: BacktestStrategyCatalogItem | null,
  parameters: Record<string, unknown>,
): SweepDimension[] {
  if (!strategy) {
    return [];
  }

  const rayReplicaDimensions = deriveRayReplicaSweepDimensions(
    strategy,
    parameters,
  );
  if (rayReplicaDimensions) {
    return rayReplicaDimensions;
  }

  const dimensions: SweepDimension[] = [];

  strategy.parameterDefinitions.forEach((definition) => {
    if (dimensions.length >= 2) {
      return;
    }

    const currentValue = scalarFromUnknown(
      parameters[definition.key],
      scalarFromUnknown(definition.defaultValue, ""),
    );

    if (
      (definition.type === "integer" || definition.type === "number") &&
      typeof currentValue === "number"
    ) {
      const step =
        definition.step ??
        (definition.type === "integer" ? 1 : Math.max(0.5, currentValue * 0.1));
      const min = definition.min ?? Math.max(0, currentValue - step);
      const max = definition.max ?? currentValue + step;
      const values = [
        Math.max(min, currentValue - step),
        currentValue,
        Math.min(max, currentValue + step),
      ]
        .map((value) =>
          definition.type === "integer"
            ? Math.round(value)
            : Number(value.toFixed(2)),
        )
        .filter(
          (value, index, collection) => collection.indexOf(value) === index,
        );

      if (values.length > 1) {
        dimensions.push({ key: definition.key, values });
      }
      return;
    }

    if (definition.type === "boolean" && typeof currentValue === "boolean") {
      dimensions.push({
        key: definition.key,
        values: [currentValue, !currentValue],
      });
      return;
    }

    if (definition.options.length > 1) {
      dimensions.push({
        key: definition.key,
        values: definition.options.slice(0, 3),
      });
    }
  });

  return dimensions;
}
