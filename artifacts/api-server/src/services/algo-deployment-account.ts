export const SHADOW_PROVIDER_ACCOUNT_ID = "shadow";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isSignalOptionsShadowConfig(config: unknown): boolean {
  const record = asRecord(config);
  const signalOptions = asRecord(record.signalOptions);
  const parameters = asRecord(record.parameters);
  return (
    Object.keys(signalOptions).length > 0 ||
    parameters.executionMode === "signal_options"
  );
}

export function normalizeAlgoDeploymentProviderAccountId(input: {
  providerAccountId: string;
  config: unknown;
}): string {
  return isSignalOptionsShadowConfig(input.config)
    ? SHADOW_PROVIDER_ACCOUNT_ID
    : input.providerAccountId;
}
