import { FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { Badge } from "../../components/platform/primitives.jsx";
import { PulseDot } from "../../components/ui/PulseDot.jsx";
import { ActionButton } from "../../components/ui/ActionButton.jsx";

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
        background: T.bg1,
        border: "none",
        borderRadius: dim(RADII.sm),
        padding: sp(narrow ? "6px 8px" : "9px 12px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(narrow ? 3 : 5),
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
              background: T.bg1,
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.sm),
              color: T.text,
              padding: sp("6px 10px"),
              fontFamily: T.sans,
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              outline: "none",
              maxWidth: dim(narrow ? 220 : 260),
              minWidth: 0,
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
              fontSize: textSize("caption"),
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
        {!narrow && <Badge color={T.textMuted}>Shadow</Badge>}
        <Badge color={gatewayReady ? T.textSec : T.amber}>
          {gatewayReady ? "DATA" : "BLOCKED"}
        </Badge>
        <Badge color={focusedDeployment?.enabled ? T.green : T.textDim}>
          {focusedDeployment?.enabled ? "ON" : "OFF"}
        </Badge>
        {!narrow && bridgeTone && bridgeTone.color !== T.green ? (
          <Badge color={bridgeTone.color}>{bridgeTone.label.toUpperCase()}</Badge>
        ) : null}
        <div style={{ flex: narrow ? "0 0 100%" : 1 }} />
        <div style={{ display: "flex", gap: sp(5), flexWrap: "wrap" }}>
          <ActionButton
            type="button"
            data-testid="algo-status-refresh"
            onClick={onRefresh}
            pending={refreshPending}
            pendingLabel="Refreshing..."
            size="sm"
          >
            Refresh
          </ActionButton>
          <ActionButton
            type="button"
            data-testid="algo-status-toggle-enable"
            onClick={onToggleEnable}
            disabled={!focusedDeployment || gatewayBridgeLaunching}
            pending={togglePending}
            pendingLabel={focusedDeployment?.enabled ? "Disabling..." : "Enabling..."}
            variant={focusedDeployment?.enabled ? "secondary" : "primary"}
            color={focusedDeployment?.enabled ? T.amber : T.green}
            size="sm"
            style={
              focusedDeployment?.enabled
                ? {
                    border: `1px solid ${T.amber}`,
                    color: T.amber,
                    background: T.bg0,
                  }
                : null
            }
          >
            {focusedDeployment?.enabled ? "Disable" : "Enable"}
          </ActionButton>
          <ActionButton
            type="button"
            data-testid="algo-status-run-scan"
            onClick={onRunScan}
            disabled={!focusedDeployment || gatewayBridgeLaunching}
            pending={scanPending}
            pendingLabel="Scanning..."
            size="sm"
            style={{
              border: !focusedDeployment
                ? "none"
                : `1px solid ${gatewayReady ? T.cyan : T.amber}`,
              background: !focusedDeployment
                ? T.textMuted
                : gatewayReady
                  ? T.cyanBg
                  : T.amberBg,
              color: !focusedDeployment
                ? T.bg0
                : gatewayReady
                  ? T.cyan
                  : T.amber,
            }}
          >
            {!gatewayReady
              ? gatewayBridgeLaunching
                ? "Preparing..."
                : "Start data"
              : "Run scan"}
          </ActionButton>
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
