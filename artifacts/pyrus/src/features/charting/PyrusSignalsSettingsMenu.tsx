import { useState, type CSSProperties, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_PYRUS_SIGNALS_SETTINGS,
  PYRUS_SIGNALS_DASHBOARD_SIZE_OPTIONS,
  PYRUS_SIGNALS_LABEL_SIZE_OPTIONS,
  PYRUS_SIGNALS_LINE_STYLE_OPTIONS,
  PYRUS_SIGNALS_MTF_OPTIONS,
  PYRUS_SIGNALS_SESSION_OPTIONS,
  resolvePyrusSignalsBandProfile,
  type PyrusSignalsRuntimeSettings,
  type PyrusSignalsSessionOption,
} from "./pyrusSignalsPineAdapter";
import { TYPE_CSS_VAR } from "../../lib/typography";
// @ts-expect-error JSX module imported into TypeScript context
import { ELEVATION, FONT_WEIGHTS, RADII, cssColorAlpha } from "../../lib/uiTokens.jsx";
import { AppTooltip } from "@/components/ui/tooltip";


type WidgetTheme = {
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  accent?: string;
  mono: string;
};

type PyrusSignalsSettingsMenuProps = {
  theme: WidgetTheme;
  settings: PyrusSignalsRuntimeSettings;
  onChange: (next: PyrusSignalsRuntimeSettings) => void;
  dense?: boolean;
  disabled?: boolean;
};

type SettingsTab = "inputs" | "style" | "visibility";

type NumericSettingKey =
  | "timeHorizon"
  | "chochAtrBuffer"
  | "chochBodyExpansionAtr"
  | "chochVolumeGate"
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
  | "signalOffsetAtr"
  | "tp1Rr"
  | "tp2Rr"
  | "tp3Rr"
  | "trendReversalLengthBars"
  | "orderBlockMaxActivePerSide"
  | "supportResistancePivotStrength"
  | "supportResistanceMinZoneDistancePercent"
  | "supportResistanceThicknessMultiplier"
  | "supportResistanceMaxZones"
  | "supportResistanceExtensionBars"
  | "keyLevelLabelOffsetBars";

type BooleanSettingKey =
  | "waitForBarClose"
  | "requireMtf1"
  | "requireMtf2"
  | "requireMtf3"
  | "signalFiltersEnabled"
  | "requireAdx"
  | "requireVolScoreRange"
  | "restrictToSelectedSessions"
  | "showWires"
  | "showShadow"
  | "showKeyLevels"
  | "showBos"
  | "showChoch"
  | "showSwings"
  | "showTrendReversal"
  | "showOrderBlocks"
  | "showSupportResistance"
  | "showDashboard"
  | "showTpSl"
  | "showRegimeWindows"
  | "showPriorDayHigh"
  | "showPriorDayLow"
  | "showPriorDayClose"
  | "showTodayOpen"
  | "showPriorWeekHigh"
  | "showPriorWeekLow"
  | "showLondonSession"
  | "showNewYorkSession"
  | "showTokyoSession"
  | "showSydneySession"
  | "showSecondarySignals"
  | "colorCandles";

const triggerStyle = (
  theme: WidgetTheme,
  dense: boolean,
  disabled: boolean,
): CSSProperties => ({
  height: dense ? 22 : 26,
  borderRadius: RADII.sm,
  border: `1px solid ${disabled ? theme.border : theme.accent || theme.border}`,
  background: disabled ? theme.bg3 : cssColorAlpha(theme.bg4, "e6"),
  color: disabled ? theme.textMuted : theme.text,
  fontFamily: theme.mono,
  fontSize: dense ? TYPE_CSS_VAR.body : TYPE_CSS_VAR.bodyStrong,
  fontWeight: FONT_WEIGHTS.regular,
  letterSpacing: "0.04em",
  padding: dense ? "0 7px" : "0 9px",
  minWidth: dense ? 24 : undefined,
  cursor: disabled ? "default" : "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
});

const panelStyle = (theme: WidgetTheme): CSSProperties => ({
  width: 560,
  maxHeight: "min(82vh, 900px)",
  overflowY: "auto",
  zIndex: 1000,
  pointerEvents: "auto",
  borderRadius: RADII.none,
  border: `1px solid ${theme.border}`,
  background: theme.bg4,
  color: theme.text,
  padding: 0,
  boxShadow: ELEVATION.lg,
});

const headerStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "grid",
  gap: 12,
  padding: "12px 14px",
  borderBottom: `1px solid ${theme.border}`,
  background: cssColorAlpha(theme.bg3, "dd"),
  position: "sticky",
  top: 0,
  zIndex: 1,
  backdropFilter: "blur(10px)",
});

const titleKickerStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.label,
  color: theme.textMuted,
  fontFamily: theme.mono,
  fontWeight: FONT_WEIGHTS.regular,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
});

const headerMetaStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.bodyStrong,
  color: theme.textMuted,
  fontFamily: theme.mono,
  lineHeight: 1.35,
});

const resetButtonStyle = (theme: WidgetTheme): CSSProperties => ({
  border: `1px solid ${theme.border}`,
  background: theme.bg3,
  color: theme.text,
  padding: "6px 10px",
  fontSize: TYPE_CSS_VAR.bodyStrong,
  fontFamily: theme.mono,
  fontWeight: FONT_WEIGHTS.regular,
  cursor: "pointer",
});

const tabsRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
};

