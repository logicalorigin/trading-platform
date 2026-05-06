import { useCallback, useMemo, useState } from "react";
import {
  LANE_GROUPS,
  LANE_PRESETS,
  LANE_SOURCE_IDS,
  LANE_SOURCE_LABELS,
  LANE_SOURCE_SHORT_LABELS,
  buildLaneWarnings,
  isEditableLane,
  isSystemLane,
  mergeLanePolicy,
  normalizeLaneSymbol,
  normalizeLaneSymbolList,
  resolveLanePreview,
} from "./ibkrLaneUiModel";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";

const formatCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString() : MISSING_VALUE;

const formatDuration = (value) => {
  if (!Number.isFinite(value)) return MISSING_VALUE;
  const seconds = Math.max(0, Math.floor(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

const formatAgo = (value) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp)
    ? `${formatDuration(Date.now() - timestamp)} ago`
    : MISSING_VALUE;
};

function Panel({ title, action, children }) {
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
        <div style={{ fontSize: fs(12), fontWeight: 400 }}>{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function smallButton() {
  return {
    border: `1px solid ${T.border}`,
    background: T.bg2,
    color: T.textSec,
    borderRadius: dim(4),
    padding: sp("5px 8px"),
    fontFamily: T.mono,
    fontSize: fs(9),
    fontWeight: 400,
    cursor: "pointer",
  };
}

function chipRemoveButton() {
  return {
    border: "none",
    background: "transparent",
    color: T.textDim,
    padding: 0,
    fontFamily: T.mono,
    fontSize: fs(8),
    fontWeight: 400,
    cursor: "pointer",
    lineHeight: 1,
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

function laneChip(color) {
  return {
    border: `1px solid ${color}66`,
    background: T.bg1,
    color,
    borderRadius: dim(4),
    padding: sp("3px 5px"),
    fontFamily: T.mono,
    fontSize: fs(8),
    fontWeight: 400,
    maxWidth: "100%",
    overflowWrap: "anywhere",
  };
}

const laneStatusTone = (status) => {
  if (status === "normal") return T.green;
  if (status === "degraded" || status === "backoff") return T.amber;
  if (status === "stalled") return T.red;
  return T.textDim;
};

const formatLaneValue = (value, unit) => {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    return `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
  }
  return value == null || value === "" ? MISSING_VALUE : String(value);
};

function LaneControlEditor({ control, draftValue, onChange, onReset }) {
  const value = draftValue === undefined ? control.value : draftValue;
  const changed = draftValue !== undefined;
  const commonStyle = {
    ...inputStyle(),
    width: "100%",
    minHeight: dim(32),
  };

  let input = null;
  if (control.kind === "boolean") {
    input = (
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(7),
          color: T.textSec,
          fontFamily: T.mono,
          fontSize: fs(10),
          fontWeight: 400,
        }}
      >
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(control.id, event.target.checked)}
        />
        {Boolean(value) ? "ON" : "OFF"}
      </label>
    );
  } else if (control.kind === "select") {
    input = (
      <select
        value={value ?? ""}
        onChange={(event) => onChange(control.id, event.target.value)}
        style={commonStyle}
      >
        {(control.options || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (control.kind === "list") {
    input = (
      <input
        type="text"
        value={Array.isArray(value) ? value.join(", ") : value ?? ""}
        onChange={(event) => onChange(control.id, event.target.value)}
        style={commonStyle}
      />
    );
  } else {
    input = (
      <input
        type="number"
        value={value ?? ""}
        min={control.min}
        max={control.max}
        step={control.step || 1}
        onChange={(event) => onChange(control.id, event.target.value)}
        style={commonStyle}
      />
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px, 1fr) minmax(150px, 0.9fr) 76px",
        gap: sp(9),
        alignItems: "center",
        borderTop: `1px solid ${T.border}55`,
        padding: sp("8px 0"),
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T.text, fontSize: fs(10), fontWeight: 400 }}>
          {control.label}
        </div>
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {control.source} / default {formatLaneValue(control.defaultValue, control.unit)}
        </div>
      </div>
      {input}
      <button
        type="button"
        onClick={() => onReset(control.id)}
        disabled={!control.overridden && !changed}
        style={{
          ...smallButton(),
          opacity: control.overridden || changed ? 1 : 0.45,
          cursor: control.overridden || changed ? "pointer" : "default",
        }}
      >
        Reset
      </button>
    </div>
  );
}

const editableLaneSources = LANE_SOURCE_IDS.filter((sourceId) => sourceId !== "system");

const laneSourceTone = (sourceId) => {
  if (sourceId === "manual") return T.green;
  if (sourceId === "flow-universe") return T.amber;
  if (sourceId === "watchlists") return T.textSec;
  if (sourceId === "built-in") return T.textDim;
  return T.textDim;
};

function sourceBadge(sourceId) {
  const tone = laneSourceTone(sourceId);
  return {
    border: `1px solid ${tone}66`,
    background: T.bg0,
    color: tone,
    borderRadius: dim(3),
    padding: sp("1px 3px"),
    fontFamily: T.mono,
    fontSize: fs(7),
    fontWeight: 400,
    lineHeight: 1.1,
  };
}

function LaneMiniMetric({ label, value, tone = T.textSec }) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}88`,
        borderRadius: dim(5),
        background: T.bg1,
        padding: sp("6px 7px"),
        minWidth: 0,
      }}
    >
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(7), fontWeight: 400 }}>
        {label}
      </div>
      <div style={{ color: tone, fontFamily: T.mono, fontSize: fs(12), fontWeight: 400 }}>
        {value}
      </div>
    </div>
  );
}

