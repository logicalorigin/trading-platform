export function getSettingsChangeStatus({
  loading = false,
  saving = false,
  error = null,
  dirtyCount = 0,
  applyOutcome = null,
  hasSnapshot = false,
} = {}) {
  if (saving) {
    const count = Math.max(0, Number(dirtyCount) || 0);
    return {
      kind: "working",
      label:
        count > 0
          ? `Applying ${count} ${count === 1 ? "change" : "changes"}…`
          : "Applying changes…",
    };
  }
  if (loading) {
    return {
      kind: "working",
      label: hasSnapshot ? "Refreshing settings…" : "Loading settings…",
    };
  }
  if (error || applyOutcome === "partial" || applyOutcome === "error") {
    return { kind: "error", label: "Settings need attention" };
  }
  if (dirtyCount > 0) {
    return {
      kind: "dirty",
      label: `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`,
    };
  }
  if (applyOutcome === "success") {
    return { kind: "success", label: "Changes applied" };
  }
  return { kind: "idle", label: "No unsaved changes" };
}

export function settleSettingsDrafts({
  currentDrafts = {},
  submittedDrafts = {},
  rejectedKeys = [],
} = {}) {
  const rejected = new Set(rejectedKeys);
  return Object.fromEntries(
    Object.entries(currentDrafts).filter(([key, value]) => {
      if (!(key in submittedDrafts)) return true;
      if (!Object.is(value, submittedDrafts[key])) return true;
      return rejected.has(key);
    }),
  );
}
