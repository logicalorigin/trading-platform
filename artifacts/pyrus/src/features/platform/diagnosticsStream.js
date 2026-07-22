const DIAGNOSTICS_STREAM_URL = "/api/diagnostics/stream";
const EVENT_TYPES = ["ready", "snapshot", "event", "threshold-breach"];

const subscribers = new Set();
let source = null;
let latestReady = null;
let latestSnapshot = null;

const notify = (subscriber, message) => {
  try {
    subscriber(message);
  } catch {}
};

const publish = (message) => {
  if (message.type === "ready") latestReady = message;
  if (message.type === "snapshot") latestSnapshot = message;
  subscribers.forEach((subscriber) => notify(subscriber, message));
};

const clearCachedState = () => {
  latestReady = null;
  latestSnapshot = null;
};

const closeStream = () => {
  source?.close();
  source = null;
  clearCachedState();
};

const openStream = () => {
  if (
    source ||
    typeof window === "undefined" ||
    typeof window.EventSource === "undefined"
  ) {
    return;
  }

  const next = new window.EventSource(DIAGNOSTICS_STREAM_URL);
  source = next;
  EVENT_TYPES.forEach((type) => {
    next.addEventListener(type, (event) => {
      if (source !== next) return;
      try {
        publish({ type, payload: JSON.parse(event.data) });
      } catch {}
    });
  });
  next.onerror = () => {
    if (source === next) {
      clearCachedState();
      publish({ type: "error", payload: null });
    }
  };
};

export const subscribeDiagnosticsStream = (subscriber) => {
  subscribers.add(subscriber);
  if (latestReady) notify(subscriber, latestReady);
  if (latestSnapshot) notify(subscriber, latestSnapshot);
  openStream();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) closeStream();
  };
};

export const __resetDiagnosticsStreamForTests = () => {
  subscribers.clear();
  closeStream();
};
