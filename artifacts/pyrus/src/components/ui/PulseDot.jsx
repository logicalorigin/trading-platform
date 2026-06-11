import React from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { CSS_COLOR, cssColorMix, dim, RADII } from "../../lib/uiTokens.jsx";

const PULSE_CSS = `
@keyframes pyrusPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--ra-pulse-color, currentColor); }
  50%      { box-shadow: 0 0 0 5px transparent; }
}
.ra-pulse {
  animation: pyrusPulse 2.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ra-pulse { animation: none; }
}
`;

const TONE_TO_COLOR = {
  live: CSS_COLOR.pulseLive,
  alert: CSS_COLOR.pulseAlert,
  loss: CSS_COLOR.pulseLoss,
  muted: CSS_COLOR.textMuted,
};

export const PulseDot = ({ active = true, tone, color, size = 6, label }) => {
  const resolvedColor =
    color ||
    (tone && TONE_TO_COLOR[tone] ? TONE_TO_COLOR[tone] : null) ||
    (active ? CSS_COLOR.pulseLive : CSS_COLOR.textMuted);
  return (
    <>
      <style>{PULSE_CSS}</style>
      <AppTooltip content={label}>
        <span
          data-testid="pulse-dot"
          aria-label={label}
          className={active ? "ra-pulse" : undefined}
          style={{
            ["--ra-pulse-color"]: cssColorMix(resolvedColor, 25),
            display: "inline-block",
            width: dim(size),
            height: dim(size),
            borderRadius: dim(RADII.pill),
            background: resolvedColor,
            flexShrink: 0,
          }}
        />
      </AppTooltip>
    </>
  );
};
