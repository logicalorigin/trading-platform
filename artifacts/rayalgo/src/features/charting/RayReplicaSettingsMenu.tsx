import type { CSSProperties } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_RAY_REPLICA_SETTINGS,
  type RayReplicaRuntimeSettings,
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
  | "timeHorizon"
  | "basisLength"
  | "atrLength"
  | "atrSmoothing"
  | "volatilityMultiplier"
  | "wireSpread"
  | "shadowLength"
  | "shadowStdDev"
  | "adxLength"
  | "volumeMaLength"
  | "tp1Rr"
  | "tp2Rr"
  | "tp3Rr";

type EnumSettingKey =
  | "bosConfirmation"
  | "mtf1"
  | "mtf2"
  | "mtf3"
  | "dashboardPosition"
  | "dashboardSize";

type BooleanSettingKey =
  | "showWires"
  | "showShadow"
  | "showKeyLevels"
  | "showStructure"
  | "showContinuationSignals"
  | "showOrderBlocks"
  | "showSupportResistance"
  | "showTpSl"
  | "showDashboard"
  | "showRegimeWindows"
  | "colorCandles"
  | "waitForBarClose";

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

const contentStyle = (theme: WidgetTheme): CSSProperties => ({
  width: 260,
  background: theme.bg4,
  border: `1px solid ${theme.border}`,
  color: theme.text,
});

const labelStyle = (theme: WidgetTheme): CSSProperties => ({
  color: theme.textMuted,
  fontFamily: theme.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
});

const itemStyle = (theme: WidgetTheme): CSSProperties => ({
  color: theme.text,
  fontFamily: theme.mono,
  fontSize: 12,
});

const formatNumericLabel = (key: NumericSettingKey, value: number): string => {
  if (
    key === "volatilityMultiplier" ||
    key === "wireSpread" ||
    key === "shadowStdDev" ||
    key === "tp1Rr" ||
    key === "tp2Rr" ||
    key === "tp3Rr"
  ) {
    return value.toFixed(value % 1 === 0 ? 0 : 2).replace(/\.00$/, "");
  }

  return String(value);
};

const numericOptions: Array<{
  key: NumericSettingKey;
  label: string;
  values: number[];
}> = [
  { key: "timeHorizon", label: "Structure sensitivity", values: [6, 10, 14] },
  { key: "basisLength", label: "Basis length", values: [40, 80, 120] },
  { key: "atrLength", label: "ATR length", values: [10, 14, 21] },
  { key: "atrSmoothing", label: "ATR smoothing", values: [14, 21, 34] },
  {
    key: "volatilityMultiplier",
    label: "Volatility band",
    values: [1.5, 2, 2.5, 3],
  },
  { key: "wireSpread", label: "Wire spacing", values: [0.25, 0.5, 0.75, 1] },
  { key: "shadowLength", label: "Shadow length", values: [10, 20, 34] },
  { key: "shadowStdDev", label: "Shadow sigma", values: [1.5, 2, 2.5] },
  { key: "adxLength", label: "ADX length", values: [10, 14, 21] },
  { key: "volumeMaLength", label: "Volume MA", values: [10, 20, 30] },
  { key: "tp1Rr", label: "TP1 RR", values: [0.5, 1, 1.5] },
  { key: "tp2Rr", label: "TP2 RR", values: [1, 2, 3] },
  { key: "tp3Rr", label: "TP3 RR", values: [1.7, 2.5, 4] },
];