function LaneSymbolChipEditor({ label, values, onChange, disabled = false }) {
  const [draft, setDraft] = useState("");
  const [invalidText, setInvalidText] = useState("");
  const symbols = normalizeLaneSymbolList(values);

  const addSymbols = useCallback((text) => {
    const pieces = String(text || "").split(/[\s,;]+/).filter(Boolean);
    const valid = pieces.map(normalizeLaneSymbol).filter(Boolean);
    const invalid = pieces.filter((piece) => !normalizeLaneSymbol(piece));
    if (valid.length) {
      onChange([...new Set([...symbols, ...valid])]);
    }
    setInvalidText(invalid.slice(0, 4).join(", "));
    setDraft("");
  }, [onChange, symbols]);

  const removeSymbol = useCallback((symbol) => {
    onChange(symbols.filter((entry) => entry !== symbol));
  }, [onChange, symbols]);

  return (
    <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: sp(5),
          minHeight: dim(64),
          border: `1px solid ${T.border}`,
          borderRadius: dim(5),
          background: T.bg0,
          padding: sp(6),
        }}
      >
        {symbols.map((symbol) => (
          <span key={symbol} style={{ ...laneChip(T.textSec), display: "inline-flex", gap: sp(4), alignItems: "center" }}>
            {symbol}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeSymbol(symbol)}
                style={chipRemoveButton()}
                aria-label={`Remove ${symbol}`}
              >
                x
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalidText("");
            }}
            onBlur={() => addSymbols(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
                event.preventDefault();
                addSymbols(draft);
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              addSymbols(event.clipboardData.getData("text"));
            }}
            placeholder="Add symbol"
            style={{
              flex: "1 1 90px",
              minWidth: dim(90),
              border: "none",
              outline: "none",
              background: "transparent",
              color: T.text,
              fontFamily: T.mono,
              fontSize: fs(10),
            }}
          />
        )}
      </div>
      {invalidText && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(8) }}>
          Ignored invalid: {invalidText}
        </div>
      )}
    </div>
  );
}

function LaneSymbolPreview({ title, preview, kind }) {
  const sourceMap = new Map(
    (preview.desiredSymbols || []).map((entry) => [entry.symbol, entry.sources || []]),
  );
  const entries =
    kind === "dropped"
      ? preview.droppedSymbols || []
      : (preview.admittedSymbols || []).map((symbol) => ({
          symbol,
          sources: sourceMap.get(symbol) || [],
        }));
  const limit = kind === "dropped" ? 16 : 28;
  const tone = kind === "dropped" ? T.amber : T.green;

  return (
    <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
      <div style={{ color: kind === "dropped" ? T.amber : T.textDim, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400 }}>
        {title}
      </div>
      <div style={{ display: "flex", gap: sp(5), flexWrap: "wrap" }}>
        {entries.slice(0, limit).map((entry) => (
          <span
            key={`${kind}-${entry.symbol}-${entry.reason || ""}`}
            style={{
              ...laneChip(tone),
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
            }}
          >
            {entry.symbol}
            {kind === "dropped" && entry.reason ? `:${entry.reason}` : ""}
            {(entry.sources || []).slice(0, 2).map((sourceId) => (
              <span key={sourceId} style={sourceBadge(sourceId)}>
                {LANE_SOURCE_SHORT_LABELS[sourceId] || sourceId}
              </span>
            ))}
          </span>
        ))}
        {entries.length > limit && (
          <span style={laneChip(T.textDim)}>+{entries.length - limit}</span>
        )}
        {!entries.length && <span style={laneChip(T.textDim)}>none</span>}
      </div>
    </div>
  );
}

