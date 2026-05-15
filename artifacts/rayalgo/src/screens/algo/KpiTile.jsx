import { RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

export const KpiTile = ({
  label,
  value,
  detail,
  tone,
  trend,
  dataTestId,
}) => {
  const accent = tone || T.text;
  return (
    <div
      data-testid={dataTestId}
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.xs),
        background: T.bg1,
        padding: sp("7px 9px"),
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
      }}
    >
      <div
        style={{
          color: T.textMuted,
          fontFamily: T.sans,
          fontSize: fs(7),
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: sp(5),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: accent,
            fontFamily: T.sans,
            fontSize: fs(12),
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        {trend ? (
          <span
            style={{
              color: accent,
              fontFamily: T.sans,
              fontSize: fs(8),
              opacity: 0.85,
            }}
          >
            {trend}
          </span>
        ) : null}
      </div>
      {detail ? (
        <div
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: fs(7),
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
};
