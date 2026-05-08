const DB_UNAVAILABLE_PROFILE_PREFIX = "db-unavailable-";
const DB_UNAVAILABLE_ERROR_PATTERN =
  /postgres is unavailable|signal monitor data is temporarily degraded|database unavailable/i;

export const isSignalMonitorDegradedProfile = (profile) => {
  if (!profile) {
    return false;
  }
  const id = String(profile.id || "");
  const lastError = String(profile.lastError || "");
  return (
    id.startsWith(DB_UNAVAILABLE_PROFILE_PREFIX) ||
    DB_UNAVAILABLE_ERROR_PATTERN.test(lastError)
  );
};

export const resolveSignalMonitorStatus = ({
  profile,
  pending = false,
  requestErrored = false,
} = {}) => {
  const degraded = isSignalMonitorDegradedProfile(profile);
  const enabled = Boolean(profile?.enabled) && !degraded;
  const errored = Boolean(degraded || requestErrored);

  if (pending) {
    return {
      degraded,
      enabled,
      errored,
      label: "SCANNING",
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
