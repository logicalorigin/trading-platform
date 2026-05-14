export const LOCAL_ALERT_STORAGE_KEY = "rayalgo.diagnostics.localAlerts.v1";
export const LOCAL_ALERT_REPEAT_COOLDOWN_MS = 15 * 60_000;
export const LOCAL_ALERT_DISMISS_TTL_MS = 24 * 60 * 60_000;
export const MAX_LOCAL_ALERTS = 50;

const SEVERITY_RANK = {
  success: 0,
  info: 0,
  warning: 1,
  critical: 2,
};

const emptyPreferences = () => ({
  audioEnabled: true,
  alertVolume: 70,
  audioMutedUntil: 0,
  dismissedAlerts: {},
});

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeSeverity = (value) =>
  value === "critical" || value === "warning" || value === "success"
    ? value
    : "info";

const severityRank = (severity) => SEVERITY_RANK[normalizeSeverity(severity)] ?? 0;

const parseTimeMs = (value, fallbackMs) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : fallbackMs;
};

const isoAt = (value, fallbackMs) => new Date(parseTimeMs(value, fallbackMs)).toISOString();

const stablePart = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const thresholdKey = (metricKey) => `threshold:${stablePart(metricKey)}`;

const getLocalAlertStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const eventKey = (event) => {
  if (event.category === "threshold" && event.code) {
    return thresholdKey(event.code);
  }
  if (event.incidentKey) {
    return `event:${stablePart(event.incidentKey)}`;
  }
  const subsystem = stablePart(event.subsystem);
  const category = stablePart(event.category);
  const code = stablePart(event.code || event.category || event.message);
  const key = [subsystem, category, code].filter(Boolean).join(":");
  return key ? `event:${key}` : null;
};

export function isAlertSeverity(severity) {
  return severity === "warning" || severity === "critical";
}

export function normalizeDiagnosticAlert(input, { source = "event", nowMs = Date.now() } = {}) {
  const item = asRecord(input?.payload?.threshold ? input.payload : input);
  const threshold = asRecord(item.threshold || item.raw?.threshold);
  const hasThreshold = Boolean(threshold.metricKey || item.dimensions?.metricKey);
  const severity = normalizeSeverity(item.severity);
  if (!isAlertSeverity(severity)) {
    return null;
  }

  if (hasThreshold || item.category === "threshold") {
    const metricKey = item.code || threshold.metricKey || item.dimensions?.metricKey;
    if (!metricKey) {
      return null;
    }
    const lastSeenAt = isoAt(item.observedAt || item.lastSeenAt, nowMs);
    return {
      key: thresholdKey(metricKey),
      kind: "threshold",
      source,
      severity,
      message:
        item.message ||
        `${threshold.label || metricKey || "Diagnostic threshold"} breached`,
      firstSeenAt: isoAt(item.firstSeenAt || item.observedAt || item.lastSeenAt, nowMs),
      lastSeenAt,
      repeatCount: Number.isFinite(item.eventCount) ? Math.max(1, item.eventCount) : 1,
      audible: threshold.audible !== false,
      eventId: item.id || null,
      incidentKey: item.incidentKey || metricKey,
      subsystem: item.subsystem || threshold.subsystem || null,
      category: "threshold",
      code: metricKey,
      value: Number.isFinite(item.value) ? item.value : null,
      unit: threshold.unit || null,
    };
  }

  const key = eventKey(item);
  if (!key) {
    return null;
  }
  return {
    key,
    kind: "event",
    source,
    severity,
    message: item.message || item.code || item.category || "Diagnostic event",
    firstSeenAt: isoAt(item.firstSeenAt || item.lastSeenAt, nowMs),
    lastSeenAt: isoAt(item.lastSeenAt || item.firstSeenAt, nowMs),
    repeatCount: Number.isFinite(item.eventCount) ? Math.max(1, item.eventCount) : 1,
    audible: true,
    eventId: item.id || null,
    incidentKey: item.incidentKey || key.replace(/^event:/, ""),
    subsystem: item.subsystem || null,
    category: item.category || null,
    code: item.code || null,
    value: null,
    unit: null,
  };
}

export function isLocalAlertDismissed(alert, dismissedAlerts = {}, nowMs = Date.now()) {
  const dismissed = dismissedAlerts[alert.key];
  if (!dismissed || dismissed.until <= nowMs) {
    return false;
  }
  return severityRank(alert.severity) <= severityRank(dismissed.severity);
}

export function applyDiagnosticAlert(
  currentAlerts,
  input,
  {
    source = "event",
    nowMs = Date.now(),
    notify = true,
    dismissedAlerts = {},
    repeatCooldownMs = LOCAL_ALERT_REPEAT_COOLDOWN_MS,
    maxAlerts = MAX_LOCAL_ALERTS,
  } = {},
) {
  const incoming = normalizeDiagnosticAlert(input, { source, nowMs });
  if (!incoming) {
    return { alerts: currentAlerts, alert: null, shouldNotify: false };
  }

  const current = currentAlerts[incoming.key];
  const escalated = current && severityRank(incoming.severity) > severityRank(current.severity);
  const repeatCount = Math.max(
    current ? current.repeatCount + 1 : 1,
    incoming.repeatCount,
  );
  const previousNotifiedAt = current?.lastNotifiedAt || null;
  const lastNotifiedMs = parseTimeMs(previousNotifiedAt, 0);
  const notificationDue =
    !previousNotifiedAt || escalated || nowMs - lastNotifiedMs >= repeatCooldownMs;
  const dismissed = isLocalAlertDismissed(incoming, dismissedAlerts, nowMs);
  const shouldNotify =
    notify && incoming.audible !== false && !dismissed && notificationDue;

  const nextAlert = {
    ...current,
    ...incoming,
    firstSeenAt: current?.firstSeenAt || incoming.firstSeenAt,
    lastSeenAt: incoming.lastSeenAt,
    repeatCount,
    lastNotifiedAt: shouldNotify ? new Date(nowMs).toISOString() : previousNotifiedAt,
  };
  const alerts = trimLocalAlerts(
    {
      ...currentAlerts,
      [incoming.key]: nextAlert,
    },
    maxAlerts,
  );

  return { alerts, alert: nextAlert, shouldNotify };
}

