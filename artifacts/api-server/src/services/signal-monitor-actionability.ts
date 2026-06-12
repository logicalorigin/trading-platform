// Single authoring site for signal actionability semantics. `fresh` ("is this
// signal inside the profile's fresh window and backed by current data") and
// the action-age gate ("may automation act on it right now") were previously
// computed independently in three signal-monitor eval paths, in
// signal-options-automation, and in the STA frontend, with the max-age
// constant defined twice. Any policy change must land here and nowhere else.

export const SIGNAL_MONITOR_MAX_ACTIONABLE_BARS_SINCE_SIGNAL = 1;

export type SignalMonitorActionability = {
  fresh: boolean;
  actionEligible: boolean;
  actionBlocker: string | null;
};

export function normalizedBarsSinceSignal(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.round(numeric));
}

export function signalMonitorSignalAgeBlocker(
  barsSinceSignal: unknown,
): string | null {
  const bars = normalizedBarsSinceSignal(barsSinceSignal);
  if (bars == null) return "signal_age_unavailable";
  return bars <= SIGNAL_MONITOR_MAX_ACTIONABLE_BARS_SINCE_SIGNAL
    ? null
    : "signal_too_old";
}

export function signalMonitorFresh(input: {
  barsSinceSignal: number | null;
  freshWindowBars: number;
  stale: boolean;
}): boolean {
  return (
    input.barsSinceSignal != null &&
    input.barsSinceSignal <= input.freshWindowBars &&
    !input.stale
  );
}

export function buildSignalMonitorActionability(input: {
  direction: string | null;
  signalAt: Date | string | null;
  barsSinceSignal: number | null;
  stale: boolean;
  freshWindowBars: number;
}): SignalMonitorActionability {
  const directional = input.direction === "buy" || input.direction === "sell";
  const actionBlocker =
    !directional || !input.signalAt
      ? "no_signal"
      : input.stale
        ? "data_stale"
        : signalMonitorSignalAgeBlocker(input.barsSinceSignal);
  return {
    fresh: signalMonitorFresh(input),
    actionEligible: actionBlocker == null,
    actionBlocker,
  };
}
