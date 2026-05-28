import {
  useId,
  useMemo,
  useState,
} from "react";
import { buildAlgoTuningImpact } from "../../features/platform/algoTuningImpactModel";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { SegmentedControl } from "../../components/platform/primitives.jsx";
import {
  SIGNAL_OPTIONS_EXPANDED_CAPACITY,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  compactButtonStyle,
  formatChaseSteps,
  formatMoney,
  formatProgressiveTrailSteps,
  numberFrom,
  parseChaseSteps,
  parseProgressiveTrailSteps,
} from "./algoHelpers";
import {
  SETTINGS_SECTIONS,
  countDirtyFieldsBySection,
  formatSettingValue,
  getPathValue,
  isNumericSettingType,
} from "./algoSettingsFields";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

const STRIKE_SLOT_ROWS = [...SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS]
  .sort((left, right) => Number(right.value) - Number(left.value));
const STRIKE_SLOT_VALUES_DESC = STRIKE_SLOT_ROWS.map((option) =>
  Number(option.value),
);
const STRIKE_SLOT_META = {
  0: { strikeLabel: "-2", callLabel: "ITM 2", putLabel: "OTM 2" },
  1: { strikeLabel: "-1", callLabel: "ITM 1", putLabel: "OTM 1" },
  2: { strikeLabel: "ATM-", callLabel: "ATM-", putLabel: "ATM-" },
  3: { strikeLabel: "ATM+", callLabel: "ATM+", putLabel: "ATM+" },
  4: { strikeLabel: "+1", callLabel: "OTM 1", putLabel: "ITM 1" },
  5: { strikeLabel: "+2", callLabel: "OTM 2", putLabel: "ITM 2" },
};

const EXIT_TRACK_MARKERS = [
  {
    key: "hard-stop",
    fieldPath: "exitPolicy.hardStopPct",
    label: "Stop",
    tone: CSS_COLOR.red,
    side: "loss",
  },
  {
    key: "early-loss",
    fieldPath: "exitPolicy.earlyExitLossPct",
    label: "Early",
    tone: CSS_COLOR.red,
    side: "loss",
    positionValue: (value) => -Math.abs(Number(value) || 0),
  },
  {
    key: "trail-activation",
    fieldPath: "exitPolicy.trailActivationPct",
    label: "Trail",
    tone: CSS_COLOR.green,
    side: "gain",
  },
  {
    key: "min-locked",
    fieldPath: "exitPolicy.minLockedGainPct",
    label: "Lock",
    tone: CSS_COLOR.green,
    side: "gain",
  },
  {
    key: "five-x",
    fieldPath: "exitPolicy.tightenAtFiveXGivebackPct",
    label: "5x",
    tone: CSS_COLOR.green,
    side: "gain",
  },
  {
    key: "ten-x",
    fieldPath: "exitPolicy.tightenAtTenXGivebackPct",
    label: "10x",
    tone: CSS_COLOR.green,
    side: "gain",
  },
];

export const fieldKey = (field) => `${field.slice}.${field.path}`;

const getDraftRoot = ({ field, profileDraft, strategySettingsDraft }) =>
  field.slice === "profile" ? profileDraft : strategySettingsDraft;

const getBaselineRoot = ({ field, profileBaseline, strategyBaseline }) =>
  field.slice === "profile" ? profileBaseline : strategyBaseline;

const getPatchHandler = ({
  field,
  patchProfileDraftPath,
  patchStrategySettingsPath,
}) =>
  field.slice === "profile" ? patchProfileDraftPath : patchStrategySettingsPath;

const compactUnitLabel = (field) => {
  if (!field?.unit) return null;
  if (field.format === "money" || field.unit === "USD") return "$";
  if (
    field.unit === "% of mid" ||
    field.unit === "%" ||
    field.unit === "% from entry" ||
    field.unit === "% gain"
  ) {
    return "%";
  }
  if (field.unit === "x ATR") return "ATR";
  if (field.unit === "x avg") return "avg";
  if (field.unit === "seconds") return "sec";
  if (field.unit === "bars") return "bars";
  if (field.unit === "days") return "d";
  if (field.unit === "matches") return "of 3";
  return field.unit;
};

const compactInputStyle = ({ invalid, disabled, numeric = false }) => ({
  height: dim(24),
  width: "100%",
  minWidth: 0,
  padding: sp("0 6px"),
  border: `1px solid ${invalid ? CSS_COLOR.red : CSS_COLOR.border}`,
  borderRadius: dim(RADII.xs),
  background: CSS_COLOR.bg1,
  color: invalid ? CSS_COLOR.red : CSS_COLOR.text,
  fontFamily: numeric ? T.data : T.sans,
  fontSize: textSize("caption"),
  outline: "none",
  boxSizing: "border-box",
  opacity: disabled ? 0.55 : 1,
  cursor: disabled ? "not-allowed" : undefined,
  textAlign: numeric ? "right" : "left",
});

