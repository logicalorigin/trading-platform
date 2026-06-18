import {
  useEffect,
} from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { AlgoDiagnosticsFooter } from "./AlgoDiagnosticsFooter";
import { AlgoSaveBar } from "./AlgoSaveBar";
import { AlgoSettingsRegion } from "./AlgoSettingsRegion";
import { OvernightControlPanel } from "./OvernightControlPanel.jsx";
import {
  resolveAlgoDeploymentKind,
  ALGO_DEPLOYMENT_KIND,
} from "./algoHelpers.js";
import { AlgoTimeframeControlBand } from "./AlgoTimeframeControlBand";
import { HaltStrip } from "./HaltStrip";
import {
  deriveWireTrailControlSummary,
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS,
  signalOptionsHaltControlValue,
} from "./algoHelpers";
import { collectDirtySettingFields } from "./algoSettingsFields";

const WIRE_TRAIL_TONE_COLOR = {
  active: CSS_COLOR.green,
  armed: CSS_COLOR.cyan,
  degraded: CSS_COLOR.amber,
  off: CSS_COLOR.textMuted,
};

const WireTrailStatusBand = ({ profile, positions }) => {
  const summary = deriveWireTrailControlSummary({ profile, positions });
  const tone = WIRE_TRAIL_TONE_COLOR[summary.status] ?? CSS_COLOR.textDim;
  const structureValue =
    summary.structureBreakPositions > 0
      ? `${summary.structureBreakPositions} break`
      : summary.regimeFlipPositions > 0
        ? `${summary.regimeFlipPositions} flip`
        : summary.structureSummary;
  const floorValue = summary.enabled
    ? `${summary.floorOnlyPositions} floor`
    : "--";
  const pollValue =
    summary.enabled && summary.runnerPollIntervalSeconds
      ? `${summary.runnerPollIntervalSeconds}s`
      : "--";
  const cells = [
    { label: "RUNGS", value: summary.rungSummary },
    { label: "GREEKS", value: summary.greekSummary },
    { label: "STRUCT", value: structureValue },
    { label: "FLOOR", value: floorValue },
    { label: "POLL", value: pollValue },
  ];

  return (
    <section
      data-testid="algo-wire-trail-status"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        padding: `${sp(6)}px ${sp(8)}px`,
        background: cssColorMix(tone, summary.status === "off" ? 5 : 8),
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        boxShadow: `inset 0 1px 0 ${cssColorMix(tone, 12)}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.data,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.label,
            lineHeight: 1,
          }}
        >
          WIRE TRAIL
        </span>
        <span
          style={{
            flex: "0 0 auto",
            color: tone,
            border: `1px solid ${cssColorMix(tone, 46)}`,
            borderRadius: RADII.xs,
            padding: `${sp(2)}px ${sp(5)}px`,
            fontFamily: T.data,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.emphasis,
            lineHeight: 1,
          }}
        >
          {summary.statusLabel}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(56px, max-content))",
          justifyContent: "start",
          gap: sp(3),
          minWidth: 0,
        }}
      >
        {cells.map((cell) => (
          <AppTooltip key={cell.label} content={`${cell.label}: ${cell.value}`}>
            <div
              style={{
                minWidth: 0,
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: RADII.xs,
                background: CSS_COLOR.bg1,
                padding: `${sp(3)}px ${sp(4)}px`,
              }}
            >
              <div
                style={{
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.data,
                  fontSize: textSize("micro"),
                  fontWeight: FONT_WEIGHTS.label,
                  lineHeight: 1.1,
                }}
              >
                {cell.label}
              </div>
              <div
                style={{
                  color: CSS_COLOR.text,
                  fontFamily: T.data,
                  fontSize: textSize("label"),
                  fontWeight: FONT_WEIGHTS.label,
                  lineHeight: 1.25,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cell.value}
              </div>
            </div>
          </AppTooltip>
        ))}
      </div>
    </section>
  );
};

const collectDirtyHaltFields = ({ profileDraft, profileBaseline }) =>
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS.flatMap((group) =>
    group.controls
      .map((control) => {
        const currentValue = signalOptionsHaltControlValue(profileDraft, control);
        const previousValue = signalOptionsHaltControlValue(
          profileBaseline,
          control,
        );
        return {
          sectionLabel: "Halt",
          label: control.label.toUpperCase(),
          slice: "profile",
          path: `${control.section}.${control.key}`,
          type: "boolean",
          currentValue,
          previousValue,
          dirty: currentValue !== previousValue,
        };
      })
      .filter((field) => field.dirty),
  );

export const AlgoRightRail = ({
  cockpit,
  signalOptionsPositions,
  profileDraft,
  profileBaseline,
  profileDirty,
  patchProfileDraftPath,
  strategySettingsDraft,
  strategyBaseline,
  strategyDirty,
  patchStrategySettingsPath,
  focusedDeployment,
  controlBaselineReady = true,
  saveAllPending = false,
  handleApplyExpandedCapacity,
  handleSaveAllAdjustments,
  handleDiscardAllAdjustments,
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
  algoIsPhone,
  algoIsNarrow,
}) => {
  const settingDirtyFields = collectDirtySettingFields({
    profileDraft,
    profileBaseline,
    strategyDraft: strategySettingsDraft,
    strategyBaseline,
    isEqual: (left, right) =>
      JSON.stringify(left ?? null) === JSON.stringify(right ?? null),
  });
  const haltDirtyFields = collectDirtyHaltFields({
    profileDraft,
    profileBaseline,
  });
  const dirtyFields = [...haltDirtyFields, ...settingDirtyFields];
  const isDirty = profileDirty || strategyDirty;
  const pending =
    saveAllPending ||
    updateProfileMutation?.isPending ||
    updateStrategySettingsMutation?.isPending;
  const controlsReady = Boolean(focusedDeployment && controlBaselineReady);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        if (isDirty && !pending) {
          handleSaveAllAdjustments();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveAllAdjustments, isDirty, pending]);

  return (
    <aside
      data-testid="algo-right-rail"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        position: "relative",
        background: CSS_COLOR.bg0,
        borderLeft: algoIsPhone ? "none" : `1px solid ${CSS_COLOR.border}`,
      }}
    >
      <div
        data-testid="algo-right-rail-body"
        style={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          gap: sp(8),
          background: CSS_COLOR.bg3,
          overflow: "hidden",
          overflowX: "hidden",
          minHeight: 0,
          minWidth: 0,
          paddingBottom: sp(6),
        }}
      >
        <div
          data-testid="algo-controls-container"
          className="algo-rail-cq"
          style={{
            flex: "1 1 auto",
            overflowY: "auto",
            overflowX: "hidden",
            scrollPaddingTop: "56px",
            background: CSS_COLOR.bg2,
            borderBottom: `2px solid ${CSS_COLOR.border}`,
            boxShadow: `0 1px 0 ${CSS_COLOR.borderLight}`,
            paddingBottom: sp(6),
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {resolveAlgoDeploymentKind(focusedDeployment) ===
          ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT ? (
            // Overnight/equity deployments show ONLY the overnight panel here --
            // the options-only bands (wire trail, timeframe, halt, strike/DTE/MTF
            // settings) are signal-options-profile-driven and don't apply.
            <div data-testid="algo-settings-container">
              <OvernightControlPanel deployment={focusedDeployment} />
            </div>
          ) : (
            <>
              <WireTrailStatusBand
                profile={profileDraft}
                positions={signalOptionsPositions}
              />
              <AlgoTimeframeControlBand
                profileDraft={profileDraft}
                profileBaseline={profileBaseline}
                strategySettingsDraft={strategySettingsDraft}
                strategyBaseline={strategyBaseline}
                patchProfileDraftPath={patchProfileDraftPath}
                patchStrategySettingsPath={patchStrategySettingsPath}
                disabled={!controlsReady || pending}
              />
              <HaltStrip
                cockpit={cockpit}
                profileBaseline={profileBaseline}
                profileDraft={profileDraft}
                patchProfileDraftPath={patchProfileDraftPath}
                focusedDeployment={focusedDeployment}
                controlBaselineReady={controlsReady}
                updateProfileMutation={updateProfileMutation}
              />
              <div data-testid="algo-settings-container">
                <AlgoSettingsRegion
                  cockpit={cockpit}
                  signalOptionsPositions={signalOptionsPositions}
                  profileDraft={profileDraft}
                  profileBaseline={profileBaseline}
                  strategySettingsDraft={strategySettingsDraft}
                  strategyBaseline={strategyBaseline}
                  patchProfileDraftPath={patchProfileDraftPath}
                  patchStrategySettingsPath={patchStrategySettingsPath}
                  dirtyFields={settingDirtyFields}
                  focusedDeployment={focusedDeployment}
                  controlBaselineReady={controlsReady}
                  handleApplyExpandedCapacity={handleApplyExpandedCapacity}
                  updateProfileMutation={updateProfileMutation}
                  updateStrategySettingsMutation={updateStrategySettingsMutation}
                />
              </div>
            </>
          )}
        </div>
        <div
          data-testid="algo-diagnostics-container"
          className="algo-rail-cq"
          style={{
            flex: "0 0 auto",
            height: algoIsPhone ? "30vh" : "210px",
            maxHeight: algoIsPhone ? "36vh" : "260px",
            minHeight: algoIsPhone ? "148px" : "178px",
            overflowY: "auto",
            overflowX: "hidden",
            minWidth: 0,
            borderTop: `2px solid ${CSS_COLOR.border}`,
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg1,
            boxShadow: `0 -1px 0 ${CSS_COLOR.borderLight}`,
          }}
        >
          <AlgoDiagnosticsFooter
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
      </div>
      <AlgoSaveBar
        dirtyFields={dirtyFields}
        isDirty={isDirty}
        pending={pending}
        focusedDeployment={focusedDeployment}
        onDiscard={handleDiscardAllAdjustments}
        onSave={handleSaveAllAdjustments}
      />
    </aside>
  );
};

export default AlgoRightRail;