const enumOptions: Array<{
  key: EnumSettingKey;
  label: string;
  values: Array<{ value: string; label: string }>;
}> = [
  {
    key: "bosConfirmation",
    label: "BOS confirmation",
    values: [
      { value: "close", label: "Close" },
      { value: "wicks", label: "Wicks" },
    ],
  },
  {
    key: "mtf1",
    label: "MTF 1",
    values: [
      { value: "1m", label: "1m" },
      { value: "5m", label: "5m" },
      { value: "15m", label: "15m" },
      { value: "30m", label: "30m" },
      { value: "1h", label: "1h" },
      { value: "4h", label: "4h" },
      { value: "D", label: "D1" },
    ],
  },
  {
    key: "mtf2",
    label: "MTF 2",
    values: [
      { value: "5m", label: "5m" },
      { value: "15m", label: "15m" },
      { value: "30m", label: "30m" },
      { value: "1h", label: "1h" },
      { value: "4h", label: "4h" },
      { value: "D", label: "D1" },
    ],
  },
  {
    key: "mtf3",
    label: "MTF 3",
    values: [
      { value: "15m", label: "15m" },
      { value: "30m", label: "30m" },
      { value: "1h", label: "1h" },
      { value: "4h", label: "4h" },
      { value: "D", label: "D1" },
    ],
  },
  {
    key: "dashboardPosition",
    label: "Dashboard position",
    values: [
      { value: "bottom-right", label: "Bottom right" },
      { value: "bottom-left", label: "Bottom left" },
      { value: "top-right", label: "Top right" },
      { value: "top-left", label: "Top left" },
    ],
  },
  {
    key: "dashboardSize",
    label: "Dashboard size",
    values: [
      { value: "compact", label: "Compact" },
      { value: "expanded", label: "Expanded" },
    ],
  },
];

const booleanOptions: Array<{
  key: BooleanSettingKey;
  label: string;
}> = [
  { key: "showWires", label: "Show wires" },
  { key: "showShadow", label: "Show shadow" },
  { key: "showKeyLevels", label: "Show key levels" },
  { key: "showStructure", label: "Show structure events" },
  { key: "showContinuationSignals", label: "Show continuation arrows" },
  { key: "showOrderBlocks", label: "Show order blocks" },
  { key: "showSupportResistance", label: "Show support/resistance" },
  { key: "showTpSl", label: "Show TP/SL" },
  { key: "showDashboard", label: "Show dashboard" },
  { key: "showRegimeWindows", label: "Show regime windows" },
  { key: "colorCandles", label: "Color candles" },
  { key: "waitForBarClose", label: "Wait for bar close" },
];

export function RayReplicaSettingsMenu({
  theme,
  settings,
  onChange,
  dense = false,
  disabled = false,
}: RayReplicaSettingsMenuProps) {
  const setNumeric = (key: NumericSettingKey, value: string) => {
    const resolved = Number(value);
    if (!Number.isFinite(resolved)) {
      return;
    }

    onChange({
      ...settings,
      [key]: resolved,
    });
  };

  const setBoolean = (key: BooleanSettingKey, value: boolean) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  const setEnum = (key: EnumSettingKey, value: string) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        style={contentStyle(theme)}
      >
        <DropdownMenuLabel style={labelStyle(theme)}>
          RayReplica
        </DropdownMenuLabel>
        {numericOptions.map((group) => (
          <div key={group.key}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel style={labelStyle(theme)}>
              {group.label}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(settings[group.key])}
              onValueChange={(value) => setNumeric(group.key, value)}
            >
              {group.values.map((value) => (
                <DropdownMenuRadioItem
                  key={`${group.key}-${value}`}
                  value={String(value)}
                  style={itemStyle(theme)}
                >
                  {formatNumericLabel(group.key, value)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
        {enumOptions.map((group) => (
          <div key={group.key}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel style={labelStyle(theme)}>
              {group.label}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(settings[group.key])}
              onValueChange={(value) => setEnum(group.key, value)}
            >
              {group.values.map((value) => (
                <DropdownMenuRadioItem
                  key={`${group.key}-${value.value}`}
                  value={value.value}
                  style={itemStyle(theme)}
                >
                  {value.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel style={labelStyle(theme)}>
          Overlay
        </DropdownMenuLabel>
        {booleanOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.key}
            checked={settings[option.key]}
            onCheckedChange={(value) => setBoolean(option.key, value === true)}
            style={itemStyle(theme)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onChange({ ...DEFAULT_RAY_REPLICA_SETTINGS })}
          style={itemStyle(theme)}
        >
          Reset defaults
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
