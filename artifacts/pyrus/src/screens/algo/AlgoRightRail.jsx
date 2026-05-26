import {
  useEffect,
} from "react";
import {
  CSS_COLOR,
  T,
  sp,
} from "../../lib/uiTokens.jsx";
import { AlgoDiagnosticsFooter } from "./AlgoDiagnosticsFooter";
import { AlgoSaveBar } from "./AlgoSaveBar";
import { AlgoSettingsRegion } from "./AlgoSettingsRegion";
import { HaltStrip } from "./HaltStrip";
import {
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS,
  signalOptionsHaltControlValue,
} from "./algoHelpers";
import { collectDirtySettingFields } from "./algoSettingsFields";

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
    updateProfileMutation?.isPending ||
    updateStrategySettingsMutation?.isPending;

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
          <HaltStrip
            cockpit={cockpit}
            profileBaseline={profileBaseline}
            profileDraft={profileDraft}
            patchProfileDraftPath={patchProfileDraftPath}
            focusedDeployment={focusedDeployment}
            updateProfileMutation={updateProfileMutation}
            algoIsPhone={algoIsPhone}
            algoIsNarrow={algoIsNarrow}
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
              handleApplyExpandedCapacity={handleApplyExpandedCapacity}
              updateProfileMutation={updateProfileMutation}
              updateStrategySettingsMutation={updateStrategySettingsMutation}
              algoIsPhone={algoIsPhone}
              algoIsNarrow={algoIsNarrow}
            />
          </div>
        </div>
        <div
          data-testid="algo-diagnostics-container"
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
