import type { CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_RAY_REPLICA_SETTINGS,
  RAY_REPLICA_BAND_PROFILE_OPTIONS,
  RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
  RAY_REPLICA_DASHBOARD_POSITION_OPTIONS,
  RAY_REPLICA_DASHBOARD_SIZE_OPTIONS,
  RAY_REPLICA_MTF_OPTIONS,
  RAY_REPLICA_SESSION_OPTIONS,
  RAY_REPLICA_TIME_HORIZON_OPTIONS,
  resolveRayReplicaBandProfile,
  type RayReplicaRuntimeSettings,
  type RayReplicaSessionOption,
} from "./rayReplicaPineAdapter";

type WidgetTheme = {
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  accent?: string;
  mono: string;
};

type RayReplicaSettingsMenuProps = {
  theme: WidgetTheme;
  settings: RayReplicaRuntimeSettings;
  onChange: (next: RayReplicaRuntimeSettings) => void;
  dense?: boolean;
  disabled?: boolean;
};

type NumericSettingKey =
  | "basisLength"
  | "atrLength"
  | "atrSmoothing"
  | "volatilityMultiplier"
  | "wireSpread"
  | "shadowLength"
  | "shadowStdDev"
  | "adxLength"
  | "volumeMaLength"
  | "adxMin"
  | "volScoreMin"
  | "volScoreMax"
  | "tp1Rr"
  | "tp2Rr"
  | "tp3Rr";

type BooleanSettingKey =
  | "waitForBarClose"
  | "requireMtf1"
  | "requireMtf2"
  | "requireMtf3"
  | "requireAdx"
  | "requireVolScoreRange"
  | "restrictToSelectedSessions"
  | "showWires"
  | "showShadow"
  | "showKeyLevels"
  | "showStructure"
  | "showOrderBlocks"
  | "showSupportResistance"
  | "showDashboard"
  | "showTpSl";
  | "showRegimeWindows";

const triggerStyle = (
  theme: WidgetTheme,
  dense: boolean,
  disabled: boolean,
): CSSProperties => ({
  height: dense ? 22 : 26,
  borderRadius: 6,
  border: `1px solid ${disabled ? theme.border : theme.accent || theme.border}`,
  background: disabled ? theme.bg3 : `${theme.bg4}e6`,
  color: disabled ? theme.textMuted : theme.text,
  fontFamily: theme.mono,
  fontSize: dense ? 10 : 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: dense ? "0 7px" : "0 9px",
  cursor: disabled ? "default" : "pointer",
  display: "inline-flex",
  alignItems: "center",
});

const panelStyle = (theme: WidgetTheme): CSSProperties => ({
  width: 440,
  maxHeight: "min(78vh, 760px)",
  overflowY: "auto",
  borderRadius: 0,
  border: `1px solid ${theme.border}`,
  background: theme.bg4,
  color: theme.text,
  padding: 0,
  boxShadow: "0 16px 48px rgba(0, 0, 0, 0.36)",
});

const sectionStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "grid",
  gap: 10,
  padding: "12px 14px",
  borderTop: `1px solid ${theme.border}`,
});

const headerStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "11px 14px",
  borderBottom: `1px solid ${theme.border}`,
  background: `${theme.bg3}cc`,
  position: "sticky",
  top: 0,
  zIndex: 1,
  backdropFilter: "blur(10px)",
});

const titleStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: 10,
  color: theme.textMuted,
  fontFamily: theme.mono,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
});

const chipRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const chipStyle = (
  theme: WidgetTheme,
  active: boolean,
): CSSProperties => ({
  border: `1px solid ${active ? theme.accent || theme.text : theme.border}`,
  background: active ? `${theme.accent || theme.text}22` : theme.bg3,
  color: active ? theme.text : theme.textMuted,
  borderRadius: 0,
  padding: "5px 8px",
  fontSize: 11,
  fontFamily: theme.mono,
  fontWeight: active ? 700 : 500,
  cursor: "pointer",
  lineHeight: 1.2,
});

const fieldGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

const labelStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: 10,
  color: theme.textMuted,
  fontFamily: theme.mono,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
});

const inputStyle = (theme: WidgetTheme): CSSProperties => ({
  width: "100%",
  borderRadius: 0,
  border: `1px solid ${theme.border}`,
  background: theme.bg3,
  color: theme.text,
  padding: "6px 8px",
  fontSize: 12,
  fontFamily: theme.mono,
  outline: "none",
});

const helperStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: 11,
  lineHeight: 1.35,
  color: theme.textMuted,
  fontFamily: theme.mono,
});

