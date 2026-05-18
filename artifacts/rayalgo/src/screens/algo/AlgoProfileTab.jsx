import {
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { ProfileSection } from "./ProfileSection.jsx";
import {
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  SIGNAL_OPTIONS_EXPANDED_CAPACITY,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  STRATEGY_SIGNAL_TIMEFRAMES,
  asRecord,
  compactButtonStyle,
  formatChaseSteps,
  formatMoney,
  formatPct,
  numberFrom,
  parseChaseSteps,
} from "./algoHelpers";

export const AlgoProfileTab = ({
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
  algoIsPhone,
}) => {
  const profileNumberFields = PROFILE_NUMBER_FIELDS;
  const numberFieldStyle = {
    display: "flex",
    flexDirection: "column",
    gap: sp(3),
    padding: sp("4px 6px"),
    minWidth: 0,
  };
  const labelTextStyle = {
    color: T.textMuted,
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    letterSpacing: "0.04em",
  };
  const inputStyle = {
    background: T.bg1,
    border: "none",
    borderRadius: dim(RADII.xs),
    color: T.text,
    padding: sp("5px 7px"),
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    outline: "none",
  };
  const renderNumberField = (section, key, label, step) => (
    <label key={`${section}.${key}`} style={numberFieldStyle}>
      <span style={labelTextStyle}>{label.toUpperCase()}</span>
      <input
        type="number"
        step={step}
        value={profileDraft?.[section]?.[key] ?? ""}
        onChange={(event) =>
          patchProfileDraft(
            section,
            key,
            numberFrom(event.target.value, 0),
          )
        }
        style={inputStyle}
      />
    </label>
  );
  const renderBoolean = (checked, onChange, label, key) => (
    <label
      key={key}
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        background: T.bg1,
        padding: sp("7px 9px"),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(10),
      }}
    >
      <span
        style={{
          color: T.textSec,
          fontFamily: T.sans,
          fontSize: textSize("body"),
        }}
      >
        {label.toUpperCase()}
      </span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: algoIsPhone
      ? "1fr"
      : "repeat(auto-fit, minmax(140px, 1fr))",
    gap: sp(6),
    minWidth: 0,
  };
  const numberByKey = (section, key) =>
    profileNumberFields.find(
      ([s, k]) => s === section && k === key,
    );
  const callSlot = SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.find(
    (option) =>
      option.value === profileDraft?.optionSelection?.callStrikeSlot,
  );
  const putSlot = SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.find(
    (option) =>
      option.value === profileDraft?.optionSelection?.putStrikeSlot,
  );
  const strategySummary = `${strategySettingsDraft.signalTimeframe} · h${strategySettingsDraft.timeHorizon}`;
  const riskSummary = `${formatMoney(profileDraft?.riskCaps?.maxPremiumPerEntry)}/entry · ${profileDraft?.riskCaps?.maxOpenSymbols ?? "?"} sym · ${formatMoney(profileDraft?.riskCaps?.maxDailyLoss)} halt`;
  const gatesSummary = `bear ADX ${profileDraft?.entryGate?.bearishRegime?.minAdx ?? "?"} · ${profileDraft?.entryGate?.bearishRegime?.enabled ? "bear on" : "bear off"}`;
  const strikesSummary = `${profileDraft?.optionSelection?.minDte ?? 0}-${profileDraft?.optionSelection?.maxDte ?? 0} DTE · call ${callSlot?.label || "?"} · put ${putSlot?.label || "?"}`;
  const fillsSummary = `${formatPct(profileDraft?.liquidityGate?.maxSpreadPctOfMid, 0)} spread · ${profileDraft?.fillPolicy?.ttlSeconds ?? "?"}s · chase ${formatChaseSteps(profileDraft?.fillPolicy?.chaseSteps)}`;
  const exitsSummary = `stop ${profileDraft?.exitPolicy?.hardStopPct ?? "?"}% · trail ${profileDraft?.exitPolicy?.trailActivationPct ?? "?"}/${profileDraft?.exitPolicy?.trailGivebackPct ?? "?"}`;
  const toggleSection = (id) =>
    setProfileSectionOpen((current) => (current === id ? null : id));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(5),
      }}
    >
      <div
        data-testid="algo-profile-capacity-banner"
        style={{
          border: `1px solid ${T.amber}35`,
          borderRadius: dim(RADII.sm),
          background: `${T.amber}0d`,
          padding: sp("8px 10px"),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(10),
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: T.amber,
              fontFamily: T.sans,
              fontSize: textSize("body"),
              letterSpacing: "0.04em",
            }}
          >
            EXPANDED CAPACITY
          </div>
          <div
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("body"),
              marginTop: sp(2),
            }}
          >
            {SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxOpenSymbols} symbols ·{" "}
            {formatMoney(SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxDailyLoss)} halt
          </div>
        </div>
        <button
          type="button"
          data-testid="signal-options-expanded-capacity"
          onClick={handleApplyExpandedCapacity}
          disabled={
            !focusedDeployment || updateProfileMutation.isPending
          }
          style={{
            ...compactButtonStyle({
              disabled:
                !focusedDeployment ||
                updateProfileMutation.isPending,
            }),
            border: `1px solid ${T.amber}`,
            background: T.amber,
            color: T.onAccent,
          }}
        >
          {updateProfileMutation.isPending ? "SAVING..." : "APPLY"}
        </button>
      </div>

      <ProfileSection
        id="signal"
        title="Signal"
        summary={strategySummary}
        expanded={profileSectionOpen === "signal"}
        onToggle={() => toggleSection("signal")}
      >
        <div style={gridStyle}>
          <label style={numberFieldStyle}>
            <span style={labelTextStyle}>SIGNAL TIMEFRAME</span>
            <select
              value={strategySettingsDraft.signalTimeframe}
              onChange={(event) =>
                setStrategySettingsDraft((current) => ({
                  ...current,
                  signalTimeframe: event.target.value,
                }))
              }
              style={inputStyle}
            >
              {STRATEGY_SIGNAL_TIMEFRAMES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label style={numberFieldStyle}>
            <span style={labelTextStyle}>TIME HORIZON</span>
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={strategySettingsDraft.timeHorizon}
              onChange={(event) =>
                setStrategySettingsDraft((current) => ({
                  ...current,
                  timeHorizon: numberFrom(event.target.value, 8),
                }))
              }
              style={inputStyle}
            />
          </label>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(10),
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("body"),
            }}
          >
            Live profile {signalMonitorProfile?.timeframe || "5m"} ·
            deployment h{asRecord(asRecord(focusedDeployment?.config).parameters).timeHorizon ?? 8}
          </div>
          <button
            type="button"
            onClick={handleSaveStrategySettings}
            disabled={
              !focusedDeployment ||
              updateStrategySettingsMutation.isPending
            }
            style={{
              ...compactButtonStyle({
                disabled:
                  !focusedDeployment ||
                  updateStrategySettingsMutation.isPending,
              }),
              border: "none",
              background: T.accent,
              color: T.onAccent,
            }}
          >
            {updateStrategySettingsMutation.isPending
              ? "SAVING..."
              : "SAVE SIGNAL"}
          </button>
        </div>
      </ProfileSection>

      <ProfileSection
        id="risk"
        title="Risk caps"
        summary={riskSummary}
        expanded={profileSectionOpen === "risk"}
        onToggle={() => toggleSection("risk")}
      >
        <div style={gridStyle}>
          {numberByKey("riskCaps", "maxPremiumPerEntry") &&
            renderNumberField(...numberByKey("riskCaps", "maxPremiumPerEntry"))}
          {numberByKey("riskCaps", "maxContracts") &&
            renderNumberField(...numberByKey("riskCaps", "maxContracts"))}
          {numberByKey("riskCaps", "maxOpenSymbols") &&
            renderNumberField(...numberByKey("riskCaps", "maxOpenSymbols"))}
          {numberByKey("riskCaps", "maxDailyLoss") &&
            renderNumberField(...numberByKey("riskCaps", "maxDailyLoss"))}
        </div>
      </ProfileSection>

      <ProfileSection
        id="gates"
        title="Signal gates"
        summary={gatesSummary}
        expanded={profileSectionOpen === "gates"}
        onToggle={() => toggleSection("gates")}
      >
        <div style={gridStyle}>
          <label style={numberFieldStyle}>
            <span style={labelTextStyle}>BEAR ADX MIN</span>
            <input
              type="number"
              step={1}
              value={
                profileDraft?.entryGate?.bearishRegime?.minAdx ??
                SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.bearishRegime
                  .minAdx
              }
              onChange={(event) =>
                patchProfileDraftNested(
                  "entryGate",
                  "bearishRegime",
                  "minAdx",
                  numberFrom(event.target.value, 0),
                )
              }
              style={inputStyle}
            />
          </label>
          {renderBoolean(
            profileDraft?.entryGate?.bearishRegime?.enabled,
            (value) =>
              patchProfileDraftNested(
                "entryGate",
                "bearishRegime",
                "enabled",
                value,
              ),
            "Bear gate enabled",
            "entryGate.bearishRegime.enabled",
          )}
          {renderBoolean(
            profileDraft?.entryGate?.bearishRegime
              ?.rejectFullyBullishMtf,
            (value) =>
              patchProfileDraftNested(
                "entryGate",
                "bearishRegime",
                "rejectFullyBullishMtf",
                value,
              ),
            "Reject bullish MTF puts",
            "entryGate.bearishRegime.rejectFullyBullishMtf",
          )}
        </div>
      </ProfileSection>

      <ProfileSection
        id="strikes"
        title="Strike slots"
        summary={strikesSummary}
        expanded={profileSectionOpen === "strikes"}
        onToggle={() => toggleSection("strikes")}
      >
        <div style={gridStyle}>
          {numberByKey("optionSelection", "minDte") &&
            renderNumberField(...numberByKey("optionSelection", "minDte"))}
          {numberByKey("optionSelection", "targetDte") &&
            renderNumberField(...numberByKey("optionSelection", "targetDte"))}
          {numberByKey("optionSelection", "maxDte") &&
            renderNumberField(...numberByKey("optionSelection", "maxDte"))}
          {[
            ["optionSelection", "callStrikeSlot", "Call strike slot"],
            ["optionSelection", "putStrikeSlot", "Put strike slot"],
          ].map(([section, key, label]) => (
            <label key={`${section}.${key}`} style={numberFieldStyle}>
              <span style={labelTextStyle}>{label.toUpperCase()}</span>
              <select
                value={profileDraft?.[section]?.[key] ?? ""}
                onChange={(event) =>
                  patchProfileDraft(
                    section,
                    key,
                    Number(event.target.value),
                  )
                }
                style={inputStyle}
              >
                {SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {renderBoolean(
            profileDraft?.optionSelection?.allowZeroDte,
            (value) =>
              patchProfileDraft("optionSelection", "allowZeroDte", value),
            "Allow 0DTE",
            "optionSelection.allowZeroDte",
          )}
        </div>
      </ProfileSection>

      <ProfileSection
        id="fills"
        title="Fills (limit · spread · chase)"
        summary={fillsSummary}
        expanded={profileSectionOpen === "fills"}
        onToggle={() => toggleSection("fills")}
      >
        <div style={gridStyle}>
          {numberByKey("liquidityGate", "maxSpreadPctOfMid") &&
            renderNumberField(
              ...numberByKey("liquidityGate", "maxSpreadPctOfMid"),
            )}
          {numberByKey("liquidityGate", "minBid") &&
            renderNumberField(...numberByKey("liquidityGate", "minBid"))}
          {numberByKey("fillPolicy", "ttlSeconds") &&
            renderNumberField(...numberByKey("fillPolicy", "ttlSeconds"))}
          {renderBoolean(
            profileDraft?.liquidityGate?.requireBidAsk,
            (value) =>
              patchProfileDraft("liquidityGate", "requireBidAsk", value),
            "Require bid/ask",
            "liquidityGate.requireBidAsk",
          )}
          {renderBoolean(
            profileDraft?.liquidityGate?.requireFreshQuote,
            (value) =>
              patchProfileDraft(
                "liquidityGate",
                "requireFreshQuote",
                value,
              ),
            "Require fresh quote",
            "liquidityGate.requireFreshQuote",
          )}
        </div>
        <label
          style={{ ...numberFieldStyle, gridColumn: "1 / -1" }}
        >
          <span style={labelTextStyle}>CHASE LADDER %</span>
          <input
            value={formatChaseSteps(
              profileDraft?.fillPolicy?.chaseSteps,
            )}
            onChange={(event) =>
              patchProfileDraft(
                "fillPolicy",
                "chaseSteps",
                parseChaseSteps(
                  event.target.value,
                  profileDraft?.fillPolicy?.chaseSteps || [],
                ),
              )
            }
            style={inputStyle}
          />
        </label>
      </ProfileSection>

      <ProfileSection
        id="exits"
        title="Exits"
        summary={exitsSummary}
        expanded={profileSectionOpen === "exits"}
        onToggle={() => toggleSection("exits")}
      >
        <div style={gridStyle}>
          {numberByKey("exitPolicy", "hardStopPct") &&
            renderNumberField(...numberByKey("exitPolicy", "hardStopPct"))}
          {numberByKey("exitPolicy", "trailActivationPct") &&
            renderNumberField(
              ...numberByKey("exitPolicy", "trailActivationPct"),
            )}
          {numberByKey("exitPolicy", "minLockedGainPct") &&
            renderNumberField(
              ...numberByKey("exitPolicy", "minLockedGainPct"),
            )}
          {numberByKey("exitPolicy", "trailGivebackPct") &&
            renderNumberField(
              ...numberByKey("exitPolicy", "trailGivebackPct"),
            )}
          {numberByKey("exitPolicy", "tightenAtFiveXGivebackPct") &&
            renderNumberField(
              ...numberByKey("exitPolicy", "tightenAtFiveXGivebackPct"),
            )}
          {numberByKey("exitPolicy", "tightenAtTenXGivebackPct") &&
            renderNumberField(
              ...numberByKey("exitPolicy", "tightenAtTenXGivebackPct"),
            )}
          {renderBoolean(
            profileDraft?.exitPolicy?.flipOnOppositeSignal,
            (value) =>
              patchProfileDraft(
                "exitPolicy",
                "flipOnOppositeSignal",
                value,
              ),
            "Exit on opposite signal",
            "exitPolicy.flipOnOppositeSignal",
          )}
        </div>
      </ProfileSection>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(10),
          flexWrap: "wrap",
          marginTop: sp(4),
        }}
      >
        <div
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("body"),
          }}
        >
          Premium {formatMoney(signalOptionsProfile.riskCaps.maxPremiumPerEntry)} ·
          spread {formatPct(signalOptionsProfile.liquidityGate.maxSpreadPctOfMid, 0)}
        </div>
        <button
          type="button"
          onClick={handleSaveProfile}
          disabled={
            !focusedDeployment || updateProfileMutation.isPending
          }
          style={{
            ...compactButtonStyle({
              disabled:
                !focusedDeployment ||
                updateProfileMutation.isPending,
            }),
            border: "none",
            background: T.green,
            color: T.onAccent,
          }}
        >
          {updateProfileMutation.isPending
            ? "SAVING..."
            : "SAVE PROFILE"}
        </button>
      </div>
    </div>
  );
};

export default AlgoProfileTab;
