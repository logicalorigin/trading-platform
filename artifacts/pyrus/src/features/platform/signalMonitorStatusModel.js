const DB_UNAVAILABLE_PROFILE_PREFIX = "db-unavailable-";
const RUNTIME_FALLBACK_PROFILE_PREFIX = "runtime-fallback-";
const RUNTIME_FALLBACK_ERROR_PATTERN =
  /runtime-only signal monitor evaluation/i;
const DB_UNAVAILABLE_ERROR_PATTERN =
  /postgres is unavailable|signal monitor data is temporarily degraded|database unavailable/i;
const PROBLEM_STATE_STATUSES = new Set(["stale", "unavailable", "error"]);

const parseTimeMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

export const isSignalMonitorRuntimeFallbackProfile = (profile) => {
  if (!profile) {
    return false;
  }
  const id = String(profile.id || "");
  const lastError = String(profile.lastError || "");
  return (
    id.startsWith(RUNTIME_FALLBACK_PROFILE_PREFIX) ||
    RUNTIME_FALLBACK_ERROR_PATTERN.test(lastError)
  );
};

export const isSignalMonitorDegradedProfile = (profile) => {
  if (!profile) {
    return false;
  }
  const id = String(profile.id || "");
  const lastError = String(profile.lastError || "");
  return (
    isSignalMonitorRuntimeFallbackProfile(profile) ||
    id.startsWith(DB_UNAVAILABLE_PROFILE_PREFIX) ||
    DB_UNAVAILABLE_ERROR_PATTERN.test(lastError)
  );
};

export const summarizeSignalMonitorStates = (states) => {
  const list = Array.isArray(states) ? states : [];
  const summary = {
    total: list.length,
    fresh: 0,
    ok: 0,
    stale: 0,
    unavailable: 0,
    errored: 0,
    problem: 0,
    allProblem: false,
  };

  list.forEach((state) => {
    const status = String(state?.status || "unknown").toLowerCase();
    if (status === "ok") {
      summary.ok += 1;
    }
    if (status === "stale") {
      summary.stale += 1;
    }
    if (status === "unavailable") {
      summary.unavailable += 1;
    }
    if (status === "error" || state?.lastError) {
      summary.errored += 1;
    }
    if (state?.fresh && status === "ok") {
      summary.fresh += 1;
    }
    if (PROBLEM_STATE_STATUSES.has(status) || state?.lastError) {
      summary.problem += 1;
    }
  });

  summary.allProblem = summary.total > 0 && summary.problem === summary.total;
  return summary;
};

export const resolveSignalMonitorLastEvaluatedAt = ({
  profile,
  states,
} = {}) => {
  const candidates = [
    profile?.lastEvaluatedAt,
    ...(Array.isArray(states)
      ? states.map((state) => state?.lastEvaluatedAt)
      : []),
  ].filter(Boolean);
  let latestValue = null;
  let latestMs = 0;
  candidates.forEach((value) => {
    const timeMs = parseTimeMs(value);
    if (timeMs > latestMs) {
      latestMs = timeMs;
      latestValue = value;
    }
  });
  return latestValue;
};

export const buildSignalMonitorStatusSnapshot = ({
  profile,
  states,
  universe,
} = {}) => {
  const stateSummary = summarizeSignalMonitorStates(states);
  return {
    stateSummary,
    lastEvaluatedAt: resolveSignalMonitorLastEvaluatedAt({ profile, states }),
    configuredMaxSymbols:
      universe?.configuredMaxSymbols ?? profile?.maxSymbols ?? null,
    resolvedSymbols: universe?.resolvedSymbols ?? null,
    pinnedSymbols: universe?.pinnedSymbols ?? null,
    expansionSymbols: universe?.expansionSymbols ?? null,
    shortfall: universe?.shortfall ?? null,
    universeMode: universe?.mode ?? null,
    universeSource: universe?.source ?? null,
    universeFallbackUsed: Boolean(universe?.fallbackUsed),
    universeDegradedReason: universe?.degradedReason ?? null,
  };
};

export const resolveSignalMonitorStatus = ({
  profile,
  pending = false,
  requestErrored = false,
} = {}) => {
  const runtimeFallback = isSignalMonitorRuntimeFallbackProfile(profile);
  const degraded = isSignalMonitorDegradedProfile(profile);
  const enabled = Boolean(profile?.enabled) && !degraded;
  const errored = Boolean(requestErrored || (degraded && !runtimeFallback));

  if (pending) {
    return {
      degraded,
      enabled,
      errored,
      label: "SCANNING",
    };
  }

  if (runtimeFallback) {
    return {
      degraded,
      enabled,
      errored,
      label: "RUNTIME",
    };
  }

  if (errored) {
    return {
      degraded,
      enabled,
      errored,
      label: "SCAN ERROR",
    };
  }

  return {
    degraded,
    enabled,
    errored,
    label: enabled ? "SCAN ON" : "SCAN OFF",
  };
};