const tabButtonStyle = (
  theme: WidgetTheme,
  active: boolean,
): CSSProperties => ({
  border: `1px solid ${active ? theme.accent || theme.text : theme.border}`,
  background: active ? cssColorAlpha(theme.accent || theme.text, "22") : theme.bg3,
  color: active ? theme.text : theme.textMuted,
  padding: "6px 10px",
  fontSize: TYPE_CSS_VAR.bodyStrong,
  fontFamily: theme.mono,
  fontWeight: FONT_WEIGHTS.regular,
  cursor: "pointer",
});

const sectionStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "grid",
  gap: 10,
  padding: "14px",
  borderTop: `1px solid ${theme.border}`,
});

const sectionTitleStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.bodyStrong,
  color: theme.text,
  fontFamily: theme.mono,
  fontWeight: FONT_WEIGHTS.regular,
});

const sectionDescriptionStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.body,
  color: theme.textMuted,
  fontFamily: theme.mono,
  lineHeight: 1.4,
});

const rowStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 300px)",
  gap: 14,
  alignItems: "center",
  borderTop: `1px solid ${theme.border}`,
  paddingTop: 10,
});

const labelBlockStyle: CSSProperties = {
  display: "grid",
  gap: 4,
};

const rowLabelStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.bodyStrong,
  color: theme.text,
  fontFamily: theme.mono,
  fontWeight: FONT_WEIGHTS.regular,
});

const rowHelperStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.body,
  color: theme.textMuted,
  fontFamily: theme.mono,
  lineHeight: 1.35,
});

const inputStyle = (theme: WidgetTheme): CSSProperties => ({
  width: "100%",
  borderRadius: RADII.none,
  border: `1px solid ${theme.border}`,
  background: theme.bg3,
  color: theme.text,
  padding: "6px 8px",
  fontSize: TYPE_CSS_VAR.bodyStrong,
  fontFamily: theme.mono,
  outline: "none",
});

const checkboxStyle = (theme: WidgetTheme): CSSProperties => ({
  width: 14,
  height: 14,
  accentColor: theme.accent || theme.text,
});

const inlineControlsStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const twoColumnInlineStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

const threeColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
};

const inlineLabelStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: TYPE_CSS_VAR.body,
  color: theme.text,
  fontFamily: theme.mono,
});

const miniLabelStyle = (theme: WidgetTheme): CSSProperties => ({
  fontSize: TYPE_CSS_VAR.label,
  color: theme.textMuted,
  fontFamily: theme.mono,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
});

const swatchStyle = (theme: WidgetTheme, color: string): CSSProperties => ({
  width: 16,
  height: 16,
  border: `1px solid ${theme.border}`,
  background: color,
});

const noteBoxStyle = (theme: WidgetTheme): CSSProperties => ({
  border: `1px solid ${theme.border}`,
  background: theme.bg3,
  padding: "10px 12px",
  fontSize: TYPE_CSS_VAR.body,
  color: theme.textMuted,
  fontFamily: theme.mono,
  lineHeight: 1.4,
});

const styleEntryStyle = (theme: WidgetTheme): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 12,
  alignItems: "center",
  borderTop: `1px solid ${theme.border}`,
  paddingTop: 10,
});

const formatNumber = (value: number) =>
  Number.isFinite(value) ? value.toString() : "";

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const resolveSolidHex = (value: string): string =>
  /^#[0-9a-fA-F]{6}/.test(value) ? value.slice(0, 7) : "#808080";

const applySolidHexWithExistingAlpha = (nextSolidHex: string, current: string): string =>
  /^#[0-9a-fA-F]{8}$/.test(current)
    ? `${nextSolidHex}${current.slice(7, 9)}`
    : nextSolidHex;

function Section({
  theme,
  title,
  description,
  children,
  borderTop = true,
}: {
  theme: WidgetTheme;
  title: string;
  description?: string;
  children: ReactNode;
  borderTop?: boolean;
}) {
  return (
    <section style={{ ...sectionStyle(theme), borderTop: borderTop ? `1px solid ${theme.border}` : "none" }}>
      <div style={sectionTitleStyle(theme)}>{title}</div>
      {description ? <div style={sectionDescriptionStyle(theme)}>{description}</div> : null}
      {children}
    </section>
  );
}

function Row({
  theme,
  label,
  helper,
  tooltip,
  children,
}: {
  theme: WidgetTheme;
  label: string;
  helper?: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <AppTooltip content={tooltip}><div style={rowStyle(theme)}>
      <div style={labelBlockStyle}>
        <div style={rowLabelStyle(theme)}>{label}</div>
        {helper ? <div style={rowHelperStyle(theme)}>{helper}</div> : null}
      </div>
      <div>{children}</div>
    </div></AppTooltip>
  );
}

function InlineCheckbox({
  theme,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  theme: WidgetTheme;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ ...inlineLabelStyle(theme), opacity: disabled ? 0.55 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={checkboxStyle(theme)}
      />
      <span>{label}</span>
    </label>
  );
}

function ColorControl({
  theme,
  label,
  value,
  onColorChange,
  onTextChange,
}: {
  theme: WidgetTheme;
  label: string;
  value: string;
  onColorChange: (nextSolidHex: string) => void;
  onTextChange: (next: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={miniLabelStyle(theme)}>{label}</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "26px 36px minmax(0, 1fr)",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span style={swatchStyle(theme, value)} />
        <input
          type="color"
          value={resolveSolidHex(value)}
          onChange={(event) => onColorChange(event.target.value)}
          style={{ width: 36, height: 28, padding: 0, border: "none", background: "transparent" }}
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onTextChange(event.target.value)}
          style={inputStyle(theme)}
        />
      </div>
    </div>
  );
}

