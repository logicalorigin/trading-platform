const STORE_KEY = "__spyAppRuntimeDiagnosticsStore";

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toSerializable(value) {
  if (value == null) {
    return null;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function getStore() {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = {
      entries: new Map(),
    };
  }
  return globalThis[STORE_KEY];
}

export function upsertRuntimeActivity(activityId, descriptor = {}) {
  const id = normalizeText(activityId);
  if (!id) {
    return null;
  }

  const store = getStore();
  const previous = store.entries.get(id);
  const updatedAt = new Date().toISOString();
  if (descriptor.active === false) {
    store.entries.delete(id);
    return null;
  }

  const intervalMs = Number(descriptor.intervalMs);
  const next = {
    id,
    kind: normalizeText(descriptor.kind) || previous?.kind || "activity",
    label: normalizeText(descriptor.label) || previous?.label || id,
    surface: normalizeText(descriptor.surface) || previous?.surface || null,
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0
      ? Math.round(intervalMs)
      : (previous?.intervalMs ?? null),
    meta: descriptor.meta !== undefined
      ? toSerializable(descriptor.meta)
      : (previous?.meta ?? null),
    startedAt: previous?.startedAt || updatedAt,
    updatedAt,
  };
  store.entries.set(id, next);
  return next;
}

export function clearRuntimeActivity(activityId) {
  const id = normalizeText(activityId);
  if (!id) {
    return;
  }
  getStore().entries.delete(id);
}

export function getRuntimeDiagnosticsSnapshot() {
  const entries = Array.from(getStore().entries.values())
    .sort((left, right) => left.id.localeCompare(right.id));
  const byKind = {};
  const bySurface = {};

  for (const entry of entries) {
    byKind[entry.kind] = Number(byKind[entry.kind] || 0) + 1;
    if (entry.surface) {
      bySurface[entry.surface] = Number(bySurface[entry.surface] || 0) + 1;
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    activeCount: entries.length,
    byKind,
    bySurface,
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      surface: entry.surface,
      intervalMs: entry.intervalMs ?? null,
      startedAt: entry.startedAt,
      updatedAt: entry.updatedAt,
      meta: entry.meta ?? null,
    })),
  };
}
