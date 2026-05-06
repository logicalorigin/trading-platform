import { useCallback, useEffect, useMemo, useState } from "react";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";

const THRESHOLD_EVENT = "rayalgo:diagnostic-thresholds-updated";

function smallButton({ active = false } = {}) {
  return {
    border: `1px solid ${active ? T.green : T.border}`,
    background: active ? T.greenBg : T.bg2,
    color: active ? T.green : T.textSec,
    borderRadius: dim(4),
    padding: sp("5px 8px"),
    fontFamily: T.mono,
    fontSize: fs(9),
    fontWeight: 900,
    cursor: "pointer",
  };
}

function inputLabel() {
  return {
    display: "flex",
    flexDirection: "column",
    gap: sp(4),
    color: T.textDim,
    fontFamily: T.mono,
    fontSize: fs(9),
    fontWeight: 800,
  };
}

function inputStyle() {
  return {
    border: `1px solid ${T.border}`,
    background: T.bg0,
    color: T.text,
    borderRadius: dim(4),
    padding: sp("6px 7px"),
    fontFamily: T.mono,
    fontSize: fs(10),
    minWidth: 0,
  };
}

export function useDiagnosticThresholdSettings() {
  const [thresholds, setThresholds] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/diagnostics/thresholds", { headers: { Accept: "application/json" } })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        const next = payload.thresholds || [];
        setThresholds(next);
        setDrafts(next);
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Diagnostic thresholds are unavailable.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const listener = () => load();
    window.addEventListener(THRESHOLD_EVENT, listener);
    return () => window.removeEventListener(THRESHOLD_EVENT, listener);
  }, [load]);

  const dirtyCount = useMemo(() => {
    const byKey = new Map(thresholds.map((threshold) => [threshold.metricKey, threshold]));
    return drafts.reduce((count, draft) => {
      const original = byKey.get(draft.metricKey) || {};
      return count +
        (draft.warning !== original.warning ||
        draft.critical !== original.critical ||
        draft.enabled !== original.enabled ||
        draft.audible !== original.audible
          ? 1
          : 0);
    }, 0);
  }, [drafts, thresholds]);

  const updateDraft = useCallback((index, patch) => {
    setDrafts((current) => {
      const next = [...current];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const discard = useCallback(() => {
    setDrafts(thresholds);
  }, [thresholds]);

  const save = useCallback(() => {
    setSaving(true);
    setError(null);
    fetch("/api/diagnostics/thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ thresholds: drafts }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        const next = payload.thresholds || [];
        setThresholds(next);
        setDrafts(next);
        window.dispatchEvent(new CustomEvent(THRESHOLD_EVENT));
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Failed to save diagnostic thresholds.");
      })
      .finally(() => setSaving(false));
  }, [drafts]);

  return {
    thresholds,
    drafts,
    loading,
    saving,
    error,
    dirtyCount,
    updateDraft,
    discard,
    reload: load,
    save,
  };
}

export function DiagnosticThresholdSettingsPanel({
  title = "Threshold Overrides",
  description = null,
  compact = false,
}) {
  const {
    drafts,
    loading,
    saving,
    error,
    dirtyCount,
    updateDraft,
    discard,
    reload,
    save,
  } = useDiagnosticThresholdSettings();

  return (
    <section
      className="ra-panel-enter"
      style={{
        border: `1px solid ${T.border}`,
        background: T.bg1,
        borderRadius: dim(6),
        padding: sp(12),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: sp(10),
          marginBottom: sp(10),
        }}
      >
        <div>
          <div style={{ fontSize: fs(12), fontWeight: 800 }}>{title}</div>
          {description && (
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), marginTop: sp(4) }}>
              {description}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: sp(7), flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={reload} disabled={loading} style={smallButton()}>
            Refresh
          </button>
          <button type="button" onClick={discard} disabled={dirtyCount === 0 || saving} style={smallButton()}>
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={dirtyCount === 0 || saving}
            style={{
              ...smallButton({ active: dirtyCount > 0 }),
              opacity: dirtyCount > 0 ? 1 : 0.55,
            }}
          >
            {saving ? "Saving" : `Save ${dirtyCount || ""}`.trim()}
          </button>
        </div>
      </div>
      {error && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
          {error}
        </div>
      )}
      {loading && drafts.length === 0 ? (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(10) }}>
          Loading diagnostic thresholds.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: compact
              ? "repeat(auto-fit, minmax(230px, 1fr))"
              : "repeat(auto-fit, minmax(260px, 1fr))",
            gap: sp(10),
          }}
        >
          {drafts.map((threshold, index) => (
            <div
              key={threshold.metricKey}
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: dim(5),
                padding: sp(9),
                background: T.bg2,
              }}
            >
              <div style={{ color: T.text, fontWeight: 800, fontSize: fs(11), marginBottom: sp(6) }}>
                {threshold.label || threshold.metricKey}
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(8) }}>
                {threshold.metricKey} / {threshold.unit || MISSING_VALUE}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
                <label style={inputLabel()}>
                  Warn
                  <input
                    type="number"
                    value={threshold.warning ?? ""}
                    onChange={(event) =>
                      updateDraft(index, { warning: Number(event.target.value) })
                    }
                    style={inputStyle()}
                  />
                </label>
                <label style={inputLabel()}>
                  Critical
                  <input
                    type="number"
                    value={threshold.critical ?? ""}
                    onChange={(event) =>
                      updateDraft(index, { critical: Number(event.target.value) })
                    }
                    style={inputStyle()}
                  />
                </label>
              </div>
              <label style={{ ...inputLabel(), flexDirection: "row", alignItems: "center", marginTop: sp(8) }}>
                <input
                  type="checkbox"
                  checked={Boolean(threshold.enabled)}
                  onChange={(event) => updateDraft(index, { enabled: event.target.checked })}
                />
                Enabled
              </label>
              <label style={{ ...inputLabel(), flexDirection: "row", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={Boolean(threshold.audible)}
                  onChange={(event) => updateDraft(index, { audible: event.target.checked })}
                />
                Audible
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
