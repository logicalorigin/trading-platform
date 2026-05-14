import { T, dim } from "../../lib/uiTokens.jsx";

const PULSE_CSS = `
@keyframes rayalgoAlgoPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--ra-pulse-color, currentColor); }
  50%      { box-shadow: 0 0 0 5px transparent; }
}
.ra-algo-pulse {
  animation: rayalgoAlgoPulse 2.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ra-algo-pulse { animation: none; }
}
`;

export const PulseDot = ({ active = true, color, size = 6, label }) => {
  const tone = color || (active ? T.green : T.textMuted);
  return (
    <>
      <style>{PULSE_CSS}</style>
      <span
        data-testid="algo-pulse-dot"
        title={label}
        aria-label={label}
        className={active ? "ra-algo-pulse" : undefined}
        style={{
          ["--ra-pulse-color"]: `${tone}40`,
          display: "inline-block",
          width: dim(size),
          height: dim(size),
          borderRadius: "50%",
          background: tone,
          flexShrink: 0,
        }}
      />
    </>
  );
};
