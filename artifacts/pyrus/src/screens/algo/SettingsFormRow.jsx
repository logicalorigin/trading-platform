import {
  useId,
} from "react";
import { ThresholdHistogram } from "../../components/platform/primitives.jsx";
import { NumberStepper } from "../../components/ui/NumberStepper.jsx";
import { PillStrip } from "../../components/ui/PillStrip.jsx";
import { Slider } from "../../components/ui/Slider.jsx";
import {
  CSS_COLOR,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  formatChaseSteps,
  formatMoney,
  formatProgressiveTrailSteps,
  numberFrom,
  parseChaseSteps,
  parseProgressiveTrailSteps,
} from "./algoHelpers";
import {
  formatSettingValue,
  isNumericSettingType,
} from "./algoSettingsFields";

const SLIDER_TYPES = new Set(["slider", "logSlider"]);

const formatPillLabel = (field, value) => {
  if (field.format === "money") return formatMoney(value);
  return String(value);
};

const INPUT_STYLE = {
  height: dim(28),
  padding: sp("0 8px"),
  border: `1px solid ${CSS_COLOR.border}`,
  background: CSS_COLOR.bg1,
  borderRadius: dim(RADII.xs),
  color: CSS_COLOR.text,
  fontFamily: T.data,
  fontSize: textSize("body"),
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

export const SettingsToggle = ({ checked, disabled, onChange, ariaLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{
      width: dim(30),
      height: dim(18),
      minWidth: dim(30),
      minHeight: dim(18),
      border: `1px solid ${checked ? CSS_COLOR.accent : CSS_COLOR.border}`,
      borderRadius: dim(9),
      background: checked ? CSS_COLOR.accent : CSS_COLOR.bg2,
      padding: dim(1),
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      display: "flex",
      alignItems: "center",
      justifyContent: checked ? "flex-end" : "flex-start",
      boxSizing: "border-box",
      lineHeight: 0,
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: dim(14),
        height: dim(14),
        borderRadius: dim(7),
        background: checked ? CSS_COLOR.onAccent : CSS_COLOR.textMuted,
        display: "block",
      }}
    />
  </button>
);

const renderImpact = (field, impact) => {
  if (!field.impact || !impact) return null;
  const count = Number(impact.count || 0);
  const hasImpact = count > 0;
  const color = hasImpact && field.warningWhenNonZero !== false ? CSS_COLOR.amber : CSS_COLOR.textMuted;
  const summary =
    impact.total != null
      ? `${count} / ${impact.total}`
      : hasImpact
        ? `${count} would block`
        : "none blocked";
  const symbols = (impact.sampleSymbols || [])
    .slice(0, 3)
    .map((symbol) => String(symbol || "").toUpperCase())
    .filter(Boolean)
    .join(", ");

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(2),
        color,
        fontFamily: T.sans,
        fontSize: textSize("micro"),
        minWidth: 0,
      }}
    >
      <span>{summary}</span>
      {symbols ? <span style={{ color: CSS_COLOR.textMuted }}>{symbols}</span> : null}
      {impact.histogram?.buckets?.length >= 3 ? (
        <ThresholdHistogram
          buckets={impact.histogram.buckets}
          thresholdPosition={impact.histogram.thresholdPosition}
          width={40}
          height={10}
        />
      ) : null}
    </span>
  );
};

export const SettingsFormRow = ({
  field,
  value,
  previousValue,
  dirty,
  disabled,
  impact,
  onPatch,
}) => {
  const id = useId().replace(/:/g, "");
  const numericValue = Number(value);
  const isNumericField = isNumericSettingType(field.type);
  const invalid =
    isNumericField &&
    (!Number.isFinite(numericValue) ||
      (field.min != null && numericValue < field.min) ||
      (field.max != null && numericValue > field.max));
  const inputStyle = {
    ...INPUT_STYLE,
    borderColor: invalid ? CSS_COLOR.red : CSS_COLOR.border,
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : undefined,
  };
  const impactLine = renderImpact(field, impact);

  const renderInput = () => {
    if (field.type === "select") {
      return (
        <select
          id={id}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onPatch(
              field.path,
              field.coerce ? field.coerce(event.target.value) : event.target.value,
            )
          }
          style={inputStyle}
        >
          {(field.options || []).map((option) => {
            const optionValue =
              typeof option === "string" ? option : option.value;
            const optionLabel =
              typeof option === "string" ? option : option.label;
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      );
    }
    if (field.type === "boolean") {
      return (
        <SettingsToggle
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(nextValue) => onPatch(field.path, nextValue)}
          ariaLabel={field.label}
        />
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
    if (SLIDER_TYPES.has(field.type)) {
      const scale = field.type === "logSlider" ? "log" : "linear";
      const safeValue = Number.isFinite(numericValue)
        ? numericValue
        : field.min ?? 0;
      const showStepper = field.showStepper !== false;
      const quickSetOptions = Array.isArray(field.quickSet)
        ? field.quickSet.map((v) => ({
            label: formatPillLabel(field, v),
            value: v,
          }))
        : null;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(2),
            paddingTop: sp(1),
          }}
        >
          <Slider
            value={safeValue}
            onChange={(next) => onPatch(field.path, next)}
            min={field.min}
            max={field.max}
            step={field.step}
            scale={scale}
            disabled={disabled}
            ariaLabel={field.label}
          />
          {quickSetOptions ? (
            <PillStrip
              options={quickSetOptions}
              currentValue={safeValue}
              onSelect={(next) => onPatch(field.path, next)}
              disabled={disabled}
              ariaLabel={`${field.label} quick set`}
            />
          ) : null}
          {showStepper ? (
            <NumberStepper
              value={value ?? ""}
              onChange={(next) => {
                if (next === "" || next === "-") {
                  onPatch(field.path, next);
                  return;
                }
                onPatch(field.path, numberFrom(next, field.min ?? 0));
              }}
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={disabled}
              ariaLabel={`${field.label} precise value`}
            />
          ) : null}
        </div>
      );
    }
    return (
      <input
        id={id}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onPatch(field.path, numberFrom(event.target.value, field.min ?? 0))
        }
        style={inputStyle}
      />
    );
  };

  return (
    <label
      htmlFor={field.type === "boolean" ? undefined : id}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(1),
        minWidth: 0,
        gridColumn: field.fullWidth ? "1 / -1" : undefined,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(1),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {field.label}
        </span>
        {dirty ? (
          <span
            role="status"
            aria-label="Unsaved change"
            title={`was: ${formatSettingValue(field, previousValue)}`}
            style={{
              width: dim(6),
              height: dim(6),
              borderRadius: dim(3),
              background: CSS_COLOR.accent,
              flex: "0 0 auto",
              transition: "opacity 120ms ease-out",
            }}
          />
        ) : null}
      </span>
      {renderInput()}
      {invalid ? (
        <span
          style={{
            color: CSS_COLOR.red,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
          }}
        >
          Must be between {field.min} and {field.max}
        </span>
      ) : impactLine ? (
        impactLine
      ) : field.unit ? (
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
          }}
        >
          {field.unit}
        </span>
      ) : null}
    </label>
  );
};

export default SettingsFormRow;
