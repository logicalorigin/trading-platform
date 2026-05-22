import {
  FONT_WEIGHTS,
  T,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

export const SettingsSectionHeader = ({ label, helper }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: sp(4),
      padding: sp("0 0 4px 0"),
      borderBottom: `1px solid ${T.borderLight}`,
      marginBottom: sp(3),
      minWidth: 0,
    }}
  >
    <span
      style={{
        color: T.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.emphasis,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    {helper ? (
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("micro"),
          whiteSpace: "nowrap",
        }}
      >
        {helper}
      </span>
    ) : null}
  </div>
);

export default SettingsSectionHeader;
