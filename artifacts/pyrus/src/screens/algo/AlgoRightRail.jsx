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
  resolvePositionWireTrailState,
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS,
  signalOptionsHaltControlValue,
} from "./algoHelpers";
import { collectDirtySettingFields } from "./algoSettingsFields";

const WIRE_TRAIL_TONE_COLOR = {
  active: CSS_COLOR.green,
  armed: CSS_COLOR.cyan,
  degraded: CSS_COLOR.amber,
  break: CSS_COLOR.amber,
  flip: CSS_COLOR.amber,
  off: CSS_COLOR.textMuted,
};

const formatWirePrice = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";

const formatSignedPct = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
    : "--";

const resolveWirePositionSymbol = (position) => {
  const record = position && typeof position === "object" ? position : {};
  const contract =
    record.optionContract && typeof record.optionContract === "object"
      ? record.optionContract
      : {};
  return (
    contract.underlying || record.underlyingSymbol || record.symbol || "—"
  );
};

// Most-urgent ACTIVE wire position for the single-line focus strip: a live
// structure break / regime flip outranks everything, else the smallest room to
// break. Deterministic so the strip holds a stable height (it never stacks).
const resolveActiveWireFocus = (positions) => {
  const candidates = (Array.isArray(positions) ? positions : [])
    .map((position) => ({
      position,
      state: resolvePositionWireTrailState(position),
    }))
    .filter(({ state }) => state.enabled && state.active);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const urgentA =
      a.state.structureBreak || a.state.regimeFlipAgainstPosition ? 0 : 1;
    const urgentB =
      b.state.structureBreak || b.state.regimeFlipAgainstPosition ? 0 : 1;
    if (urgentA !== urgentB) return urgentA - urgentB;
    return (
      (a.state.distanceToBreakPct ?? Number.POSITIVE_INFINITY) -
      (b.state.distanceToBreakPct ?? Number.POSITIVE_INFINITY)
    );
  });
  return candidates[0];
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
    { label: "GREEK GATE", value: summary.greekSummary },
    { label: "STRUCTURE", value: structureValue },
    { label: "FLOOR", value: floorValue },
    { label: "POLL", value: pollValue },
  ];
  // Surface (C): the single most-urgent active position, as a one-line
  // underlying-vs-active-wire focus strip (only while the trail is on).
  const focus = summary.status === "off" ? null : resolveActiveWireFocus(positions);
  const focusState = focus?.state ?? null;
  const focusUrgent = Boolean(
    focusState?.structureBreak || focusState?.regimeFlipAgainstPosition,
  );
  const focusTone = focusUrgent ? CSS_COLOR.amber : CSS_COLOR.green;

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
      {summary.status !== "off" ? (
        <div
          data-testid="algo-wire-trail-active-strip"
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            minWidth: 0,
            fontFamily: T.data,
            fontSize: textSize("label"),
            lineHeight: 1.1,
            color: CSS_COLOR.textMuted,
          }}
        >
          {focus ? (
            <>
              <span
                style={{
                  color: CSS_COLOR.textSec,
                  fontWeight: FONT_WEIGHTS.label,
                  flex: "0 0 auto",
                }}
              >
                {resolveWirePositionSymbol(focus.position)}
              </span>
              <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.emphasis }}>
                {formatWirePrice(focusState?.latestUnderlyingClose)}
              </span>
              <span aria-hidden="true" style={{ color: CSS_COLOR.textMuted }}>→</span>
              <span style={{ color: focusTone, whiteSpace: "nowrap" }}>
                {focusState?.selectedRungLabel} {formatWirePrice(focusState?.selectedWirePrice)}
              </span>
              <span
                style={{
                  color: focusTone,
                  fontWeight: FONT_WEIGHTS.emphasis,
                  marginLeft: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {focusUrgent
                  ? focusState?.structureBreak
                    ? "BREAK"
                    : "FLIP"
                  : `${formatSignedPct(focusState?.distanceToBreakPct)} to break`}
              </span>
            </>
          ) : (
            <span>No active wire — armed runners ride the floor stop.</span>
          )}
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(64px, max-content))",
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
                  fontSize: textSize("label"),
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
  signalOptionsProfile,
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
  const saveError = Boolean(
    updateProfileMutation?.isError || updateStrategySettingsMutation?.isError,
  );
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
                saveInProgress={pending}
                updateProfileMutation={updateProfileMutation}
              />
              <div data-testid="algo-settings-container">
                <AlgoSettingsRegion
                  cockpit={cockpit}
                  signalOptionsPositions={signalOptionsPositions}
                  signalOptionsProfile={signalOptionsProfile}
                  profileDraft={profileDraft}
                  profileBaseline={profileBaseline}
                  strategySettingsDraft={strategySettingsDraft}
                  strategyBaseline={strategyBaseline}
                  patchProfileDraftPath={patchProfileDraftPath}
                  patchStrategySettingsPath={patchStrategySettingsPath}
                  dirtyFields={settingDirtyFields}
                  focusedDeployment={focusedDeployment}
                  controlBaselineReady={controlsReady}
                  saveInProgress={pending}
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
        saveError={saveError}
        focusedDeployment={focusedDeployment}
        onDiscard={handleDiscardAllAdjustments}
        onSave={handleSaveAllAdjustments}
      />
    </aside>
  );
};

export default AlgoRightRail;
