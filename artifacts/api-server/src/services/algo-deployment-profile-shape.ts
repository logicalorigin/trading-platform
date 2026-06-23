function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const OVERNIGHT_SPOT_REPAIRED_SOURCE = "overnight_spot_repaired";

export function stripOvernightSpotFromSignalOptionsConfig(
  configValue: unknown,
): Record<string, unknown> {
  const config = { ...asRecord(configValue) };
  delete config.overnightSpot;

  const parameters = { ...asRecord(config.parameters) };
  delete parameters.overnightSpot;
  delete parameters.overnightSpotTrading;
  if (Object.keys(parameters).length > 0) {
    config.parameters = parameters;
  } else {
    delete config.parameters;
  }

  return config;
}

export function buildOvernightSpotDeploymentConfig(
  configValue: unknown,
): Record<string, unknown> {
  const config = asRecord(configValue);
  const parameters = asRecord(config.parameters);
  const overnightSpot = asRecord(config.overnightSpot);
  const parameterOvernightSpot = asRecord(parameters.overnightSpot);
  const parameterOvernightSpotTrading = asRecord(
    parameters.overnightSpotTrading,
  );
  const profile =
    Object.keys(overnightSpot).length > 0
      ? overnightSpot
      : Object.keys(parameterOvernightSpot).length > 0
        ? parameterOvernightSpot
        : parameterOvernightSpotTrading;

  return {
    source: OVERNIGHT_SPOT_REPAIRED_SOURCE,
    parameters: { overnightSpotTrading: true },
    ...(config.marketDataAccountId !== undefined
      ? { marketDataAccountId: config.marketDataAccountId }
      : {}),
    ...(config.executionAccountId !== undefined
      ? { executionAccountId: config.executionAccountId }
      : {}),
    overnightSpot: profile,
  };
}
