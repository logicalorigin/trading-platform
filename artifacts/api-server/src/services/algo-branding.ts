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

// Every legacy pattern above contains "ray" (case-insensitive). A single cheap
// scan lets us skip the 14 regex replacements for the overwhelmingly common
// case of strings that have no legacy branding at all.
const LEGACY_BRAND_HINT = /ray/i;

export function normalizeLegacyAlgoBrandText(value: string): string {
  if (!LEGACY_BRAND_HINT.test(value)) {
    return value;
  }
  return LEGACY_TEXT_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

// Renames legacy brand tokens in strings/arrays/objects (including keys). Output
// is JSON-identical to `value` when nothing matches, and callers only ever
// serialize the result.
//
// Fast path: the recursive walk below allocates per object/array node
// (`Object.entries(...).map(...)`) and runs a regex per key — on the universe-wide
// algo/cockpit payloads that showed up as a top event-loop cost in a live CPU
// profile. The overwhelmingly common case is a payload with NO legacy branding
// anywhere, so at the ENTRY (not per recursive node) do a single native
// JSON.stringify + one "ray" scan: if the serialized form has no "ray", the walk
// would return `value` unchanged, so skip it entirely and return by reference.
// Dirty payloads (rare; legacy branding is being retired) fall through to the
// structural walk; non-serializable values (circular ref / BigInt) also fall
// through, preserving prior behavior.
export function normalizeLegacyAlgoBranding<T>(value: T): T {
  if (value && typeof value === "object") {
    try {
      if (!LEGACY_BRAND_HINT.test(JSON.stringify(value))) {
        return value;
      }
    } catch {
      // Non-serializable (circular ref / BigInt): defer to the structural walk.
    }
  }
  return normalizeLegacyAlgoBrandingWalk(value);
}

function normalizeLegacyAlgoBrandingWalk<T>(value: T): T {
  if (typeof value === "string") {
    return normalizeLegacyAlgoBrandText(value) as T;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const normalized = normalizeLegacyAlgoBrandingWalk(item);
      if (normalized !== item) {
        changed = true;
      }
      return normalized;
    });
    return (changed ? next : value) as T;
  }

  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  let changed = false;
  const nextEntries = Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => {
      const nextKey = normalizeLegacyAlgoBrandText(key);
      const nextItem = normalizeLegacyAlgoBrandingWalk(item);
      if (nextKey !== key || nextItem !== item) {
        changed = true;
      }
      return [nextKey, nextItem] as const;
    },
  );
  return (changed ? Object.fromEntries(nextEntries) : value) as T;
}

export function hasLegacyAlgoBranding(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value ?? "");
    return LEGACY_BRANDING_PATTERNS.some((pattern) => pattern.test(serialized));
  } catch {
    return false;
  }
}
