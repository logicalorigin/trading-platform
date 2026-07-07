import {
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { buildAlgoTuningImpact } from "../../features/platform/algoTuningImpactModel";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { toneForDirectionalIntent } from "../../features/platform/semanticToneModel.js";
import { Select, SegmentedControl } from "../../components/platform/primitives.jsx";
import {
  SIGNAL_OPTIONS_EXPANDED_CAPACITY,
  MAX_SIGNAL_OPTIONS_STRIKE_SLOTS,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  compactButtonStyle,
  formatChaseSteps,
  formatMoney,
  formatProgressiveTrailSteps,
  formatWireTrailRungs,
  buildSignalOptionsReadOnlyGateBadges,
  normalizeSignalOptionsStrikeSlots,
  numberFrom,
  parseChaseSteps,
  parseProgressiveTrailSteps,
  parseWireTrailRungs,
} from "./algoHelpers";
import {
  SETTINGS_SECTIONS,
  countDirtyFieldsBySection,
  formatSettingValue,
  getSettingFieldByPath,
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
    key: "trail-giveback",
    fieldPath: "exitPolicy.trailGivebackPct",
    label: "Trail",
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
  if (field.unit === "matches") return "of 6";
  return field.unit;
};

// Width a numeric input needs for the value it's actually showing, so a field
// whose cap is 1,000,000 doesn't reserve 7ch to display "2500". We size to the
// rendered value (floored for breathing room) but never wider than the widest
// legal value, so the box still grows for genuinely large entries. Chars feed a
// `ch` unit (pairs with the tabular T.data font); padding adds 14px (12px pad +
// 2px border).
const numericInputWidth = (field, value) => {
  const maxSource = Number(field?.max);
  const maxDigits = Number.isFinite(maxSource)
    ? String(Math.trunc(Math.abs(maxSource))).length
    : 4;
  const negative = field?.min != null && Number(field.min) < 0 ? 1 : 0;
  const stepText = field?.step != null ? String(field.step) : "";
  const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  const maxChars = Math.max(2, maxDigits) + negative + (decimals ? decimals + 1 : 0);
  const shownChars = value == null || value === "" ? 0 : String(value).length;
  const chars = Math.min(maxChars, Math.max(3, shownChars));
  return `calc(${chars}ch + 14px)`;
};

const compactInputStyle = ({ invalid, disabled, numeric = false, field, value }) => ({
  height: dim(22),
  width: numeric ? numericInputWidth(field, value) : "100%",
  minWidth: 0,
  maxWidth: "100%",
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
  textAlign: "left",
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

const clampMtfRequiredCount = (_value, timeframes) =>
  Math.max(1, Array.isArray(timeframes) ? timeframes.length : 0);

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
      transition: "border-color var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease",
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
        transition: "transform var(--ra-motion-fast) ease",
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
      <AppTooltip content={`was: ${formatSettingValue(field, previousValue)}`}>
        <span
          role="status"
          aria-label={`${label} unsaved`}
          style={{
            width: dim(5),
            height: dim(5),
            borderRadius: dim(RADII.pill),
            background: CSS_COLOR.accent,
            flex: "0 0 auto",
            opacity: 1,
            transition: "opacity var(--ra-motion-fast) ease",
          }}
        />
      </AppTooltip>
    ) : null}
    {impact ? (
      <AppTooltip content={impact.title}>
        <span
          style={{
            color: impact.color,
            background: impact.background,
            borderRadius: dim(RADII.xs),
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            lineHeight: 1,
            marginLeft: "auto",
            padding: sp("0 4px"),
            flex: "0 0 auto",
          }}
        >
          {impact.label}
        </span>
      </AppTooltip>
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
  draftRoot,
}) => {
  const numeric = numericField(field);
  const inputStyle = compactInputStyle({ invalid, disabled, numeric, field, value });
  const patchFieldValue = (nextValue) => {
    const coerced = field.coerce ? field.coerce(nextValue) : nextValue;
    if (typeof field.patchFromValue === "function") {
      Object.entries(field.patchFromValue(coerced) || {}).forEach(
        ([path, value]) => onPatch(path, value),
      );
      return;
    }
    onPatch(field.path, coerced);
  };
  if (field.type === "select") {
    return (
      <Select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        ariaLabel={ariaLabel}
        selectProps={{ "data-testid": testId }}
        onChange={(next) => patchFieldValue(next)}
        options={(field.options || []).map((option) =>
          typeof option === "string"
            ? { value: option, label: option }
            : { value: option.value, label: option.label },
        )}
      />
    );
  }
  if (field.type === "timeframeChips") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    const toggleTimeframe = (timeframe) => {
      const next = selected.includes(timeframe)
        ? selected.filter((item) => item !== timeframe)
        : [...selected, timeframe];
      const nextTimeframes = next.length ? next : [timeframe];
      onPatch(field.path, nextTimeframes);
      if (field.relatedPresetPath) {
        onPatch(field.relatedPresetPath, "custom");
      }
      if (field.requiredCountPath) {
        onPatch(
          field.requiredCountPath,
          clampMtfRequiredCount(
            getPathValue(draftRoot, field.requiredCountPath),
            nextTimeframes,
          ),
        );
      }
    };
    return (
      <span
        data-testid={testId}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: sp(2),
          width: "100%",
          minWidth: 0,
        }}
      >
        {(field.options || []).map((timeframe) => {
          const selectedFrame = selected.includes(timeframe);
          return (
            <button
              key={timeframe}
              type="button"
              disabled={disabled}
              aria-pressed={selectedFrame}
              aria-label={`${selectedFrame ? "Remove" : "Add"} ${timeframe} MTF frame`}
              onClick={() => toggleTimeframe(timeframe)}
              style={{
                height: dim(22),
                minWidth: dim(30),
                border: `1px solid ${selectedFrame ? CSS_COLOR.accent : CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                background: selectedFrame
                  ? cssColorMix(CSS_COLOR.accent, 16)
                  : CSS_COLOR.bg1,
                color: selectedFrame ? CSS_COLOR.text : CSS_COLOR.textSec,
                fontFamily: T.data,
                fontSize: textSize("caption"),
                cursor: disabled ? "not-allowed" : "pointer",
                padding: sp("0 5px"),
              }}
            >
              {timeframe}
            </button>
          );
        })}
      </span>
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
              : field.format === "wireTrailRungs"
                ? formatWireTrailRungs(value)
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
                : field.format === "wireTrailRungs"
                  ? parseWireTrailRungs(event.target.value, value || [])
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
          onChange={patchFieldValue}
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
  // An untouched/empty field is "not set", not out-of-range — don't flag it red.
  if (value == null || value === "") return false;
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

  if (field.type === "boolean") {
    // Booleans pair label + switch on a single row (no input/validation sub-rows),
    // halving cell height vs the stacked numeric cells below.
    return (
      <label
        className={className}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: sp(2),
          minHeight: dim(20),
          minWidth: 0,
          opacity: disabled ? 0.55 : 1,
          pointerEvents: disabled ? "none" : undefined,
        }}
        data-testid={`algo-compact-control-${field.path}`}
      >
        <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex" }}>
          <CompactLabel
            label={field.compactLabel || field.label}
            dirty={dirty}
            previousValue={previousValue}
            field={field}
            impact={impactBadge}
          />
        </span>
        <CompactSwitch
          checked={Boolean(value)}
          disabled={disabled}
          ariaLabel={field.label}
          testId={`algo-compact-toggle-${field.path}`}
          onChange={(nextValue) => onPatch(field.path, nextValue)}
        />
      </label>
    );
  }

  return (
    <label
      htmlFor={id}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(1),
        minHeight: dim(34),
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
      {(
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
            draftRoot={draftRoot}
          />
          {unitLabel ? (
            <span
              aria-hidden="true"
              style={{
                color: invalid ? CSS_COLOR.red : CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
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
            fontSize: textSize("caption"),
          }}
        >
          {field.min}-{field.max}
        </span>
      ) : null}
      {!invalid && field.path === "riskCaps.tradingAllowance"
        ? (() => {
            const maxPremium = Number(
              getPathValue(draftRoot, "riskCaps.maxPremiumPerEntry") ?? 0,
            );
            const allowance = Number(value ?? 0);
            if (maxPremium > 0 && allowance > 0 && allowance < maxPremium) {
              return (
                <span
                  style={{
                    color: CSS_COLOR.amber,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                  }}
                >
                  Below max premium/entry — most entries size down. Denominates
                  option premium, not account cash.
                </span>
              );
            }
            return null;
          })()
        : null}
    </label>
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

const normalizeDteValues = ({ minValue, targetValue, maxValue, next = {} }) => {
  const minSource = next.minValue ?? minValue;
  const targetSource = next.targetValue ?? targetValue;
  const maxSource = next.maxValue ?? maxValue;
  const min = clampNumber(Math.round(finiteSettingNumber(minSource)), 0, 730);
  const max = clampNumber(
    Math.round(finiteSettingNumber(maxSource, Math.max(min, 1))),
    min,
    730,
  );
  const target = clampNumber(
    Math.round(finiteSettingNumber(targetSource, min)),
    min,
    max,
  );
  return { min, target, max };
};

const dteTimelineDomain = ({ min, target, max, zeroDte }) => {
  const activeSpan = Math.max(2, max - min);
  const pad = Math.max(1, Math.ceil(activeSpan * 0.75));
  const domainMin = zeroDte || min <= 1 ? 0 : Math.max(0, min - pad);
  const domainMax = Math.min(730, Math.max(max + pad, target + pad, 6));
  return {
    domainMin,
    domainMax: Math.max(domainMin + 1, domainMax),
  };
};

const DteStepper = ({
  label,
  value,
  min,
  max,
  dirty,
  disabled,
  testId,
  onChange,
}) => {
  const id = useId().replace(/:/g, "");
  const patch = (nextValue) =>
    onChange(clampNumber(Math.round(finiteSettingNumber(nextValue, value)), min, max));
  return (
    <label
      htmlFor={id}
      data-testid={testId}
      style={{
        display: "grid",
        gap: sp(2),
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(2),
          color: CSS_COLOR.textSec,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.label,
        }}
      >
        {label}
        {dirty ? (
          <span
            aria-label={`${label} DTE unsaved`}
            role="status"
            style={{
              width: dim(5),
              height: dim(5),
              borderRadius: dim(RADII.pill),
              background: CSS_COLOR.accent,
            }}
          />
        ) : null}
      </span>
      <span
        style={{
          display: "grid",
          gridTemplateColumns: `${dim(30)}px minmax(0, 1fr) ${dim(30)}px`,
          minHeight: dim(34),
          border: `1px solid ${dirty ? cssColorMix(CSS_COLOR.accent, 32) : CSS_COLOR.borderLight}`,
          borderRadius: dim(RADII.xs),
          background: dirty ? cssColorMix(CSS_COLOR.accent, 5) : CSS_COLOR.bg1,
          overflow: "hidden",
        }}
      >
        {[-1, 1].map((delta) => (
          <button
            key={delta}
            type="button"
            disabled={disabled}
            aria-label={`${delta < 0 ? "Decrease" : "Increase"} ${label} DTE`}
            onClick={() => patch(value + delta)}
            style={{
              gridColumn: delta < 0 ? 1 : 3,
              gridRow: 1,
              border: 0,
              borderRight: delta < 0 ? `1px solid ${CSS_COLOR.borderLight}` : 0,
              borderLeft: delta > 0 ? `1px solid ${CSS_COLOR.borderLight}` : 0,
              background: "transparent",
              color: CSS_COLOR.textMuted,
              cursor: disabled ? "not-allowed" : "pointer",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            {delta < 0 ? "-" : "+"}
          </button>
        ))}
        <input
          id={id}
          className="tnum"
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={`${label} DTE`}
          onChange={(event) => patch(event.target.value)}
          style={{
            gridColumn: 2,
            gridRow: 1,
            width: "100%",
            border: 0,
            background: "transparent",
            color: CSS_COLOR.text,
            fontFamily: T.data,
            fontSize: textSize("body"),
            textAlign: "center",
            outline: "none",
          }}
        />
      </span>
    </label>
  );
};

const DteTimelineEditor = ({
  minField,
  targetField,
  maxField,
  zeroDteField,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
}) => {
  const minValue = getPathValue(profileDraft, minField.path);
  const targetValue = getPathValue(profileDraft, targetField.path);
  const maxValue = getPathValue(profileDraft, maxField.path);
  const zeroDteValue = Boolean(getPathValue(profileDraft, zeroDteField.path));
  const minPrevious = getPathValue(profileBaseline, minField.path);
  const targetPrevious = getPathValue(profileBaseline, targetField.path);
  const maxPrevious = getPathValue(profileBaseline, maxField.path);
  const zeroDtePrevious = getPathValue(profileBaseline, zeroDteField.path);
  const minDirty = dirtyFieldKeys.has(fieldKey(minField));
  const targetDirty = dirtyFieldKeys.has(fieldKey(targetField));
  const maxDirty = dirtyFieldKeys.has(fieldKey(maxField));
  const zeroDteDirty = dirtyFieldKeys.has(fieldKey(zeroDteField));
  const dirty = minDirty || targetDirty || maxDirty || zeroDteDirty;
  const trackRef = useRef(null);
  const [draggingHandle, setDraggingHandle] = useState(null);
  const dte = normalizeDteValues({ minValue, targetValue, maxValue });
  const { domainMin, domainMax } = dteTimelineDomain({
    ...dte,
    zeroDte: zeroDteValue,
  });
  const domainSpan = Math.max(1, domainMax - domainMin);
  const percentForValue = (value) =>
    clampNumber(((value - domainMin) / domainSpan) * 100, 0, 100);
  const valueFromClientX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return dte.target;
    const ratio = clampNumber((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(domainMin + ratio * domainSpan);
  };
  const patchDte = (next) => {
    const normalized = normalizeDteValues({
      minValue: dte.min,
      targetValue: dte.target,
      maxValue: dte.max,
      next,
    });
    patchProfileDraftPath(minField.path, normalized.min);
    patchProfileDraftPath(targetField.path, normalized.target);
    patchProfileDraftPath(maxField.path, normalized.max);
  };
  const patchHandle = (handle, nextValue) => {
    if (handle === "min") patchDte({ minValue: nextValue });
    if (handle === "target") patchDte({ targetValue: nextValue });
    if (handle === "max") patchDte({ maxValue: nextValue });
  };
  const handlePointerMove = (event) => {
    if (!draggingHandle || disabled) return;
    event.preventDefault();
    patchHandle(draggingHandle, valueFromClientX(event.clientX));
  };
  const handleKeyDown = (handle, event) => {
    const delta =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : 0;
    if (!delta) return;
    event.preventDefault();
    patchHandle(handle, dte[handle] + delta);
  };
  const markers = [
    { key: "min", label: "Min", value: dte.min, tone: CSS_COLOR.cyan, dirty: minDirty },
    { key: "target", label: "Target", value: dte.target, tone: CSS_COLOR.accent, dirty: targetDirty },
    { key: "max", label: "Max", value: dte.max, tone: CSS_COLOR.cyan, dirty: maxDirty },
  ];

  return (
    <div
      className="algo-cell--full"
      data-testid="algo-contract-dte-timeline"
      style={{
        display: "grid",
        gap: sp(5),
        minWidth: 0,
        padding: sp("6px 9px 7px"),
        border: `1px solid ${dirty ? cssColorMix(CSS_COLOR.accent, 34) : CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.sm),
        background: dirty ? cssColorMix(CSS_COLOR.accent, 5) : CSS_COLOR.bg1,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "grid",
            gap: sp(2),
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Expiration window
          </span>
          <span
            className="tnum"
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.data,
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.emphasis,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Target {dte.target}DTE
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.data,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.regular,
              }}
            >
              {" "}within {dte.min}-{dte.max}
            </span>
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={zeroDteValue}
          aria-label={zeroDteField.label}
          data-testid="algo-contract-allow-0dte"
          disabled={disabled}
          onClick={() => patchProfileDraftPath(zeroDteField.path, !zeroDteValue)}
          style={{
            minHeight: dim(34),
            border: `1px solid ${zeroDteValue ? CSS_COLOR.cyan : CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            background: zeroDteValue ? cssColorMix(CSS_COLOR.cyan, 12) : "transparent",
            color: zeroDteValue ? CSS_COLOR.cyan : CSS_COLOR.textMuted,
            cursor: disabled ? "not-allowed" : "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            padding: sp("0 9px"),
            textTransform: "uppercase",
            transition: "border-color var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
          }}
        >
          0DTE {zeroDteValue ? "ON" : "OFF"}
          {zeroDteDirty ? (
            <span style={{ marginLeft: sp(2), color: CSS_COLOR.accent }}>•</span>
          ) : null}
        </button>
      </div>
      <div
        ref={trackRef}
        data-testid="algo-contract-dte-rail"
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDraggingHandle(null)}
        onPointerCancel={() => setDraggingHandle(null)}
        style={{
          position: "relative",
          height: dim(54),
          minWidth: 0,
          touchAction: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: dim(25),
            height: dim(5),
            borderRadius: dim(RADII.pill),
            background: CSS_COLOR.borderLight,
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `${percentForValue(dte.min)}%`,
            width: `${Math.max(2, percentForValue(dte.max) - percentForValue(dte.min))}%`,
            top: dim(23),
            height: dim(9),
            borderRadius: dim(RADII.pill),
            background: cssColorMix(CSS_COLOR.cyan, dirty ? 60 : 42),
            boxShadow: dirty ? `0 0 0 1px ${cssColorMix(CSS_COLOR.accent, 32)}` : "none",
          }}
        />
        {markers.map((marker) => (
          <button
            key={marker.key}
            type="button"
            role="slider"
            aria-label={`${marker.label} DTE`}
            aria-valuemin={marker.key === "min" ? 0 : dte.min}
            aria-valuemax={marker.key === "max" ? 730 : dte.max}
            aria-valuenow={marker.value}
            data-testid={`algo-contract-dte-handle-${marker.key}`}
            disabled={disabled}
            onPointerDown={(event) => {
              if (disabled) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDraggingHandle(marker.key);
              patchHandle(marker.key, valueFromClientX(event.clientX));
            }}
            onKeyDown={(event) => handleKeyDown(marker.key, event)}
            style={{
              position: "absolute",
              left: `${percentForValue(marker.value)}%`,
              top: marker.key === "target" ? dim(10) : dim(15),
              width: marker.key === "target" ? dim(28) : dim(24),
              height: marker.key === "target" ? dim(34) : dim(28),
              transform: "translateX(-50%)",
              border: `1px solid ${marker.dirty ? CSS_COLOR.accent : marker.tone}`,
              borderRadius: dim(RADII.pill),
              background: marker.key === "target" ? marker.tone : CSS_COLOR.bg0,
              color: marker.key === "target" ? CSS_COLOR.bg0 : marker.tone,
              cursor: disabled ? "not-allowed" : "grab",
              boxShadow: `0 0 0 2px ${CSS_COLOR.bg1}`,
              fontFamily: T.data,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.label,
              lineHeight: 1,
              padding: 0,
              transition: "border-color var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease, transform var(--ra-motion-fast) ease",
            }}
          >
            {marker.value}
          </button>
        ))}
        {[domainMin, domainMax].map((value, index) => (
          <span
            key={index}
            className="tnum"
            style={{
              position: "absolute",
              left: index === 0 ? 0 : undefined,
              right: index === 1 ? 0 : undefined,
              bottom: 0,
              color: CSS_COLOR.textMuted,
              fontFamily: T.data,
              fontSize: textSize("caption"),
            }}
          >
            {value}
          </span>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: sp(4),
          minWidth: 0,
        }}
      >
        <DteStepper
          label="Min"
          value={dte.min}
          min={0}
          max={dte.max}
          dirty={minDirty}
          disabled={disabled}
          testId="algo-contract-min-dte"
          onChange={(nextValue) => patchDte({ minValue: nextValue })}
        />
        <DteStepper
          label="Target"
          value={dte.target}
          min={dte.min}
          max={dte.max}
          dirty={targetDirty}
          disabled={disabled}
          testId="algo-contract-target-dte"
          onChange={(nextValue) => patchDte({ targetValue: nextValue })}
        />
        <DteStepper
          label="Max"
          value={dte.max}
          min={dte.min}
          max={730}
          dirty={maxDirty}
          disabled={disabled}
          testId="algo-contract-max-dte"
          onChange={(nextValue) => patchDte({ maxValue: nextValue })}
        />
      </div>
      {dirty ? (
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          was {formatSettingValue(minField, minPrevious)}-{formatSettingValue(maxField, maxPrevious)} · target {formatSettingValue(targetField, targetPrevious)} · 0DTE {formatSettingValue(zeroDteField, zeroDtePrevious)}
        </span>
      ) : null}
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
  order,
  disabled,
  tone,
  onSelect,
  onMove,
}) => (
  <AppTooltip content={`${side} ${label}`}>
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${side} strike slot ${slot}; ${label}${selected ? `; priority ${order}` : ""}`}
      data-testid={`algo-strike-ladder-${side.toLowerCase()}-${slot}`}
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
      minHeight: dim(34),
      border: `1px solid ${selected ? tone : CSS_COLOR.borderLight}`,
      borderRadius: dim(RADII.xs),
      background: selected ? cssColorMix(tone, 18) : CSS_COLOR.bg1,
      color: selected ? tone : CSS_COLOR.textMuted,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(3),
      padding: 0,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      outlineOffset: dim(1),
      boxShadow: selected ? `inset 0 -2px 0 ${tone}` : "none",
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.label,
      lineHeight: 1,
      whiteSpace: "nowrap",
      transition: "border-color var(--ra-motion-fast) ease, background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease, transform var(--ra-motion-fast) ease",
    }}
    >
    {selected ? (
      <span
        aria-hidden="true"
        className="tnum"
        style={{
          width: dim(15),
          height: dim(15),
          borderRadius: dim(RADII.pill),
          background: tone,
          color: CSS_COLOR.bg0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: T.data,
          fontSize: textSize("caption"),
          lineHeight: 1,
        }}
      >
        {order}
      </span>
    ) : null}
    <span aria-hidden="true">{label}</span>
    </button>
  </AppTooltip>
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
  const callSlotsField = fieldByPath["optionSelection.callStrikeSlots"];
  const putSlotsField = fieldByPath["optionSelection.putStrikeSlots"];
  const callField = fieldByPath["optionSelection.callStrikeSlot"];
  const putField = fieldByPath["optionSelection.putStrikeSlot"];
  const minValue = getPathValue(profileDraft, minField.path);
  const targetValue = getPathValue(profileDraft, targetField.path);
  const maxValue = getPathValue(profileDraft, maxField.path);
  const callSlots = normalizeSignalOptionsStrikeSlots(
    getPathValue(profileDraft, callSlotsField.path),
    getPathValue(profileDraft, callField.path),
  );
  const putSlots = normalizeSignalOptionsStrikeSlots(
    getPathValue(profileDraft, putSlotsField.path),
    getPathValue(profileDraft, putField.path),
  );
  const callDirty =
    dirtyFieldKeys.has(fieldKey(callSlotsField)) ||
    dirtyFieldKeys.has(fieldKey(callField));
  const putDirty =
    dirtyFieldKeys.has(fieldKey(putSlotsField)) ||
    dirtyFieldKeys.has(fieldKey(putField));
  const formatStrikeList = (slots, side) =>
    slots
      .map((slot) => {
        const meta = strikeSlotMeta(slot);
        return side === "call" ? meta.callLabel : meta.putLabel;
      })
      .join(" → ");
  const contractSummary = [
    `DTE ${formatDteWindowLabel({ minValue, targetValue, maxValue })}`,
    `Calls ${formatStrikeList(callSlots, "call")}`,
    `Puts ${formatStrikeList(putSlots, "put")}`,
  ].join(" · ");

  const patchStrikeSlots = ({ slotsField, primaryField, currentSlots, slot }) => {
    const current = normalizeSignalOptionsStrikeSlots(
      currentSlots,
      getPathValue(profileDraft, primaryField.path),
    );
    const nextSlot = Number(slot);
    const selected = current.includes(nextSlot);
    let nextSlots;
    if (selected) {
      nextSlots = current.length > 1
        ? current.filter((item) => item !== nextSlot)
        : current;
    } else if (current.length >= MAX_SIGNAL_OPTIONS_STRIKE_SLOTS) {
      nextSlots = [current[0], ...current.slice(2), nextSlot];
    } else {
      nextSlots = [...current, nextSlot];
    }
    const normalized = normalizeSignalOptionsStrikeSlots(nextSlots, current);
    patchProfileDraftPath(slotsField.path, normalized);
    patchProfileDraftPath(primaryField.path, normalized[0]);
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
    const dirty =
      label === "CALLS" ? callDirty : label === "PUTS" ? putDirty : false;
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
              ? toneForDirectionalIntent("bullish")
              : label === "PUTS"
                ? toneForDirectionalIntent("bearish")
                : CSS_COLOR.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
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
    const slots = isCall ? callSlots : putSlots;
    const slotsField = isCall ? callSlotsField : putSlotsField;
    const primaryField = isCall ? callField : putField;
    const selectedIndex = slots.indexOf(row.slot);
    const selected = selectedIndex >= 0;
    return (
      <span
        key={`${side.toLowerCase()}-${row.slot}`}
        style={{
          gridColumn: isCall ? 1 : 3,
          gridRow: row.row,
          minHeight: dim(34),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ChainStrikeButton
          side={side}
          slot={row.slot}
          label={isCall ? row.meta.callLabel : row.meta.putLabel}
          selected={selected}
          order={selectedIndex + 1}
          disabled={disabled}
          tone={isCall ? toneForDirectionalIntent("bullish") : toneForDirectionalIntent("bearish")}
          onSelect={(nextSlot) =>
            patchStrikeSlots({
              slotsField,
              primaryField,
              currentSlots: slots,
              slot: nextSlot,
            })
          }
          onMove={(direction) =>
            patchStrikeSlots({
              slotsField,
              primaryField,
              currentSlots: slots,
              slot: moveStrikeSlot(row.slot, direction),
            })
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
        gap: sp(7),
        minWidth: 0,
      }}
    >
      <DteTimelineEditor
        minField={minField}
        targetField={targetField}
        maxField={maxField}
        zeroDteField={zeroDteField}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
      />
      <AppTooltip content={contractSummary}>
        <div
          data-testid="algo-contract-selection-summary"
          className="tnum"
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.data,
            fontSize: textSize("caption"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {contractSummary}
        </div>
      </AppTooltip>
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
        {renderStrikeHeader({ label: "CALLS", column: 1 })}
        {renderStrikeHeader({ label: "STRIKE", column: 2 })}
        {renderStrikeHeader({ label: "PUTS", column: 3 })}
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
                fontSize: textSize("caption"),
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
                height: dim(34),
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
          role="group"
          aria-label="Call strike slots"
          style={{ display: "contents" }}
        >
          {chainSlotRows.map((row) => renderChainButton({ row, side: "CALL" }))}
        </span>
        <span
          role="group"
          aria-label="Put strike slots"
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
  const chartRef = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
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
  const markerByKey = Object.fromEntries(
    markers.map((marker) => [marker.key, marker]),
  );
  const trackDirty = markers.some((marker) => marker.dirty);
  const trackStatus = [
    `stop ${formatPctLabel(markerByKey["hard-stop"]?.positionValue)}`,
    `trail ${formatPctLabel(markerByKey["trail-activation"]?.positionValue)}`,
    `lock ${formatPctLabel(markerByKey["min-locked"]?.positionValue)}`,
  ].join(" / ");
  // Chart model: a dummy price path that rises then pulls back, with three
  // direct-manipulation levers — a flat hard-stop line (drag up/down ->
  // hardStopPct), a trail-activation point on the price (drag left/right ->
  // trailActivationPct), and a trailing-stop line that rides a draggable distance
  // below the running peak once activated (drag up/down -> trailGivebackPct). The
  // lock floor and early-loss level stay as click-to-edit chips below the chart.
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const hardStopMarker = markerByKey["hard-stop"];
  const activationMarker = markerByKey["trail-activation"];
  const givebackMarker = markerByKey["trail-giveback"];
  const hardStopLevel = num(hardStopMarker?.positionValue);
  const earlyLossLevel = num(markerByKey["early-loss"]?.positionValue);
  const trailActivation = Math.max(0, num(activationMarker?.positionValue));
  const trailGiveback = Math.max(0, num(givebackMarker?.positionValue));

  const pricePeak = Math.max(
    60,
    trailActivation * 1.7,
    trailGiveback * 1.6,
    Math.abs(hardStopLevel) + 30,
  );
  const yMax = Math.ceil((pricePeak * 1.06) / 10) * 10;
  const yMin = Math.min(
    -10,
    Math.floor((Math.min(hardStopLevel, earlyLossLevel) - 5) / 10) * 10,
  );
  const ySpan = Math.max(1, yMax - yMin);

  const VIEW_W = 320;
  const VIEW_H = 132;
  const PAD_L = 38;
  const PAD_R = 62;
  const PAD_T = 12;
  const PAD_B = 22;
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;
  const xAt = (t) => PAD_L + clamp(t, 0, 1) * plotW;
  const yPix = (level) =>
    PAD_T + (1 - (clamp(level, yMin, yMax) - yMin) / ySpan) * plotH;
  const leftPctOf = (t) => (xAt(t) / VIEW_W) * 100;
  const topPctOf = (level) => (yPix(level) / VIEW_H) * 100;
  const rightHandleLeftPct = ((PAD_L + plotW) / VIEW_W) * 100;
  const fmtSvg = (value) => value.toFixed(1);

  // Dummy price: ease up to a peak near t=0.72, then pull back so the trailing
  // stop visibly catches the reversal. Light waviness for a price-like feel.
  const SAMPLES = 60;
  const smoothstep = (u) => {
    const c = clamp(u, 0, 1);
    return c * c * (3 - 2 * c);
  };
  const priceAt = (t) => {
    const base =
      t <= 0.72
        ? 1 - Math.pow(1 - t / 0.72, 2)
        : 1 - 0.24 * smoothstep((t - 0.72) / 0.28);
    return pricePeak * (base + 0.03 * Math.sin(t * 7));
  };
  const pricePoints = Array.from({ length: SAMPLES + 1 }, (_, index) => {
    const t = index / SAMPLES;
    return [t, priceAt(t)];
  });
  const toPath = (points) =>
    points
      .map(
        ([t, level], index) =>
          `${index === 0 ? "M" : "L"} ${fmtSvg(xAt(t))} ${fmtSvg(yPix(level))}`,
      )
      .join(" ");
  const pricePath = toPath(pricePoints);
  const peakValue = Math.max(...pricePoints.map(([, level]) => level));

  // Trailing stop: parked at the hard stop until the running peak reaches the
  // activation gain, then rides `trailGiveback` below the running peak (it
  // ratchets and never drops), floored at the hard stop.
  let runningPeak = -Infinity;
  const trailPoints = pricePoints.map(([t, level]) => {
    runningPeak = Math.max(runningPeak, level);
    const activated = trailActivation <= 0 || runningPeak >= trailActivation;
    const trailLevel = activated
      ? Math.max(hardStopLevel, runningPeak - trailGiveback)
      : hardStopLevel;
    return [t, trailLevel];
  });
  const trailPath = toPath(trailPoints);
  const trailEndLevel = trailPoints[trailPoints.length - 1][1];
  const stopLinePath = `M ${fmtSvg(xAt(0))} ${fmtSvg(
    yPix(hardStopLevel),
  )} L ${fmtSvg(xAt(1))} ${fmtSvg(yPix(hardStopLevel))}`;

  // Activation point: where the rising price first reaches the activation gain.
  const activationHit =
    trailActivation > 0
      ? pricePoints.find(([, level]) => level >= trailActivation)
      : pricePoints[0];
  const activationT = activationHit ? activationHit[0] : null;
  const activationLevel = activationT == null ? null : priceAt(activationT);

  // Direct-manipulation levers: map a pointer coordinate to the bound field.
  const dragSpecs = {
    "hard-stop": {
      field: hardStopMarker?.field,
      axis: "y",
      toValue: (level) => level,
    },
    "trail-giveback": {
      field: givebackMarker?.field,
      axis: "y",
      toValue: (level) => peakValue - level,
    },
    "trail-activation": {
      field: activationMarker?.field,
      axis: "x",
      toValue: (t) => priceAt(t),
    },
  };
  const roundToStep = (value, step) => {
    const stepSize = Number(step) || 1;
    return Math.round(value / stepSize) * stepSize;
  };
  const coordFromClient = (axis, clientX, clientY) => {
    const node = chartRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (axis === "x") {
      const leftFrac = PAD_L / VIEW_W;
      const rightFrac = (VIEW_W - PAD_R) / VIEW_W;
      const fracX = (clientX - rect.left) / rect.width;
      return clamp((fracX - leftFrac) / (rightFrac - leftFrac), 0, 1);
    }
    const topFrac = PAD_T / VIEW_H;
    const bottomFrac = (VIEW_H - PAD_B) / VIEW_H;
    const fracY = (clientY - rect.top) / rect.height;
    const plotFrac = clamp((fracY - topFrac) / (bottomFrac - topFrac), 0, 1);
    return yMax - plotFrac * ySpan;
  };
  const makeDragHandlers = (key) => {
    const spec = dragSpecs[key];
    if (!spec?.field || disabled) return {};
    const applyAt = (event) => {
      const coord = coordFromClient(spec.axis, event.clientX, event.clientY);
      if (coord == null) return;
      const next = clamp(
        roundToStep(spec.toValue(coord), spec.field.step),
        spec.field.min ?? -100,
        spec.field.max ?? 10000,
      );
      patchProfileDraftPath(spec.field.path, next);
    };
    return {
      onPointerDown: (event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDraggingKey(key);
        applyAt(event);
      },
      onPointerMove: (event) => {
        if (!(event.buttons & 1)) return;
        applyAt(event);
      },
      onPointerUp: (event) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setDraggingKey(null);
      },
      onPointerCancel: () => setDraggingKey(null),
    };
  };

  const CHIP_LABELS = { "early-loss": "Early Loss", "min-locked": "Lock" };
  const chipMarkers = [
    markerByKey["early-loss"],
    markerByKey["min-locked"],
  ].filter(Boolean);
  const editingMarker = markerByKey[editingKey] || null;
  const popoverPos = { left: "50%", top: "14%" };

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
      role="group"
      aria-label="Primary stop track"
      style={{
        display: "grid",
        gap: sp(5),
        minWidth: 0,
        padding: sp("6px 9px 7px"),
        border: `1px solid ${
          trackDirty ? cssColorMix(CSS_COLOR.accent, 34) : CSS_COLOR.borderLight
        }`,
        borderRadius: dim(RADII.sm),
        background: trackDirty ? cssColorMix(CSS_COLOR.accent, 5) : CSS_COLOR.bg1,
      }}
    >
      <span
        style={{
          display: "grid",
          gap: sp(2),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Primary Stop Track
        </span>
        <span
          className="tnum"
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.data,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.emphasis,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {trackStatus}
        </span>
      </span>
      <div
        ref={chartRef}
        style={{
          position: "relative",
          width: "100%",
          height: dim(156),
          minWidth: 0,
          touchAction: "none",
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          <rect
            x={PAD_L}
            y={yPix(yMax)}
            width={plotW}
            height={Math.max(0, yPix(0) - yPix(yMax))}
            fill={cssColorMix(CSS_COLOR.green, 6)}
          />
          <rect
            x={PAD_L}
            y={yPix(0)}
            width={plotW}
            height={Math.max(0, yPix(yMin) - yPix(0))}
            fill={cssColorMix(CSS_COLOR.red, 6)}
          />
          <line
            x1={PAD_L}
            y1={yPix(0)}
            x2={PAD_L + plotW}
            y2={yPix(0)}
            stroke={CSS_COLOR.border}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={trailPath}
            fill="none"
            stroke={CSS_COLOR.green}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={stopLinePath}
            fill="none"
            stroke={CSS_COLOR.red}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={pricePath}
            fill="none"
            stroke={CSS_COLOR.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          aria-hidden="true"
          className="tnum"
          style={{
            position: "absolute",
            left: sp(1),
            top: `${topPctOf(0)}%`,
            transform: "translateY(-50%)",
            color: CSS_COLOR.textMuted,
            fontFamily: T.data,
            fontSize: textSize("caption"),
          }}
        >
          0%
        </span>
        <span
          aria-hidden="true"
          className="tnum"
          style={{
            position: "absolute",
            left: sp(1),
            top: `${topPctOf(yMin)}%`,
            transform: "translateY(-95%)",
            color: CSS_COLOR.textDim,
            fontFamily: T.data,
            fontSize: textSize("caption"),
          }}
        >
          {formatPctLabel(yMin)}
        </span>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${(PAD_L / VIEW_W) * 100}%`,
            bottom: 0,
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          price →
        </span>
        <div
          data-testid="algo-exit-track-marker-hard-stop"
          {...makeDragHandlers("hard-stop")}
          role="slider"
          aria-label={`Hard stop ${formatPctLabel(hardStopMarker?.rawValue)}`}
          aria-valuenow={Number(hardStopMarker?.rawValue) || 0}
          tabIndex={disabled ? -1 : 0}
          style={{
            position: "absolute",
            left: `${rightHandleLeftPct}%`,
            top: `${topPctOf(hardStopLevel)}%`,
            transform: "translateY(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: sp(1),
            padding: sp("1px 5px"),
            borderRadius: dim(RADII.pill),
            border: `1px solid ${
              hardStopMarker?.dirty
                ? CSS_COLOR.accent
                : cssColorMix(CSS_COLOR.red, 45)
            }`,
            background: cssColorMix(
              CSS_COLOR.red,
              draggingKey === "hard-stop" ? 28 : 14,
            ),
            color: CSS_COLOR.red,
            fontFamily: T.data,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            whiteSpace: "nowrap",
            cursor: disabled ? "not-allowed" : "ns-resize",
            opacity: disabled ? 0.55 : 1,
            touchAction: "none",
            zIndex: 3,
          }}
        >
          Stop {formatPctLabel(hardStopMarker?.rawValue)}
        </div>
        <div
          data-testid="algo-exit-track-marker-trail-giveback"
          {...makeDragHandlers("trail-giveback")}
          role="slider"
          aria-label={`Trailing stop cushion ${formatPctLabel(
            givebackMarker?.rawValue,
          )}`}
          aria-valuenow={Number(givebackMarker?.rawValue) || 0}
          tabIndex={disabled ? -1 : 0}
          style={{
            position: "absolute",
            left: `${rightHandleLeftPct}%`,
            top: `${topPctOf(trailEndLevel)}%`,
            transform: "translateY(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: sp(1),
            padding: sp("1px 5px"),
            borderRadius: dim(RADII.pill),
            border: `1px solid ${
              givebackMarker?.dirty
                ? CSS_COLOR.accent
                : cssColorMix(CSS_COLOR.green, 45)
            }`,
            background: cssColorMix(
              CSS_COLOR.green,
              draggingKey === "trail-giveback" ? 28 : 14,
            ),
            color: CSS_COLOR.green,
            fontFamily: T.data,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            whiteSpace: "nowrap",
            cursor: disabled ? "not-allowed" : "ns-resize",
            opacity: disabled ? 0.55 : 1,
            touchAction: "none",
            zIndex: 3,
          }}
        >
          Trail {formatPctLabel(givebackMarker?.rawValue)}
        </div>
        {activationT != null ? (
          <div
            data-testid="algo-exit-track-marker-trail-activation"
            {...makeDragHandlers("trail-activation")}
            role="slider"
            aria-label={`Trail activates ${formatPctLabel(
              activationMarker?.rawValue,
            )}`}
            aria-valuenow={Number(activationMarker?.rawValue) || 0}
            tabIndex={disabled ? -1 : 0}
            style={{
              position: "absolute",
              left: `${leftPctOf(activationT)}%`,
              top: `${topPctOf(activationLevel)}%`,
              transform: "translate(-50%, -50%)",
              width: dim(13),
              height: dim(13),
              borderRadius: dim(RADII.pill),
              border: `1px solid ${CSS_COLOR.bg1}`,
              background: cssColorMix(
                CSS_COLOR.accent,
                draggingKey === "trail-activation" ? 60 : 36,
              ),
              boxShadow: `0 0 0 2px ${cssColorMix(CSS_COLOR.accent, 22)}`,
              cursor: disabled ? "not-allowed" : "ew-resize",
              opacity: disabled ? 0.55 : 1,
              touchAction: "none",
              padding: 0,
              zIndex: 3,
            }}
          >
            <span
              className="tnum"
              style={{
                position: "absolute",
                left: "50%",
                bottom: `${dim(14)}px`,
                transform: "translateX(-50%)",
                color: CSS_COLOR.accent,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.label,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              Activate {formatPctLabel(activationMarker?.rawValue)}
            </span>
          </div>
        ) : null}
        {editingMarker ? (
          <div
            role="dialog"
            aria-label={`${CHIP_LABELS[editingMarker.key] || editingMarker.label} level`}
            style={{
              position: "absolute",
              left: popoverPos.left,
              top: popoverPos.top,
              transform: "translate(-50%, -50%)",
              zIndex: 4,
              display: "flex",
              alignItems: "center",
              gap: sp(2),
              minWidth: dim(96),
              padding: sp(3),
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              background: CSS_COLOR.bg2,
              boxShadow: ELEVATION.lg,
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                whiteSpace: "nowrap",
              }}
            >
              {CHIP_LABELS[editingMarker.key] || editingMarker.label}
            </span>
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
                field: editingMarker.field,
                value: draftValue,
              })}
            />
            <span
              aria-hidden="true"
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              %
            </span>
          </div>
        ) : null}
      </div>
      {chipMarkers.length ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          {chipMarkers.map((marker) => (
            <button
              key={marker.key}
              type="button"
              data-testid={`algo-exit-track-marker-${marker.key}`}
              disabled={disabled}
              onClick={() => openEditor(marker)}
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: sp(2),
                padding: sp("2px 7px"),
                border: `1px solid ${
                  marker.dirty ? CSS_COLOR.accent : CSS_COLOR.borderLight
                }`,
                borderRadius: dim(RADII.pill),
                background: marker.dirty
                  ? cssColorMix(CSS_COLOR.accent, 8)
                  : CSS_COLOR.bg2,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
              }}
              aria-label={`${CHIP_LABELS[marker.key] || marker.label} ${formatPctLabel(
                marker.rawValue,
              )}`}
            >
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.label,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                {CHIP_LABELS[marker.key] || marker.label}
              </span>
              <span
                className="tnum"
                style={{
                  color: CSS_COLOR.textSec,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.emphasis,
                }}
              >
                {formatPctLabel(marker.rawValue)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
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

const fieldMapForItem = (item) =>
  Object.fromEntries((item.fields || []).map((field) => [field.path, field]));

const formatExitPct = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue.toFixed(0)}%` : "-";
};

const formatExitBars = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${Math.round(numericValue)}b` : "-";
};

const wireRungLabel = (rung) =>
  ({
    wire3: "W3",
    wire2: "W2",
    wire1: "W1",
    trendLine: "TL",
  })[rung] || String(rung || "-");

const ExitGroupShell = ({
  testId,
  title,
  status,
  statusTone = CSS_COLOR.textSec,
  action,
  children,
}) => (
  <div
    className="algo-cell--full"
    data-testid={testId}
    role="group"
    aria-label={title}
    style={{
      display: "grid",
      gap: sp(7),
      minWidth: 0,
      padding: sp("8px 9px 9px"),
      border: `1px solid ${CSS_COLOR.borderLight}`,
      borderRadius: dim(RADII.sm),
      background: CSS_COLOR.bg1,
    }}
  >
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: "grid",
          gap: sp(2),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
        <span
          className="tnum"
          style={{
            color: statusTone,
            fontFamily: T.data,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.emphasis,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {status}
        </span>
      </span>
      {action}
    </div>
    {children}
  </div>
);

const ExitHeaderToggle = ({
  field,
  profileDraft,
  disabled,
  dirtyFieldKeys,
  patchProfileDraftPath,
}) => {
  const checked = Boolean(getPathValue(profileDraft, field.path));
  const dirty = dirtyFieldKeys.has(fieldKey(field));
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
      }}
    >
      {dirty ? (
        <span
          role="status"
          aria-label={`${field.label} unsaved`}
          style={{
            width: dim(5),
            height: dim(5),
            borderRadius: dim(RADII.pill),
            background: CSS_COLOR.accent,
          }}
        />
      ) : null}
      <CompactSwitch
        checked={checked}
        disabled={disabled}
        ariaLabel={field.label}
        testId={`algo-exit-toggle-${field.path}`}
        onChange={(nextValue) => patchProfileDraftPath(field.path, nextValue)}
      />
    </span>
  );
};

const ExitFieldGrid = ({
  fields,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => (
  <div className="algo-settings-grid">
    {fields.filter(Boolean).map((field) => (
      <CompactSettingCell
        key={`${field.slice}.${field.path}`}
        item={field}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        strategySettingsDraft={null}
        strategyBaseline={null}
        patchProfileDraftPath={patchProfileDraftPath}
        patchStrategySettingsPath={() => {}}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
      />
    ))}
  </div>
);

const ProgressiveTrailPreview = ({ steps }) => {
  const visibleSteps = Array.isArray(steps) ? steps.slice(0, 4) : [];
  if (!visibleSteps.length) {
    return (
      <div
        data-testid="algo-progressive-trail-preview"
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
        }}
      >
        No progressive steps
      </div>
    );
  }
  return (
    <div
      data-testid="algo-progressive-trail-preview"
      data-algo-pocket-grid="two"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(72)}px, 1fr))`,
        gap: sp(3),
        minWidth: 0,
      }}
    >
      {visibleSteps.map((step, index) => (
        <AppTooltip
          key={`${step.activationPct}-${index}`}
          content={`Activation ${formatExitPct(step.activationPct)}, lock ${formatExitPct(step.minLockedGainPct)}, giveback ${formatExitPct(step.givebackPct)}`}
        >
          <span
            style={{
              minWidth: 0,
              display: "grid",
              gap: sp(1),
              padding: sp("4px 5px"),
              border: `1px solid ${CSS_COLOR.borderLight}`,
              borderRadius: dim(RADII.xs),
              background: cssColorMix(CSS_COLOR.green, 7),
            }}
          >
            <span
              className="tnum"
              style={{
                color: CSS_COLOR.green,
                fontFamily: T.data,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.emphasis,
                lineHeight: 1,
              }}
            >
              {formatExitPct(step.activationPct)}
            </span>
            <span
              className="tnum"
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.data,
                fontSize: textSize("caption"),
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              L {formatExitPct(step.minLockedGainPct)} / G {formatExitPct(step.givebackPct)}
            </span>
          </span>
        </AppTooltip>
      ))}
    </div>
  );
};

const ProgressiveTrailCell = ({
  item,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => {
  const fieldByPath = fieldMapForItem(item);
  const enabledField = fieldByPath["exitPolicy.progressiveTrailEnabled"];
  const baseGivebackField = fieldByPath["exitPolicy.trailGivebackPct"];
  const stepsField = fieldByPath["exitPolicy.progressiveTrailSteps"];
  const enabled = Boolean(getPathValue(profileDraft, enabledField.path));
  const steps = getPathValue(profileDraft, stepsField.path);
  const stepCount = Array.isArray(steps) ? steps.length : 0;
  return (
    <ExitGroupShell
      testId="algo-exit-progressive-trail"
      title="Progressive Trail"
      status={enabled ? `${stepCount} step${stepCount === 1 ? "" : "s"}` : "OFF"}
      statusTone={enabled ? CSS_COLOR.green : CSS_COLOR.textMuted}
      action={
        <ExitHeaderToggle
          field={enabledField}
          profileDraft={profileDraft}
          disabled={disabled}
          dirtyFieldKeys={dirtyFieldKeys}
          patchProfileDraftPath={patchProfileDraftPath}
        />
      }
    >
      <ProgressiveTrailPreview steps={steps} />
      <ExitFieldGrid
        fields={[baseGivebackField, stepsField]}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
      />
    </ExitGroupShell>
  );
};

const WireTrailPreview = ({ rungs }) => {
  const visibleRungs = Array.isArray(rungs) ? rungs.slice(0, 5) : [];
  if (!visibleRungs.length) {
    return (
      <div
        data-testid="algo-wire-trail-rung-preview"
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
        }}
      >
        No wire rungs
      </div>
    );
  }
  return (
    <div
      data-testid="algo-wire-trail-rung-preview"
      data-algo-pocket-grid="two"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(72)}px, 1fr))`,
        gap: sp(3),
        minWidth: 0,
      }}
    >
      {visibleRungs.map((rung, index) => (
        <AppTooltip
          key={`${rung.activationPct}-${rung.rung}-${index}`}
          content={`${formatExitPct(rung.activationPct)} ${wireRungLabel(rung.rung)}`}
        >
          <span
            style={{
              minWidth: 0,
              display: "grid",
              gap: sp(1),
              padding: sp("4px 5px"),
              border: `1px solid ${CSS_COLOR.borderLight}`,
              borderRadius: dim(RADII.xs),
              background: cssColorMix(CSS_COLOR.cyan, 7),
            }}
          >
            <span
              className="tnum"
              style={{
                color: CSS_COLOR.cyan,
                fontFamily: T.data,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.emphasis,
                lineHeight: 1,
              }}
            >
              {formatExitPct(rung.activationPct)}
            </span>
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.label,
                lineHeight: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {wireRungLabel(rung.rung)}
            </span>
          </span>
        </AppTooltip>
      ))}
    </div>
  );
};

const WireTrailCell = ({
  item,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => {
  const fieldByPath = fieldMapForItem(item);
  const enabledField = fieldByPath["exitPolicy.wireGreekTrail.enabled"];
  const rungsField = fieldByPath["exitPolicy.wireGreekTrail.rungByProfit"];
  const enabled = Boolean(getPathValue(profileDraft, enabledField.path));
  const rungs = getPathValue(profileDraft, rungsField.path);
  const rungCount = Array.isArray(rungs) ? rungs.length : 0;
  const fields = item.fields.filter((field) => field.path !== enabledField.path);
  return (
    <ExitGroupShell
      testId="algo-exit-wire-trail"
      title="Wire Trail"
      status={enabled ? `${rungCount} rung${rungCount === 1 ? "" : "s"}` : "OFF"}
      statusTone={enabled ? CSS_COLOR.cyan : CSS_COLOR.textMuted}
      action={
        <ExitHeaderToggle
          field={enabledField}
          profileDraft={profileDraft}
          disabled={disabled}
          dirtyFieldKeys={dirtyFieldKeys}
          patchProfileDraftPath={patchProfileDraftPath}
        />
      }
    >
      <WireTrailPreview rungs={rungs} />
      <ExitFieldGrid
        fields={fields}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
      />
    </ExitGroupShell>
  );
};

const ExitTimingRulesCell = ({
  item,
  profileDraft,
  profileBaseline,
  patchProfileDraftPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => {
  const fieldByPath = fieldMapForItem(item);
  const earlyBars = getPathValue(profileDraft, "exitPolicy.earlyExitBars");
  const overnightEnabled = Boolean(
    getPathValue(profileDraft, "exitPolicy.overnightExitEnabled"),
  );
  const overnightMin = getPathValue(profileDraft, "exitPolicy.overnightMinGainPct");
  const flipEnabled = Boolean(
    getPathValue(profileDraft, "exitPolicy.flipOnOppositeSignal"),
  );
  const timingSummary = [
    `early ${formatExitBars(earlyBars)}`,
    flipEnabled ? "flip on" : "flip off",
    overnightEnabled ? `ON ${formatExitPct(overnightMin)}` : "overnight off",
  ].join(" / ");
  return (
    <ExitGroupShell
      testId="algo-exit-timing-rules"
      title="Timing & Session"
      status={timingSummary}
      statusTone={CSS_COLOR.textSec}
    >
      <ExitFieldGrid
        fields={[
          fieldByPath["exitPolicy.earlyExitBars"],
          fieldByPath["exitPolicy.flipOnOppositeSignal"],
          fieldByPath["exitPolicy.overnightExitEnabled"],
          fieldByPath["exitPolicy.overnightMinGainPct"],
          fieldByPath["exitPolicy.overnightRunnerGivebackPct"],
        ]}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
      />
    </ExitGroupShell>
  );
};

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
  if (item.kind === "exitProgressiveTrail") {
    return (
      <ProgressiveTrailCell
        key={item.id}
        item={item}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
      />
    );
  }
  if (item.kind === "exitWireTrail") {
    return (
      <WireTrailCell
        key={item.id}
        item={item}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
      />
    );
  }
  if (item.kind === "exitTimingRules") {
    return (
      <ExitTimingRulesCell
        key={item.id}
        item={item}
        profileDraft={profileDraft}
        profileBaseline={profileBaseline}
        patchProfileDraftPath={patchProfileDraftPath}
        disabled={disabled}
        dirtyFieldKeys={dirtyFieldKeys}
        impact={impact}
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
    if (Array.isArray(item.fields)) {
      return (
        count +
        item.fields.reduce(
          (total, field) =>
            total +
            (field.dirtySummary !== false && dirtyFieldKeys.has(fieldKey(field))
              ? 1
              : 0),
          0,
        )
      );
    }
    return count + (dirtyFieldKeys.has(fieldKey(item)) ? 1 : 0);
  }, 0);

const formatSummaryNumber = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value ?? "-");
  if (Number.isInteger(numericValue)) return numericValue.toLocaleString();
  return Number(numericValue.toFixed(2)).toLocaleString();
};

const summaryRootForField = ({ field, profileDraft, strategySettingsDraft }) =>
  field?.slice === "profile" ? profileDraft : strategySettingsDraft;

const summaryValueForPath = ({ path, profileDraft, strategySettingsDraft }) => {
  const field = getSettingFieldByPath(path);
  if (!field) return undefined;
  return getPathValue(
    summaryRootForField({ field, profileDraft, strategySettingsDraft }),
    field.path,
  );
};

const summaryItemPaths = (item) => {
  if (item.kind === "field") return [item.path].filter(Boolean);
  if (item.kind === "dteWindow") return item.paths || [];
  if (item.kind === "strikeSlots") {
    return [item.slotsPath, item.primaryPath].filter(Boolean);
  }
  return [];
};

const summaryItemDirty = (item, dirtyFieldKeys) =>
  summaryItemPaths(item).some((path) => {
    const field = getSettingFieldByPath(path);
    return field ? dirtyFieldKeys.has(fieldKey(field)) : false;
  });

const formatSummaryFieldValue = (field, value, item) => {
  if (item.format === "ofMax") {
    const max = Number(field.max);
    return `${formatSummaryNumber(value)}/${Number.isFinite(max) ? max : "?"}`;
  }
  if (field.type === "boolean") return value ? "ON" : "OFF";
  if (field.type === "select") return formatSettingValue(field, value);
  if (field.format === "money" || field.unit === "USD") {
    return formatMoney(value, 0);
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return formatSettingValue(field, value);
  if (field.unit === "seconds" || field.unit === "sec") {
    return `${formatSummaryNumber(numericValue)}s`;
  }
  if (field.unit === "bars") return `${formatSummaryNumber(numericValue)}b`;
  if (field.unit === "days") return `${formatSummaryNumber(numericValue)}d`;
  if (
    field.unit === "% of mid" ||
    field.unit === "%" ||
    field.unit === "% from entry" ||
    field.unit === "% gain"
  ) {
    return `${formatSummaryNumber(numericValue)}%`;
  }
  if (field.unit === "x ATR") return `${formatSummaryNumber(numericValue)} ATR`;
  if (field.unit === "x avg") return `${formatSummaryNumber(numericValue)} avg`;
  return formatSettingValue(field, value);
};

const buildSectionSummaryItem = ({
  item,
  profileDraft,
  strategySettingsDraft,
  dirtyFieldKeys,
}) => {
  if (item.kind === "field") {
    const field = getSettingFieldByPath(item.path);
    if (!field) return null;
    const value = summaryValueForPath({
      path: item.path,
      profileDraft,
      strategySettingsDraft,
    });
    return {
      id: item.path,
      label: item.label,
      value: formatSummaryFieldValue(field, value, item),
      dirty: summaryItemDirty(item, dirtyFieldKeys),
    };
  }
  if (item.kind === "dteWindow") {
    const minValue = summaryValueForPath({
      path: "optionSelection.minDte",
      profileDraft,
      strategySettingsDraft,
    });
    const targetValue = summaryValueForPath({
      path: "optionSelection.targetDte",
      profileDraft,
      strategySettingsDraft,
    });
    const maxValue = summaryValueForPath({
      path: "optionSelection.maxDte",
      profileDraft,
      strategySettingsDraft,
    });
    const zeroDte = Boolean(
      summaryValueForPath({
        path: "optionSelection.allowZeroDte",
        profileDraft,
        strategySettingsDraft,
      }),
    );
    const dte = normalizeDteValues({ minValue, targetValue, maxValue });
    return {
      id: item.kind,
      label: item.label,
      value: `${dte.min}-${dte.max}d / ${dte.target}d${zeroDte ? " / 0DTE" : ""}`,
      dirty: summaryItemDirty(item, dirtyFieldKeys),
    };
  }
  if (item.kind === "strikeSlots") {
    const slots = normalizeSignalOptionsStrikeSlots(
      getPathValue(profileDraft, item.slotsPath),
      getPathValue(profileDraft, item.primaryPath),
    );
    const isCall = item.side === "call";
    return {
      id: `${item.kind}-${item.side}`,
      label: item.label,
      value: slots
        .map((slot) => {
          const meta = strikeSlotMeta(slot);
          return isCall ? meta.callLabel : meta.putLabel;
        })
        .join(" / "),
      dirty: summaryItemDirty(item, dirtyFieldKeys),
      tone: isCall ? toneForDirectionalIntent("bullish") : toneForDirectionalIntent("bearish"),
    };
  }
  return null;
};

const SectionSummaryStrip = ({
  section,
  profileDraft,
  strategySettingsDraft,
  dirtyFieldKeys,
}) => {
  const items = (section.summary || [])
    .map((item) =>
      buildSectionSummaryItem({
        item,
        profileDraft,
        strategySettingsDraft,
        dirtyFieldKeys,
      }),
    )
    .filter(Boolean);
  if (!items.length) return null;

  return (
    <div
      data-testid={`algo-settings-section-summary-${section.id}`}
      className="algo-settings-grid"
      style={{
        minWidth: 0,
        marginBottom: sp(4),
      }}
    >
      {items.map((item) => {
        const tone = item.dirty ? CSS_COLOR.accent : item.tone || CSS_COLOR.textSec;
        return (
          <AppTooltip key={item.id} content={`${item.label}: ${item.value}`}>
            <span
              style={{
                minWidth: 0,
                display: "grid",
                gap: sp(1),
                padding: sp("4px 5px"),
                border: `1px solid ${
                  item.dirty ? cssColorMix(CSS_COLOR.accent, 38) : CSS_COLOR.borderLight
                }`,
                borderRadius: dim(RADII.xs),
                background: item.dirty
                  ? cssColorMix(CSS_COLOR.accent, 6)
                  : CSS_COLOR.bg1,
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.label,
                  lineHeight: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
              <span
                className="tnum"
                style={{
                  color: tone,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.emphasis,
                  lineHeight: 1.15,
                  minHeight: Math.round(textSize("caption") * 1.15),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.value}
              </span>
            </span>
          </AppTooltip>
        );
      })}
    </div>
  );
};

const ReadOnlyGateBadgeStrip = ({ badges }) => {
  if (!badges?.length) return null;
  return (
    <div
      data-testid="algo-readonly-gate-badges"
      className="algo-settings-grid"
      style={{
        minWidth: 0,
        marginBottom: sp(4),
      }}
    >
      {badges.map((badge) => {
        const tone = badge.critical
          ? CSS_COLOR.amber
          : badge.active
            ? CSS_COLOR.cyan
            : CSS_COLOR.textMuted;
        return (
          <AppTooltip key={badge.id} content={`${badge.label}: ${badge.value}`}>
            <span
              data-testid={`algo-readonly-gate-badge-${badge.id}`}
              style={{
                minWidth: 0,
                display: "grid",
                gap: sp(1),
                padding: sp("4px 5px"),
                border: `1px solid ${
                  badge.critical ? cssColorMix(CSS_COLOR.amber, 38) : CSS_COLOR.borderLight
                }`,
                borderRadius: dim(RADII.xs),
                background: badge.critical
                  ? cssColorMix(CSS_COLOR.amber, 7)
                  : CSS_COLOR.bg1,
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.label,
                  lineHeight: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {badge.label}
              </span>
              <span
                className="tnum"
                style={{
                  color: tone,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.emphasis,
                  lineHeight: 1.15,
                  minHeight: Math.round(textSize("caption") * 1.15),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {badge.value}
              </span>
            </span>
          </AppTooltip>
        );
      })}
    </div>
  );
};

export const AlgoSettingsRegion = ({
  cockpit,
  signalOptionsPositions,
  signalOptionsProfile,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  dirtyFields,
  focusedDeployment,
  controlBaselineReady = true,
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
  const readOnlyGateBadges = useMemo(
    () => buildSignalOptionsReadOnlyGateBadges(signalOptionsProfile ?? profileDraft),
    [profileDraft, signalOptionsProfile],
  );
  const [openSections, setOpenSections] = useState({});
  const disabled =
    !focusedDeployment ||
    !controlBaselineReady ||
    updateProfileMutation?.isPending ||
    updateStrategySettingsMutation?.isPending;

  return (
    <div
      data-testid="algo-settings-region"
      style={{
        padding: sp("2px 12px 12px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        minWidth: 0,
      }}
    >
      {SETTINGS_SECTIONS.map((section, index) => {
        const dirtyCount =
          dirtyCounts[section.label] || sectionDirtyCount(section, dirtyFieldKeys);
        const override = openSections[section.id];
        const open =
          override !== undefined
            ? override
            : (section.defaultOpen ?? false) || dirtyCount > 0;
        const bodyId = `algo-settings-body-${section.id}`;
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
              collapsible
              open={open}
              controlsId={bodyId}
              onToggle={() =>
                setOpenSections((prev) => ({ ...prev, [section.id]: !open }))
              }
            />
            {section.id === "gates" ? (
              <ReadOnlyGateBadgeStrip badges={readOnlyGateBadges} />
            ) : null}
            {!open ? (
              // Collapsed: summary chips are a value preview. Open: the editable
              // fields below ARE the detail, so the chips would just duplicate them.
              <SectionSummaryStrip
                section={section}
                profileDraft={profileDraft}
                strategySettingsDraft={strategySettingsDraft}
                dirtyFieldKeys={dirtyFieldKeys}
              />
            ) : null}
            {open ? (
              <div id={bodyId} className="algo-settings-grid">
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
            ) : null}
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
