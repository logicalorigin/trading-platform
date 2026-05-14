import { T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const PULSE_CSS = `
@keyframes rayalgoCockpitPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--ra-cockpit-pulse, currentColor); }
  50%      { box-shadow: 0 0 0 5px transparent; }
}
.ra-cockpit-pulse { animation: rayalgoCockpitPulse 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .ra-cockpit-pulse { animation: none; }
}
`;

const PulseDot = ({ tone, animated }) => (
  <span
    aria-hidden="true"
    className={animated ? "ra-cockpit-pulse" : undefined}
    style={{
      ["--ra-cockpit-pulse"]: `${tone}40`,
      display: "inline-block",
      width: dim(6),
      height: dim(6),
      borderRadius: "50%",
      background: tone,
      flexShrink: 0,
    }}
  />
);

/**
 * CockpitHeader — unified header for cockpit screens (Flow, Market, etc).
 *
 * Props:
 *   eyebrow   small caps label above title
 *   title     large screen title (sans, 26px)
 *   subtitle  optional smaller secondary text
 *   pulse     { state: "live"|"slow"|"off", label } animated dot indicator
 *   pills     array of nodes to render as chips inline (status badges)
 *   actions   right-side row (buttons, dropdowns)
 *   trailing  optional bottom line of metadata
 */
export const CockpitHeader = ({
  eyebrow,
  title,
  subtitle,
  pulse,
  pills,
  actions,
  trailing,
  dataTestId,
  narrow = false,
}) => {
  const pulseTone =
    pulse?.state === "live"
      ? T.green
      : pulse?.state === "slow"
        ? T.amber
        : T.textMuted;
  return (
    <div
      data-testid={dataTestId || "cockpit-header"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(narrow ? 8 : 12),
        marginBottom: sp(narrow ? 10 : 16),
        minWidth: 0,
      }}
    >
      <style>{PULSE_CSS}</style>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: sp(12),
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
          {eyebrow ? (
            <span
              style={{
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                color: T.textMuted,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              {eyebrow}
            </span>
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(10),
              minWidth: 0,
            }}
          >
            {pulse ? (
              <PulseDot tone={pulseTone} animated={pulse.state === "live"} />
            ) : null}
            <h1
              title={pulse?.label}
              style={{
                margin: 0,
                color: T.text,
                fontFamily: T.sans,
                fontSize: textSize(narrow ? "displayMedium" : "displayLarge"),
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {title}
            </h1>
            {pills && pills.length ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(5),
                  flexWrap: "wrap",
                  paddingLeft: sp(4),
                }}
              >
                {pills}
              </div>
            ) : null}
          </div>
          {subtitle ? (
            <span
              style={{
                marginTop: sp(2),
                color: T.textSec,
                fontFamily: T.sans,
                fontSize: textSize("paragraph"),
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
        {actions ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(6),
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div
          style={{
            color: T.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.02em",
            display: "flex",
            flexWrap: "wrap",
            gap: sp(12),
          }}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  );
};
