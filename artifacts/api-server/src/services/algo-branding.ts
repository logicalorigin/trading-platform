const LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME =
  "RayReplica Signal Options Shadow Paper";
const CANONICAL_SIGNAL_OPTIONS_DEPLOYMENT_NAME =
  "Pyrus Signals Options Shadow Paper";

const LEGACY_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    new RegExp(LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME, "g"),
    CANONICAL_SIGNAL_OPTIONS_DEPLOYMENT_NAME,
  ],
  [
    /\bRayReplica Signal Options Shadow\b/g,
    "Pyrus Signals Options Shadow",
  ],
  [/\brayalgo-replica-smc-pro-v3\b/gi, "pyrus-signals-smc-pro-v3"],
  [/\bRayAlgo Replica \(SMC Pro v3\)/g, "Pyrus Signals (SMC Pro v3)"],
  [/\bray_replica_signals\b/g, "pyrus_signals"],
  [/\bRayReplica\b/g, "Pyrus Signals"],
  [/rayReplica/g, "pyrusSignals"],
  [/\brayreplica\b/g, "pyrus-signals"],
  [/\bray[-_]replica\b/g, "pyrus-signals"],
  [/\bRAYALGO\b/g, "PYRUS"],
  [/\bRayAlgo\b/g, "Pyrus"],
  [/rayAlgo/g, "pyrus"],
  [/\bRay_Algo\b/g, "Pyrus"],
  [/\bray[-_]?algo\b/g, "pyrus"],
];

const LEGACY_BRANDING_PATTERNS: RegExp[] = [
  /\bRayReplica\b/,
  /rayReplica/,
  /\bRayAlgo\b/,
  /rayAlgo/,
  /\bRay_Algo\b/,
  /\bRAYALGO\b/,
  /\bray_replica_signals\b/,
  /\brayalgo-replica-smc-pro-v3\b/i,
  /\brayreplica\b/i,
  /\bray[-_]replica\b/i,
  /\bray[-_]?algo\b/i,
];

export function normalizeLegacyAlgoBrandText(value: string): string {
  return LEGACY_TEXT_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

export function normalizeLegacyAlgoBranding<T>(value: T): T {
  if (typeof value === "string") {
    return normalizeLegacyAlgoBrandText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyAlgoBranding(item)) as T;
  }

  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      normalizeLegacyAlgoBrandText(key),
      normalizeLegacyAlgoBranding(item),
    ]),
  ) as T;
}

export function hasLegacyAlgoBranding(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value ?? "");
    return LEGACY_BRANDING_PATTERNS.some((pattern) => pattern.test(serialized));
  } catch {
    return false;
  }
}