export function reduceDiagnosticAlerts(currentAlerts, inputs, options = {}) {
  return inputs.reduce(
    (state, input) => {
      const result = applyDiagnosticAlert(state.alerts, input, options);
      return {
        alerts: result.alerts,
        notifications: result.shouldNotify
          ? [...state.notifications, result.alert]
          : state.notifications,
      };
    },
    { alerts: currentAlerts, notifications: [] },
  );
}

export function syncDiagnosticSnapshotAlerts(currentAlerts, inputs, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const normalizedAlerts = (Array.isArray(inputs) ? inputs : [inputs])
    .map((input) => normalizeDiagnosticAlert(input, { source: "snapshot", nowMs }))
    .filter(Boolean);
  const activeKeys = new Set(normalizedAlerts.map((alert) => alert.key));
  const reconciledAlerts = Object.fromEntries(
    Object.entries(currentAlerts).filter(([key]) => {
      if (key.startsWith("event:") || key.startsWith("threshold:")) {
        return activeKeys.has(key);
      }
      return true;
    }),
  );

  return reduceDiagnosticAlerts(reconciledAlerts, inputs, {
    ...options,
    source: "snapshot",
    notify: false,
    nowMs,
  });
}

export function trimLocalAlerts(alerts, maxAlerts = MAX_LOCAL_ALERTS) {
  const entries = Object.entries(alerts);
  if (entries.length <= maxAlerts) {
    return alerts;
  }
  return Object.fromEntries(
    entries
      .sort(
        ([, left], [, right]) =>
          parseTimeMs(right.lastSeenAt, 0) - parseTimeMs(left.lastSeenAt, 0),
      )
      .slice(0, maxAlerts),
  );
}

export function sortLocalAlerts(alerts) {
  return Object.values(alerts).sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta) {
      return severityDelta;
    }
    return parseTimeMs(right.lastSeenAt, 0) - parseTimeMs(left.lastSeenAt, 0);
  });
}

export function dismissLocalAlertPreference(
  preferences,
  alert,
  { nowMs = Date.now(), ttlMs = LOCAL_ALERT_DISMISS_TTL_MS } = {},
) {
  return pruneLocalAlertPreferences(
    {
      ...preferences,
      dismissedAlerts: {
        ...preferences.dismissedAlerts,
        [alert.key]: {
          severity: alert.severity,
          until: nowMs + ttlMs,
        },
      },
    },
    { nowMs },
  );
}

export function dismissAllLocalAlertPreferences(preferences, alerts, options = {}) {
  return alerts.reduce(
    (nextPreferences, alert) =>
      dismissLocalAlertPreference(nextPreferences, alert, options),
    preferences,
  );
}

export function restoreLocalAlertPreferences(preferences, keys) {
  const dismissedAlerts = { ...preferences.dismissedAlerts };
  keys.forEach((key) => {
    delete dismissedAlerts[key];
  });
  return {
    ...preferences,
    dismissedAlerts,
  };
}

export function pruneLocalAlertPreferences(
  preferences,
  { nowMs = Date.now(), activeKeys = null } = {},
) {
  const source = {
    ...emptyPreferences(),
    ...asRecord(preferences),
    dismissedAlerts: asRecord(preferences?.dismissedAlerts),
  };
  const dismissedAlerts = Object.fromEntries(
    Object.entries(source.dismissedAlerts).filter(([key, value]) => {
      const record = asRecord(value);
      if (!Number.isFinite(record.until) || record.until <= nowMs) {
        return false;
      }
      return !activeKeys || activeKeys.has(key);
    }),
  );
  return {
    audioEnabled: source.audioEnabled !== false,
    alertVolume: Number.isFinite(Number(source.alertVolume))
      ? Math.max(0, Math.min(100, Number(source.alertVolume)))
      : 70,
    audioMutedUntil:
      Number.isFinite(source.audioMutedUntil) && source.audioMutedUntil > nowMs
        ? source.audioMutedUntil
        : 0,
    dismissedAlerts,
  };
}

export function readLocalAlertPreferences(storage = getLocalAlertStorage()) {
  const target = storage || null;
  if (!target) {
    return emptyPreferences();
  }
  try {
    const parsed = JSON.parse(target.getItem(LOCAL_ALERT_STORAGE_KEY) || "null");
    return pruneLocalAlertPreferences(parsed);
  } catch {
    return emptyPreferences();
  }
}

export function writeLocalAlertPreferences(preferences, storage = getLocalAlertStorage()) {
  const target = storage || null;
  if (!target) {
    return;
  }
  try {
    target.setItem(
      LOCAL_ALERT_STORAGE_KEY,
      JSON.stringify(pruneLocalAlertPreferences(preferences)),
    );
  } catch {
    // Local storage is best effort; diagnostics should keep running without it.
  }
}