const positionLabel = (value: RayReplicaRuntimeSettings["dashboardPosition"]) =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatNumber = (value: number) =>
  Number.isFinite(value) ? value.toString() : "";

function LabeledNumberField({
  theme,
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  theme: WidgetTheme;
  label: string;
  value: number;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={labelStyle(theme)}>{label}</span>
      <input
        type="number"
        value={formatNumber(value)}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle(theme)}
      />
    </label>
  );
}

function LabeledSelect({
  theme,
  label,
  value,
  options,
  onChange,
}: {
  theme: WidgetTheme;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={labelStyle(theme)}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle(theme)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RayReplicaSettingsMenu({
  theme,
  settings,
  onChange,
  dense = false,
  disabled = false,
}: RayReplicaSettingsMenuProps) {
  const activeBandProfile = resolveRayReplicaBandProfile(settings);

  const update = (patch: Partial<RayReplicaRuntimeSettings>) => {
    onChange({
      ...settings,
      ...patch,
    });
  };

  const setNumber = (key: NumericSettingKey, value: string) => {
    const resolved = Number(value);
    if (!Number.isFinite(resolved)) {
      return;
    }
    update({ [key]: resolved } as Pick<RayReplicaRuntimeSettings, NumericSettingKey>);
  };

  const toggle = (key: BooleanSettingKey) => {
    update({ [key]: !settings[key] } as Pick<RayReplicaRuntimeSettings, BooleanSettingKey>);
  };

  const toggleSession = (session: RayReplicaSessionOption) => {
    update({
      sessions: settings.sessions.includes(session)
        ? settings.sessions.filter((value) => value !== session)
        : [...settings.sessions, session],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          style={triggerStyle(theme, dense, disabled)}
          title={
            disabled
              ? "Enable RayReplica to tune its overlay settings"
              : "Tune RayReplica overlay settings"
          }
        >
          {dense ? "RR" : "RayReplica"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} style={panelStyle(theme)}>
        <div style={headerStyle(theme)}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={titleStyle(theme)}>RayReplica</div>
            <div style={{ fontSize: 12, fontFamily: theme.mono, fontWeight: 700 }}>
              {activeBandProfile?.label || "Custom"} profile
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_RAY_REPLICA_SETTINGS })}
            style={chipStyle(theme, false)}
          >
            Reset
          </button>
        </div>

        <section style={{ ...sectionStyle(theme), borderTop: "none" }}>
          <div style={titleStyle(theme)}>Structure</div>
          <div style={chipRowStyle}>
            {RAY_REPLICA_TIME_HORIZON_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => update({ timeHorizon: option })}
                style={chipStyle(theme, settings.timeHorizon === option)}
              >
                TH {option}
              </button>
            ))}
          </div>
          <div style={chipRowStyle}>
            {RAY_REPLICA_BOS_CONFIRMATION_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => update({ bosConfirmation: option })}
                style={chipStyle(theme, settings.bosConfirmation === option)}
              >
                BOS {option === "wicks" ? "Wicks" : "Close"}
              </button>
            ))}
          </div>
        </section>

        <section style={sectionStyle(theme)}>
          <div style={titleStyle(theme)}>Bands</div>
          <div style={chipRowStyle}>
            {RAY_REPLICA_BAND_PROFILE_OPTIONS.map((profile) => (
              <button
                key={profile.value}
                type="button"
                onClick={() => update({ ...profile.settings })}
                style={chipStyle(theme, activeBandProfile?.value === profile.value)}
              >
                {profile.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => toggle("waitForBarClose")}
              style={chipStyle(theme, settings.waitForBarClose)}
            >
              {settings.waitForBarClose ? "Close Confirm" : "Wick Confirm"}
            </button>
          </div>
          <div style={fieldGridStyle}>
            <LabeledNumberField
              theme={theme}
              label="Basis"
              value={settings.basisLength}
              onChange={(value) => setNumber("basisLength", value)}
              min={1}
            />
            <LabeledNumberField
              theme={theme}
              label="ATR"
              value={settings.atrLength}
              onChange={(value) => setNumber("atrLength", value)}
              min={1}
            />
            <LabeledNumberField
              theme={theme}
              label="Smooth"
              value={settings.atrSmoothing}
              onChange={(value) => setNumber("atrSmoothing", value)}
              min={1}
            />
            <LabeledNumberField
              theme={theme}
              label="Mult"
              value={settings.volatilityMultiplier}
              onChange={(value) => setNumber("volatilityMultiplier", value)}
              min={0.1}
              step={0.05}
            />
            <LabeledNumberField
              theme={theme}
              label="Wire Spread"
              value={settings.wireSpread}
              onChange={(value) => setNumber("wireSpread", value)}
              min={0}
              step={0.05}
            />
            <LabeledNumberField
              theme={theme}
              label="Shadow Len"
              value={settings.shadowLength}
              onChange={(value) => setNumber("shadowLength", value)}
              min={1}
            />
            <LabeledNumberField
              theme={theme}
              label="Shadow Dev"
              value={settings.shadowStdDev}
              onChange={(value) => setNumber("shadowStdDev", value)}
              min={0.1}
              step={0.1}
            />
          </div>
        </section>

        <section style={sectionStyle(theme)}>
          <div style={titleStyle(theme)}>Confirm</div>
          <div style={fieldGridStyle}>
            <LabeledNumberField
              theme={theme}
              label="ADX"
              value={settings.adxLength}
              onChange={(value) => setNumber("adxLength", value)}
              min={1}
            />
            <LabeledNumberField
              theme={theme}
              label="Vol MA"
              value={settings.volumeMaLength}
              onChange={(value) => setNumber("volumeMaLength", value)}
              min={1}
            />
            <LabeledSelect
              theme={theme}
              label="MTF 1"
              value={settings.mtf1}
              options={RAY_REPLICA_MTF_OPTIONS.map((value) => ({ value, label: value }))}
              onChange={(value) =>
                update({ mtf1: value as RayReplicaRuntimeSettings["mtf1"] })
              }
            />
            <LabeledSelect
              theme={theme}
              label="MTF 2"
              value={settings.mtf2}
              options={RAY_REPLICA_MTF_OPTIONS.map((value) => ({ value, label: value }))}
              onChange={(value) =>
                update({ mtf2: value as RayReplicaRuntimeSettings["mtf2"] })
              }
            />
            <LabeledSelect
              theme={theme}
              label="MTF 3"
              value={settings.mtf3}
              options={RAY_REPLICA_MTF_OPTIONS.map((value) => ({ value, label: value }))}
              onChange={(value) =>
                update({ mtf3: value as RayReplicaRuntimeSettings["mtf3"] })
              }
            />
            <div />
            <button type="button" onClick={() => toggle("requireMtf1")} style={chipStyle(theme, settings.requireMtf1)}>
              Req 1
            </button>
            <button type="button" onClick={() => toggle("requireMtf2")} style={chipStyle(theme, settings.requireMtf2)}>
              Req 2
            </button>
            <button type="button" onClick={() => toggle("requireMtf3")} style={chipStyle(theme, settings.requireMtf3)}>
              Req 3
            </button>
            <button type="button" onClick={() => toggle("requireAdx")} style={chipStyle(theme, settings.requireAdx)}>
              {settings.requireAdx ? "ADX Gate" : "ADX Off"}
            </button>
            <LabeledNumberField
              theme={theme}
              label="ADX Min"
              value={settings.adxMin}
              onChange={(value) => setNumber("adxMin", value)}
              min={0}
              step={0.5}
            />
            <button type="button" onClick={() => toggle("requireVolScoreRange")} style={chipStyle(theme, settings.requireVolScoreRange)}>
              {settings.requireVolScoreRange ? "Vol Gate" : "Vol Off"}
            </button>
            <LabeledNumberField
              theme={theme}
              label="Vol Min"
              value={settings.volScoreMin}
              onChange={(value) => setNumber("volScoreMin", value)}
              min={0}
              max={100}
            />
            <LabeledNumberField
              theme={theme}
              label="Vol Max"
              value={settings.volScoreMax}
              onChange={(value) => setNumber("volScoreMax", value)}
              min={0}
              max={100}
            />
          </div>
          <div style={chipRowStyle}>
            <button
              type="button"
              onClick={() => toggle("restrictToSelectedSessions")}
              style={chipStyle(theme, settings.restrictToSelectedSessions)}
            >
              {settings.restrictToSelectedSessions ? "Session Gate" : "Sessions Off"}
            </button>
            {RAY_REPLICA_SESSION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleSession(option.value)}
                style={chipStyle(theme, settings.sessions.includes(option.value))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section style={sectionStyle(theme)}>
          <div style={titleStyle(theme)}>Info</div>
          <div style={chipRowStyle}>
            <button type="button" onClick={() => toggle("showDashboard")} style={chipStyle(theme, settings.showDashboard)}>
              {settings.showDashboard ? "Dashboard On" : "Dashboard Off"}
            </button>
          </div>
          <div style={fieldGridStyle}>
            <LabeledSelect
              theme={theme}
              label="Position"
              value={settings.dashboardPosition}
              options={RAY_REPLICA_DASHBOARD_POSITION_OPTIONS.map((value) => ({
                value,
                label: positionLabel(value),
              }))}
              onChange={(value) =>
                update({
                  dashboardPosition: value as RayReplicaRuntimeSettings["dashboardPosition"],
                })
              }
            />
            <LabeledSelect
              theme={theme}
              label="Size"
              value={settings.dashboardSize}
              options={RAY_REPLICA_DASHBOARD_SIZE_OPTIONS.map((value) => ({
                value,
                label: value.charAt(0).toUpperCase() + value.slice(1),
              }))}
              onChange={(value) =>
                update({
                  dashboardSize: value as RayReplicaRuntimeSettings["dashboardSize"],
                })
              }
            />
          </div>
          <div style={helperStyle(theme)}>
            The dashboard mirrors the current shading and signal timeframes plus the configured MTF confirmation blocks.
          </div>
        </section>

        <section style={sectionStyle(theme)}>
          <div style={titleStyle(theme)}>Risk</div>
          <div style={chipRowStyle}>
            <button type="button" onClick={() => toggle("showTpSl")} style={chipStyle(theme, settings.showTpSl)}>
              {settings.showTpSl ? "TP/SL On" : "TP/SL Off"}
            </button>
          </div>
          <div style={fieldGridStyle}>
            <LabeledNumberField
              theme={theme}
              label="TP1"
              value={settings.tp1Rr}
              onChange={(value) => setNumber("tp1Rr", value)}
              min={0.25}
              step={0.25}
            />
            <LabeledNumberField
              theme={theme}
              label="TP2"
              value={settings.tp2Rr}
              onChange={(value) => setNumber("tp2Rr", value)}
              min={0.25}
              step={0.25}
            />
            <LabeledNumberField
              theme={theme}
              label="TP3"
              value={settings.tp3Rr}
              onChange={(value) => setNumber("tp3Rr", value)}
              min={0.25}
              step={0.25}
            />
          </div>
        </section>

        <section style={sectionStyle(theme)}>
          <div style={titleStyle(theme)}>Overlays</div>
          <div style={chipRowStyle}>
            <button type="button" onClick={() => toggle("showStructure")} style={chipStyle(theme, settings.showStructure)}>
              {settings.showStructure ? "Structure On" : "Structure Off"}
            </button>
            <button type="button" onClick={() => toggle("showOrderBlocks")} style={chipStyle(theme, settings.showOrderBlocks)}>
              {settings.showOrderBlocks ? "Order Blocks On" : "Order Blocks Off"}
            </button>
            <button type="button" onClick={() => toggle("showSupportResistance")} style={chipStyle(theme, settings.showSupportResistance)}>
              {settings.showSupportResistance ? "S/R On" : "S/R Off"}
            </button>
            <button type="button" onClick={() => toggle("showKeyLevels")} style={chipStyle(theme, settings.showKeyLevels)}>
              {settings.showKeyLevels ? "Key Levels On" : "Key Levels Off"}
            </button>
            <button type="button" onClick={() => toggle("showRegimeWindows")} style={chipStyle(theme, settings.showRegimeWindows)}>
              {settings.showRegimeWindows ? "Regime On" : "Regime Off"}
            </button>
          </div>
          <div style={helperStyle(theme)}>
            Toggle the structural overlays independently so the chart can match the Pine source more closely in dense or clean layouts.
          </div>
        </section>

        <section style={sectionStyle(theme)}>
          <div style={titleStyle(theme)}>Appearance</div>
          <div style={chipRowStyle}>
            <button type="button" onClick={() => toggle("showWires")} style={chipStyle(theme, settings.showWires)}>
              {settings.showWires ? "Wires On" : "Wires Off"}
            </button>
            <button type="button" onClick={() => toggle("showShadow")} style={chipStyle(theme, settings.showShadow)}>
              {settings.showShadow ? "Shadow On" : "Shadow Off"}
            </button>
            <button type="button" onClick={() => update({ colorCandles: !settings.colorCandles })} style={chipStyle(theme, settings.colorCandles)}>
              {settings.colorCandles ? "Candle Tint On" : "Candle Tint Off"}
            </button>
          </div>
          <div style={helperStyle(theme)}>
            Wires and shadow control the main regime band presentation. Candle tint mirrors the active RayReplica regime directly on price bars.
          </div>
        </section>

      </PopoverContent>
    </Popover>
  );
}