function NumericSettingInput({
  theme,
  settingKey,
  value,
  min,
  max,
  step,
  setNumber,
}: {
  theme: WidgetTheme;
  settingKey: NumericSettingKey;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  setNumber: (key: NumericSettingKey, value: string) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={formatNumber(value)}
      onChange={(event) => setNumber(settingKey, event.target.value)}
      onBlur={(event) => {
        const raw = event.target.value;
        if (raw.trim() === "") {
          return;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          return;
        }
        let clamped = parsed;
        if (min !== undefined && clamped < min) {
          clamped = min;
        }
        if (max !== undefined && clamped > max) {
          clamped = max;
        }
        if (clamped !== parsed) {
          setNumber(settingKey, String(clamped));
        }
      }}
      style={inputStyle(theme)}
    />
  );
}

export function PyrusSignalsSettingsMenu({
  theme,
  settings,
  onChange,
  dense = false,
  disabled = false,
}: PyrusSignalsSettingsMenuProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("inputs");
  const activeBandProfile = resolvePyrusSignalsBandProfile(settings);

  const update = (patch: Partial<PyrusSignalsRuntimeSettings>) => {
    onChange({
      ...settings,
      ...patch,
    });
  };

  const setNumber = (key: NumericSettingKey, value: string) => {
    // An empty/whitespace field would coerce to 0 via Number(""), silently
    // committing a value below documented mins while the user is mid-edit.
    // Treat it as a no-op so the previous valid value is retained.
    if (value.trim() === "") {
      return;
    }
    const resolved = Number(value);
    if (!Number.isFinite(resolved)) {
      return;
    }
    update({ [key]: resolved } as Pick<PyrusSignalsRuntimeSettings, NumericSettingKey>);
  };

  const toggle = (key: BooleanSettingKey) => {
    update({ [key]: !settings[key] } as Pick<PyrusSignalsRuntimeSettings, BooleanSettingKey>);
  };

  const setColor = (key: keyof PyrusSignalsRuntimeSettings, nextSolidHex: string) => {
    const current = settings[key];
    if (typeof current !== "string") {
      return;
    }
    update({
      [key]: applySolidHexWithExistingAlpha(nextSolidHex, current),
    } as Partial<PyrusSignalsRuntimeSettings>);
  };

  const setRawString = (key: keyof PyrusSignalsRuntimeSettings, next: string) => {
    update({
      [key]: next,
    } as Partial<PyrusSignalsRuntimeSettings>);
  };

  const toggleSession = (session: PyrusSignalsSessionOption) => {
    update({
      sessions: settings.sessions.includes(session)
        ? settings.sessions.filter((value) => value !== session)
        : [...settings.sessions, session],
    });
  };

  const toggleSecondarySignalTimeframe = (
    timeframe: PyrusSignalsRuntimeSettings["secondarySignalTimeframes"][number],
  ) => {
    update({
      secondarySignalTimeframes: settings.secondarySignalTimeframes.includes(
        timeframe,
      )
        ? settings.secondarySignalTimeframes.filter((value) => value !== timeframe)
        : [...settings.secondarySignalTimeframes, timeframe],
    });
  };

  const styleEntries = [
    {
      label: "Shadow Upper / Shadow Lower",
      color: settings.shadowColor,
      detail: "line • width 1 • hidden price labels",
    },
    {
      label: "Shadow Fill",
      color: settings.shadowColor,
      detail: "fill • opacity from shadow color",
    },
    {
      label: "Bullish Main Line / Bearish Main Line",
      color: `${settings.bullColor} / ${settings.bearColor}`,
      detail: "line • width 3 • line break rendering",
    },
    {
      label: "Bull Wire 1/2/3, Bear Wire 1/2/3",
      color: `${settings.bullColor} / ${settings.bearColor}`,
      detail: "line • width 1 • line break rendering",
    },
    {
      label: "Bull Glow / Bear Glow",
      color: `${settings.bullColor} / ${settings.bearColor}`,
      detail: "fill between main line and wire 1",
    },
    {
      label: "Major HH / LH / HL / LL swing markers",
      color: "#86837D",
      detail: "badge markers • tiny labels",
    },
    {
      label: "Bull Break / Bear Break",
      color: `${settings.bullColor} / ${settings.bearColor}`,
      detail: "circle markers at broken swing level",
    },
    {
      label: "Bull BOS ↑ / Bear BOS ↓",
      color: `${settings.bullColor} / ${settings.bearColor}`,
      detail: "triangle markers • structure event badges",
    },
    {
      label: "Trend Candles",
      color: `${settings.bullColor} / ${settings.bearColor} / ${settings.filteredCandleColor}`,
      detail: "trend/reaction recoloring on price candles",
    },
  ];

  return (
    <Popover>
      <AppTooltip
        content={
          disabled
            ? "Enable Pyrus Signals to tune overlay settings"
            : "Tune Pyrus Signals overlay settings"
        }
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Pyrus Signals overlay"
            disabled={disabled}
            style={triggerStyle(theme, dense, disabled)}
          >
            {dense ? "PS" : "Pyrus Signals"}
          </button>
        </PopoverTrigger>
      </AppTooltip>
      <PopoverContent align="end" sideOffset={6} style={panelStyle(theme)}>
        <div style={headerStyle(theme)}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={titleKickerStyle(theme)}>Pyrus Signals Settings</div>
              <div style={{ fontSize: TYPE_CSS_VAR.bodyStrong, fontFamily: theme.mono, fontWeight: FONT_WEIGHTS.regular }}>
                {activeBandProfile?.label || "Custom"} profile
              </div>
              <div style={headerMetaStyle(theme)}>
                Inputs tab follows the TradingView declaration order. Style and Visibility tabs mirror the plot inventory and on-chart visibility toggles this renderer actually supports.
              </div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_PYRUS_SIGNALS_SETTINGS })}
              style={resetButtonStyle(theme)}
            >
              Reset
            </button>
          </div>

          <div style={tabsRowStyle}>
            {(["inputs", "style", "visibility"] as SettingsTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={tabButtonStyle(theme, activeTab === tab)}
              >
                {tab === "inputs" ? "Inputs" : tab === "style" ? "Style" : "Visibility"}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "inputs" ? (
          <>
            <Section
              theme={theme}
              title="1. Market Structure"
              description="The core signal-generation engine. These settings directly change CHOCH and BOS behavior."
              borderTop={false}
            >
              <Row
                theme={theme}
                label="Time Horizon"
                helper="Pivot lookback for swing confirmation."
                tooltip="Pivot lookback for swing confirmation. Lower = more signals and more whipsaw; higher = fewer, cleaner breaks."
              >
                <NumericSettingInput
                  theme={theme}
                  settingKey="timeHorizon"
                  min={2}
                  step={1}
                  value={settings.timeHorizon}
                  setNumber={setNumber}
                />
              </Row>
              <Row
                theme={theme}
                label="CHOCH ATR Buffer"
                helper="ATR-scaled threshold beyond the pivot for CHOCH triggers."
                tooltip="Filters wick-stab breaks. Zero means raw close-beyond-pivot behavior."
              >
                <NumericSettingInput
                  theme={theme}
                  settingKey="chochAtrBuffer"
                  min={0}
                  step={0.05}
                  value={settings.chochAtrBuffer}
                  setNumber={setNumber}
                />
              </Row>
              <Row
                theme={theme}
                label="CHOCH Body Expansion (ATR)"
                helper="Breakout candle body must be at least N × ATR."
                tooltip="Zero disables the body gate."
              >
                <NumericSettingInput
                  theme={theme}
                  settingKey="chochBodyExpansionAtr"
                  min={0}
                  step={0.1}
                  value={settings.chochBodyExpansionAtr}
                  setNumber={setNumber}
                />
              </Row>
              <Row
                theme={theme}
                label="CHOCH Volume Gate"
                helper="Breakout volume must be at least N × SMA(volume, Volume MA Length)."
                tooltip="Zero disables the volume gate."
              >
                <NumericSettingInput
                  theme={theme}
                  settingKey="chochVolumeGate"
                  min={0}
                  step={0.1}
                  value={settings.chochVolumeGate}
                  setNumber={setNumber}
                />
              </Row>
              <Row theme={theme} label="BOS/CHOCH Line Style">
                <select
                  value={settings.structureLineStyle}
                  onChange={(event) =>
                    update({
                      structureLineStyle:
                        event.target.value as PyrusSignalsRuntimeSettings["structureLineStyle"],
                    })
                  }
                  style={inputStyle(theme)}
                >
                  {PYRUS_SIGNALS_LINE_STYLE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Row>
              <Row theme={theme} label="Structure Labels">
                <div style={twoColumnInlineStyle}>
                  <InlineCheckbox theme={theme} label="Show BOS" checked={settings.showBos} onChange={() => toggle("showBos")} />
                  <InlineCheckbox theme={theme} label="Show CHOCH" checked={settings.showChoch} onChange={() => toggle("showChoch")} />
                  <InlineCheckbox theme={theme} label="Show Major Swing Labels" checked={settings.showSwings} onChange={() => toggle("showSwings")} />
                </div>
              </Row>
            </Section>

            <Section theme={theme} title="2. Trend Reversal Signal">
              <Row theme={theme} label="Show Trend Reversal Signals">
                <input type="checkbox" checked={settings.showTrendReversal} onChange={() => toggle("showTrendReversal")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Trend Reversal Colors">
                <div style={twoColumnInlineStyle}>
                  <ColorControl
                    theme={theme}
                    label="Line Color"
                    value={settings.trendReversalLineColor}
                    onColorChange={(value) => setColor("trendReversalLineColor", value)}
                    onTextChange={(value) => setRawString("trendReversalLineColor", value)}
                  />
                  <ColorControl
                    theme={theme}
                    label="Text Color"
                    value={settings.trendReversalTextColor}
                    onColorChange={(value) => setColor("trendReversalTextColor", value)}
                    onTextChange={(value) => setRawString("trendReversalTextColor", value)}
                  />
                </div>
              </Row>
              <Row theme={theme} label="Signal Line Length (Bars)">
                <NumericSettingInput
                  theme={theme}
                  settingKey="trendReversalLengthBars"
                  min={1}
                  step={1}
                  value={settings.trendReversalLengthBars}
                  setNumber={setNumber}
                />
              </Row>
            </Section>

            <Section theme={theme} title="3. Smart Order Blocks">
              <Row theme={theme} label="Show Order Blocks">
                <input type="checkbox" checked={settings.showOrderBlocks} onChange={() => toggle("showOrderBlocks")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Order Block Colors">
                <div style={twoColumnInlineStyle}>
                  <ColorControl
                    theme={theme}
                    label="Bullish OB Color"
                    value={settings.orderBlockBullColor}
                    onColorChange={(value) => setColor("orderBlockBullColor", value)}
                    onTextChange={(value) => setRawString("orderBlockBullColor", value)}
                  />
                  <ColorControl
                    theme={theme}
                    label="Bearish OB Color"
                    value={settings.orderBlockBearColor}
                    onColorChange={(value) => setColor("orderBlockBearColor", value)}
                    onTextChange={(value) => setRawString("orderBlockBearColor", value)}
                  />
                </div>
              </Row>
              <Row theme={theme} label="Max Active OBs (per side)">
                <NumericSettingInput
                  theme={theme}
                  settingKey="orderBlockMaxActivePerSide"
                  min={1}
                  max={20}
                  step={1}
                  value={settings.orderBlockMaxActivePerSide}
                  setNumber={setNumber}
                />
              </Row>
            </Section>

            <Section theme={theme} title="4. Support & Resistance">
              <Row theme={theme} label="Show Support/Resistance Zones">
                <input type="checkbox" checked={settings.showSupportResistance} onChange={() => toggle("showSupportResistance")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Pivot Strength">
                <NumericSettingInput
                  theme={theme}
                  settingKey="supportResistancePivotStrength"
                  min={2}
                  step={1}
                  value={settings.supportResistancePivotStrength}
                  setNumber={setNumber}
                />
              </Row>
              <Row theme={theme} label="Minimum Zone Distance (%)" helper="Prevents zones from drawing too close together.">
                <NumericSettingInput
                  theme={theme}
                  settingKey="supportResistanceMinZoneDistancePercent"
                  min={0.01}
                  step={0.01}
                  value={settings.supportResistanceMinZoneDistancePercent}
                  setNumber={setNumber}
                />
              </Row>
              <Row theme={theme} label="Zone Thickness (ATR Mult)" helper="ATR multiplier for zone thickness.">
                <NumericSettingInput
                  theme={theme}
                  settingKey="supportResistanceThicknessMultiplier"
                  min={0.01}
                  step={0.01}
                  value={settings.supportResistanceThicknessMultiplier}
                  setNumber={setNumber}
                />
              </Row>
              <Row theme={theme} label="Max Number of Zones">
                <NumericSettingInput
                  theme={theme}
                  settingKey="supportResistanceMaxZones"
                  min={1}
                  max={20}
                  step={1}
                  value={settings.supportResistanceMaxZones}
                  setNumber={setNumber}
                />
              </Row>
              <Row theme={theme} label="Zone Extension (Bars)">
                <NumericSettingInput
                  theme={theme}
                  settingKey="supportResistanceExtensionBars"
                  min={1}
                  step={1}
                  value={settings.supportResistanceExtensionBars}
                  setNumber={setNumber}
                />
              </Row>
              <Row theme={theme} label="Zone Colors">
                <div style={twoColumnInlineStyle}>
                  <ColorControl
                    theme={theme}
                    label="Resistance Color"
                    value={settings.resistanceZoneColor}
                    onColorChange={(value) => setColor("resistanceZoneColor", value)}
                    onTextChange={(value) => setRawString("resistanceZoneColor", value)}
                  />
                  <ColorControl
                    theme={theme}
                    label="Support Color"
                    value={settings.supportZoneColor}
                    onColorChange={(value) => setColor("supportZoneColor", value)}
                    onTextChange={(value) => setRawString("supportZoneColor", value)}
                  />
                </div>
              </Row>
            </Section>

            <Section theme={theme} title="5. Key Levels">
              <Row theme={theme} label="Show Key Levels">
                <input type="checkbox" checked={settings.showKeyLevels} onChange={() => toggle("showKeyLevels")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Line Style">
                <select
                  value={settings.keyLevelLineStyle}
                  onChange={(event) =>
                    update({
                      keyLevelLineStyle:
                        event.target.value as PyrusSignalsRuntimeSettings["keyLevelLineStyle"],
                    })
                  }
                  style={inputStyle(theme)}
                >
                  {PYRUS_SIGNALS_LINE_STYLE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Row>
              <Row theme={theme} label="Label Size">
                <select
                  value={settings.keyLevelLabelSize}
                  onChange={(event) =>
                    update({
                      keyLevelLabelSize:
                        event.target.value as PyrusSignalsRuntimeSettings["keyLevelLabelSize"],
                    })
                  }
                  style={inputStyle(theme)}
                >
                  {PYRUS_SIGNALS_LABEL_SIZE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Row>
              <Row theme={theme} label="Prior Day High / Prior Day Low">
                <div style={twoColumnInlineStyle}>
                  <InlineCheckbox theme={theme} label="Prior Day High" checked={settings.showPriorDayHigh} onChange={() => toggle("showPriorDayHigh")} />
                  <InlineCheckbox theme={theme} label="Prior Day Low" checked={settings.showPriorDayLow} onChange={() => toggle("showPriorDayLow")} />
                </div>
              </Row>
              <Row theme={theme} label="Prior Day Close / Today's Open">
                <div style={twoColumnInlineStyle}>
                  <InlineCheckbox theme={theme} label="Prior Day Close" checked={settings.showPriorDayClose} onChange={() => toggle("showPriorDayClose")} />
                  <InlineCheckbox theme={theme} label="Today's Open" checked={settings.showTodayOpen} onChange={() => toggle("showTodayOpen")} />
                </div>
              </Row>
              <Row theme={theme} label="Prior Week High / Prior Week Low">
                <div style={twoColumnInlineStyle}>
                  <InlineCheckbox theme={theme} label="Prior Week High" checked={settings.showPriorWeekHigh} onChange={() => toggle("showPriorWeekHigh")} />
                  <InlineCheckbox theme={theme} label="Prior Week Low" checked={settings.showPriorWeekLow} onChange={() => toggle("showPriorWeekLow")} />
                </div>
              </Row>
              <Row theme={theme} label="High Color / Low Color">
                <div style={twoColumnInlineStyle}>
                  <ColorControl
                    theme={theme}
                    label="High Color"
                    value={settings.keyLevelHighColor}
                    onColorChange={(value) => setColor("keyLevelHighColor", value)}
                    onTextChange={(value) => setRawString("keyLevelHighColor", value)}
                  />
                  <ColorControl
                    theme={theme}
                    label="Low Color"
                    value={settings.keyLevelLowColor}
                    onColorChange={(value) => setColor("keyLevelLowColor", value)}
                    onTextChange={(value) => setRawString("keyLevelLowColor", value)}
                  />
                </div>
              </Row>
              <Row theme={theme} label="Close Color / Open Color">
                <div style={twoColumnInlineStyle}>
                  <ColorControl
                    theme={theme}
                    label="Close Color"
                    value={settings.keyLevelCloseColor}
                    onColorChange={(value) => setColor("keyLevelCloseColor", value)}
                    onTextChange={(value) => setRawString("keyLevelCloseColor", value)}
                  />
                  <ColorControl
                    theme={theme}
                    label="Open Color"
                    value={settings.keyLevelOpenColor}
                    onColorChange={(value) => setColor("keyLevelOpenColor", value)}
                    onTextChange={(value) => setRawString("keyLevelOpenColor", value)}
                  />
                </div>
              </Row>
              <Row
                theme={theme}
                label="Label Offset (Bars Right)"
                helper="Pushes level labels right of the current bar so they do not overlap TP/SL markers."
              >
                <NumericSettingInput
                  theme={theme}
                  settingKey="keyLevelLabelOffsetBars"
                  min={0}
                  max={50}
                  step={1}
                  value={settings.keyLevelLabelOffsetBars}
                  setNumber={setNumber}
                />
              </Row>
            </Section>

            <Section theme={theme} title="6. Main Trend Settings">
              <Row theme={theme} label="Basis Length">
                <NumericSettingInput theme={theme} settingKey="basisLength" min={1} step={1} value={settings.basisLength} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="ATR Length">
                <NumericSettingInput theme={theme} settingKey="atrLength" min={1} step={1} value={settings.atrLength} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="ATR Smoothing">
                <NumericSettingInput theme={theme} settingKey="atrSmoothing" min={1} step={1} value={settings.atrSmoothing} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="Volatility Multiplier">
                <NumericSettingInput theme={theme} settingKey="volatilityMultiplier" min={0.1} step={0.1} value={settings.volatilityMultiplier} setNumber={setNumber} />
              </Row>
            </Section>

            <Section theme={theme} title="7. Visuals: Neon Wireframe">
              <Row theme={theme} label="Show Wireframe Bands">
                <input type="checkbox" checked={settings.showWires} onChange={() => toggle("showWires")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Wireframe Spread">
                <NumericSettingInput theme={theme} settingKey="wireSpread" min={0.01} step={0.1} value={settings.wireSpread} setNumber={setNumber} />
              </Row>
            </Section>

            <Section theme={theme} title="8. Visuals: Volatility Shadow">
              <Row theme={theme} label="Show Volatility Shadow">
                <input type="checkbox" checked={settings.showShadow} onChange={() => toggle("showShadow")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Length">
                <NumericSettingInput theme={theme} settingKey="shadowLength" min={1} step={1} value={settings.shadowLength} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="StdDev">
                <NumericSettingInput theme={theme} settingKey="shadowStdDev" min={0.001} max={50} step={0.001} value={settings.shadowStdDev} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="Shadow Color">
                <ColorControl
                  theme={theme}
                  label="Shadow Color"
                  value={settings.shadowColor}
                  onColorChange={(value) => setColor("shadowColor", value)}
                  onTextChange={(value) => setRawString("shadowColor", value)}
                />
              </Row>
            </Section>

            <Section theme={theme} title="9. Sessions">
              <div style={inlineControlsStyle}>
                <InlineCheckbox theme={theme} label="London" checked={settings.showLondonSession} onChange={() => toggle("showLondonSession")} />
                <InlineCheckbox theme={theme} label="New York" checked={settings.showNewYorkSession} onChange={() => toggle("showNewYorkSession")} />
                <InlineCheckbox theme={theme} label="Tokyo" checked={settings.showTokyoSession} onChange={() => toggle("showTokyoSession")} />
                <InlineCheckbox theme={theme} label="Sydney" checked={settings.showSydneySession} onChange={() => toggle("showSydneySession")} />
              </div>
            </Section>

            <Section theme={theme} title="10. TP/SL Settings">
              <Row theme={theme} label="Show TP/SL Levels">
                <input type="checkbox" checked={settings.showTpSl} onChange={() => toggle("showTpSl")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="TP 1 Risk/Reward">
                <NumericSettingInput theme={theme} settingKey="tp1Rr" step={0.1} value={settings.tp1Rr} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="TP 2 Risk/Reward">
                <NumericSettingInput theme={theme} settingKey="tp2Rr" step={0.1} value={settings.tp2Rr} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="TP 3 Risk/Reward">
                <NumericSettingInput theme={theme} settingKey="tp3Rr" step={0.1} value={settings.tp3Rr} setNumber={setNumber} />
              </Row>
            </Section>

            <Section theme={theme} title="11. Info Strip">
              <Row theme={theme} label="Show Info Strip">
                <input type="checkbox" checked={settings.showDashboard} onChange={() => toggle("showDashboard")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Strip Size">
                <select
                  value={settings.dashboardSize}
                  onChange={(event) =>
                    update({
                      dashboardSize:
                        event.target.value as PyrusSignalsRuntimeSettings["dashboardSize"],
                    })
                  }
                  style={inputStyle(theme)}
                >
                  {PYRUS_SIGNALS_DASHBOARD_SIZE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Row>
              <Row theme={theme} label="ADX Length">
                <NumericSettingInput theme={theme} settingKey="adxLength" min={1} step={1} value={settings.adxLength} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="Volume MA Length" helper="Also used by the CHOCH Volume Gate in Market Structure.">
                <NumericSettingInput theme={theme} settingKey="volumeMaLength" min={1} step={1} value={settings.volumeMaLength} setNumber={setNumber} />
              </Row>
              <Row theme={theme} label="MTF 1 / MTF 2 / MTF 3">
                <div style={threeColumnStyle}>
                  <select value={settings.mtf1} onChange={(event) => update({ mtf1: event.target.value as PyrusSignalsRuntimeSettings["mtf1"] })} style={inputStyle(theme)}>
                    {PYRUS_SIGNALS_MTF_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select value={settings.mtf2} onChange={(event) => update({ mtf2: event.target.value as PyrusSignalsRuntimeSettings["mtf2"] })} style={inputStyle(theme)}>
                    {PYRUS_SIGNALS_MTF_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select value={settings.mtf3} onChange={(event) => update({ mtf3: event.target.value as PyrusSignalsRuntimeSettings["mtf3"] })} style={inputStyle(theme)}>
                    {PYRUS_SIGNALS_MTF_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </Row>
            </Section>

            <Section theme={theme} title="12. Appearance">
              <Row theme={theme} label="Bull Color / Bear Color">
                <div style={twoColumnInlineStyle}>
                  <ColorControl
                    theme={theme}
                    label="Bull Color"
                    value={settings.bullColor}
                    onColorChange={(value) => setColor("bullColor", value)}
                    onTextChange={(value) => setRawString("bullColor", value)}
                  />
                  <ColorControl
                    theme={theme}
                    label="Bear Color"
                    value={settings.bearColor}
                    onColorChange={(value) => setColor("bearColor", value)}
                    onTextChange={(value) => setRawString("bearColor", value)}
                  />
                </div>
              </Row>
              <Row theme={theme} label="Show Trend Background">
                <input type="checkbox" checked={settings.showRegimeWindows} onChange={() => toggle("showRegimeWindows")} style={checkboxStyle(theme)} />
              </Row>
              <Row
                theme={theme}
                label="Buy/Sell Offset (ATR × N)"
                helper="Distance between BUY/SELL labels and the signal candle, measured in ATR units."
              >
                <NumericSettingInput theme={theme} settingKey="signalOffsetAtr" min={0} step={0.1} value={settings.signalOffsetAtr} setNumber={setNumber} />
              </Row>
            </Section>

            <Section theme={theme} title="13. Alerts">
              <Row theme={theme} label="Wait for Bar Close (Signal Alerts)">
                <input type="checkbox" checked={settings.waitForBarClose} onChange={() => toggle("waitForBarClose")} style={checkboxStyle(theme)} />
              </Row>
            </Section>

            <Section theme={theme} title="14. Signal Filters">
              <Row theme={theme} label="Enable Signal Filters">
                <input type="checkbox" checked={settings.signalFiltersEnabled} onChange={() => toggle("signalFiltersEnabled")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Filtered Candle Color" helper="Recolors candles on CHOCH bars that are filtered out.">
                <ColorControl
                  theme={theme}
                  label="Filtered Candle Color"
                  value={settings.filteredCandleColor}
                  onColorChange={(value) => setColor("filteredCandleColor", value)}
                  onTextChange={(value) => setRawString("filteredCandleColor", value)}
                />
              </Row>
              <Row theme={theme} label="Require MTF 1 / 2 / 3 Alignment">
                <div style={threeColumnStyle}>
                  <InlineCheckbox theme={theme} label="MTF 1" checked={settings.requireMtf1} onChange={() => toggle("requireMtf1")} />
                  <InlineCheckbox theme={theme} label="MTF 2" checked={settings.requireMtf2} onChange={() => toggle("requireMtf2")} />
                  <InlineCheckbox theme={theme} label="MTF 3" checked={settings.requireMtf3} onChange={() => toggle("requireMtf3")} />
                </div>
              </Row>
              <Row theme={theme} label="Require ADX >= Min">
                <div style={twoColumnInlineStyle}>
                  <InlineCheckbox theme={theme} label="Enable ADX Gate" checked={settings.requireAdx} onChange={() => toggle("requireAdx")} />
                  <NumericSettingInput theme={theme} settingKey="adxMin" min={1} max={100} step={1} value={settings.adxMin} setNumber={setNumber} />
                </div>
              </Row>
              <Row theme={theme} label="Require Volatility Score Range">
                <div style={inlineControlsStyle}>
                  <InlineCheckbox theme={theme} label="Enable Volatility Gate" checked={settings.requireVolScoreRange} onChange={() => toggle("requireVolScoreRange")} />
                  <div style={twoColumnInlineStyle}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={miniLabelStyle(theme)}>Vol Score Min</div>
                      <NumericSettingInput theme={theme} settingKey="volScoreMin" min={0} max={10} step={1} value={settings.volScoreMin} setNumber={setNumber} />
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={miniLabelStyle(theme)}>Vol Score Max</div>
                      <NumericSettingInput theme={theme} settingKey="volScoreMax" min={0} max={10} step={1} value={settings.volScoreMax} setNumber={setNumber} />
                    </div>
                  </div>
                </div>
              </Row>
              <Row theme={theme} label="Restrict to Selected Sessions">
                <div style={inlineControlsStyle}>
                  <InlineCheckbox theme={theme} label="Enable Session Gate" checked={settings.restrictToSelectedSessions} onChange={() => toggle("restrictToSelectedSessions")} />
                  <div style={twoColumnInlineStyle}>
                    {PYRUS_SIGNALS_SESSION_OPTIONS.map((option) => (
                      <InlineCheckbox
                        key={option.value}
                        theme={theme}
                        label={option.label}
                        checked={settings.sessions.includes(option.value)}
                        onChange={() => toggleSession(option.value)}
                      />
                    ))}
                  </div>
                </div>
              </Row>
            </Section>
          </>
        ) : null}

        {activeTab === "style" ? (
          <>
            <Section
              theme={theme}
              title="Style"
              description="TradingView auto-generates plot style controls from plot() calls. This surface mirrors the current plot inventory and the color sources it already supports."
              borderTop={false}
            >
              <div style={noteBoxStyle(theme)}>
                Price-scale labels, status-line values, and per-plot precision toggles are not individually configurable in this chart surface yet. The entries below reflect the actual Pyrus Signals studies being rendered right now.
              </div>
              {styleEntries.map((entry) => (
                <div key={entry.label} style={styleEntryStyle(theme)}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={rowLabelStyle(theme)}>{entry.label}</div>
                    <div style={rowHelperStyle(theme)}>{entry.detail}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={swatchStyle(theme, entry.color.includes("/") ? settings.bullColor : entry.color)} />
                    <span style={rowHelperStyle(theme)}>{entry.color}</span>
                  </div>
                </div>
              ))}
            </Section>
          </>
        ) : null}

        {activeTab === "visibility" ? (
          <>
            <Section
              theme={theme}
              title="Visibility"
              description="These toggles control the Pyrus Signals elements this chart surface can actually show or hide today."
              borderTop={false}
            >
              <div style={noteBoxStyle(theme)}>
                The switches below control the Pyrus Signals elements this adapter renders on the chart, including secondary BUY/SELL badges from selected source timeframes when source bars are available.
              </div>
              <Row theme={theme} label="Secondary Signal Badges">
                <input type="checkbox" checked={settings.showSecondarySignals} onChange={() => toggle("showSecondarySignals")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Secondary Source Timeframes">
                <div style={threeColumnStyle}>
                  {PYRUS_SIGNALS_MTF_OPTIONS.map((timeframe) => (
                    <InlineCheckbox
                      key={timeframe}
                      theme={theme}
                      label={timeframe}
                      checked={settings.secondarySignalTimeframes.includes(timeframe)}
                      onChange={() => toggleSecondarySignalTimeframe(timeframe)}
                      disabled={!settings.showSecondarySignals}
                    />
                  ))}
                </div>
              </Row>
              <Row theme={theme} label="Trend Candles">
                <input type="checkbox" checked={settings.colorCandles} onChange={() => toggle("colorCandles")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Trend Background">
                <input type="checkbox" checked={settings.showRegimeWindows} onChange={() => toggle("showRegimeWindows")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Volatility Shadow">
                <input type="checkbox" checked={settings.showShadow} onChange={() => toggle("showShadow")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Wireframe Bands">
                <input type="checkbox" checked={settings.showWires} onChange={() => toggle("showWires")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show BOS / CHOCH / Major Swing Labels">
                <div style={threeColumnStyle}>
                  <InlineCheckbox theme={theme} label="BOS" checked={settings.showBos} onChange={() => toggle("showBos")} />
                  <InlineCheckbox theme={theme} label="CHOCH" checked={settings.showChoch} onChange={() => toggle("showChoch")} />
                  <InlineCheckbox theme={theme} label="Major Swings" checked={settings.showSwings} onChange={() => toggle("showSwings")} />
                </div>
              </Row>
              <Row theme={theme} label="Show Trend Reversal Signals">
                <input type="checkbox" checked={settings.showTrendReversal} onChange={() => toggle("showTrendReversal")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Order Blocks">
                <input type="checkbox" checked={settings.showOrderBlocks} onChange={() => toggle("showOrderBlocks")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Support/Resistance Zones">
                <input type="checkbox" checked={settings.showSupportResistance} onChange={() => toggle("showSupportResistance")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Key Levels">
                <input type="checkbox" checked={settings.showKeyLevels} onChange={() => toggle("showKeyLevels")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show TP/SL Levels">
                <input type="checkbox" checked={settings.showTpSl} onChange={() => toggle("showTpSl")} style={checkboxStyle(theme)} />
              </Row>
              <Row theme={theme} label="Show Info Panel">
                <input type="checkbox" checked={settings.showDashboard} onChange={() => toggle("showDashboard")} style={checkboxStyle(theme)} />
              </Row>
            </Section>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