const compactImpactSummary = (field, impact) => {
  if (!field.impact || !impact) return null;
  const count = Number(impact.count || 0);
  const hasImpact = count > 0;
  const symbols = (impact.sampleSymbols || [])
    .slice(0, 5)
    .map((symbol) => String(symbol || "").toUpperCase())
    .filter(Boolean);
  return {
    color:
      hasImpact && field.warningWhenNonZero !== false
        ? CSS_COLOR.amber
        : CSS_COLOR.textMuted,
    background:
      hasImpact && field.warningWhenNonZero !== false
        ? cssColorMix(CSS_COLOR.amber, 12)
        : "transparent",
    label:
      impact.total != null
        ? `${count}/${impact.total}`
        : hasImpact
          ? `${count} block`
          : "clear",
    title: symbols.length ? symbols.join(", ") : field.label,
  };
};

const numericField = (field) =>
  isNumericSettingType(field.type) || field.type === "number";

export const CompactSwitch = ({
  checked,
  disabled,
  ariaLabel,
  testId,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    data-testid={testId}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{
      width: dim(27),
      height: dim(16),
      minWidth: dim(27),
      minHeight: dim(16),
      border: `1px solid ${checked ? CSS_COLOR.accent : CSS_COLOR.border}`,
      borderRadius: dim(RADII.pill),
      background: checked ? cssColorMix(CSS_COLOR.accent, 18) : "transparent",
      padding: dim(1),
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      display: "flex",
      alignItems: "center",
      justifyContent: checked ? "flex-end" : "flex-start",
      boxSizing: "border-box",
      lineHeight: 0,
      flex: "0 0 auto",
      transition: "border-color 140ms ease, background 140ms ease",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: dim(11),
        height: dim(11),
        borderRadius: dim(RADII.pill),
        background: checked ? CSS_COLOR.accent : CSS_COLOR.textMuted,
        display: "block",
        transition: "transform 140ms ease",
      }}
    />
  </button>
);

const CompactLabel = ({ label, dirty, previousValue, field, impact }) => (
  <span
    style={{
      display: "flex",
      alignItems: "baseline",
      gap: sp(2),
      minWidth: 0,
      width: "100%",
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.label,
        lineHeight: 1.1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {label}
    </span>
    {dirty ? (
      <span
        role="status"
        aria-label={`${label} unsaved`}
        title={`was: ${formatSettingValue(field, previousValue)}`}
        style={{
          width: dim(5),
          height: dim(5),
          borderRadius: dim(RADII.pill),
          background: CSS_COLOR.accent,
          flex: "0 0 auto",
          opacity: 1,
          transition: "opacity 120ms ease",
        }}
      />
    ) : null}
    {impact ? (
      <span
        title={impact.title}
        style={{
          color: impact.color,
          background: impact.background,
          borderRadius: dim(RADII.xs),
          fontFamily: T.sans,
          fontSize: textSize("micro"),
          lineHeight: 1,
          marginLeft: "auto",
          padding: sp("0 4px"),
          flex: "0 0 auto",
        }}
      >
        {impact.label}
      </span>
    ) : null}
  </span>
);

export const CompactFieldInput = ({
  id,
  field,
  value,
  invalid,
  disabled,
  ariaLabel,
  testId,
  onPatch,
}) => {
  const numeric = numericField(field);
  const inputStyle = compactInputStyle({ invalid, disabled, numeric });
  if (field.type === "select") {
    return (
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event) =>
          onPatch(
            field.path,
            field.coerce ? field.coerce(event.target.value) : event.target.value,
          )
        }
        style={inputStyle}
      >
        {(field.options || []).map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    );
  }
  if (field.type === "text") {
    return (
      <input
        id={id}
        type="text"
        value={
          field.format === "chaseSteps"
            ? formatChaseSteps(value)
            : field.format === "progressiveTrailSteps"
              ? formatProgressiveTrailSteps(value)
              : value ?? ""
        }
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event) =>
          onPatch(
            field.path,
            field.format === "chaseSteps"
              ? parseChaseSteps(event.target.value, value || [])
              : field.format === "progressiveTrailSteps"
                ? parseProgressiveTrailSteps(event.target.value, value || [])
                : event.target.value,
          )
        }
        style={inputStyle}
      />
    );
  }
  if (field.type === "segmented") {
    return (
      <span
        data-testid={testId}
        style={{
          display: "inline-flex",
          width: "100%",
          minWidth: 0,
        }}
      >
        <SegmentedControl
          options={field.options || []}
          value={value}
          onChange={(next) =>
            onPatch(field.path, field.coerce ? field.coerce(next) : next)
          }
          ariaLabel={ariaLabel}
          radioGroup
          buttonTestId={(option) =>
            `${testId}-${typeof option === "string" ? option : option.value}`
          }
        />
      </span>
    );
  }
  return (
    <input
      id={id}
      className={numeric ? "tnum" : undefined}
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      value={value ?? ""}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(event) =>
        onPatch(
          field.path,
          numberFrom(event.target.value, value ?? field.min ?? 0),
        )
      }
      style={inputStyle}
    />
  );
};