function LaneMembershipCard({
  laneState,
  onPolicyChange,
  onResetPolicy,
}) {
  const { lane, preview, mergedPolicy, defaultPolicy, warnings, changed } = laneState;
  const editable = isEditableLane(lane.laneId);
  const active = Number.isFinite(lane.activeCount) ? lane.activeCount : preview.admittedSymbols.length;
  const queued = Number.isFinite(lane.queuedCount) ? lane.queuedCount : 0;
  const cap = Math.max(1, preview.maxSymbols || lane.maxSymbols || 1);
  const usage = Math.min(1, active / cap);
  const hasCapacityDrops = preview.droppedSymbols.some((entry) => entry.reason === "capacity");
  const tone = !preview.enabled
    ? T.textDim
    : warnings.some((warning) => warning.severity === "warning") || hasCapacityDrops
      ? T.amber
      : laneStatusTone(active >= cap ? "degraded" : "normal");

  return (
    <div
      style={{
        border: `1px solid ${tone}66`,
        borderRadius: dim(6),
        background: T.bg2,
        padding: sp(10),
        display: "grid",
        gap: sp(10),
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: sp(10), alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: sp(6), flexWrap: "wrap" }}>
            <span style={{ color: T.text, fontSize: fs(12), fontWeight: 400 }}>{lane.label}</span>
            {changed && <span style={laneChip(T.green)}>staged</span>}
            {isSystemLane(lane.laneId) && <span style={laneChip(T.textDim)}>protected</span>}
          </div>
          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}>
            {preview.admittedSymbols.length}/{preview.desiredSymbols.length} admitted
            {preview.droppedSymbols.length ? ` / ${preview.droppedSymbols.length} dropped` : ""}
            {queued ? ` / ${queued} queued` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(6), flexWrap: "wrap", justifyContent: "flex-end" }}>
          {editable && defaultPolicy && (
            <button
              type="button"
              onClick={() => onResetPolicy(lane.laneId, defaultPolicy)}
              style={smallButton()}
            >
              Reset Lane
            </button>
          )}
          <label style={{ display: "inline-flex", alignItems: "center", gap: sp(6), color: editable ? T.textSec : T.textDim, fontFamily: T.mono, fontSize: fs(9), fontWeight: 400 }}>
            <input
              type="checkbox"
              disabled={!editable}
              checked={preview.enabled}
              onChange={(event) => onPolicyChange(lane.laneId, { enabled: event.target.checked })}
            />
            {preview.enabled ? "ON" : "OFF"}
          </label>
        </div>
      </div>

      <div style={{ height: dim(6), borderRadius: dim(3), background: T.bg0, overflow: "hidden", border: `1px solid ${T.border}` }}>
        <div style={{ height: "100%", width: `${Math.round(usage * 100)}%`, background: tone }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: sp(7) }}>
        <LaneMiniMetric label="ACTIVE" value={formatCount(active)} tone={active >= cap ? T.amber : T.textSec} />
        <LaneMiniMetric label="CAP" value={formatCount(cap)} />
        <LaneMiniMetric label="DROPPED" value={formatCount(preview.droppedSymbols.length)} tone={preview.droppedSymbols.length ? T.amber : T.green} />
        <LaneMiniMetric label="QUEUED" value={formatCount(queued)} tone={queued ? T.amber : T.textSec} />
      </div>

      {editable ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr)", gap: sp(8), alignItems: "center" }}>
            <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), fontWeight: 400 }}>Max Symbols</span>
            <input
              type="number"
              min={1}
              max={lane.laneId === "flow-scanner" ? 2000 : 500}
              value={mergedPolicy.maxSymbols ?? lane.maxSymbols}
              onChange={(event) => onPolicyChange(lane.laneId, { maxSymbols: event.target.value })}
              style={inputStyle()}
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
            {editableLaneSources.map((source) => (
              <label
                key={source}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(5),
                  border: `1px solid ${mergedPolicy.sources?.[source] ? laneSourceTone(source) : T.border}`,
                  color: mergedPolicy.sources?.[source] ? laneSourceTone(source) : T.textSec,
                  background: mergedPolicy.sources?.[source] ? T.greenBg : T.bg1,
                  borderRadius: dim(4),
                  padding: sp("4px 6px"),
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 400,
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(mergedPolicy.sources?.[source])}
                  onChange={(event) =>
                    onPolicyChange(lane.laneId, {
                      sources: { [source]: event.target.checked },
                    })
                  }
                />
                {LANE_SOURCE_LABELS[source]}
              </label>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: sp(8) }}>
            <LaneSymbolChipEditor
              label="Manual Symbols"
              values={mergedPolicy.manualSymbols || []}
              onChange={(symbols) => onPolicyChange(lane.laneId, { manualSymbols: symbols })}
            />
            <LaneSymbolChipEditor
              label="Excluded Symbols"
              values={mergedPolicy.excludedSymbols || []}
              onChange={(symbols) => onPolicyChange(lane.laneId, { excludedSymbols: symbols })}
            />
          </div>
        </>
      ) : (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: dim(5), background: T.bg1, padding: sp(8), color: T.textDim, fontFamily: T.mono, fontSize: fs(9) }}>
          System lane membership is read-only.
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ display: "grid", gap: sp(5) }}>
          {warnings.map((warning) => (
            <div
              key={`${warning.code}-${warning.message}`}
              style={{
                color: warning.severity === "warning" ? T.amber : T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
              }}
            >
              {warning.message}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: sp(8) }}>
        <LaneSymbolPreview title="Admitted Preview" preview={preview} kind="admitted" />
        {preview.droppedSymbols.length > 0 && (
          <LaneSymbolPreview title="Dropped Preview" preview={preview} kind="dropped" />
        )}
      </div>
    </div>
  );
}

