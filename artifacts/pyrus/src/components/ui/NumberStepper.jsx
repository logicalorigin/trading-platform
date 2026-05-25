import { useId } from "react";
import { RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const clamp = (value, min, max) => {
  let next = value;
  if (Number.isFinite(min)) next = Math.max(next, min);
  if (Number.isFinite(max)) next = Math.min(next, max);
  return next;
};

const BUTTON_SIZE = 28;
const HEIGHT = 28;

const buttonStyle = (disabled) => ({
  width: dim(BUTTON_SIZE),
  height: dim(HEIGHT),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: T.bg1,
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: dim(RADII.xs),
  fontFamily: T.sans,
  fontSize: textSize("body"),
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  padding: 0,
  lineHeight: 1,
});

export const NumberStepper = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  ariaLabel,
}) => {
  const id = useId().replace(/:/g, "");
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : min ?? 0;

  const stepBy = (direction) => {
    const next = clamp(safeValue + direction * step, min, max);
    if (next !== safeValue) onChange(next);
  };

  const handleInput = (event) => {
    const raw = event.target.value;
    if (raw === "" || raw === "-") {
      onChange(raw);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed, min, max));
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(1),
        width: "100%",
      }}
    >
      <button
        type="button"
        aria-label="Decrement"
        disabled={disabled || (Number.isFinite(min) && safeValue <= min)}
        onClick={() => stepBy(-1)}
        style={buttonStyle(
          disabled || (Number.isFinite(min) && safeValue <= min),
        )}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={handleInput}
        aria-label={ariaLabel}
        style={{
          flex: 1,
          minWidth: 0,
          height: dim(HEIGHT),
          padding: sp("0 8px"),
          border: `1px solid ${T.border}`,
          background: T.bg1,
          borderRadius: dim(RADII.xs),
          color: T.text,
          fontFamily: T.data,
          fontSize: textSize("body"),
          outline: "none",
          boxSizing: "border-box",
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? "not-allowed" : "text",
          textAlign: "right",
        }}
      />
      <button
        type="button"
        aria-label="Increment"
        disabled={disabled || (Number.isFinite(max) && safeValue >= max)}
        onClick={() => stepBy(1)}
        style={buttonStyle(
          disabled || (Number.isFinite(max) && safeValue >= max),
        )}
      >
        +
      </button>
    </div>
  );
};

export default NumberStepper;
