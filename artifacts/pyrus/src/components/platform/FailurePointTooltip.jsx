import React from "react";
import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

const severityTone = (severity) => {
  if (severity === "warning") return CSS_COLOR.red;
  if (severity === "warning" || severity === "attention") return CSS_COLOR.amber;
  return CSS_COLOR.cyan;
};

const severityIcon = (severity) => {
  if (severity === "warning") return AlertTriangle;
  if (severity === "warning" || severity === "attention") return CircleAlert;
  return Info;
};

const sectionLabelStyle = {
  color: CSS_COLOR.textMuted,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const bodyTextStyle = {
  color: CSS_COLOR.textSec,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  lineHeight: 1.35,
};

const rowValueStyle = {
  color: CSS_COLOR.text,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  lineHeight: 1.25,
  textAlign: "right",
  overflowWrap: "anywhere",
};

const formatReasonText = (reason) =>
  String(reason || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const FailurePointContent = ({ point, compact = false }) => {
  if (!point) return null;
  const tone = severityTone(point.severity);
  const Icon = severityIcon(point.severity);
  const metrics = Array.isArray(point.metrics) ? point.metrics.slice(0, compact ? 4 : 6) : [];
  const causes = Array.isArray(point.topCauses)
    ? point.topCauses.slice(0, compact ? 3 : 5)
    : [];
  return (
    <div
      data-testid="failure-point-tooltip-content"
      style={{
        display: "grid",
        gap: sp(compact ? 7 : 9),
        width: dim(compact ? 276 : 320),
        maxWidth: "min(78vw, 340px)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${dim(16)}px minmax(0, 1fr)`,
          gap: sp(7),
          alignItems: "start",
        }}
      >
        <Icon
          size={14}
          strokeWidth={1.9}
          aria-hidden="true"
          style={{ color: tone, marginTop: dim(1) }}
        />
        <div style={{ minWidth: 0, display: "grid", gap: sp(3) }}>
          <div
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: textSize("bodyStrong"),
              fontWeight: FONT_WEIGHTS.emphasis,
              lineHeight: 1.2,
              overflowWrap: "anywhere",
            }}
          >
            {point.title}
          </div>
          <div style={bodyTextStyle}>{point.summary}</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(80px, 0.65fr) minmax(0, 1.35fr)",
          gap: sp("4px 10px"),
          alignItems: "baseline",
        }}
      >
        {point.source ? (
          <>
            <div style={sectionLabelStyle}>Source</div>
            <div style={rowValueStyle}>{point.source}</div>
          </>
        ) : null}
        {point.reason ? (
          <>
            <div style={sectionLabelStyle}>Reason</div>
            <div style={rowValueStyle}>{formatReasonText(point.reason)}</div>
          </>
        ) : null}
        {point.observedAt ? (
          <>
            <div style={sectionLabelStyle}>Observed</div>
            <div style={rowValueStyle}>{point.observedAt}</div>
          </>
        ) : null}
        {metrics.map(([label, value]) => (
          <React.Fragment key={`${label}:${value}`}>
            <div style={sectionLabelStyle}>{label}</div>
            <div style={rowValueStyle}>{value}</div>
          </React.Fragment>
        ))}
      </div>

      {causes.length ? (
        <div style={{ display: "grid", gap: sp(4) }}>
          <div style={sectionLabelStyle}>Top causes</div>
          <div style={{ display: "grid", gap: sp(3) }}>
            {causes.map((cause) => (
              <div
                key={cause}
                style={{
                  ...bodyTextStyle,
                  color: CSS_COLOR.textDim,
                  overflowWrap: "anywhere",
                }}
              >
                {cause}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {point.nextAction ? (
        <div
          style={{
            display: "grid",
            gap: sp(3),
            borderTop: `1px solid ${CSS_COLOR.border}`,
            paddingTop: sp(7),
          }}
        >
          <div style={{ ...sectionLabelStyle, color: tone }}>Next</div>
          <div style={bodyTextStyle}>{point.nextAction}</div>
        </div>
      ) : null}
    </div>
  );
};

export const FailurePointTooltip = ({
  point,
  children,
  side = "top",
  align = "center",
  disabled = false,
  compact = false,
  className,
}) => {
  if (!point || disabled) return <>{children}</>;
  return (
    <AppTooltip
      content={<FailurePointContent point={point} compact={compact} />}
      side={side}
      align={align}
      className={className}
    >
      {children}
    </AppTooltip>
  );
};

export const FailurePointPopoverBody = ({ point, compact = false }) => (
  <FailurePointContent point={point} compact={compact} />
);

export const FailurePointInlineIcon = ({
  point,
  side = "top",
  align = "center",
  size = 13,
}) => {
  if (!point) return null;
  const tone = severityTone(point.severity);
  const Icon = severityIcon(point.severity);
  return (
    <FailurePointTooltip point={point} side={side} align={align} compact>
      <span
        data-testid="failure-point-inline-icon"
        role="img"
        aria-label={`${point.title} details`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: dim(size + 6),
          height: dim(size + 6),
          borderRadius: dim(RADII.pill),
          color: tone,
          cursor: "help",
          flexShrink: 0,
        }}
      >
        <Icon size={size} strokeWidth={1.9} aria-hidden="true" />
      </span>
    </FailurePointTooltip>
  );
};

export default FailurePointTooltip;
