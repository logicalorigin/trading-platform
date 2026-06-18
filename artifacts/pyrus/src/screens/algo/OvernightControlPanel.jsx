import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { ActionButton } from "../../components/ui/ActionButton.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";
import { useRunOvernightSpotSignalScan } from "@workspace/api-client-react";

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const formatMoney = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `$${value.toLocaleString()}`
    : "--";

const Row = ({ label, value, testId }) => (
  <div
    data-testid={testId}
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: sp("8px"),
      padding: sp("3px 0"),
      fontFamily: T.mono,
      fontSize: textSize("label"),
    }}
  >
    <span style={{ color: CSS_COLOR.textMuted }}>{label}</span>
    <span style={{ color: CSS_COLOR.text }}>{value}</span>
  </div>
);

// Read-only control/status surface for non-options (overnight/equity)
// deployments. AlgoRightRail gates the options AlgoSettingsRegion out for these
// deployments (its strike/DTE/MTF controls don't apply) and renders this panel
// instead. Enable/Disable uses the existing generic status-bar toggle; this
// panel adds the overnight-only manual SHADOW scan (existing route
// POST /api/algo/deployments/:id/overnight-spot/scan via the generated
// useRunOvernightSpotSignalScan hook) plus a read-only view of the overnight
// profile. No settings editing and no execution-semantics changes in v0.
export const OvernightControlPanel = ({ deployment }) => {
  const config = asRecord(deployment?.config);
  const parameters = asRecord(config.parameters);
  // Mirror the backend's resolveOvernightSpotProfile lookup order.
  const overnight = asRecord(
    config.overnightSpot ??
      parameters.overnightSpotTrading ??
      parameters.overnightSpot,
  );
  const scanMutation = useRunOvernightSpotSignalScan();

  const deploymentId = deployment?.id || null;
  const mode = String(overnight.executionMode || "disabled");

  const runShadowScan = () => {
    if (!deploymentId || scanMutation.isPending) return;
    // Shadow-safe: records signals only -- no live actions / order execution.
    scanMutation.mutate({
      deploymentId,
      data: {
        forceEvaluate: true,
        refreshSignals: true,
        recordSignals: true,
        runActions: false,
        execute: false,
      },
    });
  };

  if (!deployment) {
    return (
      <div
        data-testid="overnight-control-panel-empty"
        style={{
          padding: sp("12px"),
          color: CSS_COLOR.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("label"),
        }}
      >
        No overnight / equity deployment selected.
      </div>
    );
  }

  return (
    <div
      data-testid="overnight-control-panel"
      data-deployment-id={deploymentId || undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp("8px"),
        padding: sp("12px"),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        background: CSS_COLOR.bg1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: sp("8px") }}>
        <span
          data-testid="overnight-control-panel-kind"
          style={{
            fontFamily: T.sans,
            fontSize: textSize("micro"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: CSS_COLOR.text,
            background: CSS_COLOR.bg2,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            padding: sp("2px 6px"),
          }}
        >
          Overnight / Equity
        </span>
        <span
          style={{
            fontFamily: T.sans,
            fontSize: textSize("body"),
            color: CSS_COLOR.text,
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {normalizeLegacyAlgoBrandText(deployment.name || "Overnight deployment")}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: T.mono,
            fontSize: textSize("label"),
            color: CSS_COLOR.textMuted,
            textTransform: "uppercase",
          }}
        >
          {mode}
        </span>
      </div>

      <div data-testid="overnight-control-panel-config">
        <Row label="Execution mode" value={mode} />
        <Row label="Trading session" value={String(overnight.tradingSession || "--")} />
        <Row label="Long only" value={overnight.longOnly === false ? "no" : "yes"} />
        <Row label="Default notional" value={formatMoney(overnight.defaultOrderNotional)} />
        <Row label="Max notional" value={formatMoney(overnight.maxOrderNotional)} />
        <Row
          label="Max shares"
          value={
            typeof overnight.maxShareQuantity === "number"
              ? String(overnight.maxShareQuantity)
              : "--"
          }
        />
        {overnight.signalTimeframe ? (
          <Row label="Signal timeframe" value={String(overnight.signalTimeframe)} />
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp("8px"),
          flexWrap: "wrap",
        }}
      >
        <ActionButton
          data-testid="overnight-control-panel-scan"
          onClick={runShadowScan}
          disabled={!deploymentId || scanMutation.isPending}
        >
          {scanMutation.isPending ? "Scanning..." : "Run shadow scan"}
        </ActionButton>
        <AppTooltip content="Records signals only; no live orders. Enable/Disable uses the status-bar toggle above.">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: dim(24),
              padding: sp("1px 7px"),
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.pill),
              background: CSS_COLOR.bg2,
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("micro"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Shadow only
          </span>
        </AppTooltip>
      </div>

      {scanMutation.isError ? (
        <div
          data-testid="overnight-control-panel-scan-error"
          style={{
            fontFamily: T.sans,
            fontSize: textSize("micro"),
            color: CSS_COLOR.red,
          }}
        >
          Shadow scan failed - try again.
        </div>
      ) : scanMutation.isSuccess ? (
        <div
          data-testid="overnight-control-panel-scan-ok"
          style={{
            fontFamily: T.sans,
            fontSize: textSize("micro"),
            color: CSS_COLOR.green,
          }}
        >
          Shadow scan complete.
        </div>
      ) : null}
    </div>
  );
};

export default OvernightControlPanel;
