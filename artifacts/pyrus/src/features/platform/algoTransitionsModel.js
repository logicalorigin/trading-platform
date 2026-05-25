const MAX_BUFFER = 20;
const SIGNAL_KEY = (signal) =>
  `${signal?.symbol || ""}:${signal?.timeframe || ""}`;

const signalStateOf = (signal) => {
  if (!signal) return "unavailable";
  if (signal.status === "unavailable") return "unavailable";
  if (signal.status === "error") return "error";
  if (signal.fresh === true) return "fresh";
  if (signal.fresh === false) return "stale";
  return "unknown";
};

const indexSignals = (signals = []) => {
  const map = new Map();
  for (const signal of signals) {
    const key = SIGNAL_KEY(signal);
    if (!key.startsWith(":")) {
      map.set(key, signal);
    }
  }
  return map;
};

const timeMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const diffSignalSnapshots = (prevSignals, nextSignals, evaluatedAt) => {
  const transitions = [];
  const prevMap = indexSignals(prevSignals);
  const nextMap = indexSignals(nextSignals);
  for (const [key, nextSignal] of nextMap) {
    const prevSignal = prevMap.get(key);
    const prevState = signalStateOf(prevSignal);
    const nextState = signalStateOf(nextSignal);
    if (prevState !== nextState && prevState !== "unknown") {
      transitions.push({
        id: `signal:${key}:${nextState}:${evaluatedAt || ""}`,
        kind: "signal",
        symbol: nextSignal.symbol,
        timeframe: nextSignal.timeframe,
        prevState,
        nextState,
        timeMs: timeMs(evaluatedAt) || Date.now(),
      });
    }
  }
  return transitions;
};

const EVENT_TYPES_OF_INTEREST = new Set([
  "signal_options_entry",
  "signal_options_skipped",
  "signal_options_blocked",
  "signal_options_gateway_blocked",
  "signal_options_exit",
]);

export const eventToTransition = (event) => {
  const occurredAtMs = timeMs(event?.occurredAt);
  return {
    id: `event:${event?.id || `${event?.eventType}:${event?.symbol || ""}:${occurredAtMs}`}`,
    kind: "event",
    eventType: event?.eventType,
    symbol: event?.symbol,
    summary: event?.summary,
    timeMs: occurredAtMs || Date.now(),
  };
};

export const collectEventTransitions = (events = [], { sinceMs } = {}) => {
  const cutoff = Number.isFinite(sinceMs) ? sinceMs : 0;
  return events
    .filter((event) => EVENT_TYPES_OF_INTEREST.has(event?.eventType))
    .filter((event) => timeMs(event?.occurredAt) >= cutoff)
    .map(eventToTransition);
};

export const mergeTransitions = (transitions = []) => {
  const dedup = new Map();
  for (const transition of transitions) {
    if (!transition || !transition.id) continue;
    const existing = dedup.get(transition.id);
    if (!existing || existing.timeMs < transition.timeMs) {
      dedup.set(transition.id, transition);
    }
  }
  return Array.from(dedup.values()).sort((a, b) => b.timeMs - a.timeMs);
};

export const appendToRingBuffer = (buffer = [], incoming = [], { max = MAX_BUFFER } = {}) => {
  const merged = mergeTransitions([...buffer, ...incoming]);
  return merged.slice(0, max);
};

export const limitToWindow = (transitions = [], { windowMs = 60_000, nowMs = Date.now() } = {}) =>
  transitions.filter((transition) => nowMs - transition.timeMs <= windowMs);

export const buildTransitionsBufferStore = ({ max = MAX_BUFFER } = {}) => {
  const buffersByDeployment = new Map();
  return {
    push(deploymentId, transitions) {
      if (!deploymentId) return [];
      const prev = buffersByDeployment.get(deploymentId) || [];
      const next = appendToRingBuffer(prev, transitions, { max });
      buffersByDeployment.set(deploymentId, next);
      return next;
    },
    get(deploymentId) {
      if (!deploymentId) return [];
      return buffersByDeployment.get(deploymentId) || [];
    },
    prune(activeDeploymentId) {
      if (!activeDeploymentId) {
        buffersByDeployment.clear();
        return;
      }
      for (const key of buffersByDeployment.keys()) {
        if (key !== activeDeploymentId) {
          buffersByDeployment.delete(key);
        }
      }
    },
  };
};

export const __internalsForTests = {
  signalStateOf,
  indexSignals,
  timeMs,
  MAX_BUFFER,
};