const invalidNumericValue = (field, value) => {
  if (!numericField(field)) return false;
  const numericValue = Number(value);
  return (
    !Number.isFinite(numericValue) ||
    (field.min != null && numericValue < field.min) ||
    (field.max != null && numericValue > field.max)
  );
};

const finiteSettingNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clampNumber = (value, min, max) =>
  Math.min(max, Math.max(min, value));

const formatDteWindowLabel = ({ minValue, targetValue, maxValue }) => {
  const min = Math.max(0, Math.round(finiteSettingNumber(minValue)));
  const max = Math.max(min, Math.round(finiteSettingNumber(maxValue, min)));
  const target = clampNumber(
    Math.round(finiteSettingNumber(targetValue, min)),
    min,
    max,
  );
  return `${min}-${max}d / target ${target}d`;
};

export const CompactSettingCell = ({
  item,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => {
  const id = useId().replace(/:/g, "");
  const field = item;
  const draftRoot = getDraftRoot({ field, profileDraft, strategySettingsDraft });
  const baselineRoot = getBaselineRoot({ field, profileBaseline, strategyBaseline });
  const value = getPathValue(draftRoot, field.path);
  const previousValue = getPathValue(baselineRoot, field.path);
  const dirty = dirtyFieldKeys.has(fieldKey(field));
  const invalid = invalidNumericValue(field, value);
  const onPatch = getPatchHandler({
    field,
    patchProfileDraftPath,
    patchStrategySettingsPath,
  });
  const unitLabel = compactUnitLabel(field);
  const impactBadge = compactImpactSummary(field, field.impact ? impact[field.impact] : null);
  const className = field.compactWide || field.fullWidth ? "algo-cell--wide" : undefined;

  return (
    <label
      htmlFor={field.type === "boolean" ? undefined : id}
      className={className}
      title={[
        field.label,
        formatSettingValue(field, value),
        dirty ? `was ${formatSettingValue(field, previousValue)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
        minHeight: dim(42),
        minWidth: 0,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? "none" : undefined,
      }}
      data-testid={`algo-compact-control-${field.path}`}
    >
      <CompactLabel
        label={field.compactLabel || field.label}
        dirty={dirty}
        previousValue={previousValue}
        field={field}
        impact={impactBadge}
      />
      {field.type === "boolean" ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            minWidth: 0,
            height: dim(24),
          }}
        >
          <CompactSwitch
            checked={Boolean(value)}
            disabled={disabled}
            ariaLabel={field.label}
            testId={`algo-compact-toggle-${field.path}`}
            onChange={(nextValue) => onPatch(field.path, nextValue)}
          />
        </span>
      ) : (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(2),
            minWidth: 0,
          }}
        >
          <CompactFieldInput
            id={id}
            field={field}
            value={value}
            invalid={invalid}
            disabled={disabled}
            ariaLabel={field.label}
            testId={`algo-compact-input-${field.path}`}
            onPatch={onPatch}
          />
          {unitLabel ? (
            <span
              aria-hidden="true"
              style={{
                color: invalid ? CSS_COLOR.red : CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("micro"),
                lineHeight: 1,
                flex: "0 0 auto",
              }}
            >
              {unitLabel}
            </span>
          ) : null}
        </span>
      )}
      {invalid ? (
        <span
          style={{
            color: CSS_COLOR.red,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
          }}
        >
          {field.min}-{field.max}
        </span>
      ) : null}
    </label>
  );
};

const ContractDteCell = ({
  minField,
  zeroDteField,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
}) => {
  const id = useId().replace(/:/g, "");
  const minValue = getPathValue(profileDraft, minField.path);
  const zeroDteValue = getPathValue(profileDraft, zeroDteField.path);
  const minPrevious = getPathValue(profileBaseline, minField.path);
  const zeroDtePrevious = getPathValue(profileBaseline, zeroDteField.path);
  const dirty =
    dirtyFieldKeys.has(fieldKey(minField)) ||
    dirtyFieldKeys.has(fieldKey(zeroDteField));
  const invalid = invalidNumericValue(minField, minValue);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
        minHeight: dim(42),
        minWidth: 0,
      }}
      data-testid="algo-contract-min-dte"
      title={[
        minField.label,
        formatSettingValue(minField, minValue),
        zeroDteField.label,
        formatSettingValue(zeroDteField, zeroDteValue),
        dirty
          ? `was ${formatSettingValue(minField, minPrevious)} / ${formatSettingValue(zeroDteField, zeroDtePrevious)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <CompactLabel
        label="Min DTE"
        dirty={dirty}
        previousValue={`${formatSettingValue(minField, minPrevious)} / ${formatSettingValue(zeroDteField, zeroDtePrevious)}`}
        field={minField}
        impact={null}
      />
      <span
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: sp(3),
          minWidth: 0,
        }}
      >
        <CompactFieldInput
          id={id}
          field={minField}
          value={minValue}
          invalid={invalid}
          disabled={disabled}
          ariaLabel={minField.label}
          testId="algo-contract-min-dte-input"
          onPatch={patchProfileDraftPath}
        />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(2),
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
          }}
        >
          0DTE
          <CompactSwitch
            checked={Boolean(zeroDteValue)}
            disabled={disabled}
            ariaLabel={zeroDteField.label}
            testId="algo-contract-allow-0dte"
            onChange={(nextValue) => patchProfileDraftPath(zeroDteField.path, nextValue)}
          />
        </span>
      </span>
    </div>
  );
};

const moveStrikeSlot = (current, direction) => {
  const slots = STRIKE_SLOT_VALUES_DESC;
  const currentIndex = Math.max(0, slots.indexOf(Number(current)));
  const nextIndex = Math.min(
    slots.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return slots[nextIndex];
};

const DteWindowRail = ({
  minValue,
  targetValue,
  maxValue,
  zeroDteValue,
  dirty,
  targetDirty,
}) => {
  const rawMin = Math.max(0, finiteSettingNumber(minValue));
  const rawMax = Math.max(rawMin, finiteSettingNumber(maxValue, rawMin));
  const rawTarget = clampNumber(
    finiteSettingNumber(targetValue, rawMin),
    rawMin,
    rawMax,
  );
  const domainMax = Math.max(1, Math.ceil(Math.max(90, rawMin, rawTarget, rawMax)));
  const leftPct = clampNumber((rawMin / domainMax) * 100, 0, 100);
  const rightPct = clampNumber((rawMax / domainMax) * 100, 0, 100);
  const targetPct = clampNumber((rawTarget / domainMax) * 100, 0, 100);

  return (
    <div
      data-testid="algo-contract-dte-rail"
      title={`DTE ${formatDteWindowLabel({ minValue, targetValue, maxValue })}`}
      style={{
        display: "grid",
        gap: sp(4),
        minWidth: 0,
        padding: sp("6px 7px 7px"),
        border: `1px solid ${dirty ? cssColorMix(CSS_COLOR.accent, 34) : CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.xs),
        background: dirty ? cssColorMix(CSS_COLOR.accent, 5) : CSS_COLOR.bg1,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          alignItems: "center",
          gap: sp(5),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
            fontWeight: FONT_WEIGHTS.label,
            textTransform: "uppercase",
          }}
        >
          DTE
        </span>
        <span
          className="tnum"
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.data,
            fontSize: textSize("caption"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {formatDteWindowLabel({ minValue, targetValue, maxValue })}
        </span>
        <span
          style={{
            color: zeroDteValue ? CSS_COLOR.cyan : CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
            fontWeight: FONT_WEIGHTS.label,
            textTransform: "uppercase",
          }}
        >
          0DTE {zeroDteValue ? "ON" : "OFF"}
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          height: dim(18),
          minWidth: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: dim(8),
            height: dim(3),
            borderRadius: dim(RADII.pill),
            background: CSS_COLOR.borderLight,
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `${leftPct}%`,
            width: `${Math.max(1, rightPct - leftPct)}%`,
            top: dim(7),
            height: dim(5),
            borderRadius: dim(RADII.pill),
            background: cssColorMix(CSS_COLOR.cyan, dirty ? 60 : 42),
            boxShadow: dirty ? `0 0 0 1px ${cssColorMix(CSS_COLOR.accent, 32)}` : "none",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `${targetPct}%`,
            top: dim(2),
            width: dim(3),
            height: dim(14),
            borderRadius: dim(RADII.pill),
            background: targetDirty ? CSS_COLOR.accent : CSS_COLOR.text,
            transform: "translateX(-50%)",
            boxShadow: `0 0 0 2px ${CSS_COLOR.bg1}`,
          }}
        />
      </div>
    </div>
  );
};

const strikeSlotMeta = (slot) =>
  STRIKE_SLOT_META[Number(slot)] || {
    strikeLabel: String(slot),
    callLabel: String(slot),
    putLabel: String(slot),
  };

const ChainStrikeButton = ({
  side,
  slot,
  label,
  selected,
  disabled,
  tone,
  onSelect,
  onMove,
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    aria-label={`${side} strike slot ${slot}; ${label}`}
    data-testid={`algo-strike-ladder-${side.toLowerCase()}-${slot}`}
    title={`${side} ${label}`}
    className={selected ? "ra-interactive ra-focus-rail" : "ra-interactive"}
    disabled={disabled}
    onClick={() => onSelect(slot)}
    onKeyDown={(event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        onMove(-1);
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        onMove(1);
      }
    }}
    style={{
      width: "100%",
      height: dim(27),
      border: `1px solid ${selected ? tone : CSS_COLOR.borderLight}`,
      borderRadius: dim(RADII.xs),
      background: selected ? cssColorMix(tone, 18) : CSS_COLOR.bg1,
      color: selected ? tone : CSS_COLOR.textMuted,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      outlineOffset: dim(1),
      boxShadow: selected ? `inset 0 -2px 0 ${tone}` : "none",
      fontFamily: T.sans,
      fontSize: textSize("micro"),
      fontWeight: FONT_WEIGHTS.label,
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}
  >
    <span aria-hidden="true">{label}</span>
  </button>
);

export const ContractSelectionCell = ({
  item,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
}) => {
  const fieldByPath = Object.fromEntries(
    item.fields.map((field) => [field.path, field]),
  );
  const minField = fieldByPath["optionSelection.minDte"];
  const targetField = fieldByPath["optionSelection.targetDte"];
  const maxField = fieldByPath["optionSelection.maxDte"];
  const zeroDteField = fieldByPath["optionSelection.allowZeroDte"];
  const callField = fieldByPath["optionSelection.callStrikeSlot"];
  const putField = fieldByPath["optionSelection.putStrikeSlot"];
  const minValue = getPathValue(profileDraft, minField.path);
  const targetValue = getPathValue(profileDraft, targetField.path);
  const maxValue = getPathValue(profileDraft, maxField.path);
  const zeroDteValue = Boolean(getPathValue(profileDraft, zeroDteField.path));
  const callValue = Number(getPathValue(profileDraft, callField.path));
  const putValue = Number(getPathValue(profileDraft, putField.path));
  const minDirty = dirtyFieldKeys.has(fieldKey(minField));
  const targetDirty = dirtyFieldKeys.has(fieldKey(targetField));
  const maxDirty = dirtyFieldKeys.has(fieldKey(maxField));
  const zeroDteDirty = dirtyFieldKeys.has(fieldKey(zeroDteField));
  const callOption = strikeSlotMeta(callValue);
  const putOption = strikeSlotMeta(putValue);
  const contractSummary = [
    `DTE ${formatDteWindowLabel({ minValue, targetValue, maxValue })}`,
    `Call ${callOption.callLabel}`,
    `Put ${putOption.putLabel}`,
  ].join(" · ");

  const patchStrike = (field, slot) => {
    patchProfileDraftPath(field.path, Number(slot));
  };
  const chainRows = STRIKE_SLOT_ROWS.reduce((rows, option) => {
    const slot = Number(option.value);
    if (slot === 2) {
      rows.push({ id: "atm-divider", type: "divider", row: rows.length + 2 });
    }
    rows.push({
      id: `slot-${slot}`,
      type: "slot",
      option,
      slot,
      row: rows.length + 2,
      meta: strikeSlotMeta(slot),
    });
    return rows;
  }, []);
  const chainSlotRows = chainRows.filter((row) => row.type === "slot");
  const renderStrikeHeader = ({ label, column, field }) => {
    const dirty = field ? dirtyFieldKeys.has(fieldKey(field)) : false;
    return (
      <span
        key={label}
        style={{
          gridColumn: column,
          gridRow: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(2),
          color:
            label === "CALLS"
              ? CSS_COLOR.green
              : label === "PUTS"
                ? CSS_COLOR.red
                : CSS_COLOR.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("micro"),
          fontWeight: FONT_WEIGHTS.label,
          textTransform: "uppercase",
          minWidth: 0,
        }}
      >
        <span>{label}</span>
        {dirty ? (
          <span
            aria-label={`${label} strike slot unsaved`}
            role="status"
            style={{
              width: dim(5),
              height: dim(5),
              borderRadius: dim(RADII.pill),
              background: CSS_COLOR.accent,
              flex: "0 0 auto",
            }}
          />
        ) : null}
      </span>
    );
  };

  const renderChainButton = ({ row, side }) => {
    const isCall = side === "CALL";
    const value = isCall ? callValue : putValue;
    const field = isCall ? callField : putField;
    return (
      <span
        key={`${side.toLowerCase()}-${row.slot}`}
        style={{
          gridColumn: isCall ? 1 : 3,
          gridRow: row.row,
          minHeight: dim(27),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ChainStrikeButton
          side={side}
          slot={row.slot}
          label={isCall ? row.meta.callLabel : row.meta.putLabel}
          selected={value === row.slot}
          disabled={disabled}
          tone={isCall ? CSS_COLOR.green : CSS_COLOR.red}
          onSelect={(nextSlot) => patchStrike(field, nextSlot)}
          onMove={(direction) =>
            patchStrike(field, moveStrikeSlot(value, direction))
          }
        />
      </span>
    );
  };

  return (
    <div
      className="algo-cell--full"
      data-testid="algo-strike-ladder"
      style={{
        display: "grid",
        gap: sp(5),
        minWidth: 0,
      }}
    >
      <div className="algo-settings-grid">
        <ContractDteCell
          minField={minField}
          zeroDteField={zeroDteField}
          profileDraft={profileDraft}
          profileBaseline={profileBaseline}
          patchProfileDraftPath={patchProfileDraftPath}
          disabled={disabled}
          dirtyFieldKeys={dirtyFieldKeys}
        />
        {[targetField, maxField].map((field) => (
          <CompactSettingCell
            key={field.path}
            item={field}
            profileDraft={profileDraft}
            profileBaseline={profileBaseline}
            strategySettingsDraft={null}
            strategyBaseline={null}
            patchProfileDraftPath={patchProfileDraftPath}
            patchStrategySettingsPath={() => {}}
            disabled={disabled}
            dirtyFieldKeys={dirtyFieldKeys}
            impact={{}}
          />
        ))}
      </div>
      <DteWindowRail
        minValue={minValue}
        targetValue={targetValue}
        maxValue={maxValue}
        zeroDteValue={zeroDteValue}
        dirty={minDirty || maxDirty || zeroDteDirty}
        targetDirty={targetDirty}
      />
      <div
        data-testid="algo-contract-selection-summary"
        title={contractSummary}
        className="tnum"
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.data,
          fontSize: textSize("micro"),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {contractSummary}
      </div>
      <div
        data-testid="algo-mini-chain"
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(${dim(68)}px, 1fr) ${dim(48)}px minmax(${dim(68)}px, 1fr)`,
          alignItems: "center",
          columnGap: sp(3),
          rowGap: sp(2),
          minWidth: 0,
        }}
      >
        {renderStrikeHeader({ label: "CALLS", column: 1, field: callField })}
        {renderStrikeHeader({ label: "STRIKE", column: 2 })}
        {renderStrikeHeader({ label: "PUTS", column: 3, field: putField })}
        {chainRows.map((row) =>
          row.type === "divider" ? (
            <div
              key={row.id}
              style={{
                gridColumn: "1 / -1",
                gridRow: row.row,
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: sp(3),
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("micro"),
                margin: sp("1px 0"),
              }}
            >
              <span style={{ borderTop: `1px solid ${CSS_COLOR.borderLight}` }} />
              <span>ATM</span>
              <span style={{ borderTop: `1px solid ${CSS_COLOR.borderLight}` }} />
            </div>
          ) : (
            <span
              key={`strike-${row.slot}`}
              style={{
                gridColumn: 2,
                gridRow: row.row,
                height: dim(27),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 0,
                color: CSS_COLOR.textSec,
                fontFamily: T.data,
                fontSize: textSize("caption"),
                borderRadius: dim(RADII.xs),
                border: `1px solid ${CSS_COLOR.borderLight}`,
                background:
                  row.slot === 2 || row.slot === 3
                    ? cssColorMix(CSS_COLOR.text, 5)
                    : CSS_COLOR.bg1,
              }}
            >
              {row.meta.strikeLabel}
            </span>
          ),
        )}
        <span
          role="radiogroup"
          aria-label="Call strike slot"
          style={{ display: "contents" }}
        >
          {chainSlotRows.map((row) => renderChainButton({ row, side: "CALL" }))}
        </span>
        <span
          role="radiogroup"
          aria-label="Put strike slot"
          style={{ display: "contents" }}
        >
          {chainSlotRows.map((row) => renderChainButton({ row, side: "PUT" }))}
        </span>
      </div>
    </div>
  );
};

const formatPctLabel = (value) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}%` : "-";

const markerPositionValue = (marker, value) =>
  marker.positionValue ? marker.positionValue(value) : Number(value);

export const ExitLadderTrack = ({
  item,
  profileDraft,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
}) => {
  const [editingKey, setEditingKey] = useState(null);
  const [draftValue, setDraftValue] = useState("");
  const fieldByPath = Object.fromEntries(
    item.fields.map((field) => [field.path, field]),
  );
  const markers = EXIT_TRACK_MARKERS.map((marker) => {
    const field = fieldByPath[marker.fieldPath];
    const rawValue = getPathValue(profileDraft, field.path);
    const positionValue = markerPositionValue(marker, rawValue);
    return {
      ...marker,
      field,
      rawValue,
      positionValue,
      dirty: dirtyFieldKeys.has(fieldKey(field)),
    };
  });
  const lossMin = Math.min(
    ...markers
      .filter((marker) => marker.side === "loss")
      .map((marker) => marker.positionValue),
    0,
  );
  const gainMax = Math.max(
    ...markers
      .filter((marker) => marker.side === "gain")
      .map((marker) => marker.positionValue),
    0,
  );
  const domainMin = Math.floor(lossMin);
  const domainMax = Math.ceil(gainMax);
  const domainSpan = Math.max(1, domainMax - domainMin);
  const positionedMarkers = markers
    .map((marker) => ({
      ...marker,
      leftPct: ((marker.positionValue - domainMin) / domainSpan) * 100,
    }))
    .sort((left, right) => left.leftPct - right.leftPct)
    .map((marker, index, sorted) => {
      const previous = sorted[index - 1];
      const collision = previous && Math.abs(marker.leftPct - previous.leftPct) < 8;
      return { ...marker, stagger: collision ? 1 : 0 };
    });
  const entryPct = ((0 - domainMin) / domainSpan) * 100;
  const editingMarker = positionedMarkers.find((marker) => marker.key === editingKey);
  const trackInset = dim(24);
  const trackLeft = (leftPct) =>
    `calc(${leftPct}% + ${
      trackInset - (trackInset * 2 * leftPct) / 100
    }px)`;
  const popoverAnchor = editingMarker
    ? editingMarker.leftPct < 12
      ? { left: trackInset, transform: "none" }
      : editingMarker.leftPct > 88
        ? { right: trackInset, transform: "none" }
        : {
            left: trackLeft(editingMarker.leftPct),
            transform: "translateX(-50%)",
          }
    : null;

  const openEditor = (marker) => {
    if (disabled) return;
    setEditingKey(marker.key);
    setDraftValue(String(marker.rawValue ?? ""));
  };
  const closeEditor = () => {
    setEditingKey(null);
    setDraftValue("");
  };
  const commitEditor = () => {
    if (!editingMarker) return;
    patchProfileDraftPath(
      editingMarker.field.path,
      numberFrom(draftValue, editingMarker.rawValue ?? editingMarker.field.min ?? 0),
    );
    closeEditor();
  };

  return (
    <div
      className="algo-cell--full"
      data-testid="algo-exit-track"
      style={{
        minWidth: 0,
        padding: sp("10px 0 4px"),
      }}
    >
      <div
        style={{
          position: "relative",
          minHeight: dim(92),
          minWidth: 0,
          padding: sp("28px 6px 20px"),
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: trackInset,
            right: trackInset,
            top: dim(48),
            height: dim(2),
            background: CSS_COLOR.border,
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: trackLeft(entryPct),
            top: dim(42),
            width: dim(2),
            height: dim(14),
            background: CSS_COLOR.textDim,
            transform: "translateX(-50%)",
          }}
        />
        <span
          className="tnum"
          style={{
            position: "absolute",
            left: trackLeft(entryPct),
            top: dim(60),
            transform: "translateX(-50%)",
            color: CSS_COLOR.textMuted,
            fontFamily: T.data,
            fontSize: textSize("micro"),
          }}
        >
          0%
        </span>
        {positionedMarkers.map((marker) => (
          <button
            key={marker.key}
            type="button"
            data-testid={`algo-exit-track-marker-${marker.key}`}
            disabled={disabled}
            onClick={() => openEditor(marker)}
            style={{
              position: "absolute",
              left: trackLeft(marker.leftPct),
              top: dim(43),
              width: dim(10),
              height: dim(10),
              borderRadius: dim(RADII.pill),
              border: `1px solid ${marker.dirty ? CSS_COLOR.accent : CSS_COLOR.bg2}`,
              background: marker.tone,
              boxShadow: marker.dirty
                ? `0 0 0 2px ${cssColorMix(CSS_COLOR.accent, 24)}`
                : `0 0 0 2px ${cssColorMix(marker.tone, 16)}`,
              transform: "translate(-50%, -50%)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
              padding: 0,
            }}
            aria-label={`${marker.label} ${formatPctLabel(marker.rawValue)}`}
          >
            <span
              style={{
                position: "absolute",
                left: "50%",
                bottom: `${dim(marker.stagger ? 18 : 14)}px`,
                transform: "translateX(-50%)",
                color: marker.tone,
                fontFamily: T.sans,
                fontSize: textSize("micro"),
                fontWeight: FONT_WEIGHTS.label,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {marker.label}
            </span>
            <span
              className="tnum"
              style={{
                position: "absolute",
                left: "50%",
                top: dim(13),
                transform: "translateX(-50%)",
                color: CSS_COLOR.textMuted,
                fontFamily: T.data,
                fontSize: textSize("micro"),
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {formatPctLabel(marker.positionValue)}
            </span>
          </button>
        ))}
        {editingMarker ? (
          <div
            role="dialog"
            aria-label={`${editingMarker.label} level`}
            style={{
              position: "absolute",
              ...popoverAnchor,
              top: dim(64),
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: sp(2),
              minWidth: dim(92),
              padding: sp(3),
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              background: CSS_COLOR.bg2,
              boxShadow: `0 12px 28px ${cssColorMix(CSS_COLOR.bg0, 70)}`,
            }}
          >
            <input
              className="tnum"
              data-testid={`algo-exit-track-input-${editingMarker.key}`}
              type="number"
              autoFocus
              min={editingMarker.field.min}
              max={editingMarker.field.max}
              step={editingMarker.field.step}
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onBlur={commitEditor}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeEditor();
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitEditor();
                }
              }}
              style={compactInputStyle({
                invalid: false,
                disabled,
                numeric: true,
              })}
            />
            <span
              aria-hidden="true"
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("micro"),
              }}
            >
              %
            </span>
          </div>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto auto",
          justifyContent: "space-between",
          color: CSS_COLOR.textMuted,
          fontFamily: T.data,
          fontSize: textSize("micro"),
          padding: sp("0 4px"),
        }}
      >
        <span className="tnum">{formatPctLabel(domainMin)}</span>
        <span className="tnum">0%</span>
        <span className="tnum">{formatPctLabel(domainMax)}</span>
      </div>
    </div>
  );
};

const ExpandedLimitsSection = ({
  disabled,
  handleApplyExpandedCapacity,
  updateProfileMutation,
}) => (
  <section style={{ minWidth: 0 }}>
    <SettingsSectionHeader label="Expanded Limits" />
    <div
      data-testid="algo-profile-capacity-banner"
      style={{
        border: `1px solid ${cssColorMix(CSS_COLOR.amber, 21)}`,
        borderRadius: dim(RADII.sm),
        background: cssColorMix(CSS_COLOR.amber, 5),
        padding: sp("8px 10px"),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      <span
        className="tnum"
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.data,
          fontSize: textSize("body"),
        }}
      >
        {SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxOpenSymbols} symbols ·{" "}
        {formatMoney(SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxDailyLoss)} halt
      </span>
      <button
        type="button"
        data-testid="signal-options-expanded-capacity"
        onClick={handleApplyExpandedCapacity}
        disabled={disabled || updateProfileMutation?.isPending}
        style={{
          ...compactButtonStyle({
            disabled: disabled || updateProfileMutation?.isPending,
          }),
          border: `1px solid ${CSS_COLOR.amber}`,
          background: CSS_COLOR.amber,
          color: CSS_COLOR.onAccent,
        }}
      >
        APPLY
      </button>
    </div>
  </section>
);

const renderSectionItem = ({
  item,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => {
  if (item.kind === "contractSelect") {
    return (
      <ContractSelectionCell
        key={item.id}
        item={item}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
      />
    );
  }
  if (item.kind === "exitTrack") {
    return (
      <ExitLadderTrack
        key={item.id}
        item={item}
        profileDraft={profileDraft}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
      />
    );
  }
  return (
    <CompactSettingCell
      key={`${item.slice}.${item.path}`}
      item={item}
      profileDraft={profileDraft}
      profileBaseline={profileBaseline}
      strategySettingsDraft={strategySettingsDraft}
      strategyBaseline={strategyBaseline}
      patchProfileDraftPath={patchProfileDraftPath}
      patchStrategySettingsPath={patchStrategySettingsPath}
      disabled={disabled}
      dirtyFieldKeys={dirtyFieldKeys}
      impact={impact}
    />
  );
};

const sectionDirtyCount = (section, dirtyFieldKeys) =>
  section.fields.reduce((count, item) => {
    if (item.kind === "contractSelect" || item.kind === "exitTrack") {
      return (
        count +
        item.fields.reduce(
          (total, field) => total + (dirtyFieldKeys.has(fieldKey(field)) ? 1 : 0),
          0,
        )
      );
    }
    return count + (dirtyFieldKeys.has(fieldKey(item)) ? 1 : 0);
  }, 0);

export const AlgoSettingsRegion = ({
  cockpit,
  signalOptionsPositions,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  dirtyFields,
  focusedDeployment,
  handleApplyExpandedCapacity,
  updateProfileMutation,
  updateStrategySettingsMutation,
}) => {
  const impact = useMemo(
    () =>
      buildAlgoTuningImpact({
        cockpit,
        profile: profileDraft,
        positions: signalOptionsPositions,
      }),
    [cockpit, profileDraft, signalOptionsPositions],
  );
  const dirtyFieldKeys = new Set(dirtyFields.map(fieldKey));
  const dirtyCounts = countDirtyFieldsBySection(dirtyFields);
  const disabled =
    !focusedDeployment ||
    updateProfileMutation?.isPending ||
    updateStrategySettingsMutation?.isPending;

  return (
    <div
      data-testid="algo-settings-region"
      style={{
        padding: sp("2px 12px 12px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(5),
        minWidth: 0,
      }}
    >
      {SETTINGS_SECTIONS.map((section, index) => {
        const dirtyCount =
          dirtyCounts[section.label] || sectionDirtyCount(section, dirtyFieldKeys);
        return (
          <section
            key={section.id}
            data-testid={`algo-settings-section-${section.id}`}
            style={{
              borderTop: index === 0 ? "none" : `1px solid ${CSS_COLOR.borderLight}`,
              paddingTop: index === 0 ? 0 : sp(4),
              minWidth: 0,
            }}
          >
            <SettingsSectionHeader
              label={section.label}
              helper={dirtyCount ? `${dirtyCount} unsaved` : null}
            />
            <div className="algo-settings-grid">
              {section.fields.map((item) =>
                renderSectionItem({
                  item,
                  profileDraft,
                  profileBaseline,
                  strategySettingsDraft,
                  strategyBaseline,
                  patchProfileDraftPath,
                  patchStrategySettingsPath,
                  disabled,
                  dirtyFieldKeys,
                  impact,
                }),
              )}
            </div>
          </section>
        );
      })}

      <ExpandedLimitsSection
        disabled={!focusedDeployment}
        handleApplyExpandedCapacity={handleApplyExpandedCapacity}
        updateProfileMutation={updateProfileMutation}
      />
    </div>
  );
};

export default AlgoSettingsRegion;
