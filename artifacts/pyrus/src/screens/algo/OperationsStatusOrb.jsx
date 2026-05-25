import React, { useMemo } from "react";
import {
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

const STATUS_TONE = {
  healthy: T.green,
  attention: T.amber,
  critical: T.red,
  paused: T.textDim,
  scanning: T.cyan,
};

const STATUS_LABEL = {
  healthy: "Healthy",
  attention: "Attention",
  critical: "Critical",
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
  if (attentionSeverity === "critical") return "critical";
  if (!gatewayReady) return "critical";
  if (attentionSeverity === "warning") return "attention";
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
    <span style={{ color: T.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {label}
    </span>
    <span style={{ color: tone || T.text }}>{value}</span>
  </div>
);

export const OperationsStatusOrb = ({
  gatewayReady,
  scanOn,
  deploymentEnabled,
  attentionItems = [],
}) => {
  const attentionSeverity = useMemo(() => {
    if (!attentionItems?.length) return null;
    if (attentionItems.some((item) => item?.severity === "critical")) return "critical";
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
            border: `1px solid ${T.border}`,
            background: T.bg1,
            borderRadius: dim(999),
            cursor: "pointer",
            color: T.textSec,
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
              boxShadow: shouldPulse ? `0 0 6px ${tone}88` : "none",
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
              color: T.text,
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
            tone={gatewayReady ? T.green : T.red}
          />
          <StatusRow
            label="Scan"
            value={scanOn ? "running" : "paused"}
            tone={scanOn ? T.green : T.amber}
          />
          <StatusRow
            label="Deployment"
            value={deploymentEnabled === false ? "paused" : "enabled"}
            tone={deploymentEnabled === false ? T.textDim : T.green}
          />
          <StatusRow
            label="Attention"
            value={
              attentionSeverity === "critical"
                ? `${attentionItems.length} critical`
                : attentionSeverity === "warning"
                  ? `${attentionItems.length} review`
                  : attentionSeverity
                    ? `${attentionItems.length} info`
                    : "all clear"
            }
            tone={
              attentionSeverity === "critical"
                ? T.red
                : attentionSeverity === "warning"
                  ? T.amber
                  : T.green
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default OperationsStatusOrb;
