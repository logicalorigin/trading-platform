import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Badge } from "../../components/platform/primitives.jsx";
import { PulseDot } from "../../components/ui/PulseDot.jsx";
import { ActionButton } from "../../components/ui/ActionButton.jsx";
import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";
import {
  resolveAlgoDeploymentKind,
  ALGO_DEPLOYMENT_KIND_LABELS,
} from "./algoHelpers.js";

const resolveDeploymentAccountLabel = ({ deployment, accountId }) => {
  const providerAccountId = deployment?.providerAccountId || null;
  if (providerAccountId) {
    return providerAccountId;
  }
  return accountId || null;
};

export const AlgoStatusBar = ({
  focusedDeployment,
  deployments,
  onSelectDeployment,
  gatewayReady,
  signalScanReady = true,
  signalScanBlockedReason = null,
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
      ? { active: false, color: CSS_COLOR.textMuted, label: "Algo paused" }
      : lastEvalMsAgo != null && lastEvalMsAgo < 60_000
        ? { active: true, color: CSS_COLOR.green, label: "Algo evaluating live" }
        : lastEvalMsAgo != null && lastEvalMsAgo < 5 * 60_000
          ? { active: true, color: CSS_COLOR.amber, label: "Evaluations slowing" }
          : { active: false, color: CSS_COLOR.textDim, label: "Algo idle" };
  const mode = String(focusedDeployment?.mode || environment || "").toUpperCase();
  const symbolCount = focusedDeployment?.symbolUniverse?.length ?? 0;
  const focusedDeploymentName = normalizeLegacyAlgoBrandText(
    focusedDeployment?.name || "",
  );
  const subtitle = focusedDeployment
    ? `${focusedDeploymentName} · ${mode}${symbolCount ? ` · ${symbolCount} sym` : ""}`
    : "no deployment selected";
  const accountLabel = resolveDeploymentAccountLabel({
    deployment: focusedDeployment,
    accountId,
  });

  return (
    <div
      data-testid="algo-status-bar"
      className="ra-panel-enter"
      style={{
        background: CSS_COLOR.bg1,
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
              color: CSS_COLOR.text,
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
              background: CSS_COLOR.bg1,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.text,
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
                {normalizeLegacyAlgoBrandText(deployment.name)} · {String(deployment.mode || "").toUpperCase()} · {deployment.enabled ? "on" : "off"} · {ALGO_DEPLOYMENT_KIND_LABELS[resolveAlgoDeploymentKind(deployment)]}
              </option>
            ))}
          </select>
        ) : (
          <span
            style={{
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              color: CSS_COLOR.textDim,
              border: `1px dashed ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              padding: sp("3px 7px"),
            }}
          >
            create from a promoted draft
          </span>
        )}
        {!narrow && <Badge color={CSS_COLOR.textMuted}>Shadow</Badge>}
        <Badge color={gatewayReady ? CSS_COLOR.textSec : CSS_COLOR.amber}>
          {gatewayReady ? "BROKER" : "BROKER OFF"}
        </Badge>
        {!signalScanReady ? (
          <Badge color={CSS_COLOR.amber}>
            {signalScanBlockedReason ? "SCAN PAUSED" : "SCAN BLOCKED"}
          </Badge>
        ) : null}
        {signalScanReady ? (
          <Badge color={CSS_COLOR.cyan}>
            SCAN READY
          </Badge>
        ) : null}
        <Badge color={focusedDeployment?.enabled ? CSS_COLOR.green : CSS_COLOR.textDim}>
          {focusedDeployment?.enabled ? "ON" : "OFF"}
        </Badge>
        {!narrow && bridgeTone && bridgeTone.color !== CSS_COLOR.green ? (
          <Badge color={bridgeTone.color}>{bridgeTone.label.toUpperCase()}</Badge>
        ) : null}
        <div style={{ flex: narrow ? "0 0 100%" : 1 }} />
        <div style={{ display: "flex", gap: sp(5), flexWrap: "wrap" }}>
          <ActionButton
            type="button"
            data-testid="algo-status-refresh"
            onClick={onRefresh}
            pending={refreshPending}
            pendingLabel="Syncing..."
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
            color={focusedDeployment?.enabled ? CSS_COLOR.amber : CSS_COLOR.green}
            size="sm"
            style={
              focusedDeployment?.enabled
                ? {
                    border: `1px solid ${CSS_COLOR.amber}`,
                    color: CSS_COLOR.amber,
                    background: CSS_COLOR.bg0,
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
            disabled={!focusedDeployment || !signalScanReady}
            pending={scanPending}
            pendingLabel="Scanning..."
            size="sm"
            style={{
              border: !focusedDeployment
                ? "none"
                : `1px solid ${signalScanReady ? CSS_COLOR.cyan : CSS_COLOR.amber}`,
              background: !focusedDeployment
                ? CSS_COLOR.textMuted
                : signalScanReady
                  ? cssColorMix(CSS_COLOR.cyan, 10)
                  : CSS_COLOR.amberBg,
              color: !focusedDeployment
                ? CSS_COLOR.bg0
                : signalScanReady
                  ? CSS_COLOR.cyan
                  : CSS_COLOR.amber,
            }}
          >
            {signalScanReady ? "Run scan" : "Scan paused"}
          </ActionButton>
        </div>
      </div>
      <div
        style={{
          fontFamily: T.sans,
          fontSize: fs(8),
          color: CSS_COLOR.textMuted,
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
