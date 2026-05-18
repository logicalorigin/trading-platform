import { useState } from "react";
import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { AlgoDiagnosticsTab } from "./AlgoDiagnosticsTab";
import { ConfigFormPanel } from "./ConfigFormPanel";
import { TuningImpactPanel } from "./TuningImpactPanel";

const SectionHeader = ({ title, expanded, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(4),
      padding: sp("6px 8px"),
      background: "transparent",
      border: "none",
      borderBottom: `1px solid ${T.border}`,
      color: T.text,
      fontFamily: T.sans,
      fontSize: fs(11),
      fontWeight: FONT_WEIGHTS.medium,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      cursor: "pointer",
      width: "100%",
      textAlign: "left",
    }}
  >
    <span>{title}</span>
    <span style={{ color: T.textDim, fontSize: textSize("caption") }}>
      {expanded ? "▾" : "▸"}
    </span>
  </button>
);

const RailSection = ({ title, defaultExpanded = true, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div
      style={{
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <SectionHeader
        title={title}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
      />
      {expanded ? (
        <div style={{ padding: sp("6px 8px"), minWidth: 0 }}>{children}</div>
      ) : null}
    </div>
  );
};

export const AlgoRightRail = ({
  // Tuning impact + Config form props
  cockpit,
  signalOptionsPositions,
  signalOptionsProfile,
  profileDraft,
  patchProfileDraft,
  patchProfileDraftNested,
  strategySettingsDraft,
  setStrategySettingsDraft,
  signalMonitorProfile,
  focusedDeployment,
  profileSectionOpen,
  setProfileSectionOpen,
  handleApplyExpandedCapacity,
  handleSaveStrategySettings,
  handleSaveProfile,
  updateProfileMutation,
  updateStrategySettingsMutation,
  // Diagnostics
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
}) => (
  <div
    data-testid="algo-right-rail"
    style={{
      display: "flex",
      flexDirection: "column",
      gap: sp(5),
      minWidth: 0,
    }}
  >
    <RailSection title="Live tuning" defaultExpanded={true}>
      <TuningImpactPanel
        cockpit={cockpit}
        signalOptionsPositions={signalOptionsPositions}
        signalOptionsProfile={signalOptionsProfile}
        profileDraft={profileDraft}
        patchProfileDraft={patchProfileDraft}
      />
    </RailSection>
    <RailSection title="Config" defaultExpanded={false}>
      <ConfigFormPanel
        profileDraft={profileDraft}
        patchProfileDraft={patchProfileDraft}
        patchProfileDraftNested={patchProfileDraftNested}
        strategySettingsDraft={strategySettingsDraft}
        setStrategySettingsDraft={setStrategySettingsDraft}
        signalMonitorProfile={signalMonitorProfile}
        focusedDeployment={focusedDeployment}
        signalOptionsProfile={signalOptionsProfile}
        profileSectionOpen={profileSectionOpen}
        setProfileSectionOpen={setProfileSectionOpen}
        handleApplyExpandedCapacity={handleApplyExpandedCapacity}
        handleSaveStrategySettings={handleSaveStrategySettings}
        handleSaveProfile={handleSaveProfile}
        updateProfileMutation={updateProfileMutation}
        updateStrategySettingsMutation={updateStrategySettingsMutation}
        algoIsPhone={algoIsPhone}
      />
    </RailSection>
    <RailSection title="Diagnostics" defaultExpanded={false}>
      <AlgoDiagnosticsTab
        cockpitSkipCategoryRows={cockpitSkipCategoryRows}
        cockpitSkipReasonRows={cockpitSkipReasonRows}
        cockpitReadinessRows={cockpitReadinessRows}
        cockpitMarkHealthRows={cockpitMarkHealthRows}
        cockpitLifecycleRows={cockpitLifecycleRows}
        cockpitEntryGateRows={cockpitEntryGateRows}
        cockpitOptionChainRows={cockpitOptionChainRows}
        cockpitSignalFreshness={cockpitSignalFreshness}
        cockpitTradePath={cockpitTradePath}
        diagExpansion={diagExpansion}
        setDiagExpansion={setDiagExpansion}
        algoIsPhone={algoIsPhone}
        algoIsNarrow={algoIsNarrow}
      />
    </RailSection>
  </div>
);

export default AlgoRightRail;
