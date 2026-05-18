import { useMemo, useState } from "react";
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
import { AlgoProfileTab } from "./AlgoProfileTab";
import { TuningImpactRow } from "./TuningImpactRow";
import {
  buildAlgoTuningImpact,
} from "../../features/platform/algoTuningImpactModel";
import { numberFrom } from "./algoHelpers";

const SECTION_TITLE = {
  fontFamily: T.sans,
  fontSize: fs(12),
  fontWeight: FONT_WEIGHTS.medium,
  color: T.text,
  letterSpacing: "0.01em",
  padding: sp("4px 4px"),
};

const inputStyle = {
  background: T.bg2,
  border: "none",
  borderRadius: dim(RADII.xs),
  color: T.text,
  padding: sp("4px 8px"),
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  outline: "none",
  width: "100%",
};

const NumberInput = ({ value, onChange, step }) => (
  <input
    type="number"
    step={step}
    value={value ?? ""}
    onChange={(event) => onChange(numberFrom(event.target.value, 0))}
    style={inputStyle}
  />
);

const liveImpactSection = ({
  profileDraft,
  patchProfileDraft,
  patchProfileDraftNested: _patchProfileDraftNested,
  impact,
}) => (
  <div style={{ display: "grid", gap: sp(5) }}>
    <div style={SECTION_TITLE}>Entry gates</div>
    <TuningImpactRow
      label="Max spread (% of mid)"
      inputElement={
        <NumberInput
          value={profileDraft?.liquidityGate?.maxSpreadPctOfMid}
          onChange={(value) =>
            patchProfileDraft("liquidityGate", "maxSpreadPctOfMid", value)
          }
          step={1}
        />
      }
      count={impact.spreadTooWide.count}
      sampleSymbols={impact.spreadTooWide.sampleSymbols}
      emptyHint="no candidates blocked"
    />
    <TuningImpactRow
      label="Min bid"
      inputElement={
        <NumberInput
          value={profileDraft?.liquidityGate?.minBid}
          onChange={(value) => patchProfileDraft("liquidityGate", "minBid", value)}
          step={0.01}
        />
      }
      count={impact.bidBelowMinimum.count}
      sampleSymbols={impact.bidBelowMinimum.sampleSymbols}
      emptyHint="no candidates blocked"
    />
    <TuningImpactRow
      label="Premium budget"
      inputElement={
        <NumberInput
          value={profileDraft?.riskCaps?.maxPremiumPerEntry}
          onChange={(value) =>
            patchProfileDraft("riskCaps", "maxPremiumPerEntry", value)
          }
          step={25}
        />
      }
      count={impact.premiumBudget.count}
      sampleSymbols={impact.premiumBudget.sampleSymbols}
      emptyHint="within budget"
    />
    <TuningImpactRow
      label="MTF / regime gate"
      inputElement={
        <span
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          (set in Config-only)
        </span>
      }
      count={impact.regimeBlocks.count}
      sampleSymbols={impact.regimeBlocks.sampleSymbols}
      emptyHint="alignment passing"
    />

    <div style={{ ...SECTION_TITLE, marginTop: sp(4) }}>Contract selection</div>
    <TuningImpactRow
      label="Min DTE"
      inputElement={
        <NumberInput
          value={profileDraft?.optionSelection?.minDte}
          onChange={(value) => patchProfileDraft("optionSelection", "minDte", value)}
          step={1}
        />
      }
      count={impact.dteWindow.count}
      sampleSymbols={impact.dteWindow.sampleSymbols}
      emptyHint="all candidates in window"
    />
    <TuningImpactRow
      label="Max DTE"
      inputElement={
        <NumberInput
          value={profileDraft?.optionSelection?.maxDte}
          onChange={(value) => patchProfileDraft("optionSelection", "maxDte", value)}
          step={1}
        />
      }
      count={impact.dteWindow.count}
      sampleSymbols={impact.dteWindow.sampleSymbols}
      emptyHint="all candidates in window"
    />

    <div style={{ ...SECTION_TITLE, marginTop: sp(4) }}>Exits</div>
    <TuningImpactRow
      label="Hard stop %"
      inputElement={
        <NumberInput
          value={profileDraft?.exitPolicy?.hardStopPct}
          onChange={(value) => patchProfileDraft("exitPolicy", "hardStopPct", value)}
          step={1}
        />
      }
      count={impact.hardStop.count}
      total={impact.trailing.total}
      sampleSymbols={impact.hardStop.sampleSymbols}
      emptyHint="no open positions"
      warningWhenNonZero={false}
    />
    <TuningImpactRow
      label="Runner trail giveback %"
      inputElement={
        <NumberInput
          value={profileDraft?.exitPolicy?.trailGivebackPct}
          onChange={(value) =>
            patchProfileDraft("exitPolicy", "trailGivebackPct", value)
          }
          step={5}
        />
      }
      count={impact.trailing.count}
      total={impact.trailing.total}
      sampleSymbols={impact.trailing.sampleSymbols}
      emptyHint="no trailing positions"
      warningWhenNonZero={false}
    />
  </div>
);

export const AlgoTuningTab = ({
  cockpit,
  signalOptionsPositions,
  algoIsPhone,
  algoIsNarrow,
  // Profile/diagnostics props passed through
  profileDraft,
  patchProfileDraft,
  patchProfileDraftNested,
  strategySettingsDraft,
  setStrategySettingsDraft,
  signalMonitorProfile,
  focusedDeployment,
  signalOptionsProfile,
  profileSectionOpen,
  setProfileSectionOpen,
  handleApplyExpandedCapacity,
  handleSaveStrategySettings,
  handleSaveProfile,
  updateProfileMutation,
  updateStrategySettingsMutation,
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
}) => {
  const [view, setView] = useState("tuning");
  const impact = useMemo(
    () =>
      buildAlgoTuningImpact({
        cockpit,
        profile: profileDraft || signalOptionsProfile,
        positions: signalOptionsPositions,
      }),
    [cockpit, profileDraft, signalOptionsProfile, signalOptionsPositions],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(6) }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(6),
          padding: sp("4px 4px"),
        }}
      >
        <div style={{ display: "flex", gap: sp(2) }}>
          {[
            { id: "tuning", label: "Tuning" },
            { id: "config", label: "Config-only" },
          ].map((option) => {
            const selected = view === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                style={{
                  padding: sp("4px 12px"),
                  borderRadius: dim(RADII.pill),
                  border: `1px solid ${selected ? T.accent : T.border}`,
                  background: selected ? `${T.accent}1c` : "transparent",
                  color: selected ? T.text : T.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: selected ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "tuning" ? (
        liveImpactSection({
          profileDraft,
          patchProfileDraft,
          patchProfileDraftNested,
          impact,
        })
      ) : (
        <AlgoProfileTab
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
      )}

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
    </div>
  );
};

export default AlgoTuningTab;