function LaneDashboardSummary({ snapshot, laneStates, changedCount }) {
  const dataLaneStates = laneStates.filter((state) => !isSystemLane(state.lane.laneId));
  const totalDesired = dataLaneStates.reduce((sum, state) => sum + state.preview.desiredSymbols.length, 0);
  const totalAdmitted = dataLaneStates.reduce((sum, state) => sum + state.preview.admittedSymbols.length, 0);
  const totalDropped = dataLaneStates.reduce((sum, state) => sum + state.preview.droppedSymbols.length, 0);
  const totalQueued = laneStates.reduce(
    (sum, state) => sum + (Number.isFinite(state.lane.queuedCount) ? state.lane.queuedCount : 0),
    0,
  );
  const scanner = laneStates.find((state) => state.lane.laneId === "flow-scanner");
  const bridgeError = snapshot?.state?.bridgeError;
  const bridge = snapshot?.state?.bridge;
  const bridgeTone = bridgeError ? T.amber : bridge ? T.green : T.textDim;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: sp(8) }}>
      <LaneMiniMetric label="BRIDGE" value={bridgeError ? "CHECK" : bridge ? "READY" : "WAIT"} tone={bridgeTone} />
      <LaneMiniMetric label="ADMITTED" value={`${formatCount(totalAdmitted)}/${formatCount(totalDesired)}`} tone={totalDropped ? T.amber : T.green} />
      <LaneMiniMetric label="DROPPED" value={formatCount(totalDropped)} tone={totalDropped ? T.amber : T.green} />
      <LaneMiniMetric label="QUEUED" value={formatCount(totalQueued)} tone={totalQueued ? T.amber : T.textSec} />
      <LaneMiniMetric label="SCANNER" value={formatCount(scanner?.preview?.admittedSymbols.length ?? 0)} />
      <LaneMiniMetric label="STAGED" value={formatCount(changedCount)} tone={changedCount ? T.green : T.textDim} />
      <LaneMiniMetric label="REFRESHED" value={formatAgo(snapshot?.updatedAt)} />
    </div>
  );
}

