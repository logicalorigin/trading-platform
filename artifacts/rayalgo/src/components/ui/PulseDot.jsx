import { T, dim } from "../../lib/uiTokens.jsx";

const PULSE_CSS = `
@keyframes rayalgoPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--ra-pulse-color, currentColor); }
  50%      { box-shadow: 0 0 0 5px transparent; }
}
.ra-pulse {
  animation: rayalgoPulse 2.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ra-pulse { animation: none; }
}
`;

const TONE_TO_COLOR = {
  live: () => T.pulseLive,
  alert: () => T.pulseAlert,
  loss: () => T.pulseLoss,
  muted: () => T.textMuted,
};

export const PulseDot = ({ active = true, tone, color, size = 6, label }) => {
  const resolvedColor =
    color ||
    (tone && TONE_TO_COLOR[tone] ? TONE_TO_COLOR[tone]() : null) ||
    (active ? T.pulseLive : T.textMuted);
  return (
    <>
      <style>{PULSE_CSS}</style>
      <span
        data-testid="pulse-dot"
        title={label}
        aria-label={label}
        className={active ? "ra-pulse" : undefined}
        style={{
          ["--ra-pulse-color"]: `${resolvedColor}40`,
          display: "inline-block",
          width: dim(size),
          height: dim(size),
          borderRadius: "50%",
          background: resolvedColor,
          flexShrink: 0,
        }}
      />
    </>
  );
};
