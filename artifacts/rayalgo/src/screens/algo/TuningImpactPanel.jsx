import { useMemo } from "react";
import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { TuningImpactRow } from "./TuningImpactRow";
import { buildAlgoTuningImpact } from "../../features/platform/algoTuningImpactModel";
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

export const TuningImpactPanel = ({
  cockpit,
  signalOptionsPositions,
  signalOptionsProfile,
  profileDraft,
  patchProfileDraft,
}) => {
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
    <div data-testid="algo-tuning-impact-panel" style={{ display: "grid", gap: sp(5) }}>
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
        histogram={impact.spreadTooWide.histogram}
        emptyHint="no candidates blocked"
      />
      <TuningImpactRow
        label="Min bid"
        inputElement={
          <NumberInput
            value={profileDraft?.liquidityGate?.minBid}
            onChange={(value) =>
              patchProfileDraft("liquidityGate", "minBid", value)
            }
            step={0.01}
          />
        }
        count={impact.bidBelowMinimum.count}
        sampleSymbols={impact.bidBelowMinimum.sampleSymbols}
        histogram={impact.bidBelowMinimum.histogram}
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
        histogram={impact.premiumBudget.histogram}
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
            (edit in config)
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
            onChange={(value) =>
              patchProfileDraft("optionSelection", "minDte", value)
            }
            step={1}
          />
        }
        count={impact.dteWindow.count}
        sampleSymbols={impact.dteWindow.sampleSymbols}
        emptyHint="all in window"
      />
      <TuningImpactRow
        label="Max DTE"
        inputElement={
          <NumberInput
            value={profileDraft?.optionSelection?.maxDte}
            onChange={(value) =>
              patchProfileDraft("optionSelection", "maxDte", value)
            }
            step={1}
          />
        }
        count={impact.dteWindow.count}
        sampleSymbols={impact.dteWindow.sampleSymbols}
        histogram={impact.dteWindow.histogram}
        emptyHint="all in window"
      />

      <div style={{ ...SECTION_TITLE, marginTop: sp(4) }}>Exits</div>
      <TuningImpactRow
        label="Hard stop %"
        inputElement={
          <NumberInput
            value={profileDraft?.exitPolicy?.hardStopPct}
            onChange={(value) =>
              patchProfileDraft("exitPolicy", "hardStopPct", value)
            }
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
};

export default TuningImpactPanel;
