import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { DiagPanel } from "./DiagPanel.jsx";
import {
  isDiagRowsHealthy,
  isGateSummaryHealthy,
} from "../algoCockpitDiagnosticsModel";

export const AlgoDiagnosticsTab = ({
  cockpitSkipCategoryRows,
  cockpitSkipReasonRows,
  cockpitReadinessRows,
  cockpitMarkHealthRows,
  cockpitLifecycleRows,
  cockpitEntryGateRows,
  cockpitOptionChainRows,
  cockpitSignalFreshness,
  cockpitTradePath,
  diagExpansion,
  setDiagExpansion,
  algoIsPhone,
  algoIsNarrow,
  readOnly = false,
}) => {
  const diagPanels = [
    { key: "skip-categories", title: "Skip Categories", rows: cockpitSkipCategoryRows, color: CSS_COLOR.red },
    { key: "skip-reasons", title: "Skip Reasons", rows: cockpitSkipReasonRows, color: CSS_COLOR.red },
    { key: "readiness", title: "Readiness", rows: cockpitReadinessRows, color: CSS_COLOR.amber },
    { key: "mark-health", title: "Mark Health", rows: cockpitMarkHealthRows, color: CSS_COLOR.amber },
    { key: "lifecycle", title: "Lifecycle", rows: cockpitLifecycleRows, color: CSS_COLOR.amber },
    { key: "entry-gate", title: "Entry Gate", rows: cockpitEntryGateRows, color: CSS_COLOR.amber },
    { key: "option-chain", title: "Option Chain", rows: cockpitOptionChainRows, color: CSS_COLOR.amber },
  ];
  const gateHealthy = isGateSummaryHealthy(cockpitTradePath);
  const resolveExpanded = (panel) => {
    if (readOnly) return true;
    const healthy = isDiagRowsHealthy(panel.rows);
    const override = diagExpansion[panel.key];
    return typeof override === "boolean" ? override : !healthy;
  };
  const expandedPanels = diagPanels.filter((panel) => resolveExpanded(panel));
  const collapsedPanels = readOnly
    ? []
    : diagPanels.filter((panel) => !resolveExpanded(panel));
  return (
    <div
      data-testid="algo-cockpit-diagnostics"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        minWidth: 0,
      }}
    >
      {!readOnly ? (
        <SectionHeader
          title="Diagnostics"
          right={
            <div style={{ display: "flex", gap: sp(5) }}>
              <button
                type="button"
                data-testid="algo-diag-expand-all"
                onClick={() =>
                  setDiagExpansion(
                    Object.fromEntries(diagPanels.map((p) => [p.key, true])),
                  )
                }
                style={{
                  padding: sp("4px 10px"),
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  color: CSS_COLOR.textSec,
                  background: CSS_COLOR.bg1,
                  border: `1px solid ${CSS_COLOR.border}`,
                  borderRadius: dim(RADII.pill),
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                Expand all
              </button>
              <button
                type="button"
                data-testid="algo-diag-collapse-all"
                onClick={() =>
                  setDiagExpansion(
                    Object.fromEntries(diagPanels.map((p) => [p.key, false])),
                  )
                }
                style={{
                  padding: sp("4px 10px"),
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  color: CSS_COLOR.textSec,
                  background: CSS_COLOR.bg1,
                  border: `1px solid ${CSS_COLOR.border}`,
                  borderRadius: dim(RADII.pill),
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                Collapse all
              </button>
            </div>
          }
        />
      ) : null}

      <div
        data-testid="algo-diag-gate-summary"
        className="algo-diag-kpi-grid"
        style={{
          border: "none",
          borderRadius: dim(RADII.md),
          background: CSS_COLOR.bg1,
          padding: sp("6px 10px"),
        }}
      >
        {[
          ["Fresh", cockpitSignalFreshness.fresh ?? 0, CSS_COLOR.green],
          ["Aged", cockpitSignalFreshness.notFresh ?? 0, CSS_COLOR.amber],
          ["No-dir", cockpitSignalFreshness.withoutDirection ?? 0, CSS_COLOR.red],
          ["Blocked", cockpitTradePath.blockedCandidates ?? 0, CSS_COLOR.red],
          ["Filled", cockpitTradePath.shadowFilledCandidates ?? 0, CSS_COLOR.green],
          ["Marks", cockpitTradePath.markEvents ?? 0, CSS_COLOR.text],
          ["Gateway", cockpitTradePath.gatewayBlocks ?? 0, CSS_COLOR.amber],
        ].map(([label, value, color]) => {
          // No-dir = directionless/neutral signals: a binary-system violation,
          // so it alarms on any nonzero count. Aged is not an alarm, but it
          // still carries its amber freshness tone below when nonzero.
          const isAlarm =
            (label === "Blocked" || label === "Gateway" || label === "No-dir") &&
            Number(value) > 0;
          return (
            <div key={label} style={{ minWidth: 0 }}>
              <div
                style={{
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                }}
              >
                {String(label).toUpperCase()}
              </div>
              <div
                className="tnum"
                style={{
                  color: isAlarm
                    ? color
                    : Number(value) > 0
                      ? color
                      : CSS_COLOR.text,
                  fontFamily: T.data,
                  fontSize: fs(11),
                  fontVariantNumeric: "tabular-nums",
                  marginTop: sp(2),
                }}
              >
                {Number(value || 0).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {expandedPanels.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsPhone
              ? "1fr"
              : algoIsNarrow
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(3, minmax(0, 1fr))",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          {expandedPanels.map((panel) => (
            <DiagPanel
              key={panel.key}
              title={panel.title}
              color={panel.color}
              rows={panel.rows}
              healthy={isDiagRowsHealthy(panel.rows)}
              expanded={true}
              onToggle={() =>
                setDiagExpansion((current) => ({
                  ...current,
                  [panel.key]: false,
                }))
              }
              readOnly={readOnly}
            />
          ))}
        </div>
      ) : null}

      {collapsedPanels.length ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(5),
            paddingTop: sp(2),
          }}
        >
          <span
            style={{
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              alignSelf: "center",
              marginRight: sp(2),
            }}
          >
            {gateHealthy && expandedPanels.length === 0
              ? "ALL HEALTHY · "
              : "HEALTHY · "}
          </span>
          {collapsedPanels.map((panel) => (
            <DiagPanel
              key={panel.key}
              title={panel.title}
              color={panel.color}
              rows={panel.rows}
              healthy={isDiagRowsHealthy(panel.rows)}
              expanded={false}
              onToggle={() =>
                setDiagExpansion((current) => ({
                  ...current,
                  [panel.key]: true,
                }))
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default AlgoDiagnosticsTab;
