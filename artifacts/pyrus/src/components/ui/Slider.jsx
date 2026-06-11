import * as RadixSlider from "@radix-ui/react-slider";
import { CSS_COLOR, cssColorMix, dim, RADII } from "../../lib/uiTokens.jsx";

const LOG_POSITION_RESOLUTION = 1000;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const snapToStep = (value, step, min, max) => {
  if (!step || step <= 0) return clamp(value, min, max);
  const offset = min;
  const snapped = Math.round((value - offset) / step) * step + offset;
  return clamp(snapped, min, max);
};

const logValueToPosition = (value, min, max) => {
  const safeValue = clamp(value, min, max);
  const lnMin = Math.log(min);
  const lnMax = Math.log(max);
  if (lnMax === lnMin) return 0;
  const ratio = (Math.log(safeValue) - lnMin) / (lnMax - lnMin);
  return Math.round(ratio * LOG_POSITION_RESOLUTION);
};

const logPositionToValue = (position, min, max) => {
  const lnMin = Math.log(min);
  const lnMax = Math.log(max);
  const ratio = position / LOG_POSITION_RESOLUTION;
  return Math.exp(lnMin + ratio * (lnMax - lnMin));
};

export const Slider = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  scale = "linear",
  disabled = false,
  ariaLabel,
}) => {
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : min;
  const isLog = scale === "log";

  const radixMin = isLog ? 0 : min;
  const radixMax = isLog ? LOG_POSITION_RESOLUTION : max;
  const radixStep = isLog ? 1 : step;
  const radixValue = isLog
    ? logValueToPosition(numericValue, min, max)
    : numericValue;

  const handleChange = (next) => {
    const raw = Array.isArray(next) ? next[0] : next;
    const mapped = isLog ? logPositionToValue(raw, min, max) : raw;
    const snapped = snapToStep(mapped, step, min, max);
    onChange(snapped);
  };

  return (
    <RadixSlider.Root
      value={[radixValue]}
      onValueChange={handleChange}
      min={radixMin}
      max={radixMax}
      step={radixStep}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: dim(22),
        userSelect: "none",
        touchAction: "none",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <RadixSlider.Track
        style={{
          position: "relative",
          flexGrow: 1,
          height: dim(4),
          background: CSS_COLOR.bg2,
          borderRadius: dim(RADII.pill),
          overflow: "hidden",
        }}
      >
        <RadixSlider.Range
          style={{
            position: "absolute",
            height: "100%",
            background: CSS_COLOR.accent,
            borderRadius: dim(RADII.pill),
          }}
        />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        style={{
          display: "block",
          width: dim(14),
          height: dim(14),
          borderRadius: "50%",
          background: CSS_COLOR.bg0,
          border: `1.5px solid ${CSS_COLOR.accent}`,
          boxShadow: `0 0 0 0 ${cssColorMix(CSS_COLOR.accent, 0)}`,
          outline: "none",
          transition:
            "box-shadow var(--ra-motion-fast) var(--ra-motion-ease), transform var(--ra-motion-fast) var(--ra-motion-ease)",
          cursor: disabled ? "not-allowed" : "grab",
        }}
        onFocus={(event) => {
          event.currentTarget.style.boxShadow = `0 0 0 4px ${cssColorMix(CSS_COLOR.accent, 20)}`;
        }}
        onBlur={(event) => {
          event.currentTarget.style.boxShadow = `0 0 0 0 ${cssColorMix(CSS_COLOR.accent, 0)}`;
        }}
      />
    </RadixSlider.Root>
  );
};

export default Slider;
