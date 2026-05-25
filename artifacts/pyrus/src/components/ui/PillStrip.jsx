import { Pill } from "../platform/primitives.jsx";
import { sp } from "../../lib/uiTokens.jsx";

const EPSILON = 1e-9;

const isActive = (optionValue, currentValue) => {
  if (typeof optionValue === "number" && typeof currentValue === "number") {
    return Math.abs(optionValue - currentValue) < EPSILON;
  }
  return optionValue === currentValue;
};

export const PillStrip = ({
  options = [],
  currentValue,
  onSelect,
  disabled = false,
  ariaLabel,
}) => (
  <div
    role="group"
    aria-label={ariaLabel}
    style={{
      display: "flex",
      flexWrap: "wrap",
      gap: sp(1),
      alignItems: "center",
    }}
  >
    {options.map((option) => (
      <Pill
        key={String(option.value)}
        active={isActive(option.value, currentValue)}
        onClick={disabled ? undefined : () => onSelect(option.value)}
        disabled={disabled}
      >
        {option.label}
      </Pill>
    ))}
  </div>
);

export default PillStrip;
