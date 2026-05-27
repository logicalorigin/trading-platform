const LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME =
  "RayReplica Signal Options Shadow Paper";
const CANONICAL_SIGNAL_OPTIONS_DEPLOYMENT_NAME =
  "Pyrus Signals Options Shadow Paper";

const LEGACY_TEXT_REPLACEMENTS = [
  [new RegExp(LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME, "g"), CANONICAL_SIGNAL_OPTIONS_DEPLOYMENT_NAME],
  [/\bRayReplica Signal Options Shadow\b/g, "Pyrus Signals Options Shadow"],
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

export const normalizeLegacyAlgoBrandText = (value) => {
  if (typeof value !== "string") {
    return value;
  }
  return LEGACY_TEXT_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
};