function LanePresetBar({ onApplyPreset }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: sp(8),
      }}
    >
      {LANE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onApplyPreset(preset.id)}
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: dim(6),
            background: T.bg2,
            padding: sp(9),
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <div style={{ color: T.text, fontSize: fs(11), fontWeight: 400 }}>
            {preset.label}
          </div>
          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), marginTop: sp(3) }}>
            {preset.description}
          </div>
        </button>
      ))}
    </div>
  );
}

function LaneSaveSummary({ changedCount, warnings, bridgeReady, onDiscard }) {
  if (!changedCount && bridgeReady) {
    return null;
  }

  return (
    <div
      style={{
        border: `1px solid ${changedCount ? T.green : T.amber}66`,
        borderRadius: dim(6),
        background: T.bg2,
        padding: sp(10),
        display: "grid",
        gap: sp(7),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8), flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ color: changedCount ? T.green : T.amber, fontFamily: T.mono, fontSize: fs(9), fontWeight: 400 }}>
          {changedCount ? `${changedCount} staged change${changedCount === 1 ? "" : "s"}` : "Bridge launcher required to save lane edits"}
        </div>
        {changedCount > 0 && (
          <button type="button" onClick={onDiscard} style={smallButton()}>
            Discard
          </button>
        )}
      </div>
      {warnings.length > 0 && (
        <div style={{ display: "grid", gap: sp(4) }}>
          {warnings.slice(0, 6).map((warning) => (
            <div key={`${warning.laneId}-${warning.code}-${warning.message}`} style={{ color: warning.severity === "warning" ? T.amber : T.textDim, fontFamily: T.mono, fontSize: fs(8) }}>
              {warning.message}
            </div>
          ))}
          {warnings.length > 6 && (
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}>
              +{warnings.length - 6} more warning{warnings.length - 6 === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LaneGroupSection({ group, laneStateById, onPolicyChange, onResetPolicy }) {
  const states = group.laneIds.map((laneId) => laneStateById.get(laneId)).filter(Boolean);
  if (!states.length) {
    return null;
  }

  return (
    <section style={{ display: "grid", gap: sp(8) }}>
      <div style={{ color: T.text, fontSize: fs(12), fontWeight: 400 }}>{group.label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: sp(12) }}>
        {states.map((laneState) => (
          <LaneMembershipCard
            key={laneState.lane.laneId}
            laneState={laneState}
            onPolicyChange={onPolicyChange}
            onResetPolicy={onResetPolicy}
          />
        ))}
      </div>
    </section>
  );
}

function LaneArchitectureSection({ snapshot }) {
  return (
    <section style={{ display: "grid", gap: sp(9) }}>
      <div style={{ color: T.text, fontSize: fs(12), fontWeight: 400 }}>How Data Moves</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: sp(10) }}>
        {(snapshot.layers || []).map((layer) => (
          <div key={layer.id} style={{ border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp(10), background: T.bg2 }}>
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), fontWeight: 400, marginBottom: sp(8) }}>
              {layer.label}
            </div>
            <div style={{ display: "grid", gap: sp(8) }}>
              {(layer.nodes || []).map((node) => (
                <div
                  key={node.id}
                  style={{
                    border: `1px solid ${laneStatusTone(node.status)}66`,
                    borderRadius: dim(5),
                    padding: sp(9),
                    background: T.bg1,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8), alignItems: "center" }}>
                    <span style={{ color: T.text, fontSize: fs(11), fontWeight: 400 }}>{node.label}</span>
                    <span style={{ color: laneStatusTone(node.status), fontFamily: T.mono, fontSize: fs(8), fontWeight: 400 }}>
                      {String(node.status || "unknown").toUpperCase()}
                    </span>
                  </div>
                  <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), marginTop: sp(4) }}>
                    {node.summary}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: sp(7) }}>
        {(snapshot.edges || []).map((edge) => (
          <span
            key={`${edge.from}-${edge.to}`}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(4),
              padding: sp("5px 7px"),
              color: T.textSec,
              fontFamily: T.mono,
              fontSize: fs(8),
              background: T.bg2,
            }}
          >
            {edge.from} {"->"} {edge.to}: {edge.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function AdvancedLaneControls({ controlGroups, drafts, onChange, onReset }) {
  return (
    <section style={{ display: "grid", gap: sp(9) }}>
      <div style={{ color: T.text, fontSize: fs(12), fontWeight: 400 }}>Advanced Controls</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: sp(14) }}>
        {Array.from(controlGroups.entries()).map(([group, groupControls]) => (
          <div key={group} style={{ minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: fs(12), fontWeight: 400, marginBottom: sp(6) }}>
              {group}
            </div>
            {groupControls.map((control) => (
              <LaneControlEditor
                key={control.id}
                control={control}
                draftValue={drafts[control.id]}
                onChange={onChange}
                onReset={onReset}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function IbkrLaneArchitecturePanel({
  snapshot,
  drafts = {},
  policyDrafts = {},
  saving,
  error,
  bridgeReady,
  onChange,
  onReset,
  onPolicyChange,
  onResetPolicy,
  onApplyPreset,
  onDiscard,
  onSave,
  onReload,
}) {
  const controls = snapshot?.controls || [];
  const controlGroups = controls.reduce((groups, control) => {
    const list = groups.get(control.group) || [];
    list.push(control);
    groups.set(control.group, list);
    return groups;
  }, new Map());
  const changedCount =
    Object.keys(drafts).length + Object.keys(policyDrafts || {}).length;
  const memberships = snapshot?.memberships || [];
  const policies = snapshot?.policy?.lanes || {};
  const defaultPolicies = snapshot?.policy?.defaults || {};
  const laneStates = useMemo(() => memberships.map((lane) => {
    const basePolicy = policies[lane.laneId] || {};
    const draft = policyDrafts?.[lane.laneId] || {};
    const mergedPolicy = mergeLanePolicy(basePolicy, draft);
    const preview = resolveLanePreview(lane, mergedPolicy);
    const defaultPolicy = defaultPolicies[lane.laneId];
    const warnings = buildLaneWarnings({
      lane: preview,
      basePolicy,
      mergedPolicy,
      defaultPolicy,
    });
    return {
      lane,
      basePolicy,
      defaultPolicy,
      draft,
      mergedPolicy,
      preview,
      warnings,
      changed: Boolean(policyDrafts?.[lane.laneId]),
    };
  }), [memberships, policies, policyDrafts, defaultPolicies]);
  const laneStateById = useMemo(
    () => new Map(laneStates.map((state) => [state.lane.laneId, state])),
    [laneStates],
  );
  const warningItems = laneStates.flatMap((state) => state.warnings);

  return (
    <Panel
      title="IBKR Data Lanes"
      action={
        <div style={{ display: "flex", gap: sp(7), flexWrap: "wrap" }}>
          <button type="button" onClick={onReload} style={smallButton()}>
            Refresh
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!bridgeReady || saving || changedCount === 0}
            style={{
              ...smallButton(),
              borderColor: changedCount > 0 ? T.green : T.border,
              color: changedCount > 0 ? T.green : T.textSec,
              opacity: bridgeReady && changedCount > 0 ? 1 : 0.5,
              cursor: bridgeReady && changedCount > 0 ? "pointer" : "default",
            }}
          >
            {saving ? "Saving" : `Save ${changedCount || ""}`.trim()}
          </button>
        </div>
      }
    >
      {error && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
          {error}
        </div>
      )}
      {!snapshot ? (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(10) }}>
          Loading lane architecture.
        </div>
      ) : (
        <div style={{ display: "grid", gap: sp(16) }}>
          <LaneDashboardSummary
            snapshot={snapshot}
            laneStates={laneStates}
            changedCount={changedCount}
          />
          <LaneSaveSummary
            changedCount={changedCount}
            warnings={warningItems}
            bridgeReady={bridgeReady}
            onDiscard={onDiscard}
          />
          <LanePresetBar onApplyPreset={(presetId) => onApplyPreset(presetId, defaultPolicies)} />
          {LANE_GROUPS.map((group) => (
            <LaneGroupSection
              key={group.id}
              group={group}
              laneStateById={laneStateById}
              onPolicyChange={onPolicyChange}
              onResetPolicy={onResetPolicy}
            />
          ))}
          <LaneArchitectureSection snapshot={snapshot} />
          <AdvancedLaneControls
            controlGroups={controlGroups}
            drafts={drafts}
            onChange={onChange}
            onReset={onReset}
          />
        </div>
      )}
    </Panel>
  );
}
