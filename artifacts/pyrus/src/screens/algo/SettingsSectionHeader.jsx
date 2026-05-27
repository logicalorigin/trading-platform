import {
  CSS_COLOR,
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
      paddingBottom: sp(4),
      borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
      marginBottom: sp(3),
      minWidth: 0,
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textDim,
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
          color: CSS_COLOR.textMuted,
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
