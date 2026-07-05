import React, { useMemo } from "react";
import {
  CSS_COLOR,
  GLOW,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { FailurePointPopoverBody } from "../../components/platform/FailurePointTooltip.jsx";
import { buildAlgoStatusFailurePoint } from "../../features/platform/failurePointModel.js";

const STATUS_TONE = {
  healthy: CSS_COLOR.green,
  attention: CSS_COLOR.amber,
  warning: CSS_COLOR.amber,
  paused: CSS_COLOR.textDim,
  scanning: CSS_COLOR.cyan,
};

const STATUS_LABEL = {
  healthy: "Healthy",
  attention: "Attention",
  warning: "Warning",
  paused: "Paused",
  scanning: "Scanning",
};

export const resolveOperationsStatus = ({
  gatewayReady,
  scanOn,
  deploymentEnabled,
  attentionSeverity,
}) => {
  if (deploymentEnabled === false) return "paused";
  if (attentionSeverity === "warning") return "warning";
  if (!gatewayReady) return "warning";
  if (scanOn) return "healthy";
  return "attention";
};

const StatusRow = ({ label, value, tone }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: sp(8),
      padding: sp("3px 0"),
      fontFamily: T.sans,
      fontSize: textSize("caption"),
    }}
  >
    <span style={{ color: CSS_COLOR.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {label}
    </span>
    <span style={{ color: tone || CSS_COLOR.text }}>{value}</span>
  </div>
);

export const OperationsStatusOrb = ({
  gatewayReady,
  scanOn,
  deploymentEnabled,
  attentionItems = [],
  cockpitTradePath,
}) => {
  const attentionSeverity = useMemo(() => {
    if (!attentionItems?.length) return null;
    if (attentionItems.some((item) => item?.severity === "warning")) return "warning";
    return "info";
  }, [attentionItems]);

  const status = resolveOperationsStatus({
    gatewayReady,
    scanOn,
    deploymentEnabled,
    attentionSeverity,
  });
  const tone = STATUS_TONE[status];
  const shouldPulse = status === "healthy" || status === "scanning";
  const failurePoint = useMemo(
    () =>
      buildAlgoStatusFailurePoint({
        status,
        gatewayReady,
        scanOn,
        deploymentEnabled,
        attentionItems,
        cockpitTradePath,
      }),
    [attentionItems, cockpitTradePath, deploymentEnabled, gatewayReady, scanOn, status],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="algo-operations-status-orb"
          data-status={status}
          aria-label={`Algo status: ${STATUS_LABEL[status]}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            padding: sp("2px 6px"),
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg1,
            borderRadius: dim(RADII.pill),
            cursor: "pointer",
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <span
            className={shouldPulse ? "ra-pulse-orb" : undefined}
            style={{
              display: "inline-block",
              width: dim(10),
              height: dim(10),
              borderRadius: "50%",
              background: tone,
              "--ra-glow-tone": tone,
              boxShadow: shouldPulse ? GLOW.md : "none",
            }}
          />
          <span>{STATUS_LABEL[status]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6}>
        <div
          style={{
            minWidth: 200,
            padding: sp(2),
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          <div
            style={{
              color: CSS_COLOR.text,
              fontSize: fs(11),
              fontWeight: 600,
              marginBottom: sp(4),
              letterSpacing: "0.01em",
            }}
          >
            Algo status — {STATUS_LABEL[status]}
          </div>
          <StatusRow
            label="Gateway"
            value={gatewayReady ? "ready" : "pending"}
            tone={gatewayReady ? CSS_COLOR.green : CSS_COLOR.red}
          />
          <StatusRow
            label="Scan"
            value={scanOn ? "running" : "paused"}
            tone={scanOn ? CSS_COLOR.green : CSS_COLOR.amber}
          />
          <StatusRow
            label="Deployment"
            value={deploymentEnabled === false ? "paused" : "enabled"}
            tone={deploymentEnabled === false ? CSS_COLOR.textDim : CSS_COLOR.green}
          />
          <StatusRow
            label="Attention"
            value={
              attentionSeverity === "warning"
                ? `${attentionItems.length} warning`
                : attentionSeverity
                    ? `${attentionItems.length} info`
                    : "all clear"
            }
            tone={
              attentionSeverity === "warning"
                ? CSS_COLOR.amber
                : CSS_COLOR.green
            }
          />
          {failurePoint?.severity !== "info" ? (
            <div
              style={{
                borderTop: `1px solid ${CSS_COLOR.border}`,
                marginTop: sp(7),
                paddingTop: sp(8),
              }}
            >
              <FailurePointPopoverBody point={failurePoint} compact />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default OperationsStatusOrb;
