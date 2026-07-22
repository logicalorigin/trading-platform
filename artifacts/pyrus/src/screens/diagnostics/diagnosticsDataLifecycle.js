export function buildDiagnosticsWindowParams(windowMinutes, nowMs = Date.now()) {
  const to = new Date(nowMs);
  return {
    from: new Date(nowMs - windowMinutes * 60_000).toISOString(),
    to: to.toISOString(),
  };
}
