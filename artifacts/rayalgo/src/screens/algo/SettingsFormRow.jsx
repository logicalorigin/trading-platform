import { useId } from "react";
import { ThresholdHistogram } from "../../components/platform/primitives.jsx";
import {
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  formatChaseSteps,
  formatProgressiveTrailSteps,
  numberFrom,
  parseChaseSteps,
  parseProgressiveTrailSteps,
} from "./algoHelpers";
import { formatSettingValue } from "./algoSettingsFields";

const INPUT_STYLE = {
  height: dim(28),
  padding: sp("0 8px"),
  border: `1px solid ${T.border}`,
  background: T.bg1,
  borderRadius: dim(RADII.xs),
  color: T.text,
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
      border: `1px solid ${checked ? T.accent : T.border}`,
      borderRadius: dim(9),
      background: checked ? T.accent : T.bg2,
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
        background: checked ? T.onAccent : T.textMuted,
        display: "block",
      }}
    />
  </button>
);

const renderImpact = (field, impact) => {
  if (!field.impact || !impact) return null;
  const count = Number(impact.count || 0);
  const hasImpact = count > 0;
  const color = hasImpact && field.warningWhenNonZero !== false ? T.amber : T.textMuted;
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
      {symbols ? <span style={{ color: T.textMuted }}>{symbols}</span> : null}
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
  const invalid =
    field.type === "number" &&
    (!Number.isFinite(numericValue) ||
      (field.min != null && numericValue < field.min) ||
      (field.max != null && numericValue > field.max));
  const inputStyle = {
    ...INPUT_STYLE,
    borderColor: invalid ? T.red : T.border,
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
            color: T.textDim,
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
              background: T.accent,
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
            color: T.red,
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
            color: T.textMuted,
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
