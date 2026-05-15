import { T, sp, textSize } from "../../lib/uiTokens.jsx";
import { PulseDot } from "./PulseDot.jsx";

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
              <PulseDot
                color={pulseTone}
                active={pulse.state === "live"}
                label={pulse?.label}
              />
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
