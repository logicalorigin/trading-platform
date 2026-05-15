import { RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { Badge } from "../../components/platform/primitives.jsx";
import { PulseDot } from "./PulseDot.jsx";

const compactButton = ({
  active = false,
  color = T.border,
  disabled = false,
} = {}) => ({
  padding: sp("5px 9px"),
  borderRadius: dim(RADII.xs),
  border: `1px solid ${active ? color : T.border}`,
  background: active ? `${color}18` : T.bg0,
  color: active ? T.text : T.textSec,
  fontSize: fs(8),
  fontFamily: T.sans,
  fontWeight: 400,
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.62 : 1,
  whiteSpace: "nowrap",
});

export const AlgoStatusBar = ({
  focusedDeployment,
  deployments,
  onSelectDeployment,
  gatewayReady,
  gatewayBridgeLaunching,
  environment,
  bridgeTone,
  accountId,
  lastEvalLabel,
  lastEvalMsAgo = null,
  lastSignalLabel,
  evalsPerMinuteLabel,
  onRefresh,
  onToggleEnable,
  onRunScan,
  refreshPending,
  togglePending,
  scanPending,
  narrow = false,
}) => {
  const evalState =
    !focusedDeployment?.enabled
      ? { active: false, color: T.textMuted, label: "Algo paused" }
      : lastEvalMsAgo != null && lastEvalMsAgo < 60_000
        ? { active: true, color: T.green, label: "Algo evaluating live" }
        : lastEvalMsAgo != null && lastEvalMsAgo < 5 * 60_000
          ? { active: true, color: T.amber, label: "Evaluations slowing" }
          : { active: false, color: T.textDim, label: "Algo idle" };
  const mode = String(focusedDeployment?.mode || environment || "").toUpperCase();
  const symbolCount = focusedDeployment?.symbolUniverse?.length ?? 0;
  const subtitle = focusedDeployment
    ? `${focusedDeployment.name} · ${mode}${symbolCount ? ` · ${symbolCount} sym` : ""}`
    : "no deployment selected";
  const accountLabel =
    accountId || focusedDeployment?.providerAccountId || null;

  return (
    <div
      data-testid="algo-status-bar"
      className="ra-panel-enter"
      style={{
        background: T.bg2,
        border: "none",
        borderRadius: dim(RADII.sm),
        padding: sp(narrow ? "6px 8px" : "9px 12px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(narrow ? 4 : 5),
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: sp(narrow ? 5 : 8),
          minWidth: 0,
        }}
      >
        <PulseDot
          active={evalState.active}
          color={evalState.color}
          label={evalState.label}
          size={narrow ? 7 : 9}
        />
        {!narrow && (
          <span
            style={{
              fontSize: fs(11),
              fontFamily: T.sans,
              color: T.text,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Algo
          </span>
        )}
        {deployments.length ? (
          <select
            data-testid="algo-status-deployment-select"
            value={focusedDeployment?.id || ""}
            onChange={(event) => onSelectDeployment?.(event.target.value)}
            style={{
              background: T.bg3,
              border: "none",
              borderRadius: dim(RADII.xs),
              color: T.text,
              padding: sp("4px 8px"),
              fontFamily: T.sans,
              fontSize: fs(9),
              outline: "none",
              maxWidth: dim(260),
            }}
          >
            {deployments.map((deployment) => (
              <option key={deployment.id} value={deployment.id}>
                {deployment.name} · {String(deployment.mode || "").toUpperCase()} · {deployment.enabled ? "on" : "off"}
              </option>
            ))}
          </select>
        ) : (
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.sans,
              color: T.textDim,
              border: `1px dashed ${T.border}`,
              borderRadius: dim(RADII.xs),
              padding: sp("3px 7px"),
            }}
          >
            create from a promoted draft
          </span>
        )}
        {!narrow && <Badge color={T.textMuted}>SHADOW</Badge>}
        <Badge color={gatewayReady ? T.textSec : T.amber}>
          {gatewayReady ? "DATA" : "BLOCKED"}
        </Badge>
        <Badge color={focusedDeployment?.enabled ? T.green : T.textDim}>
          {focusedDeployment?.enabled ? "ON" : "OFF"}
        </Badge>
        {!narrow && bridgeTone && bridgeTone.color !== T.green ? (
          <Badge color={bridgeTone.color}>{bridgeTone.label.toUpperCase()}</Badge>
        ) : null}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: sp(5), flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="algo-status-refresh"
            onClick={onRefresh}
            disabled={refreshPending}
            style={compactButton({ disabled: refreshPending })}
          >
            REFRESH
          </button>
          <button
            type="button"
            data-testid="algo-status-toggle-enable"
            onClick={onToggleEnable}
            disabled={!focusedDeployment || togglePending || gatewayBridgeLaunching}
            style={compactButton({
              active: Boolean(focusedDeployment?.enabled),
              color: focusedDeployment?.enabled ? T.amber : T.green,
              disabled:
                !focusedDeployment || togglePending || gatewayBridgeLaunching,
            })}
          >
            {focusedDeployment?.enabled ? "PAUSE" : "ENABLE"}
          </button>
          <button
            type="button"
            data-testid="algo-status-run-scan"
            onClick={onRunScan}
            disabled={!focusedDeployment || scanPending || gatewayBridgeLaunching}
            style={{
              ...compactButton({
                disabled:
                  !focusedDeployment || scanPending || gatewayBridgeLaunching,
              }),
              border: "none",
              background: !focusedDeployment
                ? T.textMuted
                : gatewayReady
                  ? T.cyan
                  : T.amber,
              color: "#031216",
            }}
          >
            {scanPending
              ? "SCANNING..."
              : !gatewayReady
                ? gatewayBridgeLaunching
                  ? "PREPARING..."
                  : "START DATA"
                : "RUN SCAN"}
          </button>
        </div>
      </div>
      <div
        style={{
          fontFamily: T.sans,
          fontSize: fs(8),
          color: T.textMuted,
          letterSpacing: "0.04em",
          display: "flex",
          flexWrap: "wrap",
          gap: sp(narrow ? 6 : 10),
        }}
      >
        {!narrow && <span>{subtitle}</span>}
        {accountLabel ? <span>acct {accountLabel}</span> : null}
        {lastEvalLabel ? <span>eval {lastEvalLabel}</span> : null}
        {lastSignalLabel ? <span>sig {lastSignalLabel}</span> : null}
        {!narrow && evalsPerMinuteLabel ? (
          <span>{evalsPerMinuteLabel}</span>
        ) : null}
      </div>
    </div>
  );
};
